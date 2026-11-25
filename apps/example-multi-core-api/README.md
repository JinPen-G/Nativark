# Rental 与工单双 Core API

本宿主在同一公共底座、数据库和租户中装配 Rental 与 `example-tickets`，提供普通与显式启用 AI 的启动入口，供[双 Core 后台](../example-multi-core-admin/README.md)消费。Rental 原装配负责公共身份、Core 管理、完整租赁服务图及生命周期，工单通过静态接点提供原业务服务和八条 HTTP。每个 Core 分别核租户授权、成员分配、业务权限及原绑定。[Rental 宿主](../rental-api/README.md) · [工单 Core](../../packages/example-tickets-core/README.md)

## 源码入口

- [普通启动入口](src/main.ts)调用[启动组合](src/bootstrap.ts)，复用 Rental 的配置、可信请求身份、员工路由、Guard 作用域、响应和退出排空。
- [应用组合](src/assembly.ts)仅选择固定锁中的 Rental 与工单，调用原 `composeRentalApplication`。工单沿[固定包适配](src/tickets-core.ts)提供正式 server 出口、原迁移名和 SQL 物理观察，取得同一个数据库、Rental 认证源、公共审计与订阅策略。
- [普通 Nest 根模块](src/app.module.ts)沿 `RENTAL_HOST_ASSEMBLY` 注入工单原绑定，公共目录及两 Core 的 OpenAPI 由原组合入口生成。
- [AI 根模块](src/ai-app.module.ts)通过 Rental 的正式 AI 出口供给额外 Core、工单 HTTP 与 OpenAPI。[AI 启动入口](src/ai-main.ts)从同一出口取得启动函数和装配令牌，接入原 AI 服务图。
- 工单 Controller → 服务 → SQL 事务与仓储沿[工单模块说明](../../packages/example-tickets-core/README.md)读取。Rental HTTP、业务与历史恢复沿[Rental 源码路线](../../packages/rental-core/README.md)读取。

## 固定组合与数据准备

部署锁须且仅须包含 Rental 与 `example-tickets` 两个固定发行包。包摘要、完整清单、正式 server 出口、数据计划和 HTTP 贡献由原宿主校验。缺材料或兼容冲突使组合拒绝，物理观察缺失保持 unavailable。

普通构建沿 Rental 所选 schema，AI 构建沿原 `rental-ai` schema 和 `ai-native` 固定数据贡献，两种构建各自提供对应的 Client 声明。工单沿原 raw SQL 迁移及物理 reader 访问自己的三张表。迁移准备复用原 Rental 部署材料入口，实际构建、迁移、注册及授权分别办理。[所选 schema 与固定材料](../rental-api/README.md)

普通启动入口显式选择 `RENTAL_AI_MODE=disabled`。启动沿 Rental 原进程配置，`RENTAL_DEPLOYMENT_LOCK` 指向双 Core 固定锁的绝对路径。数据库、认证、端口和 CORS 的要求见[原启动配置](../rental-api/src/bootstrap.ts)。普通工单通过原授权入口运行。

## 构建与启动

先按 Rental 宿主说明准备所选 schema、Client 和两 Core 的固定包。在仓库根目录，将编译链指向已生成的同一 Rental Client。

```powershell
$env:RENTAL_PRISMA_CLIENT = (Resolve-Path 'apps/rental-api/generated/client/index.d.ts').Path
npm run build:example-multi-core-api
```

原 prebuild 依次消费 Rental 与工单的正式构建链。配置好上一节的进程变量和双 Core 部署锁后，用本宿主的启动入口运行。

```powershell
npm run start -w @rental-os/example-multi-core-api
```

## 可选 AI 组合

AI 入口显式选择 `RENTAL_AI_MODE=enabled`，固定锁同时包含两 Core 和当前 `ai-native` 数据贡献。按 Rental 宿主说明准备该模式的 schema、Client 和固定包，将编译链指向上一节的 Client 声明路径，再运行 AI 构建与启动。

```powershell
npm run build:ai -w @rental-os/example-multi-core-api
npm run start:ai -w @rental-os/example-multi-core-api
```

`createRentalAiHostModule`、`RENTAL_HOST_ASSEMBLY`、装配类型与启动函数来自同一 `@rental-os/rental-api/ai-app-module` 出口，对应 `dist-ai` 产物。工单 HTTP 从该装配取得原绑定，公共身份、数据库与 AI Runtime 沿原实例供给。[正式 AI 出口](../rental-api/src/ai-app.module.ts)

Rental AI 沿原 Gateway、模型预算、审批与原收据运行。工单提供八条普通 HTTP，其 AI 工具范围由原清单和发布来源核定。每次业务访问继续复核当前租户、成员、角色及对象范围。

## 授权与恢复

先注册固定组合，再由 SaaS 管理员授权租户，由租户管理员为成员分别分配 Core。成员的业务角色和 Rental 经营空间仍沿各 Core 的原范围判断。同租户持有两 Core 不授予跨 Core 业务读取。

停用一个 Core 时，另一 Core 继续按当前条件运行。停用和重新授权保留原数据、配置、绑定及操作收据。原工单收据通过当前主体与对象权限只读核对，unknown 沿原操作恢复。租户统一订阅期限仍由公共策略提供。

## 验证入口

所选类型检查复用[内存类型入口](../../scripts/check-selected-prisma-types.cjs)，普通入口采用 `rental` 模式，AI 入口采用 `rental-ai` 模式及[AI 编译配置](tsconfig.ai.json)。定向冒烟沿原固定包、公共身份与 SQL 夹具核同图装配、双授权、成员分配、停用和原收据，发布包与根装配沿同一原宿主验证。验证层级分别记录，实际 HTTP、数据库、冷安装和部署仍按对应环境验收。
