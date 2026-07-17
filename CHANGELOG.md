# Changelog

All notable changes to NashGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] — 2026-07-17

First public release.

### Added

- **Git smart-HTTP remote** — push, pull, and clone over HTTP via `git http-backend`,
  all on one port inside a single Docker container.
- **Deploy tokens** — revocable `ngt_…` secrets (bcrypt-hashed at rest, shown once)
  used as the git Basic-auth password. Prefix-indexed verification.
- **Web UI** — SvelteKit + shadcn-svelte dashboard, dark by default with a cherry
  accent: repository list, repo detail, deploy-token management, settings.
- **Backup integrity checks** — one-click `git fsck` verification per repository,
  with a Healthy / Issues status and check timestamp in the UI.
- **Freshness cherries** — at-a-glance backup aliveness per repo (fresh, ripe,
  getting stale, withered) based on time since last push.
- **Push history** — per-repo log of pushes (from/to hashes, token prefix, IP, time)
  captured from the git reflog.
- **`nash` CLI** — zero-dependency Node CLI: `nash login` mints a machine-specific
  deploy token, then `nash create / clone / push / pull / list` wire auth for you.
- **Agent skill** — `skills/nashgit/SKILL.md` teaches AI coding agents to use the
  CLI (install into `~/.claude/skills/` or your agent's instruction file).
- **Security hardening** — rate limiting on auth and git endpoints, helmet headers,
  `Secure` session cookies over HTTPS, `SameSite=strict`, graceful shutdown,
  prefix-indexed token lookup, async everything (no event-loop blocking).
- **Docs** — README with screenshots, Tailscale remote-access guide
  (`docs/TAILSCALE.md`), remote-access options (`docs/REMOTE_ACCESS.md`).
- **CI** — server typecheck + test suite (unit + full E2E git round-trip),
  client check, Docker build, and GHCR image publishing.

[1.0.0]: https://github.com/ShAInyXYZ/NashGit/releases/tag/v1.0.0
