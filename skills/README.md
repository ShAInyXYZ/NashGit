# NashGit agent skills

This directory contains skills that teach AI coding agents how to use NashGit.

## `nashgit/`

Teaches an agent to use the `nash` CLI (instead of raw git) when working
against a NashGit server: how to check login state, create repos, clone, push,
pull, and how to recover from common errors.

### Install

**Claude Code / Kimi Code / compatible agents** — symlink or copy the skill
directory into your skills path:

```bash
# User scope (available in every project)
cp -r skills/nashgit ~/.claude/skills/

# Or project scope (only in this repo)
mkdir -p .claude/skills && cp -r skills/nashgit .claude/skills/
```

**Other agents** — point your agent at `nashgit/SKILL.md`, or paste its
contents into your agent's system/instruction file (`AGENTS.md`,
`.cursorrules`, etc.).

Once installed, the agent will automatically use `nash clone`, `nash push`,
`nash pull`, etc. when it needs to interact with your NAS git remote.
