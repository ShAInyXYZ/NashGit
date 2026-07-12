import { Router } from 'express';
import { handleGitRequest } from '../git/backend.js';
import { requireGitToken } from '../auth/middleware.js';
import { detectRefChange, recordPush, getRepo } from '../git/repos.js';

export const gitRouter = Router();

// All git smart-HTTP requests require a deploy token (HTTP Basic auth).
gitRouter.use(requireGitToken);

// Attach a finish-listener BEFORE the handler runs, so we can record pushes
// after the response fully streams out. This middleware must precede the
// route handler (which ends the response).
gitRouter.use((req, res, next) => {
  const isReceivePost =
    req.method === 'POST' && req.path.endsWith('/git-receive-pack');

  if (!isReceivePost) {
    next();
    return;
  }

  // Extract repo name from the path: /<repo>.git/git-receive-pack
  const match = req.path.match(/^\/([^/]+)\.git\//);
  const repoName = match?.[1];

  res.on('finish', () => {
    if (res.statusCode >= 400) return; // push failed, nothing to record
    if (!repoName) return;
    const exists = getRepo(repoName);
    if (!exists) return;
    // Fire-and-forget — don't block the response.
    detectRefChange(repoName)
      .then((change) => {
        recordPush({
          repoName,
          fromHash: change?.from ?? null,
          toHash: change?.to ?? null,
          pushedBy: req.tokenRow?.prefix ?? 'unknown',
          ip: req.ip ?? null,
        });
      })
      .catch((err) => console.error('[nashgit] failed to record push:', err));
  });

  next();
});

// Capture the entire git path as a single wildcard and let the handler parse
// PATH_INFO from req.url. This avoids fragile route-param regexes.
//
// Matches e.g.:
//   /test-backup.git/info/refs?service=git-upload-pack
//   /test-backup.git/git-receive-pack
//   /test-backup.git/HEAD
gitRouter.all('/*', handleGitRequest);
