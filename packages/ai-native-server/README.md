# AI Native 服务端

本包承接原 AI Native 的请求工厂、Runtime、任务仓储、唯一 Gateway、模型财务账、知识与正文保留实现，以及 Rental 的业务失败出箱参加者。原入口再导出同一实现；拆分不更换状态机、工具、批准、金额规则或未知结果语义。导入和构造不会启动 Worker、清理任务、模型请求或数据库连接。

通用任务 Runner 已由[公共服务出口](../platform-server/src/ai-runtime/README.md)持有。本包的原 Runner 路径转接同一类和端口；其他 Core 可从公共出口供给自己的受控业务与存储参加者，无需加载 Rental 场景。完整请求工厂、所选数据、Gateway与业务适配继续按下面的实际宿主范围装配。

排序请求摘要从 `@rental-os/platform-contracts/request-fingerprint` 使用，原 Rental 幂等出口再导出同一函数。[公共实现](../platform-contracts/src/request-fingerprint.ts)保留已保存摘要的排序与 JSON 语义。摘要用于内容绑定；当前权限、业务执行和原操作收据仍由各自真实参加者核对。

## 公共事务出口

以下出口供宿主注入自己的当前主体、数据与业务参加者。其运行时依赖闭包只使用公共模块，原业务仓储继续拥有事务、锁、CAS、幂等及收据。

| 正式出口 | 使用方式与责任 |
| --- | --- |
| [request-binding](src/request-binding.ts) | `captureAiRequestBinding` 捕获原 ALS 身份对象及内容摘要，等待后以 `assertCurrent` 核对，退出时 `close`。它只绑定已经形成的请求身份，调用方仍须完成认证和当前权限检查。 |
| [task-transactions](src/task-transactions.ts) | `createAiTaskTransactionBoundary<Tx>()` 默认要求真实参加者。每个宿主创建一个实例，由请求参加者与所有相关仓储共用；`begin` 在首个 Task 锁前核原来源，嵌套调用沿同一事务执行 `verifyReference`，返回前执行 `revalidate`。嵌套等待完成时仍检查原持有租约，已退出的事务不能继续调用写回调。 |
| [platform-transactions](src/platform-transactions.ts) | `beginPlatformAiManagementTransaction` 绑定原 SaaS/operator 身份与宿主参加者。`createPlatformAiManagementTransactions` 复用原 `PlatformPrincipalAuthority.lock`，接收服务器登记的 `requiredPermission` 和同事务 `assertDataAvailable`，在最终数据等待后复核身份和期限。仓储必须在提交前调用返回租约的 `revalidate`，并在 `finally` 调用 `close`。 |

通用执行和模型运输继续从 [platform-server/ai-runtime](../platform-server/src/ai-runtime/index.ts)及 [platform-server/ai-gateway](../platform-server/src/ai-gateway/index.ts)取得原 Runner、Gateway 和错误类。宿主提供唯一财务账、Task 累计资源及真实业务执行端口，公共事务出口不会派发模型或自行建立事务。

[gateway-admission](src/gateway-admission.ts) 将公共租户调用接到[原准入和领取仓储](src/runtime/invocation-admission-persistence.repository.ts)。以当次公共租户 `identities` 及同一个严格 Task 边界组合，创建和领取必须在原事务中验证当前主体及已登记 Invocation。超时或失应答不允许再领取。原令牌的终态记录不要求新执行权。Rental 沿[原兼容入口](src/runtime/invocation-admission.repository.ts)保留工作空间及平台归属。

[公共租户 Gateway](src/public-tenant-gateway.ts) 将已发布文本步骤接到原 C03、路由、容量、准入和财务账。宿主用同一严格 Task 边界、请求权威及当前预算动作策略组装，把 `invocations`、`tools`、`dispatchEvidence` 交给原 Runner 测量。`model-configuration` 提供原配置和加密连接的执行读取。平台计费依赖同一原 Invocation 的有效费率与输入上限，BYOK 只记录原调用和实际用量。`recovery` 按原调用或预留定位，不重发；原未发和原用量各有独立证据与权限。HTTP、场景发布、能力证明生产和价格上限发布由正式宿主接入。

现有 Rental 仓储沿 [Task 兼容入口](src/runtime/task-transaction-authority.ts)共享同一个公共边界实例。[部署准入适配器](src/runtime/rental-adapters/task-deployment-admission.ts)保留原 Rental 停新/控制读取，[平台管理适配器](src/runtime/rental-adapters/platform-management-transaction.ts)保留所选 Rental 宿主的原主体与 Tenant 父锁。只有这些显式适配器识别旧宿主兼容选择；所选请求失活后继续拒绝。

## 公共 Task 持久层

从 [task-persistence](src/task-persistence.ts) 调用 `createPublicAiTaskPersistence`，提供同一个实际 Client、当前动作权威、原输入核定和独立创建收据权威。`transactions` 与 Gateway 预算及所选任务参加者共用一个 `createAiTaskTransactionBoundary()`，不传旧宿主选装参数。新建任务和首次领取 Run 沿调用者当次权威进入同一事务，原来源在该事务中复核。旧 Rental 构造器继续使用原宿主事务边界与已保存身份，不更换 creationKey、fencingToken 或原结果指纹。

创建只保存 Task 和首个 Run。恢复读取和原租约控制按各自的当前动作权威执行；读取结果按原 Task、Run、Step、action 与摘要核定，未知不会交付正文。返回的结果只供已授权宿主进行后续来源和字段投影，不是可直接公开的 HTTP 响应。任务执行仍由原 Runner、累计资源、已发布工具及唯一 Gateway 装配。

[公共租户请求权威](src/public-tenant-task-authority.ts)从原 Guard 已核对的请求及签名会话建立租户身份，供 `task-persistence` 消费。同一 Client 的当前 Task owner、原动作政策、当前角色和期限必须同时通过。新建和领取 Run 使用原主体锁中的 Native 读取，提交前核原会话、数据、策略和注册来源。宿主明确给出入口权限、场景／对象的 `assertTaskAction` 与同事务 `assertReference`，并在请求结束关闭绑定。没有已发布场景或原政策时保持不可用；公共租户的空地点投影不能授予 Core 业务权限。

从 [task-resource-ledger](src/task-resource-ledger.ts) 调用 `createPublicAiTaskResourceLedger`，为同一 Task 使用原步骤数、调用数、活动耗时及输出字节账。宿主提供原计划上限、独立的原计划核账读取、当前请求或 Worker 的 Scope、原计量证据和同一严格事务边界。Scope 在写入时使用传入的原事务。`write` 核新执行资格，`settle` 与 `settle_released_run` 核原占用和当前控制权限。结清须核原 charge、证据及 Run fence。缺证据继续保留原占用，恢复不增加额度。此工厂供 Runner 持久参加者消费，模型金额仍由原 Gateway 预算账处理。

[task-runner-resources](src/task-runner-resources.ts) 把原计划、准备窗口、运行计时、原证据和资源账组合成原 Runner 的 `plan` 与 `resources`。公共租户可用当次 `public-tenant-task-authority.bind()` 的 `resourceScopes`。宿主用同一严格事务边界绑定当次 authority，`claimRecoveryRun` 和 `releaseRun` 也须传入该 authority。计划和准备核验收到事务参数时在该事务读取；`bindEffectEvidence` 用同一个计时观察器构造原证据读取器。恢复只在 `recovery_time` 核到当前原租约和恢复策略后记本次观察耗时，结清原步骤用原证据。步骤转换、实际工具执行和 Gateway 由宿主的已注册参加者提供。

[task-steps](src/task-steps.ts) 复用原 Step 登记、转换、CAS、事件及原动作 ID。宿主提供已发布工具和版本的闭集、当前登记／重开权威、原转换证据与独立 `read_step_terminal` 权威。写入和原证据校验沿同一严格事务，提交后用当前读取权决定是否交付，丢应答或撤权不重做原动作。`createPublicAiTaskRunnerStepPorts` 将原回执接到 Runner 的 lease 和 step revisions；人类确认的具体参加者及实际模型／业务动作由原宿主组合。

[task-measured-effects](src/task-measured-effects.ts) 把原持久化效果、计量和累计资源接到同一 Runner。执行前保存原开始标记，以原单调时钟和实际正文 UTF-8 字节计量；工具等待不占用数据库事务。恢复只读原 Artifact 和计量，缺计量仍待核对。模型步骤须提供原调用准备和同一 Gateway 账本的 `readDispatch`，按已保存的原身份、调用、预占及派发事实结清。宿主提供当前登记和调用权，行业批准与原业务交易仍在原业务参加者内。

## 公共模型配置

宿主从 [model-configuration](src/model-configuration.ts) 创建租户或平台的持久配置工厂，提供自己的当前动作授权、SecretBox、同一所选 Prisma Client 和显式事务参加者。租户配置上下文允许只有 tenantId、actorId；invoke 仍要求业务 workspace 及其授权。调用 `registerScope` 建立原 canonical TENANT 或 PLATFORM 元数据后，再使用返回的 `configuration` 读取、保存及核对原 operationKey。元数据注册和配置保存分别拥有原事务，元数据存在不表示模型可调用。

[tenant-configuration-transactions](src/tenant-configuration-transactions.ts) 的 `createTenantConfigurationTransactions` 通过原 PlatformPrincipalAuthority 锁定租户、账号、角色和会话。requiredPermission 来自宿主登记，assertDataAvailable 在同一事务核所选 AI 数据，最后一次数据等待后再次复核会话和权限。此公共参加者接受无业务 workspace 的租户请求，Core 范围由该 Core 的参加者处理。

[租户仓储](src/configuration/tenant-model-profile.repository.ts)和[平台仓储](src/configuration/platform-model-connection.ts)沿原加密、Profile CAS 和操作收据保存，提交前重核租约并在 finally 关闭。提交应答不明保留 unknown，按原键读取；公共工厂缺参加者时不可用。原 [Rental 租户构造器](src/runtime/tenant-model-profile.repository.ts)及[平台构造器](src/runtime/platform-model-connection.ts)只连接原宿主参加者，所有保存共用上述仓储实现。

[execution-context-validation](src/execution-context-validation.ts) 使用原公共上下文 schema，保留 strict 校验且不修改输入。配置、用量和模型目录合同分别由 [platform-contracts/ai-usage](../platform-contracts/src/ai-usage.ts)及[ai-provider-discovery](../platform-contracts/src/ai-provider-discovery.ts)提供，shared 旧出口再导出同一对象。

### 选装 SaaS 模型设置

[公共设置模块](src/public-platform-model-settings.ts)从 `@rental-os/ai-native-server/public-platform-model-settings` 提供原目录、配置读取、原键收据、保存和能力证据五条路由。它使用同一 `PlatformServerModule` 的签名 Auth、原 Guard、SecretBox 和数据库对象。保存沿原会话/租户/角色锁，在 Profile、凭据库和原键收据的同一事务里复核相同 Scope、当前权限和所选数据。Scope 注册也使用原事务租约；签名会话的根读取在事务前及提交后进行。能力只读观察复用原探测收据和财务事实的核验；既有证明缺失、配置失效或伪造记录不会成为可用能力。

宿主选用此模块时，将 `withPublicPlatformModelSettingsHttpAccess(existingCoreHttp)` 作为原 `PlatformServerModule.register` 的 `coreHttpProvider` 结果，并用 `createPlatformModelSettingsOpenApi(document)` 合入同版文档。`PublicPlatformModelSettingsModule.register({ imports, inject, useFactory })` 的 `imports` 复用同一个已登记平台模块，`useFactory` 给出原数据库及 `assertDataAvailable`。可从[公共数据装配](../ai-native-data/src/public-data-admission.ts)沿选定归档、原锁和物理/原迁移观察构造该函数，接同一原 Client 或当前事务。首次安装作业显式选用公共 AI schema，并沿受权角色维护入口登记 `PLATFORM_AI_MODEL_SETTINGS_PERMISSIONS`；选择模型设置本身不会授予角色。

[原平台后台](../ai-native-admin/README.md#组合原平台模型配置)沿 `platformAiPage` 接现有页面和会话，默认公共启动由宿主维护者按所选数据与许可装配。旧全量构建继续沿原 Rental-AI 组合。

[公共平台财务模块](src/public-platform-finance.ts)使用同一个 Auth、Guard、Client 与数据准入，提供平台预算读取、保存和原操作收据，原费率审阅和原收据，以及额度队列、人工审批和原决定收据。[公共安装说明](README.public.md)列出 API、Guard 和同源 OpenAPI 的装配入口。预算政策、费率记录和额度采用原表；提交未知按各自原键读取，Gateway 预占、Task 累计和租户空间分配仍由各自原消费者控制。

### 选装公共租户 AI 设置

从 [`public-tenant-model-settings`](src/public-tenant-model-settings.ts) 取得 `PublicTenantModelSettingsModule`、`withPublicTenantModelSettingsHttpAccess` 和 `createPublicTenantModelSettingsOpenApi`。原六个设置动作继续复用同一个 Controller、注入令牌和请求合同。公共租户身份使用已有 `system:params:manage`，由签名会话确定租户和操作者，使用 `TENANT` Scope，无经营空间依赖。保存须携带原 `operationKey`；配置、默认 Profile、密文及收据在原 CAS 事务中提交。写入时以同一事务中的主体租约和数据观察复核权威，响应交付前再核当前会话。

组装时传入同一个公共服务模块与数据库模块，工厂返回 `{ db, assertDataAvailable }`。已有 SaaS 模型／财务 OpenAPI 时，在其后合入租户文档。供应商目录和协议识别复用原受控模型出网与响应限制，只返回候选元数据。设置不启用任务、验证模型能力、授予额度或消费业务 Core。旧 Rental 设置仍核原经营空间，历史操作按创建时的主体与空间读取。实际宿主和后台须显式选择这些接点。

### 公共发行构建

[公共包清单](package.public.json)发布已拆公共出口，[公共 TypeScript 工程](tsconfig.public.json)编译实际 JS 和声明。按[公共安装说明](README.public.md)先核宿主专属 Client，再由[公共装包入口](public-package.cjs)从同次输出收集所有出口及所需依赖文件。旧混合包继续使用原 `package.json`、构建和历史数据锁。

完整原组合宿主从 [服务装配](../../apps/api/src/application-services.module.ts) 使用这些工厂。[独立 AI 宿主](../../apps/rental-api/src/ai-app.module.ts) 则显式选择 AI 数据贡献，由 [同实例装配](../../apps/rental-api/src/ai-composition.ts) 提供原 Auth、Guard、Core、数据库和文件权限。只有该宿主 [实际登记并审核的处理器](../../apps/rental-api/src/ai-http-policy.ts) 才发布为可调用能力；工厂、类型或合同存在不等于该宿主已开放全部 AI 路由。

[批准订单授权桥](src/runtime/approval-execution/approved-order-route.authority.ts) 在进入隔离 Guard 前捕获原请求权威；完整 Guard 和身份一致性通过后，准备、读取与执行回调恢复同一原 ALS store。原 Task/批准/Core 事务和幂等仍由真实参加者裁定，失应答保持 unknown，不按新键重发。

Task 准入与人工批准/重新准备复用[同一服务政策读取](src/runtime/task-service-admission.ts)。现代 BYOK 的平台金额为零或未配置时，仍核服务开关、场景政策、凭据配置和计划期限；平台付费与旧政策继续按原金额及层级门槛核定。人工批准在其原事务中读取这些政策，并将配置和计划修订绑定到确认依据，独立人工权限、提交前复核和批准消费由原服务执行。

Core 停用后的已有回答及模型结果核对，由宿主 [只读处理器闭集](../../apps/rental-api/src/ai-http-policy.ts) 明确开放。原读取器仍执行当前主体、Task/Run 来源、原键和对象权限检查；缺结果保持未知。读取不创建任务、不领取新调用、不恢复模型执行，也不恢复已撤销的成员权限。

## 入口与调用方

| 入口 | 职责与边界 |
| --- | --- |
| [runtime/ai-native-application.providers](src/runtime/ai-native-application.providers.ts) | 原请求与服务工厂的装配入口。公共包、Rental 以及宿主提供原实例；配置、当前权限及真实依赖决定每项能力是否可用。 |
| [runtime/rental-adapters](src/runtime/rental-adapters/prisma.service.ts) | 旧类令牌与窄类型接点。适配器不构造第二个数据库、Auth、Core 或业务状态。 |
| [runtime/task-transaction-authority](src/runtime/task-transaction-authority.ts) | 所选宿主的任务新写在原事务内核 Tenant / Core / 原来源；嵌套调用必须沿同一事务和任务。旧已派发结果继续按原 lease、dispatch token、收据和 CAS 收口。 |
| [runtime/task-start-admission.composition](src/runtime/task-start-admission.composition.ts)、[原场景事务](src/runtime/scenes/original-scene-transactions.ts) | 报价澄清、开业诊断和订单解释沿原请求工厂启动；保留 Guard 形成的身份，在原 Scope/Task/Plan 写入前进入同一 Auth/Core/业务来源参加者。 |
| [runtime/task-input/prisma-task-input.repository](src/runtime/task-input/prisma-task-input.repository.ts) | 保存原回答与收据。单模型续答同事务登记无租约的后继 Run，显式续程执行前复验当前权威并领取租约。嵌套原收据观察使用只读 RR 快照；写入与取消见证仍由原 Serializable 事务及 CAS 裁定。 |
| [runtime/client-scene.composition](src/runtime/client-scene.composition.ts)、[客户资料与任务事务](src/runtime/scenes/client-selected-transactions.ts) | 所选客户入口保留原 ClientAuth 对象与请求 ALS；同一事务先核会话/Tenant/Core，再核本人订单、目标/报价参数、发布资料与 Task。报价准备和确认尝试各绑定原材料及政策，提交前复核原 Core 规范化结果。参加者仅支持明确登记的场景，不创建营运权限或第二个任务。 |
| [原场景策略](src/runtime/scenes/request-bound-scenes.application.ts)、[计划策略仓储](src/runtime/runner/prisma-task-plan-policy.repository.ts) | 配置策略在原 Auth/Tenant/Core 与业务来源核验后提交 CAS/审计；读取只观察原策略，不占用任务或派发模型。 |
| [runtime/task-provider-dispatch](src/runtime/task-provider-dispatch.ts) | 在 Vault 等待之后、唯一模型运输之前复核当前任务权威；短事务结束后才执行原外部调用。 |
| [runtime/privacy/prisma-ai-body-storage](src/runtime/privacy/prisma-ai-body-storage.ts) | AI 专属正文视图保留原事务和原密文规则；只按真实所选 Client 的模型关系编解码，不能借默认 Client 的其他 schema。 |
| [runtime/contracts/http-openapi](src/runtime/contracts/http-openapi.ts) | 原 AI 操作及其 schema 的单源合同。独立宿主只发布实际挂载范围，并保留未完善的原合同缺口。 |
| [business-events/prisma-business-failure-outbox](src/business-events/prisma-business-failure-outbox.ts) | `PrismaBusinessFailureOutbox` 参加原检查、退款、通知事实事务。真实失败才写出箱，存储失败继续使业务事务失败；沿用原去重与历史事件失效规则。 |
| [business-events/return-exception-source](src/business-events/return-exception-source.ts) | `returnExceptionSource` 核对原检查版本、唯一异常 ID、原审核状态和来源指纹。缺历史依据不补造失败事件。 |
| [privacy/notification-draft-reader](src/privacy/notification-draft-reader.ts) | 校验原草稿、不可变元数据和 `AiDataErasure` 收据。`createNotificationDraftBodyRetentionReader` 仅使用 `aiDataErasure.findUnique`，不写入正文或删除账。 |
| [privacy/retention-policy](src/privacy/retention-policy.ts) | 原 `AI_RETENTION_POLICY` 与 `retentionDeadline`。策略版本、期限和未决效果约束保持原值。 |
| [task-errors](src/task-errors.ts) | `AiTaskRepositoryError` 的唯一类身份，供旧仓储与独立读取器共同抛出和识别。 |
| [knowledge-fingerprint](src/knowledge-fingerprint.ts) | 原 `fingerprint`：对 `JSON.stringify` 的结果取 SHA-256，保留属性顺序。它与正式 `requestFingerprint` 的排序语义不同。 |

完整 Rental 宿主把同一个 `PrismaBusinessFailureOutbox` 实例交给事实仓储，事务参加者直接使用收到的 transaction。检查、退款和通知链需要真实 AI 表及该实例；不能用空函数、内存替身或缺省成功填补。原 `fulfillment` / `opening` 扩展仍由 `BusinessFailureResourcePorts` 提供真实业务观察和存储能力，提取并不替宿主补齐这些端口。

人工回答保存与执行续程分开处理。Core 撤权后可按原收据权限核对已保存回答，恢复当前授权后才可显式续程；重复续程不追加模型调用。每次派发复用唯一 Gateway 预占和结算，任务累计用量不重置。只读观察不取得对原提交事务的隐式共享锁，也不授权写入或重发。[原事务用例](test/original-scene-transactions.test.cjs) · [原执行与续程用例](test/original-scene-execution.test.cjs)

客户的原任务模型启动、恢复、输入读取/保存、同 Task 续程与输入收据，复用 [客户请求应用](src/runtime/scenes/client-request.application.ts)、[标准客户场景](src/runtime/scenes/standard-client-entry.application.ts)和[原执行组合](src/runtime/scenes/client-task-execution.composition.ts)。事务参加者保留原 ClientAuth/请求身份、本人对象、当前发布与政策；Vault 读取后仍复验当前权限，失效时不发送模型请求。续程沿原任务与累计资源、同一 Gateway 预占/结算；unknown 只按原调用/holder/收据核对。宿主仅挂载明确选定方法，这些工厂方法不自动发布全部旧客户报价或 booking 操作。[客户同事务用例](test/client-selected-transactions.test.cjs)

客户明确选择目标候选后，经[原报价准备](src/runtime/scenes/client-quote-preparation.composition.ts)保存参数，再独立确认同一材料哈希。[原报价适配](src/runtime/client-quote-original.composition.ts)在每次 Guard 复验后回到所选宿主的原请求身份，使用原 ClientApi/Core 报价与原操作收据。确认尝试只有首次保存成功且收到回执后才允许派发一次；丢失应答或重复确认沿原引用核对。参数准备、报价保存与 Booking/订单提交分别办理，停新后的精确读取不授予新的准备或确认。

客户 Booking 使用[原草稿仓储](src/runtime/scenes/prisma-client-booking.repository.ts)保存创建、明确选择、转接及提交状态。同一原 Serializable 事务在 Draft 或材料写入前核 ClientAuth/Tenant/Core，在写入后复核原材料、政策、发布及期限。页面受理和提交尝试通过[限定事务参加者](src/runtime/scenes/client-selected-transactions.ts)保存，外部材料写入仅接受当前 Draft 所属事务。原 Guard 复验后恢复同一请求身份调用 ClientApi/Core；只有首次尝试提交得到回执才派发订单，重复或失回复只核原收据，submitted 仅表示页面请求已受理。原订单事务在首个 Tenant 锁前取得同一客户会话租约，再核独立政策、渠道发布和原 Draft/受理/attempt；订单、报价消费与幂等收据写入后再次复核材料及期限，失败整笔回滚。原收据使用独立读取政策，过期和停新后的读取保留本人及渠道隔离。

[Booking 跨渠道转接](src/runtime/scenes/client-booking-transfer-host.ts)由原签发/消费仓储保存短期引用，目标端重新通过 ClientAuth 后只绑定同一客户、空间和原 Draft。双方政策按固定渠道顺序锁定，ClientAuth/Tenant/Core 先于 Draft 锁，原材料正文保留源渠道绑定。目标端消费后沿原受理、唯一 attempt 和 Core 幂等键提交，较短的转接期限在订单事务末次等待后仍须有效；历史签发/消费收据不延长期限或重新派发。

员工图片/语音识别从[原请求工厂](src/runtime/inspection-assist/inspection-assist.composition.ts)进入[标准识别组合](src/runtime/inspection-assist/inspection-standard.application.ts)。所选宿主保留最初 Guard 形成的请求身份，资源授权仍复核当前员工、空间、地点、订单及检查阶段；旧宿主继续使用自己的隔离身份作用域。冻结输入、Task 创建、显式执行、原结果引用及[调用账务](src/runtime/staff-inspection-accounting.composition.ts)各有独立入口，执行复用原 Gateway 单账和累计资源。结果保存只追加待核候选，人工采用/更正和原 Core 履约提交分别办理。独立宿主从[精确处理器清单](../../apps/rental-api/src/ai-http-policy.ts)发布上述操作，员工端通过[原运输工厂](../rental-core/clients/staff/inspection-transport.ts)读取和确认。

租户预算经[原管理应用](src/runtime/budget/budget-management.application.ts)和[租户 Controller 包装](../../apps/rental-api/src/ai-budget-http.ts)进入同一设置服务。所选宿主保留最初 Guard 的请求身份，配置 Scope、政策 CAS/收据及平台费率采用的原事务先核 Auth/Tenant/Core，写入后复验当前权威；丢失提交应答只核对原操作。BYOK 保留调用与 Token 单位约束，租户自定费率入口继续拒绝。平台管理方法沿独立平台授权宿主办理。

[价格历史工厂](src/runtime/budget/gateway-pricing-request.composition.ts)只按当前管理权限读取原价格、采用和输入上限依据，输入上限另核同一调用主体、空间和内容摘要。宿主以精确处理器闭集保留停新/Core停用后的原收据读取，撤权或身份变化仍拒绝。设置和历史接口均复用原 shared/DTO/OpenAPI；它们的挂载不启用模型执行，也不替代租户 AI 服务设置中的平台额度申请与空间分配。

租户能力检测由[原请求工厂](src/runtime/text-capability-probe-request.factory.ts)承接准备、原请求发布、Task、策略、执行、历史及账务十九个操作。[能力事务参加者](src/runtime/text-capability-probe-transactions.ts)从原请求绑定同一 Task/Run/Step，在原写事务中先锁当前 Auth/Tenant/Core，再核部署准入、空间、原输入及任务，提交前复验权限和期限。显式启动复用原 Gateway 和财务单账，原调用观察与供应商验证证据分别保存；模拟结果保留未验证状态。

`readCapabilityReceipt` 可能保存能力证据，按写入处理。手动释放和核账仅消费原调用的未派发或用量事实，并在原账务事务中复核当前主体及任务关联；已派发调用的自动计量与结算继续由原善后路径负责。完整的停用配置保留原八项读取，原收据不授权新发布或派发。启动与恢复从原请求的服务器响应观察断连，正常 body 完成不会触发取消，返回结果仍交宿主处理。

[平台能力检测](src/runtime/platform-capability-probe/platform-capability-probe-request.factory.ts)保留所选宿主最初 Guard 的 SaaS 身份，区分查看与管理权限。[平台探测事务参加者](src/runtime/platform-capability-probe/platform-probe-transactions.ts)将原 input/Task/Run/Step/调用键绑定到原事务，并在提交前复验。唯一 Gateway 财务账与 Task 累计资源保持原职责；失应答只沿原键核对。平台探测仅在首个 Run 且整 Task 无补充输入时读取空输入历史，供应商派发还要求 PLATFORM/OPERATOR/SAAS_ADMIN 和 ai.capability.text 的原关联；不完整租户上下文拒绝进入平台分支。

[隐私维护](src/runtime/privacy/retention.controller.ts)在工作空间及平台各保留清理与原收据两类 HTTP 能力。原清理事务先锁当前 Auth/Tenant/Core 或独立 SaaS 主体，再锁 Scope/内容，提交前复验；终态 Task 存在未决财务或业务效果仍不清理。protectStoredBodies、exportRestoreManifest、reapplyRestore 保持宿主专用，恢复不授予重发许可。

经营政策由[原请求工厂](src/runtime/automation/human-automation-policy-request.composition.ts)进入[政策管理服务](src/runtime/automation/human-automation-policy-management.service.ts)。所选宿主保留最初 Guard 的请求身份，内部配置权限核验先由原 Guard 填充自己的验证作用域，再核当前主体与范围。确认授权和政策写入共用原事务，复用 Auth/Tenant/Core 参加者、政策 CAS 和原操作键，提交前复核当前权限及所有嵌套准备的期限。

发现、预览与原收据读取不签发执行权。显式准备和提交记录政策边界，重复或丢失提交应答沿原键核对；原影子/人工确认约束、过期政策停用及旧宿主兼容路径继续由原管理服务裁定。直接消费者是[经营政策客户端](../rental-core/admin/task-center/api/aiAutomationPolicies.ts)，宿主从[实际处理器](../../apps/rental-api/src/ai-http-policy.ts)发布十个操作及三项停用后原读取。

经营待办的[原请求工厂](src/runtime/automation/human-automation-request.composition.ts)分别接收营运和员工二十个操作。所选宿主保留最初 Guard 的同一身份对象，内部业务 Guard 复验后经原受控桥返回该请求，供 Core 核定原资源。[候选服务](src/runtime/business-events/business-failure-candidate.service.ts)、[持久批次](src/runtime/business-events/pending-candidate-batch.repository.ts)和[Task 创建](src/runtime/automation/automation-failure-task.service.ts)继续使用原 Outbox、输入和 Task 仓储。

[经营事务参加者](src/runtime/automation/human-automation-transactions.ts)分别加入各个原事务，在候选、输入或 Task 锁前核当前 Auth/Tenant/Core、部署准入和原订单。创建 Task 复用原创建仓储的事务，保留 `creation_unknown` 与原 Task/Run。人工授权和[反馈/关闭](src/runtime/automation/human-automation-review.service.ts)沿原 CAS 和操作收据提交，最后一次授权等待后同步核期限与原政策发布指纹，撤权或发布变化使当前事务回滚。

直接消费者为[经营待办客户端](../rental-core/admin/task-center/api/aiAutomationReviews.ts)的十六个方法，写入应答不明沿原操作读取。每端停新/Core停用后的读取闭集是 `readPendingBatch/readCreation/readQueue/read/forEvent/operation/readGrant`，`readCandidate` 因可能更新过期标记归写入。解释由[独立解释应用](src/runtime/automation/automation-explanation.application.ts)承接原 Task 的读取、准备和明确启动，其当前事务依赖由同一 provider 注入。离线验证沿[原事务入口](test/original-scene-transactions.test.cjs)及原前端工厂，SQL运输与回滚替身的范围独立于真实 MySQL 和宿主验收。

当前租户页面的额度申请、空间分配及调用记录经[租户额度 Controller](../../apps/rental-api/src/ai-credit-http.ts)进入[原额度服务](src/runtime/budget/ai-credit.service.ts)。所选宿主绑定最初 Guard 的同一 ALS 身份，申请与分配在原事务中复用[Auth/Tenant/Core 参加者](src/runtime/tenant-model-config-transactions.ts)，提交前复验权限，丢应答只核原操作收据。历史调用在有界快照中读取原 invocation、usage 和账务依据，BYOK 不生成金额，缺用量不补零，查询和游标继续核当前租户及空间范围。平台批准保留独立管理授权与原增额语义。

[平台模型设置](src/runtime/platform-model-settings.application.ts)保留所选宿主最初 Guard 的原请求身份，继续由原平台配置权威区分查看和管理权限。Scope 初始化及[加密配置保存](src/runtime/platform-model-connection.ts)的原事务通过[平台事务参加者](src/runtime/platform-management-transaction.ts)锁定当前 SaaS 主体、会话和所选数据依据，提交前再次复核。未选择独立宿主时沿原隔离请求作用域。目录和能力证据按有界查询读取，保存保留原 CAS、操作收据及未知结果语义；前端通过[同源客户端工厂](../ai-native-admin/src/platform-model-settings/platformAiSettings.ts)消费五个操作，写请求关闭认证刷新后的自动重发。

[平台预算设置](src/runtime/budget/platform-budget-settings.composition.ts)与[费率审阅](src/runtime/budget/platform-reviewed-gateway-price.service.ts)通过同一管理应用接入所选宿主，保留最初 Guard 的 SaaS 请求身份。政策 CAS 与原操作收据、不可变费率记录在各自原事务中取得平台事务参加者，写后复核当前权威。[平台预算 Controller](../../apps/rental-api/src/ai-budget-http.ts)分别声明三读两写，原前端客户端使用相同公共合同。

[平台额度审批](src/runtime/budget/ai-credit.service.ts)复用同一额度服务和原账本，由[平台额度 Controller](../../apps/rental-api/src/ai-credit-http.ts)挂载申请列表、批准决定和原决定读取。目标租户来自持久申请，管理租户与目标租户按固定顺序锁定，再由原平台参加者锁定主体和会话。新增批准在同一事务复核目标状态、CAS、原操作键及金额上限，提交前再次核权；已提交的同键决定允许在目标冻结后按当前平台读写权限核对，金额只增加一次。

Rental 的通知缓存和草稿仓储通过 `@rental-os/rental-core/notification-draft` 消费以下组合：

```ts
const retention = {
  state: notificationDraftRetentionState,
  receiptId: notificationDraftRetentionReceiptId,
  createReader: createNotificationDraftBodyRetentionReader,
} satisfies RentalNotificationDraftRetention;
```

读取正常未删除草稿时允许返回 `null`；已删除草稿必须能核对真实删除收据。缺表、缺收据、跨空间、错误来源哈希、超前删除时间，以及已记录删除但恢复了旧密文的行都保持不可用。读取不会重放删除或修改恢复结果。

## 数据与兼容归属

宿主选择 [公共数据](../../apps/platform-api/prisma/schema.prisma)、[Rental 数据](../rental-core/prisma/schema.prisma)及 [AI Native 数据贡献](../ai-native-data/README.md)，使用其组合生成的唯一 Prisma Client。生成和数据准备属于宿主，版本、锁和物理观察仍按正式数据部署流程裁定；本包不执行迁移、不声明数据库已就绪。

首次源码构建先由[纯schema准备入口](../../scripts/prepare-selected-prisma-schema.cjs)选择 `--mode rental-ai --output <apps/rental-api下尚不存在的直接子目录绝对路径>`。宿主独立生成该248模型schema的 `generated/client` 后，再从仓库根设置绝对路径并构建；准备schema不依赖业务 `dist`，也不等于已生成Client。

```powershell
$env:RENTAL_PRISMA_CLIENT = (Resolve-Path 'apps/rental-api/generated/client/index.d.ts').Path
npm run build -w @rental-os/ai-native-server
npm run lint -w @rental-os/ai-native-server
```

build/lint 使用[显式所选Client编译器](../../scripts/build-selected-prisma.cjs)的 `--mode rental-ai`；同一绝对变量传递给 Rental 前置构建。CLI也可传 `--project tsconfig.json --client <index.d.ts>`，lint 增加 `--noEmit`。它读取既有真实声明及同目录schema，核原Task、请求和Invocation等模型，不生成默认Client、不读 `.env`、不加载Client运行值或连接数据库。缺生成物、默认模板和选择冲突均明确失败；包原rootDir及出口保持，输出声明仍由消费者同一所选Client解析 `@prisma/client`。

旧组合 `apps/api` 的241模型具有原AI模型，可在明确设置 `RENTAL_PRISMA_LEGACY=1` 并指定本仓库原默认生成声明时构建兼容包；另核其schema与原源码一致。独立宿主拒绝该兼容模式。[所选编译回归](../../tests/selected-prisma-build.test.cjs)仅在测试进程内生成官方声明验证161/247/241边界，不是生产生成入口，也不替代真实磁盘构建或部署验收。

独立镜像沿[Rental构建说明](../rental-core/README.md#使用与构建)的[宿主打包入口](../../scripts/package-rental-host.cjs)，显式选择 `--ai enabled` 并追加 `--ai-data-package <完整固定AI数据包绝对目录>`；同时提供原含AI的prepared目录、完整Rental包、公共41与所选248声明。打包消费已经构建的本包 `dist` 与宿主 `dist-ai/ai-main.js`，核完整AI数据包摘要及原58份迁移；缺包、错模式、缺实际运行出口或不同schema均拒绝。Linux镜像内按原锁生成两个专属Client，当前打包不安装、不执行Docker、不迁移，结果始终区分 `imageBuild=not-run` 与 `deployment=pending`。

旧 [出箱入口](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-outbox.ts)、[归还异常入口](../../apps/api/src/modules/ai-native/business-events/return-exception-source.ts)、[Task 仓储错误](../../apps/api/src/modules/ai-native/ai-task.repository.ts)和[保留策略](../../apps/api/src/modules/ai-native/privacy/retention-policy.ts)再导出同一对象，保留错误 `instanceof` 和出箱 Symbol 身份。

原 [通知正文维护者](src/runtime/privacy/retention-notification-draft.ts)继续拥有授权重查、scope 锁、未决效果核对、原密文校验、正文 CAS、快照清理和删除账写入。它复用本包的 reader、`metadataSchema`、`sameReceipt` 及原 ID / scope / hash 校验；这些纯函数不授予清理权限。维护服务、知识服务、任务执行器和模型财务账使用迁入的原实现，旧路径不保留第二份逻辑。

Prisma 的类型由宿主所选 schema 生成。SQL、Decimal、空值单例和错误类使用 [公共 Prisma 运行值](../platform-server/src/prisma-runtime.ts)；本包不要求生成 `node_modules/.prisma/client`，也不在运行时重定向 `require`。

原 [业务事件合同验证](../../tests/ai-native-events-contracts.test.cjs)仍经兼容入口消费唯一实现。[独立宿主权限回归](../../apps/rental-api/test/ai-composition.test.cjs)检查真实 Auth、Guard、所选数据准入与知识文件 ACL。离线核验使用本仓库原守卫、当前所选 schema 的官方 DMMF / 类型及事务 fixture；真实数据库约束、迁移、外部投递和正式宿主运行分别验收。
