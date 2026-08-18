@echo off
REM Double-click me to cut a release.
REM
REM Builds two installers from the version in package.json:
REM   - the staff copy, with the database built in, left in C:\tmp\staff-seeded-build
REM   - the public copy, with no credentials, uploaded to GitHub
REM
REM Share the staff copy privately. Never upload it.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1"
echo.
pause
