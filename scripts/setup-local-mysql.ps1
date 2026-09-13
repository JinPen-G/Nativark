param(
  [string]$DatabaseUrl = "mysql://rental_os:rental_os@localhost:3306/rental_os"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $projectRoot ".env"
$envExample = Join-Path $projectRoot ".env.example"

Set-Location $projectRoot

docker compose up -d mysql redis

if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item -Path $envExample -Destination $envFile
}

Write-Host "Local MySQL and Redis are starting."
Write-Host "Use this DATABASE_URL for the current shell:"
Write-Host "`$env:DATABASE_URL=`"$DatabaseUrl`""
Write-Host "`$env:PLATFORM_DATA_SOURCE=`"mysql`""
Write-Host "`$env:RENTAL_OS_DATA_SOURCE=`"mysql`""
Write-Host ""
Write-Host "Then run:"
Write-Host "npm run db:generate"
Write-Host "npm run db:migrate"
Write-Host "npm run db:seed"
