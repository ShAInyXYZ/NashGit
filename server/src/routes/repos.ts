import { Router } from 'express';
import {
  createRepo,
  deleteRepo,
  getPushLog,
  getRepo,
  listRepos,
  REPO_NAME_RE,
  verifyRepo,
} from '../git/repos.js';
import { config } from '../config.js';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const reposRouter = Router();

reposRouter.use(requireAdmin);

// Clone URL helper — prefers a configured public URL, else falls back to the
// request's own host so it works out of the box.
function cloneUrl(req: any, name: string): string {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/git/${name}.git`;
}

reposRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const repos = await listRepos();
    res.json(
      repos.map((r) => ({
        ...r,
        clone_url: cloneUrl(req, r.name),
      }))
    );
  })
);

reposRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Repository name is required' });
      return;
    }
    if (!REPO_NAME_RE.test(name)) {
      res.status(400).json({
        error:
          'Invalid name. Use letters, numbers, dot, dash, underscore; no leading dash.',
      });
      return;
    }
    try {
      const repo = await createRepo(name, String(description ?? ''));
      res.status(201).json({ ...repo, clone_url: cloneUrl(req, repo.name) });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  })
);

reposRouter.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const repo = await getRepo(req.params.name);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json({ ...repo, clone_url: cloneUrl(req, repo.name) });
  })
);

reposRouter.delete(
  '/:name',
  asyncHandler(async (req, res) => {
    const ok = await deleteRepo(req.params.name);
    if (!ok) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json({ ok: true });
  })
);

reposRouter.get(
  '/:name/log',
  asyncHandler(async (req, res) => {
    const repo = await getRepo(req.params.name);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const log = getPushLog(req.params.name);
    res.json(log);
  })
);

// Run git fsck on the repo to verify backup integrity.
reposRouter.post(
  '/:name/verify',
  asyncHandler(async (req, res) => {
    try {
      const result = await verifyRepo(req.params.name);
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  })
);
