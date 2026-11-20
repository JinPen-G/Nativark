# 独立公共 API 宿主

这个宿主只装配公共 SaaS 服务和公共 schema，不依赖 `apps/api`、`@rental-os/shared`、Rental 或工单源码。默认不安装任何 Core。当前提供公共初始化、登录 / 本人 / 会话 / 改密、租户与人员角色 / 组织管理、安全配置、账户与租户外观、完整订阅办理、字典与编号、邀请 / 寄件 / 客服邮件、健康和 OpenAPI；基础集成、官方日历来源及标准 Core 管理也已接公共模块。独立运行和 Rental 标准装配继续交付。[Core 接入手册](../../packages/core-contracts/README.md#五步快速接入)

| 入口 | 职责 |
| --- | --- |
| [启动](src/main.ts) | 消费进程 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、可选 `API_PORT`；不自动加载环境文件 |
| [装配](src/app.module.ts) | 默认空 Core，只选择公共服务和唯一公共数据库 |
| [Core装配](src/core-assembly.ts) | 同一实际工厂供给标准Core管理、本人目录、范围和Guard；默认零Core，未知业务拒绝 |
| [Core包管理装配](../../packages/platform-core-host/src/core-package-assembly.ts) | 共用公共数据库和当前账号，实际审计与宿主文件配置供给四组 Controller，原部署及包材料按实际来源提供 |
| [当前底座发行读取](../../packages/platform-core-host/src/core-package-deployment.ts) | 固定启动锁，核对当前模块目录和标准包全部字节，沿原 MySQL 观察供给版本及候选材料 |
| [数据计划](src/platform-data.ts) | 固定迁移摘要、唯一数据版本、实际物理结构读取；清单和真实已应用账分别核验 |
| [初始化](src/initialize.ts) | 显式命令创建公共SaaS账号，口令来自进程；重复执行不重置已有账号，失败不补默认账号 |
| [数据库](src/database.ts) | 由本宿主 schema 生成的单一 Client；导入不连接，实际请求按 Prisma 建立连接 |
| [公共订阅接入与 API](../../packages/platform-server/src/modules/subscription/README.md) | 当前租户查看/申请、SaaS 办理、目录与标准年费、原修订/排期/审计 |
| [公共组织与安全管理](../../packages/platform-server/src/modules/platform/README.md) | 当前主体和组织范围复验、固定平台安全读取、同事务保存与审计；七操作、五路径由同源政策/schema组合 |
| [公共字典与编号](../../packages/platform-server/src/modules/platform-tools/README.md) | 本租户工具权限、最高生效配置、同事务取号和审计；五个原操作共用 DTO 与 OpenAPI |
| [公共文件数据及依赖](../../packages/platform-server/src/modules/files/README.md) | 原文件/上传/清理收据两模型，存储配置变更在同一事务核真实文件依赖；业务文件 HTTP 另须受控权威 |
| [公共通知台账](../../packages/platform-server/src/modules/notifications/README.md) | 原通知模板与发送日志两模型，适配日志复用公共集成表；内容、收件范围及真实投递由所属宿主提供 |
| [公共异步任务](../../packages/platform-server/src/modules/jobs/job-ledger.ts) | 原AsyncJob模型、租户内台账及排期；创建登记与实际执行分开，执行者由所属业务提供 |
| [公共邀请与客服邮件](../../packages/platform-server/src/modules/messaging/README.md) | 同一数据库、账号权威、邮件运行时与四个 Controller；原邀请 / 邮箱游标 / 邮件三表保留原键、凭证哈希与 UID 唯一键 |
| [基础集成](../../packages/platform-server/src/modules/integrations/README.md) | 原配置、修订、连通性与受控宿主依赖 |
| [官方日历来源](../../packages/platform-server/src/modules/official-calendars/README.md) | 公共来源维护、年度版本追加与业务只读接点 |
| [公共 schema](prisma/schema.prisma) | 公共账号、角色、会话、外观与设置表；保留原表名和身份标识，行业关联仅为可空历史引用 |
| [迁移](prisma/migrations/20261115000000_public_foundation/migration.sql) | 新公共数据库的基线；旧 Rental 组合库继续原迁移链 |
| [公共实现导读](../../packages/platform-server/README.md) | HTTP / Guard → 认证与设置服务 → 仓储端口及直接消费者 |

准备本项目锁定依赖及独立 MySQL 配置后，生成本宿主 Client，再独立构建。

```sh
npm run db:platform:generate
npm run build:platform-api
npm run lint:platform-api
npm run api:document:platform
```

Client 输出在本宿主 `generated/client`，运行产物从同一宿主目录读取。公共构建消费 `platform-contracts`、`platform-server` 和标准 `core-contracts` / `core-host` / `platform-core-host`。当前 schema 的40个模型均属平台，包含6个 Core 授权/绑定及原收据表、2个统一期限表、5个订阅办理表、2个基础集成表、2个官方日历来源表、2个文件/上传表、2个通知表、1个异步任务表、3个邀请/客服邮件表和1个官网演示申请表。公共数据版本为 `0.1.8`，十三份迁移摘要由数据计划固定；文件、通知与任务的原字段、唯一键、清理收据及外键保留。官网演示申请沿原SQL独立归属公共平台，HTTP装配由相应模块办理。命令是否可执行取决于当前环境许可。

新公共库按 `npm run db:platform:migrate:deploy` 应用本链。**不能把本基线套在已有 Rental 组合库**；已有库切换须先按原迁移来源和数据所有权演练兼容迁移。

构建后，在配置 `SEED_PLATFORM_PASSWORD` 的独立公共库执行 `npm run db:platform:initialize`，创建 `platform` / `admin` 的SaaS账号。初始口令至少8位且包含字母和数字，首次登录必须改密。已有公共库升级后，同一命令核验原管理员并补录当前公共权限目录，角色编辑可选择原订阅权限码。原角色授权与账号口令由既有管理入口维护。主体核验失败时，目录补录随同一事务回滚。命令会访问数据库，口令不进入控制台和审计。

SaaS管理员通过 `POST /api/platform/tenants` 创建公共租户与首个管理员，创建响应返回一次临时口令。租户管理员改密后使用 `/api/platform/tenant`、`users`、`roles`、`permission-tree`；本人资料使用 `/api/platform/self-profile`，外观仍用原正式路径。详细字段、权限、副作用和错误从同版本 OpenAPI读取。

组织列表及维护使用 `/api/platform/organizations`，按当前租户及原组织范围开放。全平台安全配置使用 `/api/platform/security-baseline`，读取和 SaaS 保存分别授权；登录前读取复用同一个固定平台来源。公共后台对应组织页和安全页已直接消费这些接口，Core作者无需自行复制设置页。[公共后台](../platform-admin/README.md) · [管理方法与权限](../../packages/platform-server/src/modules/platform/README.md)

字典使用 `/api/platform/dictionaries`，编号规则及取号使用 `/api/platform/number-rules`，各自要求原工具权限；SaaS 账号不能代租户调用。公共初始化补录两项权限目录，原角色授权不因此扩大。公共缺省为空，租赁默认资料仍由原组合提供；新建和维护从公共后台完成。[五个操作、存储和原格式](../../packages/platform-server/src/modules/platform-tools/README.md)

文件配置停用和存储位置变更必须核原文件、上传及清理收据，默认零 Core 组合也通过同一事务执行该核验。保留文件或unknown依赖时先迁移/处理；查询失败不放行。当前已有公共文件数据和同源内核，业务文件HTTP仍需宿主提供真实对象/成员/范围及附件权威，不因数据表存在开放零 Core 任意上传。[实际接线](src/core-assembly.ts) · [文件迁移](prisma/migrations/20261118010000_public_files/migration.sql)

标准Core管理位于 `/api/platform/core-host`，当前组合已登记管理、本人Core目录和范围HTTP，默认本人目录为空。真正选中Core时提供固定服务、业务HTTP、真实订阅和数据观察；SaaS授权、成员分配与绑定分别成立。[标准宿主用法](../../packages/platform-core-host/README.md)

Core 包管理位于 `/api/platform/core-packages`，包含目录、发现、仓库、包检查、安装 / 更新预检、固定发行预览 / 保存 / 回读，以及候选预览 / 准备 / 回读十二个接口。四组 Controller 使用同一公共主体和数据库，原 Guard 的唯一 Core HTTP provider 合并标准管理与包管理政策。访问要求当前 SaaS 管理身份及 `system:tenant:manage` 或 `*`，保存与准备在原事务写入提交意图审计。[接口及状态](../../packages/platform-core-host/src/core-packages/README.md)

发行引用与候选存储读取进程配置 `CORE_PACKAGE_STORAGE_ROOT`。部署方指定绝对根，并预先建立 `releases`、`candidates` 普通子目录及服务账户访问权。留空时相应存储返回 `unavailable`，目录与父路径由原文件存储核查。准备结果保持 `pending`，发布后结果不明沿原引用或 SHA 读取原记录。[实际配置供给](src/core-assembly.ts) · [存储边界](../../packages/platform-core-host/src/core-package-preparation/README.md)

本地已下载包放入同一根下的 `archives` 普通目录，部署人员按 `CorePackageArchiveIndexSchema` 在 `archives/index.json` 登记固定引用、相对 `.tgz` 文件及完整发行投影。后台的“使用已下载包”发送该引用，服务端沿原包校验读取全部字节。索引首次成功读取后固定到本进程，登记更新通过重启装配采用，读取失败可重试。[登记格式及边界](../../packages/platform-core-host/src/core-package-preflight/README.md)

零 Core 标准底座部署可配置下列进程字段，供给当前版本观察与候选材料。运行目录由本宿主及已加载公共模块的实际路径固定，完整源码须与登记的标准底座包逐文件核同。[当前发行读取](../../packages/platform-core-host/src/core-package-deployment.ts)

| 配置 | 来源与用途 |
| --- | --- |
| `CORE_DEPLOYMENT_LOCK_FILE` | 本次运行组合的绝对 JSON 锁文件路径，启动时固定完整底座发行，Core 及所选数据能力集合为空 |
| `CORE_PLATFORM_PACKAGE_REFERENCE` | `archives/index.json` 中当前底座标准包的固定引用，完整发行须与启动锁一致 |

读取时复核启动锁、当前 Node / 已加载合同版本、标准包全部文件、六个公共服务端模块的实际目录和原数据计划，再由原 MySQL 读取器核迁移收据与物理结构。缺配置、缺标准包、运行目录不符、用户源码差异或原数据未就绪时保留 `unavailable`。启动锁更新通过重启装配采用，失败的启动锁读取同样须修复后重启。候选材料只读取已核同的原迁移字节，准备仍为 `pending`。[原数据观察](src/platform-data.ts)

所选 Core 宿主从实际使用包与原账提供自己的 `deployment`、`materials`，也可显式提供 `localArtifacts`。旧路由许可由该宿主可信策略提供精确方法 / 路径，默认空集合沿原 Core 命名空间检查。[公共装配端口](../../packages/platform-core-host/README.md#core-包管理接入)

组合客户端源码使用 `composeCorePrismaSchema(publicSchema, contributions)`，底座生成器与标量定义保持单源。Core迁移对公共表的明确外键通过 `mysqlForeignKeyExtension` 解析，并由 `createPublicPlatformDataPlan(extensions)` 纳入物理观察。默认空数组沿原零Core数据计划；所选关系、包摘要及原迁移账一起核定，不能只增加Prisma关系就判数据库就绪。[数据组合接入](../../packages/core-contracts/README.md#组合-prisma-源码)

Rental 提供自己的 schema、公共关系与实际数据计划，宿主按同一接点选择它；默认公共宿主继续只用公共数据。新组合 Client 和存量混合库的迁移分别准备。[Rental数据三步接入](../../packages/rental-core/prisma/README.md)

运行使用 `npm run start -w @rental-os/platform-api`；调用此命令会监听 API 端口并按请求访问配置的数据库。OpenAPI 从 `/api/openapi.json` 读取公共、Core 管理及包管理的组合，前述公共离线导出继续使用其公共文档入口。独立 HTTP、真实持久化及完整公共后台验收尚未完成。公开开发入口为[公共服务](../../packages/platform-server/README.md)、[公共后台](../platform-admin/README.md)和[Core接入手册](../../packages/core-contracts/README.md#五步快速接入)。

公共邀请、寄件和客服邮件由 `PlatformServerModule` 自动装配，使用本宿主唯一公共数据库、邮件集成和审计。邀请与客服数据分别沿[邀请迁移](prisma/migrations/20261119000000_public_operator_invitations/migration.sql)和[邮件迁移](prisma/migrations/20261119010000_public_support_email/migration.sql)保持原 SQL。三张表仅引用公共 Tenant，没有 Rental 业务外键。

使用 `/api/platform/users/invitations` 邀请租户基础成员，显式传入 `workspaceAccesses: []`、普通租户角色和有效组织。接受邀请时，账号、角色、审计及一次性凭证在原事务内提交；Core 使用权另由标准 Core 管理分配。原 Rental 邀请继续其经营空间和角色校验。寄件与客服邮件使用 `/api/platform/dispatch` 和 `/api/platform/support/emails`；公开邀请只经 POST `inspect` / `accept` 传原凭证，先执行原限流。字段、方法、权限、读取 / 写入性质由同版本 OpenAPI 提供。[13 个操作与三步接入](../../packages/platform-server/src/modules/messaging/README.md#http请求与接口资料)

实际发信需要已核定的租户邮件集成和部署方 `ADMIN_PUBLIC_URL`，客服同步显式读取实际 IMAP。没有真实配置时沿原错误处理；链接页面、真实邮件 / 数据库及完整独立宿主验收分别验证。
