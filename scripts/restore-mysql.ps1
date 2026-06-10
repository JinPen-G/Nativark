param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,
  [string]$Database = "rimo_store_rental",
  [string]$User = "rimo",
  [string]$Password = "rimo"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$resolvedInput = Resolve-Path $InputFile

Set-Location $projectRoot

Write-Host "Restoring $resolvedInput into $Database..."
Get-Content -Path $resolvedInput -Raw | docker compose exec -T mysql mysql "-u$User" "-p$Password" $Database
Write-Host "Restore completed."
