---
name: nashgit
description: Use NashGit as a self-hosted Git backup remote from Codex or Claude. Apply when the user asks to create, back up, push, pull, clone, verify, or restore a NashGit repository.
---

# NashGit

NashGit stores bare Git repositories on the user's NAS. The `nash` CLI reads `~/.config/nashgit/config.json` (mode 0600). Deploy tokens authenticate Git over HTTP Basic; the admin session is only for UI and API actions such as creating repositories. Use the configured Tailnet HTTPS URL when available.

## Check before acting

Run `nash status` to inspect the configured server without displaying the token. If the CLI is absent, install it from the NashGit repository with `npm install -g ./cli`, or use `node cli/nash.mjs`. If configuration is absent, ask the user to run `nash login <server-url>` interactively. Never request a token or password in chat, print it, put it in a command argument, or place it in a Git remote URL.

Inspect the current repository and its `nas` remote before pushing. List remote names with `git remote`. To inspect a URL, redact its userinfo before it reaches agent output, for example `git config --get remote.nas.url | sed -E 's#(https?://)[^/]*@#\1[redacted]@#'`. `nash` requires a `nas` remote for push, pull, and backup. Check that it points to the intended NashGit repository. A remote created by an older CLI may contain credentials; replace its URL with a credential-free URL before showing or recording it.

## Workflows

| Goal | Command |
|---|---|
| List server repositories | `nash list` (requires a current admin session) |
| Create server repository and wire `nas` remote | `nash create <name>` (requires a current admin session) |
| Back up all local branches and tags | `nash backup` |
| Push current branch | `nash push` |
| Pull current branch | `nash pull` |
| Clone | `nash clone <name> [directory]` |
| Show configured server and token prefix | `nash status` |

For a new project, create commits first, then run `nash create <name>` inside its Git working tree and `nash backup`. `nash backup` pushes all **local** branches and tags. It does not include uncommitted files, ignored files, Git LFS objects unless LFS is separately configured, or other data outside Git. Verify backup with a fresh clone or the repository's Verify action in the UI. Before any restore that might overwrite local work, inspect the destination and preserve existing files.

Server repositories moved to Trash can be restored in the Repositories UI; Git operations to them stop until restoration. Back up the NAS `/data` volume separately, including the SQLite database, repositories, and trash. Use a container-stop copy or a coordinated SQLite backup procedure; do not copy only the live `.db` file while WAL is active.

## Access and authorization

A configured token does not grant general NAS filesystem access. Respect the user's permission boundary for remote writes: inspect freely when authorized, but obtain explicit permission before deploying NashGit, changing NAS configuration, deleting data, or pushing a repository if that push was not requested. Do not rotate or revoke existing tokens unless requested. Avoid force push and branch deletion; the server rejects both to protect backups.

If `nash list` or `nash create` returns 401, the admin session expired. The user can run `nash login` again, or create the repo in the web UI and set a credential-free `nas` remote. If a Git request fails, check Tailnet reachability and whether the deploy token is valid; do not expose the token in diagnostics.
