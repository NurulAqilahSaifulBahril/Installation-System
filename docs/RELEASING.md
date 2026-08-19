# Releasing and setting up staff computers

The repository is **private**, so release assets are private too. That is what
lets the installer carry the database connection: a new computer installs it
and works with nothing to type.

## Cutting a release

1. Bump `"version"` in `package.json`
2. Commit and push
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

That's it. GitHub Actions (`.github/workflows/release.yml`) builds the
installer, seeds the database connection from repository secrets, checks the
database and update token actually made it in, then publishes to the releases
page. No local machine or `.env.local` needed - see
[Repository secrets](#repository-secrets) below for one-time setup.

It refuses to publish if the repository is public or if a required secret is
missing - each of those would otherwise produce a release that looks fine and
is not.

### Building locally instead

`RELEASE.cmd` (double-click, or `scripts/release.ps1`) still works as a
fallback - it builds on this machine from `.env.local` and pushes the tag
itself. Useful if CI is down, secrets aren't set up yet, or you want to hand an
installer to someone before pushing anything.

## Repository secrets

One-time setup, in **Settings > Secrets and variables > Actions**, tab
**"Secrets"** (not "Variables", not an Environment - the workflow declares no
environment so it cannot read Environment-scoped secrets). Names are
case-sensitive and must match exactly:

| Secret | Required | Source |
| --- | --- | --- |
| `PG_PROXY_URL` | yes | `.env.local` |
| `PG_PROXY_DATABASE` | yes | `.env.local` |
| `PG_PROXY_TOKEN` | yes | `.env.local` |
| `PG_SOURCE_PROXY_URL` | optional | `.env.local` |
| `PG_SOURCE_PROXY_DATABASE` | optional | `.env.local` |
| `PG_SOURCE_PROXY_TOKEN` | optional | `.env.local` |
| `UPDATE_GITHUB_TOKEN` | yes (for auto-update) | see below |

Enter each value directly in the GitHub UI, or from your own terminal with the
GitHub CLI (never paste a secret value into chat with an assistant):

```
gh secret set PG_PROXY_URL --repo NurulAqilahSaifulBahril/Installation-System
```

(running with no `--body` prompts for the value on stdin, so it never lands in
shell history).

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
2. Update the `PG_PROXY_TOKEN` repository secret (and `.env.local`, if you
   still build locally sometimes)
3. Bump the version, commit, tag and push

Existing computers pick it up on their next update: `reconcileUserConfig` in
`electron/main.cjs` refreshes the stored copy whenever a build ships different
credentials, which is what stops a rotation stranding machines on a dead token.

## Why CI can build releases

`.github/workflows/release.yml` runs on every `v*` tag push. It seeds
`.env.local` itself from the repository secrets above before building, so it
produces the same database-seeded installer `RELEASE.cmd` used to build by
hand. This is only safe because the repository is private - see the guard
below.

## If you ever make the repository public again

Both the workflow and `scripts/release.ps1` check repository visibility first
and refuse to publish. That is deliberate: the installer contains a
full-access database token, and on a public repository anyone who found the
release URL could download it and reach customer names, addresses and payment
records without going near the sign-in screen.

To publish from a public repository, remove the `PG_*` secrets (or build
without `.env.local` present for a local build) - that produces a key-free
installer, and staff then need the connection some other way.

## Troubleshooting

**Pushed a tag but no release appeared** - check the
[Actions tab](https://github.com/NurulAqilahSaifulBahril/Installation-System/actions)
for a failed or missing run. Most likely one of: the repository secrets above
aren't set yet, the tag doesn't match `v*`, or the run failed a check - open
the run's logs, each failure names exactly what's missing.

**"STOPPED: the repository is PUBLIC"** - exactly the case above. Make it
private again, or build key-free.

**"UPDATE_GITHUB_TOKEN is missing"** - add it as a repository secret (for CI
builds) and/or as a line in `.env.local` (for local builds). Without it staff
never receive updates.

**"v1.2.5 already exists"** - bump the version.

**Staff cannot download the installer** - they are not a collaborator. Settings
> Collaborators > Add people.

**Staff stopped receiving updates after going private** - builds made before
the token existed cannot read private assets. Install the current version by
hand once on those machines; auto-update works again afterwards.
