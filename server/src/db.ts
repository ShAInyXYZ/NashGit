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

  CREATE TABLE IF NOT EXISTS commit_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_name TEXT NOT NULL REFERENCES repos(name) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_commit_notes_target ON commit_notes(repo_name, commit_hash, created_at);

  CREATE TABLE IF NOT EXISTS audit_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_name TEXT NOT NULL REFERENCES repos(name) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('repository', 'commit')),
    revision TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'push')),
    status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_reports_target ON audit_reports(repo_name, scope, revision, id DESC);

  CREATE TABLE IF NOT EXISTS github_links (
    repo_name TEXT PRIMARY KEY REFERENCES repos(name) ON DELETE CASCADE,
    github_repo TEXT NOT NULL,
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at TEXT,
    last_synced_hash TEXT
  );
`);

// ---- Migrations ------------------------------------------------------------
// Add integrity-check columns to repos if they're missing (existing DBs).
{
  const cols = db.prepare(`PRAGMA table_info(repos)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('last_check_at')) {
    db.exec(`ALTER TABLE repos ADD COLUMN last_check_at TEXT`);
  }
  if (!names.has('last_check_ok')) {
    db.exec(`ALTER TABLE repos ADD COLUMN last_check_ok INTEGER`);
  }
  if (!names.has('deleted_at')) {
    db.exec(`ALTER TABLE repos ADD COLUMN deleted_at TEXT`);
  }
  if (!names.has('trash_name')) {
    db.exec(`ALTER TABLE repos ADD COLUMN trash_name TEXT`);
  }
}

{
  const cols = db.prepare(`PRAGMA table_info(admin)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'session_version')) {
    db.exec(`ALTER TABLE admin ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`);
  }
}

export default db;
