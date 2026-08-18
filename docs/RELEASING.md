# Releasing

## The short version

1. Bump `"version"` in `package.json`
2. Commit and push
3. Double-click **`RELEASE.cmd`**
4. When it finishes, put the staff installer it names on OneDrive

That is the whole procedure. The rest of this page explains why there are two
installers, which matters the one time something looks wrong.

## Why two installers

This repository is **public**, and GitHub release assets inherit repository
visibility. Anything attached to a release can be downloaded by anyone who
finds the URL.

The database connection cannot go in a public download. `PG_PROXY_TOKEN` is a
full-access token, and it talks to the SQL proxy directly — the sign-in screen
does not stand in its way. Someone with that token reaches customer names,
addresses and payment records without ever opening the app.

So one version produces two builds:

| | Built by | Contains the database | Goes to |
|---|---|---|---|
| **Public** | GitHub Actions, on tag push | No | The releases page |
| **Staff** | Your machine, by `RELEASE.cmd` | Yes | OneDrive, share, USB |

`RELEASE.cmd` builds the staff one locally, checks it really is seeded, then
pushes the tag so CI builds the public one. It refuses to run on a dirty
working tree, because a tag that does not match its code is worse than no tag.

## What staff do

**First install** — once, from the copy you share:

1. Open the installer from OneDrive
2. Windows shows "Windows protected your PC" → **More info** → **Run anyway**
3. Sign in with the username and password you were given

No connection details, no token. The installer carries them.

**Every update after that** — the app checks on launch and shows
**Install Update (v…)** in the dashboard when one is ready. One click, it
restarts, done. Nobody reinstalls anything.

## Why an update does not disconnect them

Reasonable worry: staff run a seeded build, then auto-update to the public
key-free one. Does the connection vanish?

No. `electron/main.cjs` copies the bundled credentials into `userData` on first
boot, and updates replace the program directory, not `userData`. The public
build ships no credentials at all, and `reconcileUserConfig` returns early when
a build carries none — so it cannot blank out a connection that already works.

Rotating the token works the same way in reverse: build a staff installer with
the new value and the version bump carries it to machines already running.

## Rotating the database token

1. Rotate it at the proxy
2. Update `.env.local`
3. Bump the version, commit, run `RELEASE.cmd`
4. Share the new staff installer

Existing staff machines pick it up on their next update.

## If you ever make the repository private

Two things change, both easy to miss:

- **Auto-update stops silently.** `autoUpdater` has no credentials, so private
  release assets return 404 and the update button simply never appears — no
  error. It needs a fine-grained token (Contents: Read-only, this repo only)
  baked into the build.
- **Staff cannot download from the releases page** without being repository
  collaborators, which also gives them the source.

Going private does let CI seed the installer directly — the workflow allows it
once `github.event.repository.private` is true. The check in
`.github/workflows/release.yml` enforces the rule either way and fails loudly
rather than publishing something unsafe.

## Troubleshooting

**"v1.2.4 already exists"** — the version in `package.json` was already
released. Bump it.

**"Commit or stash first"** — uncommitted changes. The tag has to describe the
code it builds, or nothing reproduces later.

**"This build carries no .env.local"** — `.env.local` is missing or unreadable,
so the staff installer would have shipped without a connection. Nothing was
pushed.

**The release build failed on GitHub** — `gh run view --log-failed`. If it says
PG_* secrets are set on a public repository, delete those secrets: the seeded
installer is built locally now and no longer needs them.
