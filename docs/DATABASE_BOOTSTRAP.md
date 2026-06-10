# MySQL 数据库初始化说明

本文档记录门市租赁 MVP 从内存数据迁移到 MySQL 的本地初始化步骤。当前阶段已经完成 Prisma schema、migration、seed、平台底座 repository、门市租赁客户域 repository 和订单/费用/月结一期 repository；平台租户、组织、用户、角色、权限、系统参数可通过环境变量切到 MySQL，门市租赁站点、车辆、客户、订单、费用和月结域也可通过环境变量切到 MySQL。

## 当前覆盖

- 平台底座：租户、组织、用户、多角色、权限、按钮权限、数据范围、系统参数。
- 主数据：门市/站点、车型组、车辆实例。
- 客户域：会员、会员等级方案、企业客户、企业联系人、企业合同。
- 订单域一期：订单本体、费用项、资金记录、检查记录、订单时间线、续租快照、改派动作、改还车门市/据点动作、转单后续预约快捷改派一期、企业月结账单、账单明细、回款记录。
- 报表与运维：经营报表聚合、订单/车辆/财务报表、导出任务记录、运维事件日志。
- 预留/待深化领域：事故后续订单联动、终止类动作明细、独立转单/调度事件表、统一审计、幂等锁。

## 本地准备

1. 启动 MySQL 和 Redis：

```powershell
docker compose up -d mysql redis
```

2. 设置本次 PowerShell 会话的数据库连接：

```powershell
$env:DATABASE_URL="mysql://rimo:rimo@localhost:3306/rimo_store_rental"
```

平台底座默认仍走内存数据，方便不启数据库时直接跑本地 MVP。如需让登录、租户、组织、系统用户、角色权限、系统参数走 MySQL，设置：

```powershell
$env:PLATFORM_DATA_SOURCE="mysql"
```

门市租赁业务默认也仍走内存数据。如需让站点、车型组、车辆列表/保存/删除/车辆状态更新、车辆详情事件、会员、会员审核、会员风控、客户等级方案、企业客户、企业联系人、企业合同、订单创建/查询、费用中心、资金记录、检查记录、订单时间线、续租、改派、改还车门市/据点、终止类动作、事故登记和企业月结账单走 MySQL，设置：

```powershell
$env:STORE_RENTAL_DATA_SOURCE="mysql"
```

注意：订单域当前是 MySQL 第一期，已覆盖创建、查询、费用、资金、主流程取还车/结算动作、续租、改派、改还车门市/据点、转单后续预约快捷改派一期、终止类动作、事故登记和企业月结账单；事故后续订单联动、独立转单/调度事件表、统一审计、幂等锁、导出打印和附件仍需继续开发，不能理解为全业务落库完成。

API 默认不会在启动时主动连接数据库。如需启动时验证连接，可设置：

```powershell
$env:DATABASE_CONNECT_ON_START="true"
```

3. 生成 Prisma Client：

```powershell
npm run db:generate
```

4. 校验 schema：

```powershell
npm run db:validate
```

5. 当前已生成初始 migration 文件：

```text
apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql
```

如需重新从 schema 生成空库初始 SQL，可使用：

```powershell
npx prisma migrate diff --from-empty --to-schema-datamodel apps/api/prisma/schema.prisma --script --output apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql
```

6. 执行 migration：

```powershell
npm run db:migrate -- --name init_store_rental_schema
```

7. 初始化 demo 数据：

```powershell
npm run db:seed
npm run db:seed:reports
```

其中 `db:seed:reports` 会补齐报表验收用订单、费用、资金记录、企业月结账单、导出任务和运维日志。报表页 `/reports` 依赖这些数据验证 KPI、订单漏斗、财务对账和导出入口。

## 本地运维脚本

快速启动 MySQL/Redis 并输出推荐环境变量：

```powershell
npm run ops:mysql:setup
```

备份本地 MySQL：

```powershell
npm run ops:mysql:backup
```

恢复本地 MySQL：

```powershell
npm run ops:mysql:restore -- -InputFile backups\rimo-store-rental-YYYYMMDD-HHMMSS.sql
```

## Seed 账号

`seed.ts` 初始化两个租户：

- `demo`：香港租户，包含平台管理员、门店营运、价格规则管理员。
- `demo2`：深圳租户，包含平台管理员、门店营运。

开发期密码口径仍按当前 mock 登录使用 `123456`。seed 表内 `passwordHash` 暂存 `dev-only:123456`，`PLATFORM_DATA_SOURCE=mysql` 时登录模块会识别该开发期格式。生产化前必须替换为真实 hash、盐值和密码策略。

## 后续迁移顺序

1. 平台模块：租户、组织、用户、角色、权限、系统参数已完成 repository 和数据源开关。
2. 主数据：站点、车型组、车辆已完成第一版 repository 和数据源开关。
3. 车辆详情事件：出入站流水、车况照片、维保记录、事故/出险记录和车辆操作日志已完成第一版 repository 和数据源开关。
4. 客户域：会员、企业客户、客户等级方案、会员审核、会员风控、企业联系人、企业合同已完成第一版 repository 和数据源开关。
5. 订单域一期：订单、费用中心、资金记录、检查记录、时间线、续租快照、改派动作、改还车门市/据点动作、转单后续预约快捷改派一期、终止类动作、事故登记、月结账单已完成第一版数据源开关。
6. 报表与运维：经营概览、订单报表、车辆报表、财务报表、导出任务记录、MySQL 备份/恢复脚本和运维日志已完成第一版。
7. 继续迁订单深化能力：事故后续订单联动、独立转单/调度事件表、统一审计、幂等锁。

不要一次性把所有 service 切到数据库。每切一个模块都要保留 `npm run build`、关键接口冒烟和前端页面验证。

## Repository 状态

当前已新增 `PlatformRepository`，覆盖租户、组织、权限树、角色、用户、系统参数的基础读写和 DTO 映射。`PlatformService` 已增加 `PLATFORM_DATA_SOURCE=memory|mysql` 开关：

- `memory`：默认值，继续使用内存 demo 数据，本地无数据库也能启动。
- `mysql`：登录、当前用户、租户、组织、角色、权限树、系统用户、系统参数走 Prisma/MySQL。

当前已新增 `StoreRentalRepository`，覆盖站点、车型组、车辆的列表、保存、车型组删除校验、车辆状态更新、车辆详情事件、会员、会员审核、会员风控、客户等级方案、企业客户、企业联系人、企业合同、订单、费用、资金记录、检查记录、订单时间线、续租快照、事故记录、企业月结账单和 DTO 映射。`StoreRentalService` 已增加 `STORE_RENTAL_DATA_SOURCE=memory|mysql` 开关：

- `memory`：默认值，继续使用内存 demo 业务数据。
- `mysql`：站点、车型组、车辆主数据、车辆详情事件、客户域、订单创建/查询、费用中心、资金记录、检查记录、订单时间线、续租、改派、改还车门市/据点、转单后续预约快捷改派一期、终止类动作、事故登记和企业月结走 Prisma/MySQL，原型扩展字段写入各自主表的 `metadata` JSON，车辆操作日志写入 `OperationLog`，会员风控/时间线写入客户事件表。

下一步继续把事故后续订单联动、独立转单/调度事件表、统一审计、幂等锁、导出打印、附件和定时作业迁到 MySQL。企业月结账单行当前只在成功 `monthly_bill` 交易后生成，符合“完单后挂账”的规则。
