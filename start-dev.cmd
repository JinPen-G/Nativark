@echo off
setlocal
cd /d "%~dp0"
rem Defaults to the public platform. Pass -Legacy for the original Rental stack.
where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1" %*
)
set "START_EXIT=%errorlevel%"
endlocal & exit /b %START_EXIT%
