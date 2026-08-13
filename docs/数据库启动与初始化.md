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
$env:DATABASE_URL="mysql://store_rental:store_rental@localhost:3306/store_rental"
```

示例环境默认让平台底座走 MySQL。需要显式设置：

```powershell
$env:PLATFORM_DATA_SOURCE="mysql"
```

旧车辆兼容域也默认走 MySQL，其仓库从请求登录态读取租户，不再固定使用 `tenant_001`：

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
npm run ops:mysql:restore -- -InputFile backups\store-rental-YYYYMMDD-HHMMSS.sql
```

## Seed 账号

`seed.ts` 初始化一个 SaaS 平台主体和两个业务租户：

- `platform / admin / RentalOS!2026`：SaaS 平台管理员，只管理租户。
- `demo / admin / RentalDemo!2026`：香港租户，包含租户管理员、门店营运、价格规则管理员。
- `demo2 / admin / RentalDemo!2026`：深圳租户，包含租户管理员、门店营运。

seed 密码使用随机盐 `scrypt` 写入，不再保存或兼容 `dev-only:` 明文格式。以上仅是本地演示凭据，生产部署必须通过安全配置单独创建首个 SaaS 管理员并立即更换密码。

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

- `memory`：仅用于无数据库的本地演示和自动测试。
- `mysql`：登录、当前用户、租户、组织、角色、权限树、系统用户、系统参数走 Prisma/MySQL。

当前已新增 `StoreRentalRepository`，覆盖站点、车型组、车辆的列表、保存、车型组删除校验、车辆状态更新、车辆详情事件、会员、会员审核、会员风控、客户等级方案、企业客户、企业联系人、企业合同、订单、费用、资金记录、检查记录、订单时间线、续租快照、事故记录、企业月结账单和 DTO 映射。`StoreRentalService` 已增加 `STORE_RENTAL_DATA_SOURCE=memory|mysql` 开关：

- `memory`：仅用于遗留页面的本地演示，不作为多租户隔离验收依据。
- `mysql`：站点、车型组、车辆主数据、车辆详情事件、客户域、订单创建/查询、费用中心、资金记录、检查记录、订单时间线、续租、改派、改还车门市/据点、转单后续预约快捷改派一期、终止类动作、事故登记和企业月结走 Prisma/MySQL，原型扩展字段写入各自主表的 `metadata` JSON，车辆操作日志写入 `OperationLog`，会员风控/时间线写入客户事件表。

下一步继续把事故后续订单联动、独立转单/调度事件表、统一审计、幂等锁、导出打印、附件和定时作业迁到 MySQL。企业月结账单行当前只在成功 `monthly_bill` 交易后生成，符合“完单后挂账”的规则。
