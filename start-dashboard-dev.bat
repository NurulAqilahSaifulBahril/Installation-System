@echo off
REM Starts the Eternalgy Installation Operations dashboard in DEVELOPMENT mode
REM This rebuilds on every file change and shows the latest code
REM Runs on http://127.0.0.1:3000/

cd /d "%~dp0"

echo [%date% %time%] Installing dependencies...
call npm.cmd install

echo [%date% %time%] Starting dashboard in development mode...
echo Dashboard will be available at http://127.0.0.1:3000/

REM Run in dev mode (watches for changes and rebuilds automatically)
call npm.cmd run dev
