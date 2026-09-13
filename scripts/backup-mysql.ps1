# OPS-01A：备份入口（Windows 便捷壳）。
#
# 原版把库名、账号和口令写成默认参数（rental_os / rental_os / rental_os），
# 等于在仓库里存了一份共享库凭据，而且默认目标就是**共享**开发库。
# 现在统一委托给 scripts/ops/backup.cjs：连接信息只来自 DATABASE_URL，
# 目标库必须通过专用库守卫，脚本本身不再持有任何默认库名或口令。

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

node scripts/ops/backup.cjs @args
exit $LASTEXITCODE
