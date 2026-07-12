import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { changePassword, setAdminUsername } from '../auth/admin.js';
import { config } from '../config.js';
import { requireAdmin } from '../auth/middleware.js';

export const settingsRouter = Router();

settingsRouter.use(requireAdmin);

settingsRouter.get('/', (_req, res) => {
  const row = db
    .prepare('SELECT username, created_at FROM admin WHERE id = 1')
    .get() as { username: string; created_at: string };
  res.json({
    admin: { username: row.username, created_at: row.created_at },
    dataDir: config.dataDir,
    publicUrl: config.publicUrl || null,
  });
});

settingsRouter.post('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new passwords are required' });
    return;
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }
  const row = db
    .prepare('SELECT password_hash FROM admin WHERE id = 1')
    .get() as { password_hash: string };
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }
  changePassword(newPassword);
  res.json({ ok: true });
});

settingsRouter.post('/username', (req, res) => {
  const { username } = req.body ?? {};
  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    res.status(400).json({ error: 'Username must be at least 2 characters' });
    return;
  }
  setAdminUsername(username.trim());
  res.json({ ok: true });
});
