# Pre-publication security review — 2026-10-27

**Follow-up:** a [second review](SECURITY_REVIEW_2026-10-27_FOLLOWUP.md) found
additional exploitable issues in v2.0.0 and records their fixes. The checks below
describe the earlier review, not a complete security guarantee.

The local `main` and GitHub `main` both started at `ab96896`. The update existed as modified and untracked files, not unpublished commits. This review covers that update and focused checks of its authentication, Git operations, credential handling, and packaging.

## Findings corrected before publication

- The CLI askpass helper returned the deploy token without checking its destination. It now requires the configured server's exact origin and `/git/` path, rejects unknown prompts, and uses Git's per-path credential prompts. CLI invocations disable other credential helpers to prevent accidental token persistence. Regression tests cover alternate hosts, ports, protocol downgrade, paths, and malformed prompts; the real Git clone/push round-trip also passes.
- `.local-dev` was Git-ignored but absent from `.dockerignore`. It is now excluded from Docker build contexts, including remote build uploads.
- The new setup guide contained a deployment-specific NAS address and username. Its public copy now uses placeholders; the original is retained only in ignored local storage.
- Audit summaries interpolated branch names without credential redaction. They now use the same redaction as structured report fields. A Git-object integration test verifies the entire serialized report.
- The example environment file seeded a predictable admin password. It now leaves the value empty, invoking the existing random-password bootstrap behavior.
- New asynchronous GitHub routes now use the Express 4 async error wrapper, including failures before their inner GitHub API try/catch blocks.
- Default branch discovery now falls back to an existing branch when `HEAD` points to an unborn branch. Reflog lookup now reads one previous hash instead of potentially concatenating two, which could prevent commit audits from running.
- Client overrides select patched `cookie` 0.7.2 and `postcss-selector-parser` 6.1.5-compatible releases. The locked client and server dependency trees were checked against the npm advisory service.

## Verification

- 22 server tests and 2 CLI credential tests passed.
- The first GitHub CI run exposed an E2E fixture that relied on a machine-provided Git author identity. The fixture now sets both author and committer explicitly, and passes with inherited identities removed.
- Server TypeScript and Svelte checks passed with no errors or warnings.
- Server and static-client production builds passed.
- Docker build passed using clean `npm ci` installs. An isolated container passed startup, health, SPA routing, admin login, unauthenticated API/Git rejection, and production-disabled GitHub integration checks.
- Gitleaks 8.30.1, downloaded from its official release with its SHA-256 checksum verified, scanned the release file snapshot and all 19 existing commits reachable from local refs. Its sole finding in each scan was the intentionally fake JWT secret in the isolated E2E test. No non-test credentials were identified. No live credential validation was attempted.
- GitHub's secret-scanning alerts endpoint returned an empty list.
- Runtime data, local credentials, dependency directories, and generated build files are excluded from the commit. `git diff --check` passed.

## Remaining advisories and limits

The server dependency audit reports zero vulnerabilities. The client reports five low-severity affected-package entries, all from two SvelteKit advisories and their dependency propagation. There are no moderate, high, or critical npm findings.

- [Enhanced-form open redirect](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r): this application does not use `use:enhance` or SvelteKit server form actions; it sends requests to Express APIs.
- [Prerendered cache-header XSS](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj): prerendering is disabled, no untrusted `cache-control` header is injected, and production serves a static SPA through Express.

Based on those prerequisites and the reviewed code, neither vulnerable feature is reachable in the current application. Reassess if these features are introduced. Removing the advisory entries requires a separately tested SvelteKit 3 migration, including its Node, Svelte, TypeScript, and adapter requirements; no forced major upgrade was applied here.

The built-in repository scanner is advisory, with bounded content coverage and no publication gate. Its automatic branch detection and long-line exclusions are documented in [AUDIT.md](AUDIT.md). A clean report must not be treated as proof that all history or every secret format is safe.

This is a source/dependency/packaging review, not a forensic examination of a deployed NAS or GitHub account. It cannot establish that no breach has occurred. NAS access logs, running-container OS packages, network exposure, and historical credential use were not investigated. Existing deployments still require appropriate HTTPS, network access controls, and a non-default admin password; changing the example file does not rotate an existing password. Older CLI remotes may still contain credentials and should be replaced with credential-free URLs.

Pushing `main` triggers the repository's existing CI and GHCR publish workflows. It does not directly deploy to a NAS.
