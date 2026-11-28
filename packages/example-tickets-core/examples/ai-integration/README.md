# 工单 Core 的可选 AI / MCP 接入

本目录提供两个 **MCP 只读适配**（当前可见工单、本人原收据），以及供原计量Runner登记的 **开始处理工单** 批准执行参加者。它们调用普通Core的同一`TicketsService`，复用[HTTP / Zod合同](../../src/http.ts)，不重写工单权限、状态转换或存储。普通Core无需导入本目录，也不需要模型或MCP。[普通业务与安装](../../README.md)

内置任务已有显式`@rental-os/example-tickets-core/ai`请求端口和单独编译/标准包命令，尚未完成可选HTTP宿主的运行验收。内置AI与MCP分别接入、分别验收；参加者编译通过不代表真实数据库、OAuth或完整业务闭环已可用。

## 来源与使用条件

原读取示例固定于 `c9d6505201fd09786563262e04932673ea94156c`；宿主基础为Zelo `a18d1d763dbe8e98d85e862a83d58ee2ad7cf150`。该基础的npm包版本是`example-tickets-core` 0.1.6、`mcp-server` 0.1.1、`core-contracts` **0.1.0**、`ai-native-server` 0.2.1；本片工单候选为 **0.2.0**，新增同事务接点。Core接入协议`CORE_CONTRACT_VERSION`为 **0.1.1**，与npm包版本分别核对，不能将协议号写进依赖映射。这些源码候选不等于已发布或已安装。

Task/Run提交复用固定补片`831dbee0f699b68119fa11a53c34d7b1ff5769cd`的正式`@rental-os/ai-native-server/task-transitions`出口，Core事实类型消费其后继`1d6785212c032d2891f495c107978c1b0b9284df`。合并依赖为安装PR #11、Core模板PR #13、公共Task合同PR #16，再到本适配PR #15；不能用较早0.2.1源码的同名包替代这些固定出口。

在所选固定源码与已准备的公共AI SDK/专属Client下，先编译普通Core，再运行`npm run build:ai -w @rental-os/example-tickets-core`。普通`build`和`pack:core`不加载AI；选装使用`npm run pack:core:ai -w @rental-os/example-tickets-core -- <仓库HTTPS地址> <本次固定提交> <底座来源JSON> <新包.tgz>`。它增加`entries.ai`及本次实际编译的`dist-ai`文件，不改变工单SQL、数据版本或原角色。两种包通过完整清单及sha256区分，必须选择匹配的部署锁；选装入口的存在不等于数据已部署、权益已开通或工具已发布。

```ts
import { createTicketsAiRequests } from "@rental-os/example-tickets-core/ai";

// dependencies来自所选宿主的同一Client、原Auth/principal、SecretBox、订阅和工单事务参加者。
const requests = createTicketsAiRequests(dependencies);
// request由原Guard/ALS提供，signal绑定本次请求；输入中没有身份、权限、租约或工具代码。
const result = await requests.consume("result", request, { taskId }, signal);
```

[tickets-reads.mts](tickets-reads.mts) 是 ESM 消费者，仅使用包的正式出口。宿主将该源码纳入自己的受控构建，并提供同版依赖及真实权威。禁止深层导入其他包的 `src`、从模型生成的路径调用 API，或用另一个工作树的活动构建产物运行。

## 两个读取工具

| MCP 名称 | 唯一输入 | 原调用与范围 |
| --- | --- | --- |
| `example_tickets_get` | `{ ticketId }` | `TicketsService.get`；当前 operator、租户、Core 授权、成员分配和 read 权限，普通成员仅能读本人创建或获分派工单 |
| `example_tickets_receipt` | `{ operationId }` | `TicketsService.receipt`；本人原操作、当前对象可见性与独立原收据准入，保留 `recorded / unavailable` |

输入 schema 取原 `TICKETS_HTTP`，不接收 tenant、subject、audience、角色或自报权限。适配在每次原授权回调中读取当前主体，不比较或直接转换 OAuth issuer subject 与内部 user ID。结果仍按原完整 Zod 合同校验，再核对象 / 原键及租户一致性。原详情的 `description` 可以有 4,000 字符，内部校验保留完整内容；外发还必须通过独立字段许可和 MCP 的 2,000 字符限制，不能截断后伪称完整原结果。

`receipt` 返回的工单是原操作时快照，不能当作当前状态。`unavailable` 不表示未执行、未消耗或可重试。超时、取消和断线后保留原 `operationId`，仅按原收据核对，不换键、不重发。本示例没有任何写方法或重试逻辑。

## 显式装配到外部 MCP

工厂没有默认权威；缺少 service、当前主体、发布、授权、持久计量、字段放行或闭合外发 schema 时返回 `unavailable` 和静态缺件码。它要求原 `withInvocation` 与 `withCall` 同时存在，保留整次调用和一次额度消费的原生命周期。`configured` 只说明接线形状齐全，不能在产品目录显示为“业务可用”。

以下函数在宿主的受控装配模块中使用。参数必须来自该宿主当前的原 Auth / Guard / ALS、正式 OAuth / Core 准入和持久计量实现，代码不提供恒真授权或内存生产账。

```ts
import { createProtectedMcpEndpoint } from "@rental-os/mcp-server";
import type { ProtectedMcpConfig, ResourceTokenVerifier } from "@rental-os/mcp-server";
import { createTicketsMcpReadTools, type TicketsMcpReadDependencies } from "./tickets-reads.mjs";

export function composeTicketsReads(
  endpoint: Omit<ProtectedMcpConfig, "readTools">,
  verifier: ResourceTokenVerifier,
  dependencies: TicketsMcpReadDependencies,
) {
  const integration = createTicketsMcpReadTools(dependencies);
  if (integration.status === "unavailable") return integration;
  return {
    status: "configured" as const,
    endpoint: createProtectedMcpEndpoint({ ...endpoint, readTools: integration.readTools }, verifier),
  };
}
```

这里不启监听、不创建 OAuth grant、不填写平台模型配置。服务选装、TLS / 路由、原 verifier 与 `protocolTraffic`、数据准入和退出时 `endpoint.close()` 仍由 [正式 MCP 宿主](../../../mcp-server/README.md)负责。不要把 `tools[].read()` 直接暴露为 HTTP 或模型回调；必须经过上述正式端点的完整受控路径。

| 注入项 | 必须来自何处、每次核什么 |
| --- | --- |
| `service` | 原 [工单平台装配](../../src/platform-host.ts)的服务，保留 [MySQL 执行](../../src/mysql.ts)的当前授权、对象范围与提交前复核 |
| `currentPrincipal` | 当前 `authority.withRead` 回调内的可信请求上下文；身份变更或回调结束后不能复用。不能从工具参数、缓存或固定管理员对象构造 |
| `providers.publication` | 当前已审查的精确工具、版本、client / grant / scopes、tenant / audience、权益 / 政策及字段许可；目录和调用均重新核定 |
| `providers.authority` | 原 Controller 等价 Auth / Guard / ALS，核当前角色、对象范围及 Core 准入；映射已验证资源主体，消费后复核。不得跨原授权事务建立会争抢同一身份锁的嵌套事务 |
| `providers.accounting` | 原持久目标、调用和适用额度；`withInvocation` 包裹整次工作，`withCall` 在原授权回调中消费一次。缺目标或原账拒绝，不因换 token / 进程或超时重置 |
| `providers.release` | 当前已审查目的地 / 字段许可；返回完整、独立的外发投影，不能原样返回原服务对象或因 schema 通过而省略许可 |
| `outputSchemas.get / receipt` | 与相同已审查投影一致的闭合 JSON Schema，根 `type: object`、`additionalProperties: false`。按实际获准字段提供，不默认公开姓名、tenantId、说明或其他私人字段 |
| `providers.usage`（如使用） | 原完成观察，不能自行伪造使用时间或把服务器完成当作客户端已收到 |

原 [read-tools](../../../mcp-server/src/read-tools.ts)负责当前发布 → 原授权 → 持久计量 → Core 读取 → 字段放行 → 当前复核与输出校验。撤权 / 停用不能被 `configured` 或旧目录缓存绕过；普通读取停止后，原收据仅在原独立善后权限仍成立时可读，不能恢复普通访问。

外发 schema 与 `release` 要同时保留原键、`recorded / unavailable` 和原快照含义。原 transport 限制每字段 2,000 字符、数组 50 条及完整响应 64 KiB；超限整项不可用，不拆成未获授权的追加读取。

本适配使用 `/original-read-tool` 的普通 JSON 快照及同版 schema 编译器。原完整工单继续用正式 Zod response 校验：Core 的 OpenAPI 3.0 转换器包含 `nullable` 和布尔 exclusive 边界，不能直接冒充 JSON Schema。已有 JSON Schema 原合同的 Core 可复用该出口的 `createClosedOriginalRead`。

## 三条路线分别接入

| 路线 | 身份、资源与模型账 |
| --- | --- |
| 普通 Core | 原 operator / tenant / 成员 / 对象范围与 Core 准入；不安装此适配、不启 AI 也可完成业务 |
| 外部 MCP 纯读取、客户端自付模型 | 当前 OAuth 资源身份映射回原业务主体，仍核业务权限、政策、发布、字段和适用工具限额。纯读取不要求平台模型或平台模型预算；客户端模型自付，不把本地 Key 交给平台 |
| 内置 AI 或实际委托服务端模型 | 原服务端任务身份、当前 tenant / audience / 角色 / 对象来源，固定场景与工具版本、权益 / 政策、累计 Task 资源。模型调用另走唯一 Gateway 和平台财务单账；不能调用供应商 SDK 或借客户端 Key 绕过 |

内置AI不复用OAuth token充当服务端任务身份；MCP成功不代表内置AI通过。模型已配置、包已安装、工具已登记分别只是前置，均不代表业务可用。

## 原批准与开始处理工单

[tickets-start.mts](tickets-start.mts)只登记`example-tickets.ticket.start`版本`1`。`prepareTicketsStart`从原服务读取事实；`TicketsStartBindingSchema`绑定持久输入记录ID、修订和摘要，`createTicketsStartProposal`用同一份原输入形成明确的输入/预览/对象版本。准备不自动批准，不派发动作。

`prepareTicketsStart`调用普通服务的`prepareStart`，与`start`共用当前权限、受派者、状态及版本校验，只读事实，不占用操作键。以下参加者提供该场景的持久接点，仍须由显式宿主组合后使用：

| 参加者 | 权威与原结果 |
| --- | --- |
| [tickets-authority.mts](tickets-authority.mts) | 从正式tenant任务身份读取原scope；当前`ai.native.use`权益、精确发布及原输入摘要绑定同一工单事实。原输入使用普通operationId作为requestKey，同键异参拒绝，不覆盖旧输入；历史回读不恢复新工作权。 |
| [tickets-publication.mts](tickets-publication.mts) | 沿正式租户配置事务显式发布唯一工具与累计资源限额；不创建默认额度/权益。政策修订CAS与原操作日志收据同事务，提交失应答保留原operationId。 |
| [tickets-approval.mts](tickets-approval.mts) | 从已登记Step和持久原输入形成提案，调用原C05创建及人类决定仓储；页面只提交提案引用和已查看摘要，批准正文从原表重读。批准与工单执行是不同动作。 |
| [tickets-plan.mts](tickets-plan.mts) | 原计划只含一个已发布工具，输入正文、Step指纹与普通操作键同源；在原计划保存事务中登记ActionInput，原输入、发布或权限变化均拒绝。 |
| [tickets-runner.mts](tickets-runner.mts) | 原Task/Run提交、准备计量、Step登记及C05待批完成后释放租约；明确批准后由正式`continuePending`接续同一Run。中途不明只观察原任务，不新建任务或重放工具。 |
| [tickets-results.mts](tickets-results.mts) | 同一Task、原artifact、C05消费与精确工单收据一起核对；业务已提交与任务计量是否完整分别显示，不用工单收据补造丢失的计量事实。 |
| [tickets-evidence.mts](tickets-evidence.mts) | 只读原计划/ActionInput、原计量artifact及三种业务资源、C05和精确业务收据；成功产生`core:example-tickets:ticket`及原修订快照。缺消费或完整计量不得声明提交，unknown只保留原证据。 |
| [tickets-application.mts](tickets-application.mts) | 当前签名请求组合正式正文保护、tenant身份、工单Step证据与上述参加者，结束时关闭绑定。 |
| [tickets-http.mts](tickets-http.mts) | 同源闭合输入/输出、OpenAPI和精确Core路由；HTTP只传原引用、操作键与业务输入，不接受身份、租约或批准证明。 |

`createTicketsStartSource`从原受保护数据库view读取Task、Step、原输入、提案版本和批准；当前主体、场景、发布/权益/政策来自已绑定的`createPublicTenantTaskAuthority`。宿主须在该权威的`assertTaskAction/assertReference`中接入上述场景参加者，数据库使用正式`createAiBodyStorageDatabase`保护view，发布使用固定管理权限的`createTenantConfigurationTransactions`。不能从HTTP body传执行上下文、租约或批准证明，也不能用固定管理员/恒真回调补缺件。

`createTicketsStartExecutor`返回原`TaskRegisteredExecutor`，供`createPublicAiTaskMeasuredRunnerPorts`显式登记。原Runner继续拥有阶段标记、Task累计额度、租约与unknown。它在同一strict Task Native事务中先取得工单当前授权和写锁，再核原事实、C05 `prepare`、普通`TicketsService.start`、精确`receiptFor`证据及C05 `commit`；业务行、原收据、平台审计和批准消费一起提交，任一失败回滚。不把此executor直接挂成HTTP、MCP reader或未经计量的模型回调。

原工单/版本或原输入、目标、提案、工具版本变化时拒绝；同键已有其他动作也拒绝。已提交的原批准只能回读同一操作收据；结果不明保持`retryable:false`和原operationId，原Runner通过原结果读口核对，不重新执行。服务端模型不是该业务执行器的职责，需要模型时另接唯一Gateway与财务账，不直连供应商。

## 完整宿主的接点

选装入口为 `@rental-os/example-tickets-core/ai`；普通包不会加载它。`createTicketsAiHttpContribution()` 和 `createTicketsAiOpenApi()`必须与同一标准AI包及原Guard组合。`TicketsAiHttpModule`提供 `POST /api/cores/example-tickets/ai/<action>`，动作集合由 `TICKETS_AI_HTTP`声明；URL使用小写单连字符（如`prepare-input`、`create-task`、`prepare-approval`、`original-task`），程序动作名仍为`prepareInput`等。未知动作拒绝。发布另核当前`system:params:manage`，新工作核`example-tickets:ticket:start`，批准和执行各自重新核原依据；原结果读口不恢复新工作权。

OpenAPI从同一输入/输出schema投影，联合状态和仅null分支使用OpenAPI 3.0的显式表示。此投影的ESM入口通过`createRequire`消费与普通Core相同的Zod实例，避免Zod双入口导致类型判断不一致。原事实的tenant、对象ID和修订相等约束登记在`x-field-equalities`；它是文档说明，运行时仍由原`superRefine`及服务权威执行，不以文档约束替代校验。

请求顺序是`prepareInput`保存受权事实 → `createTask`创建原任务 → `prepareApproval`计量准备并释放租约 → `approval`展示原提案 → `decide`记录人类决定 → `execute`明确执行 → `result`读取原收据。写请求失败、断线或超时后只用`originalInput`、`originalTask`、`approval`、`result`核对原引用，不换操作键或自动重发。`observeInterrupted`仅接原Runner的恢复观察，不能证明未消耗或重新派发工具。发布也有独立的`publicationOperation`原结果读口。

显式宿主见[可选AI装配](../../../../apps/example-tickets-api/src/ai-main.mts)及[运行说明](../../../../apps/example-tickets-api/README.md#可选工单ai宿主)。它与普通HTTP共用原Auth、Guard、数据库和生命周期；公共AI数据包须由同一部署锁固定，并在原事务中核迁移及物理状态。包构建/HTTP合同和宿主接线不等于真库、浏览器或完整A04通过。

普通 HTTP 已提供 `GET /api/cores/example-tickets/tickets/:ticketId/ai-status`，单源schema和OpenAPI沿[工单HTTP](../../src/http.ts)。`createTicketsAiStatus({ service, builtin?, mcp? })` 接受宿主的真实只读状态参加者，并复用普通工单详情权限与返回前版本检查；`TicketsHttpModule.registerFactory` 的 `aiStatus` 注入该服务，缺省两条路线均明确 `unconfigured/host_not_selected`。这个默认值只说明尚未装配，不能作为完整AI验收。

状态为闭合的 `unconfigured / denied / unpublished / available / pending_approval / reconciliation_required / unavailable`，原因由所属权威归类，异常不返回数据库/凭据细节。原任务状态必须显式提供同一 `taskId`；不根据最近记录或页面缓存猜测。`executionGranted:false` 始终成立，执行时仍走完整原授权。当前内置示例为无模型业务任务，MCP为客户端模型自付的纯读取；两者不检查平台模型连接或云模型财务预算，原Task/工具适用限额仍须核验。将来选择服务端模型路线须另接唯一Gateway和原财务账，不能借用这两条状态。

[工单后台宿主](../../../../apps/example-tickets-admin/src/tickets-ai.tsx)已选用状态区，复用公共查询/按钮/语言与会话隔离，刷新期间或失败时收起旧状态。已选内置AI宿主时，[原任务区域](../../../../apps/example-tickets-admin/src/tickets-ai-task.tsx)沿`@rental-os/example-tickets-core/ai-http`提供各次显式动作；进入详情不创建、批准或执行任务。原引用按租户/用户/工单保留，刷新只回读，未知请求禁止换键重做。真实内置与MCP运行仍分别验收。

以下均为已核正式出口，不是本目录已经完成的装配。宿主必须固定工单场景、输入 / 对象来源与版本，再接同一 Core 的原方法。

| 阶段 | 正式接点与工单落点 |
| --- | --- |
| 受权事实、任务与工具 | `@rental-os/ai-native-server/public-tenant-task-authority`、`/task-persistence`、`/task-steps`、`/task-measured-effects`；`TaskRegisteredExecutor.resolve(toolCode, toolVersion)` 只解析已发布工具，执行时调用当前受权 `TicketsService`，原输入从保存的 `inputRef` 取得，不从模型补造 |
| 准备及必要批准 | `/approval-persistence` 的 `createPublicAiApprovalPersistence` 与 `/runtime/public-approval-persistence` 的 `ProposalCatalogue`、`AiApprovalAuthority`；批准绑定原输入 / 指纹、目标、提案修订、工单 expectedRevision、来源事实和工具版本。相关依据变化沿原规则拒绝或重新确认 |
| 正式动作 | 原 `create / assign / start / close` 决定业务事实；更新沿原 `expectedRevision`，幂等沿原 `operationId`。`attachEffect(...).prepare(native, binding)` 与 `.commit(native, binding, resultRef)` 必须加入同一原业务事务；不能先扣批准再另开工单事务，也不能在 MCP 只读注册中执行动作 |
| 原结果与 unknown | 原 `TicketsService.receipt(principal, operationId)` 与 `/task-persistence`、`/runtime/original-result-reads`、`/runtime/original-task-recovery-read`；保持原 actionId、操作键和结果引用，缺原证据不补成功、不重新派发 |
| 任务资源与模型 | `/task-resource-ledger`、`/task-runner-resources`、`/task-measured-effects` 保持累计资源；需要服务端模型时接 `/public-tenant-gateway` 和 `/runtime/budget/public-budget-ledger`，恢复不重置账 |

Task/Run聚合提交已使用上述固定正式出口，工单发布、原输入、计划、批准、执行、Step事实、结果与HTTP参加者已提供。可选宿主数据准入已经接到原观察器，页面动作沿同源合同接线；真实MCP身份/发布/计量/字段权威和两条路线的实际运行仍须完成。工单成功用自身已提交对象及精确原收据证明`committed`，不能伪装成订单/报告事实或`effect:none`；公共仓储继续拥有状态机、CAS、事件与复权。[原批准消费](../../../ai-native-server/src/runtime/approval-consumption-persistence.repository.ts) · [工单事务](../../src/mysql.ts)

MCP的`/service`、`/persistent-oauth-authorization`、`/persistent-oauth-tokens`和`/prisma-oauth-store`提供不限定workspace的通用端口。历史名`createRentalMcpService`不代表必须使用Rental范围；`OriginalOAuthPrincipalBinding`的workspace约束属于现有Rental身份适配器。工单tenant参加者沿这些通用端口接入原平台Auth，不捏造空间ID。

## tenant MCP 参加者

`npm run build:mcp -w @rental-os/example-tickets-core`单独编译`/mcp`出口。普通构建、AI入口与普通标准包不加载它。[tenant参加者](tickets-mcp-tenant.mts)提供显式发布、持久人工同意/grant与原授权撤回；[读取宿主参加者](tickets-mcp-read-host.mts)提供两个工具的同事务业务权限、固定字段投影、原持久计量和原账回读。此阶段尚未提供可启动的MCP宿主，不能将这些工厂的存在标为业务可用。

- 浏览器控制面须先经原Guard建ALS，再由`withBrowser`重核签名会话。OAuth身份取该已核会话的持久定位，随后同Native锁定并复核原账号、租户、角色与Core准入；没有客户端自报tenant或workspace。
- `prepareConsent`核原客户端注册、PKCE和精确回调，保存请求及已阅摘要。`decide`只消费同一持久待决记录，批准与grant及审计一起提交。发布政策使用当前`system:params:manage`、精确client修订、scopes、有效期和显式discovery限额，无默认允许值。
- `preview`与`authorizeRead`由已登录的人类明确选择原工单或原操作，复核事实及已阅摘要后登记读取目标/输入绑定；工具调用只定位既有绑定。tenant/user唯一目标不随token、grant或进程重建，原20次/300000ms/2并发账沿正式`createPrismaMcpReadAccounting`执行。更换grant或目标依据必须拒绝；当前未提供新目标接续，不能删除旧记录重置额度。
- 协议发现使用原`consumeRateLimitBucket`和`platform_api_rate_buckets`，计数键固定tenant/user/协议操作，超额也在同Native提交原计数后拒绝，不占用业务读取账。调用中的原计量事务另用连接，宿主数据库池至少保留两条连接；不能让外层身份锁和内层原目标账争用单连接。
- 工单外发仅`id/subject/state/revision`；原收据仅原operationId及对象`id/state/revision`，保持`historicalSnapshot:true`。不外发tenant/user、说明或受派者。
- `original(grantId)`只给当前原Auth确认的本人回读原目标、预算和调用状态。撤回授权或原签名到期后，新合法登录仍可查看本人的原账；这不恢复工具权限。`reserved/unknown`保留占用、原callId与`retryable:false`，不因TTL或缺行退款/重发，也不把`returned`当作客户端收到或业务提交证明。

[选装SQL材料](migrations/001-tenant-mcp.sql)只定义工单自有的政策、同意、grant、目标及绑定五表；不修改原MCP五份SQL，不包含账号/业务Seed或token明文。它须通过宿主显式后置迁移接入同一数据计划，当前尚未登记到标准包/安装贡献，不可直接执行作为安装替代。服务装配、人工同意页面、当前可用性与真实OAuth往返仍待完成；本阶段仅核内存类型、原生ESM装包加载及缺原身份拒绝，未验真实数据库。

可用性UI和宿主装配继续沿本端口接线。两个MCP reader只可在真实权威已齐备的宿主选用，缺失时保持`unavailable`，不能把默认未配置当成完整MCP验收。

## 必要验证与边界

准备原锁对应的受管依赖后，可复用仓库内存类型入口；`--deps` 可指向明确的只读第三方依赖目录。源码和公共包出口始终取本工作树，不生成 Client / dist，也不连接数据库：

```sh
node scripts/check-selected-prisma-types.cjs --mode platform --config packages/mcp-server/tsconfig.json packages/example-tickets-core/examples/ai-integration/tickets-reads.mts
```

离线执行按 [原守卫](../../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)设置 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，audit / TEMP / TMP / 缓存只写本树单一任务目录，结束后清理。这里的类型命令不代替正式包构建。原 [MCP 验证入口](../../../mcp-server/README.md#验证入口与证据范围)可核原注册及协议行为，不为本示例新增测试工程。

宿主最终还须分别取得：真实身份和字段发布、Core 撤权 / 停用、原持久额度拒绝、批准依据变化、正式动作及 unknown 原收据、内置 AI 与外部 MCP 往返证据。类型检查、进程内替身冒烟和源码说明不代表真实数据库、OAuth、模型、供应商或完整业务验收通过。
