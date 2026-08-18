@echo off
REM AGGRESSIVE CLEAN START - Clears ALL caches and rebuilds from scratch
REM Use this when changes aren't showing up

cd /d "%~dp0"

echo.
echo ========================================
echo CLEAN START - Removing all caches
echo ========================================
echo.

REM Kill port 3000
echo Stopping any process on port 3000...
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
  )
  timeout /t 2 /nobreak >nul
)

REM Delete build caches
echo Deleting .next build folder...
if exist ".next" rmdir /s /q ".next" >nul 2>&1

echo Deleting .next-build folder...
if exist ".next-build" rmdir /s /q ".next-build" >nul 2>&1

echo Deleting node_modules folder...
if exist "node_modules" rmdir /s /q "node_modules" >nul 2>&1

echo Deleting package-lock.json...
if exist "package-lock.json" del /f /q "package-lock.json" >nul 2>&1

echo.
echo ========================================
echo Installing fresh dependencies
echo ========================================
echo.
call npm.cmd install
if %errorlevel% neq 0 (
  echo ERROR: npm install failed
  pause
  exit /b %errorlevel%
)

echo.
echo ========================================
echo Building fresh version
echo ========================================
echo.
call npm.cmd run build
if %errorlevel% neq 0 (
  echo ERROR: npm build failed
  pause
  exit /b %errorlevel%
)

echo.
echo ========================================
echo Starting dashboard
echo ========================================
echo.
call npm.cmd run start
