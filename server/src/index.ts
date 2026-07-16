import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js'; // initialises + migrates the database
import { bootstrapAdmin } from './auth/admin.js';
import { cookieMiddleware } from './auth/middleware.js';
import { loginLimiter, gitLimiter } from './middleware/rate-limit.js';
import { authRouter } from './routes/auth.js';
import { reposRouter } from './routes/repos.js';
import { tokensRouter } from './routes/tokens.js';
import { settingsRouter } from './routes/settings.js';
import { gitRouter } from './routes/git.js';
import { listRepos, totalDiskUsage } from './git/repos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

bootstrapAdmin();

const app = express();

// Parse JSON bodies for API routes. Raw request bodies for /git/* are piped
// straight through to git-http-backend, so we must NOT parse them as JSON.
app.use((req, res, next) => {
  if (req.path.startsWith('/git/')) return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(cookieMiddleware);

// Trust the first proxy hop so req.ip / req.protocol work behind a reverse
// proxy (Traefik, nginx, Synology reverse proxy, etc.).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- API -------------------------------------------------------------------
app.use('/api/auth', loginLimiter, authRouter);
app.use('/api/repos', reposRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/settings', settingsRouter);

// Public health + stats endpoint used by the login screen / dashboard widgets.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'NashGit', version: '1.0.0' });
});

// ---- Git smart-HTTP --------------------------------------------------------
app.use('/git', gitLimiter, gitRouter);

// ---- Static client (built SvelteKit SPA) ----------------------------------
// In production the built client lives at ../client/build (copied into the
// Docker image). We serve it from a single port so the whole app is one
// container.
const clientBuildDir = join(__dirname, '..', 'public');
if (existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  // SPA fallthrough: anything not matched by /api or /git returns index.html
  // so client-side routing works on direct loads / refreshes.
  app.get(/^(?!\/(api|git)\/).*/, (_req, res) => {
    res.sendFile(join(clientBuildDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      'NashGit server is running. (No built client found — run the client build.)'
    );
  });
}

app.listen(config.port, () => {
  const repoCount = listRepos().length;
  const size = totalDiskUsage();
  console.log(`[nashgit] listening on :${config.port}`);
  console.log(`[nashgit] data dir: ${config.dataDir}`);
  console.log(`[nashgit] repos: ${repoCount} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  if (!config.publicUrl) {
    console.log('[nashgit] tip: set NASHGIT_PUBLIC_URL so clone URLs are absolute.');
  }
});
