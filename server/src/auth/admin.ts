import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { config } from '../config.js';

export interface AdminClaims {
  sub: 'admin';
  username: string;
}

/** Seed the single admin row on first run, using an env password if given. */
export async function bootstrapAdmin() {
  const row = db.prepare('SELECT id FROM admin WHERE id = 1').get() as
    | { id: number }
    | undefined;
  if (row) return;

  const password =
    config.adminSeedPassword || nanoid(24); // random if none provided
  const hash = await bcrypt.hash(password, 10);
  db.prepare(
    `INSERT INTO admin (id, username, password_hash) VALUES (1, ?, ?)`
  ).run(config.adminUsername, hash);

  if (config.adminSeedPassword) {
    console.log(`[nashgit] Admin account seeded (username: ${config.adminUsername}).`);
  } else {
    // Print a one-time random password so the operator can actually log in.
    console.log('========================================================');
    console.log(' [nashgit] No NASHGIT_ADMIN_PASSWORD set.');
    console.log(` [nashgit] Generated admin password: ${password}`);
    console.log(' [nashgit] (You will not see this again. Change it in Settings.)');
    console.log('========================================================');
  }
}

export async function verifyAdmin(username: string, password: string): Promise<boolean> {
  const row = db
    .prepare('SELECT username, password_hash FROM admin WHERE id = 1')
    .get() as { username: string; password_hash: string } | undefined;
  if (!row) return false;
  if (row.username !== username) return false;
  return bcrypt.compare(password, row.password_hash);
}

export function signSession(): string {
  // Read the username from the DB, not config — it may have been renamed
  // in Settings after boot.
  const row = db
    .prepare('SELECT username FROM admin WHERE id = 1')
    .get() as { username: string };
  const claims: AdminClaims = { sub: 'admin', username: row.username };
  return jwt.sign(claims, config.secret, { expiresIn: '7d' });
}

/** Cookie options for the admin session. Mark Secure when served over HTTPS. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/' as const,
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

export function verifySession(token: string): AdminClaims | null {
  try {
    const decoded = jwt.verify(token, config.secret) as AdminClaims;
    if (decoded.sub !== 'admin') return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function changePassword(newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare(
    `UPDATE admin SET password_hash = ?, updated_at = datetime('now') WHERE id = 1`
  ).run(hash);
}

export function setAdminUsername(username: string): void {
  db.prepare(
    `UPDATE admin SET username = ?, updated_at = datetime('now') WHERE id = 1`
  ).run(username);
}
