import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import db from './db.js'; // initialises + migrates the database
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

await bootstrapAdmin();

const app = express();

// Security headers. Content-Security-Policy is relaxed for the SvelteKit SPA;
// tighten it further if you know your asset hashes.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

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

// ---- Global error handler --------------------------------------------------
// Catches errors from async route handlers and unexpected failures.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[nashgit] unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.port, () => {
  console.log(`[nashgit] listening on :${config.port}`);
  console.log(`[nashgit] data dir: ${config.dataDir}`);
  if (!config.publicUrl) {
    console.log('[nashgit] tip: set NASHGIT_PUBLIC_URL so clone URLs are absolute.');
  }
  // Startup stats are informational — log failures but never crash boot.
  (async () => {
    const repos = await listRepos();
    const size = await totalDiskUsage();
    console.log(`[nashgit] repos: ${repos.length} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  })().catch((err) => console.error('[nashgit] failed to compute startup stats:', err));
});

// ---- Graceful shutdown -----------------------------------------------------
function shutdown(signal: string) {
  console.log(`[nashgit] ${signal} received. Closing server and database...`);
  server.close(() => {
    try {
      db.close();
      console.log('[nashgit] database closed. exiting.');
    } catch {
      // already closed
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
