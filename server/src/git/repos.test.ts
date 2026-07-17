import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'nashgit-repos-test-'));
process.env.NASHGIT_DATA_DIR = dataDir;
process.env.NASHGIT_SECRET = 'test-secret';
process.env.NASHGIT_ADMIN_PASSWORD = 'test-admin';

const {
  REPO_NAME_RE,
  repoPath,
  createRepo,
  getRepo,
  listRepos,
  deleteRepo,
  verifyRepo,
} = await import('./repos.js');

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('REPO_NAME_RE accepts safe names', () => {
  for (const name of ['dotfiles', 'my-app', 'a.b_c', 'A1', 'x', 'project.v2']) {
    assert.ok(REPO_NAME_RE.test(name), `expected "${name}" to be valid`);
  }
});

test('REPO_NAME_RE rejects dangerous names', () => {
  for (const name of ['', '-x', '.x', 'a/b', 'a b', '..', '../etc', 'a\\b', 'a;b', 'a$b']) {
    assert.ok(!REPO_NAME_RE.test(name), `expected "${name}" to be rejected`);
  }
});

test('createRepo makes a bare repo on disk and a DB row', async () => {
  const repo = await createRepo('alpha', 'first repo');
  assert.equal(repo.name, 'alpha');
  assert.equal(repo.description, 'first repo');
  assert.ok(existsSync(join(repoPath('alpha'), 'HEAD')), 'bare repo should exist on disk');

  const fromDb = await getRepo('alpha');
  assert.ok(fromDb);
  assert.equal(fromDb.description, 'first repo');
});

test('createRepo rejects duplicates and invalid names', async () => {
  await createRepo('dupe', '');
  await assert.rejects(() => createRepo('dupe', ''), /already exists/);
  await assert.rejects(() => createRepo('../escape', ''), /Invalid repo name/);
  await assert.rejects(() => createRepo('has space', ''), /Invalid repo name/);
});

test('verifyRepo reports a clean repo as healthy', async () => {
  await createRepo('clean', '');
  const result = await verifyRepo('clean');
  assert.equal(result.ok, true);

  const repo = await getRepo('clean');
  assert.equal(repo?.last_check_ok, 1);
  assert.ok(repo?.last_check_at);
});

test('verifyRepo detects corruption', async () => {
  await createRepo('corrupt', '');
  // Break the main ref so fsck fails.
  writeFileSync(join(repoPath('corrupt'), 'refs', 'heads', 'main'), 'deadbeef');
  const result = await verifyRepo('corrupt');
  assert.equal(result.ok, false);
  assert.ok(result.output.length > 0);

  const repo = await getRepo('corrupt');
  assert.equal(repo?.last_check_ok, 0);
});

test('deleteRepo removes disk + DB and reports unknown repos', async () => {
  await createRepo('gone', '');
  assert.equal(await deleteRepo('gone'), true);
  assert.ok(!existsSync(repoPath('gone')));
  assert.equal(await getRepo('gone'), null);
  assert.equal(await deleteRepo('never-existed'), false);
});

test('listRepos returns all repos sorted by name', async () => {
  const names = (await listRepos()).map((r) => r.name);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted);
});
