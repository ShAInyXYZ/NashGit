# Back up and restore NashGit data

NashGit's `/data` volume contains `nashgit.db` (SQLite metadata, tokens, commit notes, and audit reports), `repos/` (active bare repositories), and `trash/` (repositories moved out of the active list). Keep the whole volume together. A Git clone is useful for checking a project, but it does not preserve NashGit's admin account, tokens, push logs, commit notes, audit reports, or trash.

## Consistent offline backup

From the deployment directory, stop the container, copy the volume to a separate disk or snapshot, then start the container:

```bash
docker compose stop nashgit
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose start nashgit
```

If the volume uses a different host path, substitute that path. Keep the backup outside the live volume. Stopping the container ensures both Git repositories and SQLite's WAL are at rest. An online copy of only `nashgit.db` is incomplete when WAL is active.

## Restore drill

Test on a separate NashGit instance: stop it, copy the saved data directory into its volume, start it with the matching `NASHGIT_SECRET`, log in, inspect the repository list and trash, run Verify on a repository, and perform a fresh clone. Do not overwrite the production volume as a test.
