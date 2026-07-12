import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Resolve the data directory. In Docker this is /data; locally it defaults to
// a ./data folder next to the project so the server is runnable out-of-box.
function resolveDataDir(): string {
  const env = process.env.NASHGIT_DATA_DIR;
  if (env && env.trim()) return env.trim();
  // server lives in /server, put data one level up for local dev
  return join(process.cwd(), '..', 'data');
}

interface AppConfig {
  port: number;
  dataDir: string;
  reposDir: string;
  dbPath: string;
  secret: string;
  adminSeedPassword: string;
  adminUsername: string;
  publicUrl: string;
  tokenPrefix: string;
}

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: resolveDataDir(),
  reposDir: '',
  dbPath: '',
  // JWT signing secret. Generate one if none provided (warns in logs).
  secret: process.env.NASHGIT_SECRET || randomBytes(32).toString('hex'),
  // Admin bootstrap password. Only applied on first run (empty DB).
  adminSeedPassword: process.env.NASHGIT_ADMIN_PASSWORD || '',
  adminUsername: process.env.NASHGIT_ADMIN_USERNAME || 'admin',
  // Public base URL used to build clone URLs shown in the UI. If unset we
  // fall back to the request's host header at runtime.
  publicUrl: process.env.NASHGIT_PUBLIC_URL || '',
  tokenPrefix: 'ngt_',
};

// Materialize derived paths and ensure they exist.
config.reposDir = join(config.dataDir, 'repos');
config.dbPath = join(config.dataDir, 'nashgit.db');

export function ensureDirs() {
  for (const dir of [config.dataDir, config.reposDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
