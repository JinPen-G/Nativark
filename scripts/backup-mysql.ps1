param(
  [string]$OutputDir = "backups",
  [string]$Database = "rimo_store_rental",
  [string]$User = "rimo",
  [string]$Password = "rimo"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backupDir = Join-Path $projectRoot $OutputDir
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$filePath = Join-Path $backupDir "rimo-store-rental-$timestamp.sql"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Set-Location $projectRoot

docker compose exec -T mysql mysqldump "-u$User" "-p$Password" $Database | Out-File -FilePath $filePath -Encoding utf8

Write-Host "Backup created:"
Write-Host $filePath
