# Builds the installer LOCALLY and publishes it to the private GitHub releases
# page. This is the fallback path - normally .github/workflows/release.yml
# does this automatically on every "git push origin vX.Y.Z" tag, seeding the
# database from repository secrets instead of this machine's .env.local. Use
# this script when CI isn't set up yet, is down, or you need to hand someone
# an installer before pushing a tag.
#
# The installer carries the database connection, so a new computer installs it
# and works with nothing to type. That is only safe because the repository is
# PRIVATE - release assets inherit repository visibility, and PG_PROXY_TOKEN is
# full-access, reaching customer and payment records without going near the
# sign-in screen. The visibility check below is not a formality: if the
# repository is ever made public again, publishing this file would put those
# credentials on an open URL, so the script stops instead.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$outDir = 'C:/tmp/installation-system-release'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$tag = "v$version"
Write-Host "Releasing $tag" -ForegroundColor Cyan

# --- preflight -------------------------------------------------------------

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Not signed in to GitHub. Run: gh auth login" }

$visibility = (gh repo view --json visibility | ConvertFrom-Json).visibility
if ($visibility -ne 'PRIVATE') {
  throw @"
STOPPED: the repository is $visibility.

This installer contains live database credentials. Attaching it to a release
on a $visibility repository would let anyone who finds the URL download them,
reaching customer names, addresses and payment records.

Make the repository private again, or build without .env.local for a key-free
installer that is safe to publish.
"@
}
Write-Host "  repository is PRIVATE - assets will not be publicly readable"

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

$envFile = Join-Path $root '.env.local'
if (-not (Test-Path $envFile)) {
  throw ".env.local not found - the installer would ship with no database."
}

# Without this the app checks for updates, gets 404 from the private release
# feed, and reports "no update available" forever. Nothing looks broken, so it
# would only surface when a fix failed to reach anyone.
if (-not (Select-String -Path $envFile -Pattern '^UPDATE_GITHUB_TOKEN=.+' -Quiet)) {
  throw @"
UPDATE_GITHUB_TOKEN is missing from .env.local.

Staff would never be offered an update. Create a fine-grained token
(Settings > Developer settings > Personal access tokens > Fine-grained):

  Repository access : Only select repositories -> Installation-System
  Permissions       : Contents -> Read-only

then add one line to .env.local:

  UPDATE_GITHUB_TOKEN=github_pat_...
"@
}

# --- build -----------------------------------------------------------------

Write-Host "`n[1/3] Building the installer (about 8 minutes)..." -ForegroundColor Cyan
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$exe = Join-Path $outDir "Installation-System-Setup-$version.exe"
$blockmap = "$exe.blockmap"
$latest = Join-Path $outDir 'latest.yml'
foreach ($f in @($exe, $blockmap, $latest)) {
  if (-not (Test-Path $f)) { throw "Missing expected artifact: $f" }
}

# --- verify ----------------------------------------------------------------

Write-Host "`n[2/3] Checking the build..." -ForegroundColor Cyan

$packed = Join-Path $outDir 'win-unpacked/resources/app/.env.local'
if (-not (Test-Path $packed)) {
  throw "The installer carries no .env.local - a new computer would have nothing to connect with."
}
foreach ($needed in @('PG_PROXY_TOKEN', 'UPDATE_GITHUB_TOKEN')) {
  if (-not (Select-String -Path $packed -Pattern "^$needed=.+" -Quiet)) {
    throw "$needed did not make it into the build."
  }
}
Write-Host "      database and update token are both in the build" -ForegroundColor Green

# latest.yml must name the artifact exactly - electron-updater matches on the
# filename, and a mismatch means every update check 404s.
if (-not (Select-String -Path $latest -Pattern ([regex]::Escape("Installation-System-Setup-$version.exe")) -Quiet)) {
  throw "latest.yml does not name Installation-System-Setup-$version.exe - auto-update would break."
}
Write-Host "      latest.yml matches the artifact name" -ForegroundColor Green

$sums = Join-Path $outDir 'SHA256SUMS.txt'
$lines = foreach ($f in @($exe, $blockmap, $latest)) {
  "$((Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLower())  $(Split-Path $f -Leaf)"
}
$lines | Set-Content -Path $sums -Encoding ascii

# --- publish ---------------------------------------------------------------

Write-Host "`n[3/3] Publishing to the private releases page..." -ForegroundColor Cyan

$guide = Join-Path $root 'Installation Desktop app_user_guide.pdf'
$assets = @($exe, $blockmap, $latest, $sums)
if (Test-Path $guide) { $assets += $guide }

git push origin HEAD
git tag $tag
git push origin $tag

$notes = @"
## Installation System $tag

**Windows**: Installation-System-Setup-$version.exe

A new computer installs this and signs in - the database connection is already
inside, nothing to type.

Existing computers: click **Install Update** in the dashboard instead.

Windows will show a "Windows protected your PC" warning on first run - click
**More info**, then **Run anyway**.
"@

gh release create $tag @assets --title $tag --notes $notes
if ($LASTEXITCODE -ne 0) { throw "Publishing failed." }

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  https://github.com/NurulAqilahSaifulBahril/Installation-System/releases/tag/$tag"
Write-Host "  Staff download from that page and sign in. Nothing to type." -ForegroundColor Cyan
