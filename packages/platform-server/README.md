# 公共 SaaS 服务

`@rental-os/platform-server` 提供公共身份、会话、租户 / 人员角色 / 组织管理、安全配置、外观、完整订阅办理、字典与编号、基础集成、官方日历来源及文件存储原语。宿主提供唯一持久化实例，服务通过各模块窄存储端口消费它。原 API 路径通过本包窄子出口再导出，Rental 认证仍继承同一会话实现。[包与子出口](package.json) · [公共合同](../platform-contracts/README.md)

| 阅读步骤 | 源码与职责 |
| --- | --- |
| HTTP 与准入 | [模块](src/platform-server.module.ts)、[公共政策](src/platform-http-policy.ts)、[Guard](src/platform-auth.guard.ts)；未知方法/路径拒绝，行业 HTTP 由受控宿主显式供给 |
| 权限匹配 | [同源匹配](src/permission-match.ts) 从 `/permission-match` 提供原权限码及通配规则；调用方先取得当前可信权限集合，匹配函数不创建授权 |
| 公共会话 | [公共认证](src/modules/auth/platform-auth.service.ts)、[共享会话算法](src/modules/auth/auth-session.service.ts)；原签名、失败保护、单次刷新和改密 |
| 当前组织范围 | [组织子树与地点交集](src/common/organization-location-scope.ts) 从 `/organization-location-scope` 提供；调用方先限定租户，缺失/停用组织返回空集合，配置地点只缩小已映射范围 |
| 身份存储 | [仓储](src/modules/platform/platform-identity.repository.ts)、[认证来源](src/modules/platform/platform-authentication.source.ts)、[窄存储端口](src/modules/platform/platform-auth-data-store.ts)；平台账号、角色和会话，业务表不进入端口 |
| 公共管理 | [模块导读](src/modules/platform/README.md)、[应用服务](src/modules/platform/platform-management.service.ts)、[仓储](src/modules/platform/platform-management.repository.ts)、[存储端口](src/modules/platform/platform-management.store.ts)、[主体围栏](src/modules/platform/platform-principal.authority.ts)；SaaS与租户管理分开，当前原会话 / 角色在同事务复验 |
| 部署初始化 | [公共初始化](src/modules/platform/platform-initialization.ts)；首次创建SaaS主体，重复执行不重置账号，不运行Core初始化 |
| 公共订阅 | [模块接入与 API](src/modules/subscription/README.md)、[办理服务](src/modules/subscription/subscription.service.ts)、[存储参加者](src/modules/subscription/subscription-store.ts)；原申请、线下收费、统一期限、排期、提醒、修订与审计 |
| 统一期限 | [只读来源](src/modules/subscription/subscription-reader.ts)、[同源状态投影](src/modules/subscription/subscription-state.ts)、[周年/时区](src/modules/subscription/subscription-term.ts)；当前期限与排期，原Rental服务和新Core共同消费 |
| 基础集成 | [模块导读](src/modules/integrations/README.md)、[配置服务](src/modules/integrations/tenant-integration.service.ts)、[存储与宿主参加者](src/modules/integrations/integration-store.ts)；原配置修订、凭据保护、连通性与实际投递接点 |
| 官方日历来源 | [模块导读](src/modules/official-calendars/README.md)、[来源服务](src/modules/official-calendars/official-calendar-source.service.ts)、[冻结读取器](src/modules/official-calendars/official-calendar-source-reader.ts)；公共主档、只追加年度版本与历史快照 |
| 字典与编号 | [模块及 API](src/modules/platform-tools/README.md)、[服务](src/modules/platform-tools/platform-tools.service.ts)、[生效配置仓储](src/modules/platform-tools/platform-tools.repository.ts)；当前租户维护、原格式及同事务取号，公共缺省为空 |
| 文件存储与冻结 | [模块导读](src/modules/files/README.md)、[字节处理](src/modules/files/file-storage-primitives.ts)、[冻结内核](src/modules/files/file-content-freeze.ts)、[文件仓储](src/modules/files/file-storage.repository.ts)；原限长传输、元数据、上传会话和唯一冻结目标，业务 ACL 由所属 Core 提供 |
| 公共设置 | [租户外观](src/modules/client/tenant-appearance-profile.service.ts)、[本人外观](src/modules/client/account-appearance.service.ts)、[存储端口](src/modules/platform/platform-appearance-data-store.ts)；修订冲突、省略与清空沿原语义 |
| 公共审计 | [日志写入与脱敏](src/common/operation-log.service.ts) 从 `/operation-log` 提供；宿主供给原日志表，业务空间来自同一ALS，敏感读取要求持久写入成功。原OAuth/MCP/Core原收据审计仍由各自严格事务入口负责 |
| 短信结果接点 | [原结果与unknown错误](src/common/notification-delivery.ts) 从 `/notification-delivery` 提供，原Provider及Core共用同一错误身份；实际发送、凭据和回执仍由原通知服务负责 |
| 接口资料与响应 | [OpenAPI](src/platform-openapi.ts)、[响应信封](src/common/request-id.interceptor.ts)；同一公共政策生成接口资料，信封保持 `data` / `requestId` |
| 直接消费者 | [无 Core 宿主](../../apps/platform-api/README.md)、[Rental 兼容认证](../../apps/api/src/modules/auth/README.md) |

公共 HTTP 清单、访问类别、权限和文档来自同一份政策。构建后执行 `npm run api:document:platform` 输出同版本 OpenAPI JSON；此命令不启动服务、不读环境文件或数据库。HTTP 文档也由宿主在 `/api/openapi.json` 提供。接口存在不代表 Core 工具已发布或当前主体有业务权限。

```ts
import { PlatformServerModule } from "@rental-os/platform-server";

// database 是宿主真实公共存储，不是默认成功或行业数据库替身。
const platform = PlatformServerModule.register({
  imports: [PublicDatabaseModule],
  inject: [PublicDatabase],
  useFactory: (database: PublicDatabase) => database,
});
```

注册时公共认证、外观、管理与订阅指向同一实例。HTTP 中间件使用 [同一个 ALS](src/common/request-identity.ts)，公共新会话不签发业务空间。保留旧 `wid` 的有效签名仍须与原会话一致；进入公共面不从旧 ID 恢复业务权限。Rental 专属范围继续由原认证适配解析。

登录、刷新与改密沿原认证算法；刷新旧会话的撤销与新会话创建同事务，改密和会话撤销同事务。租户外观权限沿 `system:integration:manage`，本人外观仅取当前签名主体；SaaS 身份不能借公共设置接口代替租户操作。旧品牌读取由 Rental 组合另外注入，公共服务不查询客户端业务表。

公共管理使用原 `system:tenant:manage/bootstrap`、`system:user:manage` 与 `system:role:manage`。租户成员管理还要求当前租户管理员或明确全租户数据范围；固定全权角色和SaaS身份不能经普通角色输入创建。权限码须已登记，角色不自动赋予Core使用权。管理员创建、状态与密码重置、权限修改和对应审计同事务，唯一键 / 事务冲突明确返回，错误不重做。本人资料只改姓名和联系方式。

组织读取按当前租户及连续启用的组织子树投影，维护沿原账号管理权限、全租户数据范围和完整地点范围。安全管理的七个操作由 `/settings-http-policy` 与 `/settings-openapi` 同源声明；登录前使用 `readPlatformSecurityBaseline(database)` 读取固定平台主体，管理 HTTP 则经当前主体围栏。全平台安全保存要求 SaaS 身份及原参数管理权限，保留原生效版本和其他配置，写入与审计同事务。[组织、安全及方法对应](src/modules/platform/README.md)

字典与编号从 `/tools` 使用同一 `PlatformToolsService`，请求类从 `/tools-dto` 复用。公共模块已登记五个原 HTTP 操作与同源 OpenAPI；独立公共宿主注册公共 Controller，原组合只保留原 Controller 和同一服务实例。取号与保存先锁租户，再核当前主体、生效配置与审计，失败由调用方读取核对。两个工具权限通过公共初始化补录，不自动授予成员。普通 Core 可消费公共工具，业务本身的编号规则继续由其领域决定。[接入与原子性](src/modules/platform-tools/README.md)

文件服务从 `/files` 消费原字节、格式、原存储键和文件表实现；原运行时与元数据仓储已委托同一实现。`freezeFileUploadContent` 在原完成链中先提交唯一目标再写一次，恢复只核原目标；当前授权、配置锁和知识专用字节由原参加者供给，最终激活仍在原完成事务。其余通用生命周期及 HTTP / 公共数据装配继续按 PCH 迁移，知识、专用检查、企业证据及附件读取仍须由各自原授权链裁定。[文件入口及数据边界](src/modules/files/README.md)

`readPublicSubscriptionTerm(transaction, tenantId)` 在调用方原事务读取当前统一期限和已到生效点的排期，不物化排期、不新建订阅。明确到期拒绝新业务；历史未登记状态保持原“待确认”的兼容，不因此视为永久或批量停业。公共订阅办理消费相同状态/周年算法，金额、收费和已发布功能规则沿原 SUB 规则裁定。此入口不赋予Core使用权或绕过冻结。

短信适配和业务服务从 `@rental-os/platform-server/notification-delivery` 共用结果类型与 `NotificationDeliveryUnknownError`。请求已离开服务而结果未明时，调用方保持原操作/投递记录，查询原回执；错误类型不允许换键重发或证明回滚。[原Provider消费者](../../apps/api/src/modules/integrations/tenant-integration.runtime.service.ts) · [Rental消费者](../rental-core/src/business-runtime-ports.ts)

构建使用本包 `build`，类型使用本包 `lint`。已有 [登录保护](../../tests/auth-login-lockout.test.cjs)、[外观](../../tests/admin-appearance-settings.test.cjs) 和 [MCP 原审计](../../tests/mcp-original-audit.test.cjs) 保留；命令先核读写及隔离要求。[验证规则](../../AGENTS.md#修改验证与交付)

当前独立宿主已有公共初始化、认证、人员 / 角色 / 租户 / 组织管理、安全配置、外观、完整订阅和健康 / 文档链，基础集成及 Core 主装配继续按 [PCH 接续](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 交付。类型及离线行为不等于真实数据库、HTTP、浏览器或部署通过。
