# Follow-up security review — 2026-10-27

This review started from v2.0.0 (`0784457`). It found four issues that the first
review missed. The fixes are in subsequent source changes; **the immutable
v2.0.0 tag does not contain these fixes**. Updating GitHub does not update an
already-running NAS container.

## Confirmed findings and fixes

Severity below is a practical assessment of this application's exposure, not an
assigned CVE or formal CVSS score.

| Finding | Prerequisite and impact | Evidence before the fix | Fix |
|---|---|---|---|
| High: Git request can crash the server | A valid deploy token; a rejected request body causes service-wide denial of service. | An 8 MiB POST to a missing repository returned 404, then the process exited with an unhandled `EPIPE`. | Handle child-input stream errors, stop piping rejected input, and keep the HTTP service alive. Tests cover missing repositories and rejected content types. |
| High: automatic audit can block the event loop | Ability to push crafted content, or persuade the owner to back up an untrusted project; subsequent automatic/manual audit can make the whole service unresponsive. | An approximately 18 KB line caused catastrophic backtracking in the shell-command rule and exceeded an isolated 12-second deadline. This was below the existing 20,000-character exclusion. | Parse option tokens without overlapping repetition. Avoid repeated suffix searches in the TLS command rule. A killable subprocess regression exercises hostile inputs and normal detections. |
| Medium: IPv6 rotation bypasses rate limits | IPv6 clients reaching the app directly or through a correctly trusted proxy; permits more password/token guesses than the configured limit. | Eleven failures from eleven addresses in the same IPv6 subnet all returned 401 instead of the eleventh returning 429. | Upgrade `express-rate-limit` from 7.5.1 to 8.7.1 and explicitly group IPv6 addresses by /56. Tests also keep unrelated subnets and IPv4-mapped clients in separate buckets. |
| Medium: web logout does not revoke a copied session | An attacker already possessing an admin cookie could continue using it after the owner signed out. This does not itself steal a cookie. | Replaying the same cookie after logout still returned 200 from the protected repository API. | Valid web logout increments the account's session version. Replay now returns 401. Stale/absent cookies cannot revoke newer sessions, and pending password checks retain the session version they actually verified. |

The logout change invalidates **all admin sessions**, including CLI admin sessions,
for this single-admin application. Deploy tokens are separate and remain valid
until revoked. The CLI's documented `nash logout` remains a local configuration
removal, not server-side token revocation.

The IPv6 behavior is also documented in the maintainer's
[8.0.0 changelog](https://github.com/express-rate-limit/express-rate-limit/blob/main/docs/reference/changelog.mdx).
The chosen version is newer than the affected 8.x releases listed in the separate
[IPv4-mapped address advisory](https://github.com/express-rate-limit/express-rate-limit/security/advisories/GHSA-46wh-pxpv-q5gq).

## Additional hardening

- Git responses now respect response-stream backpressure, avoiding unbounded
  application buffering for a slow reader. This is not a per-user storage or
  concurrency quota.
- Async Git authentication failures now reach Express's error handler instead of
  becoming unhandled promise rejections.
- State-changing API requests reject foreign browser origins, including sibling
  hosts/ports. Non-browser clients without Origin remain supported. A reverse
  proxy should preserve Host, or `NASHGIT_PUBLIC_URL` should name the browser URL.
- Login rejects malformed credential types. Session claims are tied to the
  credential record read before asynchronous password verification, closing a
  concurrent revocation race.

## Verification and scope

- 28 server tests passed, including the complete Git backup/clone round-trip and
  new stream-error, session, origin, IPv6, and hostile-audit-input regressions.
- Both CLI askpass credential-boundary tests passed; server TypeScript checking
  passed.
- The production Docker image built successfully. An isolated container passed
  startup, SPA serving, unauthenticated API rejection, admin login, disabled
  production GitHub integration, foreign-origin rejection, and logout revocation.
- The dependency audit reports zero server advisories and the same five
  low-severity client affected-package entries described in the
  [first review](SECURITY_REVIEW_2026-10-27.md). No moderate, high, or critical npm
  advisory was reported. The IPv6 bug above demonstrates why this result alone
  is insufficient.
- Gitleaks 8.30.1, obtained from its official release and checksum-verified,
  scanned 26 reachable commits and a snapshot of the current source, including
  new files. Both scans identified only the existing artificial E2E JWT secret.
  No non-test credential was identified; no live credential was tested.
- GitHub's secret-scanning alerts endpoint returned an empty list. Its Dependabot
  alerts endpoint reported that alerts are disabled, so no clean Dependabot
  result is claimed.
- Review covered API authorization, SQL parameter binding, Git/CLI argument
  construction, repository names and revisions, file/image preview handling,
  Svelte rendering, local GitHub integration, and Docker/CI configuration.
  No additional confirmed unauthenticated code-execution or arbitrary-file-read
  path was identified in that review.

## Remaining risks and deployment limits

- The app has one admin and broad deploy tokens. A stolen token can read every
  active repository and push new content. There are no storage quotas or global
  Git-operation concurrency limits; resource exhaustion remains possible.
- Git/audit subprocesses and native dependencies remain part of the attack
  surface. The container runs as root inside the container. This review did not
  perform an OS-package vulnerability scan or container-escape assessment.
- Five low-severity client advisory entries remain. GitHub Dependabot alerts are
  disabled. Neither fact should be presented as a clean security certification.
- HTTPS, restrictive network access, correct proxy trust, strong credentials,
  and an independent consistent backup remain deployment responsibilities.
- NAS logs, live traffic, host permissions, installed container versions, and
  account activity were not investigated. These results do not establish
  whether a breach has happened.

For a deployment using `ghcr.io/shainyxyz/nashgit:latest`, take a consistent data
backup, then pull the patched image and recreate the container. A deployment
pinned to `2.0.0` must select a patched image or commit explicitly; restarting the
old image does not apply source changes.
