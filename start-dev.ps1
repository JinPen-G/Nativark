[CmdletBinding()]
# Keep this script UTF-8-with-BOM so Windows PowerShell can parse the Chinese messages.
param(
  [switch]$SkipDocker,
  [switch]$SkipDatabaseChecks
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeProjectName = "rental-os"
Set-Location $root

function Require-Command([string]$name, [string]$hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name 未找到。$hint"
  }
}

function Get-DotEnvValue([string]$name, [string]$fallback) {
  $line = Get-Content -LiteralPath (Join-Path $root ".env") -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^\s*$([regex]::Escape($name))\s*=" } |
    Select-Object -First 1
  if (-not $line) { return $fallback }

  $value = ($line -split "=", 2)[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($value)) { return $fallback }
  return $value
}

function Test-ListeningPort([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-ApiHealth([int]$port) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -Method Get -TimeoutSec 3
    $payload = if ($null -ne $response.data) { $response.data } else { $response }
    return $payload.status -eq "ok"
  } catch {
    return $false
  }
}

function Test-AdminHealth([int]$port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -Method Get -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Start-DevTerminal([string]$scriptName, [string]$title) {
  $command = "title $title && cd /d `"$root`" && npm run $scriptName"
  Start-Process -FilePath $env:ComSpec -ArgumentList @("/k", $command) -WorkingDirectory $root -WindowStyle Normal | Out-Null
}

function Wait-ForService([string]$name, [scriptblock]$probe, [int]$timeoutSeconds = 60) {
  $attempts = [Math]::Ceiling($timeoutSeconds / 2)
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    if (& $probe) {
      Write-Host "[rental-os] $name 已就绪。" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 2
  }
  throw "$name 在 $timeoutSeconds 秒内未就绪。请查看对应开发终端的日志。"
}

Write-Host "[rental-os] 根目录: $root" -ForegroundColor Cyan
Require-Command "node" "请先安装 Node.js 22+。"
Require-Command "npm" "请先安装 npm。"

if (-not (Test-Path -LiteralPath (Join-Path $root ".env"))) {
  Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination (Join-Path $root ".env")
  Write-Host "[rental-os] 已从 .env.example 创建 .env；如需 Seed，请补充本地密码配置。" -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "[rental-os] node_modules 不存在，正在安装依赖..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
}

$apiPort = [int](Get-DotEnvValue "API_PORT" "3000")
$adminPort = [int](Get-DotEnvValue "REACT_ADMIN_PORT" "5175")

Write-Host "[rental-os] API 健康入口: http://127.0.0.1:$apiPort/api/health" -ForegroundColor DarkGray
Write-Host "[rental-os] 管理端入口: http://127.0.0.1:$adminPort/" -ForegroundColor DarkGray

if (-not $SkipDocker) {
  Require-Command "docker" "请先安装并启动 Docker Desktop；或使用 -SkipDocker 跳过容器启动。"
  Write-Host "[rental-os] 启动 MySQL 和 Redis..." -ForegroundColor Cyan
  # 固定 Compose 项目名，避免仓库目录改名后与已有具名容器冲突。
  docker compose --project-name $composeProjectName up -d mysql redis
  if ($LASTEXITCODE -ne 0) { throw "Docker 依赖启动失败。" }

  Write-Host "[rental-os] 等待 MySQL 监听 3306..." -ForegroundColor Cyan
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

$apiListening = Test-ListeningPort $apiPort
$apiHealthy = Test-ApiHealth $apiPort
$adminListening = Test-ListeningPort $adminPort
$adminHealthy = Test-AdminHealth $adminPort

if ($apiListening -and -not $apiHealthy) {
  throw "端口 $apiPort 已被占用，但 $apiPort/api/health 未返回 status=ok；请先关闭占用端口的旧 API 进程，再重新运行启动脚本。"
}
if ($adminListening -and -not $adminHealthy) {
  throw "端口 $adminPort 已被占用，但管理端页面不可访问；请先关闭占用端口的旧前端进程，再重新运行启动脚本。"
}

if (-not $SkipDatabaseChecks) {
  Write-Host "[rental-os] 生成 Prisma Client 并校验 schema..." -ForegroundColor Cyan
  if ($apiHealthy) {
    Write-Host "[rental-os] API 健康检查通过，跳过 Prisma Client 生成以避免 Windows 文件占用。" -ForegroundColor Yellow
  } else {
    npm run db:generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma Client 生成失败。" }
  }
  npm run db:validate
  if ($LASTEXITCODE -ne 0) { throw "Prisma schema 校验失败。" }
}

$needApi = -not $apiHealthy
$needAdmin = -not $adminHealthy

if (-not $needApi -and -not $needAdmin) {
  Write-Host "[rental-os] API 和管理端都已通过健康检查，无需重复启动。" -ForegroundColor Green
  exit 0
}

if ($needApi -and $needAdmin) {
  Write-Host "[rental-os] 启动 API ($apiPort) 和管理端 ($adminPort)..." -ForegroundColor Green
  Start-DevTerminal "dev" "Rental OS 开发环境"
} elseif ($needApi) {
  Write-Host "[rental-os] 管理端已就绪，仅启动 API ($apiPort)..." -ForegroundColor Green
  Start-DevTerminal "dev:api" "Rental OS API"
} else {
  Write-Host "[rental-os] API 已就绪，仅启动管理端 ($adminPort)..." -ForegroundColor Green
  Start-DevTerminal "dev:admin" "Rental OS Admin"
}

if ($needApi) {
  Wait-ForService "API" { Test-ApiHealth $apiPort }
}
if ($needAdmin) {
  Wait-ForService "管理端" { Test-AdminHealth $adminPort }
}

Write-Host "[rental-os] 开发环境已启动： http://127.0.0.1:$adminPort/" -ForegroundColor Green
