@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20.9 or newer is required.
  pause
  exit /b 1
)
if not exist "node_modules\next\dist\bin\next" (
  echo Run npm ci --workspaces=false in this folder first.
  pause
  exit /b 1
)
echo Rental OS Next.js source: http://127.0.0.1:8140/harness/
echo Keep this window open. Press Ctrl+C to stop.
start "" "http://127.0.0.1:8140/harness/"
node node_modules\next\dist\bin\next dev --webpack --hostname 127.0.0.1 --port 8140
if errorlevel 1 pause
endlocal
