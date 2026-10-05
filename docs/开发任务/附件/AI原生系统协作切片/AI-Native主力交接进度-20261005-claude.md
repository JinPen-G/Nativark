# Rental OS AI Native 主力交接：最新进度与真实阻塞

日期：2026-10-05。用于用户将主力开发转交 Codex；不是专项验收完成报告。

## 1. 交接时的精确状态

### 主线（接任后建议继续使用的唯一施工树）

- 路径：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`
- 分支：`ai/ai-native-contracts-s01-20261002`
- 最后一个代码提交：`6835d384` — public Gateway + routed protocol transport。
- 本交接文档会再形成一个仅文档提交；接任时核对实际 HEAD，它应包含 `6835d384`。
- 已取消本会话5分钟心跳 `0f6f70c1`，不再自动写入，避免与接任者竞争。没有待等待的成功后台结果。
- 原有未跟踪文件仅 `output/ai-native-superseded-doc-draft-20261003T035724.patch`，是历史保全文件，未读改，不提交或删除。
- 曾执行 `git merge --no-ff --no-commit e5d1bf09`，自动合并无冲突，但 `git diff --cached --check`发现10处EOF空行，组合命令因此在Prisma生成/全量测试前停止。为清理交接状态，**已执行git merge --abort**，没有丢失任何已提交开发成果，没有遗留MERGE_HEAD。

### Codex原施工树（保留全部尚未整合的交付历史）

- 路径：`D:/工作文件/rental-OS/.worktrees/codex-ai-native-transition`
- 分支：`ai/ai-native-foundation-20261002`
- 已只读核实HEAD：`7128c0d6` — persistent task runner orchestration。
- 只存在两张旧未跟踪截图：`output/playwright/core-integration-desktop.png`、`output/playwright/core-integration-order-detail.png`。不要提交、覆盖或删除。
- 用户已通知交付的C01～C04均在该历史中；**主线尚未合入它们**。接任应合并固定`7128c0d6`而不是只拷几份预算文件，保留依赖与作者历史。
- 接任后只能选一个树写入。建议接任主线树；旧Codex树转只读归档。不能同时让旧任务继续写。

## 2. 产品与施工方向（不可丢失）

1. 总范围AIN-01～AIN-28，主计划必须以 `docs/开发任务/AI原生系统专项开发任务.md` 和 `docs/AI原生系统专项需求说明.md` 为准；不得另排一套开发顺序。
2. 当前仍在M1核心依赖建设/接线，不是最终交付。按完整定义已验收结项仍 **0/28**；不是零代码，但不能以提交/测试数量推算百分比。
3. 新租户默认`platform_managed`、Rental OS AI；旧BYOK保留`tenant_managed`。Agent只声明场景/能力，不固定供应商、模型或BaseURL。
4. 调用方向：Gateway → Router → Platform/Tenant Profile → 协议Adapter。workspace是消费主体，不是BYOK配置owner；租户模式配置owner必须是所属TENANT。
5. 未配置预算、缺能力、未验真、缺授权或未交付工具一律拒绝/unavailable；mock不等于live。
6. 金额、库存、资格、订单状态由Core决定。不能绕Controller/Guard、自授审批、用模型文本决定业务成功，不能开放任意SQL/HTTP/代码/终端工具。
7. 用户已纠正旧分工：Codex可承担完整核心子系统，停止碎片化外围卡片开发。接任后Codex是主力，应负责核心闭环和总体验收，不等Claude逐批派单。
8. 只做离线代码与自动化；不读`.env`、不启服务、不连共享/真实DB、不调真实模型/支付、不采购、不推送、不合main、不生产启用。真实环境需要用户另行授权。
9. 独立审查失败不冒称通过，不递归反复派审。当前独立审查多次遇到模型API HTTP400，最后一次AIN-05审查也未实际完成；1825通过是自动化证据，不是独立Review通过。

## 3. 已合入主线的关键提交

| 提交 | 实际内容 | 不能据此声称 |
|---|---|---|
| `1ddb7513` | capability必须可信验真且保持新鲜，mock默认拒绝 | 已有真实live探测器 |
| `e61379aa` | 真实owner路由、invoke权限与read分离、dispatch单赢家、C03输入准备 | 完整公共Gateway已接生产 |
| `338a3c4c` | 合入B06～B14；修复法律页shared运行时导入 | 多端已上线 |
| `91b9d187` | 离线runner护栏继承、准确统计、Admin无.env构建、产物构建顺序 | 覆盖全部AIN验收 |
| `cdbed3b2` | 文本Intent进入同一Gateway生命周期，完整原始Intent指纹、纯文本结果严格验证 | 所有身份/附件/工具已支持 |
| `2e4afd5c` | 合入B15/B16，修21项集成失败与私有宿主测试接管 | UIArc全局问题已清零 |
| `dd92ef5f` | 预留完整幂等绑定、输入快照、只有P2002可重读赢家，未知应答不伪成功 | 真实额度预算已实现 |
| `6835d384` | 公共C03端口、结果/流事件校验、路由协议Adapter、BYOK加密配置resolver、模块组合 | AIN-05整项或生产闭环完成 |

更早的真实Auth/Guard桥、AiScope、任务/步骤/事件仓储、原子usage结算等已在主线，继续复用，不能重建第二套。

## 4. AIN-05：当前调用链已经实现到哪里

关键文件（相对主线树）：
- `apps/api/src/modules/ai-native/public-ai-gateway.service.ts`
- `gateway-contract-validation.ts`
- `routed-model-transport.ts`
- `unified-ai-gateway.service.ts` / `.ports.ts`
- `gateway-routing.service.ts`
- `provider-router.service.ts`、`provider-capability.service.ts`、`capability-verification.ts`
- `tenant-model-config.service.ts`、`platform-model-config.service.ts`

已实现：
- PublicAiGatewayService实现AiGatewayPortDraft，输入/输出/事件直接按shared公共schema校验，sequence从1开始。
- PublicAiGatewayModule.registerProtocols组合公共入口、Unified生命周期和RoutedModelTransport；不是独立演示调用。
- 当前真实身份与调用方AiExecutionContext完整身份绑定比较，actual来自本次路由profile/owner，不填占位model或凭据ref。
- 现有调用链包含唯一dispatch token、usage、派发前/发布前复核；撤权后不泄漏结果，已派发失败为unknown/reconcile且retryable=false。
- 路由协议transport按profile.protocol注册选择，检查owner/model/能力，不跨模式回退。
- connection两次派发前解析及派发后复核，绑定profile fingerprint、HTTPS baseURL、credential和maxOutputTokens；轮换和超限拒绝。
- TenantModelConnectionResolver使用实际TenantModelConfigService/SecretBox路径，检查mode/revision/model/credentialRef；不是从请求里取密钥。
- ChatCompletionsAdapter实际协议解析/流解码参与离线组合；密钥不会原样/跨流片段泄漏，原始供应商异常不返回。

仍待完成（不能漏报）：
- 当前public bridge只接受workspace的operator/staff user；customer/platform/automation明确拒绝。需按任务依赖实现其独立授权与持久化边界，不能删拒绝条件假装支持。
- 平台配置/加密凭据的真实持久化resolver、租户配置记录仓储、ProviderProfile与配置统一修订来源尚未完全装配。
- `verifyEvidence`是必需的可信依赖，但真实能力专用验真器/执行模式来源未交付；测试里的mock verifier不许带到生产。
- 预算接线尚使用旧usage生命周期；C01～C03预算子系统未接入，不能双记两套账。
- 公共Intent只有requestId/scene/messages，预算需要run/step/action/priceVersion等。必须由可信的task/run invocation关联来源补齐，不可随便用requestId填所有ID。
- 主生产AppModule/Controller/真实调用入口未注册；显式DynamicModule不是生产已接通证明。
- 多模态、正式工具调用、真实供应商、真库/试点环境未验。

## 5. 最新Codex交付：存在，但未由主线完成整合验收

### C01～C03 / AIN-03、04、11预算

固定最新交接`e5d1bf09`（修复提交`8803abb1`，此前C02`30fc7b1e`）。

文件：`apps/api/src/modules/ai-native/budget/`、新增预算Prisma模型及两份追加迁移、`tests/ai-native-c01/c02/c03-*.test.cjs`。

作者报告：持久化policy/reservation/allocation/ledger，scope/scene/config/actor/price绑定，BigInt金额，锁顺序与锁后重读，reserve/dispatch/settle/release/unknown/reconcile，依赖适配与Gateway合同；C01～C03 16/16、类型/构建/离线schema/隔离生成通过。

已确认并要求修复过的关键缺陷：C02仍用`Number(atoms)/1e6`导致`9007199254.740993`存成`9007199254.740992`。C03报告改为BigInt字符串，并增加列宽、scope归属、证据等修复。**主线必须针对固定代码复验，不仅信交接文字。**

精准接入合同见：
- `budget/budget.ports.ts`
- `budget/budget-dependency-adapters.ts`
- `budget/budget-gateway-contract.ts`
- `budget/prisma-budget.repository.ts`

仍未验：真实MySQL锁竞争/回滚/死锁/提交应答丢失、真实授权/订阅/报价/dispatch及usage证据来源、主线Gateway实际接线。作者的小规模离线用例不等于这些完成。

### C04 / AIN-06运行器

固定交接`7128c0d6`，已只读核对提交和C04记录，未运行主线复验。

新增`runner/ai-task-runner.service.ts`、`.ports.ts`、`.repository-adapter.ts`、`.module.ts`及`tests/ai-native-c04-task-runner.test.cjs`。

作者报告：6项运行器测试+268项既有相关回归通过，API类型通过。复用AiTaskRepository的claim/recovery/fencing及现有步骤仓储CAS，显式effect/reconcile、超时unknown、不自动重派。

必须关注记录中明确未完成：
- 当前maxConcurrent仅允许1，是串行单lease实现，不是完整并行运行器。
- replay缺少步骤终态投影时停止；需加受权只读终态查询，不能把replay直接视为成功或再次effect。
- 未自动完成task-level waiting/cancelled/人工接管transition，主线需连接正式任务状态端口。
- plan、authority、command factory、evidenceId、Gateway effect/reconcile和预算均需真实组合根。
- AIN-07审批消费与Core业务事务仍未接，不可用运行器成功代替业务执行成功。

## 6. 最后实际验证口径

| 验证对象 | 结果 | 范围说明 |
|---|---|---|
| 主线B15/B16整合+旧预留修复 | 1772/1772通过 | 真实外部依赖仍是替身 |
| 主线public Gateway+协议接线，提交6835d384 | **1825/1825通过**；API lint、diff check通过 | **尚不包含C01～C04预算/runner交付** |
| 修复后的B14 runner | 125测试文件+8工程检查，133/133通过 | B02～B14辅助范围，不是单测个数或专项完成数 |
| Admin ai-offline构建 | 实际通过 | 不读.env，输出dist-ai-offline，保留大chunk警告 |
| C01～C03 | 作者16/16等通过 | 主线尚未复验 |
| C04 | 作者6/6+268相关回归通过 | 主线尚未复验 |
| UIArc全局审计 | 作者此前退出1 | 未做全局清零；不能宣称全部问题已解决 |
| 独立审查 | 没有本轮成功结论 | API HTTP400失败，不冒称通过 |

最后一次预算合并尝试仅在EOF空行检查失败（exit2），Prisma生成/API类型/全量均没开始；不能说预算已在主线验收通过。

## 7. 接任第一步：先把两条已提交历史合成一个可验证基线

1. 用户转发接任提示词后，由Codex成为主力，主线树为唯一写入树，旧Codex树只读；核对无其他写入者。
2. 在主线树核对分支、HEAD、仅保全patch未跟踪、无MERGE_HEAD。不要reset/clean/stash丢数据。
3. 合入固定`7128c0d6`，它包含C01～C04历史。采用保留历史的合并，不复制文件或只摘最后一个runner提交。
4. 此前e5合并无冲突；7128尚未尝试，冲突必须逐文件核对，不用ours/theirs全覆盖。
5. 处理已知10处末尾空行（附下）；然后使用已审查的 `scripts/ai-native-generate-local-prisma.cjs` 更新**本树自有**client，脚本会验证共享产物未变。它拒绝共享client路径/外部改动，不可绕过。
6. 运行API类型、预算/runner定向、完整AI Native回归，修失败；再提交合并。真DB仍禁连接，不能先改测试降低断言。
7. 先把AIN-03/04基础+AIN-05 Gateway+AIN-11预算真正接成单一路径，再完成AIN-06 task-level恢复/暂停/接管，之后按文档推进AIN-07审批消费/业务幂等；不要跳回外围卡片。

已知EOF空行：
- apps/admin/src/features/ai-native/{CategoryGovernanceCard.tsx,ReadinessDiagnosticsCard.tsx,category-governance-display.ts,readiness-diagnostics.ts}
- docs/开发任务/附件/AI原生系统协作切片/{B16-C-20261004-codex.md,B16-EH-20261004-codex.md,C01-20261004-codex.md}
- tests/{ai-native-b16-governance.test.cjs,ai-native-b16-readiness.test.cjs,ai-native-c01-budget.test.cjs}

## 8. 验证工具与禁止误用

- `scripts/ai-native-generate-local-prisma.cjs`：只能在隔离worktree运行，检查owner marker，隔离Prisma CLI，验证sharedArtifactsUnchanged；已读取代码确认用途。不要直接运行会加载.env的Prisma默认命令。
- `tests/fixtures/ai-native/prisma-offline-preload.cjs`：给Node拦socket/DNS/fetch/.env读取；AI_OFFLINE_AUDIT应使用绝对路径，尤其npm切目录时。不能声称它限制任意原生二进制所有I/O。
- 全量测试命令在主线树运行：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=1 --test-reporter=tap tests/ai-native-*.test.cjs tests/ai-native-*.test.mjs`；设置固定不可用DATABASE_URL和绝对审计路径。
- `npm run lint -w @rental-os/api`、Admin lint为类型检查。
- Admin普通vite.config会loadEnv；只用新增`ai-offline`模式并继承护栏，不开启服务器。
- 新小程序产物测试前先构建两端，否则会出现旧dist/缺组件的失败；构建是本地联调，不是发布。
- 不轮询自动通知的后台任务；中断/会话退出无完成记录时不预测通过，先看报告是否实际存在及时间/失败项。

## 9. 参考与非显而易见的经验

- B04 ModelText测试曾统计整个HTML中的x，把plaintext样式也算进去；现只统计正文p节点，不降低20,000上限。
- B15移除函数型properties是正确改动；旧B09测试通过`mountWithHost`显式调用attachHost迁移，原`mount`保留无宿主负例。不要还原不安全properties来过测试。
- 未知结果/超时/撤权必须区分。已经完成的计量不得因结果发布被拒而倒退成unknown；已派发失败则不能自动释放重试。
- 私钥和模型输出都不进入公开错误；能力profile指纹只做绑定，不能当签名或live证据。
- 用户要求核心整项交付，不要只完成一个校验器就报“底座完成”；正式结项始终按AIN任务定义与证据。

## 10. Codex追加交接（2026-10-05）

本节是接任后新增的真实代码修复，不改变原正式验收分母，也不把局部回归通过写成 AIN-08/AIN-11 或专项完成。

当前主线：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`；分支：`ai/ai-native-contracts-s01-20261002`；当前交接点：`cd4336ec`。历史未跟踪 output 资源仍保留，未纳入提交；没有新增数据库、服务、端口或外部调用。

### 已完成提交

- `147c94b0`：可用性只读投影绑定请求行。返回地点/时间之外，还必须逐行匹配数量和 `itemGroupId`，并拒绝返回行数不一致；新增错商品/错需求量回归。
- `b148ede0`：目录只读投影拒绝重复 `id` 或 `code`，避免不唯一 Core 返回被包装成目录事实；新增行为回归。
- `53622ec5`：会员候选投影拒绝重复 `customerId`，并拒绝未带 `*` 掩码标记的非空电话字段；不选择客户、不改变预订资格。
- `cd4336ec`：预算 Gateway 适配器在异步绑定解析前快照 context/request，阻止 await 期间 actor/callId 被篡改；workspace 消费适配器拒绝 platform/tenant owner scope 错绑。新增 reserve、dispatch、settle、release、unknown、reconcile 的等待竞态和消费层级负例。

### 实际验证

- 相关只读投影回归：11/11 通过，退出 0。
- C01～C03预算与Gateway适配定向回归：31/31 通过，退出 0。
- `npm run lint --workspace apps/api`：退出 0。
- `git diff --check`：通过。
- 以上均为离线函数/仓储替身证据，使用端口 1 的无效 DATABASE_URL 和网络/环境读取护栏；未连接真实 MySQL、HTTP、模型、支付或浏览器。

### 仍需主开发继续

- C01～C03预算子系统尚未接入主线 Gateway 的单一生命周期；不能形成双账。必须从可信 task/run/step/action/priceVersion 关联源补齐预算关联，不能用 requestId 复制填充。
- 平台/租户消费主体、真实订阅权益、报价、dispatch/usage evidence 仍需正式适配；缺依赖必须 fail closed。
- AIN-05 live 能力验真、ProviderProfile/config 统一 revision、显式模块/真实调用入口仍未生产装配。
- AIN-06 task-level waiting/cancelled/人工接管与 AIN-07 审批消费/Core 幂等仍未完成。
- 真实 MySQL 锁竞争、迁移、HTTP/供应商、浏览器/真机、灰度验收均未运行。

## 11. 可直接转发给 Claude 的接手提示词

你接手 Rental OS AI Native 主力开发。请在唯一主线树 `D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`、分支 `ai/ai-native-contracts-s01-20261002` 从交接点 `cd4336ec` 继续；不要使用旧 Codex 树写入，不要 reset/drop，不要覆盖未跟踪 output 资源。

先读取本文件第10节、主需求、主开发任务和中央实现记录，核对当前 HEAD/status 与并行写入者。保留 `147c94b0`、`b148ede0`、`53622ec5`、`cd4336ec` 的代码和测试；不要重复这些切片，也不要把它们当正式 AIN 验收。

严格按原任务依赖推进：先把 AIN-03/04 基础与 AIN-05 配置、能力、授权装配补成可验证闭环，再把 AIN-11 C01～C03预算接入主线 Gateway 的同一调用生命周期，随后补 AIN-06 task-level 恢复/暂停/取消/人工接管，之后才推进 AIN-07 审批消费与 Core 业务幂等。不要先做外围 UI，不要保留 Gateway 旧 usage 与新预算双账。

AIN-11 下一步重点：复用 `apps/api/src/modules/ai-native/budget/` 和 `BudgetGatewayAdapter`，实现可信 task/run/step/action/priceVersion/evidence 关联适配；明确 reserve、dispatch token、settle、release、unknown、reconcile 的唯一账本边界。平台/租户/场景策略、权益、报价、授权、配置 revision、usage evidence 缺任何正式来源均拒绝，不用测试桩恒定成功替代。预算 owner scope 与 workspace consumer scope 不可混淆。

验证只使用离线护栏和隔离生成：禁止读 `.env`、启服务、真实 DB/HTTP/模型/支付、安装依赖、写共享生成物、合 main、推送或生产启用。每次先红测再修复，记录真实退出码、失败与未验项；离线替身不能宣称 MySQL 并发、真实供应商或生产授权通过。完成完整调用链后再提交，并在交接记录中列出 SHA、文件、接线合同和剩余阻塞。正式验收仍按原 28 项，不能因局部测试改变完成率。

## 12. 接任后完整工作量核对（2026-10-05）

此前第10节只列了最近四个代码修复，不足以代表接任后的完整主线工作。以交接点 `ca601baf` 为分界，当前 HEAD `84a6b2fc` 之间可追溯 **47 个提交**，`git diff --stat ca601baf..HEAD` 为约 **109 个文件、6102 行新增、45 行删除**。这47个提交包含两类：一部分是接任时把旧Codex树 C01～C04/B16 交付历史整合进主线，另一部分是接任后继续完成的主线修复；不能把47个提交都误报为本轮从零实现，也不能把它们折算为47项AIN正式验收。

### 完整提交分组

| 范围 | 提交（短 SHA） | 实际内容 |
|---|---|---|
| B16整合保留 | `c135d1f0`、`781b2ba9`、`8b6dafa2` | readiness diagnostics、治理差异展示及B16交付证据；属于外围配套，不能替代核心验收 |
| C01～C03 / AIN-11预算 | `4c0be676`、`fa400a6b`、`fdc39623`、`c2f500c6`、`f71e8025`、`60dbb037`、`bd37a879`、`b5b2ebb2`、`fb0c96f0`、`30fc7b1e`、`8803abb1`、`e5d1bf09`、`11b4469a`、`2c4892fc`、`87b2cb07`、`4a77bbda` | 持久预算schema/事务adapter、策略交集、actor绑定、token列宽与金额精度、unknown/replay/应答不明、Gateway预算边界及交接证据；真实MySQL并发和主Gateway单账接线仍未验 |
| C04 / AIN-06运行器 | `7128c0d6`、`aaa33cc4`、`751ac7e3`、`cfc56929`、`265014cb`、`08d0d42d`、`02dd35b3` | 持久任务运行器、任务结果转换、部分成功、状态迁移和取消结果持久化；task级恢复/人工接管/完整并行能力仍未收口 |
| AIN-03/04/05基础 | `ca2c3530`、`b83cfe16`、`eefac34c`、`865316bc`、`b3588890`、`192b7f21`、`09764326` | 真实Prisma类型CAS、租户BYOK、平台vault、默认Profile事务、能力白名单、平台配置授权、能力证据仓储；live验真、公共正式接线和生产装配仍未验 |
| AIN-07审批边界 | `82e132ad`、`8ee52bc2`、`a3c7d805` | 持久审批消费边界、不可变提案版本、审批决策CAS；不等于Core业务写入和审批全链路完成 |
| AIN-08受权只读事实 | `760ec466`、`e2ef605c`、`f9a9454c`、`618b800b`、`c34aff1b`、`1018cffa`、`147c94b0`、`b148ede0`、`53622ec5` | 目录、可用性、会员候选投影；绑定既有Core只读方法、真实AuthService/ApiAuthGuard路由语义、ALS身份和迟到撤权复核，并补齐行绑定、租户归属、唯一性和脱敏校验 |
| 接任后预算适配修复 | `cd4336ec` | await期间actor/request篡改隔离；workspace消费scope禁止伪造platform/tenant owner scope |
| 本次交接记录 | `84a6b2fc` | 将上述最近修复及主线剩余缺口交给Claude；不含代码功能变更 |

### 接任后已经实际执行的验证

- AIN-08只读事实与真实 Guard 路径：最近投影回归 11/11 通过；此前真实 `AuthService`/`ApiAuthGuard` 离线组合回归包含在主线记录中。
- C01～C03预算及Gateway适配：最近定向回归 31/31 通过；覆盖预算service、Prisma预算仓储替身、金额/Token边界、unknown/replay、绑定证据和等待竞态。
- API TypeScript 检查退出码 0；相关 `git diff --check` 通过。
- 更早的主线整合回归、配置/能力/运行器/审批回归结果保留在各提交记录和第4～6节；本次没有把旧结果重新冒充成最新全量回归。

### 不能从上述工作推导出的结论

这47个提交和6102行代码不能推导出“AIN专项完成”“28项正式验收通过”或“已生产可用”。当前仍明确未完成：真实MySQL锁/迁移执行、主线Gateway预算单账接线、可信订阅/报价/usage/dispatch证据、live模型能力验真、AIN-06 task级恢复接管、AIN-07 Core业务幂等写入、真实HTTP/供应商、浏览器/微信宿主/真机和生产灰度。正式验收仍按原口径处理，不修改完成率。
