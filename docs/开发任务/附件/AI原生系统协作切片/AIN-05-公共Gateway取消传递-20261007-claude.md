# AIN-05 公共 Gateway 取消传递（2026-10-07，Claude）

## 范围与接手基线

- 原任务：AIN-05，关联 AIN-06/11；需求 AIN-R06/R07/R17，验收 AIN-A11/A18/A25。
- 唯一主线：`claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`；接手 HEAD `0aeea67970c67a9362906e234ef52ae5cc0640a8`，无 MERGE_HEAD。
- 依据恢复后的正式需求 v1.2/开发任务 v1.5继续原28项。框架接入暂缓；归档研究与静态评分不是本轮前置或验收结论。
- 中央记录已有6行研究在途修改属本 Claude 先前工作，历史研究归档与 output 均保留，不附带本切片提交。只定向提交本切片实现、测试、记录和当前中央索引。

## 缺陷与最小修改

`UnifiedAiGatewayService`及`GatewayDeadline`已经支持外部 AbortSignal，但`PublicAiGatewayService.invoke/stream`没有接受或转发调用者信号。因此宿主即使取消，公共入口仍可能继续准入、预留、调用transport并返回完成。

本片仅在公共服务增加可选第三参数 `signal?: AbortSignal`，经内部 `call`传给现有`GatewayDeadline(this.timeoutMs, signal)`。后续仍使用原统一Gateway、原超时与取消机制、原预算生命周期及结果映射。两参数调用保持可用；没有修改shared/wire DTO、schema、账本、生产注册或业务取消状态机。

新增14项测试覆盖：

- platform_managed/tenant_managed × invoke/stream：已取消时不准入/预留，已派发时信号到达transport、结果保持unknown/reconcile。
- 预留期间取消不执行transport；取消并撤权时不返回实际配置/结果包。
- 一次调用取消不会取消并发其他调用；成功后移除调用者信号监听器。
- 外部取消原因不泄漏；不重复预留，不用取消伪造结算或完成。

## 实测证据

| 阶段 | 实际结果 | 边界 |
| --- | --- | --- |
| 实现前公共Gateway红测 | 40项，27通过/13失败，exit1 | 失败包括未拒绝预取消、transport信号未中止、取消后返回completed；旧测试不删 |
| 最小修复后同组 | 40/40，exit0 | fail/cancel/skip/todo均0 |
| 公共/统一Gateway、deadline、intent、egress、model、单账及binding，9文件 | 219/219，exit0 | 20261007 regression TAP；非专项全量 |
| 原预算预留失败、adapter、证据绑定、execution repository、C03预算，5文件 | 78/78，exit0 | 原Prisma repository执行配合离线事务替身，非真实数据库 |
| API及本树shared源码类型检查 | 376个API根文件，0 diagnostics，exit0 | TypeScript createProgram，noEmit，incremental=false，shared路径指向本树源码 |
| 统一14文件最终回归 | 297/297，exit0，fail/cancel/skip/todo均0 | 单次实际执行，52587.8405ms；缓存定向本树，最终audit未记录guard事件 |
| git diff --check | exit0 | 无空白错误；LF/CRLF提示不作为失败 |

上述首次测试的guard审计发现`v8-compile-cache`尝试写系统临时目录，均被`AI_OFFLINE_WRITE_ROOT`拦截；红测和公共绿测各2条、9文件回归18条、预算回归10条。未记录网络、DNS、fetch或.env读取。没有解除护栏或清理这些审计文件；最终回归将`V8_COMPILE_CACHE_CACHE_DIR`定向本树`output/claude-gateway-cancel-cache`。类型检查未记录guard事件。

### 复现设置与命令

以下均从唯一主线树执行，Node预加载既有`tests/fixtures/ai-native/prisma-offline-preload.cjs`。设置值：

```text
DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline
AI_OFFLINE_WRITE_ROOT=D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation
AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation/output/claude-gateway-cancel-<阶段>-20261007.audit
NODE_OPTIONS=--require "D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation/tests/fixtures/ai-native/prisma-offline-preload.cjs"
V8_COMPILE_CACHE_CACHE_DIR=D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation/output/claude-gateway-cancel-cache
```

红/绿公共组命令（首次执行尚未指定本树cache，拦截记录保留）：

```bash
node --test --test-concurrency=1 tests/ai-native-public-gateway.test.cjs
```

统一最终回归命令，实际输出`output/claude-gateway-cancel-final-20261007.tap`：

```bash
node --test --test-reporter=tap --test-concurrency=1 tests/ai-native-public-gateway.test.cjs tests/ai-native-gateway-deadline.test.cjs tests/ai-native-unified-gateway.test.cjs tests/ai-native-gateway-intent.test.cjs tests/ai-native-model-egress.test.cjs tests/ai-native-model-gateway.test.cjs tests/ai-native-gateway-budget-composition.test.cjs tests/ai-native-gateway-invocation-binding.test.cjs tests/ai-native-gateway-single-account.test.cjs tests/ai-native-budget-reservation-failure.test.cjs tests/ai-native-budget-gateway-adapter.test.cjs tests/ai-native-budget-evidence-binding.test.cjs tests/ai-native-execution-budget-repository.test.cjs tests/ai-native-c03-budget.test.cjs
```

类型检查通过TypeScript API读取`apps/api/tsconfig.json`，保留原编译配置，覆盖`noEmit:true`、`incremental:false`、`rootDir/baseUrl:工作树根`、`paths:{'@rental-os/shared':['packages/shared/src/index.ts']}`，对parse diagnostics与`getPreEmitDiagnostics(createProgram(...))`共同断言0。不写dist或共享生成物，没有本轮Prisma schema变更或生成。

## 一轮独立复核与未验收边界

独立只读subagent核对本树实际未提交实现/测试及现有deadline/unified生命周期，报告未发现阻断问题；不是作者自查，不是全专项安全Review。确认公共层不直接改预算账本，取消结果仍经当前授权清理路径复验。

复核指出的证据边界予以保留：

1. 本片只打通服务入口，尚无HTTP宿主取消端到端证据；AIN-06辅助负责runner宿主信号接入，未以其在途工作作为本片验收。
2. 公共取消测试中的财务端口为生命周期spy；补跑原预算repository/adapter及证据绑定测试仍然是离线替身，不证明真实MySQL并发、崩溃或供应商计费。
3. 模型已结算但公共返回前发生取消时，公共结果可能保守呈unknown/reconcile；既有账本事实不回滚，也不得因这个结果再发一次。
4. 仅直接断言外部调用者监听器移除，未额外暴露内部controller用于测试。

未读.env、未启服务、未安装依赖、未连接真实HTTP/DB/模型/支付、未推送/合main/生产启用。原任务仍未整项验收，M1未放行，正式0/28不变。

## 下一核心缺口及协作归属

AIN-07辅助已报告：现有`PrismaTaskPlanInputSource`只支持catalog/availability的readonly计划，不能正式发布`rental.order.commit`输入。主线接续核对并实现服务端固定工具/场景与实际Core DTO/Guard的建单原输入发布、AiTaskActionInput不可变指纹、plan/step/action绑定及准备事务内当前策略revision/expiry复验。不能从当前报价反推原输入，不能用fixture预填输入表冒充正式生产者。

AIN-06继续runner/输入恢复和宿主取消，AIN-07继续审批准备末端来源/step关联复读，Codex A负责事实/报价授权，Codex B负责知识/记忆来源。主线新增写输入文件不直接双写其活动文件；需要公共文件时先明确认领。交付仅核对固定提交后整合，作者通过不等于主线组合通过。
