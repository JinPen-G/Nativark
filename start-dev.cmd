@echo off
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"
)

if not %errorlevel% equ 0 (
  echo.
  echo [rental-os] 启动失败，错误码 %errorlevel%。
  pause
)
endlocal
