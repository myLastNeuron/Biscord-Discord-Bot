@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js not found. Install Node ^>=18.17.0.
  pause
  exit /b 1
)
where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo npm not found. Repair Node install.
  pause
  exit /b 1
)
node --version
call npm --version
call npm install
if %errorlevel% neq 0 (
  echo npm install failed. See output above.
  pause
  exit /b 1
)
if /I "%~1"=="--update" call npm update
if /I "%~1"=="-Update" call npm update
node scripts\ensure-deps.js
pause
endlocal
