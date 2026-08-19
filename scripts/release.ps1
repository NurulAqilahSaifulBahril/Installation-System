# Cuts a release, the way the Commission repository does it.
#
# The installer published to GitHub carries no credentials. Release assets on a
# public repository can be downloaded by anyone, and PG_PROXY_TOKEN is
# full-access - it reaches the database directly, without going through the
# sign-in screen. So the connection travels separately, as a 2 KB pack built by
# scripts/make-connection-pack.ps1 and sent privately.
#
# Staff therefore do this once per computer:
#   1. install from the GitHub releases page
#   2. double-click CONNECT-THIS-PC.cmd from the pack
# and after that only ever click Install Update in the dashboard.
#
# This script does not build anything itself. Pushing the tag is what starts
# the build; .github/workflows/release.yml compiles the installer and publishes
# it, and refuses to seed credentials while the repository is public.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$tag = "v$version"
Write-Host "Releasing $tag" -ForegroundColor Cyan

# --- preflight -------------------------------------------------------------

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Not signed in to GitHub. Run: gh auth login" }

gh release view $tag --json tagName 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  throw "$tag already exists. Bump the version in package.json, commit, then run me again."
}

$dirty = git status --porcelain
if ($dirty) {
  Write-Host "  Uncommitted changes - the tag would not match what ships:" -ForegroundColor Yellow
  git status --short
  throw "Commit or stash first, so $tag describes the code it builds."
}

# Secrets plus a public repository is what the workflow refuses to build. Catch
# it here instead, before a tag exists that has to be deleted afterwards.
$visibility = (gh repo view --json visibility | ConvertFrom-Json).visibility
$secrets = gh secret list 2>$null
if ($visibility -eq 'PUBLIC' -and $secrets) {
  throw @"
PG_* secrets are set while the repository is PUBLIC.

The build would refuse to run. Remove them - the connection is delivered by
the connection pack now, so the build does not need them:

  gh secret delete PG_PROXY_TOKEN
"@
}

Write-Host "  repository is $visibility, no blocking secrets"

# --- push the tag; GitHub builds and publishes ----------------------------

Write-Host "`n[1/2] Pushing $tag..." -ForegroundColor Cyan
git push origin HEAD
git tag $tag
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Could not push $tag." }

Write-Host "`n[2/2] Waiting for the build (about 4 minutes)..." -ForegroundColor Cyan
$runId = gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch --exit-status $runId
if ($LASTEXITCODE -ne 0) {
  throw "The release build failed. Check: gh run view $runId --log-failed"
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/tag/$tag"
Write-Host ""
Write-Host "  Staff already running the app just click Install Update." -ForegroundColor Cyan
Write-Host "  A new computer installs from that page, then runs CONNECT-THIS-PC.cmd once." -ForegroundColor Cyan
Write-Host "  Need a fresh pack? powershell -File scripts\make-connection-pack.ps1" -ForegroundColor Cyan
