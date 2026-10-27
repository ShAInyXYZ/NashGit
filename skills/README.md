# NashGit skill for Codex and Claude

The shared [`nashgit/SKILL.md`](nashgit/SKILL.md) teaches coding agents to back up, push, pull, clone, verify, and restore projects using NashGit.

From the repository root, install a copy for either agent:

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
cp -r skills/nashgit ~/.codex/skills/
cp -r skills/nashgit ~/.claude/skills/
```

Use either destination alone if you only use one agent. Restart the agent after installation. The skill contains no credentials. The CLI stores its token separately in `~/.config/nashgit/config.json`.
