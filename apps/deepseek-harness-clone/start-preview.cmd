@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js and run this file again.
  pause
  exit /b 1
)
set "PORT=8138"
echo DeepSeek Harness: http://127.0.0.1:%PORT%/harness/
echo Keep this window open. Press Ctrl+C to stop.
start "" "http://127.0.0.1:%PORT%/harness/"
node serve.mjs
if errorlevel 1 pause
endlocal
