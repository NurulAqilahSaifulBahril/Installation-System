@echo off
REM Diagnostic script to check build status

cd /d "%~dp0"

echo.
echo ========================================
echo BUILD STATUS CHECK
echo ========================================
echo.

echo Checking for material-verification files:
echo.

if exist "..\..\..\src\app\(app)\material-verification\page.tsx" (
  echo [OK] page.tsx exists
) else (
  echo [MISSING] page.tsx NOT FOUND
)

if exist "..\..\..\src\app\(app)\material-verification\material-verification-client.tsx" (
  echo [OK] material-verification-client.tsx exists
) else (
  echo [MISSING] material-verification-client.tsx NOT FOUND
)

if exist "..\..\..\src\app\(app)\material-verification\actions.ts" (
  echo [OK] actions.ts exists
) else (
  echo [MISSING] actions.ts NOT FOUND
)

if exist "..\..\..\src\app\(app)\material-verification\components\ScanBarcodeModal.tsx" (
  echo [OK] ScanBarcodeModal.tsx exists
) else (
  echo [MISSING] ScanBarcodeModal.tsx NOT FOUND
)

echo.
echo Checking for build artifacts:
echo.

if exist ".next\BUILD_ID" (
  echo [OK] .next build folder exists
) else (
  echo [MISSING] .next build folder NOT FOUND
)

if exist ".next-build\BUILD_ID" (
  echo [OK] .next-build folder exists
) else (
  echo [MISSING] .next-build folder NOT FOUND
)

echo.
echo Recent logs:
echo.

if exist "dashboard-startup.log" (
  echo === Last 10 lines of dashboard-startup.log ===
  powershell -NoProfile -Command "Get-Content dashboard-startup.log | Select-Object -Last 10"
) else (
  echo [NO LOG] dashboard-startup.log not found
)

echo.
echo.
if exist "dashboard-server.log" (
  echo === Last 20 lines of dashboard-server.log ===
  powershell -NoProfile -Command "Get-Content dashboard-server.log | Select-Object -Last 20"
) else (
  echo [NO LOG] dashboard-server.log not found
)

pause
