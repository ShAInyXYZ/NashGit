import Database from 'better-sqlite3';
import { config } from './config.js';
import { ensureDirs } from './config.js';

ensureDirs();

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repos (
    name         TEXT PRIMARY KEY,
    description  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_push_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,         -- first chars, for display in lists
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS push_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_name    TEXT NOT NULL REFERENCES repos(name) ON DELETE CASCADE,
    from_hash    TEXT,
    to_hash      TEXT,
    pushed_by    TEXT,                  -- token prefix or 'admin'
    pushed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    ip           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_push_logs_repo ON push_logs(repo_name);
  CREATE INDEX IF NOT EXISTS idx_push_logs_time ON push_logs(pushed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_prefix ON tokens(prefix);
`);

export default db;
