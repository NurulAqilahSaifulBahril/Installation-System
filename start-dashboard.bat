@echo off
REM Starts the Eternalgy Installation Operations dashboard on http://127.0.0.1:3000/
REM Used both for manual double-click starts and by the "EternalgyInstallationDashboard"
REM scheduled task (via start-dashboard-hidden.vbs), which also re-runs this every
REM 5 minutes as a health check.
REM
REM Two logs on purpose: the running server holds dashboard-server.log open for
REM append, so watchdog runs cannot write there.
REM   dashboard-startup.log - guard / watchdog messages
REM   dashboard-server.log  - Next.js server output

cd /d "%~dp0"

REM If something is already serving port 3000, do nothing.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] Port 3000 already serving - nothing to do. >> dashboard-startup.log
  exit /b 0
)

REM Build once if the production build is missing (e.g. after a clean checkout).
if not exist ".next-build\BUILD_ID" (
  echo [%date% %time%] No production build found - running npm run build... >> dashboard-startup.log
  call npm.cmd run build >> dashboard-startup.log 2>&1
)

echo [%date% %time%] Port 3000 free - starting dashboard. >> dashboard-startup.log
call npm.cmd run start >> dashboard-server.log 2>&1

echo [%date% %time%] Dashboard process exited with code %errorlevel%. >> dashboard-startup.log
exit /b %errorlevel%
