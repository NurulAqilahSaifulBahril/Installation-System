# Cuts a release. One version, two installers, only one of them published:
#
#   PUBLIC  - built by GitHub Actions when this script pushes the tag. No
#             credentials, because no PG_* secrets are set and .github/workflows
#             /release.yml refuses to seed on a public repository. This is the
#             download on the releases page and the feed auto-update polls.
#
#   STAFF   - built here, with .env.local present, so it carries the database
#             connection. Staff install it and type nothing. Hand it over
#             privately (OneDrive, share, USB). Never upload it.
#
# A staff install keeps working across public updates: electron/main.cjs copies
# the bundled credentials into userData on first boot, and the public build
# ships none, so it can never blank out a connection that already works.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$outDir = 'C:/tmp/installation-system-release'
$staffDir = 'C:/tmp/staff-seeded-build'
$envFile = Join-Path $root '.env.local'

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
  throw "Commit or stash first, so $tag reflects the code it builds."
}

if (-not (Test-Path $envFile)) {
  throw ".env.local not found - cannot build the staff installer."
}

# --- 1. staff installer, built here ---------------------------------------

Write-Host "`n[1/3] Building the STAFF installer (database included)..." -ForegroundColor Cyan
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "Staff build failed." }

$exe = Join-Path $outDir "Installation-System-Setup-$version.exe"
if (-not (Test-Path $exe)) { throw "Build produced no installer." }

# Confirm it is actually seeded rather than trusting that .env.local was read -
# an unseeded copy handed to staff sends them hunting for a token.
if (-not (Test-Path (Join-Path $outDir 'win-unpacked/resources/app/.env.local'))) {
  throw "This build carries no .env.local, so staff would have to type a token."
}

New-Item -ItemType Directory -Force -Path $staffDir | Out-Null
Copy-Item $exe $staffDir -Force
Write-Host "      staff installer -> $staffDir" -ForegroundColor Green

# --- 2. push the tag; GitHub builds the public one ------------------------

Write-Host "`n[2/3] Pushing $tag - GitHub builds the public installer..." -ForegroundColor Cyan
git push origin HEAD
git tag $tag
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Could not push $tag." }

# --- 3. wait and report ---------------------------------------------------

Write-Host "`n[3/3] Waiting for the build (about 5 minutes)..." -ForegroundColor Cyan
gh run watch --exit-status (gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
if ($LASTEXITCODE -ne 0) {
  throw "The release build failed. Check: gh run view --log-failed"
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  public : https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/tag/$tag"
Write-Host "  staff  : $staffDir\Installation-System-Setup-$version.exe" -ForegroundColor Yellow
Write-Host "           ^ share privately - never upload this one" -ForegroundColor Yellow
