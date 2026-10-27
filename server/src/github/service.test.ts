import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'nashgit-github-test-'));
const bin = join(root, 'bin');
mkdirSync(bin);
process.env.NASHGIT_DATA_DIR = join(root, 'data');
process.env.TEST_GIT_LOG = join(root, 'git.log');
process.env.TEST_REMOTE_HASH_FILE = join(root, 'remote-hash');
process.env.PATH = `${bin}:${process.env.PATH}`;

const local = 'a'.repeat(40);
const oldRemote = 'b'.repeat(40);
const changedRemote = 'c'.repeat(40);

writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
if (process.argv.slice(2).join(' ') === 'api repos/owner/demo') {
  process.stdout.write(JSON.stringify({ full_name: 'owner/demo', html_url: 'https://github.com/owner/demo', private: true, archived: false, permissions: { push: true }, default_branch: 'main' }));
} else process.exit(1);
`, { mode: 0o755 });

writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GIT_LOG, JSON.stringify(args) + '\\n');
const i = args.indexOf('--git-dir');
const command = i >= 0 ? args[i + 2] : args[0];
if (command === 'check-ref-format') process.exit(0);
if (command === 'rev-parse') { process.stdout.write('${local}\\n'); process.exit(0); }
if (command === 'ls-remote') { const hash = fs.readFileSync(process.env.TEST_REMOTE_HASH_FILE, 'utf8').trim(); if (hash) process.stdout.write(hash + '\\trefs/heads/main\\n'); process.exit(0); }
if (command === 'merge-base') process.exit(process.env.TEST_ANCESTOR === '1' ? 0 : 1);
if (command === 'push') { fs.writeFileSync(process.env.TEST_REMOTE_HASH_FILE, '${local}'); process.exit(0); }
process.exit(1);
`, { mode: 0o755 });

const db = (await import('../db.js')).default;
const { saveLink, preview, syncToGitHub } = await import('./service.js');
db.prepare("INSERT INTO repos (name, description) VALUES ('demo', '')").run();
saveLink('demo', 'owner/demo');

after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

function gitCalls(): string[][] {
  return readFileSync(process.env.TEST_GIT_LOG!, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('sync refuses a changed or divergent GitHub branch before invoking push', async () => {
  process.env.TEST_ANCESTOR = '1';
  writeFileSync(process.env.TEST_REMOTE_HASH_FILE!, oldRemote);
  const first = await preview('demo', 'main');
  assert.equal(first.state, 'ready');
  writeFileSync(process.env.TEST_REMOTE_HASH_FILE!, changedRemote);
  await assert.rejects(syncToGitHub('demo', 'main', first.localHash, first.remoteHash, false), /changed since the preview/);
  process.env.TEST_ANCESTOR = '0';
  const blocked = await preview('demo', 'main');
  assert.equal(blocked.state, 'blocked');
  await assert.rejects(syncToGitHub('demo', 'main', blocked.localHash, blocked.remoteHash, false), /GitHub has commits/);
  assert.equal(gitCalls().filter((args) => args.includes('push')).length, 0);
});

test('sync pins the reviewed hash and verifies GitHub after a non-force push', async () => {
  process.env.TEST_ANCESTOR = '1';
  writeFileSync(process.env.TEST_REMOTE_HASH_FILE!, oldRemote);
  const first = await preview('demo', 'main');
  const result = await syncToGitHub('demo', 'main', first.localHash, first.remoteHash, false);
  assert.equal(result.state, 'current');
  assert.equal(result.remoteHash, local);
  const pushes = gitCalls().filter((args) => args.includes('push'));
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0].slice(-2), ['https://github.com/owner/demo.git', `${local}:refs/heads/main`]);
  assert.equal(pushes[0].includes('--force'), false);
});
