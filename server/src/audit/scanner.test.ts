import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'nashgit-scanner-test-'));
process.env.NASHGIT_DATA_DIR = dir;
const { createRepo, repoPath, getRepo } = await import('../git/repos.js');
const { scanAudit } = await import('./scanner.js');
const { default: db } = await import('../db.js');
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

test('audit reports redact credentials in branch names, including the summary', async () => {
  await createRepo('redaction', '');
  const token = 'ghp_' + 'a1b2c3d4'.repeat(5);
  const branch = `review/${token}`;
  const git = (args: string[], input = '') => execFileSync('git', ['-C', repoPath('redaction'), ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_COMMITTER_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  }).trim();
  const tree = git(['mktree']);
  const hash = git(['commit-tree', tree], 'Test commit\n');
  git(['update-ref', `refs/heads/${branch}`, hash]);
  // HEAD still names unborn main; consumers must select an existing branch.
  assert.equal((await getRepo('redaction'))?.defaultBranch, branch);
  const report = await scanAudit('redaction', 'repository', undefined, 'manual');
  assert.equal(report.status, 'complete');
  assert.equal(report.revision, hash);
  assert.ok(report.summary.includes('[redacted credential]'));
  assert.ok(!JSON.stringify(report).includes(token));
});
