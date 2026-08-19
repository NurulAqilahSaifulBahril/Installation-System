# Releasing and setting up staff computers

The repository is **private**, so release assets are private too. That is what
lets the installer carry the database connection: a new computer installs it
and works with nothing to type.

## Cutting a release

1. Bump `"version"` in `package.json`
2. Commit
3. Double-click **`RELEASE.cmd`**

About eight minutes. It builds the installer here, checks the database and the
update token actually made it in, then publishes to the releases page.

It refuses to run if the repository is public, if the working tree is dirty, or
if either token is missing - each of those would otherwise produce a release
that looks fine and is not.

## Setting up a new computer

1. Download the installer from the
   [releases page](https://github.com/NurulAqilahSaifulBahril/Installation-System/releases)
   (the staff member needs to be a repository collaborator)
2. Windows shows "Windows protected your PC" -> **More info** -> **Run anyway**
3. Open the app and sign in

No address, no database name, no token. The connection is inside the installer,
and the app copies it into `userData` on first boot so updates never lose it.

## Updating

Staff click **Install Update (v…)** in the dashboard. It downloads, restarts,
done. Nobody reinstalls.

## What is in .env.local

Seven values. Six are the database connection. The seventh is the update token:

```
UPDATE_GITHUB_TOKEN=github_pat_...
```

Private release assets are not readable without credentials, so a build without
this token checks for updates, gets 404, and reports "no update available"
forever - silently. Create it under Settings > Developer settings > Personal
access tokens > Fine-grained, scoped to this repository only, Contents:
Read-only.

`.env.local` is gitignored and must stay that way.

## Rotating the database token

1. Rotate it at the proxy
2. Update `.env.local`
3. Bump the version, commit, run `RELEASE.cmd`

Existing computers pick it up on their next update: `reconcileUserConfig` in
`electron/main.cjs` refreshes the stored copy whenever a build ships different
credentials, which is what stops a rotation stranding machines on a dead token.

## Why CI does not build releases

`.github/workflows/release.yml` no longer runs on a tag. The runner has no
`.env.local`, so it would build a key-free installer and publish it over the
seeded one - new computers would silently get a build with no database. The
workflow is kept for manual dispatch only.

## If you ever make the repository public again

`RELEASE.cmd` will stop and refuse to publish. That is deliberate: the
installer contains a full-access database token, and on a public repository
anyone who found the release URL could download it and reach customer names,
addresses and payment records without going near the sign-in screen.

To publish from a public repository, build without `.env.local` present - that
produces a key-free installer, and staff then need the connection some other
way.

## Troubleshooting

**"STOPPED: the repository is PUBLIC"** - exactly the case above. Make it
private again, or build key-free.

**"UPDATE_GITHUB_TOKEN is missing"** - add the line to `.env.local`. Without it
staff never receive updates.

**"v1.2.5 already exists"** - bump the version.

**Staff cannot download the installer** - they are not a collaborator. Settings
> Collaborators > Add people.

**Staff stopped receiving updates after going private** - builds made before
the token existed cannot read private assets. Install the current version by
hand once on those machines; auto-update works again afterwards.
