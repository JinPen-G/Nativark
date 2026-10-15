# AIN-04/08 诊断正式授权组合

起点：A树9005a704，工作区干净、无MERGE_HEAD；安全快进负责人固定依赖0aeea67970c67a9362906e234ef52ae5cc0640a8，无冲突。只写codex-ai-native-lane-a/ai/codex-ai-native-lane-a-20261007；没有跟随主线移动HEAD。已核对恢复后的v1.2/v1.5、中央记录和本线历史交接，不执行归档开源方案。

## 实现

沿用AiBusinessReadRouteAuthority、实际ApiAuthGuard/AuthService/ALS；固定GET tenant-readiness、reports/operations及内部business-settings读取映射，GET参数进入query，读后完整身份/范围指纹复验。AiDiagnosticRouteAuthority复用既有严格schema，不允许模型选任意路由；opening缺少逐地点配置裁剪来源，selected或非all数据范围直接拒绝，原人工入口不变。risk仍经原报表权限、地点与own限制，不生成成本利润或历史库存分母。

没有注册runner、HTTP、工具成熟度或生产开关。新的授权桥不授予AI权益，不代替主线计划政策/不可变输入/累计资源准入。缺正式注入依赖仍CONFIG_INVALID。quote_context是内部读取准备，不是正式报价执行或审批。

## 真实命令和结果

所有Node命令前执行：
```powershell
$env:DATABASE_URL='mysql://offline:offline@127.0.0.1:1/rental_os_offline'
$env:AI_OFFLINE_AUDIT=(Join-Path (Get-Location) 'output/lane-a-diagnostic-authority.audit')
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-diagnostic-authority.test.cjs
```
红测：新adapter不存在导致加载失败，0 pass/1 fail/0 skip/0 todo，exit1，不算8个业务红测。首次实现组合发生两个编译错误（unknown query及联合context access），均修复，没有删断言。

最终命令：
```powershell
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-diagnostic-authority.test.cjs tests/ai-native-lane-a-diagnostics.test.cjs tests/ai-native-ain08-business-read-authority.test.cjs
```
26 pass/0 fail/0 cancelled/0 skip/0 todo，exit0。新增8例真实Guard/Auth/ALS组合，覆盖原权限、撤权、跨空间、selected及own开业拒绝、未知路由和额外字段；原诊断服务及报表仓储16例保留。

类型检查曾误用本树不存在的node_modules路径（exit1），继而Node -e参数偏移错误（exit1）；不是类型通过证据。正确命令与最终结果在本批后续交接补记。git diff --check提交前执行。

待独立复核。证据是实际授权/服务代码和数据库替身，不是完整HTTP、真实MySQL、模型、浏览器或设备验收，不宣布AIN整项完成。
