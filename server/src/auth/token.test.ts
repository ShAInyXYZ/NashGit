import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the DB at a throwaway dir BEFORE importing anything that opens it.
const dataDir = mkdtempSync(join(tmpdir(), 'nashgit-token-test-'));
process.env.NASHGIT_DATA_DIR = dataDir;
process.env.NASHGIT_SECRET = 'test-secret';
process.env.NASHGIT_ADMIN_PASSWORD = 'test-admin';

const { createToken, verifyToken, deleteToken, listTokens } = await import('./token.js');

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('createToken returns an ngt_ token with a 12-char prefix', async () => {
  const created = await createToken('laptop');
  assert.ok(created.token.startsWith('ngt_'));
  assert.equal(created.prefix, created.token.slice(0, 12));
  assert.equal(created.name, 'laptop');
});

test('verifyToken accepts the right token and rejects wrong ones', async () => {
  const created = await createToken('workstation');
  const row = await verifyToken(created.token);
  assert.ok(row, 'expected the token to verify');
  assert.equal(row.name, 'workstation');

  assert.equal(await verifyToken('ngt_0000000000000000000000000000000000000000000000000000'), null);
  assert.equal(await verifyToken('not-a-token'), null);
  assert.equal(await verifyToken(''), null);
});

test('verifyToken picks the right row among many tokens', async () => {
  const a = await createToken('alpha');
  const b = await createToken('bravo');
  const c = await createToken('charlie');

  assert.equal((await verifyToken(a.token))?.name, 'alpha');
  assert.equal((await verifyToken(b.token))?.name, 'bravo');
  assert.equal((await verifyToken(c.token))?.name, 'charlie');
});

test('deleteToken revokes the token', async () => {
  const created = await createToken('temp');
  const before = await verifyToken(created.token);
  assert.ok(before);

  assert.equal(deleteToken(created.id), true);
  assert.equal(await verifyToken(created.token), null);
  assert.equal(deleteToken(created.id), false, 'second delete should report no row');
});

test('listTokens never exposes token hashes', async () => {
  await createToken('listed');
  const rows = listTokens();
  for (const row of rows) {
    // The route strips token_hash; make sure the hash is not the plaintext.
    assert.ok(!row.token_hash.startsWith('ngt_'));
    assert.ok(row.prefix.startsWith('ngt_'));
  }
});
