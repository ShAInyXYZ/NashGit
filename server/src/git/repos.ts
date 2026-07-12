import { execFile, execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
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
  sizeBytes: number;
  branches: number;
  defaultBranch: string | null;
}

/** Run a git command against a bare repo, returning trimmed stdout. */
async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', repo, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.toString().trim();
}

/** Synchronous directory size in bytes via `du`. */
function dirSizeBytes(path: string): number {
  try {
    const out = execFileSync('du', ['-sb', path], { encoding: 'utf8' });
    return Number(out.split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

export function listRepos(): RepoInfo[] {
  const rows = db
    .prepare('SELECT name, description, created_at, last_push_at FROM repos ORDER BY name')
    .all() as {
    name: string;
    description: string;
    created_at: string;
    last_push_at: string | null;
  }[];

  return rows.map((r) => {
    const path = repoPath(r.name);
    let sizeBytes = 0;
    let branches = 0;
    let defaultBranch: string | null = null;
    if (existsSync(path)) {
      sizeBytes = dirSizeBytes(path);
      // branch count + default branch are best-effort; ignore errors (empty repo)
      try {
        const refs = execFileSync(
          'git',
          ['-C', path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
          { encoding: 'utf8' }
        );
        const list = refs
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        branches = list.length;
        defaultBranch = list[0] ?? null;
      } catch {
        /* empty repo */
      }
    }
    return {
      name: r.name,
      description: r.description,
      created_at: r.created_at,
      last_push_at: r.last_push_at,
      sizeBytes,
      branches,
      defaultBranch,
    };
  });
}

export function getRepo(name: string): RepoInfo | null {
  const row = db
    .prepare('SELECT 1 FROM repos WHERE name = ?')
    .get(name) as { 1: number } | undefined;
  if (!row) return null;
  return listRepos().find((r) => r.name === name) ?? null;
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

  db.prepare('INSERT INTO repos (name, description) VALUES (?, ?)').run(
    name,
    description || ''
  );

  const created = getRepo(name);
  if (!created) throw new Error('Failed to create repository record');
  return created;
}

export async function deleteRepo(name: string): Promise<boolean> {
  const row = db.prepare('SELECT name FROM repos WHERE name = ?').get(name);
  if (!row) return false;
  const path = repoPath(name);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  db.prepare('DELETE FROM repos WHERE name = ?').run(name);
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

/**
 * Inspect the reflog of a repo after a push to capture what changed.
 * Returns the most recent ref update, or null if nothing useful is found.
 */
export async function detectRefChange(
  repoName: string
): Promise<{ from: string | null; to: string | null } | null> {
  const path = repoPath(repoName);
  if (!existsSync(path)) return null;
  try {
    const out = await git(path, ['reflog', '--format=%H', '-n', '1']);
    if (!out) return null;
    const to = out.split('\n')[0];
    let from: string | null = null;
    try {
      from = await git(path, ['rev-parse', `${to}^`]);
    } catch {
      from = null;
    }
    return { from, to };
  } catch {
    return null;
  }
}

export function totalDiskUsage(): number {
  let total = 0;
  for (const r of listRepos()) total += r.sizeBytes;
  return total;
}
