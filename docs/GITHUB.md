# GitHub from NashGit

The local NashGit development UI has a **Github** tab. It reads the GitHub CLI (`gh`) login on the machine that runs the NashGit server. It never asks for, stores, or displays a GitHub token.

## Daily flow

1. Run `gh auth login -h github.com` on the local development machine if the tab says login is needed.
2. Open **Github**, choose a NashGit repository, and link an existing GitHub repository. You can also create an empty **private** GitHub repository from the tab.
3. Review the source and destination branch hashes, GitHub visibility, and sync status.
4. Select **Push this branch to GitHub**. A public repository requires an extra acknowledgement.

The action pushes the NashGit repository's default branch to a branch of the same name on GitHub. It does not push tags or other branches, force push, delete refs, pull from GitHub, or alter the local project checkout. If GitHub has commits NashGit cannot prove are ancestors of the selected commit, sync is blocked. The server rechecks both branch hashes immediately before pushing and verifies the resulting GitHub hash afterward.

Only the local `npm run dev:local` server enables this integration. The NAS service cannot read a visitor's computer login. A future NAS deployment needs its own explicit GitHub authentication design; this local implementation does not silently use or change NAS credentials.

GitHub repository links and last successful sync metadata live in the local development database. The GitHub CLI remains the credential source. Git operations use the CLI credential helper for that invocation without changing the machine's global Git configuration.
