[CmdletBinding()]
# UTF-8 BOM is required by Windows PowerShell 5.1 for the Chinese diagnostics.
param(
  [switch]$Legacy,
  [switch]$SkipDocker,
  [switch]$SkipDatabaseChecks,
  [switch]$ApplyMigrations
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$helper = Join-Path $root "scripts/ops/local-dev-preflight.cjs"
$profile = if ($Legacy) { 'legacy' } else { 'platform' }
$profileLabel = if ($Legacy) { '旧 Rental 组合' } else { '公共底座' }
$apiSource = if ($Legacy) { 'apps/api' } else { 'apps/platform-api' }
$healthService = if ($Legacy) { 'rental-os-api' } else { 'nativark-platform-api' }
$clientDirectory = Join-Path $root $(if ($Legacy) { 'node_modules/.prisma/client' } else { 'apps/platform-api/generated/client' })
$databasePrefix = if ($Legacy) { 'db:legacy' } else { 'db' }
$logRoot = Join-Path $root $(if ($Legacy) { 'output/runtime/rental-os-dev' } else { 'output/runtime/zelo-platform-dev' })
$composeProjectName = "rental-os"
Set-Location $root

function Require-Command([string]$name, [string]$hint) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$name 未找到。$hint" }
  return $command.Source
}

function Invoke-Preflight([string]$command) {
  $result = & $script:nodeExe $helper $profile $command
  if ($LASTEXITCODE -ne 0) { throw "本地启动预检失败（$command），请处理上方具体原因。" }
  return ($result | ConvertFrom-Json)
}

function Invoke-Npm([string]$scriptName) {
  & $script:nodeExe $script:npmCli run $scriptName
  if ($LASTEXITCODE -ne 0) { throw "npm run $scriptName 失败；没有继续启动服务。" }
}

function Get-Listeners([int]$port) {
  # A single CimInstance has no Count property in Windows PowerShell 5.1.
  return ,@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-ProjectProcess($process, $processes) {
  # 沿真实父进程链查固定本树入口；PID 复用或看不到归属时拒绝认领，不自动终止进程。
  $seen = @{}
  while ($null -ne $process -and -not $seen.ContainsKey([int]$process.ProcessId)) {
    $seen[[int]$process.ProcessId] = $true
    $command = ([string]$process.CommandLine).Replace('/', '\').ToLowerInvariant()
    foreach ($entry in @(
      "scripts\ops\local-dev-preflight.cjs", "$apiSource/dist/main",
      "node_modules\vite\bin\vite.js", "node_modules\@nestjs\cli\bin\nest.js"
    )) {
      $target = (Join-Path $root $entry).Replace('/', '\').ToLowerInvariant()
      # npm 的 .bin 启动行可能保留 ..；先匹配正式入口，也兼容同树 .bin 前缀。
      if ($command.Contains($target)) { return $true }
    }
    $binPrefix = (Join-Path $root 'node_modules\.bin\').ToLowerInvariant()
    if ($command.Contains($binPrefix) -and ($command -match '(?:vite\s|vite\\bin\\vite\.js|nest\s|nest\\bin\\nest\.js)')) { return $true }
    $parentId = [int]$process.ParentProcessId
    $parent = $processes | Where-Object { $_.ProcessId -eq $parentId } | Select-Object -First 1
    if ($null -ne $parent -and $parent.CreationDate -gt $process.CreationDate) { return $false }
    $process = $parent
  }
  return $false
}

function Assert-PortOwnership([int]$port) {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $listeners = Get-Listeners $port
    if ($listeners.Count -eq 0) { return }
    $ownerIds = @($listeners.OwningProcess | Sort-Object -Unique)
    $processes = @(Get-CimInstance Win32_Process)
    $retry = $false
    foreach ($ownerId in $ownerIds) {
      $process = $processes | Where-Object { $_.ProcessId -eq $ownerId } | Select-Object -First 1
      if (-not (Test-ProjectProcess $process $processes)) {
        # 监听与进程不是同一原子快照；已退出的热重载子进程不能被误报成未知占用者。
        if (@((Get-Listeners $port).OwningProcess) -contains $ownerId) {
          $currentProcesses = @(Get-CimInstance Win32_Process)
          $currentProcess = $currentProcesses | Where-Object { $_.ProcessId -eq $ownerId } | Select-Object -First 1
          if (-not (Test-ProjectProcess $currentProcess $currentProcesses) -and
              @((Get-Listeners $port).OwningProcess) -contains $ownerId) {
            throw "端口 $port 被 PID $ownerId 占用，无法确认是当前工作树；未停止或改动该进程。请先核对归属。"
          }
        }
        $retry = $true
        break
      }
    }
    if ($retry) { continue }
    $confirmedOwnerIds = @((Get-Listeners $port).OwningProcess | Sort-Object -Unique)
    if (($ownerIds -join ',') -eq ($confirmedOwnerIds -join ',')) { return }
  }
  throw "端口 $port 的监听进程持续变化，无法稳定确认归属；未停止或重复启动进程，请待现有重载完成后重试。"
}

function Get-NodeInvocation($process) {
  # 只解析实际 node 进程的脚本参数，不把诊断 PowerShell/cmd 正文里的路径当作服务。
  if ($null -eq $process -or $process.Name -ne 'node.exe') { return $null }
  $arguments = @([regex]::Matches([string]$process.CommandLine, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') })
  if ($arguments.Count -lt 2 -or -not [IO.Path]::IsPathRooted($arguments[1])) { return $null }
  try { $entry = [IO.Path]::GetFullPath($arguments[1].Replace('/', '\')) } catch { return $null }
  return [pscustomobject]@{ Entry = $entry; Arguments = @($arguments | Select-Object -Skip 2) }
}

function Get-ProjectApiProcesses($processes = @(Get-CimInstance Win32_Process)) {
  $apiMain = Join-Path $root "$apiSource/dist/main"
  $nestEntry = Join-Path $root 'node_modules\@nestjs\cli\bin\nest.js'
  foreach ($process in $processes) {
    $invocation = Get-NodeInvocation $process
    if ($null -eq $invocation) { continue }
    $arguments = $invocation.Arguments
    $profileLaunch = $invocation.Entry -eq $helper -and $arguments.Count -eq 3 -and
      $arguments[0] -eq $profile -and $arguments[1] -eq 'run' -and $arguments[2] -in @('dev', 'dev:api')
    $oldLaunch = $Legacy -and $invocation.Entry -eq $helper -and $arguments.Count -eq 2 -and
      $arguments[0] -eq 'run' -and $arguments[1] -in @('dev', 'dev:api')
    if ($profileLaunch -or $oldLaunch -or $invocation.Entry -in @($apiMain, "$apiMain.js")) {
      $process
      continue
    }
    if (-not $Legacy -or $invocation.Entry -ne $nestEntry -or $arguments -notcontains 'start' -or $arguments -notcontains '--watch') { continue }
    # 同树 Nest CLI 也可能运行纯底座；须沿仍有效的父链确认原组合 API 的 npm workspace。
    $seen = @{}
    $child = $process
    while ($null -ne $child -and -not $seen.ContainsKey([int]$child.ProcessId)) {
      $seen[[int]$child.ProcessId] = $true
      $parent = $processes | Where-Object { $_.ProcessId -eq $child.ParentProcessId } | Select-Object -First 1
      if ($null -eq $parent -or $parent.CreationDate -gt $child.CreationDate) { break }
      $parentInvocation = Get-NodeInvocation $parent
      if ($null -ne $parentInvocation -and [IO.Path]::GetFileName($parentInvocation.Entry) -eq 'npm-cli.js') {
        $parentArguments = $parentInvocation.Arguments -join ' '
        if ($parentArguments -match '^run dev (?:(?:-w|--workspace) +|--workspace=)@rental-os/api$') {
          $process
          break
        }
      }
      $child = $parent
    }
  }
}

function Assert-ApiNotRunning([int]$port) {
  if ((Get-Listeners $port).Count -gt 0 -or @(Get-ProjectApiProcesses).Count -gt 0) {
    throw '应用迁移前请先正常关闭本树 API（包括仍在编译或重载的启动进程）；本脚本不对运行中的 API 执行迁移。'
  }
}

function Test-ApiHealth([int]$port) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -Method Get -TimeoutSec 4
    $payload = if ($null -ne $response.data) { $response.data } else { $response }
    return $payload.status -eq 'ok' -and $payload.service -eq $healthService
  } catch { return $false }
}

function Wait-ForExistingApi([int]$port) {
  Assert-PortOwnership $port
  if ((Get-Listeners $port).Count -eq 0 -and @(Get-ProjectApiProcesses).Count -eq 0) { return $false }
  if (Test-ApiHealth $port) { return $true }
  # Nest watch 重载期间可能完全没有监听端口；原 launcher/watch 已存在就只能等候，不能另起。
  Write-Host '[Zelo] 已运行的 API 正在启动或重载，等待原服务恢复。' -ForegroundColor DarkGray
  $reloadDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $reloadDeadline) {
    Start-Sleep -Seconds 2
    Assert-PortOwnership $port
    if (Test-ApiHealth $port) { return $true }
  }
  throw "本树 API 进程等待后仍不健康（端口 $port）；请检查现有日志。未停止或重复启动进程。"
}

function Test-AdminHealth([int]$port) {
  $script:adminFailure = ""
  $routes = if ($Legacy) {
    @('/login', '/src/main.tsx', '/src/app/App.tsx', '/src/app/queryClient.ts', '/src/api/http.ts', '/src/app/navigation.tsx', '/src/features/ai-operator/legacy-host.tsx')
  } else { @('/login', '/src/start.tsx', '/src/main.tsx', '/src/App.tsx', '/src/session.ts') }
  foreach ($route in $routes) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port$route" -UseBasicParsing -Method Get -TimeoutSec 8
      $isModule = $route -ne '/login'
      if ($response.StatusCode -ne 200 -or ($isModule -and ([string]$response.Headers['Content-Type'] -notmatch 'javascript'))) {
        $script:adminFailure = "入口 $route 未返回有效的前端模块"
        return $false
      }
    } catch {
      $script:adminFailure = "入口 $route 转换失败，请查看 Vite 日志中的缺失依赖或编译错误"
      return $false
    }
  }
  return $true
}

function Assert-ClientNotInUse {
  $processes = @(Get-CimInstance Win32_Process)
  if (@(Get-ProjectApiProcesses $processes).Count -gt 0) {
    throw '本树 API 启动或 watch 进程尚在运行；不覆盖在用的 Prisma Client，请先正常关闭该任务再生成。'
  }
  $apiEntry = (Join-Path $root $apiSource).Replace('/', '\').ToLowerInvariant() + '\'
  $clientEntry = $clientDirectory.Replace('/', '\').ToLowerInvariant()
  foreach ($process in $processes) {
    $command = ([string]$process.CommandLine).Replace('/', '\').ToLowerInvariant()
    $generating = $command.Contains((Join-Path $root 'node_modules\').ToLowerInvariant()) -and $command -match 'prisma.*generate'
    if ($process.Name -eq 'node.exe' -and ($command.Contains($apiEntry) -or $command.Contains($clientEntry) -or $generating)) {
      throw "当前树的 API/Client 相关进程 PID $($process.ProcessId) 尚在运行；不覆盖在用的 Prisma Client，请先正常关闭该任务再生成。"
    }
  }
  if (Test-Path -LiteralPath $clientDirectory) {
    foreach ($engine in @(Get-ChildItem -LiteralPath $clientDirectory -File -Filter '*.node')) {
      try {
        $handle = [IO.File]::Open($engine.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $handle.Dispose()
      } catch { throw "Prisma 引擎仍被占用；没有覆盖或删除现有 Client。" }
    }
  }
}

function Wait-ForLocalDatabase([int]$port) {
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    $client = New-Object Net.Sockets.TcpClient
    try {
      $connection = $client.BeginConnect('127.0.0.1', $port, $null, $null)
      if ($connection.AsyncWaitHandle.WaitOne(1000)) {
        $client.EndConnect($connection)
        return
      }
    } catch { } finally { $client.Dispose() }
    Start-Sleep -Seconds 2
  }
  throw "本地数据库端口 $port 未就绪；未执行迁移，也未启动应用。请检查本机数据库或 Docker 日志。"
}

function Start-DevProcess([string]$scriptName) {
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $label = $scriptName.Replace(':', '-')
  $stdout = Join-Path $logRoot "$label-$stamp-$PID.stdout.log"
  $stderr = Join-Path $logRoot "$label-$stamp-$PID.stderr.log"
  $process = Start-Process -FilePath $script:nodeExe -ArgumentList @("`"$helper`"", $profile, 'run', $scriptName) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-Host "[Zelo] 启动 PID $($process.Id)，日志：$stdout" -ForegroundColor DarkGray
  return $process
}

function Wait-ForService([string]$name, [scriptblock]$probe, $launcher, [int]$timeoutSeconds = 1200) {
  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $probe) { Write-Host "[Zelo] $name 已就绪。" -ForegroundColor Green; return }
    $launcher.Refresh()
    if ($launcher.HasExited) { throw "$name 启动进程已退出（$($launcher.ExitCode)）；请检查 $logRoot 内本次 stdout/stderr 日志。" }
    Start-Sleep -Seconds 2
  }
  throw "$name 在 $timeoutSeconds 秒内未就绪；进程和日志已保留，请检查 $logRoot。"
}

$exitCode = 0
$startupLock = $null
$ownsLock = $false
$previousEnvironment = @{}
try {
  $nodeExe = Require-Command 'node' '请先安装 Node.js 22.12+。'
  $npmCommand = Require-Command 'npm.cmd' '请先安装 npm。'
  $npmCli = Join-Path (Split-Path -Parent $npmCommand) 'node_modules/npm/bin/npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli)) { throw '无法定位 npm-cli.js，请修复本机 npm 安装。' }
  if ($ApplyMigrations -and $SkipDatabaseChecks) { throw '-ApplyMigrations 与 -SkipDatabaseChecks 不能同时使用。' }
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $lockId = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '') } finally { $hash.Dispose() }
  $startupLock = New-Object Threading.Mutex($false, "Local\NativarkStart-$lockId")
  try { $ownsLock = $startupLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsLock = $true }
  if (-not $ownsLock) { throw '当前工作树另一个启动脚本正在运行，请等待该次启动完成。' }

  Write-Host "[Zelo] $profileLabel 工作树：$root" -ForegroundColor Cyan
  $dependencies = Invoke-Preflight 'repair-links'
  if ($dependencies.repaired -gt 0) { Write-Host "[Zelo] 已恢复 $($dependencies.repaired) 个锁定的本树 workspace 链接。" -ForegroundColor Cyan }
  $settings = Invoke-Preflight 'settings'
  $apiPort = [int]$settings.apiPort
  $adminPort = [int]$settings.adminPort
  if ($apiPort -eq $adminPort) { throw 'API 与管理端不能使用相同端口。' }
  Assert-PortOwnership $apiPort
  Assert-PortOwnership $adminPort
  if ($ApplyMigrations) { Assert-ApiNotRunning $apiPort }
  $adminListening = (Get-Listeners $adminPort).Count -gt 0
  $apiHealthy = Wait-ForExistingApi $apiPort
  $adminHealthy = $adminListening -and (Test-AdminHealth $adminPort)
  if ($adminListening -and -not $adminHealthy) { throw "管理端 HTML 可访问也不代表已启动：$script:adminFailure。若刚恢复链接，请正常重启本树 Vite；脚本不会误停已有进程。" }

  foreach ($name in @('RENTAL_PRISMA_CLIENT', 'RENTAL_PRISMA_LEGACY', 'PRISMA_GENERATE_SKIP_AUTOINSTALL', 'NATIVARK_NPM_CLI')) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  if ($Legacy) {
    $env:RENTAL_PRISMA_CLIENT = Join-Path $clientDirectory 'index.d.ts'
    $env:RENTAL_PRISMA_LEGACY = '1'
  }
  $env:PRISMA_GENERATE_SKIP_AUTOINSTALL = '1'
  $env:NATIVARK_NPM_CLI = $npmCli

  $client = Invoke-Preflight 'client'
  if (-not $client.ready) {
    if ($SkipDatabaseChecks) { throw '当前宿主 Prisma Client 缺失或与 schema 不同，请先准备对应 Client。' }
    Assert-ClientNotInUse
    foreach ($engine in @('schema-engine-windows.exe', 'query_engine-windows.dll.node')) {
      if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules/@prisma/engines/$engine"))) {
        throw '本树 Prisma 引擎未准备好；不自动下载，请先准备锁定依赖。'
      }
    }
    Invoke-Npm "${databasePrefix}:generate"
    $client = Invoke-Preflight 'client'
    if (-not $client.ready) { throw '生成的 Client 与当前宿主 schema 不一致，停止启动。' }
  } else { Write-Host '[Zelo] 复用与当前宿主 schema 一致的 Client。' -ForegroundColor DarkGray }
  if (-not $SkipDatabaseChecks) { Invoke-Npm "${databasePrefix}:validate" }

  if ($Legacy -and -not $SkipDocker -and -not $apiHealthy) {
    $null = Require-Command 'docker' '请启动 Docker Desktop，或用 -SkipDocker 复用已配置的本地数据库。'
    $composeArgs = @('compose', '--project-name', $composeProjectName)
    if ($env:RENTAL_ENV_FILE) { $composeArgs += @('--env-file', $env:RENTAL_ENV_FILE) }
    $composeArgs += @('up', '-d', 'mysql', 'redis')
    & docker @composeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Docker 本地依赖启动失败。' }
  }
  if (-not $SkipDatabaseChecks -and -not $apiHealthy) { Wait-ForLocalDatabase ([int]$settings.mysqlPort) }
  if ($ApplyMigrations) {
    Assert-ApiNotRunning $apiPort
    if (-not $Legacy) { Invoke-Npm 'build:platform-api' }
    Invoke-Npm "${databasePrefix}:migrate:deploy"
  }

  $launcher = $null
  if (-not $apiHealthy) { $apiHealthy = Wait-ForExistingApi $apiPort }
  if (-not $apiHealthy -and -not $adminHealthy) { $launcher = Start-DevProcess 'dev' }
  elseif (-not $apiHealthy) { $launcher = Start-DevProcess 'dev:api' }
  elseif (-not $adminHealthy) { $launcher = Start-DevProcess 'dev:admin' }
  if (-not $apiHealthy) { Wait-ForService 'API' { Test-ApiHealth $apiPort } $launcher }
  if (-not $adminHealthy) { Wait-ForService '管理端模块' { Test-AdminHealth $adminPort } $launcher }
  Assert-PortOwnership $apiPort
  Assert-PortOwnership $adminPort
  if (-not (Test-ApiHealth $adminPort)) { throw '前端与 API 已响应，但前端 /api/health 代理不健康；请检查本树代理配置。' }
  Write-Host "[Zelo] 管理端已就绪：http://127.0.0.1:$adminPort/login" -ForegroundColor Green
  Write-Host "[Zelo] API 健康入口：http://127.0.0.1:$apiPort/api/health" -ForegroundColor DarkGray
  if ($ApplyMigrations) { Write-Host '[Zelo] 已按 -ApplyMigrations 执行迁移；未执行 Seed。' -ForegroundColor DarkGray }
  else { Write-Host '[Zelo] 未执行数据库迁移或 Seed；迁移仅由 -ApplyMigrations 显式开启。' -ForegroundColor DarkGray }
} catch {
  Write-Host "[Zelo] 启动失败：$($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
  if ($ownsLock) { $startupLock.ReleaseMutex() }
  if ($null -ne $startupLock) { $startupLock.Dispose() }
}
exit $exitCode
