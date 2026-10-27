import { Router } from 'express';
import {
  createRepo,
  deleteRepo,
  getPushLog,
  getRepo,
  listRepos,
  listDeletedRepos,
  restoreRepo,
  REPO_NAME_RE,
  verifyRepo,
} from '../git/repos.js';
import { config } from '../config.js';
import { requireAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/async-handler.js';
import db from '../db.js';
import { getCommit, getFileDiff, getImageAtCommit, listBranches, listCommits, HASH_RE } from '../git/history.js';
import { RULES } from '../audit/rules.js';
import { auditById, auditHistory, latestAudit, latestRepositoryAuditSummary, queueAudit } from '../audit/service.js';

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
        audit_summary: latestRepositoryAuditSummary(r.name),
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
      res.status(201).json({ ...repo, clone_url: cloneUrl(req, repo.name), audit_summary: null });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  })
);

reposRouter.get('/trash', (_req, res) => {
  res.json(listDeletedRepos());
});

reposRouter.post('/trash/:name/restore', asyncHandler(async (req, res) => {
  const ok = await restoreRepo(req.params.name);
  if (!ok) {
    res.status(404).json({ error: 'Repository not found in trash' });
    return;
  }
  res.json({ ok: true });
}));

reposRouter.get(
  '/:name',
  asyncHandler(async (req, res) => {
    const repo = await getRepo(req.params.name);
    if (!repo) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json({ ...repo, clone_url: cloneUrl(req, repo.name), audit_summary: latestRepositoryAuditSummary(repo.name) });
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

reposRouter.get('/:name/branches', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) {
    res.status(404).json({ error: 'Repository not found' });
    return;
  }
  res.json(await listBranches(req.params.name));
}));

reposRouter.get('/:name/audit/rules', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'Repository not found' }); return; }
  res.json(RULES);
}));

reposRouter.get('/:name/audit/history', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'Repository not found' }); return; }
  const scope = req.query.scope === 'commit' ? 'commit' : req.query.scope === 'repository' || req.query.scope === undefined ? 'repository' : null;
  const revision = typeof req.query.commit === 'string' ? req.query.commit : undefined;
  if (!scope || (scope === 'commit' && (!revision || !HASH_RE.test(revision)))) {
    res.status(400).json({ error: 'Invalid audit scope or commit' }); return;
  }
  res.json(auditHistory(req.params.name, scope, scope === 'commit' ? revision : undefined));
}));

reposRouter.get('/:name/audit/reports/:id', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'Repository not found' }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid report id' }); return; }
  const report = auditById(req.params.name, id);
  if (!report) { res.status(404).json({ error: 'Report not found' }); return; }
  res.json(report);
}));

reposRouter.get('/:name/audit', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name)) { res.status(404).json({ error: 'Repository not found' }); return; }
  const scope = req.query.scope === 'commit' ? 'commit' : req.query.scope === 'repository' || req.query.scope === undefined ? 'repository' : null;
  const revision = typeof req.query.commit === 'string' ? req.query.commit : undefined;
  if (!scope || (scope === 'commit' && (!revision || !HASH_RE.test(revision)))) {
    res.status(400).json({ error: 'Invalid audit scope or commit' }); return;
  }
  res.json(latestAudit(req.params.name, scope, scope === 'commit' ? revision : undefined));
}));

reposRouter.post('/:name/audit', asyncHandler(async (req, res) => {
  const repo = await getRepo(req.params.name);
  if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
  const scope = req.body?.scope === 'commit' ? 'commit' : req.body?.scope === 'repository' ? 'repository' : null;
  const revision = req.body?.commit;
  if (!scope || (scope === 'commit' && (typeof revision !== 'string' || !HASH_RE.test(revision)))) {
    res.status(400).json({ error: 'Invalid audit scope or commit' }); return;
  }
  if (scope === 'repository' && !repo.latestCommit) { res.status(409).json({ error: 'Push a commit before auditing this repository' }); return; }
  if (scope === 'commit' && !await getCommit(req.params.name, revision)) { res.status(404).json({ error: 'Commit not found' }); return; }
  const result = queueAudit(req.params.name, scope, scope === 'commit' ? revision : undefined, 'manual');
  if (result === 'full') { res.status(503).json({ error: 'Audit queue is busy; retry shortly' }); return; }
  res.status(202).json({ queued: result === 'queued', running: true });
}));

reposRouter.get('/:name/commits', asyncHandler(async (req, res) => {
  const repo = await getRepo(req.params.name);
  if (!repo) {
    res.status(404).json({ error: 'Repository not found' });
    return;
  }
  const branches = await listBranches(req.params.name);
  const branch = typeof req.query.branch === 'string' ? req.query.branch : (branches.find((item) => item.name === repo.defaultBranch) ?? branches[0])?.name;
  if (!branch) {
    res.json({ branch: null, branches, commits: [], hasMore: false, nextOffset: 0 });
    return;
  }
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    res.status(400).json({ error: 'Invalid commit offset' });
    return;
  }
  const result = await listCommits(req.params.name, branch, offset, 30);
  if (!result) {
    res.status(400).json({ error: 'Unknown branch' });
    return;
  }
  res.json(result);
}));

reposRouter.get('/:name/commits/:hash', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name) || !HASH_RE.test(req.params.hash)) {
    res.status(404).json({ error: 'Commit not found' });
    return;
  }
  const commit = await getCommit(req.params.name, req.params.hash);
  if (!commit) {
    res.status(404).json({ error: 'Commit not found' });
    return;
  }
  res.json(commit);
}));

reposRouter.get('/:name/commits/:hash/diff', asyncHandler(async (req, res) => {
  const path = req.query.path;
  if (!await getRepo(req.params.name) || !HASH_RE.test(req.params.hash) || typeof path !== 'string' || !path || path.length > 4096) {
    res.status(400).json({ error: 'Invalid commit or file path' });
    return;
  }
  const diff = await getFileDiff(req.params.name, req.params.hash, path);
  if (!diff) {
    res.status(404).json({ error: 'File not found in this commit' });
    return;
  }
  res.json(diff);
}));

reposRouter.get('/:name/commits/:hash/image', asyncHandler(async (req, res) => {
  const { path, version } = req.query;
  if (!await getRepo(req.params.name) || !HASH_RE.test(req.params.hash) || typeof path !== 'string' || !path || path.length > 4096 || (version !== 'before' && version !== 'after')) {
    res.status(400).json({ error: 'Invalid image request' });
    return;
  }
  const image = await getImageAtCommit(req.params.name, req.params.hash, path, version);
  if (!image) {
    res.status(404).json({ error: 'Image not found in this commit' });
    return;
  }
  if (image.tooLarge) {
    res.status(413).json({ error: 'Image is too large to preview' });
    return;
  }
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(image.data);
}));

reposRouter.get('/:name/commits/:hash/notes', asyncHandler(async (req, res) => {
  if (!await getRepo(req.params.name) || !HASH_RE.test(req.params.hash)) {
    res.status(404).json({ error: 'Commit not found' });
    return;
  }
  res.json(db.prepare('SELECT id, body, author, created_at FROM commit_notes WHERE repo_name = ? AND commit_hash = ? ORDER BY id').all(req.params.name, req.params.hash));
}));

reposRouter.post('/:name/commits/:hash/notes', asyncHandler(async (req, res) => {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > 2000) {
    res.status(400).json({ error: 'Note must contain 1–2000 characters' });
    return;
  }
  if (!await getRepo(req.params.name) || !HASH_RE.test(req.params.hash) || !await getCommit(req.params.name, req.params.hash)) {
    res.status(404).json({ error: 'Commit not found' });
    return;
  }
  const result = db.prepare('INSERT INTO commit_notes (repo_name, commit_hash, body, author) VALUES (?, ?, ?, ?)').run(req.params.name, req.params.hash, body, req.admin?.username ?? 'admin');
  res.status(201).json(db.prepare('SELECT id, body, author, created_at FROM commit_notes WHERE id = ?').get(result.lastInsertRowid));
}));

reposRouter.delete('/:name/commits/:hash/notes/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || !HASH_RE.test(req.params.hash)) {
    res.status(400).json({ error: 'Invalid note' });
    return;
  }
  const result = db.prepare('DELETE FROM commit_notes WHERE id = ? AND repo_name = ? AND commit_hash = ?').run(id, req.params.name, req.params.hash);
  if (!result.changes) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  res.json({ ok: true });
}));

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
