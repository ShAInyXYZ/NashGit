// Thin fetch wrapper for the NashGit API. All requests are same-origin (the
// Express server serves both API and client), so we use relative URLs and
// rely on the httpOnly session cookie for auth.

export class ApiError extends Error {
	status: number;
	body: any;
	constructor(status: number, message: string, body?: any) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	path: string,
	opts: { method?: string; body?: any } = {}
): Promise<T> {
	const res = await fetch(path, {
		method: opts.method ?? 'GET',
		headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
		credentials: 'same-origin'
	});
	const text = await res.text();
	let data: any = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		throw new ApiError(res.status, data?.error || res.statusText || text || 'Request failed', data);
	}
	return data as T;
}

// ---- Types -----------------------------------------------------------------

export interface Repo {
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
	audit_summary: { status: 'complete' | 'partial' | 'failed'; findings: number; highRisk: number; revision: string; finishedAt: string } | null;
	clone_url: string;
}

export interface VerifyResult {
	ok: boolean;
	output: string;
	checkedAt: string;
}

export interface DeletedRepo {
	name: string;
	deleted_at: string;
}

export interface Token {
	id: number;
	name: string;
	prefix: string;
	created_at: string;
	last_used_at: string | null;
}

export interface CreatedToken extends Token {
	token: string;
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

export interface BranchRef { name: string; hash: string }
export interface CommitSummary {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	authoredAt: string;
	subject: string;
	body: string;
}
export interface CommitPage {
	branch: string | null;
	branches: BranchRef[];
	commits: CommitSummary[];
	hasMore: boolean;
	nextOffset: number;
}
export interface ChangedFile {
	path: string;
	status: string;
	additions: number | null;
	deletions: number | null;
}
export interface CommitDetail extends CommitSummary {
	files: ChangedFile[];
	additions: number;
	deletions: number;
}
export interface FileDiff { path: string; patch: string; truncated: boolean }
export interface CommitNote { id: number; body: string; author: string; created_at: string }
export type AuditScope = 'repository' | 'commit';
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';
export interface AuditRule { id: string; title: string; category: string; severity: AuditSeverity; why: string; action: string }
export interface AuditFinding { ruleId: string; severity: AuditSeverity; category: string; title: string; path: string; line: number | null; relatedPaths?: string[] }
export interface AuditReport {
	id: number; createdAt: string; rulebookVersion: number; repoName: string; scope: AuditScope; revision: string; branch: string | null;
	status: 'complete' | 'partial' | 'failed'; source: 'manual' | 'push'; startedAt: string; finishedAt: string;
	durationMs: number; summary: string;
	metrics: { trackedFiles: number; consideredFiles: number; scannedFiles: number; binaryFiles: number; skippedFiles: number;
		bytesScanned: number; duplicateGroups: number; findings: number; bySeverity: Record<AuditSeverity, number>; byRule: Record<string, number> };
	limits: { maxFiles: number; maxBlobBytes: number; maxContentBytes: number; maxFindings: number };
	skipped: { path: string; reason: string; bytes: number }[];
	findings: AuditFinding[];
}
export interface AuditState { running: boolean; report: AuditReport | null }
export interface AuditHistoryEntry { id: number; createdAt: string; revision: string; status: AuditReport['status']; source: AuditReport['source']; findings: number; bySeverity: Record<AuditSeverity, number>; scannedFiles: number; skippedFiles: number }

export interface Settings {
	admin: { username: string; created_at: string };
	dataDir: string;
	publicUrl: string | null;
}

export interface GitHubStatus { enabled: boolean; connected: boolean; account: { login: string } | null; message?: string }
export interface GitHubRepo { nameWithOwner: string; description: string; url: string; isPrivate: boolean; isArchived: boolean; defaultBranch: string | null; canPush: boolean }
export interface GitHubLink { repoName: string; githubRepo: string; linkedAt: string; lastSyncedAt: string | null; lastSyncedHash: string | null }
export interface GitHubPreview { repoName: string; githubRepo: string; branch: string; localHash: string; remoteHash: string | null;
	state: 'ready' | 'current' | 'new-branch' | 'blocked'; reason: string; github: GitHubRepo }

// ---- API surface -----------------------------------------------------------

export const api = {
	github: {
		status: () => request<GitHubStatus>('/api/github/status'),
		available: () => request<GitHubRepo[]>('/api/github/available'),
		links: () => request<GitHubLink[]>('/api/github/links'),
		link: (name: string, githubRepo: string) => request<GitHubLink>(`/api/github/links/${encodeURIComponent(name)}`, { method: 'PUT', body: { githubRepo } }),
		createPrivate: (name: string, githubName: string, description: string) =>
			request<{ repo: GitHubRepo; link: GitHubLink }>(`/api/github/repos/${encodeURIComponent(name)}/create-private`, { method: 'POST', body: { name: githubName, description } }),
		unlink: (name: string) => request<{ ok: true }>(`/api/github/links/${encodeURIComponent(name)}`, { method: 'DELETE' }),
		preview: (name: string) => request<GitHubPreview>(`/api/github/repos/${encodeURIComponent(name)}/preview`),
		sync: (name: string, expectedLocal: string, expectedRemote: string | null, acknowledgePublic: boolean) =>
			request<GitHubPreview>(`/api/github/repos/${encodeURIComponent(name)}/sync`, { method: 'POST', body: { expectedLocal, expectedRemote, acknowledgePublic } })
	},
	auth: {
		login: (username: string, password: string) =>
			request<{ ok: true }>('/api/auth/login', { method: 'POST', body: { username, password } }),
		logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
		me: () => request<{ authenticated: boolean; username?: string }>('/api/auth/me')
	},
	repos: {
		list: () => request<Repo[]>('/api/repos'),
		get: (name: string) => request<Repo>(`/api/repos/${encodeURIComponent(name)}`),
		create: (name: string, description: string) =>
			request<Repo>('/api/repos', { method: 'POST', body: { name, description } }),
		remove: (name: string) =>
			request<{ ok: true }>(`/api/repos/${encodeURIComponent(name)}`, { method: 'DELETE' }),
		trash: () => request<DeletedRepo[]>('/api/repos/trash'),
		restore: (name: string) =>
			request<{ ok: true }>(`/api/repos/trash/${encodeURIComponent(name)}/restore`, { method: 'POST' }),
		log: (name: string) =>
			request<PushLogEntry[]>(`/api/repos/${encodeURIComponent(name)}/log`),
		commits: (name: string, branch?: string, offset = 0) =>
			request<CommitPage>(`/api/repos/${encodeURIComponent(name)}/commits?${new URLSearchParams({ ...(branch ? { branch } : {}), offset: String(offset) })}`),
		commit: (name: string, hash: string) =>
			request<CommitDetail>(`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}`),
		diff: (name: string, hash: string, path: string) =>
			request<FileDiff>(`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}/diff?${new URLSearchParams({ path })}`),
		imageUrl: (name: string, hash: string, path: string, version: 'before' | 'after') =>
			`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}/image?${new URLSearchParams({ path, version })}`,
		notes: (name: string, hash: string) =>
			request<CommitNote[]>(`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}/notes`),
		addNote: (name: string, hash: string, body: string) =>
			request<CommitNote>(`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}/notes`, { method: 'POST', body: { body } }),
		removeNote: (name: string, hash: string, id: number) =>
			request<{ ok: true }>(`/api/repos/${encodeURIComponent(name)}/commits/${encodeURIComponent(hash)}/notes/${id}`, { method: 'DELETE' }),
		auditRules: (name: string) => request<AuditRule[]>(`/api/repos/${encodeURIComponent(name)}/audit/rules`),
		audit: (name: string, scope: AuditScope, commit?: string) =>
			request<AuditState>(`/api/repos/${encodeURIComponent(name)}/audit?${new URLSearchParams({ scope, ...(commit ? { commit } : {}) })}`),
		auditHistory: (name: string, scope: AuditScope, commit?: string) =>
			request<AuditHistoryEntry[]>(`/api/repos/${encodeURIComponent(name)}/audit/history?${new URLSearchParams({ scope, ...(commit ? { commit } : {}) })}`),
		auditReport: (name: string, id: number) => request<AuditReport>(`/api/repos/${encodeURIComponent(name)}/audit/reports/${id}`),
		runAudit: (name: string, scope: AuditScope, commit?: string) =>
			request<{ queued: boolean; running: boolean }>(`/api/repos/${encodeURIComponent(name)}/audit`, { method: 'POST', body: { scope, ...(commit ? { commit } : {}) } }),
		verify: (name: string) =>
			request<VerifyResult>(`/api/repos/${encodeURIComponent(name)}/verify`, { method: 'POST' })
	},
	tokens: {
		list: () => request<Token[]>('/api/tokens'),
		create: (name: string) =>
			request<CreatedToken>('/api/tokens', { method: 'POST', body: { name } }),
		remove: (id: number) =>
			request<{ ok: true }>(`/api/tokens/${id}`, { method: 'DELETE' })
	},
	settings: {
		get: () => request<Settings>('/api/settings'),
		changePassword: (currentPassword: string, newPassword: string) =>
			request<{ ok: true }>('/api/settings/password', {
				method: 'POST',
				body: { currentPassword, newPassword }
			})
	}
};

// ---- Formatting helpers ----------------------------------------------------

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function relativeTime(iso: string | null): string {
	if (!iso) return 'never';
	const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
	const diff = Date.now() - d.getTime();
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day}d ago`;
	const mo = Math.floor(day / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.floor(mo / 12)}y ago`;
}

export function shortHash(hash: string | null): string {
	if (!hash) return '—';
	return hash.slice(0, 7);
}

// ---- Freshness ---------------------------------------------------------------

export type Freshness = 'fresh' | 'ripe' | 'stale' | 'withered' | 'unknown';

/**
 * How alive is this backup? Based on time since last push.
 * fresh < 1 day · ripe < 7 days · stale < 30 days · withered beyond that.
 */
export function freshness(iso: string | null): Freshness {
	if (!iso) return 'unknown';
	const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
	const days = (Date.now() - d.getTime()) / 86_400_000;
	if (days < 1) return 'fresh';
	if (days < 7) return 'ripe';
	if (days < 30) return 'stale';
	return 'withered';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
	fresh: 'Fresh',
	ripe: 'Ripe',
	stale: 'Getting stale',
	withered: 'Withered — push soon',
	unknown: 'Never pushed'
};
