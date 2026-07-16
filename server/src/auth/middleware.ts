import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { verifySession } from './admin.js';
import { verifyToken, touchToken, type TokenRow } from './token.js';
import db from '../db.js';

export const cookieMiddleware = cookieParser();

export const SESSION_COOKIE = 'nashgit_session';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: { username: string };
    tokenRow?: TokenRow;
    remoteUser?: string;
  }
}

/** Require a logged-in admin session (cookie JWT). Use on /api routes. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const claims = verifySession(token);
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  req.admin = { username: claims.username };
  next();
}

/**
 * Authenticate a git HTTP request. git clients send HTTP Basic auth where the
 * password is a deploy token. The username is ignored (we only have one admin).
 * Sets req.tokenRow on success; otherwise responds 401 with a challenge.
 */
export async function requireGitToken(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    challenge(res);
    return;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  } catch {
    challenge(res);
    return;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) {
    challenge(res);
    return;
  }
  const password = decoded.slice(colon + 1);
  const row = await verifyToken(password);
  if (!row) {
    challenge(res);
    return;
  }
  touchToken(row.id);
  req.tokenRow = row;
  req.remoteUser = `token:${row.prefix}`;
  next();
}

function challenge(res: Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="NashGit", charset="UTF-8"');
  res.status(401).end('Authentication required');
}

/** After a successful git-receive-pack (push), record the push. */
export function maybeRecordPush(req: Request, _res: Response, next: NextFunction) {
  // We log pushes in the git route handler after the response completes.
  next();
}
