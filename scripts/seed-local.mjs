#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localDir = join(root, '.local-dev');
const source = resolve(process.argv[2] ?? '');
const name = process.argv[3] ?? basename(source);

if (!process.argv[2] || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
	console.error('Usage: npm run seed:local -- /path/to/local/git/repository [NashGitName]');
	process.exit(1);
}
if (!existsSync(join(source, '.git'))) {
	console.error('Source must be a local Git working tree.');
	process.exit(1);
}

const credentials = JSON.parse(readFileSync(join(localDir, 'credentials.json'), 'utf8'));
const base = 'http://127.0.0.1:4300';
const login = await fetch(`${base}/api/auth/login`, {
	method: 'POST', headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: credentials.username, password: credentials.password })
});
if (!login.ok) throw new Error(`Local admin login failed (${login.status}). Is npm run dev:local running?`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Local login returned no session cookie');

const repoResponse = await fetch(`${base}/api/repos/${encodeURIComponent(name)}`, { headers: { Cookie: cookie } });
if (repoResponse.status === 404) {
	const create = await fetch(`${base}/api/repos`, {
		method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, description: 'Local development mirror' })
	});
	if (!create.ok) throw new Error(`Could not create local repository (${create.status})`);
} else if (!repoResponse.ok) {
	throw new Error(`Could not inspect local repository (${repoResponse.status})`);
}

const destination = join(localDir, 'data', 'repos', `${name}.git`);
const branch = execFileSync('git', ['-C', source, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
function tip() {
	try { return execFileSync('git', ['--git-dir', destination, 'rev-parse', '--verify', `refs/heads/${branch}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
	catch { return null; }
}
const before = tip();
const temporary = mkdtempSync(join(localDir, 'seed-'));
try {
	const mirror = join(temporary, 'source.git');
	execFileSync('git', ['clone', '--bare', '--no-hardlinks', source, mirror], { stdio: 'inherit' });
	execFileSync('git', ['--git-dir', mirror, 'push', '--all', destination], { stdio: 'inherit' });
	execFileSync('git', ['--git-dir', mirror, 'push', '--tags', destination], { stdio: 'inherit' });
	execFileSync('git', ['--git-dir', destination, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
const after = tip();
if (after && after !== before) {
	const require = createRequire(new URL('../server/package.json', import.meta.url));
	const Database = require('better-sqlite3');
	const db = new Database(join(localDir, 'data', 'nashgit.db'));
	try {
		db.prepare("UPDATE repos SET last_push_at = datetime('now') WHERE name = ?").run(name);
		db.prepare('INSERT INTO push_logs (repo_name, from_hash, to_hash, pushed_by, ip) VALUES (?, ?, ?, ?, ?)')
			.run(name, before, after, 'local-seed', '127.0.0.1');
	} finally { db.close(); }
}
console.log(`[nashgit] Local mirror ready: http://127.0.0.1:5173/repos/${encodeURIComponent(name)}`);
