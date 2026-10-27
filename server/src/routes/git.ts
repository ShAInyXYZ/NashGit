import { Router } from 'express';
import { handleGitRequest } from '../git/backend.js';
import { requireGitToken } from '../auth/middleware.js';
import { detectRefChange, recordPush, getRepo, refSnapshot } from '../git/repos.js';
import { queueAudit } from '../audit/service.js';
import { newlyPushedCommits } from '../git/history.js';

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

  if (!repoName) {
    next();
    return;
  }
  refSnapshot(repoName).then((before) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      // Git reports per-ref rejection inside an HTTP 200 response. Only record
      // a push if its refs actually changed.
      (async () => {
        const exists = await getRepo(repoName);
        if (!exists || before === await refSnapshot(repoName)) return;
        const change = await detectRefChange(repoName);
        recordPush({
          repoName,
          fromHash: change?.from ?? null,
          toHash: change?.to ?? null,
          pushedBy: req.tokenRow?.prefix ?? 'unknown',
          ip: req.ip ?? null,
        });
        // Analyze in the background after Git has acknowledged the push.
        // Audit failures never reject or undo a valid backup.
        if (queueAudit(repoName, 'repository', undefined, 'push') === 'full') console.warn(`[nashgit] repository audit queue full for ${repoName}`);
        if (change?.to) {
          const pushed = await newlyPushedCommits(repoName, change.from, change.to);
          if (pushed.omitted) console.warn(`[nashgit] push audit limited to 30 newest commits for ${repoName}; older commits can be audited manually`);
          for (const hash of pushed.hashes) {
            if (queueAudit(repoName, 'commit', hash, 'push') === 'full') {
              console.warn(`[nashgit] commit audit queue full for ${repoName}`);
              break;
            }
          }
        }
      })().catch((err) => console.error('[nashgit] failed to record push:', err));
    });
    next();
  }).catch(next);
});

// Capture the entire git path as a single wildcard and let the handler parse
// PATH_INFO from req.url. This avoids fragile route-param regexes.
//
// Matches e.g.:
//   /test-backup.git/info/refs?service=git-upload-pack
//   /test-backup.git/git-receive-pack
//   /test-backup.git/HEAD
gitRouter.all('/*', handleGitRequest);
