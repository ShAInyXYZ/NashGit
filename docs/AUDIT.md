# NashGit audit protocol

NashGit audits Git objects with fixed, reviewable rules. It does not run project code, install dependencies, send files to an AI service, or contact a third party. Git pushes remain backups: an audit runs **after** a successful ref change and never blocks the push.

## What is scanned

- **Repository audit:** tracked files at the default branch tip. It checks paths, exact duplicate Git blobs, and eligible text content. It does not claim to cover every branch or historical commit.
- **Commit audit:** the commit message and added or modified files in that commit. It checks exact duplicates against the commit's full tree. Deleted content is not scanned.
- **Automatic runs:** a successful Git HTTP push queues a repository audit and audits for up to the 30 newest commits in the detected branch update. Detection uses one branch's reflog, so multi-branch and tag-only pushes are not exhaustively covered. Audit other commits manually from the repository Audit screen or each commit.

Each report records the revision, rulebook version, start and finish time, source, severity and rule counts, tracked/considered/scanned/binary/skipped file counts, bytes inspected, duplicate groups, and findings with file and line locations. The last 100 reports per repository and scope are retained in NashGit's SQLite data volume; the UI lists the 20 most recent. At most 32 audit jobs can wait or run at once. If the queue is full, Git pushes still succeed and the server logs that the audit was skipped.

## Rulebook v1

| ID | Signal | Severity |
|---|---|---|
| SEC-001 | Recognizable credential or private-key header | Critical |
| SEC-002 | Possible literal secret assignment | High |
| SEC-003 | Sensitive filename tracked | High |
| SAFE-001 | TLS certificate verification disabled | High |
| SAFE-002 | Download piped to a shell | Medium |
| SAFE-003 | Broad delete or permission command | Medium |
| NOISE-001 | Cache or generated directory tracked | Low |
| NOISE-002 | Transient log, backup, or OS file tracked | Low |
| SIZE-001 | Tracked file over 10 MiB | Low |
| DUP-001 | Exact duplicate blobs of at least 128 bytes | Low |

Findings are prompts for human review. A pattern match does not prove a live secret or exploitable bug. Unity `.meta` files are not classified as noise by themselves because they are part of a normal Unity project.

## Coverage and limits

The scanner reads at most 2,000 candidate files, 512 KiB per blob, 24 MiB of text content per run, and records at most 500 findings. Binary files are counted and checked by path, size, and object ID, but their content is not pattern scanned. Individual lines longer than 20,000 characters are omitted by the content rules; this omission currently does not change the report status. A report becomes **partial** when files or content exceed the file/byte/finding limits or cannot be read. Skipped paths and reasons are listed, capped at 50 display entries. A zero-finding report only means that no rule matched the covered material.

Matched file contents and source snippets are never stored in audit reports or returned by audit APIs. The report stores rule IDs, paths, line numbers, counts, and guidance; recognizable credential patterns in paths are redacted. Review a finding locally, then revoke a real exposed credential and remove it from Git history as appropriate. This scanner does not replace dependency analysis, language-aware static analysis, malware inspection, or a review of earlier Git history.
