import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Full round-trip against a real NashGit server process:
 * login → create repo → create token → git clone → commit → push → pull → verify.
 */

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = mkdtempSync(join(tmpdir(), 'nashgit-e2e-data-'));
const workDir = mkdtempSync(join(tmpdir(), 'nashgit-e2e-work-'));

let server: ChildProcess;
let cookie = '';
let token = '';

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookie,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, res };
}

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start in time');
}

function git(args: string[], cwd: string) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

before(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NASHGIT_DATA_DIR: dataDir,
      NASHGIT_ADMIN_PASSWORD: 'e2e-admin',
      NASHGIT_SECRET: 'e2e-secret-0123456789abcdef',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();
});

after(() => {
  server?.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

test('full backup round-trip', { timeout: 60_000 }, async () => {
  // Login
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'e2e-admin' }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie.includes('nashgit_session='));

  // Wrong password is rejected
  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);

  // Create repo
  const created = await api('/api/repos', {
    method: 'POST',
    body: { name: 'e2e-project', description: 'round trip' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.name, 'e2e-project');

  // Invalid repo name is rejected
  const badRepo = await api('/api/repos', { method: 'POST', body: { name: '../evil' } });
  assert.equal(badRepo.status, 400);

  // Create deploy token
  const tok = await api('/api/tokens', { method: 'POST', body: { name: 'e2e' } });
  assert.equal(tok.status, 201);
  token = tok.data.token;
  assert.ok(token.startsWith('ngt_'));

  // Git endpoints reject unauthenticated requests
  const noAuth = await fetch(`${BASE}/git/e2e-project.git/info/refs?service=git-upload-pack`);
  assert.equal(noAuth.status, 401);

  // Clone with the token
  const remote = `http://x:${token}@localhost:${PORT}/git/e2e-project.git`;
  const cloneDir = join(workDir, 'e2e-project');
  git(['clone', remote, cloneDir], workDir);

  // Commit + push
  writeFileSync(join(cloneDir, 'hello.txt'), 'hello from e2e\n');
  git(['add', '.'], cloneDir);
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', 'commit', '-m', 'hello'], cloneDir);
  git(['push', 'origin', 'HEAD:main'], cloneDir);

  // Server records the push (fire-and-forget — poll until it lands)
  let repo;
  for (let i = 0; i < 20; i++) {
    repo = await api('/api/repos/e2e-project');
    if (repo.data.last_push_at) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(repo.data.branches, 1);
  assert.ok(repo.data.last_push_at, 'last_push_at should be set after push');

  let log;
  for (let i = 0; i < 20; i++) {
    log = await api('/api/repos/e2e-project/log');
    if (log.data.length > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(log.data.length, 1);
  assert.equal(log.data[0].pushed_by, token.slice(0, 12));

  // Fresh clone contains the pushed file
  const clone2 = join(workDir, 'second');
  git(['clone', remote, clone2], workDir);
  assert.ok(existsSync(join(clone2, 'hello.txt')), 'pushed file should exist in a fresh clone');

  // Integrity check passes
  const verify = await api('/api/repos/e2e-project/verify', { method: 'POST' });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.ok, true);
});
