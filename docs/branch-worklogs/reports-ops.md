# reports-ops 分支开发记录

## 范围

本分支负责门市租赁报表、运维脚本、演示数据工厂、基础测试和可观测日志底座。不开发工作台，不开发分时租赁，不改 PRD 和原型文件。

## 需求依据

- `门市租赁业务方案说明-逐页说明稿.md`：营运平台需要订单、车辆、客户、企业、费用、日志和报表查询能力。
- `门市租车订单列表.md`：运营统计、订单状态分组、企业月结、待收/待退、风险标记和数据导出口径。
- `费用管理.md`：费用项、资金记录、企业月结、追缴、减免、退款和导出交易记录口径。
- `war_room.html`：战情分析看板原型，包含 KPI、营收趋势、车辆状态、订单漏斗、门市排行、车组排行、风险趋势等结构。

## 已完成

- 新增后端 `reports` 模块：
  - `GET /reports/dashboard`
  - `GET /reports/orders`
  - `GET /reports/vehicles`
  - `GET /reports/finance`
  - `POST /reports/exports`
  - `GET /reports/exports`
  - `GET /reports/exports/:fileName`
  - `GET /reports/ops/health`
  - `GET /reports/ops/logs`
- 新增 MySQL 表：
  - `ReportExportJob`：记录导出任务、筛选条件、行数、文件名和操作人。
  - `OpsEventLog`：记录运维、seed、导出、备份等可观测事件。
- 新增营运端页面 `/reports`：
  - 经营概览、订单报表、车辆报表、财务报表、运维日志。
  - 接入现有权限 `store-rental:report:view`，导出按钮受 `system:button:export` 控制。
  - 导出任务表支持查看创建时间、任务状态和下载已完成 CSV 文件。
- 新增真实 CSV 导出闭环：
  - `POST /reports/exports` 先写入 processing 任务，再按当前筛选生成订单、车辆、财务、概览或运维日志 CSV。
  - 导出文件写入 `storage/report-exports`，任务完成后更新 `ReportExportJob.status=rowCount/downloadUrl/completedAt`。
  - `GET /reports/exports/:fileName` 按文件名下载已完成导出文件；文件缺失或任务未完成会返回错误。
- 新增 MySQL 报表演示数据工厂：
  - `npm run db:seed:reports`
  - 覆盖已完成、用车中、出险处理中、待补缴、待退款、逾期未取、企业月结、完成后追缴等场景。
- 新增本地运维脚本：
  - `scripts/setup-local-mysql.ps1`
  - `scripts/backup-mysql.ps1`
  - `scripts/restore-mysql.ps1`
- 新增轻量口径测试：
  - `npm run test:reports`

## 报表口径

订单报表按预计取车时间筛选，状态分组与《门市租车订单列表》保持一致：

- 待处理：`pending_payment`、`reserved`、`pickup_overdue`
- 履约中：`inspecting`、`renting`、`renewing`
- 结算处理：`settlement_pending`、`payment_due`、`refund_pending`
- 异常风险：`overdue`、`accident_processing` 或存在风险标记
- 企业月结：`billingMode=monthly`

财务报表以费用项和资金记录分离为原则：

- 应收金额：正向费用 - 退费费用 - 减免费用
- 已处理金额：`payment`、`pre_auth_capture`、`monthly_bill` 成功交易
- 待处理金额：待处理费用和企业月结费用的 `pendingAmount`
- 退款金额：`refund` 交易
- 减免金额：`waiver` 交易与减免费用
- 月结金额：`monthly_bill` 交易

车辆报表按车辆当前运营状态、关联订单、维保记录和事故记录统计。当前出租率为 MVP 近似口径，后续应改成按车辆在筛选周期内的占用小时 / 可租小时计算。

## 本地 MySQL 准备

建议流程：

```powershell
npm run ops:mysql:setup
$env:DATABASE_URL="mysql://rimo:rimo@localhost:3306/rimo_store_rental"
$env:PLATFORM_DATA_SOURCE="mysql"
$env:STORE_RENTAL_DATA_SOURCE="mysql"
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:seed:reports
```

备份：

```powershell
npm run ops:mysql:backup
```

恢复：

```powershell
npm run ops:mysql:restore -- -InputFile backups\rimo-store-rental-YYYYMMDD-HHMMSS.sql
```

## 测试覆盖

- `tests/reports-metrics.test.cjs`：固定 fixture 校验订单分组、财务应收、已处理、待处理和月结金额口径。
- 后续建议补：
  - MySQL 集成测试：seed 后请求 `/reports/dashboard`、`/reports/orders`、`/reports/finance`。
  - 前端 e2e：登录 admin，进入 `/reports`，验证 KPI、tabs、导出按钮和运维日志。

## 通用租赁平台改造提示

未来从汽车租赁改成摄影器材、露营器材等通用租赁平台时，报表要重点替换以下维度：

- `vehicle` 改为 `asset` 或 `rentalItem`。
- `vehicleGroup` 改为 `assetGroup`、`skuGroup` 或 `productGroup`。
- `plateNo` 改为 `assetCode`、`serialNo` 或 `inventoryNo`。
- `mileage`、油量、电量、TBox 相关指标应拆成汽车专属扩展，不进入通用报表核心。
- 车辆状态分布应抽象为库存状态：可租、已预订、出库中、租赁中、归还质检、维修/保养、停用。
- 门市/据点仍可复用为履约网点，但跨城市、异地还车应改成跨仓/跨门店归还规则。
- 财务报表口径可以复用，费用类型需要从车损、超里程、油电补差扩展为损耗、缺件、清洁、延迟归还、耗材等通用费用。

## 本轮记录

| 日期 | 完成内容 | 验证 |
| --- | --- | --- |
| 2026-06-09 | 报表导出任务从占位升级为真实 CSV 文件生成与下载：导出 job 状态流、文件落地目录、下载接口和营运端任务表下载按钮已接入 | `$env:DATABASE_URL=...; npm run db:validate`、`npm run test:reports`、`npm run build` |

## 后续未完成

- 导出任务已支持真实 CSV 文件；后续继续补 Excel 模板、异步任务队列、文件过期清理和对象存储/附件中心接入。
- 运维日志已有基础表和页面，定时清理、告警通知、trace 串联仍待补。
- 车辆出租率当前为 MVP 近似口径，需在订单占用小时和可租小时落表后精确化。
- 报表权限暂只到查看级，后续可拆 `report:finance:view`、`report:export`、`ops:log:view`。
