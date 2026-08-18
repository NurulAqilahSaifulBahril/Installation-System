@echo off
REM Run this by hand whenever you've changed code and want the dashboard to
REM pick it up. Stops the running server, rebuilds, and starts it again.
REM Safe to run any time - the watchdog will just find it already healthy
REM on its next 5-minute check and leave it alone.

cd /d "%~dp0"

echo Stopping the running dashboard (if any)...
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
  )
  timeout /t 2 /nobreak >nul
)

echo Installing dependencies...
call npm.cmd install
if %errorlevel% neq 0 (
  echo npm install failed - stopping.
  pause
  exit /b %errorlevel%
)

echo Building latest version...
call npm.cmd run build
if %errorlevel% neq 0 (
  echo Build failed - the dashboard is NOT running. Fix the error above and re-run this script.
  pause
  exit /b %errorlevel%
)

echo Starting dashboard...
start "" /min "%~dp0open-dashboard-when-ready.bat"
call npm.cmd run start >> dashboard-server.log 2>&1
