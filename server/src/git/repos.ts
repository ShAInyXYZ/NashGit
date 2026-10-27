import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import db from '../db.js';
import { config } from '../config.js';

const execFileP = promisify(execFile);

// A safe-ish repo name: alnum + dash/dot/underscore, no leading dash.
export const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export function repoPath(name: string): string {
  return join(config.reposDir, `${name}.git`);
}

export interface RepoInfo {
  name: string;
  description: string;
  created_at: string;
  last_push_at: string | null;
  last_check_at: string | null;
  last_check_ok: number | null;
  sizeBytes: number;
  branches: number;
  defaultBranch: string | null;
  latestCommit: { hash: string; subject: string; author: string; authoredAt: string } | null;
}

/** Run a git command against a bare repo, returning trimmed stdout. */
async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', repo, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.toString().trim();
}

/** Directory size in bytes via `du` (async — never block the event loop). */
async function dirSizeBytes(path: string): Promise<number> {
  try {
    const { stdout } = await execFileP('du', ['-sb', path]);
    return Number(stdout.toString().trim().split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

/** Disk usage + branch stats for one repo on disk. */
async function repoStats(path: string): Promise<{
  sizeBytes: number;
  branches: number;
  defaultBranch: string | null;
  latestCommit: { hash: string; subject: string; author: string; authoredAt: string } | null;
}> {
  if (!existsSync(path)) {
    return { sizeBytes: 0, branches: 0, defaultBranch: null, latestCommit: null };
  }
  const sizeBytes = await dirSizeBytes(path);
  let branches = 0;
  let defaultBranch: string | null = null;
  let latestCommit: RepoInfo['latestCommit'] = null;
  // branch count + default branch are best-effort; ignore errors (empty repo)
  try {
    const refs = await git(path, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
    ]);
    const list = refs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    branches = list.length;
    try {
      defaultBranch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
      if (!list.includes(defaultBranch)) defaultBranch = list[0] ?? null;
    } catch {
      defaultBranch = list[0] ?? null;
    }
  } catch {
    /* empty repo */
  }
  try {
    const output = await git(path, ['log', '-1', '--all', '--format=%H%x00%s%x00%an%x00%aI']);
    const [hash, subject, author, authoredAt] = output.split('\0');
    if (hash && authoredAt) latestCommit = { hash, subject, author, authoredAt };
  } catch {
    /* empty repo */
  }
  return { sizeBytes, branches, defaultBranch, latestCommit };
}

interface RepoRow {
  name: string;
  description: string;
  created_at: string;
  last_push_at: string | null;
  last_check_at: string | null;
  last_check_ok: number | null;
}

export async function listRepos(): Promise<RepoInfo[]> {
  const rows = db
    .prepare(
      'SELECT name, description, created_at, last_push_at, last_check_at, last_check_ok FROM repos WHERE deleted_at IS NULL ORDER BY name'
    )
    .all() as RepoRow[];

  return Promise.all(
    rows.map(async (r) => ({
      name: r.name,
      description: r.description,
      created_at: r.created_at,
      last_push_at: r.last_push_at,
      last_check_at: r.last_check_at,
      last_check_ok: r.last_check_ok,
      ...(await repoStats(repoPath(r.name))),
    }))
  );
}

export async function getRepo(name: string): Promise<RepoInfo | null> {
  const row = db
    .prepare(
      'SELECT name, description, created_at, last_push_at, last_check_at, last_check_ok FROM repos WHERE name = ? AND deleted_at IS NULL'
    )
    .get(name) as RepoRow | undefined;
  if (!row) return null;

  return {
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    last_push_at: row.last_push_at,
    last_check_at: row.last_check_at,
    last_check_ok: row.last_check_ok,
    ...(await repoStats(repoPath(row.name))),
  };
}

export async function createRepo(
  name: string,
  description: string
): Promise<RepoInfo> {
  if (!REPO_NAME_RE.test(name)) {
    throw new Error(
      'Invalid repo name. Use letters, numbers, dot, dash, underscore; no leading dash.'
    );
  }
  const path = repoPath(name);
  if (existsSync(path)) {
    throw new Error(`A repo named "${name}" already exists on disk.`);
  }
  const exists = db.prepare('SELECT 1 FROM repos WHERE name = ?').get(name);
  if (exists) {
    throw new Error(`A repo named "${name}" already exists.`);
  }

  await execFileP('git', ['init', '--bare', path]);
  // Set a sensible default branch so the first push works cleanly.
  try {
    await execFileP('git', ['-C', path, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  } catch {
    /* older git may not need this */
  }
  // Enable reflog on bare repos so we can capture from/to hashes on push.
  try {
    await execFileP('git', ['-C', path, 'config', 'core.logAllRefUpdates', 'true']);
    await execFileP('git', ['-C', path, 'config', 'receive.denyNonFastForwards', 'true']);
    await execFileP('git', ['-C', path, 'config', 'receive.denyDeletes', 'true']);
  } catch {
    /* best-effort */
  }

  db.prepare('INSERT INTO repos (name, description) VALUES (?, ?)').run(
    name,
    description || ''
  );

  const created = await getRepo(name);
  if (!created) throw new Error('Failed to create repository record');
  return created;
}

export async function deleteRepo(name: string): Promise<boolean> {
  const row = db.prepare('SELECT name FROM repos WHERE name = ? AND deleted_at IS NULL').get(name);
  if (!row) return false;
  const path = repoPath(name);
  const trashName = `${name}-${randomUUID()}.git`;
  if (!existsSync(path)) throw new Error('Repository data is missing; cannot move it to trash.');
  await rename(path, join(config.trashDir, trashName));
  try {
    db.prepare(`UPDATE repos SET deleted_at = datetime('now'), trash_name = ? WHERE name = ?`).run(trashName, name);
  } catch (error) {
    await rename(join(config.trashDir, trashName), path);
    throw error;
  }
  return true;
}

export function listDeletedRepos(): { name: string; deleted_at: string }[] {
  return db.prepare('SELECT name, deleted_at FROM repos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as { name: string; deleted_at: string }[];
}

export async function restoreRepo(name: string): Promise<boolean> {
  const row = db.prepare('SELECT trash_name FROM repos WHERE name = ? AND deleted_at IS NOT NULL').get(name) as { trash_name: string } | undefined;
  if (!row) return false;
  const source = join(config.trashDir, row.trash_name);
  const destination = repoPath(name);
  if (!existsSync(source)) throw new Error('Repository data is missing from trash.');
  if (existsSync(destination)) throw new Error('A repository already exists at the restore destination.');
  await rename(source, destination);
  try {
    db.prepare('UPDATE repos SET deleted_at = NULL, trash_name = NULL WHERE name = ?').run(name);
  } catch (error) {
    await rename(destination, source);
    throw error;
  }
  return true;
}

export interface PushLogEntry {
  id: number;
  repo_name: string;
  from_hash: string | null;
  to_hash: string | null;
  pushed_by: string | null;
  pushed_at: string;
  ip: string | null;
}

export function getPushLog(name: string, limit = 50): PushLogEntry[] {
  return db
    .prepare(
      `SELECT id, repo_name, from_hash, to_hash, pushed_by, pushed_at, ip
       FROM push_logs WHERE repo_name = ? ORDER BY pushed_at DESC LIMIT ?`
    )
    .all(name, limit) as PushLogEntry[];
}

export function recordPush(opts: {
  repoName: string;
  fromHash: string | null;
  toHash: string | null;
  pushedBy: string;
  ip: string | null;
}): void {
  db.prepare(
    `INSERT INTO push_logs (repo_name, from_hash, to_hash, pushed_by, ip)
     VALUES (?, ?, ?, ?, ?)`
  ).run(opts.repoName, opts.fromHash, opts.toHash, opts.pushedBy, opts.ip);
  db.prepare(
    `UPDATE repos SET last_push_at = datetime('now') WHERE name = ?`
  ).run(opts.repoName);
}

/** Stable ref listing for deciding whether a Git HTTP push changed anything. */
export async function refSnapshot(repoName: string): Promise<string> {
  const path = repoPath(repoName);
  if (!existsSync(path)) return '';
  try {
    return await git(path, ['for-each-ref', '--format=%(refname) %(objectname)']);
  } catch {
    return '';
  }
}

/**
 * Inspect the reflog of a repo after a push to capture what changed.
 * Reads the most recent reflog entry for each branch, returning the newest
 * update's from/to hashes. Returns null if no reflog entries exist.
 */
export async function detectRefChange(
  repoName: string
): Promise<{ from: string | null; to: string | null } | null> {
  const path = repoPath(repoName);
  if (!existsSync(path)) return null;
  try {
    // List all branch refs, then read the latest reflog entry for each.
    const refs = await git(path, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    ]);
    if (!refs) return null;

    let latest: { from: string | null; to: string | null; ts: number } | null = null;

    for (const ref of refs.split('\n').filter(Boolean)) {
      try {
        // reflog format: <old> <new> <committer> <timestamp> <tz>\t<message>
        const entry = await git(path, [
          'reflog',
          '--format=%H %gd %ct',
          '-n',
          '1',
          ref,
        ]);
        if (!entry) continue;
        const [to, _ref, tsStr] = entry.split(' ');
        const ts = Number(tsStr) || 0;

        // Get the previous hash (the "from") — parent reflog entry or parent commit.
        let from: string | null = null;
        try {
          const prev = await git(path, [
            'reflog',
            '--format=%H',
            '-n',
            '1',
            '--skip',
            '1',
            ref,
          ]);
          from = prev || null;
        } catch {
          from = null;
        }

        if (!latest || ts > latest.ts) {
          latest = { from, to, ts };
        }
      } catch {
        /* skip this ref */
      }
    }

    return latest;
  } catch {
    return null;
  }
}

export async function totalDiskUsage(): Promise<number> {
  let total = 0;
  for (const r of await listRepos()) total += r.sizeBytes;
  return total;
}

export interface VerifyResult {
  ok: boolean;
  output: string;
  checkedAt: string;
}

/**
 * Run `git fsck` on a repo to verify backup integrity. Stores the result on
 * the repo row (last_check_at / last_check_ok) and returns it.
 */
export async function verifyRepo(name: string): Promise<VerifyResult> {
  const row = db.prepare('SELECT 1 FROM repos WHERE name = ?').get(name);
  if (!row) throw new Error('Repository not found');

  const path = repoPath(name);
  let ok = true;
  let output = '';
  try {
    // --no-dangling: unpushed stashes/reflog entries are normal, not errors.
    const { stdout, stderr } = await execFileP(
      'git',
      ['-C', path, 'fsck', '--no-dangling', '--strict'],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    output = [stdout, stderr].filter(Boolean).join('\n').trim();
    // fsck prints "notice:" lines (e.g. unborn branch in an empty repo) even on
    // success — only error:/fatal: lines mean real corruption.
    ok = !/^(error|fatal):/im.test(output);
  } catch (err: any) {
    ok = false;
    output = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const checkedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE repos SET last_check_at = ?, last_check_ok = ? WHERE name = ?').run(
    checkedAt,
    ok ? 1 : 0,
    name
  );

  return { ok, output, checkedAt };
}
