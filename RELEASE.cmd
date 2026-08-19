@echo off
REM Double-click me to publish a new version.
REM
REM Bump "version" in package.json and commit first.
REM GitHub builds and publishes the installer - about 4 minutes.
REM
REM The published installer has no database in it. Staff connect their
REM computer once with the pack from scripts\make-connection-pack.ps1.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1"
echo.
pause
