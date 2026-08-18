@echo off
REM Starts the Eternalgy Installation Operations dashboard on http://127.0.0.1:3000/
REM Used both for manual double-click starts and by the "EternalgyInstallationDashboard"
REM scheduled task (via start-dashboard-hidden.vbs), which also re-runs this every
REM 5 minutes as a health check.
REM
REM IMPORTANT: this must stay a cheap no-op when the dashboard is already
REM healthy. The watchdog invokes it every 5 minutes — if this script rebuilds
REM unconditionally, the watchdog kills a perfectly good server and leaves the
REM dashboard down for the 1-3 minutes every build takes, on a 5-minute cycle.
REM To pick up new code, run rebuild-dashboard.bat by hand instead.
REM
REM Two logs on purpose: the running server holds dashboard-server.log open for
REM append, so watchdog runs cannot write there.
REM   dashboard-startup.log - guard / watchdog messages
REM   dashboard-server.log  - Next.js server output
REM
REM The hidden watchdog (start-dashboard-hidden.vbs) sets DASHBOARD_WATCHDOG=1
REM before launching this, so its silent 5-minute health checks never pop open
REM a browser tab. A manual double-click has no such variable set, so it does.

cd /d "%~dp0"
if defined DASHBOARD_WATCHDOG (set "OPEN_BROWSER=0") else (set "OPEN_BROWSER=1")

REM If something is already serving port 3000, do nothing (but show the user
REM it's up, since this is almost always a manual double-click checking on it).
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] Port 3000 already serving - nothing to do. >> dashboard-startup.log
  if "%OPEN_BROWSER%"=="1" start "" "http://127.0.0.1:3000/"
  exit /b 0
)

REM Build once if the production build is missing (e.g. after a clean checkout).
if not exist ".next-build\BUILD_ID" (
  echo [%date% %time%] No production build found - running npm run build... >> dashboard-startup.log
  call npm.cmd run build >> dashboard-startup.log 2>&1
)

echo [%date% %time%] Port 3000 free - starting dashboard. >> dashboard-startup.log

REM npm run start blocks until the server stops, so open the browser from a
REM background poller that waits for port 3000 to come up instead of waiting
REM for this line to return.
if "%OPEN_BROWSER%"=="1" start "" /min "%~dp0open-dashboard-when-ready.bat"

call npm.cmd run start >> dashboard-server.log 2>&1

echo [%date% %time%] Dashboard process exited with code %errorlevel%. >> dashboard-startup.log
exit /b %errorlevel%
