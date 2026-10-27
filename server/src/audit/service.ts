import db from '../db.js';
import { scanAudit, type AuditReport, type AuditScope } from './scanner.js';

interface ReportRow { id: number; report_json: string; created_at: string }
const active = new Set<string>();
const MAX_PENDING = 32;
let queue = Promise.resolve();

function key(repoName: string, scope: AuditScope, revision?: string) {
  return `${repoName}\0${scope}\0${revision ?? ''}`;
}

export function latestAudit(repoName: string, scope: AuditScope, revision?: string) {
  const row = (revision
    ? db.prepare('SELECT id, report_json, created_at FROM audit_reports WHERE repo_name = ? AND scope = ? AND revision = ? ORDER BY id DESC LIMIT 1').get(repoName, scope, revision)
    : db.prepare('SELECT id, report_json, created_at FROM audit_reports WHERE repo_name = ? AND scope = ? ORDER BY id DESC LIMIT 1').get(repoName, scope)) as ReportRow | undefined;
  return { running: active.has(key(repoName, scope, revision)), report: row ? { id: row.id, createdAt: row.created_at, ...JSON.parse(row.report_json) as AuditReport } : null };
}

export function latestRepositoryAuditSummary(repoName: string) {
  const row = db.prepare("SELECT report_json FROM audit_reports WHERE repo_name = ? AND scope = 'repository' ORDER BY id DESC LIMIT 1").get(repoName) as { report_json: string } | undefined;
  if (!row) return null;
  const report = JSON.parse(row.report_json) as AuditReport;
  return { status: report.status, findings: report.metrics.findings,
    highRisk: report.metrics.bySeverity.critical + report.metrics.bySeverity.high,
    revision: report.revision, finishedAt: report.finishedAt };
}

export function auditHistory(repoName: string, scope: AuditScope, revision?: string) {
  const rows = (revision
    ? db.prepare('SELECT id, report_json, created_at FROM audit_reports WHERE repo_name = ? AND scope = ? AND revision = ? ORDER BY id DESC LIMIT 20').all(repoName, scope, revision)
    : db.prepare('SELECT id, report_json, created_at FROM audit_reports WHERE repo_name = ? AND scope = ? ORDER BY id DESC LIMIT 20').all(repoName, scope)) as ReportRow[];
  return rows.map((row) => {
    const report = JSON.parse(row.report_json) as AuditReport;
    return { id: row.id, createdAt: row.created_at, revision: report.revision, status: report.status,
      source: report.source, findings: report.metrics.findings, bySeverity: report.metrics.bySeverity,
      scannedFiles: report.metrics.scannedFiles, skippedFiles: report.metrics.skippedFiles };
  });
}

export function auditById(repoName: string, id: number) {
  const row = db.prepare('SELECT id, report_json, created_at FROM audit_reports WHERE repo_name = ? AND id = ?').get(repoName, id) as ReportRow | undefined;
  return row ? { id: row.id, createdAt: row.created_at, ...JSON.parse(row.report_json) as AuditReport } : null;
}

export function queueAudit(repoName: string, scope: AuditScope, revision: string | undefined, source: 'manual' | 'push') {
  const jobKey = key(repoName, scope, revision);
  if (active.has(jobKey)) return 'running' as const;
  if (active.size >= MAX_PENDING) return 'full' as const;
  active.add(jobKey);
  queue = queue.catch(() => {}).then(async () => {
    try {
      const report = await scanAudit(repoName, scope, revision, source);
      db.prepare('INSERT INTO audit_reports (repo_name, scope, revision, source, status, report_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(repoName, scope, report.revision, source, report.status, JSON.stringify(report));
      // Bound metadata growth while retaining enough runs for comparison.
      db.prepare(`DELETE FROM audit_reports WHERE repo_name = ? AND scope = ? AND id NOT IN
        (SELECT id FROM audit_reports WHERE repo_name = ? AND scope = ? ORDER BY id DESC LIMIT 100)`)
        .run(repoName, scope, repoName, scope);
    } catch (error) {
      console.error(`[nashgit] ${scope} audit failed for ${repoName}:`, error);
      const now = new Date().toISOString();
      const failed: AuditReport = {
        rulebookVersion: 1,
        repoName, scope, revision: revision ?? 'unknown', branch: null, status: 'failed', source,
        startedAt: now, finishedAt: now, durationMs: 0,
        summary: 'The audit could not complete. Check the server log and run it again.',
        metrics: { trackedFiles: 0, consideredFiles: 0, scannedFiles: 0, binaryFiles: 0, skippedFiles: 0,
          bytesScanned: 0, duplicateGroups: 0, findings: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, byRule: {} },
        limits: { maxFiles: 2000, maxBlobBytes: 512 * 1024, maxContentBytes: 24 * 1024 * 1024, maxFindings: 500 },
        skipped: [],
        findings: [],
      };
      try {
        db.prepare('INSERT INTO audit_reports (repo_name, scope, revision, source, status, report_json) VALUES (?, ?, ?, ?, ?, ?)')
          .run(repoName, scope, failed.revision, source, failed.status, JSON.stringify(failed));
      } catch (storeError) {
        // A repository may have been moved to trash while its audit was queued.
        console.error(`[nashgit] could not save failed audit for ${repoName}:`, storeError);
      }
    } finally {
      active.delete(jobKey);
    }
  });
  return 'queued' as const;
}
