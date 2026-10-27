import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import db from '../db.js';
import { repoPath } from '../git/repos.js';
import { syncState, type PreviewState } from './safety.js';

const runFile = promisify(execFile);
const GITHUB_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const HASH = /^[0-9a-f]{40,64}$/;

export interface GitHubLink {
  repoName: string;
  githubRepo: string;
  linkedAt: string;
  lastSyncedAt: string | null;
  lastSyncedHash: string | null;
}

export interface GitHubRepo {
  nameWithOwner: string;
  description: string;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  canPush: boolean;
}

export interface GitHubPreview {
  repoName: string;
  githubRepo: string;
  branch: string;
  localHash: string;
  remoteHash: string | null;
  state: PreviewState;
  reason: string;
  github: GitHubRepo;
}

export function githubEnabled(): boolean {
  // The local developer server can use this machine's gh login. A NAS process
  // cannot read a browser visitor's desktop credentials, so production is opt-in.
  return process.env.NASHGIT_GITHUB_LOCAL_INTEGRATION === '1' &&
    ['127.0.0.1', 'localhost', '::1'].includes(process.env.NASHGIT_HOST || '');
}

async function command(file: string, args: string[], options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { stdout } = await runFile(file, args, {
    timeout: options.timeout ?? 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: options.env ?? process.env,
  });
  return stdout.toString().trim();
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '!gh auth git-credential',
  };
}

async function git(args: string[], timeout = 20_000): Promise<string> {
  return command('git', args, { timeout, env: gitEnv() });
}

export async function githubAccount(): Promise<{ login: string }> {
  const login = await command('gh', ['api', 'user', '--jq', '.login']);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error('GitHub login is unavailable');
  return { login };
}

export async function availableGitHubRepos(login: string): Promise<GitHubRepo[]> {
  const raw = await command('gh', ['repo', 'list', login, '--limit', '100', '--json',
    'nameWithOwner,description,url,isPrivate,isArchived,defaultBranchRef,viewerPermission']);
  const records = JSON.parse(raw) as any[];
  return records.map((item) => ({
    nameWithOwner: String(item.nameWithOwner),
    description: String(item.description || ''),
    url: String(item.url || ''),
    isPrivate: Boolean(item.isPrivate),
    isArchived: Boolean(item.isArchived),
    defaultBranch: item.defaultBranchRef?.name || null,
    canPush: ['ADMIN', 'MAINTAIN', 'WRITE'].includes(item.viewerPermission),
  })).filter((repo) => GITHUB_REPO.test(repo.nameWithOwner));
}

export async function githubRepo(fullName: string): Promise<GitHubRepo> {
  if (!GITHUB_REPO.test(fullName)) throw new Error('Enter a GitHub repository as owner/name');
  const raw = await command('gh', ['api', `repos/${fullName}`]);
  const item = JSON.parse(raw);
  if (item.full_name?.toLowerCase() !== fullName.toLowerCase()) throw new Error('GitHub repository did not match');
  return {
    nameWithOwner: String(item.full_name),
    description: String(item.description || ''),
    url: String(item.html_url),
    isPrivate: Boolean(item.private),
    isArchived: Boolean(item.archived),
    defaultBranch: item.default_branch || null,
    canPush: Boolean(item.permissions?.push || item.permissions?.admin),
  };
}

export async function createPrivateGitHubRepo(name: string, description: string): Promise<GitHubRepo> {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name.startsWith('-')) {
    throw new Error('Use letters, numbers, dots, dashes, or underscores for the GitHub name');
  }
  if (description.length > 300) throw new Error('Description must be 300 characters or fewer');
  const { login } = await githubAccount();
  if (listLinks().some((link) => link.githubRepo.toLowerCase() === `${login}/${name}`.toLowerCase())) {
    throw new Error('This GitHub repository is already linked to another NashGit backup');
  }
  const raw = await command('gh', ['api', '--method', 'POST', 'user/repos',
    '-f', `name=${name}`, '-f', `description=${description}`, '-F', 'private=true'], { timeout: 30_000 });
  const item = JSON.parse(raw);
  if (!item.private || !GITHUB_REPO.test(item.full_name || '')) throw new Error('GitHub did not confirm a private repository');
  return {
    nameWithOwner: item.full_name, description: String(item.description || ''), url: String(item.html_url || ''),
    isPrivate: true, isArchived: false, defaultBranch: null, canPush: true,
  };
}

export function listLinks(): GitHubLink[] {
  const rows = db.prepare(`SELECT repo_name, github_repo, linked_at, last_synced_at, last_synced_hash
    FROM github_links ORDER BY repo_name`).all() as any[];
  return rows.map((row) => ({
    repoName: row.repo_name, githubRepo: row.github_repo, linkedAt: row.linked_at,
    lastSyncedAt: row.last_synced_at, lastSyncedHash: row.last_synced_hash,
  }));
}

export function getLink(name: string): GitHubLink | null {
  return listLinks().find((link) => link.repoName === name) ?? null;
}

export function saveLink(name: string, fullName: string): void {
  if (listLinks().some((link) => link.repoName !== name && link.githubRepo.toLowerCase() === fullName.toLowerCase())) {
    throw new Error('This GitHub repository is already linked to another NashGit backup');
  }
  db.prepare(`INSERT INTO github_links (repo_name, github_repo) VALUES (?, ?)
    ON CONFLICT(repo_name) DO UPDATE SET github_repo = excluded.github_repo,
    linked_at = datetime('now'), last_synced_at = NULL, last_synced_hash = NULL`).run(name, fullName);
}

export function removeLink(name: string): void {
  db.prepare('DELETE FROM github_links WHERE repo_name = ?').run(name);
}

export async function preview(name: string, branch: string): Promise<GitHubPreview> {
  const link = getLink(name);
  if (!link) throw new Error('Link this NashGit repository to GitHub first');
  const remote = await githubRepo(link.githubRepo);
  if (!remote.canPush) throw new Error('The connected GitHub account cannot push to this repository');
  if (remote.isArchived) throw new Error('This GitHub repository is archived');
  const branchRef = `refs/heads/${branch}`;
  await git(['check-ref-format', branchRef]);
  const localHash = await git(['--git-dir', repoPath(name), 'rev-parse', '--verify', branchRef]);
  if (!HASH.test(localHash)) throw new Error('NashGit branch has no commit');
  const url = `https://github.com/${remote.nameWithOwner}.git`;
  const result = await git(['ls-remote', '--heads', url, branchRef], 30_000);
  const remoteHash = result ? result.split(/\s+/)[0] : null;
  if (remoteHash && !HASH.test(remoteHash)) throw new Error('GitHub returned an invalid branch reference');
  let ancestor = false;
  if (remoteHash && remoteHash !== localHash) {
    try {
      await git(['--git-dir', repoPath(name), 'merge-base', '--is-ancestor', remoteHash, localHash]);
      ancestor = true;
    } catch { /* remote object missing or branches diverged */ }
  }
  return { repoName: name, githubRepo: remote.nameWithOwner, branch, localHash, remoteHash,
    ...syncState(localHash, remoteHash, ancestor), github: remote };
}

const syncing = new Set<string>();

export async function syncToGitHub(name: string, branch: string, expectedLocal: string, expectedRemote: string | null, acknowledgePublic: boolean): Promise<GitHubPreview> {
  if (syncing.has(name)) throw new Error('A GitHub sync is already running for this repository');
  syncing.add(name);
  try {
    const current = await preview(name, branch);
    if (current.localHash !== expectedLocal || current.remoteHash !== expectedRemote) {
      throw new Error('The branches changed since the preview. Refresh before syncing.');
    }
    if (current.state === 'blocked') throw new Error(current.reason);
    if (!current.github.isPrivate && !acknowledgePublic) throw new Error('Confirm that this GitHub repository is public before syncing');
    if (current.state !== 'current') {
      const url = `https://github.com/${current.githubRepo}.git`;
      await git(['--git-dir', repoPath(name), 'push', url, `${current.localHash}:refs/heads/${branch}`], 120_000);
      const pushed = await git(['ls-remote', '--heads', url, `refs/heads/${branch}`], 30_000);
      if (pushed.split(/\s+/)[0] !== current.localHash) throw new Error('Push finished, but GitHub did not report the expected commit');
    }
    db.prepare(`UPDATE github_links SET last_synced_at = datetime('now'), last_synced_hash = ? WHERE repo_name = ?`)
      .run(current.localHash, name);
    return { ...current, state: 'current', remoteHash: current.localHash, reason: 'GitHub has this NashGit commit.' };
  } finally {
    syncing.delete(name);
  }
}
