# Rental OS MCP 服务：标准接入与安全治理方案

> 版本：设计稿 v0.1；日期：2026-10-27。
> 文档性质：按负责人要求形成的后续 MCP Server 设计，不是现有接口说明、实施任务或生产开放许可。本文的 MCP endpoint、运输工具名、OAuth scope 和新增管理对象均为拟议内容。
> 相关依据：[客户端需求](Agent接入改造-需求.md)、[开发任务](Agent接入改造-开发任务.md)、[方案评审](Agent接入改造-方案评审.md)。原 Core、Auth / Guard / ALS、批准 / 幂等 / 收据及服务端模型单账不改变。

## 1. 目标与结论

提供一个**运行在 Rental OS 服务端、经后台明确开通的标准 MCP Server**。用户可在兼容的 Codex、Claude Code、Claude Desktop 或其他 MCP Host 中连接系统，使用获准的查询、方案准备与任务能力，不依赖安装 Rental OS Harness，也不依赖某台运营电脑在线。

“任意 Agent 可接”指遵循受支持协议和认证方式、经管理员准入的客户端可以接入，**不是匿名访问、全 API 开放、任意模型目的地已经被证明安全或所有历史版本保证兼容**。没有开通、有效授权或工具权限时，服务器不返回业务资料、不执行动作。

推荐采用：**HTTPS + Streamable HTTP + OAuth 授权码 / PKCE + 后台应用登记 / 用户授权 + 原业务权限交集**。MCP 只做运输适配，不重建 Agent 循环、业务规则或任务账本。先开放最少只读与原结果读取，再逐项开放准备、原批准后的执行和云任务委托。

## 2. 与现有系统的关系

```text
原 Web 后台 ───── 原登录 / 原 Controller ──────────┐
Rental Harness ─ 受限原生桥 / 隔离业务 Web ────────┤
外部 MCP Host ── OAuth / MCP 协议适配 ─────────────┤
                                                 ↓
                       当前身份 + 原业务权限 + 接入渠道政策
                                                 ↓
                       原受权事实 / 原任务 / 原批准 / Core
                                                 ↓
                       原审计与收据 → 接收方最少字段投影
```

| 现有所有者 | 可复用职责 | 不可照搬的假设 |
| --- | --- | --- |
| [Auth / API Guard](../../apps/api/src/common/api-auth.guard.ts) | 当前人员、租户、空间、地点 / dataScope、业务入口权限和权益 | Web access token 不交给外部 Agent；MCP token 不冒充 Web token |
| [受权业务组合](../../apps/api/src/modules/ai-native/tools/business-tools.composition.ts) | 目录、可用性、候选、订单事实、Core 报价及原业务应用 | 类或方法存在不表示可以外调；不绕 Guard 直调 Core |
| [桌面业务应用](../../apps/api/src/modules/ai-native/desktop-business/desktop-business.application.ts) | 当前政策、投影、原审计与重校验设计 | 它绑定隔离 Web 身份和 `human_preview / not_sent`，不能原样作为 MCP 返回 |
| [原订单读取](../../apps/api/src/modules/ai-native/scenes/original-order-read.controller.ts) | 原任务 / 准备 / 答案 / 收据读取 | `recover`、`resume`、接管不一概等同只读 |
| [原报价选择与确认](../../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller.ts) | 原输入、选择、确认 / 批准和执行结果 | 人类选择 / 批准接口不注册为模型工具 |
| [Harness MCP 客户端](../../clients/agent-desktop/harness/packages/mcp/README.md) | 自有 Harness 连接外部 MCP 的能力 | 这是 client，不是 Rental OS 对外 server |

新增 MCP 不替代已实现的原生桥。将来 Harness 也可以消费同一服务端业务能力，但不强制立即迁移，不让原生桥和 MCP 对同一次动作各执行一遍。

## 3. 标准协议与接入方式

### 3.1 协议基线及版本兼容

2026-10-27 查阅的官方 `latest` 指向 **2026-07-28**。该版本与 2025-11-25 存在重要差异，不能把旧版 `initialize` / Session 模型写成永远适用的标准。建议使用经核验版本的官方 MCP SDK，并实现双代兼容；不要手写一个类似 JSON-RPC 的私有接口后称为 MCP。

| 内容 | 2026-07-28 主路径 | 2025-11-25 兼容路径 |
| --- | --- | --- |
| 发现 / 协商 | 每请求携带版本、clientInfo、clientCapabilities 元数据；服务器实现 `server/discover` | `initialize`、`notifications/initialized`，按初始化结果协商 |
| HTTP | 单一 endpoint 接收 POST，返回 JSON 或请求级 SSE | Streamable HTTP POST；GET 可提供 SSE 或返回 405 |
| HTTP 元数据 | `MCP-Protocol-Version`、`Mcp-Method`，指定方法还需 `Mcp-Name`；与 body 的对应值一致 | 按旧版版本头及初始化约定处理 |
| 会话 | 无协议级 Session，不发行 MCP-Session-Id | 若启用旧版 Session，服务端绑定主体 / grant；Session ID 不是认证凭据 |
| 工具结果 | `resultType: complete` 等新版字段，结构化结果按 schema | 按旧版 ToolResult 字段序列化；不强塞新版 envelope |
| 长连接通知 | 可选 `subscriptions/listen`，不是 GET 长流 | 可选旧版 GET / 通知能力 |
| 断开 / 取消 | 关闭 SSE 是该请求的取消信号；不证明业务回滚 | 断线不等于取消，按旧版取消通知处理；也不证明回滚 |

业务对象、原请求键、原执行收据和当前授权**独立于协议代次**。协议降级只发生在进入业务执行前；不得收到业务 unknown 后换协议再次执行。未知版本按规范拒绝并返回支持版本，不回退匿名或弱认证。

### 3.2 传输方式

| 方式 | 采用建议 | 边界 |
| --- | --- | --- |
| 远程 HTTPS Streamable HTTP | 首选；示意地址 `https://mcp.example.invalid/mcp` | 地址占位，尚未部署；身份在 Authorization 头，不进 URL |
| 本机 stdio 官方连接器 | 后续兼容只支持本地进程的 Host，按需提供 | stdout 只写 MCP；诊断写 stderr；本地连接器只代理远程受权服务，不直连数据库 |
| 旧 HTTP+SSE 双 endpoint | 默认不新增 | 已废弃运输；Streamable HTTP 内部使用 SSE 不等于旧 HTTP+SSE |
| WebSocket / 私有 IPC | 不作为通用接入标准 | 不暴露 Electron IPC、本机 Host token 或任意网络代理 |
| MCP Apps / 内嵌界面 | 可选后续扩展 | 不能作为首版兼容或人类批准的唯一依赖 |

远程全部 HTTPS。验证存在的 Origin，非法即拒绝；原生客户端可不带 Origin，但仍必须认证。CORS、IP 白名单与 Origin 不是用户身份。受保护内容不经共享 CDN 缓存。新版 GET / DELETE 按规范 405；旧版仅在明确兼容分支处理，不混用 Session 语义。

## 4. 服务分类与标准方法

### 4.1 协议服务

| 服务 | 标准方法 | 本方案用途 |
| --- | --- | --- |
| 发现与能力 | 新版 `server/discover`；旧版 `initialize` | 声明实际支持的版本及能力，不泄漏租户或业务数据 |
| 工具 | `tools/list`、`tools/call` | 最少业务查询、准备、原操作 / 任务读取 |
| 资源 | `resources/list`、`resources/templates/list`、`resources/read` | 获准说明、原结果和安全材料资源；读取仍逐次验权 |
| 提示模板 | `prompts/list`、`prompts/get` | 可选任务起步模板；不是授权、批准或执行命令 |
| 进度 / 通知 | 按协议版本支持 | 仅安全状态和变更提示；不把通知当执行回执 |
| 长任务扩展 | 首版不要求 | 原 Rental Task 通过普通工具发起 / 读取即可；MCP Tasks 扩展不是新业务数据库 |
| Sampling / Roots / Elicitation | 首版不依赖、不主动请求 | 不借客户端模型替平台付费，不扫描本机文件；输入弹窗不是可信业务批准 |

仅声明已实现能力。首版最小兼容以 Tools 为中心，Resources / Prompts 缺少客户端呈现支持也不应阻断核心流程。工具列表按当前 grant 和权限过滤、确定性排序、分页；即使客户端缓存旧列表，`tools/call` 仍重新验权。

### 4.2 业务工具目录

下列为拟议 MCP 运输名称，**不是已上线方法或新增业务代码**。已有工具码保持原名，例如 `rental.catalog.search`；没有既有稳定码的只标功能，须由原公共作者确认入口后发布，不能编造成功适配。是否采用点号或下划线由目标客户端实际兼容测试确定，映射固定后版本化。

| MCP 运输名（拟议） | 对应原能力 | 输入 / 输出及限制 | 阶段 |
| --- | --- | --- | --- |
| `rental_context_read` | 当前接入授权摘要 | 无自授 actor；返回当前授权空间、安全标签、允许能力及期限，不返回凭据 / 完整角色树 | 最少只读 |
| `rental_catalog_search` | `rental.catalog.search` | 有界条件 → 获准目录投影、观察时间、版本、覆盖 / 缺项；不直接返回当前人工预览包装 | 最少只读 |
| `rental_availability_check` | `rental.availability.check` | 已受权引用、绝对时间 / 时区、地点和数量 → 原可用性事实；不等于预占 | 只读扩展 |
| `rental_customer_selection_read` | `membership.customer.resolve` 与原人类选择 | 只读可信页面选定结果 / 安全引用；不接受姓名电话全文给模型、不默认选同名首项 | 选择器完成后 |
| `rental_order_explain` | `rental.order.explain` 的确定性事实读取 | 受权订单引用 + 有限问题 → 最少原事实；缺支付记录不等于未支付，不暗中启动云模型 | 只读扩展 |
| `rental_quote_prepare` | `rental.quote.preview` 及原报价准备 | 原选择 / 条件 / 请求引用 → Core 报价、币种 / 分项 / 版本 / 期限；若持久保存，按 R1 和原幂等处理 | 原键前置后 |
| `rental_order_propose` | `rental.order.propose` 及原提案生产者 | 已核对报价 / 输入 → 已保存或待核对的提案；无真实持久生产者不可用 | 准备阶段 |
| `rental_order_commit` | `rental.order.commit` 的原批准执行 | 只提交原操作 / 提案引用，服务端读取真实批准并复核；不能传批准布尔值或领 worker lease | 写入门齐备后 |
| `rental_operation_read` | 原请求 / 操作 / 收据读取 | 精确原引用 → 已受理、已保存、已执行、失败、未知及当前可办理性；不查最新记录替代 | 与副作用同片 |
| `rental_operation_list` | 本人受权的原操作索引 | 有界过滤 / 游标 → 恢复候选引用；人选择精确原操作，不自动将最近一项当本次结果 | 与恢复同片 |
| `rental_task_read` | 原 Task / 订单解释结果读取 | 精确原请求 / 任务 → 当前允许的状态、事实 / 结果和缺项；不启动 run | 可独立先交 |
| `rental_order_analysis_request` | R13.1 / R13.2 有限服务端场景 | 固定场景、结构化输入、原请求 → 持久受理；可能云模型收费，单独开关 | 协同阶段 |
| `rental_task_cancel_request` | 原取消意图与收据 | 当前权限、原任务和预期修订 → 取消请求收据；不等于已取消或已回滚 | 原取消链验收后 |
| `rental_human_action_read` | 原固定 Action 映射 | 原操作引用 → 获准页面入口及安全说明；链接不携 token、不是批准凭证 | 选择 / 确认阶段 |

**禁止发布：** 任意 URL / Header / HTTP 方法、SQL、Shell、脚本、业务 DOM 自动控制、凭据读取、任意场景 / 提示词代理、替用户批准、退款 / 扣款 / 收款、资金处分、配置与授权管理工具、任意跨用户委派或接管。后台管理能力不因为 MCP 连接者是管理员就自动暴露给模型。

### 4.3 Resources 与 Prompts

拟议资源使用 `rental://` 逻辑 URI，例如 `rental://operation/{reference}`、`rental://task/{reference}`、`rental://capabilities`。URI 只标识对象，不能作 bearer 凭证。不得提供任意文件路径、HTTP URL 或 SQL 参数资源模板。每次 `resources/read` 执行与工具相同的当前授权、字段投影及期限检查；列表名、说明和错误也不能泄漏无权对象。

可选 Prompts 仅提供“准备租赁方案”“解释原订单”“核对原操作”等有限引导，不嵌入秘密、完整业务资料或任意系统指令。`prompts/get` 不写数据、不触发任务或批准。不能把安全校验藏在用户可忽略的 prompt 中。

## 5. 后台开通、白名单与认证

### 5.1 分层开通

有效权限取以下交集，任何一层拒绝都不调用业务生产者：

```text
平台允许接入
∩ 租户明确启用外部 MCP
∩ 客户端登记有效
∩ 用户 / 服务身份授权有效
∩ 经营空间 / 地点 / 数据范围当前有效
∩ OAuth scopes 与 grant 工具白名单
∩ 原角色权限 / SaaS权益 / 原能力当前成熟度
∩ 数据释放政策 / 额度 / 版本 / 原确认和批准
```

白名单不是只列“Codex、Claude”两个名称。需要登记应用标识、认证方式、回调 URI、适用租户 / 人员 / 空间、工具集合、信息类别、有效期、调用限额与可选网络约束。`clientInfo.name`、User-Agent、客户端自报模型或 IP 不能证明应用身份。

### 5.2 后台管理对象

复用原后台和管理权限结构；下列是接入授权元数据，不是第二套角色、订单或业务任务库。具体表结构待正式实施设计批准。

| 对象 / 页面 | 必要字段或操作 |
| --- | --- |
| 接入应用 | client ID、类型（public / confidential）、认证方式、固定回调 / CIMD、责任方、状态、有效期 |
| 租户 MCP 政策 | 默认关闭；工具 / 风险分级、外部可释放字段、允许接入方式、数量 / 速率 / 并发 / 云调用规则 |
| 用户连接授权 grant | 绑定原用户、tenant、workspace、client、scopes、工具、授权修订、到期及撤销状态 |
| 人员选择与同意页 | 原系统登录后由用户选择被允许的空间和范围；明确数据会交给外部 Agent 及可能由其保存 |
| 活跃授权与撤销 | 列出本人 / 有权管理的连接、最近使用时间；撤销 grant、应用、刷新令牌；不展示 token |
| 审计与异常 | 授权签发 / 扩权 / 撤销、调用 / 拒绝 / 超限、原操作与业务收据关联；不记录敏感入参全文 |

平台管理员管理接入应用和平台上限，不因该角色自动获得租户业务数据；租户管理员仅在自身租户管理政策，不可扩大用户原业务权限。授权政策修改沿原 CAS / 操作审计，保存 unknown 时按原键核对，不反复生成新密钥。

### 5.3 OAuth scope 与业务白名单

下面是拟议的授权分组，不是现有权限码。它们只收紧原权限，不能替代原角色 / 资源 ACL；生产命名随公共合同冻结。授权页初始只请求连接和最少只读范围，不一次申请所有写权。

| 拟议 scope | 允许请求的工具类别 | 附加限制 |
| --- | --- | --- |
| `rental:context:read` | 当前 grant 摘要 | 无业务资料、无其他用户授权列表 |
| `rental:catalog:read` | 目录 / 可用性最少投影 | 工具和字段仍分别白名单；不含报价保存 |
| `rental:order:read` | 当前受权订单事实 | 不因此开放完整客户资料或资金明细 |
| `rental:operation:read` | 原操作 / 收据及恢复索引 | 与新执行权限独立；精确对象仍验权 |
| `rental:quote:prepare` | 原报价 / 提案准备 | 保存是副作用，需原键、审计与额度 |
| `rental:order:execute-approved` | 原批准后的唯一执行 | 不能批准，不含退款 / 收款；原业务政策可能进一步禁止 |
| `rental:task:read` | 已有任务状态 / 结果 | 不能启动模型、恢复推进或接管 |
| `rental:task:request` | 获准有限云场景发起 | 单独云模型政策 / 预算 / 受理原键 |
| `rental:task:cancel-request` | 原取消意图 | 仅当前有权任务，不能声称已完成取消 |

不给外部客户端签发后台授权管理或人类批准 scope。扩大 scope 需重新同意且不超过管理员 grant 上限；撤销新执行不自动撤销仍有效的原收据读权。完全撤销连接则所有该 grant 请求均拒绝，用户可另经可信 Web 在当前权限下核对原收据。

### 5.4 OAuth 主路径

1. 管理员登记应用，并对指定租户 / 用户 / 空间开通；用户安装客户端不等于授权。
2. MCP 未携有效 token 时返回 401，提供 `WWW-Authenticate` 的 `resource_metadata`；发现元数据本身不含业务信息。
3. 授权服务器提供 RFC 9728 Protected Resource Metadata、RFC 8414 或 OIDC discovery，使用规范的 `resource` / issuer。
4. 用户在可信 Rental OS 登录 / 授权页面登录，保留改密、撤权及适用的二次验证；显示客户端、回调主机、空间、权限和信息释放范围。
5. 授权码采用 PKCE S256，绑定 client、redirect、resource、主体和一次性有效期；校验 state，按 RFC 9207 返回 / 核对 issuer，防混淆授权服务器。
6. 发放 MCP 专用短期 access token；客户端每请求携 `Authorization: Bearer …`。受支持的 refresh token 要轮换、撤销并检测复用，不无限期有效。
7. 每次执行和返回敏感结果前复核当前 grant、权限与政策。不能只验证 JWT 签名和 expiry 后信任旧权限快照。

建议使用成熟 OAuth 授权服务器实现并接原 Rental 身份，不手写密码交换协议，不引入另一套用户账号。现有 Auth 尚未核实具备 OAuth AS；AS 选型、原身份适配和 grant 持久化是实施前置，不以 `resolveAccessContext` 能读 Bearer 就宣称已支持 OAuth。

### 5.5 应用登记与兼容方式

| 方式 | 采用规则 |
| --- | --- |
| 预登记 public client | 优先用于批准的桌面 / CLI，PKCE，不把嵌入客户端的固定 secret 当秘密 |
| CIMD 客户端元数据文档 | 可支持，但只接受批准的 client ID URL / 域；验证内容、回调和缓存更新，防 SSRF / 私网地址 / 跳转绕过 |
| DCR 动态登记 | 当前标准已废弃但保留兼容；首版不开放匿名自动登记。确需兼容另批准，登记成功仍不等于 tenant grant |
| confidential client | 仅对能保管秘密的受管服务，按 AS 支持采用标准客户端认证；密钥不写进普通桌面安装包 |
| 专用有期 Bearer / PAT | 可作为经批准兼容模式，不替代完整 OAuth；绑定本人 / 空间 / 最少范围、默认只读、可撤销、不可用于原 Web API |
| mTLS / 设备证书 / DPoP | 企业高要求的可选增强，取决于客户端支持；不是“所有 Agent 必须原生支持”的基线 |
| IP / VPN 白名单 | 额外控制，不能代替主体认证、scope 或资源权限 |

**加密与身份认证不是二选一。** TLS 保护传输；token / PKCE / 客户端认证解决不同身份问题；业务权限和审批仍逐次执行。签名 JWT 不是加密，不能放个人敏感资料。永久共享 API Key、自造请求 AES/HMAC 协议或凭名称白名单放行都不作为推荐标准。

public client 的 ID 和 CIMD 不能密码学证明“当前进程一定是官方 Codex / Claude”。需要限制设备或软件实例时，必须有受管部署和额外设备证明，并保留数据释放限制；不能向管理员承诺仅靠 client ID 就防止冒名程序。

回调只接受登记规则允许的 HTTPS 或符合原生 OAuth 规范的 loopback；精确校验 scheme、host、path，动态端口只按标准原生 loopback 例外实现，不能通配任意主机或路径。实际客户端版本报告的回调先进入管理登记，再做联调。

### 5.6 Token 与原业务身份的衔接

MCP resource server 验证自己的 issuer、audience / resource、expiry、grant、client 和 scope，不接受模型 Key、后台 cookie、任意平台 API token 或另一 resource 的 token。不透传 MCP token 给原业务 HTTP，也不拿管理员服务账号代所有人执行。

建议在原认证 / Guard 的可信服务端入口增加 MCP 凭据解析适配：从有效 grant 重新取得原用户和当前空间权限，并保留渠道、client、grant 的限制；随后仍进入原 Controller 等价授权和 ALS。原授权链里再次解析凭据的地方必须一同接通，不能只给 request 填 `user` 或造静态凭据源。若分进程确需调用原 HTTP，使用正式受限令牌交换 / 委托凭据，保持原用户、渠道和范围；不得直接转发入站 token。

默认一个 grant 固定一个 tenant / workspace，切空间需通过原可信授权选择形成相应授权。普通 Web 切空间不静默改变外部 Agent 当前范围。工具中的空间引用只能用于匹配，不能扩大 grant。服务身份 / 无人值守需要独立原自动主体、委托权限、期限和审计，不能复用人的无限 refresh token。

## 6. 数据释放与外部客户端的边界

### 6.1 不能保证的事情

标准 MCP Server 能控制自己返回什么、执行什么；通常不能控制外部 Host 接下来使用哪个模型、保留多久、是否复制到普通聊天、文件、另一个插件或外部服务。工具结果的 `audience`、TTL、`readOnlyHint` 和提示词不是强制访问控制。加密传输也不会阻止合法接收者保存明文。

因此现有“指定 Provider / Endpoint 才能外发”的政策不能通过客户端自报 `modelId` 来满足，更不能将当前 `human_preview / not_sent` 对象换成 MCP ToolResult 后继续宣称未送模型。

### 6.2 建议的三种准入层级

| 层级 | 可返回内容 | 条件 |
| --- | --- | --- |
| 通用外部 Agent | 经批准可向外部处理者释放的最少非敏感事实、受控引用、状态及安全说明 | 管理员与用户明确同意；独立外部释放政策，不伪称已核验其最终模型 |
| 企业受管 Agent | 在上述基础上增加另行批准的数据类别 | 受管模型 / 设备 / 存储 / 网络与组织制度有实际证据；仍不返回业务凭据和被禁止资料 |
| 严格不允许外部释放 | 公开说明、安全状态和可信后台入口，或直接 unavailable | 保持当前更严格政策，不因要兼容客户端就降级 |

这三层是待批准的政策设计。若负责人不批准外部释放类别，仍可建设标准 MCP 协议和认证，但不能开放违反现有目的地约束的业务数据。

所有可返回内容在服务端先完成当前授权和字段 / 值投影。自由备注、客户姓名 / 电话 / 地址、证件、成本内注、凭据、敏感附件不因字段合法自动输出；异常日志和审计不保存未经审查原文。服务端拒绝原始自由文本是最后一道防线，但不能阻止外部 Host 在调用 MCP 前已把用户文本发送给其模型；这项限制必须写在接入告知中。

客户 / 订单真实选择在可信 Web 完成后产生受控引用；引用绑定 scope、对象 / 输入版本、用途和期限。模型只消费引用和获准投影；有引用仍须逐次验权。收到撤销后服务器停止返回新内容；已经交付的副本只能由接收端按其制度删除，不宣称可远程抹除。

## 7. 业务执行、审批与恢复

### 7.1 只读闭环

后台开通 → 用户 OAuth 授权 → 发现允许工具 → 提交封闭条件 / 原引用 → 当前业务与数据释放政策 → 原 reader → 最少结果 + 观察时点 / 版本 / 缺项 → 需要时重新受权读取。

确定性查询不调用服务端模型，不记平台模型 tokens。安全 / 操作审计可以写入，不能因此谎称完全没有服务器记录；`readOnlyHint` 描述业务效果，不是授权。

### 7.2 报价与建单闭环

1. 先从原生产者建立可恢复的原请求 / 操作关联，明确本次目标和输入版本。首次响应丢失时也必须能从本人受权索引精确找回；缺恢复能力不开放副作用。
2. 查询 / 选择 / 澄清使用原可信页面和受控引用，时间明确租户时区。Core 生成价格 / 押金 / 币种 / 版本；若保存报价则按 R1 副作用与原幂等处理。
3. 原提案保存后返回受控引用及待确认状态。人进入可信 Rental 页面核对具体对象、金额、版本和副作用，按原权限确认 / 审批。导航链接不能含可自动批准的凭据。
4. MCP 可读取待确认 / 已批准状态；**不发布批准工具**。客户端自己的工具确认、聊天“是”、Elicitation 表单都不代替原批准。
5. `rental_order_commit` 仅在原批准和执行链齐备后启用，由原服务端唯一执行；当前身份 / 政策 / 输入 / 报价 / 批准版本复验，原批准原子消费。
6. 结果按原操作读取，区分受理、保存、执行、失败及 unknown；没有原订单收据不得宣称已建单。资金操作留原人工流程。

原 JSON-RPC request ID 仅为传输相关号，**不是业务幂等键**；新版 MRTR、重连和换客户端可能改变该 ID。业务原键和输入指纹跨 Web / Harness / MCP 关联同一动作。模型换键绕过不能仅靠 prompt 阻止：服务器必须绑定原提案 / 确认与唯一执行消费；无法恢复或判断的动作保持不可用。

### 7.3 长任务与云模型

以原 Task / 原请求持久受理和回读，不保持一个 HTTP 连接等待数分钟。读取已有任务不得新建 run；发起有限订单解释云任务与读结果分成不同工具和 scope，明确平台 Gateway / 单账费用。外部模型总结是客户端自己的另一笔费用，不向 MCP 上传或借用它的模型 Key。

取消请求是意图，取消收据才表明已完成的处置；已派发 unknown 先核对。协议层取消 / 断线不能抹除原业务状态。预算、任务累计资源和操作键不随 MCP session / OAuth refresh / 进程重启重置。首版不允许自动递归委托或任意跨用户任务接管。

## 8. 工具输入、输出、错误与资源上限

### 8.1 合同与安全输出

运输层从已批准的公共 schema 生成 `inputSchema` / `outputSchema`，保留业务版本和字段约束；不以 OpenAPI 全量自动发布替代白名单。新增字段由公共作者同步生产者、校验、DTO / OpenAPI、消费者与产物，MCP SDK 专有类型不进入 Core。

- 严格输入，拒绝额外权限字段、伪造 actor / tenant / approval、任意 URL / Header 和未知动作。
- 提供 `structuredContent`，并为兼容返回同一安全结果的文本 JSON；两份内容都算总字节，不能文本安全而结构化内容夹带秘密。
- 返回原业务引用、状态 / 观察时间 / 版本 / 期限、完整或 partial / 缺项和安全下一步；不创建第二套业务状态机。
- 工具 `readOnlyHint`、`destructiveHint`、`idempotentHint` 等按实际副作用声明，但服务器不能信任它们授权或允许重试。
- 不直接输出 stack、SQL、Provider header、签名下载地址或任意 HTML。敏感业务页只给固定可信入口，资源名称 / 错误也需要投影。

### 8.2 错误语义

| 类别 | 行为 |
| --- | --- |
| 认证缺失 / token 失效 | HTTP 401 + 标准发现信息；不给业务正文 |
| scope / 当前权限不足 | HTTP 403；scope 扩权只能走人类授权且受管理员上限 |
| 协议版本 / 元数据不匹配 | 按相应版本标准错误；不进入业务执行 |
| 工具未知 / 参数损坏 | 标准 JSON-RPC 或 `isError: true`，按规范区分协议错误和业务输入错误 |
| 业务 unavailable / 版本冲突 | 返回原安全错误码、不可自动重试及获准下一步，不伪造空成功 |
| 副作用应答不明 | 保留原操作号与 unknown，提示 `rental_operation_read`；不换键重发 |
| 已无读取权 | 返回安全拒绝，不为了“善后”泄漏旧正文；原服务端证据仍保留 |
| 限流 / 资源耗尽 | 有界失败；查询与原操作核对分别受限，不能通过重连重新获得额度 |

未知字段和错误细节不得被转为新的系统指令。任务状态、取消和历史读取必须保持原业务语义，不能按 HTTP 成功码单独判断业务成功。

### 8.3 上限与撤销

执行类业务目标优先沿原 R11.1 / 原任务政策：20 次（含适用重试 / 轮询）、2 并发只读、1 在途副作用、5 分钟累计活跃时间；更严格业务约束优先。单列表最多 50 条、工具完整结果最多 64 KiB、单次只读 / 提交等待 15 / 30 秒。MCP envelope 和文本 / 结构化双份结果须计入运输大小；不能把字符串截断成貌似合法的金额或引用。

协议发现、人工展示复核、原收据善后读取分别定义服务器计量类别与速率 / 并发上限，不无界豁免、不消耗所有额度后封死核对；具体计数分类在实施前冻结。无可靠跨恢复目标关联则不开放自动业务推进。token、grant 和主体 / 空间级速率限制不能只按连接 ID 计算，换 token 或新建客户端配置不重置同一目标预算。

授权撤销写入权威存储后，后续请求和敏感提交点拒绝旧 grant；多实例缓存须有撤销传播和最大陈旧期限，无法证明当前有效就拒绝。通知只是加快客户端更新，不是撤销强制力；不因客户端未刷新 `tools/list` 而继续执行。

## 9. 客户端连接与兼容约定

2026-10-27 已核对官方文档：Codex 和 Claude Code 均描述 stdio、远程 HTTP、OAuth；两者还提供预登记客户端参数或配置。**未使用真实账号联调，不据文档声称全部版本已通过。** Claude Desktop / claude.ai connectors 与 Claude Code 是不同消费面，应分别验收。

以下示例仅说明配置方式；域名不可访问，无 token，不执行安装或连接。真实配置由后台给出固定 URL、client ID、允许 scope 和所需回调登记，client secret 不进入项目文件或聊天。

### Claude Code（终端 CLI）

```bash
claude mcp add --transport http rental-os https://mcp.example.invalid/mcp
```

```bash
claude mcp login rental-os
```

有预登记 public client 时，使用官方支持的 `--client-id` / 回调参数；回调值按实际安装版本报告登记。以上为交互 CLI 示例，不要求在当前桌面会话里执行斜杠命令。客户端配置成功不等于服务端认证或业务授权成功。

### Codex

```toml
[mcp_servers.rental_os]
url = "https://mcp.example.invalid/mcp"
```

```bash
codex mcp login rental_os
```

预登记 OAuth 信息按客户端文档配置；不得把长期 confidential secret 放进共享 TOML。兼容 Bearer 模式使用客户端支持的环境变量引用，值必须是后台签发的 MCP 专用有期凭据，不是 Web 登录 token 或模型 Key。

### 其他客户端

发布连接说明时同时列出 Host 名称 / 版本、支持协议代次、OAuth / 回调能力、Tools、Resources / Prompts、结构化结果、取消、长任务和错误呈现。只支持工具的客户端仍能通过普通结果 / 原操作工具完成基础流程；没有资源 / Prompt UI 不应要求安装私有前端才能查询。

若客户端只支持 stdio，可后续提供版本固定、可验证来源的官方连接器。连接器凭据放操作系统安全存储或受控环境，避免命令行参数及 stdout；不得建议自动执行来源不明的 `npx -y` 包来获取业务凭据。没有兼容认证方式时保持不可用，而不是关闭认证。

## 10. 建议工作包与所有权

以下编号仅是本方案建议工作包，**不加入现有 AGC 分母，不表示当前已派工或授权实施**。一人可顺序完成；并行需独立工作树、固定公共合同和唯一公共作者。

| 建议包 | 唯一职责 / 交付 | 依赖与完成出口 |
| --- | --- | --- |
| MCP-P1 协议与数据释放决策 | 平台 / 业务负责人冻结协议版本、客户端类别、首批工具、信息类别与现行能力映射 | 先解决外部模型目的地不可证明问题；发布可实施设计 |
| MCP-P2 身份与后台治理 | 身份作者接 OAuth AS / resource server、grant、后台开通 / 同意 / 撤销 / 审计 | 原 Auth / Guard 权限等价、默认关闭和生命周期测试 |
| MCP-P3 最少只读协议适配 | MCP 作者做双代运输、发现、工具白名单和目录最少投影 | P1 / P2；实际外部客户端读取 + 越权拒绝，不含写入 |
| MCP-P4 原键与持久恢复 | 原任务 / 业务作者落实原操作索引、唯一键、计量和 unknown | 先于报价保存 / 云任务；跨客户端恢复不重发 |
| MCP-P5 准备与可信页面 | 业务 + Web 作者提供客户选择、Core 报价、原提案 / 人类确认回跳 | P3 / P4；模型不能批准、不能访问敏感 DOM |
| MCP-P6 原批准执行与协同 | 原执行作者接唯一建单、原结果；有限云任务另行开关 | P4 / P5 与原审批 / Gateway 就绪，提交丢应答仍一份结果 |
| MCP-P7 兼容、安全及发布 | 集成负责人验收实际客户端矩阵、撤销、多实例、升级 / 回退 | 各能力逐项发布，不用协议连接成功代替业务验收 |

新增接入登记 / grant 属认证控制面持久化，不能因为“不新建业务任务数据库”而强塞进聊天历史；迁移须另批。业务任务、审批、报价、订单与资金结果继续原所有者。不要改正在写入的 shared 总出口、Guard 或服务端 runner 来抢接；先固定交付再整合。

## 11. 验收与上线门槛

- **协议兼容：** 2026-07-28 与明确支持的旧版分别验证发现 / 初始化、元数据、schema、工具调用和错误；版本头与 body 不一致拒绝，无业务副作用。
- **真实客户端：** 至少核对指定版本的 Codex、Claude Code；若宣传 Claude Desktop / 其他 Host 则分别补证据。OAuth 成功、拒绝、撤销及过期刷新必须实际走通，不只用 SDK 假客户端。
- **默认关闭：** 匿名 / 未登记应用 / 未开通租户 / 未授权用户均无业务工具和数据；已缓存旧工具名直接调用仍拒绝。
- **身份与隔离：** 错 issuer / audience、旧 token、撤销 grant、跨 tenant / workspace / location / dataScope、平台身份冒用租户、无读权原收据均拒绝。
- **OAuth 安全：** PKCE、state / issuer、回调、授权码一次性、refresh 轮换、CIMD SSRF、密钥保管、同意页和扩权上限；client ID 不当设备证明。
- **材料输出：** 工具文本 / structuredContent / resource / prompt / 错误 / 日志全链无禁止资料；自由文本拒绝，输出有界，返回后不宣称能控制外部历史。
- **人类确认：** 模型自批、复用旧批准、篡改金额 / 输入、跨客户端重复确认均不能绕过原可信批准；资金动作不在目录。
- **唯一执行：** 同一原操作从 Web / Harness / MCP 并发、响应丢失、重启 / 新 token / 新协议后仍读原结果；不自动产生第二报价 / 订单 / 云模型任务。
- **限额与取消：** 多连接 / 多实例 / token 刷新不重置原目标资源；取消和撤销只承诺有证据的停止，unknown 原键核对仍可按当前独立读权进行。
- **发布回退：** 按租户 / 工具灰度，紧急停新执行而保留受权核对，回退不删除 grant / 原审计或破坏旧收据。正式签名 / 部署 / 生产启用另行批准。

## 12. 官方资料与实施前再核对

以下资料于 2026-10-27 公开只读查阅；标准版本与客户端能力必须在实际实现和发布时再次核实，不能从一份配置示例推导所有客户端兼容。

1. [MCP 当前规范入口](https://modelcontextprotocol.io/specification/latest)及[2026-07-28 版本兼容](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)。
2. [2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)。
3. [2026-07-28 OAuth 授权](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[客户端登记](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)与[安全要求](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)。
4. [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)；旧版 [Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)、[Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)用于兼容概念核对，新版序列化由对应 SDK / 规范负责。
5. [2025-11-25 运输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)，仅为明确的旧版兼容，不混作最新版。
6. [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)。
7. [Codex MCP 原入口](https://developers.openai.com/codex/mcp)于核查时跳转到[官方 MCP 扩展说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

本文只完成可行性与接入设计；未安装 MCP SDK、创建 OAuth 应用 / secret / token、连接真实租户或客户端、开通工具、运行迁移或部署服务。
