@echo off
REM Polls for port 3000 to come up as THIS dashboard, then opens it in the
REM default browser. Spawned by start-dashboard.bat so a fresh server start
REM doesn't block waiting for this to finish.
REM
REM Checks identity (see is-our-dashboard.bat), not just "something answers" -
REM start-dashboard.bat already refuses to start if a different app holds the
REM port, but this still waits for OUR server specifically rather than opening
REM a browser tab onto whichever app happens to answer first.

cd /d "%~dp0"

for /l %%i in (1,1,60) do (
  call "%~dp0is-our-dashboard.bat"
  if not errorlevel 1 (
    start "" "http://127.0.0.1:3000/"
    exit /b 0
  )
  timeout /t 1 >nul
)
