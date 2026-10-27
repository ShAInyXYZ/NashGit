import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getCommit, HASH_RE, listBranches } from '../git/history.js';
import { repoPath } from '../git/repos.js';
import { contentRules, finding, pathRules, redactKnownCredentials, type Finding, type Severity } from './rules.js';

const execFileP = promisify(execFile);
const MAX_FILES = 2_000;
const MAX_CONTENT_BYTES = 24 * 1024 * 1024;
const MAX_BLOB_BYTES = 512 * 1024;
const MAX_FINDINGS = 500;
const COUNTS = { critical: 0, high: 0, medium: 0, low: 0 };

export type AuditScope = 'repository' | 'commit';
export interface AuditReport {
  rulebookVersion: number;
  repoName: string;
  scope: AuditScope;
  revision: string;
  branch: string | null;
  status: 'complete' | 'partial' | 'failed';
  source: 'manual' | 'push';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: string;
  metrics: {
    trackedFiles: number;
    consideredFiles: number;
    scannedFiles: number;
    binaryFiles: number;
    skippedFiles: number;
    bytesScanned: number;
    duplicateGroups: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    byRule: Record<string, number>;
  };
  limits: { maxFiles: number; maxBlobBytes: number; maxContentBytes: number; maxFindings: number };
  skipped: { path: string; reason: string; bytes: number }[];
  findings: Finding[];
}

interface TreeFile { path: string; oid: string; bytes: number; mode: string }

async function git(repoName: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<Buffer> {
  const { stdout } = await execFileP('git', ['-C', repoPath(repoName), ...args], {
    encoding: 'buffer', maxBuffer, timeout: 20_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' },
  });
  return stdout as Buffer;
}

async function treeFiles(repoName: string, revision: string): Promise<TreeFile[]> {
  const output = (await git(repoName, ['ls-tree', '-r', '-l', '-z', revision])).toString('utf8');
  return output.split('\0').filter(Boolean).flatMap((entry) => {
    const tab = entry.indexOf('\t');
    if (tab < 0) return [];
    const [mode, kind, oid, size] = entry.slice(0, tab).trim().split(/\s+/);
    if (kind !== 'blob' || !HASH_RE.test(oid)) return [];
    return [{ mode, oid, bytes: Number(size), path: entry.slice(tab + 1) }];
  });
}

export async function scanAudit(repoName: string, scope: AuditScope, requestedHash: string | undefined, source: 'manual' | 'push'): Promise<AuditReport> {
  const start = Date.now();
  const branches = await listBranches(repoName);
  const defaultBranch = (await git(repoName, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => Buffer.from(''))).toString('utf8').trim();
  const branch = branches.find((item) => item.name === defaultBranch) ?? branches[0];
  const revision = scope === 'repository' ? branch?.hash : requestedHash;
  if (!revision || !HASH_RE.test(revision)) throw new Error('No commit available for this audit');
  const commit = scope === 'commit' ? await getCommit(repoName, revision) : null;
  if (scope === 'commit' && !commit) throw new Error('Commit not found');

  const allFiles = await treeFiles(repoName, revision);
  const changed = scope === 'commit' ? new Set(commit!.files.filter((file) => file.status !== 'D').map((file) => file.path)) : null;
  const candidates = changed ? allFiles.filter((file) => changed.has(file.path)) : allFiles;
  const findings: Finding[] = [];
  const byRule: Record<string, number> = {};
  const bySeverity: Record<Severity, number> = { ...COUNTS };
  let scannedFiles = 0;
  let binaryFiles = 0;
  let skippedFiles = 0;
  let bytesScanned = 0;
  let duplicateGroups = 0;
  let partial = false;
  const skipped: AuditReport['skipped'] = [];

  function add(item: Finding) {
    if (findings.length >= MAX_FINDINGS) { partial = true; return; }
    findings.push(item);
    byRule[item.ruleId] = (byRule[item.ruleId] ?? 0) + 1;
    bySeverity[item.severity]++;
  }

  // Git object IDs identify byte-for-byte duplicates without reading file content.
  // For a commit audit, only report groups that include a changed path.
  const byOid = new Map<string, TreeFile[]>();
  for (const file of allFiles) {
    if (file.bytes < 128 || file.path.endsWith('.meta')) continue;
    const list = byOid.get(file.oid) ?? [];
    list.push(file);
    byOid.set(file.oid, list);
  }
  for (const group of byOid.values()) {
    if (group.length < 2 || (changed && !group.some((file) => changed.has(file.path)))) continue;
    duplicateGroups++;
    const primary = changed ? group.find((file) => changed.has(file.path))! : group[0];
    add(finding('DUP-001', primary.path, null, group.filter((file) => file.path !== primary.path).slice(0, 7).map((file) => file.path)));
  }

  if (scope === 'commit') {
    for (const item of contentRules('@commit-message', `${commit!.subject}\n${commit!.body}`)) add(item);
  }

  for (let index = 0; index < candidates.length; index++) {
    const file = candidates[index];
    if (index >= MAX_FILES) {
      skippedFiles += candidates.length - index;
      for (const remaining of candidates.slice(index, index + 50)) skipped.push({ path: redactKnownCredentials(remaining.path), reason: 'File-count limit', bytes: remaining.bytes });
      partial = true; break;
    }
    for (const item of pathRules(file.path, file.bytes)) add(item);
    if (file.bytes > MAX_BLOB_BYTES || bytesScanned + file.bytes > MAX_CONTENT_BYTES) {
      skippedFiles++;
      if (skipped.length < 50) skipped.push({ path: redactKnownCredentials(file.path), reason: file.bytes > MAX_BLOB_BYTES ? 'File size limit' : 'Total content limit', bytes: file.bytes });
      partial = true;
      continue;
    }
    try {
      const body = await git(repoName, ['cat-file', 'blob', file.oid], MAX_BLOB_BYTES + 1024);
      if (body.includes(0)) { binaryFiles++; continue; }
      bytesScanned += body.length;
      scannedFiles++;
      for (const item of contentRules(file.path, body.toString('utf8'))) add(item);
    } catch {
      skippedFiles++;
      if (skipped.length < 50) skipped.push({ path: redactKnownCredentials(file.path), reason: 'Could not read Git blob', bytes: file.bytes });
      partial = true;
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    rulebookVersion: 1,
    repoName, scope, revision, branch: branch ? redactKnownCredentials(branch.name) : null,
    status: partial ? 'partial' : 'complete', source,
    startedAt: new Date(start).toISOString(), finishedAt, durationMs: Date.now() - start,
    summary: scope === 'repository'
      ? `Current tracked files on ${redactKnownCredentials(branch?.name ?? 'default branch')} at ${revision.slice(0, 12)}. Git history and other branches are not exhaustively scanned.`
      : `Changed files and message of commit ${revision.slice(0, 12)}; exact duplicates checked against its full tree. Deleted content is not scanned.`,
    metrics: {
      trackedFiles: allFiles.length, consideredFiles: candidates.length, scannedFiles, binaryFiles, skippedFiles,
      bytesScanned, duplicateGroups, findings: findings.length, bySeverity, byRule,
    },
    limits: { maxFiles: MAX_FILES, maxBlobBytes: MAX_BLOB_BYTES, maxContentBytes: MAX_CONTENT_BYTES, maxFindings: MAX_FINDINGS },
    skipped,
    findings,
  };
}
