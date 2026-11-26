# MCP 服务接入

本包提供 Web-standard `fetch(Request) / close()`、OAuth 传输、受控只读注册及原 Native 事务适配。选装宿主通过 Node HTTP 中间件消费独立的 Rental OAuth Core、Web 控制面和业务读取参加者，原组合 API 继续转接这些相同实现。监听、TLS、代理、可信登录与人类界面由宿主负责。[Rental 参加者包](../rental-mcp-host/README.md)

业务开放须同时具备当前资源身份、原 Auth / Guard / ALS、Core 准入、持久计量、工具发布及外发字段许可。缺真实依赖或证据时保持 `unavailable`，原操作核对沿原键办理。下面的源码和验证入口随公开检出提供。

## 正式出口与构建

| 用途 | 正式导入 | 源码入口 |
| --- | --- | --- |
| 受保护 MCP 与 introspection | `@rental-os/mcp-server` | [运输入口](src/index.ts)、[资源核验](src/resource-authorization.ts)、[introspection](src/token-introspection.ts) |
| 同一 OAuth 与 MCP 服务 | `@rental-os/mcp-server/service` | [createRentalMcpService](src/service.ts) |
| 固定宿主总路由 | `@rental-os/mcp-server/host-router` | [createMcpHostRouter](src/host-router.ts) |
| 原事务仓储 | `@rental-os/mcp-server/prisma-oauth-store` | [createPrismaOAuthStore](src/prisma-oauth-store.ts) |
| 通用只读登记 | `@rental-os/mcp-server` | [工具、发布、授权、计量与字段释放端口](src/read-tools.ts) |

全部子出口及声明以包配置为准。ESM 消费者使用 `exports` 的 `import` 入口，原 Node10 类型解析通过精确 `typesVersions` 取得同一构建声明。源码链接用于阅读，运行消费使用正式包出口。[包配置](package.json)

`@modelcontextprotocol/server` 2.2.0、TypeScript 6.0.3 和 Node 类型 22.20.1 已登记在包声明与根锁文件中。准备本检出的 npm workspace 依赖后，在仓库根执行以下构建和类型命令。[依赖锁](../../package-lock.json)

```bash
npm run build -w @rental-os/shared
npm run build -w @rental-os/mcp-server
npm run typecheck -w @rental-os/mcp-server
```

原结果候选仍使用可选 peer `@rental-os/shared` 0.1.0 的真实运行时和声明。所消费的 schema、声明和 JS 须来自同一版本产物。基础运输出口可独立加载，原结果子出口的 shared 前置由宿主核定。[shared 正式出口](../shared/src/index.ts)

Rental 固定工具码与运输名由 `@rental-os/rental-mcp-host/capability-mapping` 提供，通用包不反向导出该业务映射。宿主通过本包原有 `McpReadTool`、`McpReadPublication`、`McpReadAuthority`、`McpReadAccounting` 和 `McpReadRelease` 显式绑定业务参加者。其他 Core 可按同一闭合 schema 和当前授权端口登记自己的受控读取；缺少生产者时保持不可用。[Rental 接入](../rental-mcp-host/README.md)

## 原宿主统一装配入口

`createRentalMcpService` 组合 AS 元数据、授权回调、token / refresh / 撤销及受保护 MCP。宿主显式提供同一 Serializable 仓储、当前客户端登记、AS 元数据、已完成可信同意、签发与当前 grant 读取作者。issuer、resource、端点和 scope ceiling 须一致，所有路由互异。业务 `readTools` 中的原权限、计量和 release 分别注入。[统一服务](src/service.ts)

`createOriginalMcpOAuthCore` 用原数据库和 Auth 构造唯一 store、登记、准入、同意、grant、token 及审计链。内部 `createReadTools` 同步工厂取得本 Core 的 store / grantAuthority，原目录组合可用该端口接上持久目标、预算与 Native facts。它与直接 `resource.readTools` 互斥，异步或不完整返回、自带 usage 和重复使用观察均拒绝。[原 OAuth Core](../rental-mcp-host/src/original-mcp-oauth-core.ts) · [目录组合](../rental-mcp-host/src/original-mcp-catalog-read-tools.ts)

### 原 API host 与固定总路由

`createOriginalMcpHost` 将同一 Core 接到用户同意、登记 / 通知审查、grant 管理、平台 / 空间准入、已审查投影、subject 和可选目标控制面。配置逐项核 enabled / resource / scopes 与实际工厂身份。缺独立审查验证来源时，已声明审查路保持不可用，已有投影只允许原精确收紧。[原宿主工厂](../rental-mcp-host/src/original-mcp-host.ts)

总路由按固定 HTTPS origin / pathname 分派原组件，并公开同一份冻结的 `routeUrls` 供选装 HTTP 入口使用。query、method 和 body 继续由所属组件校验。[路由器](src/host-router.ts)

关闭先停止新请求，取消并等待已接受的原 handler 和组件 close。同一组件只关闭一次，重复 close 共用同一 Promise，关闭失败保留错误。迟到同意停止交付 code，已提交或 unknown 的原操作仍按原收据核对。

### 选装 Node HTTP 宿主

`createMcpHttpHost` 接收原总路由。Nest Express 宿主在 CORS、body parser 和业务路由之前，以 `app.use(mcp.middleware)` 接管清单内的精确路径。未登记路径交还原中间件链。入口代理按固化的 HTTPS 地址转发并保留对应 `Host`、原始路径和请求体。中间件用配置中的 authority 与 `Host` 匹配，目的地不受 `Forwarded` 和 `X-Forwarded-*` 影响。原 Origin、Authorization、协议版本和内容类型继续由所属组件检查。[HTTP 适配](src/http-host.ts)

响应保持原状态、认证挑战、重定向和流式字节。断线取消传输。停机时先等待 `mcp.close()` 排空原 handler 和响应流，再释放它们共用的业务数据库。若原操作已提交或结果未知，继续按原键读取收据。生产验收仍需在所选宿主完成 TLS、代理、真实数据库及客户端往返。

### 原用户同意 Web 控制面

`createMcpConsentControlPlane` 提供固定同源 prepare / decide / receipt，以及显式配置的 reference 路。reference 用标准 OAuth 请求定位原 authorizationId，返回 `referenced / retryable:false`，供客户端在准备前保留原键。prepare 核当前登记、完整请求与原 Web 身份，首个 nonce 只交付一次，库中仅保存摘要。请求或登记修订变化在写入前拒绝。[同意控制面](src/consent-control-plane.ts) · [持久同意](src/prisma-oauth-web-consent.ts)

决定按原 nonce / revision 作 pending → approved / denied 一次 CAS，并与原 OperationLog 同事务提交。grant 与 code 另由原作者在同一事务复核已完成决定。准备失应答按原键观察，丢 nonce 保持原恢复边界，禁止重取 nonce 或重新开授权。历史 receipt 按当前本人、固定 tenant-space 的独立读权读取，返回最少原键 / 状态，原 Web 会话失效仍须重新取得当前会话。[同意到 grant](src/prisma-oauth-consent-authority.ts)

## 单独运输入口

`createProtectedMcpEndpoint(config, verifier)` 捕获显式配置及方法。关闭或缺 verifier 返回 503，非法 / 缺 Bearer 返回标准 401 和 RFC9728 资源发现提示。resource / AS 地址须为无凭据、query、fragment 的 HTTPS URL，资源路径避开 `/.well-known/`，提供的 Origin 须在固定列表中。[运输入口](src/index.ts)

当前资源核验逐次检查 issuer、client / grant / scopes、resource audience、subject、最短期限及撤销。introspection 仅访问固定 AS，Host-only 认证适配持有 AS 凭据，禁 Cookie、重定向、动态端点、active 缓存及自动重试。坏响应或缺证据保持 unavailable，明确 inactive 才按无效身份处理。内部 subject 由原 Auth 映射，外发元数据与错误只保留安全字段。[introspection](src/token-introspection.ts)

官方 SDK 处理固定 `2026-07-28` 与 `2025-11-25` 两代 stateless 协议。未声明的非初始化版本头在 reader 前拒绝，旧 initialize 可反提议已声明版本。legacy 批次最多 50 个 request，按实际 JSON-RPC method 分别分类，Header / clientInfo / human 字段不能选择免费类别。[协议发现参加者](src/protocol-traffic.ts)

`maxRequestBytes` 限制完整请求，身份等待使用配置的更短截止。只读从认证到最终响应共用最长 15 秒，完整响应最多 65,536 UTF-8 字节，包含 envelope、文本转义与 structuredContent 重复包装。返回前再次核验当前 subject / client / resource / scopes。取消与关闭停止迟到交付，原已派发工作及 unknown 占用继续等待实际结算。

### 原授权只读注册

每项工具须有闭合输入 / 输出 schema、无业务副作用 reader，以及当前 `publication / authority / accounting / release`。构造捕获正式定义和方法，当前政策逐次读取。SDK 与原完整 validator 校验同一约束，非法输入在权限、计量和 reader 前拒绝，错误隐藏私人字段路径。[只读注册](src/read-tools.ts)

执行依次经过原权限、持久计量、reader 和获准投影，再核输出 schema、使用观察及当前授权。普通 JSON 快照拒绝 getter / toJSON、自定义对象、循环、稀疏数组、undefined 与非有限数字。每个外发字符串最多 2,000 字符、数组最多 50 条，单投影 32,000 字节预检，最终仍服从完整响应上限。超限整项不可用，正式 reader 自身须有界分页。工具名称最多 50 个，定义变更通过重新装配办理。

原 grantUse 只在获准读取和输出校验完成后记录服务端 last-use。原 host 将同一实例交给 grant 摘要读端，缺行显示 unavailable。`server_read_completed` 说明该服务端完成观察，客户端交付、业务提交和当前可访问性须分别核定。[使用观察](src/prisma-oauth-grant-use.ts)

## OAuth 与可信 Web 管理

| 接点 | 职责与约束 | 源码 |
| --- | --- | --- |
| AS 元数据 | 仅配置的 AS origin 发布 RFC8414。当前已批准文档、固定 issuer / 端点 / scopes、完整有界响应逐次复核 | [authorization-server-metadata](src/authorization-server-metadata.ts) |
| public client 请求 | 当前预登记、授权码 / S256、单 resource、scope、state 与精确 redirect_uri。重复、自授及未知参数拒绝 | [请求校验](src/public-client-authorization.ts)、[标准回调](src/public-client-authorization-endpoint.ts) |
| code 签发 / 消耗 | 同一已完成同意仅一次随机 code，保存摘要及唯一原关联，commit 确认后交付，交换核该次实际回调与 S256 | [绑定校验](src/authorization-code-binding.ts)、[持久签发](src/persistent-oauth-authorization.ts) |
| token / refresh | code、family、access、refresh 与原授权同事务，轮换及复用撤销沿数据库 CAS / 唯一约束 | [持久生命周期](src/persistent-oauth-tokens.ts)、[token / 撤销 HTTP](src/oauth-token-endpoint.ts) |
| 当前 grant | 交集核客户端、平台 / 固定空间准入、当前账号、subject、修订与最短期限，损坏关联为 unavailable | [grant authority](src/prisma-oauth-grant-authority.ts)、[当前准入摘要](src/prisma-oauth-grant-admission.ts) |
| 原事务 | 参数化 SQL、Serializable、行锁、CAS、审计与提交由同一 owner 保持 | [Prisma store](src/prisma-oauth-store.ts)、[SQL 材料](mysql-oauth-schema.sql) |

HTTPS 回调须完全相等，数字 HTTP loopback 仅授权预检允许临时端口变化，交换仍核该次已保存端口。localhost、通配和自定义 scheme 拒绝。code 最多 600 秒，access 为 32 随机字节且最多 900 秒，两者还受原同意 / grant / family 最短期限限制，refresh family 期限在轮换中保持。凭据只保存摘要。

已用 code / refresh 再次到达时，先核原 client / resource 归属并提交对应 family 撤销，再在事务外返回 invalid_grant。失去新签发许可仍可撤销已有所属凭据，外 client 保持原 family。撤销仅标准空结果，实际 grant / family 状态由原证据核对。unknown 或 commit 后取消按原键观察，禁止换 family 或自动重新签发。

`store.native(transaction)` 与 `withNative(originalNative, consume, signal)` 共用同一原 client。借用入口的事务、提交 / 回滚归外层 owner，façade 只在该消费回调内有效。缺 authority、审计或表时拒绝，SQL 材料须由对应部署迁移核定。`decidedAt` 的 BIGINT 投影由三处 SELECT 显式 CAST 到 DOUBLE，NULL 保留且仅安全整数获准，超范围拒绝。

受管 Web 路由使用固定同源地址、原 Web Bearer、严格 method / query / UTF-8 表单或 JSON。POST 必须同 Origin，Cookie 混用、错 Fetch Metadata、MCP 专用 token、自报 actor / tenant / scope 均拒绝。GET 允许正常同源浏览器省略 Origin，当前原权限仍逐次检查。响应使用 no-store / no-referrer / nosniff，标准授权回调还保留 CSP。当前元数据在读取与返回前后核内容 / 修订，同修订内容变化也拒绝。[共用运输](src/web-control-plane.ts)

| 有界运输 | 字节 / 数组限制 |
| --- | --- |
| AS 元数据 | 完整文档最多 65,536 UTF-8 字节，等待最多 30 秒，未知扩展或私人字段整项拒绝 |
| 授权回调 | 完整 Location 最多 16,384 字节，等待最多 30 秒，固定 303 仅 code / error、state 与 iss |
| token / 撤销 | 严格表单及 token 响应最多 65,536 字节，等待最多 30 秒，非法 UTF-8 在原 AS 调用前拒绝 |
| grant 撤销 / subject 保存 / 原 nonce 决定 | 原固定 4 KiB 输入与闭合字段校验 |
| 登记 / 通知投影、准入保存 | 原固定 64 KiB JSON 输入，完整响应仍受 64 KiB 限制 |
| 准入 / 其他 Web 元数据 | 准入原 client 白名单最多 50 项，grant / review 保留原 32 项上限，超限拒绝完整返回 |

public-client 登记 / 审查由原当前 SaaS 管理身份办理。通知与准入的平台 / 经营空间管理分别走对应原授权，当前会话、改密义务、scope / candidate hash 和独立已批准 source 在原事务前后复核。

| 控制面 | 原生产者与授权 |
| --- | --- |
| 登记 / 通知审查 | pending 与 nonce 首次准备，原适用验证复核后一次决定 CAS / approved pointer。原历史收据独立当前读权。[review 控制面](src/review-control-plane.ts) · [client review](src/prisma-public-client-review.ts) · [notice review](src/prisma-oauth-notice-review.ts) |
| 批准后投影保存 | 当前独立已批准 source 精确匹配完整候选，原 CAS / operation / audit 同事务。缺 source 只允许已有投影精确关闭。[治理控制面](src/reviewed-governance-control-plane.ts) · [登记 store](src/prisma-public-client-registry.ts) · [通知 store](src/prisma-oauth-consent-policy-store.ts) |
| 平台 / 空间准入 | 原 SaaS 与租户完整集成管理权分别核对，固定 target 的 CAS / hash / 原键收据与日志同事务。[admission 控制面](src/admission-control-plane.ts) · [准入 store](src/prisma-oauth-admission-store.ts) |
| issuer subject | 同租户现有非 SaaS 账号的映射由服务端首次生成，停用 / 续期 / 重开保留原 subject，响应字段不含 subject 值。[subject 控制面](src/subject-control-plane.ts) · [映射 store](src/prisma-oauth-subject-store.ts) |
| grant 管理 | 当前本人或原完整租户管理权，撤销只作 enabled:false / revision CAS。本人列表最多 20 条，原键收据独立读取。[grant 控制面](src/grant-control-plane.ts) · [管理 store](src/prisma-oauth-grant-management.ts) |

通知 / 验证由当前两级已批准政策裁定。只有两级都明确 verificationRequired:false 且有原依据才返回 not_required，否则须原已完成 MFA 证据，绑定账号、会话、空间、resource、请求 / policy hash、修订与期限。普通登录、实名、Origin、nonce 或模型确认均不能补该证据。[同意政策读取](src/prisma-oauth-consent-review.ts)

原 OAuth、管理与业务日志沿同一 OperationLog 写入，缺原关联、失败或缺日志 ID 在原事务拒绝。事件仅保留原键、引用和修订，凭据、nonce、正文及私人政策由各自原存储保管。历史收据按独立当前读权读取，政策停新与历史读取分别核定。[原 OAuth 审计](../rental-mcp-host/src/original-mcp-oauth-audit.ts) · [原日志服务](../../apps/api/src/common/operation-log.service.ts)

### 可选业务 Core 准入

原宿主可通过 `original.coreAccess` 选择 [createOriginalMcpCoreAccess](../rental-mcp-host/src/original-mcp-core-access.ts)，供给真实成员读取、订阅期限及使用当前 Native 事务的物理部署观察。它复用平台 Core 授权、成员分配、原绑定和 canonical 部署停新记录，原 OAuth、Auth、Guard、业务权限与字段释放继续分别裁定。选择此参加者时，业务读取必须由同一 `createReadTools` 工厂构造，不能另挂绕开它的 `readTools` 或资源提供者。

目录与可用量读取要求部署允许新工作。保存新的原请求还须复验订阅期限。目标意图的新建、接受和采用使用同一回调内已持有的准入锁。部署停新后，原键结果、已有决定回执及拒绝操作保留原当前权限路径，不重发旧请求或新建目标。租户 Core 授权、成员分配、原角色或绑定已失效时仍拒绝该通道。必要历史与业务收尾由其已登记的原权限入口办理。

准入租约只在拥有它的原消费回调内有效，后续复核或回调外不能复用。接口与验证可从 [读取上下文](../rental-mcp-host/src/original-mcp-read-context.ts)、[原请求权威](../rental-mcp-host/src/original-mcp-request-authority.ts)、[目标权威](../rental-mcp-host/src/original-mcp-catalog-goal-intent-authority.ts) 和 [现有可信主体用例](../../tests/mcp-trusted-principal.test.cjs)定位。宿主选装、发布和监听分别配置，参加者本身不注册生产端点或授予业务执行权。

## 原目标、计量与核对

### 原持久只读预算仓储

| 接点 | 使用方式 |
| --- | --- |
| 原目标与输入绑定 | owner 在自己的 Serializable 事务核 readExisting / locate / current / auditPublished，固定 goal / grant / tool / input hash，metadata 快照最多 32 项。[bindings](src/prisma-mcp-read-bindings.ts) |
| 原预算 | 已提交原目标上 reserve / settle / markUnknown，唯一 goal 和 call 行保持跨实例累计。[budget](src/prisma-mcp-read-budget.ts) |
| 输入感知装配 | 同 Native 取得深冻结完整输入及原 call 引用，source 按可信原关联定位目标。[accounting](src/prisma-mcp-read-accounting.ts) |
| 整次调用生命周期 | withInvocation 覆盖认证 / 发布、准备、授权、reserve、读取、投影、owner 确认与最终检查，withCall 仅在对应原授权回调消费一次。[生命周期](src/persistent-read-accounting.ts) |
| 完整结算观察 | 核全部原 call、预算、连续序号、绑定及活跃占用，以 21 行哨兵拒绝超过原 20 次或缺调用 / 忙锁 / 损坏。[settlement](src/prisma-mcp-read-goal-settlement.ts) |

原预算固定每目标 20 次、300,000 ms 累计活跃、2 并行只读，每次最长 15 秒。reserve 先按 goal → call 持久保存次数与预留，确认 commit 后进入 reader。failed 保留已消费次数，unknown 保留原占用。新 token / client / connection、重建 adapter、TTL 或断线均不能重置额度。已 terminal 但丢结算应答时保留原证据，禁止二次计费。

输入 capture 固定普通 JSON 的原键序及 SHA-256，字符串最多 2,048 字符、数组 50 项、完整输入 32,768 UTF-8 字节。原输入只在该 source 调用内使用，计量行保存摘要。预算事务读取已提交的原关联，准备先提交再进入独立预算，避免持目标锁嵌套预算或重新争抢外围 grant / 身份锁。bindings 的 NOWAIT 与 goal → call 锁序保持，忙锁返回不可用。[输入 capture](src/persistent-read-accounting.ts) · [结构材料](mysql-read-budget-schema.sql)

旧 provider 直接 withCall 保留 reserve + callback 口径。当前整次包装的截止与占用延续到 settle，但 settle SQL / commit 尾段、SDK 外层包装、Resources 和其他流量的完整活跃口径仍待核定。忽略取消的原工作须等待真实结束，未 await 的原读取保留 unknown 占用。财务 tokens / Gateway calls 与业务目标计量各沿原职责。

### 初始目标与可信切换

首个目录 frontier 由原 Auth / Guard、目标 SQL、bindings 和 OperationLog 同事务建立。goal UUID 由服务端生成，ownerKey 保持 user / tenant / workspace 范围。查询、token、Host 或 adapter 变化保留原目标，换 grant / client / 范围 / policy 拒绝。旧预算存在、缺行 / 审计或占用满时拒绝 bootstrap。[原目标作者](../rental-mcp-host/src/original-mcp-catalog-goals.ts) · [目标 store](src/prisma-mcp-catalog-goals.ts) · [结构](mysql-catalog-goal-schema.sql)

目标意图先按原键准备下一输入 hash 与 nonce，再由独立当前 Web owner / grant / Guard / 适用验证作一次决定。accepted 只说明该意图已接受。采用需显式 adopt POST、同实例 withTransition 参加者和新鲜完整 settled 证据。reserved / unknown、缺预算或调用、忙锁拒绝采用，GET 和缓存意图不能发起转换。[意图](src/prisma-mcp-catalog-goal-intents.ts) · [Web 控制面](src/catalog-goal-control-plane.ts) · [原目标 authority](../rental-mcp-host/src/original-mcp-catalog-goal-intent-authority.ts)

采用在同一原事务保存原键收据、旧目标 history，CAS 更新 frontier，并写 admitted / adopted 日志。旧预算、calls、bindings 和审计完整保留，新 goal 首次读仍须准备原输入关联后进独立预算。settled / adopted 均只描述原计量或 frontier 证据，业务完成与执行批准另沿原链核定。[采用参加者](src/prisma-mcp-catalog-goal-adoptions.ts) · [意图 SQL](mysql-catalog-goal-intent-schema.sql) · [采用 SQL](mysql-catalog-goal-adoption-schema.sql)

宿主为目录目标存储、意图权威、采用及结算提供同一份固定 `OriginalCatalogGoalPolicy`。首次准入核对 `purpose` 和 `initialPolicyVersion`，历史目标与收据核对 `purpose` 并保留原记录的 `policyVersion`。不同用途或新准入版本无法为同一所有者替换原目标。原键、记录 hash、审计与账本沿原契约。[政策端口](src/prisma-mcp-catalog-goals.ts) · [Rental 生产者](../rental-mcp-host/src/catalog-goal-policy.ts)

目标意图权威必须提供同步 `acceptsNextInput(input)`。通用存储先捕获不可变原输入并计算原 hash，仅接受严格 `true`；它不转换业务输入或代替当前授权。Rental 的原权威使用同源目录 schema 和 50 条上限，并在原 Guard 事务内再次校验。缺校验器、异步返回或拒绝均不可进入原事务。[意图存储](src/prisma-mcp-catalog-goal-intents.ts) · [Rental 校验生产者](../rental-mcp-host/src/original-mcp-catalog-goal-intent-authority.ts)

### 公共 MCP 数据贡献

`@rental-os/mcp-server/data-contribution.json` 是供组合与发布工具读取的静态出口。已解析包可用 `require.resolve` 定位文件。固定 Git 快照从同一框架提交读取 `packages/mcp-server/data-contribution.json` 及其所列 SQL。`formatVersion: 1` 表示清单格式，`capabilityId: "mcp"` 与 `owner: "platform-capability:mcp"` 标识公共 MCP 的五份结构材料。`sql` 数组给出数据差异比较及新空库准备顺序，`requires` 列出跨文件 DDL 的直接前置。[材料清单](data-contribution.json)

| 顺序 | 材料 | 实际结构与前置 |
| --- | --- | --- |
| 1 | [OAuth](mysql-oauth-schema.sql) | 23 张表，覆盖原客户端、同意、准入、凭据族、grant、审查与收据。包括 `mcp_oauth_grant_self_list` |
| 2 | [只读预算](mysql-read-budget-schema.sql) | 预算、调用与绑定 3 张表。调用通过 `(goalId, grantId)` 关联原预算 |
| 3 | [目录目标](mysql-catalog-goal-schema.sql) | 1 张当前目标表。在前两份的 grant、预算和绑定表追加 `mcp_catalog_goal_grant_owner`、`mcp_catalog_goal_budget_grant`、`mcp_catalog_goal_binding_owner` |
| 4 | [目录意图](mysql-catalog-goal-intent-schema.sql) | 1 张意图表。意图与原目标的业务关联由原事务核对 |
| 5 | [目录采用](mysql-catalog-goal-adoption-schema.sql) | 2 张表，采用依赖原意图，历史依赖原采用收据 |

选用 MCP 时，发布工具应将归属、固定源提交、清单和五份原字节一起纳入比较。按数组顺序逐份比较文件及 SHA-256。新增、缺失、改名、重排、字节漂移和能力选择变化均进入数据变更核定。以固定 Git 对象或与其逐字一致的发行文件为准。Windows 检出若转换了换行，应回到固定 Git 字节取材。五份 SQL 的 DDL 依赖均在上表内。运行时原 Auth、审计、Core/AI 读取和宿主提供的持久率桶另有各自前置。原分类器使用 `client_api_rate_buckets`，该表及公共 API 的率桶均由原所属数据链核定。[原分类器](src/original-traffic-meter.ts)

已有库须同时取得物理结构和原账证据。物理观察按五份 SQL 核对 30 张表的列、类型、空值、字符集/排序规则、主键、唯一键、检查约束、索引列序和外键目标及删除/更新规则。单独核对目录目标的三条跨表索引和 OAuth 自助查询索引。记录同一数据库的观察时间和结构指纹，只需读取元数据。原账观察按实际账名、原 checksum、先后顺序以及完成、失败和回滚状态核对。若宿主使用 Prisma，由现有观察器读取 `_prisma_migrations`。原来由人工部署的材料需要可核实的原执行记录和经核定的映射。表齐但缺账、部分应用、checksum 漂移或执行状态不明，都应阻止自动标记就绪、自动重跑初始化或补写成功收据。已有凭据族、grant、预算、调用、绑定、意图和历史收据沿原键保留。旧库差异需交原数据所有者核定前进和恢复方案。[原账观察器](../core-host/src/mysql-deployment.ts)

这个出口可用于纳入数据差异比较。写入 `CoreDeploymentLock.dataCapabilities` 仍需按正式合同固定完整能力包与归档摘要、schema 文件、发行兼容版本和数据版本、正式迁移身份及数据前置。宿主还须提供对应的原迁移名和物理观察，再由 `requireDataCapabilityAvailable("mcp")` 判定就绪。[数据发行合同](../core-contracts/src/data-capability.ts) · [部署组合器](../core-contracts/src/deployment.ts)

### 原调用键只读核对

原 Web 可显式声明 readCallReceipt / readCallList 路，并供给 receiptTraffic 独立原政策源。当前本人在短事务定位原 grant / call，后续独立事务按原 grant / 身份 → goal → call 核完整关联。租户管理权不自动取得他人 call，游标只表示当前范围的位置。本人页最多 20 条、ASCII callId 顺序与 limit+1，翻页保留非完整历史快照语义。[原收据 store](src/prisma-mcp-read-receipt.ts) · [原 grant 工厂](../rental-mcp-host/src/original-mcp-grant-control-plane.ts)

返回原 call / goal、callsConsumed、reserved / unknown / returned / failed 及 held / settled 活跃摘要。returned 只表示 callback 计量结算，not_observed 保持 retryable:false。该读取只核原证据，reserve、settle、占用释放、业务重发及正文由各自原操作负责。独立当前 Web owner 可核已撤销 / 到期 grant 的历史。

### 原四类限流

协议发现 / 纯指引、人工当前复核、主动原收据核对和自动业务由固定服务端操作分类。人工与收据类别须原当前独立政策 / 引用证据，Tools / Resources 业务读取固定自动类。原 `client_api_rate_buckets` 桶在已有 Native 内原子累计，scopeKey 固定 class 与 user / tenant / workspace，限额、窗口和期限来自原政策。窗口最多一小时，保留原清理兼容。[原分类参加者](src/original-traffic-meter.ts)

当前目录自动调用、已认证 JSON-RPC 发现和本人 call 核对已有直接消费者。人工复核、匿名元数据来源限流、Resources / 其他业务及完整分类生产来源仍待接入。原期限使用 Unix 秒，窗口使用毫秒，最长一小时配合原两小时清理。分类桶与目标 20 次 / 并行 / 活跃预算分别核定，缺源、坏计数、超限或 unknown 按原失败边界处理。

## 业务资源与历史结果

原 MCP 主体只在真实 Auth / Guard 消费回调内取得当前 user / tenant / workspace / dataScope / locationScope。context、Native 和 call 绑定在回调结束 / 取消后失效，异步迟到读取拒绝。原 issuer subject 由原 grant / Auth 关联定位，调用输入仅定位受权事实。[读取上下文](../rental-mcp-host/src/original-mcp-read-context.ts) · [目录 authority](../rental-mcp-host/src/original-mcp-catalog-read-authority.ts)

| 读取或参加者 | 原入口与领域消费 |
| --- | --- |
| 目录 | 同 Native 原目录 GET Guard、Core 配置分页与正式目录 facts，保留 partial / cursor / configurationVersion。[资源](../rental-mcp-host/src/original-mcp-catalog-resources.ts) · [Core 运行时](../rental-core/src/mysql-core-runtime.ts) |
| 可用性 | 原专属 scope 与 availability POST Guard，复用原履约准入、库存快照及 computeAvailability。[授权](../rental-mcp-host/src/original-mcp-availability-read-authority.ts) · [资源](../rental-mcp-host/src/original-mcp-availability-resources.ts) |
| 原订单问题 | status / fees / payments / next_steps 按原请求选择消费历史订单、报价与检查，保留缺项和不可执行候选。[订单资源](../rental-mcp-host/src/original-mcp-order-status-resources.ts) · [业务运行时](../rental-core/src/mysql-business-runtime.ts) |
| 支付 / 退款事实 | 专用财务 Guard 与原 Native 分页，金额 / 状态来自原 PaymentRuntime，缺记录、缺资金事实保持原 unavailable / not_loaded。[固定 Guard](../../apps/api/src/common/api-auth.guard.ts) · [支付兼容入口](../../apps/api/src/modules/integrations/payment.runtime.service.ts) |
| 原请求 scope / 政策 | canonical scope 只查已有行，订阅与当前资源 policy 在同 Native 复验。[scope](../rental-mcp-host/src/original-mcp-request-scope.ts) · [请求 authority](../rental-mcp-host/src/original-mcp-request-authority.ts) |
| 原请求保存 / 核对 | 必需同 Native association 审计，saveIn 返回 prepared / commit:not_observed，reconcileIn 按原键只读且 Task 为 not_loaded。[统一参加者](../rental-mcp-host/src/original-mcp-request-participant.ts) · [保存审计](../rental-mcp-host/src/original-mcp-request-save-audit.ts) |

Native 读取复用原领域与仓储算法，活动 owner、当前授权及 signal 在实际派发前后检查。原 API / Core 目录和可用性明细上限 100，MCP 接点上限 50。库存用 10,001 溢出哨兵拒绝部分计算，内部完整有界事实按原算法求可用量。可用性观察与预占 / 下单分别执行，历史报价读取与当前计价分别取源。[Rental 包路线](../rental-core/README.md)

订单费用只读原关联快照，缺金额、报价、检查或支付来源保留原缺项与 references_only / complete:false 状态，支付缺记录与未支付分别核定。检查分页保留 partial / truncated / nextCursor，支付分页保留原金额精度及资金状态，内部读取上限另服从各事实服务。完整订单、附件 / checkout URL、Provider 引用、私人字段和模型重算结果须经所属原释放政策，内部投影不能直接当 MCP wire。

Rental 固定映射中的四项原只读码由 `@rental-os/rental-mcp-host/capability-mapping` 的 `createMappedBusinessRead` 接入 reader，报价 / 提案保存及批准后建单继续原 R1 / R2 路径。映射版本仅定位运输名称，实际工具版本、schema、权限和就绪证据由原作者提供。[正式映射](../rental-mcp-host/src/capability-mapping.ts)

| 原结果候选出口 | 精确读取与约束 |
| --- | --- |
| `conversation-result-read` | conversation / admission / result 与原请求、Task / Run 来源链匹配，unknown / failed / stale / erased 保留原状态。[源码](src/conversation-result-read.ts) |
| `conversation-operation-read` | 原 operationKey 完全一致，observed / not_observed 只描述原收据。[源码](src/conversation-operation-read.ts) |
| `conversation-list-read` | 一页 active / archived，1～20 条，末项游标与 page_not_total。[源码](src/conversation-list-read.ts) |
| `original-task-recovery-read` | 原 inputRef 到 Task / 步骤，unknown actionId 与核对指引保持。[源码](src/original-task-recovery-read.ts) |
| `quote-selection-read` | 原 inputRef / selection 及历史依据，selected_not_approved / expired / superseded 保持。[源码](src/quote-selection-read.ts) |
| `selected-proposal-read` | 原 Task / proposal / revision / reviewedPayloadHash 与单建单动作匹配，决定与执行各归原入口。[源码](src/selected-proposal-read.ts) |
| `selected-order-result-read` | 请求绑定 readResult，复验原选择 / Task / Run / inputHash、批准消费与 Core 收据，unknown 保持原键。[源码](src/selected-order-result-read.ts) |

上述候选以原完整 shared 契约及普通 JSON 快照校验私有请求 / 结果，分别最多 32 KiB / 128 KiB，所需原 schema 组件须完整供给。MCP 外发另需闭合投影 schema、publication / authority / accounting / release，并服从 2,000 字符 / 50 条 / 完整 64 KiB 响应。原 reader 负责当前本人、空间、哈希、祖先及读后权限，结果候选读取保持原状态与禁止自动重试。

## 版本化 instructions、Prompts 与 Resources

三类 provider 都由原发布 / 字段作者显式供给，构造捕获方法，当前版本与撤回逐次读取。普通数据字段先形成独立快照，getter、稀疏数组或私人转换拒绝。指引与说明正文整体最多 2,000 字符，完整响应沿 15 秒 / 64 KiB 及返回前身份复核。

- instructions 在现代 discover 与旧 initialize 提供同一已审查版本文本。缺许可省略指引，故障保持安全不可用。实际模型采用与最终目的地须由客户端单独核定。[实现](src/instructions.ts)
- Prompts 仅显式 provider 声明，list 最多 50 个版本化名称，get 仅空参数并重核当前版本。非空 arguments / cursor、版本变化或撤回拒绝，listChanged / completion 等额外能力须另行实现。[实现](src/prompts.ts)
- Resources 只按当前目录的精确同 origin HTTPS URI 定位，list 最多 50 项，禁止 query / fragment / 凭据、任意 HTTP / 文件读取或模板展开。read 经过原权限、所属持久计量、reader 和 text/plain release，再复验描述符与身份。现代 SDK 输出 ttlMs:0 / cacheScope:private，旧代次使用其原字段，templates 列表为空。[实现](src/resources.ts)

Resources 的额度 signal 与 endpoint / 协议信号相交，迟到读取停止 release，迟到投影停止交付。实际目标 / 分类 / unknown 结算仍由原源承担。客户端显式选择、真实模型访问、最终 Provider 线包和全部留存分别验收。

## 验证入口与证据范围

| 现有入口 | 可核内容 | 证据边界 |
| --- | --- | --- |
| [mcp-foundation](../../tests/mcp-foundation.test.cjs) | 官方双代 SDK、正式 ESM / NodeNext、运输 / schema / 取消与各原结果候选 | 进程内 Request / Response，发布、计量、字段及身份 / DB 含明确夹具 |
| [mcp-web-consent](../../tests/mcp-web-consent.test.cjs) | 原 host / Auth、同意 → grant / code / token、目录 / 目标 Web / 采用 | SQL、commit、适用 MFA / 发布 / release 为明确夹具，部分 API 为 transpileOnly |
| [mcp-mysql-store](../../tests/mcp-mysql-store.test.cjs) | 具体 SQL store、预算 / binding / 结算与正式包声明 | 进程内 SQL 事务替身 |
| [mcp-trusted-principal](../../tests/mcp-trusted-principal.test.cjs) | 原 Auth / Guard / Native / Core、当前主体与可选 Core 准入 | 明确 SQL / ORM / commit fixture，真实运行另验 |
| [Harness 组合](../../tests/harness-plugin.test.cjs) | 原 Loader / Loop / 私有连接与资源选择消费 | 须外部兼容 Harness 和插件源码，真实模型 / GUI / 最终线包另验 |

前三类测试默认读取本仓 `node_modules`，已有依赖放在其他受管仓库时，将 `MCP_TEST_TOOLCHAIN_ROOT` 指向其仓库根。编译器、`@types/node`、官方 SDK 和 Zod 都从同一明确目录解析，缺包会给出前置错误；测试源码和一次性产物仍属于当前工作树。Web 共用 [原身份夹具](../../tests/fixtures/mcp/original-identity.cjs) 的工具链，产物在 `output/.tmp` 下按进程独占，正常结束、失败和取消会释放自己的产物及钩子。

官方 client 用例另需 `@modelcontextprotocol/client`；原 Harness 发现用例另需本仓 `clients/harness-plugin/src/connection.ts`，完整 Harness 组合使用明确的 `HARNESS_ROOT`。这些依赖只在对应原用例加载，缺失不能被当作已通过。已有工具链可先执行 server/SQL 定向段，原命令例如：

```powershell
$env:MCP_TEST_TOOLCHAIN_ROOT = '包含既有node_modules的仓库根绝对路径'
node --test --test-name-pattern="^Prisma OAuth SQL store compiles" tests/mcp-mysql-store.test.cjs
```

正式包编译版本以 [package.json](package.json) 和锁文件为准；定向测试记录实际使用的工具链版本。离线守卫及写入目录沿本仓规则核定，以上 SQL 用例使用明确的事务替身，不连接 MySQL。公开检出当前仍缺旧 Harness 源码和部分 client/schema 依赖，完整连接验证需准备对应前置。

foundation 还保留实际输入 schema 被 Harness 校验器以 UNSUPPORTED_SCHEMA 拒绝的用例，完整输入约束保持。已有离线或声明证据只对应其固定版本及注入边界，当前客户端兼容、完整 API-Prisma strict、真实登录 / MFA、持久数据库与发布仍须各自取证。

运行前检查上述脚本实际读写。离线 Node 使用原 Prisma preload 和 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，audit / TEMP / TMP / 缓存集中本树绝对任务目录。原旧编译 / 隔离入口的 output 路径及退出清理也须满足该写入边界。阶段执行材料由原开发记录保管，公开说明仅链接版本内可读的源码和验证入口。[离线守卫](../../tests/fixtures/ai-native/prisma-offline-preload.cjs) · [验证与清理规则](../../AGENTS.md#修改验证与交付)

## 真实隔离MySQL验证入口

`tests/mcp-isolated-mysql.cjs` 是显式授权后的真实 MySQL 入口，依赖本机已安装的 Windows MySQL 8.4。它在本树新 datadir / 空库启动自己的受监督进程，核 PID、loopback 端口、实际 datadir 和库名后才执行固定 SQL，原业务库、系统服务与用户配置仍由其各自所有者管理。[脚本](../../tests/mcp-isolated-mysql.cjs)

DDL 模式核原结构、约束和 SQL 事务。显式 --native-stores 另编译原 TS store 及依赖闭包，经原生 prepared-SQL 测试驱动核独立连接的 Serializable / FOR UPDATE / COMMIT / ROLLBACK。该驱动保留原 WHERE / 锁，未知语句拒绝，实际 PrismaClient / engine、生产身份、目标与 MFA 须另验。[原生测试驱动](../../tests/helpers/mcp-native-sql.cjs)

这个旧入口会保留实例、日志和收据目录，临时 ASCII junction 仅处理 Windows 编码。执行任务须核定单一写入目录、自己创建的进程和退出清理，固化最小证据后处理其独占产物。历史次数或目录存在只作原阶段材料，当前结构 / 迁移 / 真实宿主结果以本次实际命令和收据为准。

## 剩余接入

- 生产宿主仍须接 HTTP / Nest / Guard、可信 UI、当前适用 MFA / 审查源，以及所选 MCP SQL 的正式迁移与真实持久仓储。
- 各业务运输须补齐正式 wire、版本、字段 / 目的地释放、所属持久目标与原限流来源。完整活跃口径、Resources / 其他工具和 R1 / R2 副作用沿原批准与唯一执行链继续交付。
- 安装 / 构建、浏览器 / Harness、真实数据库 / 外部服务及生产发布分别验收，固定包和原 Core / 数据准入由宿主登记。[Core 宿主](../platform-core-host/README.md) · [Rental 宿主](../../apps/rental-api/README.md)
