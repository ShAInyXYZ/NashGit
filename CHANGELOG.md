# Changelog

All notable changes to NashGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] — 2026-10-27

### Added

- Commit explorer with branch history, changed files, text diffs, image previews,
  and commit notes.
- Bounded repository audits after Git HTTP pushes or on request, with findings,
  coverage information, and a documented rulebook.
- Recoverable repository deletion through trash and restore.
- Opt-in local GitHub integration using the host's `gh` login to link or create a
  destination and push the default branch without force.
- Local development and repository-seeding scripts.

### Changed

- New NashGit mark and wordmark across the app and documentation.
- README with six real demo screenshots and corrected backup, authentication,
  network, and development guidance.
- CLI Git authentication uses a destination-restricted askpass helper instead of
  putting credentials in newly created remote URLs.

### Fixed

- Credential handling, Docker build-context exclusions, audit branch-name
  redaction, asynchronous route error handling, and example password defaults.
- Default-branch fallback and previous-commit lookup for audits.
- CI Git test fixtures now set their own author and committer identity.

### Upgrade notes and limitations

- Back up the complete data volume consistently before upgrading. Stop NashGit
  while copying the volume, and preserve the existing session-signing secret.
- Replace any older CLI remote URLs containing credentials with credential-free
  URLs. The CLI still stores its token and admin cookie in a local plaintext file.
- GitHub integration is disabled in the supplied NAS container. It is manual,
  pushes only the default branch, and does not synchronize every ref.
- Audits are advisory, do not block pushes, and do not scan all history. This
  release does not add Git LFS object storage or automatic backup scheduling.
- The security review recorded five low-severity client dependency advisory
  entries associated with unused SvelteKit features. See the
  [review and its limits](docs/SECURITY_REVIEW_2026-10-27.md); this release is not
  a guarantee against vulnerabilities or evidence that no breach has occurred.

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

[2.0.0]: https://github.com/ShAInyXYZ/NashGit/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/ShAInyXYZ/NashGit/releases/tag/v1.0.0
