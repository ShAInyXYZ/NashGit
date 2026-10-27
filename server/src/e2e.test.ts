import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
const askpassFile = join(serverDir, '..', 'cli', 'askpass.mjs');

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
  return execFileSync('git', ['-c', 'credential.helper=', '-c', 'credential.useHttpPath=true', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', HOME: workDir, GIT_ASKPASS: askpassFile, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null' },
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

  // A password change revokes earlier admin sessions.
  const changed = await api('/api/settings/password', {
    method: 'POST',
    body: { currentPassword: 'e2e-admin', newPassword: 'e2e-admin-new' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await api('/api/repos')).status, 401);
  const relogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'e2e-admin-new' }),
  });
  assert.equal(relogin.status, 200);
  cookie = relogin.headers.get('set-cookie')?.split(';')[0] ?? '';

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
  const configDir = join(workDir, '.config', 'nashgit');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ server: BASE, token }), { mode: 0o600 });

  // Git endpoints reject unauthenticated requests
  const noAuth = await fetch(`${BASE}/git/e2e-project.git/info/refs?service=git-upload-pack`);
  assert.equal(noAuth.status, 401);

  // Clone with the token
  const remote = `${BASE}/git/e2e-project.git`;
  const cloneDir = join(workDir, 'e2e-project');
  git(['clone', remote, cloneDir], workDir);

  // Commit + push
  writeFileSync(join(cloneDir, 'hello.txt'), 'hello from e2e\n');
  writeFileSync(join(cloneDir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(join(cloneDir, '.env'), 'password = "supersecretvalue123"\n');
  mkdirSync(join(cloneDir, 'copies'));
  writeFileSync(join(cloneDir, 'copies', 'first.txt'), 'identical development fixture\n'.repeat(8));
  writeFileSync(join(cloneDir, 'copies', 'second.txt'), 'identical development fixture\n'.repeat(8));
  mkdirSync(join(cloneDir, '.cache'));
  writeFileSync(join(cloneDir, '.cache', 'session.tmp'), 'generated cache\n');
  writeFileSync(join(cloneDir, 'oversized.txt'), 'x'.repeat(600 * 1024));
  git(['add', '.'], cloneDir);
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', 'commit', '-m', 'hello'], cloneDir);
  git(['push', 'origin', 'HEAD:main'], cloneDir);

  // A backup must not be rewritten or deleted through Git HTTP.
  writeFileSync(join(cloneDir, 'hello.txt'), 'second version\n');
  git(['commit', '-am', 'second'], cloneDir);
  writeFileSync(join(cloneDir, 'batch.txt'), 'another commit in the same push\n');
  git(['add', 'batch.txt'], cloneDir);
  git(['commit', '-m', 'third'], cloneDir);
  git(['push', 'origin', 'HEAD:main'], cloneDir);
  git(['reset', '--hard', 'HEAD~1'], cloneDir);
  assert.throws(() => git(['push', '--force', 'origin', 'HEAD:main'], cloneDir));
  assert.throws(() => git(['push', 'origin', ':main'], cloneDir));

  // Browse actual Git commits and their changed files, then leave an admin note.
  const history = await api('/api/repos/e2e-project/commits?branch=main');
  assert.equal(history.status, 200);
  assert.equal(history.data.commits.length, 3);
  assert.equal(history.data.commits[0].subject, 'third');
  const commitHash = history.data.commits[1].hash;
  const detail = await api(`/api/repos/e2e-project/commits/${commitHash}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.files[0].path, 'hello.txt');
  assert.equal(detail.data.files[0].additions, 1);
  const diff = await api(`/api/repos/e2e-project/commits/${commitHash}/diff?path=hello.txt`);
  assert.equal(diff.status, 200);
  assert.match(diff.data.patch, /second version/);
  const note = await api(`/api/repos/e2e-project/commits/${commitHash}/notes`, { method: 'POST', body: { body: 'Reviewed backup' } });
  assert.equal(note.status, 201);
  assert.equal((await api(`/api/repos/e2e-project/commits/${commitHash}/notes`)).data[0].body, 'Reviewed backup');
  assert.equal((await api(`/api/repos/e2e-project/commits/${commitHash}/notes/${note.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api('/api/repos/e2e-project/commits?branch=--bad')).status, 400);
  const firstHash = history.data.commits[2].hash;
  const imageResponse = await fetch(`${BASE}/api/repos/e2e-project/commits/${firstHash}/image?path=pixel.png&version=after`, { headers: { Cookie: cookie } });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.ok((await imageResponse.arrayBuffer()).byteLength > 0);
  assert.equal((await api(`/api/repos/e2e-project/commits/${firstHash}/image?path=hello.txt&version=after`)).status, 404);

  // Automatic repository report follows a successful push without blocking Git.
  let automatic: any;
  for (let i = 0; i < 40; i++) {
    automatic = (await api('/api/repos/e2e-project/audit?scope=repository')).data;
    if (automatic.report && !automatic.running) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(automatic.report.source, 'push');
  assert.equal(automatic.report.status, 'partial');
  assert.ok(automatic.report.skipped.some((item: { path: string }) => item.path === 'oversized.txt'));
  assert.ok(automatic.report.metrics.scannedFiles >= 4);
  assert.ok(automatic.report.metrics.byRule['SEC-003'] >= 1);
  assert.ok(automatic.report.metrics.byRule['DUP-001'] >= 1);
  assert.ok(automatic.report.metrics.byRule['NOISE-001'] >= 1);
  assert.ok(!JSON.stringify(automatic.report).includes('supersecretvalue123'), 'report must not contain matched values');

  // Both commits in the second push should receive automatic reports.
  for (const hash of [history.data.commits[0].hash, history.data.commits[1].hash]) {
    let result: any;
    for (let i = 0; i < 40; i++) {
      result = (await api(`/api/repos/e2e-project/audit?scope=commit&commit=${hash}`)).data;
      if (result.report && !result.running) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(result.report.source, 'push');
  }

  const startCommitAudit = await api('/api/repos/e2e-project/audit', { method: 'POST', body: { scope: 'commit', commit: firstHash } });
  assert.equal(startCommitAudit.status, 202);
  let commitAudit: any;
  for (let i = 0; i < 40; i++) {
    commitAudit = (await api(`/api/repos/e2e-project/audit?scope=commit&commit=${firstHash}`)).data;
    if (commitAudit.report && !commitAudit.running) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(commitAudit.report.scope, 'commit');
  assert.ok(commitAudit.report.metrics.byRule['SEC-002'] >= 1);
  assert.ok(!JSON.stringify(commitAudit.report).includes('supersecretvalue123'));
  assert.equal((await api('/api/repos/e2e-project/audit/rules')).data.length, 10);
  const historyReports = await api('/api/repos/e2e-project/audit/history?scope=repository');
  assert.equal(historyReports.status, 200);
  assert.ok(historyReports.data.length >= 1);
  const savedReport = await api(`/api/repos/e2e-project/audit/reports/${historyReports.data[0].id}`);
  assert.equal(savedReport.status, 200);
  assert.equal(savedReport.data.metrics.findings, automatic.report.metrics.findings);

  // Server records the push (fire-and-forget — poll until it lands)
  let repo: Awaited<ReturnType<typeof api>> | undefined;
  for (let i = 0; i < 20; i++) {
    repo = await api('/api/repos/e2e-project');
    if (repo.data.last_push_at) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(repo);
  assert.equal(repo.data.branches, 1);
  assert.ok(repo.data.last_push_at, 'last_push_at should be set after push');
  assert.ok(repo.data.audit_summary?.findings >= 1, 'repository summary should surface audit findings');
  assert.ok((await api('/api/repos')).data[0].audit_summary.highRisk >= 1);

  let log: Awaited<ReturnType<typeof api>> | undefined;
  for (let i = 0; i < 20; i++) {
    log = await api('/api/repos/e2e-project/log');
    if (log.data.length >= 2) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(log);
  assert.equal(log.data.length, 2);
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
