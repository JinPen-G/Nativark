@echo off
setlocal
cd /d "%~dp0"
set "SITE_PORT=4178"

where py >nul 2>&1
if errorlevel 1 (
  echo Python launcher not found. Install Python 3, then run this file again.
  pause
  exit /b 1
)

echo Rental OS 2.0 preview: http://127.0.0.1:%SITE_PORT%/
echo Keep this window open while previewing. Press Ctrl+C to stop.
start "" "http://127.0.0.1:%SITE_PORT%/"
py -3 -m http.server %SITE_PORT% --bind 127.0.0.1 --directory "%CD%"
if errorlevel 1 (
  echo Preview server stopped or failed to start.
  pause
  exit /b 1
)
endlocal
