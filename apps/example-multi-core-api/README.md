# Rental 与工单双 Core API

本宿主在同一公共底座、数据库和租户中装配 Rental 与 `example-tickets`，供[双 Core 后台](../example-multi-core-admin/README.md)消费。Rental 原装配负责公共身份、Core 管理、完整租赁服务图及生命周期，工单通过静态接点提供原业务服务和八条 HTTP。每个 Core 分别核租户授权、成员分配、业务权限及原绑定。[Rental 宿主](../rental-api/README.md) · [工单 Core](../../packages/example-tickets-core/README.md)

## 源码入口

- [启动入口](src/main.ts)调用[启动组合](src/bootstrap.ts)，复用 Rental 的配置、可信请求身份、员工路由、Guard 作用域、响应和退出排空。
- [应用组合](src/assembly.ts)仅选择固定锁中的 Rental 与工单，调用原 `composeRentalApplication`。工单沿[固定包适配](src/tickets-core.ts)提供正式 server 出口、原迁移名和 SQL 物理观察，取得同一个数据库、Rental 认证源、公共审计与订阅策略。
- [Nest 根模块](src/app.module.ts)沿 `RENTAL_HOST_ASSEMBLY` 注入工单原绑定，公共目录及两 Core 的 OpenAPI 由原组合入口生成。
- 工单 Controller → 服务 → SQL 事务与仓储沿[工单模块说明](../../packages/example-tickets-core/README.md)读取。Rental HTTP、业务与历史恢复沿[Rental 源码路线](../../packages/rental-core/README.md)读取。

## 固定组合与数据准备

部署锁须且仅须包含 Rental 与 `example-tickets` 两个固定发行包。包摘要、完整清单、正式 server 出口、数据计划和 HTTP 贡献由原宿主校验。缺材料或兼容冲突使组合拒绝，物理观察缺失保持 unavailable。

Prisma Client 使用公共底座与 Rental 的所选 schema。工单沿原 raw SQL 迁移及物理 reader 访问自己的三张表，宿主不为工单追加 Prisma 模型。迁移准备复用原 Rental 部署材料入口，实际构建、迁移、注册及授权分别办理。[所选 schema 与固定材料](../rental-api/README.md)

当前源码入口显式选择 `RENTAL_AI_MODE=disabled`。启动沿 Rental 原进程配置，`RENTAL_DEPLOYMENT_LOCK` 指向双 Core 固定锁的绝对路径。数据库、认证、端口和 CORS 的要求见[原启动配置](../rental-api/src/bootstrap.ts)。普通工单通过原授权入口运行。

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

## 授权与恢复

先注册固定组合，再由 SaaS 管理员授权租户，由租户管理员为成员分别分配 Core。成员的业务角色和 Rental 经营空间仍沿各 Core 的原范围判断。同租户持有两 Core 不授予跨 Core 业务读取。

停用一个 Core 时，另一 Core 继续按当前条件运行。停用和重新授权保留原数据、配置、绑定及操作收据。原工单收据通过当前主体与对象权限只读核对，unknown 沿原操作恢复。租户统一订阅期限仍由公共策略提供。

## 验证入口

所选类型检查复用[内存类型入口](../../scripts/check-selected-prisma-types.cjs)，采用 Rental 模式，并覆盖本宿主源码。定向冒烟沿原固定包、公共身份与 SQL 夹具核同图装配、双授权、成员分配、停用和原收据。验证层级分别记录，实际 HTTP、数据库、冷安装和部署仍按对应环境验收。
