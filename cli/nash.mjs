#!/usr/bin/env node
/**
 * nash — the NashGit CLI.
 *
 * Wraps git so working against your NashGit server takes one word:
 *
 *   nash login http://nas:3000        one-time setup (admin credentials)
 *   nash create my-project            create repo on the server + wire remote
 *   nash clone dotfiles               clone a repo from the server
 *   nash push / nash pull             push/pull the current branch to the NAS
 *   nash backup                       push every local branch and tag
 *   nash list                         list repos on the server
 *
 * After `nash login`, a deploy token is created on the server and stored in
 * ~/.config/nashgit/config.json (mode 0600). Remote URLs contain no token;
 * Git gets it through a local askpass helper.
 *
 * Plain git keeps working too — this is sugar, not a replacement.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const CONFIG_DIR = join(homedir(), '.config', 'nashgit');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const ASKPASS_FILE = fileURLToPath(new URL('./askpass.mjs', import.meta.url));

// ---------------------------------------------------------------------------
// Colors + cherry art (TTY only; NO_COLOR respected)
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `[${code}m${s}[0m` : s);
const red = paint('31');
const cherry = paint('38;5;161');
const green = paint('32');
const dim = paint('2');
const bold = paint('1');

const CHERRY_ART = [
  '      \\   /',
  '       \\ /',
  '   .--.  V  .--.',
  '  (    )   (    )',
  "   `--'     `--'",
];

function printCherry() {
  if (!useColor) return;
  for (const line of CHERRY_ART) console.log(cherry(line));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg || !cfg.server || !cfg.token) {
    fatal('Not logged in. Run: nash login <server-url>');
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fatal(msg) {
  console.error(`${red('nash:')} ${msg}`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', ['-c', 'credential.helper=', '-c', 'credential.useHttpPath=true', ...args], {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, LC_ALL: 'C', GIT_ASKPASS: ASKPASS_FILE, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  })
    ?.toString()
    .trim();
}

function insideGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true });
}

/** Build a credential-free remote URL. Git obtains the token via GIT_ASKPASS. */
function remoteUrl(cfg, repo) {
  const u = new URL(cfg.server);
  u.username = '';
  u.password = '';
  u.pathname = `/git/${repo}.git`;
  return u.toString();
}

/** Server API call with the admin session cookie. */
async function api(cfg, path, opts = {}) {
  const res = await fetch(`${cfg.server}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cfg.cookie ? { Cookie: cfg.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    if (res.status === 401) fatal('Session expired. Run: nash login <server-url>');
    fatal(`${opts.method ?? 'GET'} ${path} failed (${res.status}): ${data?.error ?? res.statusText}`);
  }
  return data;
}

// Prompting that works both interactively (TTY) and with piped stdin.
// Piped stdin is consumed via an async line iterator — rl.question() would
// swallow the whole buffer on the first call and starve the second.
let lineIter = null;
async function nextLine() {
  if (!lineIter) {
    lineIter = readline
      .createInterface({ input: process.stdin, terminal: false })
      [Symbol.asyncIterator]();
  }
  const { value, done } = await lineIter.next();
  if (done) return '';
  return value;
}

async function prompt(question, { hidden = false } = {}) {
  // Hidden entry only works on a real TTY; piped input falls back to plain.
  if (hidden && process.stdin.isTTY) {
    process.stdout.write(question);
    return new Promise((resolve) => {
      let answer = '';
      const onData = (chunk) => {
        const char = chunk.toString('utf8');
        if (char === '\n' || char === '\r') {
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          resolve(answer);
        } else if (char === '\x7f' || char === '\b') {
          answer = answer.slice(0, -1);
        } else if (char === '\x03') {
          process.exit(0);
        } else {
          answer += char;
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.on('data', onData);
    });
  }
  process.stdout.write(question);
  return nextLine();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLogin(server) {
  if (!server) fatal('Usage: nash login <server-url>   e.g. nash login http://nas:3000');
  server = server.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) server = `http://${server}`;
  const parsedServer = new URL(server);
  if (parsedServer.username || parsedServer.password) fatal('Use a server URL without embedded credentials.');

  const health = await fetch(`${server}/api/health`).catch(() => null);
  if (!health?.ok) fatal(`Cannot reach ${server} — is NashGit running there?`);

  const username = await prompt('Admin username: ');
  const password = await prompt('Admin password: ', { hidden: true });

  const res = await fetch(`${server}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) fatal(`Login failed (${res.status}). Check your credentials.`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) fatal('Login succeeded but no session cookie was returned.');

  const cfg = { server, cookie };
  // Create a dedicated deploy token for this machine.
  const tokenName = `nash-cli-${hostname().slice(0, 32)}`;
  const created = await api(cfg, '/api/tokens', { method: 'POST', body: { name: tokenName } });
  cfg.token = created.token;
  cfg.tokenPrefix = created.prefix;
  saveConfig(cfg);

  printCherry();
  console.log(`\n${green('Logged in')} to ${bold(server)}`);
  console.log(`Deploy token "${tokenName}" created and stored in ${dim(CONFIG_FILE)}`);
  console.log(`Try: ${cherry('nash list')}`);
}

async function cmdLogout() {
  if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
  console.log('Logged out. Local config removed.');
}

async function cmdList() {
  const cfg = requireConfig();
  const repos = await api(cfg, '/api/repos');
  if (repos.length === 0) {
    console.log('No repositories yet. Create one: nash create <name>');
    return;
  }
  const w = Math.max(...repos.map((r) => r.name.length));
  for (const r of repos) {
    const size = r.sizeBytes > 1048576
      ? `${(r.sizeBytes / 1048576).toFixed(1)} MB`
      : `${(r.sizeBytes / 1024).toFixed(1)} KB`;
    const push = r.last_push_at ? r.last_push_at.replace('T', ' ').slice(0, 16) : 'never pushed';
    console.log(`${r.name.padEnd(w)}  ${size.padStart(9)}  ${push}`);
  }
}

async function cmdCreate(name, description = '') {
  if (!name) fatal('Usage: nash create <name> [-d "description"]');
  const cfg = requireConfig();
  await api(cfg, '/api/repos', { method: 'POST', body: { name, description } });
  console.log(`Created ${cfg.server}/git/${name}.git`);

  if (insideGitRepo()) {
    const url = remoteUrl(cfg, name);
    const remotes = git(['remote'], { quiet: true }).split('\n').filter(Boolean);
    if (!remotes.includes('nas')) {
      git(['remote', 'add', 'nas', url]);
      console.log('Added remote "nas". The token stays in the local config.');
    } else {
      git(['remote', 'set-url', 'nas', url]);
      console.log('Updated remote "nas" to point at the new repo.');
    }
    console.log('Back up branches and tags: nash backup');
  } else {
    console.log(`Clone it anywhere: nash clone ${name}`);
  }
}

function cmdClone(name, dir) {
  if (!name) fatal('Usage: nash clone <name> [directory]');
  const cfg = requireConfig();
  git(['clone', '-o', 'nas', remoteUrl(cfg, name), ...(dir ? [dir] : [])]);
  const target = dir ?? basename(name);
  console.log(`\nCloned into ${target}. Push/pull with: nash push · nash pull`);
}

/** Never push to origin by accident. */
function nasRemote() {
  const remotes = git(['remote'], { quiet: true }).split('\n').filter(Boolean);
  if (remotes.includes('nas')) return 'nas';
  fatal('No "nas" remote configured in this repository.');
}

function cmdBackup() {
  requireConfig();
  if (!insideGitRepo()) fatal('Not inside a git repository.');
  const remote = nasRemote();
  git(['push', remote, '--all']);
  git(['push', remote, '--tags']);
  console.log('Backed up local branches and tags. Uncommitted files are not included.');
}

function cmdPush() {
  requireConfig();
  if (!insideGitRepo()) fatal('Not inside a git repository.');
  git(['push', nasRemote(), currentBranch()]);
}

function cmdPull() {
  requireConfig();
  if (!insideGitRepo()) fatal('Not inside a git repository.');
  git(['pull', nasRemote(), currentBranch()]);
}

function cmdStatus() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log('Not logged in. Run: nash login <server-url>');
    return;
  }
  console.log(`Server: ${cfg.server}`);
  console.log(`Token:  ${cfg.tokenPrefix ?? '(unknown)'}…`);
  console.log(`Config: ${CONFIG_FILE}`);
}

function usage() {
  console.log(`nash — the NashGit CLI

Usage:
  nash login <server-url>      One-time setup. Creates a deploy token for this machine.
  nash logout                  Remove local credentials.
  nash list                    List repositories on the server.
  nash create <name> [-d txt]  Create a repo on the server; wires the "nas" remote
                               when run inside a git repository.
  nash clone <name> [dir]      Clone a repo from the server.
  nash push                    Push the current branch to the NAS.
  nash backup                  Push all local branches and tags to the NAS.
  nash pull                    Pull the current branch from the NAS.
  nash status                  Show current server + token.

Plain git keeps working as before — nash just wires auth for you.`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'login': await cmdLogin(args[0]); break;
    case 'logout': await cmdLogout(); break;
    case 'list': case 'ls': await cmdList(); break;
    case 'create': case 'new': {
      const dIdx = args.indexOf('-d');
      const description = dIdx !== -1 ? args[dIdx + 1] ?? '' : '';
      const skip = dIdx !== -1 ? [dIdx, dIdx + 1] : [];
      const name = args.find((a, i) => !skip.includes(i) && !a.startsWith('-'));
      await cmdCreate(name, description);
      break;
    }
    case 'clone': cmdClone(args[0], args[1]); break;
    case 'push': cmdPush(); break;
    case 'backup': cmdBackup(); break;
    case 'pull': cmdPull(); break;
    case 'status': cmdStatus(); break;
    case 'cherry': {
      printCherry();
      console.log(cherry('Have a cherry. Your backups are safe.'));
      break;
    }
    case undefined: case 'help': case '--help': case '-h': usage(); break;
    default: fatal(`Unknown command "${cmd}". Run: nash help`);
  }
} catch (err) {
  if (err.message?.startsWith('nash:')) throw err;
  fatal(err.message ?? String(err));
}
