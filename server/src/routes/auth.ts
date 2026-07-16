import { Router } from 'express';
import { signSession, verifyAdmin, verifySession, sessionCookieOptions } from '../auth/admin.js';
import { SESSION_COOKIE } from '../auth/middleware.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  if (!verifyAdmin(username, password)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const token = signSession();
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req.secure));
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req.secure));
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
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req.secure));
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: claims.username });
});

export { SESSION_COOKIE } from '../auth/middleware.js';
