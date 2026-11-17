# 独立公共 API 宿主

这个宿主只装配公共 SaaS 服务和公共 schema，不依赖 `apps/api`、`@rental-os/shared`、Rental 或工单源码。默认不安装任何 Core。当前提供公共初始化、登录 / 本人 / 会话 / 改密、租户与人员角色管理、账户与租户外观、完整订阅办理、健康和 OpenAPI；基础集成、完整后台和标准 Core 装配由 [PCH](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 继续交付。

| 入口 | 职责 |
| --- | --- |
| [启动](src/main.ts) | 消费进程 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、可选 `API_PORT`；不自动加载环境文件 |
| [装配](src/app.module.ts) | 默认空 Core，只选择公共服务和唯一公共数据库 |
| [Core装配](src/core-assembly.ts) | 同一实际工厂供给标准Core管理、本人目录、范围和Guard；默认零Core，未知业务拒绝 |
| [数据计划](src/platform-data.ts) | 固定迁移摘要、唯一数据版本、实际物理结构读取；清单和真实已应用账分别核验 |
| [初始化](src/initialize.ts) | 显式命令创建公共SaaS账号，口令来自进程；重复执行不重置已有账号，失败不补默认账号 |
| [数据库](src/database.ts) | 由本宿主 schema 生成的单一 Client；导入不连接，实际请求按 Prisma 建立连接 |
| [公共订阅接入与 API](../../packages/platform-server/src/modules/subscription/README.md) | 当前租户查看/申请、SaaS 办理、目录与标准年费、原修订/排期/审计 |
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

Client 输出在本宿主 `generated/client`，不写原组合 Client，运行产物从同一宿主目录读取。公共构建消费 `platform-contracts`、`platform-server` 和标准 `core-contracts` / `core-host` / `platform-core-host`，不构建具体业务Core。当前 schema 的 27 个模型均属平台，包含 6 个 Core 授权/绑定及原收据表、2 个统一期限表和 5 个订阅办理表。公共数据版本为 `0.1.1`，五表沿原 SaaS 订阅定义与外键追加到独立迁移链。命令是否可执行取决于当前环境许可，编译不会代执行迁移。

新公共库按 `npm run db:platform:migrate:deploy` 应用本链。**不能把本基线套在已有 Rental 组合库**；已有库切换须先按原迁移来源和数据所有权演练兼容迁移。

构建后，在配置 `SEED_PLATFORM_PASSWORD` 的独立公共库执行 `npm run db:platform:initialize`，创建 `platform` / `admin` 的SaaS账号。初始口令至少8位且包含字母和数字，首次登录必须改密。已有公共库升级后，同一命令核验原管理员并补录当前公共权限目录，角色编辑可选择原订阅权限码。原角色授权与账号口令由既有管理入口维护。主体核验失败时，目录补录随同一事务回滚。命令会访问数据库，口令不进入控制台和审计。

SaaS管理员通过 `POST /api/platform/tenants` 创建公共租户与首个管理员，创建响应返回一次临时口令。租户管理员改密后使用 `/api/platform/tenant`、`users`、`roles`、`permission-tree`；本人资料使用 `/api/platform/self-profile`，外观仍用原正式路径。详细字段、权限、副作用和错误从同版本 OpenAPI读取。

标准Core管理位于 `/api/platform/core-host`，当前组合已登记管理、本人Core目录和范围HTTP，默认本人目录为空。真正选中Core时提供固定服务、业务HTTP、真实订阅和数据观察；SaaS授权、成员分配与绑定分别成立。[标准宿主用法](../../packages/platform-core-host/README.md)

运行使用 `npm run start -w @rental-os/platform-api`；调用此命令会监听 API 端口并按请求访问配置的数据库。OpenAPI 从 `/api/openapi.json` 读取公共与Core管理的组合；前述公共离线导出只含公共接口。独立 HTTP、真实持久化及完整公共后台验收尚未完成，实际证据见 [公共宿主](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-host-packages-20261115)、[公共管理](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-management-20261115) 与 [Core主接点](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-assembly-20261115)。
