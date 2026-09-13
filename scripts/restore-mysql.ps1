# OPS-01A：恢复演练入口（Windows 便捷壳）。
#
# 原版默认往共享库 rental_os 直接 `mysql < dump` 导入，且内置账号口令——
# 那是「用备份覆盖现有数据」，不是「验证备份可用」，而且默认目标是共享库。
# 现在统一委托给 scripts/ops/restore-drill.cjs：恢复到一个**新建的**演练库，
# 校验表数、迁移条数与抽样行数，成功后只删除本次创建的演练库，源库不受影响。
#
# 真实事故处置（把已验证备份恢复到新库并切换连接）仍是人工动作，
# 不由本脚本代替决策。

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

node scripts/ops/restore-drill.cjs @args
exit $LASTEXITCODE
