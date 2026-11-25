# 公共 SaaS 服务

`@rental-os/platform-server` 提供公共身份、会话、租户 / 人员角色 / 组织管理、安全配置、外观、完整订阅办理、字典与编号、基础集成、官方日历来源、文件存储原语、通知台账及运营邀请 / 寄件 / 客服邮件应用。宿主提供唯一持久化实例，服务通过各模块窄存储端口消费它。原 API 路径通过本包窄子出口再导出，Rental 认证仍继承同一会话实现。[包与子出口](package.json) · [公共合同](../platform-contracts/README.md)

| 阅读步骤 | 源码与职责 |
| --- | --- |
| HTTP 与准入 | [模块](src/platform-server.module.ts)、[公共政策](src/platform-http-policy.ts)、[Guard](src/platform-auth.guard.ts)；未知方法/路径拒绝，行业 HTTP 由受控宿主显式供给 |
| 权限匹配 | [同源匹配](src/permission-match.ts) 从 `/permission-match` 提供原权限码及通配规则；调用方先取得当前可信权限集合，匹配函数不创建授权 |
| 可选任务 Runner | [接入说明](src/ai-runtime/README.md)、[原推进算法](src/ai-runtime/ai-task-runner.service.ts)从 `/ai-runtime` 提供；业务、授权、原租约、累计资源和Gateway经宿主端口供给，不加载Rental或开放无Core Agent |
| Prisma SQL运行值 | [官方运行库适配](src/prisma-runtime.ts)从 `/prisma-runtime` 提供 schema 无关的 SQL、Decimal、空值单例、错误类及隔离级别；生成 Client 及其输入类型由所选宿主和业务适配持有。宿主用 `mapPrismaNullInputs` 将三个官方空值映射为该 Client 的同义单例，普通 JSON 值保持原义 |
| 公共会话 | [公共认证](src/modules/auth/platform-auth.service.ts)、[共享会话算法](src/modules/auth/auth-session.service.ts)、[HTTP](src/modules/auth/auth-session.controller.ts)及[Web 登录/改密](../platform-admin/src/session-pages.tsx)，复用原签名、失败保护、单次刷新和改密 |
| 当前组织范围 | [组织子树与地点交集](src/common/organization-location-scope.ts) 从 `/organization-location-scope` 提供；调用方先限定租户，缺失/停用组织返回空集合，配置地点只缩小已映射范围 |
| 公共数据与原账 | [公共 schema](../../apps/platform-api/prisma/schema.prisma)、[固定数据计划](../../apps/platform-api/src/platform-data.ts)、[原账观察](../core-host/src/mysql-deployment.ts)与[物理读取](../platform-core-host/src/mysql-physical.ts)；公共表、迁移原文及当前结构分别核定，Core 外键由所选宿主供给 |
| 身份存储 | [仓储](src/modules/platform/platform-identity.repository.ts)、[认证来源](src/modules/platform/platform-authentication.source.ts)、[窄存储端口](src/modules/platform/platform-auth-data-store.ts)；平台账号、角色和会话，业务表不进入端口 |
| 公共管理 | [模块导读](src/modules/platform/README.md)、[应用服务](src/modules/platform/platform-management.service.ts)、[仓储](src/modules/platform/platform-management.repository.ts)、[存储端口](src/modules/platform/platform-management.store.ts)、[主体围栏](src/modules/platform/platform-principal.authority.ts)；SaaS与租户管理分开，当前原会话 / 角色在同事务复验 |
| 部署初始化 | [公共初始化](src/modules/platform/platform-initialization.ts)；首次创建SaaS主体，重复执行不重置账号，不运行Core初始化 |
| 公共订阅 | [模块接入与 API](src/modules/subscription/README.md)、[办理服务](src/modules/subscription/subscription.service.ts)、[存储参加者](src/modules/subscription/subscription-store.ts)；原申请、线下收费、统一期限、排期、提醒、修订与审计 |
| 统一期限 | [只读来源](src/modules/subscription/subscription-reader.ts)、[同源状态投影](src/modules/subscription/subscription-state.ts)、[周年/时区](src/modules/subscription/subscription-term.ts)；当前期限与排期，原Rental服务和新Core共同消费 |
| 基础集成 | [模块导读](src/modules/integrations/README.md)、[配置服务](src/modules/integrations/tenant-integration.service.ts)、[存储与宿主参加者](src/modules/integrations/integration-store.ts)；原配置修订、凭据保护、连通性与实际投递接点 |
| 邮箱运输 | [邮箱运行时](src/modules/integrations/tenant-email.runtime.service.ts)、[SMTP](src/modules/integrations/smtp-transport.ts)、[IMAP](src/modules/integrations/imap-reader.ts)、[邮件文本解析](src/modules/integrations/inbound-mail-codec.ts)；四个正式子出口共用原算法，测试不投递，业务发送和原台账由调用方维护 |
| 公共消息应用 | [三步接入](src/modules/messaging/README.md)、[HTTP 与同源政策](src/modules/messaging/tenant-messaging-http.module.ts)、[邀请](src/modules/messaging/tenant-operator-invitations.service.ts)、[寄件](src/modules/messaging/tenant-dispatch.service.ts)、[客服](src/modules/messaging/tenant-support-email.service.ts)从 `/messaging` 提供；公共模块自动装配，Core 的业务范围与寄件来源由真实参加者供给 |
| 官方日历来源 | [模块导读](src/modules/official-calendars/README.md)、[来源服务](src/modules/official-calendars/official-calendar-source.service.ts)、[冻结读取器](src/modules/official-calendars/official-calendar-source-reader.ts)；公共主档、只追加年度版本与历史快照 |
| 字典与编号 | [模块及 API](src/modules/platform-tools/README.md)、[服务](src/modules/platform-tools/platform-tools.service.ts)、[生效配置仓储](src/modules/platform-tools/platform-tools.repository.ts)；当前租户维护、原格式及同事务取号，公共缺省为空 |
| 筛选预设 | [接入与范围](src/modules/platform-tools/README.md#筛选预设)、[服务](src/modules/platform-tools/filter-presets.service.ts)、[仓储](src/modules/platform-tools/filter-presets.repository.ts)；同一公共身份、租户内预设与原审计，不授业务数据读取权 |
| 官网演示预约 | [接入与 API](src/modules/demo-requests/README.md)从 `/demo-requests` 提供匿名幂等提交与仅SaaS可读的分页列表；公共模块直接挂载，个人资料沿原投影 |
| 持久限流 | [接入与数据归属](src/modules/public-rate-limit/README.md)从 `/public-rate-limit` 提供原哈希、窗口及同事务计数；默认Demo使用公共表，完整Rental供给原参加者保留旧桶 |
| 文件存储与冻结 | [模块导读](src/modules/files/README.md)、[字节处理](src/modules/files/file-storage-primitives.ts)、[冻结内核](src/modules/files/file-content-freeze.ts)、[文件仓储](src/modules/files/file-storage.repository.ts)；原限长传输、元数据、上传会话和唯一冻结目标，业务 ACL 由所属 Core 提供 |
| 媒体字节解析 | [接入与限制](src/modules/media/README.md)、[同源读取](src/modules/media/media-reader.ts) 从 `/media` 提供原图片/PCM检查、实际大小、摘要及取消释放；不依赖业务或AI表，文件授权和原绑定由调用者裁定 |
| Core 文件应用 | [应用](src/modules/files/file-storage.application.ts)、[权威参加者](src/modules/files/file-storage-authority.ts)、[事务端口](src/modules/files/file-storage.application-store.ts)从 `/files` 提供；受控业务登记后调用同一原键/冻结/激活链 |
| 公共文件台账 | [列表与模拟元数据](src/modules/files/file-ledger.ts)从 `/files` 提供，原IntegrationsService委托；当前租户、实际业务可读范围、等待后复核及原创建日志保持，实际上传仍走原键应用 |
| 通知与适配日志 | [三步接入](src/modules/notifications/README.md)、[台账](src/modules/notifications/notification-ledger.ts)与[HTTP模块](src/modules/notifications/notifications-http.module.ts)从 `/notifications` 提供，字段和政策共用正式声明；模板由宿主供给，原租户隔离、模拟登记和日志失败后的事实保留 |
| 异步任务台账 | [三步接入](src/modules/jobs/README.md)、[应用/仓储](src/modules/jobs/job-ledger.ts)与[HTTP模块](src/modules/jobs/jobs-http.module.ts)从 `/jobs` 提供；共用原租户内任务、排期及尝试次数，业务执行/日志由宿主供给，缺打印参加者明确不可用 |
| 文件清理与下载 | [按租户清理](src/modules/files/file-cleanup.ts)、[受保护下载](src/modules/files/file-download.ts)；原完成暂存及待删除文件先持久占用，失应答仅核原键；下载沿实际业务 ACL、原绑定复核与成功审计 |
| 文件配置围栏 | [只读文件依赖](src/modules/files/file-integration-dependencies.ts) 从 `/file-integration-dependencies` 提供，原配置同事务读取文件、上传/冻结/清理收据，空 Core 目录不能代替依赖证据 |
| 公共设置 | [租户外观](src/modules/client/tenant-appearance-profile.service.ts)、[本人外观](src/modules/client/account-appearance.service.ts)、[存储端口](src/modules/platform/platform-appearance-data-store.ts)及[本人/租户表单](../platform-admin/src/SettingsPage.tsx)，修订冲突、省略与清空沿原语义 |
| 公共审计 | [日志写入与脱敏](src/common/operation-log.service.ts) 从 `/operation-log` 提供；宿主供给原日志表，业务空间来自同一ALS，敏感读取要求持久写入成功。原OAuth/MCP/Core原收据审计仍由各自严格事务入口负责 |
| 微信小程序运输 | [原运输适配](src/modules/integrations/wechat-mini-program.adapter.ts) 从 `/integration-wechat` 提供；AppID 缓存、一次凭据刷新和原错误类型共用，客户绑定与渠道授权归所属 Core |
| 短信结果接点 | [原结果与unknown错误](src/common/notification-delivery.ts) 从 `/notification-delivery` 提供，原Provider及Core共用同一错误身份；实际发送、凭据和回执仍由原通知服务负责 |
| 接口资料与响应 | [OpenAPI](src/platform-openapi.ts)、[响应信封](src/common/request-id.interceptor.ts)；同一公共政策生成接口资料，信封保持 `data` / `requestId` |
| 直接消费者 | [默认 API 装配](../../apps/platform-api/src/app.module.ts)与[公共数据库](../../apps/platform-api/src/database.ts)、[默认 Web 装配](../../apps/platform-admin/src/App.tsx)与[公共页面工厂](../platform-admin/src/application.tsx)。[原 API 服务装配](../../apps/api/src/application-services.module.ts)供给原数据库及公共应用实例，[Rental 认证适配](../../apps/api/src/modules/auth/README.md)解析原业务范围 |

默认公共根模块挂载认证、公共管理、外观、订阅、集成、官方日历、工具与消息应用。文件业务 HTTP、通知台账和作业台账由所选宿主分别登记实际应用，打印还需要真实业务参加者。Rental 组合通过[平台选择器](../rental-core/src/application-platform.ts)复用同一服务实例，原组合从[服务模块](../../apps/api/src/application-services.module.ts)供给原数据库与业务参加者。[通知模块](src/modules/notifications/notifications-http.module.ts) · [作业模块](src/modules/jobs/jobs-http.module.ts) · [文件业务 HTTP](../rental-core/src/http-files.controller.ts)

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

所选宿主需要等待 Guard 的在途工作时，可通过 `PlatformServerModule.register` 的可选 `guardProvider` 提供受控 `FactoryProvider<CanActivate>`，注入同一个原 `PlatformAuthGuard` 并包装其调用。它只决定宿主如何等待原请求，不从 Core 清单或请求登记认证代码，也不复制权限逻辑。未提供时仍直接 `useExisting: PlatformAuthGuard`；已有 `applicationsProvider` 供给的同一真实 Guard 保持。[公共接点](src/platform-server.module.ts) · [单工单实际消费者](../../apps/example-tickets-api/src/app.module.ts) · [完整请求排空](../../apps/example-tickets-api/src/lifecycle.ts)

公共邀请、寄件和客服邮件也由本模块装配到同一数据库与邮件运行时。默认 [成员邀请权威](src/modules/platform/platform-member-invitation.authority.ts)只授普通租户角色和有效组织，显式接受空业务范围；账号、角色、审计与一次性凭证在原接受事务中提交。Core 使用权另行分配，原 Rental 邀请继续原经营空间规则。HTTP、DTO 与 OpenAPI 从同一消息声明产生，查重、预览和 `inspect` 明确为读取。[接口与接入](src/modules/messaging/README.md)

登录、刷新与改密沿原认证算法。刷新旧会话的撤销与新会话创建同事务。本人改密在原事务匹配已校验的密码哈希与令牌版本，冲突返回 409，密码、状态、版本递增及旧会话撤销共同提交或回滚。本次提交版本作为私有认证回执，替代会话创建在自身事务锁定用户行并精确匹配该版本，后续改密或重置会使旧回执失效。原组合的 demo 数据源在既有会话撤销入口推进私有版本，历史记录省略版本时从 1 开始，改密回执在首次等待前固定。租户外观权限沿 `system:integration:manage`，本人外观仅取当前签名主体。SaaS 身份不能借公共设置接口代替租户操作。旧品牌读取由 Rental 组合另外注入，公共服务不查询客户端业务表。[改密与会话围栏](src/modules/platform/platform-identity.repository.ts) · [共用认证调用](src/modules/auth/auth-session.service.ts) · [原组合适配](../../apps/api/src/modules/platform/platform.service.ts)

公共管理使用原 `system:tenant:manage/bootstrap`、`system:user:manage` 与 `system:role:manage`。租户成员管理还要求当前租户管理员或明确全租户数据范围；固定全权角色和SaaS身份不能经普通角色输入创建。权限码须已登记，角色不自动赋予Core使用权。管理员创建、状态与密码重置、权限修改和对应审计同事务，唯一键 / 事务冲突明确返回，错误不重做。本人资料只改姓名和联系方式。

组织读取按当前租户及连续启用的组织子树投影，维护沿原账号管理权限、全租户数据范围和完整地点范围。安全管理的七个操作由 `/settings-http-policy` 与 `/settings-openapi` 同源声明；登录前使用 `readPlatformSecurityBaseline(database)` 读取固定平台主体，管理 HTTP 则经当前主体围栏。全平台安全保存要求 SaaS 身份及原参数管理权限，保留原生效版本和其他配置，写入与审计同事务。[组织、安全及方法对应](src/modules/platform/README.md)

字典与编号从 `/tools` 使用同一 `PlatformToolsService`，请求类从 `/tools-dto` 复用。公共模块已登记五个原 HTTP 操作与同源 OpenAPI；独立公共宿主注册公共 Controller，原组合只保留原 Controller 和同一服务实例。取号与保存先锁租户，再核当前主体、生效配置与审计，失败由调用方读取核对。两个工具权限通过公共初始化补录，不自动授予成员。普通 Core 可消费公共工具，业务本身的编号规则继续由其领域决定。[接入与原子性](src/modules/platform-tools/README.md)

文件服务从 `/files` 消费原字节、格式、原存储键和文件表实现；原运行时与元数据仓储已委托同一实现。`createOriginalFileUploadFacts` 通过原配置锁、授权/引用参加者和同事务建立pending事实，`readOriginalFileUploadReceipt` 仅为仍有效会话续签原暂存键，不延长原有效期。`freezeFileUploadContent` 在原完成链中先提交唯一目标再写一次，恢复只核原目标；最终激活及知识绑定仍在原完成事务。公共文件两模型及迁移已提供，原组合和 Rental 标准宿主已通过同一文件应用供给实际业务 HTTP。知识、专用检查、企业证据及附件读取仍由各自原授权链裁定。[文件入口及数据边界](src/modules/files/README.md)

`FileStorageCleanup` 由原宿主按租户调用，宿主继续持有唯一计时器、租户发现与专用保留场景。过期会话和资产的两次写入在同一 callback 事务内提交或回滚，事务内不访问对象存储。`issueFileDownloadReference` 使用所属业务的实际 ACL 和必须成功的审计，在配置或审计等待后复核当前权限及原文件绑定，再返回短时 GET。原专用入口继续裁定实名、知识、企业证明与检查资料。

待删除业务文件的原状态、修订、提供者、对象键和场景在短事务中共同占用。仅确认本次占用提交的调用方发送一次 DELETE，后续调用和重启只 HEAD 原键；404 与原修订 CAS 一起确认删除，失应答或迟到响应不能重新派发或覆盖新事实。派发前明确缺配置可释放自己的占用，外部请求开始后保留原结果待核对。

新Core使用`FileStorageApplication`，由受控宿主供给真实事务、配置和其`FileStorageAuthority`，按固定module/type/scene调用创建、回执、完成、下载及每租户清理。各来源仍复验当前授权，领域激活可参加同一事务；需要主体锁时先锁主体再执行公共回调中的配置锁。接口和三步接入在[文件模块](src/modules/files/README.md#core-接入)维护，Core不需要导入旧API文件运行时。

原Rental配置参加者及零Core公共宿主从 `/file-integration-dependencies` 复用同一只读查询，先取得原配置事务，再核当前租户/提供者的实际文件及上传依赖。停用保留原active/pending/delete判断并显式保护freeze_pending及非空cleanupError，存储位置变更保留原非deleted文件与unknown依据。查询异常向上返回。支付、短信和业务结算仍由原领域供给，不因公共文件表存在而取消其核验。

`readPublicSubscriptionTerm(transaction, tenantId)` 在调用方原事务读取当前统一期限和已到生效点的排期，不物化排期、不新建订阅。明确到期拒绝新业务；历史未登记状态保持原“待确认”的兼容，不因此视为永久或批量停业。公共订阅办理消费相同状态/周年算法，金额、收费和已发布功能规则沿原 SUB 规则裁定。此入口不赋予Core使用权或绕过冻结。

短信适配和业务服务从 `@rental-os/platform-server/notification-delivery` 共用结果类型与 `NotificationDeliveryUnknownError`。请求已离开服务而结果未明时，调用方保持原操作/投递记录，查询原回执；错误类型不允许换键重发或证明回滚。[原Provider消费者](../../apps/api/src/modules/integrations/tenant-integration.runtime.service.ts) · [Rental消费者](../rental-core/src/business-runtime-ports.ts)

构建使用本包 `build`，类型使用本包 `lint`。已有 [登录保护](../../tests/auth-login-lockout.test.cjs)、[外观](../../tests/admin-appearance-settings.test.cjs) 和 [MCP 原审计](../../tests/mcp-original-audit.test.cjs) 保留；命令先核读写及隔离要求。[验证规则](../../AGENTS.md#修改验证与交付)

当前独立宿主已有公共初始化、认证、人员 / 角色 / 租户 / 组织管理、安全配置、外观、订阅、基础集成和健康 / 文档链。公共、单 Rental、单工单和双 Core 已各有受控根装配，分别沿[公共 API](../../apps/platform-api/src/app.module.ts)、[Rental API](../../apps/rental-api/src/app.module.ts)、[工单 API](../../apps/example-tickets-api/src/app.module.ts)与[双 Core API](../../apps/example-multi-core-api/src/app.module.ts)读取实际选择。可选 AI 从[独立 AI 根](../../apps/rental-api/src/ai-app.module.ts)装配所选数据与原业务参加者。开发入口见[Core接入手册](../core-contracts/README.md#五步快速接入)。类型及离线行为不等于真实数据库、HTTP、浏览器或部署通过。
