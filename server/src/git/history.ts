import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repoPath } from './repos.js';

const execFileP = promisify(execFile);
const HASH_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

async function git(repoName: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  const { stdout } = await execFileP('git', ['-C', repoPath(repoName), ...args], {
    encoding: 'utf8',
    maxBuffer,
    timeout: 15_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return stdout;
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authoredAt: string;
  subject: string;
  body: string;
}

function parseCommits(output: string): CommitSummary[] {
  const fields = output.split('\0');
  const commits: CommitSummary[] = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [hash, parents, author, email, authoredAt, message] = fields.slice(i, i + 6);
    if (!HASH_RE.test(hash)) continue;
    const [subject = '', ...rest] = message.replace(/\n$/, '').split('\n');
    commits.push({ hash, parents: parents ? parents.split(' ') : [], author, email, authoredAt, subject, body: rest.join('\n').trim() });
  }
  return commits;
}

const FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%B';

export async function listBranches(repoName: string): Promise<{ name: string; hash: string }[]> {
  const output = await git(repoName, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00', 'refs/heads']);
  const fields = output.split('\0');
  const branches: { name: string; hash: string }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const name = fields[i].trimStart();
    const hash = fields[i + 1].trim();
    if (name && HASH_RE.test(hash)) branches.push({ name, hash });
  }
  return branches;
}

export async function listCommits(repoName: string, branch: string, offset: number, limit: number) {
  const branches = await listBranches(repoName);
  const selected = branches.find((item) => item.name === branch);
  if (!selected) return null;
  const output = await git(repoName, ['log', '-z', `--format=${FORMAT}`, `--max-count=${limit + 1}`, `--skip=${offset}`, `refs/heads/${branch}`]);
  const commits = parseCommits(output);
  return { branch, branches, commits: commits.slice(0, limit), hasMore: commits.length > limit, nextOffset: offset + limit };
}

export async function newlyPushedCommits(repoName: string, from: string | null, to: string, limit = 30) {
  if (!HASH_RE.test(to) || (from && !HASH_RE.test(from))) return { hashes: [], omitted: false };
  const output = await git(repoName, ['rev-list', `--max-count=${limit + 1}`, to, ...(from ? [`^${from}`] : [])]);
  const hashes = output.trim().split('\n').filter((hash) => HASH_RE.test(hash));
  return { hashes: hashes.slice(0, limit).reverse(), omitted: hashes.length > limit };
}

export interface ChangedFile {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
}

async function changedFiles(repoName: string, hash: string, parent?: string): Promise<ChangedFile[]> {
  const base = parent
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', parent, hash]
    : ['diff-tree', '--root', '--no-commit-id', '-r', '--no-renames', hash];
  const [stats, statuses] = await Promise.all([
    git(repoName, [...base, '--numstat', '-z']),
    git(repoName, [...base, '--name-status', '-z']),
  ]);
  const statusByPath = new Map<string, string>();
  const statusFields = statuses.split('\0');
  for (let i = 0; i + 1 < statusFields.length; i += 2) {
    statusByPath.set(statusFields[i + 1], statusFields[i]);
  }
  return stats.split('\0').filter(Boolean).map((entry) => {
    const firstTab = entry.indexOf('\t');
    const secondTab = entry.indexOf('\t', firstTab + 1);
    const added = entry.slice(0, firstTab);
    const deleted = entry.slice(firstTab + 1, secondTab);
    const path = entry.slice(secondTab + 1);
    return { path, status: statusByPath.get(path) ?? 'M', additions: added === '-' ? null : Number(added), deletions: deleted === '-' ? null : Number(deleted) };
  });
}

export async function getCommit(repoName: string, hash: string) {
  if (!HASH_RE.test(hash)) return null;
  try {
    const output = await git(repoName, ['show', '-s', '-z', `--format=${FORMAT}`, hash]);
    const commit = parseCommits(output)[0];
    if (!commit) return null;
    const files = await changedFiles(repoName, hash, commit.parents[0]);
    return {
      ...commit,
      files,
      additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    };
  } catch {
    return null;
  }
}

export async function getFileDiff(repoName: string, hash: string, path: string) {
  const commit = await getCommit(repoName, hash);
  if (!commit || !commit.files.some((file) => file.path === path)) return null;
  const pathspec = `:(literal)${path}`;
  const args = commit.parents[0]
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', commit.parents[0], hash, '--', pathspec]
    : ['diff-tree', '--root', '--no-commit-id', '-r', '-p', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', hash, '--', pathspec];
  try {
    return { path, patch: await git(repoName, args, 1024 * 1024), truncated: false };
  } catch (error: any) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { path, patch: '', truncated: true };
    throw error;
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export async function getImageAtCommit(repoName: string, hash: string, path: string, version: 'before' | 'after') {
  const commit = await getCommit(repoName, hash);
  const file = commit?.files.find((item) => item.path === path);
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (!commit || !file || !IMAGE_TYPES[extension]) return null;
  const revision = version === 'before' ? commit.parents[0] : hash;
  if (!revision || (version === 'before' && file.status === 'A') || (version === 'after' && file.status === 'D')) return null;
  const spec = `${revision}:${path}`;
  try {
    const size = Number((await git(repoName, ['cat-file', '-s', spec])).trim());
    if (!Number.isFinite(size) || size > 8 * 1024 * 1024) return { tooLarge: true as const };
    const { stdout } = await execFileP('git', ['-C', repoPath(repoName), 'cat-file', 'blob', spec], {
      encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 15_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    });
    return { data: stdout as Buffer, contentType: IMAGE_TYPES[extension], tooLarge: false as const };
  } catch {
    return null;
  }
}

export { HASH_RE };
