@echo off
REM Polls for port 3000 to come up, then opens the dashboard in the default
REM browser. Spawned by start-dashboard.bat so a fresh server start doesn't
REM block waiting for this to finish.

for /l %%i in (1,1,60) do (
  netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
  if not errorlevel 1 (
    start "" "http://127.0.0.1:3000/"
    exit /b 0
  )
  timeout /t 1 >nul
)
