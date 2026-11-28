# Zelo 公共 AI 服务端

公共 `0.2.1` 服务包提供模型配置、SaaS 设置、Task／Run／Step、会话与原结果、唯一 Gateway 及预算账、通用审批、知识和正文保留。业务 Core 的场景、工具、授权、业务执行和结果字段由其所属宿主提供。

使用 `public-package.cjs` 的 `publicAiClientPaths(ts, client, expectedSchema, readFile)` 核宿主已选择的公共 AI Prisma Client，并将返回值传给编译 `tsconfig.public.json` 的 `compilerOptions.paths`。`expectedSchema` 来自同一宿主底座及固定公共 AI 数据贡献。该检查只读已生成声明，不生成 Client。

用 `assemblePublicAiPackage('server', sources, emitted, ts)` 从同一固定源码、包相对材料和本次 `dist-public` 相对输出组装安装文件，可交现有确定性归档入口。服务端构建仅使用公共依赖。[package.json](package.json) 和 [package.public.json](package.public.json) 使用同一公共身份和31个显式出口；[tsconfig.json](tsconfig.json) 与 [tsconfig.public.json](tsconfig.public.json) 编译相同入口，输出目录分别是 `dist` 和 `dist-public`。旧兼容 `0.1.0` 由独立 Rental 仓库的固定快照提供，既有安装继续使用原包、原锁和原收据。

- `public-platform-model-settings` 以原 Auth、Guard、主体锁和同一数据库观察安装数据。可读旧操作收据，保存不取得模型调用或业务授权。
- `public-tenant-model-settings` 提供原租户设置读写、旧配置审阅、原键收据、模型目录和协议识别。将 `PublicTenantModelSettingsModule.register` 接到同一公共服务模块及 Client，工厂返回 `{ db, assertDataAvailable }`。用 `withPublicTenantModelSettingsHttpAccess(existingHttpAccess)` 注册原租户权限；在公共 SaaS 模型及财务文档后调用 `createPublicTenantModelSettingsOpenApi(document)`。租户管理员须同时具有已有 `system:params:manage` 和完整租户数据范围，保存须带 `operationKey`。目录读取只提供元数据，模型能力与额度继续按原准入检查。
- `public-platform-finance` 在同一宿主上显式登记原八条 SaaS 财务路由。向 `PublicPlatformFinanceModule.register` 提供同一个 `PlatformServerModule` 和数据库模块，工厂返回 `{ db, profileId, assertDataAvailable }`。`profileId` 由服务器固定选择，`assertDataAvailable` 使用同一个所选数据能力的原账与结构观察。用 `withPublicPlatformFinanceHttpAccess(existingHttpAccess)` 登记原 Guard 政策，并用 `createPlatformFinanceOpenApi(existingDocument)` 合并同版文档。
- `model-configuration` 供宿主接原租户和平台配置服务，写入依赖真实的当前事务参加者。
- `task-persistence` 复用原 Task/Run 仓储和结果读取。宿主注入当前动作权限、原输入和独立收据权威，使用与原预算账相同的 `createAiTaskTransactionBoundary()`。新建和领取受当次事务约束；原结果继续由宿主按来源和字段权限投影，读取不会启动任务。
- `task-resource-ledger` 以同一严格事务边界维护 Task 的累计步骤数、调用数、活动耗时和输出字节。注入当前 Scope、已保存的计划上限及原计量证据。宿主须分别核新工作和原结清的权限，并在写入时复用传入事务。此出口可供 Runner 装配；Gateway 继续拥有模型金额账。
- `task-runner-resources` 将原计划、准备、预占和计量接到 `createPersistentAiTaskRunner` 的 `plan` 与 `resources`。使用同一严格事务边界和当前请求的 `resourceScopes`，通过 `bindEffectEvidence` 绑定原计量证据。领取恢复与释放租约也使用当次 Task 事务权威。实际工具、步骤转换与唯一 Gateway 仍由宿主显式登记。
- `task-steps` 将原 Step 登记、转换和回执接到同一 Runner。实例要求宿主的原证据、当前动作与收据权限、明确发布的工具及版本。写入复用原事务和原 CAS，重开只观察已登记 Step；提交后撤权保留原操作待核对。
- `task-measured-effects` 在实际调用前保存原开始标记，测量原注册工具的活动时间与正文 UTF-8 字节，并与同一 Runner 资源账结清。恢复只读原 Artifact。模型步骤须接原 Gateway 调用准备与同一账本的 `readDispatch`，该模块不会选供应商或派发模型。
- `gateway-admission` 提供租户级原调用的 `admission` 和 `dispatch` 参加者。使用同一严格 Task 事务边界和当次 `identities`，新建与领取须先绑定原 Invocation、当前主体、配置及期限；只有原令牌可以记录其终态。实际发送仍需原 Gateway 的路由、单账和末次授权。
- `public-tenant-gateway` 将已发布文本步骤的原输入、当前路由及预算接入 C03 和原单账。向 `createPublicTenantTaskGateway` 提供同一次已绑定的 `public-tenant-task-authority`、同一个 Task 边界、进程共享容量门、当前预算动作／权益判断、正式连接和注册协议适配器。将 `invocations`、`tools` 和 `dispatchEvidence` 交给原 Runner 测量。`recovery` 只按原调用读账，或按原已证明的未发／用量办理释放与结清。
- `model-configuration` 的 `createPublicTenantInvocationConfiguration` 读取原租户模式和加密 BYOK 连接，平台托管连接沿 `PrismaPlatformModelConnection`。两者均需当次执行权。管理设置、正常请求路由、场景输入发布、有效能力证明及正式费率／输入上限由现有授权入口提供。
- `model-adapters` 注册原 Chat Completions、Responses 和 Messages 编解码器及受控 HTTPS，从服务端挂到同一 Gateway。普通文本和流式沿原错误、取消、用量和终态合同。媒体、结构化结果及 Embedding 探测按显式协议选项启用，仍须当前能力证据。业务工具由其 Core 贡献，不从模型文本注册。
- `public-tenant-task-authority` 用原签名请求、原主体锁和已保存的 Task action policy 提供当前动作与同事务复核。宿主必须固定实际权限、已发布场景和对象来源，注入真实 `assertTaskAction`、`assertReference` 和数据观察，并在请求结束关闭请求绑定。此入口不登记 HTTP 或任何默认场景。
- `public-ai-work-center` 将 `PublicAiWorkCenterModule.register` 接到选装宿主原 `PlatformServerModule` 和 Client。用 `withPublicAiWorkCenterHttpAccess` 和 `createPublicAiWorkCenterOpenApi` 登记同源权限与接口。公共租户须有完整数据范围、`system:params:manage`、在期 `ai.native.use` 订阅权益和已保存的 BYOK 配置。租户显式允许文本检测并发布有期限的计划政策，再通过会话创建、受理、Task 创建和显式启动执行原文本挑战。公共结果只返回原诊断结论。保存、启动或派发失应答时按原定位读取，`reconcile` 只采用原 Run 和效果证据。
- `runtime/budget/public-budget-ledger` 供正式 Gateway 接入原预算账本。新预占和派发需要同一个 Task 事务边界；平台预算、费率和额度 HTTP 本身只管理原政策及人工操作收据。
- `runtime/original-result-reads` 和 `runtime/original-task-recovery-read` 只观察真实原结果；租约、审批、原账和发布字段仍由原权威核对。缺当前授权或原证据时不可用。

工作中心与受控 MCP 的公共读取使用 `@rental-os/platform-contracts/ai-work-center` 的 `AI_PUBLIC_WORK_CENTER_ORIGINAL_READS` 和 `AI_PUBLIC_WORK_CENTER_SCHEMAS`。其中 Task 摘要、Task 结果、会话摘要、会话原结果均只接受定位字段。已安装的公共诊断仅办理 BYOK 文本检测。平台托管执行需接入经审阅费率与原调用的可信输入上限，其他业务场景继续由 Core 提供。

`start` 和 `reconcile` 的 `AiPublicTaskExecution` 返回原 Task 快照。Runner 要求人工接管时，快照附带 `runner.nextAction = manual_handoff` 和原运行计量观察。`pending_original_time` 表示该 Run 仍有待核的活动时间占用。已核结果通过原 `resultId` 读取，Task 状态继续按原快照展示。调用方应保留原定位并交人工核对；合同不会为此授予重新启动或重派权限。

## Core 宿主的 Task 状态提交

从正式出口导入安全提交工厂，并复用同一请求的绑定和 Task／Step／Gateway 事务边界。

```ts
import { createPublicAiTaskTransitions, createPublicAiTaskRunnerOutcomePort }
  from '@rental-os/ai-native-server/task-transitions';

// authority 来自当前原 Guard／ALS 下 taskAuthority.bind(request, signal)。
// tasks 是相同权威、数据库和严格 transactions 的 task-persistence 实例。
const transitions = createPublicAiTaskTransitions({ db, transactions, authority });
const taskOutcome = createPublicAiTaskRunnerOutcomePort(transitions, tasks);
// 将 taskOutcome 交给 createPersistentAiTaskRunner 的原装配。
// 请求结束后沿原 finally 关闭 authority。
```

宿主仍须提供真实的 `assertTaskAction`、`assertReference`、主体锁和数据观察。工厂先核原动作，在 Serializable 事务中进入原 Native 参加者，再按原 Step 事实、Task revision、Run lease/fencing 和事件游标提交。启动使用 `transition_task`；原结果聚合与 external 恢复使用 `read_step_terminal`，事务内通过同一绑定的 `actionOn` 读取，提交后再次核结果交付权。

`transition(command)` 接受原 taskId、expectedRevision、目标状态、reason 和完整 lease。它仅处理 queued／running／waiting_external 的原 Runner 转换，目标为 running／succeeded／partially_succeeded／failed／waiting_external。人工输入、批准确认和取消仍走各自原专用仓储。公共工作中心使用同一工厂。

提交应答丢失或提交后撤权返回 `AI_RESULT_UNKNOWN`、`retryable=false`、`nextAction=reconcile`。保留原 Task／Run／Step 定位，通过原 `task-persistence` 和 `task-observation` 读取事实；不得换键重派或以错误证明回滚。该出口不写业务结果或模型金额账。

## 审批、知识与保留

- [approval-persistence](src/approval-persistence.ts) 和 [runtime/public-approval-persistence](src/runtime/public-approval-persistence.ts) 复用原提案版本、批准、单次消费、CAS 与原收据。宿主提供原对象权限和同事务业务参加者。
- [knowledge-persistence](src/knowledge-persistence.ts) 保留原知识版本、索引、来源 ACL、记忆与撤回规则。源文件及读取权威由宿主显式注入。
- [platform-retention](src/platform-retention.ts) 和 [runtime/platform-retention-http](src/runtime/platform-retention-http.ts) 使用原删除账、正文保护与恢复屏障。观察保持只读，维护在原 Native 事务中末次核权；提交未知按原键读取。
- [task-observation](src/task-observation.ts) 按当前权限读取原 Task 和事件；[runtime/public-rental-adapter-ports](src/runtime/public-rental-adapter-ports.ts) 提供 Core 适配需要的窄事务与结果端口，其源码仅依赖公共合同与服务。

## 源码与构建边界

[公共保留清单](public-source-files.json) 列出本包的189个 TypeScript 源、metadata、构建配置、装包函数和说明。入口清单继续标识原7个后继出口，已在正式 metadata 中完整登记；投影仅接受与之完全一致的声明。通过 `projectPublicAiServerSources(sources, ts)` 取得同一次固定公共投影，再以所选115模型 Client 编译和装包。

直接宿主见 [公共 API 选装入口](../../apps/platform-api/src/ai-main.ts)及[公共数据准入](../ai-native-data/README.md)。服务端依赖公共 `platform-contracts`、`platform-server`、NestJS Common、Ajv、Ajv Formats、Zod 和宿主的 Prisma 5.22 Client。包本身不提供依赖默认混合 Client 的构建钩子，固定宿主构建沿 [prepare-platform-public-ai](../../scripts/prepare-platform-public-ai.cjs)。

业务兼容源码和测试由[独立 Rental 仓库](https://github.com/JinPen-G/Zelo-rental-core)维护。源码迁移期间保留清单外的旧叶供固定对照，统一移除由集成方在原兼容验证闭合后办理。公开使用只依赖清单内的源码和正式出口。
