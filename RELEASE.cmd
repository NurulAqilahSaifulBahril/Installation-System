@echo off
REM Double-click me to publish a new version.
REM
REM Bump "version" in package.json and commit first.
REM
REM Builds the installer here (about 8 minutes) with the database inside it,
REM then publishes it to the private releases page. Staff download it and
REM sign in - nothing to type.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1"
echo.
pause
