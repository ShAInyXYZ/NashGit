import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import db from '../db.js';
import { config } from '../config.js';

export interface TokenRow {
  id: number;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface CreatedToken {
  id: number;
  name: string;
  token: string; // full plaintext, only returned once
  prefix: string;
  created_at: string;
}

/** Create a new deploy token. The plaintext value is returned exactly once. */
export function createToken(name: string): CreatedToken {
  const raw = config.tokenPrefix + randomBytes(24).toString('hex');
  const hash = bcrypt.hashSync(raw, 10);
  const prefix = raw.slice(0, 12);
  const info = db
    .prepare(
      `INSERT INTO tokens (name, token_hash, prefix) VALUES (?, ?, ?)
       RETURNING id, created_at`
    )
    .get(name, hash, prefix) as { id: number; created_at: string };
  return { id: info.id, name, token: raw, prefix, created_at: info.created_at };
}

export function listTokens(): TokenRow[] {
  return db
    .prepare(
      `SELECT id, name, token_hash, prefix, created_at, last_used_at
       FROM tokens ORDER BY created_at DESC`
    )
    .all() as TokenRow[];
}

export function deleteToken(id: number): boolean {
  const res = db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
  return res.changes > 0;
}

/** Length of the stored prefix used to narrow token lookups. */
const PREFIX_LENGTH = 12;

/**
 * Verify a token value (the password half of git Basic auth).
 * Returns the token row on success, or null if no match.
 *
 * Looks up candidates by prefix first, then bcrypt-compares only those rows
 * so the cost stays O(1) regardless of how many tokens exist.
 */
export function verifyToken(raw: string): TokenRow | null {
  if (!raw.startsWith(config.tokenPrefix) || raw.length < PREFIX_LENGTH) return null;
  const prefix = raw.slice(0, PREFIX_LENGTH);
  const rows = db
    .prepare(
      'SELECT id, name, token_hash, prefix, created_at, last_used_at FROM tokens WHERE prefix = ?'
    )
    .all(prefix) as TokenRow[];
  for (const row of rows) {
    if (bcrypt.compareSync(raw, row.token_hash)) {
      return row;
    }
  }
  return null;
}

export function touchToken(id: number): void {
  db.prepare(`UPDATE tokens SET last_used_at = datetime('now') WHERE id = ?`).run(id);
}
