#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localDir = join(root, '.local-dev');
const credentialsPath = join(localDir, 'credentials.json');
const serverPort = 4300;
const clientPort = 5173;

mkdirSync(localDir, { recursive: true, mode: 0o700 });
let credentials;
if (existsSync(credentialsPath)) {
	credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
} else {
	credentials = {
		username: 'dev',
		password: randomBytes(24).toString('base64url'),
		secret: randomBytes(32).toString('hex')
	};
	writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

const server = spawn('npm', ['run', 'dev'], {
	cwd: join(root, 'server'),
	stdio: 'inherit',
	env: {
		...process.env,
		NASHGIT_DATA_DIR: join(localDir, 'data'),
		NASHGIT_ADMIN_USERNAME: credentials.username,
		NASHGIT_ADMIN_PASSWORD: credentials.password,
		NASHGIT_SECRET: credentials.secret,
		NASHGIT_HOST: '127.0.0.1',
		NASHGIT_GITHUB_LOCAL_INTEGRATION: '1',
		NASHGIT_PUBLIC_URL: `http://127.0.0.1:${serverPort}`,
		PORT: String(serverPort)
	}
});

const client = spawn('npm', ['run', 'dev', '--', '--port', String(clientPort), '--strictPort'], {
	cwd: join(root, 'client'),
	stdio: 'inherit',
	env: { ...process.env, NASHGIT_DEV_API_PORT: String(serverPort) }
});

console.log(`[nashgit] Local UI: http://127.0.0.1:${clientPort}`);
console.log(`[nashgit] Local data: ${join(localDir, 'data')}`);
console.log(`[nashgit] Local login saved in ${credentialsPath} (mode 0600)`);

let stopping = false;
function stop(signal = 'SIGTERM') {
	if (stopping) return;
	stopping = true;
	server.kill(signal);
	client.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('error', (error) => { console.error('[nashgit] Server failed:', error); stop(); });
client.on('error', (error) => { console.error('[nashgit] Client failed:', error); stop(); });
server.on('exit', (code) => { if (!stopping) { console.error(`[nashgit] Server exited (${code}); stopping client.`); stop(); } });
client.on('exit', (code) => { if (!stopping) { console.error(`[nashgit] Client exited (${code}); stopping server.`); stop(); } });
