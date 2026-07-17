---
name: nashgit
description: Back up, clone, push, and pull git repositories against a NashGit server (self-hosted git remote on a NAS) using the `nash` CLI. Use when the user works with a NashGit/NAS git remote, mentions `nash` commands, or wants to back up a local project to their own server. Handles auth via stored deploy tokens — never ask the user for their admin password to run git operations.
---

# NashGit — AI agent guide

NashGit is a self-hosted git remote (smart-HTTP, one port, token auth) running
on the user's NAS. The `nash` CLI wraps plain git with authentication already
wired in. **Always prefer `nash` commands over raw git commands when working
with a NashGit server.**

## Mental model

- The NAS is just a git remote: `http://<nas>:3000/git/<repo>.git`
- Git operations authenticate with a **deploy token** (`ngt_...`) as the HTTP
  Basic-auth password (username is ignored).
- `nash login` was already run once per machine: it stores the server URL and
  a deploy token in `~/.config/nashgit/config.json` (mode 0600) and embeds the
  token in every remote it creates. You do NOT need to handle credentials.
- Two different auth layers exist — do not confuse them:
  - **Admin login** (username + password): web UI and `nash login` only.
  - **Deploy tokens**: git push/pull/clone. This is what the CLI stores.

## Prerequisites check

Before anything, verify the CLI is installed and logged in:

```bash
nash status
```

- Prints `Server:` + `Token:` → ready.
- Prints "Not logged in" → tell the user to run `nash login <server-url>`
  interactively (it prompts for admin credentials). Do NOT ask for their
  password yourself to pass on a command line.
- Command not found → the CLI lives in this repo at `cli/nash.mjs`:
  `npm install -g ./cli` (from the repo root), or invoke `node cli/nash.mjs ...`
  directly.

## Commands (use these instead of git)

| Task | Command |
|---|---|
| List repos on the server | `nash list` |
| Create a repo on the server | `nash create <name> [-d "description"]` |
| Clone from the server | `nash clone <name> [directory]` |
| Push current branch | `nash push` |
| Pull current branch | `nash pull` |
| Show current server/token | `nash status` |
| Remove local credentials | `nash logout` |

Notes for agents:

- `nash create <name>` run **inside a git repo** also adds/updates the `nas`
  remote to point at the new repo — so `nash create my-app && nash push` is
  the full "back up this project" flow.
- `nash push` / `nash pull` operate on the current branch and prefer the
  `nas` remote, falling back to `origin`.
- Repo names must match `^[a-z0-9][a-z0-9._-]*$` (letters, digits, dot, dash,
  underscore; no leading dash) — sanitize user-provided names before creating.

## Common workflows

**Back up the current project to the NAS:**

```bash
cd <project>
nash create <project-name>   # creates repo on server + wires "nas" remote
nash push                    # first backup pushed
```

**Restore / set up a project on a new machine:**

```bash
nash clone <project-name>
cd <project-name>
```

**Daily sync:** `nash pull` before work, `nash push` after committing.

**See what is backed up:** `nash list`

## Fallback: plain git (if the CLI is unavailable)

Remotes created by `nash` embed the token in the URL, so plain
`git push` / `git pull` / `git fetch` keep working with no prompting — use
them freely on those repos. Only construct a remote URL yourself if the repo
was never wired by the CLI:

```bash
git remote add nas http://x:<deploy-token>@<nas>:3000/git/<repo>.git
```

Never invent a token, never use the admin password for git, and never commit
the token into files — it already lives in the remote URL and the CLI config.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `nash: Not logged in` | No config → user runs `nash login <server-url>` once |
| `Session expired` (401 on API) | The admin cookie aged out → `nash login` again; git ops (push/pull/clone) are unaffected because they use the deploy token |
| `Authentication required` from git | Token revoked in the UI → `nash login` to mint a new one |
| `Cannot reach <server>` | NashGit is down, or the device is off the tailnet/LAN — check Tailscale (see `docs/TAILSCALE.md`) |
| Push rejected | Repo doesn't exist on server → `nash create <name>` first |
