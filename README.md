<div align="center">

<img src="docs/assets/logo.svg" alt="NashGit" width="160" />

# NashGit

### Self-hosted git backup for your NAS. Push your work to hardware you own.

NashGit turns any NAS, home server, or always-on machine into a private git remote.
Create a repository and a deploy token from the web UI, then `git push`. Your code
stays on your network, on your storage, under your control.

<br/>

![Node](https://img.shields.io/badge/Node-20%2B-2b2c28?style=for-the-badge&logo=nodedotjs&logoColor=ff4d6d)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2-2b2c28?style=for-the-badge&logo=svelte&logoColor=ff4d6d)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-2b2c28?style=for-the-badge&logo=typescript&logoColor=ff4d6d)
[![License](https://img.shields.io/badge/License-MIT-2b2c28?style=for-the-badge)](LICENSE)

<br/>

**[What It Is](#-what-it-is)** · **[Features](#-features)** · **[Quick Start](#-quick-start)** · **[Back Up a Project](#-back-up-a-project)** · **[Security](#-security)** · **[Architecture](#-architecture)** · **[Development](#-development)** · **[License](#-license)**

</div>

---

## What It Is

**NashGit is a tiny, self-hosted git remote for personal backups.**

It is not GitHub. It is not a forge, a CI system, or a collaboration platform. It is one
thing done simply: a place you push your local repositories to, so they live on a machine
you control. Run it in Docker on your NAS, open the web UI once to create a repo and token,
and use plain `git` commands from every machine you work on.

The whole app ships as a **single container** with one port. No database to wire up, no
reverse proxy required to start, and no monthly subscription. Your bare repositories and
their metadata live in a single `./data` directory that you can back up, snapshot, or sync
like any other folder.

---

## Features

- **Push-only git remote** — clone, push, and pull over HTTP smart-transport.
- **Deploy tokens** — revocable, bcrypt-hashed secrets used as the git password.
- **Single-container deployment** — API, git transport, and web UI all on port `3000`.
- **SvelteKit + shadcn-svelte UI** — dark by default, with a cherry accent.
- **SQLite metadata** — repository list, token registry, and push history in one file.
- **Lightweight** — Node 20+, Express, and the system `git http-backend` for robust transport.

---

## Quick Start

The recommended way to run NashGit is with Docker Compose.

```bash
# 1. Clone the repository
git clone https://github.com/ShAInyXYZ/NashGit.git
cd NashGit

# 2. Configure
cp .env.example .env
# Edit .env and set NASHGIT_ADMIN_PASSWORD and NASHGIT_SECRET

# 3. Launch
docker compose up -d --build

# 4. Open the UI
# http://<nas-ip>:3000
```

On first start, NashGit seeds an admin account from `NASHGIT_ADMIN_PASSWORD`. If you leave
that variable blank, a random password is generated and printed once in the logs:

```bash
docker compose logs nashgit | grep "Generated admin password"
```

> [!IMPORTANT]
> All data — bare repositories and the SQLite database — persists in `./data`. Back that
> directory up. It is your backup.

---

## Back Up a Project

Once you have created a repository and a deploy token in the web UI:

```bash
# From your local project:
git remote add nas http://<nas-ip>:3000/git/my-project.git
git push nas main

# Username: anything (for example, "x")
# Password: paste your deploy token
```

To restore or clone elsewhere:

```bash
git clone http://<nas-ip>:3000/git/my-project.git
# Use the same token as the password.
```

---

## Security

- **Run behind a reverse proxy for TLS.** NashGit serves plain HTTP. In production, put it
  behind Traefik, nginx, Caddy, or your NAS built-in reverse proxy. When the request is
  served over HTTPS, the admin session cookie is automatically marked `Secure`.
- **Protect your deploy tokens.** They grant push and pull access to all repositories. Store
  them in a password manager or credential helper, not in plaintext.
- **Rate limiting is built in.** Login attempts and git requests are rate-limited by IP to
  contain brute-force cost.
- **Back up `./data` safely.** Because SQLite runs in WAL mode, copy the directory while the
  container is stopped, or use SQLite's online backup API, to avoid an inconsistent snapshot.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Docker container (port 3000)                           │
│                                                         │
│  Express server (Node + TypeScript)                     │
│  ├── /api/*   — admin auth, repos, tokens, settings     │
│  ├── /git/*   — git smart-HTTP (push / pull / clone)    │
│  │               spawns git http-backend as CGI         │
│  └── /*       — static SvelteKit SPA                   │
│                                                         │
│  /data                                                  │
│  ├── repos/<name>.git   (bare git repositories)         │
│  └── nashgit.db          (SQLite metadata)              │
└─────────────────────────────────────────────────────────┘
```

| Layer | Technology | Role |
|---|---|---|
| **Server** | `server/` | Express API, auth, database, git transport orchestration |
| **Client** | `client/` | SvelteKit 2 static SPA served by Express |
| **Database** | `better-sqlite3` | Metadata and push logs, WAL mode enabled |
| **Git transport** | `git http-backend` | Battle-tested smart-HTTP over CGI |

### Authentication

- **Admin session** — username and password exchange for an `httpOnly` JWT cookie, valid for
  seven days. Used by the web UI.
- **Deploy tokens** — secrets with an `ngt_` prefix, bcrypt-hashed at rest, shown once on
  creation. Used as the password for git Basic auth. The username is ignored. Revocable from
  the UI.

---

## Development

```bash
# Terminal 1 — server with hot reload
cd server
npm install
npm run dev

# Terminal 2 — client with hot reload
cd client
npm install
npm run dev
```

The client dev server proxies `/api` and `/git` to `localhost:3000`.

For end-to-end git testing against the local server, build the client and let Express serve it:

```bash
cd client && npm run build
rm -rf ../server/public && cp -r build ../server/public
cd ../server && npm run dev
```

---

## Configuration

All configuration is via environment variables. See `.env.example` for the full template.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NASHGIT_ADMIN_PASSWORD` | first run | random | Admin password, applied only when the database is empty. |
| `NASHGIT_SECRET` | recommended | random | JWT signing secret. Set a stable value so sessions survive restarts. |
| `NASHGIT_ADMIN_USERNAME` | no | `admin` | Admin username. |
| `NASHGIT_PUBLIC_URL` | no | auto | Base URL used for clone URLs shown in the UI. |
| `PORT` | no | `3000` | Container port. |

---

## License

NashGit is open source under the **MIT License**. See [`LICENSE`](LICENSE) for the full text.

**Copyright © 2026 ShAInyXYZ** ([@ShAInyXYZ](https://github.com/ShAInyXYZ)).

<div align="center">
<br/>
<sub>Built with Node · Express · SvelteKit · Tailwind CSS · better-sqlite3 · shadcn-svelte.</sub>
</div>
