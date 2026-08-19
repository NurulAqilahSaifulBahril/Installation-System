# Releasing and setting up staff computers

This follows the same pattern as the Commission repository: the repository and
its releases are public, the published installer carries no credentials, and
the database connection is handed over separately.

## Cutting a release

1. Bump `"version"` in `package.json`
2. Commit and push
3. Double-click **`RELEASE.cmd`**

That is all. Pushing the tag is what starts the build - GitHub compiles the
installer and publishes it with the user guide and checksums, about four
minutes. `RELEASE.cmd` refuses to run on a dirty working tree, because a tag
that does not match its code is worse than no tag.

## Setting up a staff computer

Once per computer:

1. Download the installer from the [releases page](https://github.com/NurulAqilahSaifulBahril/Installation-System/releases)
2. Windows shows "Windows protected your PC" -> **More info** -> **Run anyway**
3. Double-click **`CONNECT-THIS-PC.cmd`** from the connection pack you were sent
4. Open the app and sign in

No address, no database name, no token. Step 3 is the only extra step, and it
is never repeated - not even after an update.

To produce the pack:

```
powershell -File scripts\make-connection-pack.ps1
```

It reads `.env.local` and writes three small files to `C:\tmp\staff-connection`.
Send them privately - WhatsApp, email, USB. They are about 2 KB.

## Updating

Staff click **Install Update (v…)** in the dashboard when it appears. It
downloads, restarts, done. Nobody reinstalls and nobody re-runs the connection
pack.

The connection lives in `%APPDATA%\eternalgy-installation-ops\connection.json`,
outside the program folder, and an update only replaces the program folder. So
updates cannot disturb it.

## Why the installer has no database in it

Release assets inherit repository visibility. This repository is public, so
anything attached to a release can be downloaded by anyone who finds the URL.

`PG_PROXY_TOKEN` is a full-access token and it talks to the SQL proxy directly
- the sign-in screen does not stand in its way. Someone holding it reaches
customer names, addresses and payment records without opening the app.

So the installer ships key-free and the connection travels privately. The
workflow enforces this: `.github/workflows/release.yml` fails the build if PG_*
secrets are set while the repository is public, rather than quietly publishing
a seeded installer.

## Rotating the database token

1. Rotate it at the proxy
2. Update `.env.local`
3. Run `scripts\make-connection-pack.ps1`
4. Send the new pack; staff double-click `CONNECT-THIS-PC.cmd` again

No new release is needed - the token is not in the app.

## If you ever make the repository private

Two things change, both easy to miss:

- **Auto-update stops silently.** `autoUpdater` has no credentials, so private
  release assets return 404 and the update button simply never appears - no
  error message. It needs a fine-grained token (Contents: Read-only, this repo
  only) baked into the build.
- **Staff cannot download** from the releases page without being repository
  collaborators, which also gives them the source code.

Going private does let the build seed the installer directly, making the
connection pack unnecessary. The check in the workflow allows it once
`github.event.repository.private` is true.

## Troubleshooting

**"v1.2.5 already exists"** - that version was already released. Bump it.

**"Commit or stash first"** - uncommitted changes; the tag has to describe the
code it builds.

**"PG_* secrets are set while the repository is PUBLIC"** - delete them. The
build does not need them any more:

```
gh secret delete PG_PROXY_TOKEN
```

**Staff see "Could not reach the server. Is the database connection up?"** -
the connection pack was not run on that computer, or the app was open while it
ran. Close the app, double-click `CONNECT-THIS-PC.cmd`, reopen.

**A staff machine needs a different database** - the sign-in screen has a
Connection settings panel for typing values by hand. Anything entered there is
marked `manual` and is never overwritten by a pack or a build.
