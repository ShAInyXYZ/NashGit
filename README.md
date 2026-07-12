# 🍒 NashGit

**Self-hosted git backup for your NAS.**

NashGit turns a NAS (or any machine) into a private git remote you push your work to. Run the Docker server, create a repo + token from the sleek dark web UI, then `git push` — your projects are backed up on hardware you own.

- **Push-only model** — the NAS is a git remote. Clone, push, pull over HTTP.
- **Token auth** — revocable deploy tokens authenticate git operations.
- **Single container** — API, git transport, and web UI all on one port.
- **Dark + cherry** — SvelteKit + shadcn-svelte UI, dark by default with a cherry accent.

---

## Quick start (Docker — recommended for NAS)

```bash
# 1. Configure
cp .env.example .env
# Edit .env — set NASHGIT_ADMIN_PASSWORD and NASHGIT_SECRET

# 2. Launch
docker compose up -d --build

# 3. Open the UI
#    http://<nas-ip>:3000
```

The first time the container starts it seeds an admin account from `NASHGIT_ADMIN_PASSWORD`. If you leave that blank, a random password is generated and printed **once** in the container logs:

```bash
docker compose logs nashgit | grep "Generated admin password"
```

All data (bare repos + SQLite DB) persists in the `./data` directory — back that up.

---

## Backing up a project

Once you've created a repository and a token in the UI:

```bash
# From your local project:
git remote add nas http://<nas-ip>:3000/git/my-project.git
git push nas main
# Username: anything (e.g. "x")
# Password: <paste your deploy token>
```

To restore / clone elsewhere:

```bash
git clone http://<nas-ip>:3000/git/my-project.git
# Same token auth as above.
```

---

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `NASHGIT_ADMIN_PASSWORD` | first run | *(random)* | Admin password, applied only when DB is empty. |
| `NASHGIT_SECRET` | recommended | *(random)* | JWT signing secret. Set a stable value so sessions survive restarts. |
| `NASHGIT_ADMIN_USERNAME` | no | `admin` | Admin username. |
| `NASHGIT_PUBLIC_URL` | no | *(auto)* | Base URL for clone URLs shown in the UI. |
| `PORT` | no | `3000` | Container port. |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker container (port 3000)                   │
│                                                 │
│  Express server (Node + TypeScript)             │
│  ├── /api/*   ── admin auth, repos, tokens      │
│  ├── /git/*   ── git smart-HTTP (push/pull)     │
│  │               spawns `git http-backend` CGI   │
│  └── /*       ── static SvelteKit SPA            │
│                                                 │
│  /data                                         │
│  ├── repos/<name>.git   (bare git repos)        │
│  └── nashgit.db          (SQLite metadata)      │
└─────────────────────────────────────────────────┘
```

- **Server** (`server/`) — Node 20+, Express, better-sqlite3, bcrypt, JWT. Git transport shells out to system `git http-backend` as a CGI child process (the robust, battle-tested approach — handles all protocol versions correctly).
- **Client** (`client/`) — SvelteKit 2, Svelte 5, Tailwind v4, shadcn-svelte. Built to a static SPA and served by the Express server.

### Authentication

- **Admin session** — username + password → httpOnly JWT cookie (7 days). Used for the web UI.
- **Deploy tokens** — `ngt_…` secrets, bcrypt-hashed at rest, shown once on creation. Used as the password for git Basic auth (username is ignored). Revocable from the UI.

---

## Local development

```bash
# Terminal 1 — server (with hot reload)
cd server
npm install
npm run dev

# Terminal 2 — client (with hot reload)
cd client
npm install
npm run dev
```

The client dev server proxies `/api` and `/git` to `localhost:3000`. For end-to-end git testing against the local server, build the client and let Express serve it:

```bash
cd client && npm run build
# copy build into server/public so Express serves the SPA
rm -rf ../server/public && cp -r build ../server/public
cd ../server && npm run dev
```

---

## Security notes

- **TLS** — NashGit serves plain HTTP. Put it behind a reverse proxy (Traefik, nginx, Caddy, Synology's built-in) for HTTPS. The session cookie's `Secure` flag should be enabled in that setup.
- **Tokens** — store them in a credential manager, not in plaintext. They grant push/pull access to all repos.
- **Backups** — the `./data` directory *is* your backup. Consider scheduling a snapshot or rsync of it elsewhere.

---

## License

MIT
