@echo off
REM Checks whether whatever is answering on port 3000 is actually this
REM dashboard, using the same x-eternalgy-app header electron/main.cjs checks
REM for the desktop app (see middleware.ts). Without this, every script below
REM that finds "something" on port 3000 assumed it was us - which is how a
REM different app (e.g. Agent CRM, built the same way and also defaulting to
REM port 3000) ended up being shown, or worse, force-killed by a rebuild.
REM
REM Exit code 0: port 3000 is answering AND it is this dashboard.
REM Exit code 1: port 3000 is not answering, or is answering as a different app.
REM Callers should not assume a non-zero exit means "safe to start on 3000" -
REM it may mean a different app already holds the port.

set "ETERNALGY_ID_FILE=%TEMP%\eternalgy-dashboard-identity.txt"
del /f /q "%ETERNALGY_ID_FILE%" >nul 2>&1

curl.exe -s -m 3 -o nul -D "%ETERNALGY_ID_FILE%" "http://127.0.0.1:3000/api/auth/me" >nul 2>&1

if not exist "%ETERNALGY_ID_FILE%" exit /b 1

findstr /I /C:"x-eternalgy-app: installation-ops" "%ETERNALGY_ID_FILE%" >nul 2>&1
set "ETERNALGY_ID_RESULT=%errorlevel%"
del /f /q "%ETERNALGY_ID_FILE%" >nul 2>&1
exit /b %ETERNALGY_ID_RESULT%
