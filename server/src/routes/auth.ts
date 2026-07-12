import { Router } from 'express';
import { signSession, verifyAdmin, verifySession } from '../auth/admin.js';
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
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    // secure: true, // enable behind a TLS reverse proxy
  });
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
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
    res.clearCookie(SESSION_COOKIE);
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: claims.username });
});

export { SESSION_COOKIE } from '../auth/middleware.js';
