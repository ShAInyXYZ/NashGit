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
	sizeBytes: number;
	branches: number;
	defaultBranch: string | null;
	clone_url: string;
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

export interface Settings {
	admin: { username: string; created_at: string };
	dataDir: string;
	publicUrl: string | null;
}

// ---- API surface -----------------------------------------------------------

export const api = {
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
		log: (name: string) =>
			request<PushLogEntry[]>(`/api/repos/${encodeURIComponent(name)}/log`)
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
