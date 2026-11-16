@echo off
rem Double-click to start BevoTag Signal Studio and open it in the browser.
rem Close this window (or press Ctrl+C) to stop the web app.
setlocal
cd /d "%~dp0collector"
if not defined PORT set "PORT=8765"
set "URL=http://localhost:%PORT%/"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 is required. Install it from https://www.python.org/downloads/ and run this again.
  pause
  exit /b 1
)

echo Starting BevoTag Signal Studio at %URL%
echo Use Chrome or Edge to connect the ESP32. Close this window to stop.
if not defined BEVOTAG_NO_BROWSER start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start %URL%"
%PY% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo The web app could not start. If port %PORT% is already in use, it may already be running:
  echo open %URL% in your browser.
  pause
)
