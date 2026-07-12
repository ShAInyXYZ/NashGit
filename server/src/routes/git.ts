import { Router } from 'express';
import { handleGitRequest } from '../git/backend.js';
import { requireGitToken } from '../auth/middleware.js';
import { detectRefChange, getRepo, recordPush } from '../git/repos.js';

export const gitRouter = Router();

// All git smart-HTTP requests require a deploy token (HTTP Basic auth).
gitRouter.use(requireGitToken);

// git smart-HTTP endpoints. The repo name is captured up to `.git`, and the
// remainder of the path (info/refs, git-upload-pack, git-receive-pack, ...)
// is captured as a wildcard and forwarded to git-http-backend as PATH_INFO.
gitRouter.all('/:repo(.*\\.git)/*', handleGitRequest);
// Some clients omit the trailing path on the very first request — handle both.
gitRouter.all('/:repo(.*\\.git)', handleGitRequest);

// After a receive-pack (push) completes, record the ref change in the log.
// We wrap the handler so we can inspect the repo state once the response ends.
gitRouter.use(async (req, res, next) => {
  const isPush =
    req.params.repo &&
    (req.path.endsWith('/git-receive-pack') ||
      (req.query.service === 'git-receive-pack'));

  if (!isPush) {
    next();
    return;
  }

  // Only log on the actual receive-pack POST (the info/refs GET is just an ad).
  const isReceivePost = req.path.endsWith('/git-receive-pack') && req.method === 'POST';
  if (!isReceivePost) {
    next();
    return;
  }

  const repoName = (req.params.repo as string).replace(/\.git$/, '');
  const exists = getRepo(repoName);
  if (!exists) {
    next();
    return;
  }

  // Capture the push once the response has fully streamed out.
  res.on('finish', async () => {
    if (res.statusCode >= 400) return; // push failed, nothing to record
    try {
      const change = await detectRefChange(repoName);
      recordPush({
        repoName,
        fromHash: change?.from ?? null,
        toHash: change?.to ?? null,
        pushedBy: req.tokenRow?.prefix ?? 'unknown',
        ip: req.ip ?? null,
      });
    } catch (err) {
      console.error('[nashgit] failed to record push:', err);
    }
  });

  next();
});
