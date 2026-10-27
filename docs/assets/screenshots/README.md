# Screenshot provenance

Captured on 2026-10-27 from the local development UI at code revision `42a9f31`.
The browser's normal viewport was 1280 × 720; full-page captures include content
below the fold and may have a narrower width because of the scrollbar.

These are actual browser screenshots, with no generated UI or pixel retouching.
The database is an isolated demo under `.local-dev/readme-demo`, not a NAS instance.
The application UI and underlying repositories use fictional projects:

- `garden-api`: a JavaScript watering helper, two commits, a second branch, a tag,
  two passing tests, and a commit note.
- `weather-station`: a Python averaging helper and a deliberately tracked `.env`
  containing only `APP_ENV=demo`, used to demonstrate the sensitive-file rule.
- `dotfiles`: example shell aliases and editor settings.
- `recipe-book`: a small Markdown recipe.

Backup timestamps were seeded to show different ages. Names, repository descriptions,
and token names are demo content. The token screenshot shows prefixes only. No real
GitHub account was connected, and no NAS deployment was changed.

Basic checks completed: admin login, Git HTTP pushes of branches and a tag, branch
selection, commit/diff display, notes display, UI integrity verification, automatic
and manual audits, token-list display, and a fresh clone whose hash matches the source.
Both JavaScript tests also passed in the fresh clone.

The development console emitted SvelteKit's existing warning about using global
`fetch` from a load function. No browser error was recorded during these checks.
The repository table uses horizontal scrolling when its columns do not fit; the
capture preserves that actual behavior. These checks are a smoke test, not an
exhaustive browser or accessibility test.

The six JPEG files replace the older PNG captures. The settings capture was removed
because it exposed a machine-specific data-directory path and is not needed for the
README walkthrough.
