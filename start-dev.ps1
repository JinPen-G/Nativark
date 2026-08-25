[CmdletBinding()]
param(
  [switch]$SkipDocker,
  [switch]$SkipDatabaseChecks
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Require-Command([string]$name, [string]$hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name 未找到。$hint"
  }
}

Write-Host "[rental-platform] 根目录: $root" -ForegroundColor Cyan
Require-Command "node" "请先安装 Node.js 22+。"
Require-Command "npm" "请先安装 npm。"

if (-not (Test-Path -LiteralPath (Join-Path $root ".env"))) {
  Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination (Join-Path $root ".env")
  Write-Host "[rental-platform] 已从 .env.example 创建 .env；如需 Seed，请补充本地密码配置。" -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "[rental-platform] node_modules 不存在，正在安装依赖..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
}

if (-not $SkipDocker) {
  Require-Command "docker" "请先安装并启动 Docker Desktop；或使用 -SkipDocker 跳过容器启动。"
  Write-Host "[rental-platform] 启动 MySQL 和 Redis..." -ForegroundColor Cyan
  docker compose up -d mysql redis
  if ($LASTEXITCODE -ne 0) { throw "Docker 依赖启动失败。" }

  Write-Host "[rental-platform] 等待 MySQL 监听 3306..." -ForegroundColor Cyan
  $ready = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    if (Test-NetConnection -ComputerName "127.0.0.1" -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "MySQL 在 60 秒内未准备好。请检查 docker compose logs mysql。" }
}

$apiAlreadyRunning = [bool](Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)

if (-not $SkipDatabaseChecks) {
  Write-Host "[rental-platform] 生成 Prisma Client 并校验 schema..." -ForegroundColor Cyan
  if ($apiAlreadyRunning) {
    Write-Host "[rental-platform] API 已运行，跳过 Prisma Client 生成以避免 Windows 文件占用。" -ForegroundColor Yellow
  } else {
    npm run db:generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma Client 生成失败。" }
  }
  npm run db:validate
  if ($LASTEXITCODE -ne 0) { throw "Prisma schema 校验失败。" }
}

$apiBusy = $apiAlreadyRunning
$adminBusy = [bool](Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue)

if ($apiBusy) {
  Write-Host "[rental-platform] 端口 3000 已有 API 监听，复用现有 API，仅启动管理端。" -ForegroundColor Yellow
  if ($adminBusy) {
    Write-Host "[rental-platform] 端口 5175 也已监听，开发环境可能已经完整启动。" -ForegroundColor Yellow
    exit 0
  }
  npm run dev:admin
} else {
  Write-Host "[rental-platform] 启动 API (3000) 和管理端 (5175)..." -ForegroundColor Green
  npm run dev
}
