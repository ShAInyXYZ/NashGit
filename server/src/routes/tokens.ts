import { Router } from 'express';
import { createToken, deleteToken, listTokens } from '../auth/token.js';
import { requireAdmin } from '../auth/middleware.js';

export const tokensRouter = Router();

tokensRouter.use(requireAdmin);

tokensRouter.get('/', (_req, res) => {
  const tokens = listTokens().map(({ token_hash: _th, ...rest }) => rest);
  res.json(tokens);
});

tokensRouter.post('/', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Token name is required' });
    return;
  }
  const created = createToken(name.trim().slice(0, 80));
  // Return the full token exactly once.
  res.status(201).json(created);
});

tokensRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid token id' });
    return;
  }
  const ok = deleteToken(id);
  if (!ok) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  res.json({ ok: true });
});
