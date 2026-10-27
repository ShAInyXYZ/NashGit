import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dataDir = mkdtempSync(join(tmpdir(), 'nashgit-admin-test-'));
const password = randomBytes(24).toString('hex');
process.env.NASHGIT_DATA_DIR = dataDir;
process.env.NASHGIT_ADMIN_PASSWORD = password;
process.env.NASHGIT_SECRET = randomBytes(32).toString('hex');
const { bootstrapAdmin, verifyAdmin, signSession, verifySession, revokeAdminSessions } = await import('./admin.js');
const { default: db } = await import('../db.js');
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('a login already verifying credentials cannot bypass concurrent session revocation', async () => {
  await bootstrapAdmin();
  const verifying = verifyAdmin('admin', password);
  revokeAdminSessions();
  const claims = await verifying;
  assert.ok(claims);
  assert.equal(verifySession(signSession(claims)), null);
  const fresh = await verifyAdmin('admin', password);
  assert.ok(fresh);
  assert.ok(verifySession(signSession(fresh)));
});
