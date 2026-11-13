@echo off
setlocal

cd /d "%~dp0"
title Rental OS Tenant Website Preview

where npm >nul 2>nul
if errorlevel 1 goto npm_missing

echo Starting the tenant website preview...
echo Open http://127.0.0.1:4194/?tenant=multiple after Vite is ready.
echo.
call npm run dev -- --mode ai-offline --port 4194
set "preview_exit_code=%ERRORLEVEL%"

echo.
echo Preview process stopped with exit code %preview_exit_code%.
pause
exit /b %preview_exit_code%

:npm_missing
echo npm was not found. Install Node.js and npm, then run this script again.
pause
exit /b 1
