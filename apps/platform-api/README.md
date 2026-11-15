# 独立公共 API 宿主

这个宿主只装配公共 SaaS 服务和公共 schema，不依赖 `apps/api`、`@rental-os/shared`、Rental 或工单源码。默认不安装任何 Core。当前提供公共登录、本人 / 会话 / 改密、账户与租户外观、健康和 OpenAPI；公共初始化、完整管理能力及标准 Core 装配由 [PCH](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 继续交付。

| 入口 | 职责 |
| --- | --- |
| [启动](src/main.ts) | 消费进程 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、可选 `API_PORT`；不自动加载环境文件 |
| [装配](src/app.module.ts) | 默认空 Core，只选择公共服务和唯一公共数据库 |
| [数据库](src/database.ts) | 由本宿主 schema 生成的单一 Client；导入不连接，实际请求按 Prisma 建立连接 |
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

Client 输出在本宿主 `generated/client`，不写原组合 Client，运行产物从同一宿主目录读取。公共构建只依赖 `platform-contracts` → `platform-server` → 本宿主。命令是否可执行取决于当前环境许可，编译不会代执行迁移。

新公共库按 `npm run db:platform:migrate:deploy` 应用本链。**不能把本基线套在已有 Rental 组合库**；已有库切换须先按原迁移来源和数据所有权演练兼容迁移。当前没有公共 Seed，不能借原 Rental 示范 Seed 创建行业数据来证明无 Core 可运行。

运行使用 `npm run start -w @rental-os/platform-api`；调用此命令会监听 API 端口并按请求访问配置的数据库。OpenAPI 从 `/api/openapi.json` 或前述离线导出命令读取。独立 HTTP、真实持久化及完整公共后台验收尚未完成，实际证据见 [开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-host-packages-20261115)。
