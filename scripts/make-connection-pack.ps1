# Builds the connection pack handed to staff after they install from GitHub.
#
# The public installer ships no credentials - release assets on a public
# repository are downloadable by anyone, and PG_PROXY_TOKEN is full-access.
# So the connection travels separately, the way Commission hands over its .env.
#
# Two files land in C:\tmp\staff-connection:
#   connection.json     the six values, read from .env.local
#   CONNECT-THIS-PC.cmd double-click; copies the above into userData
#
# It goes to userData rather than beside the executable because an update
# replaces the program directory - a connection stored there would be wiped
# every time staff clicked Install Update.
#
# Send both files privately (WhatsApp, email, USB). Never commit them, never
# attach them to a release. They are about 2 KB, so they travel easily.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root '.env.local'
$outDir = 'C:/tmp/staff-connection'

if (-not (Test-Path $envFile)) { throw ".env.local not found next to the project." }

# Must match CONNECTION_KEYS in electron/main.cjs. Anything else stored beside
# them is ignored, so a typo here silently produces a pack that does nothing.
$keys = @(
  'PG_PROXY_URL', 'PG_PROXY_DATABASE', 'PG_PROXY_TOKEN',
  'PG_SOURCE_PROXY_URL', 'PG_SOURCE_PROXY_DATABASE', 'PG_SOURCE_PROXY_TOKEN'
)

$text = [System.IO.File]::ReadAllText($envFile).TrimStart([char]0xFEFF)
$values = [ordered]@{}
foreach ($key in $keys) {
  $m = [regex]::Match($text, ('(?m)^' + $key + '=(.*)$'))
  if ($m.Success -and $m.Groups[1].Value.Trim()) {
    $values[$key] = $m.Groups[1].Value.Trim()
  }
}

# The operational triple is what makes a connection. The source keys mirror it
# when absent (lib/source-api.ts falls back), so half a triple is not usable.
foreach ($required in @('PG_PROXY_URL', 'PG_PROXY_DATABASE', 'PG_PROXY_TOKEN')) {
  if (-not $values.Contains($required)) { throw "$required is missing from .env.local." }
}

# 'manual' rather than 'bundle': this was set outside any build, so
# reconcileUserConfig must leave it alone rather than treat it as a stale seed.
$values['configSource'] = 'manual'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$jsonPath = Join-Path $outDir 'connection.json'
$values | ConvertTo-Json | Set-Content -Path $jsonPath -Encoding utf8

# userData is %APPDATA%\<package.json name>. electron-builder strips the build
# block when packaging, so getName() falls back to "name" - not productName.
$cmd = @'
@echo off
REM Double-click me once, after installing Installation System from GitHub.
REM Connects this computer to the database. Nothing to type.
setlocal
set "TARGET=%APPDATA%\eternalgy-installation-ops"

if not exist "%TARGET%" mkdir "%TARGET%"
copy /y "%~dp0connection.json" "%TARGET%\connection.json" >nul
if errorlevel 1 (
  echo.
  echo   Could not write the connection. Is the app still open? Close it first.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. Open Installation System and sign in.
echo.
pause
'@
Set-Content -Path (Join-Path $outDir 'CONNECT-THIS-PC.cmd') -Value $cmd -Encoding ascii

$note = @'
CONNECTION PACK - Installation System

For staff who already installed the app from the GitHub releases page.

  1. Install Installation System from GitHub (if not done yet)
  2. Double-click CONNECT-THIS-PC.cmd
  3. Open the app and sign in

That is all. No address, no token, nothing to type.

SEND THESE FILES PRIVATELY - WhatsApp, email, USB.
Never commit them and never attach them to a GitHub release. The token inside
reaches the database directly, without going through the sign-in screen.

Updates: staff click Install Update in the dashboard as usual. This connection
lives outside the program folder, so updates never disturb it. Run this pack
once per computer, not once per update.
'@
Set-Content -Path (Join-Path $outDir 'READ-ME-FIRST.txt') -Value $note -Encoding ascii

Write-Host "Connection pack written to $outDir" -ForegroundColor Green
Write-Host ("  keys included: {0}" -f (($values.Keys | Where-Object { $_ -ne 'configSource' }) -join ', '))
Write-Host "  send these privately - never upload them" -ForegroundColor Yellow
