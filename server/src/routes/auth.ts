import { Router } from 'express';
import { signSession, verifyAdmin, verifySession, sessionCookieOptions, revokeAdminSessions } from '../auth/admin.js';
import { SESSION_COOKIE } from '../auth/middleware.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const claims = await verifyAdmin(username, password);
    if (!claims) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signSession(claims);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req.secure));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  // An unauthenticated or previously revoked cookie must not log out others.
  if (token && verifySession(token)) revokeAdminSessions();
  const { maxAge, ...options } = sessionCookieOptions(req.secure);
  res.clearCookie(SESSION_COOKIE, options);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.json({ authenticated: false });
    return;
  }
  const claims = verifySession(token);
  if (!claims) {
    const { maxAge, ...options } = sessionCookieOptions(req.secure);
    res.clearCookie(SESSION_COOKIE, options);
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: claims.username });
});

export { SESSION_COOKIE } from '../auth/middleware.js';
