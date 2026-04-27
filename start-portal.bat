@echo off
REM FBBS Portal - Windows Launcher
REM Double-click to start the portal.

cd /d "%~dp0"

echo.
echo ================================================================
echo   FBBS Market Intelligence Portal
echo ================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo.
  echo Install the LTS from https://nodejs.org, then try again.
  echo.
  pause
  exit /b 1
)

REM Install dependencies on first run
if not exist "node_modules" (
  echo First-time setup: installing dependencies...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. See output above.
    pause
    exit /b 1
  )
  echo.
)

echo Starting portal...
echo Once running, open your browser to: http://localhost:3000
echo Press Ctrl+C in this window to stop.
echo.

node server\server.js
pause
