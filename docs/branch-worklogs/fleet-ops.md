# fleet-ops 分支开发记录

分支：`codex/fleet-ops`

## 依据

- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/门市租赁业务总索引.md`
- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/门市租赁端到端业务流程.md`
- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/门市租赁调度边界与履约规则.md`
- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/服务站点管理.md`
- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/订单/订单取车.md`
- PRD：`02_PRD与产品文档/PRD与方案/门市租赁/订单/订单还车.md`
- 原型：`03_原型与页面/营运端/vehicles.html`
- 原型：`03_原型与页面/营运端/vehicle_status_list.html`
- 原型：`03_原型与页面/营运端/vehicle_transfer.html`
- 原型：`03_原型与页面/营运端/vehicle_console.html`
- 原型：`03_原型与页面/营运端/tbox_management.html`
- 原型：`03_原型与页面/营运端/stations.html`

本轮没有修改 PRD 或原型文件。

## 已实现

- MySQL schema 新增车辆/站点地基表：
  - `VehicleTransferTask`
  - `VehicleCredentialRecord`
  - `VehicleOnboardItem`
  - `TboxDevice`
  - `TboxCommandRecord`
  - `StationCalendarDay`
  - `StationCapacitySnapshot`
- 新增 migration：`20260608000300_fleet_ops_foundation`
- Seed 增加车辆证照、随车物品、TBox、站点营业日历和容量快照样例。
- 后端 API 增加：
  - 车辆调拨任务列表/创建
  - 车辆证照列表/保存
  - 随车物品列表/保存
  - TBox 列表、绑定/解绑、预留指令模拟
  - 站点营业日历列表/保存
  - 站点容量快照列表
- 前端新增页面：
  - `VehicleTransferView.vue`：车辆调拨管理
  - `VehicleStatusListView.vue`：车辆速查表
  - `VehicleConsoleView.vue`：车辆控制台
  - `TboxManagementView.vue`：TBox 管理
- 前端增强：
  - `StationsView.vue` 增加站点详情抽屉、营业日历维护、库存/容量快照。
  - 侧栏和路由接入新增车辆营运/资产页面。
  - `VehiclesView.vue` 车辆详情抽屉新增“证照与物资”页签，可维护车辆证照、附件标识、到期提醒、随车物资数量、缺失/损坏状态。

## 业务口径

- 车辆调拨只允许空闲车辆直接执行；租赁中、已预约、整备、维保、停用车辆会被拒绝或保留为待处理任务。
- 调拨目标站点必须属于目标门市，并且启用目标服务类型。
- 车辆状态与订单主状态继续分离；调拨只更新车辆位置、服务类型、位置流水和操作日志，不生成计费快照。
- TBox 仅做预留适配器和效果模拟，不接真实车机供应商。
- 原型中的分时租赁入口不做业务实现。

## 通用租赁改造提示

后续从汽车门市租赁改造成通用租赁平台时，建议优先抽象这些命名和模型：

- `Vehicle` -> `RentalAsset`
- `VehicleGroup` -> `AssetGroup` 或 `RentalProductGroup`
- `plateNo/licensePlate` -> `assetCode`，车牌作为汽车类资产的扩展字段。
- `vin`、`mileage`、`fuelLevel`、`batteryLevel` -> `assetAttributes` 或按资产类型拆扩展表。
- `VehicleCredentialRecord` -> `AssetCredentialRecord`，证照类型按资产类别配置。
- `VehicleOnboardItem` -> `AssetAccessoryItem`，用于摄影器材配件、露营套装清单等。
- `TboxDevice` -> `AssetIoTDevice`，汽车车机只是 IoT 设备的一种。
- `StationCalendarDay` 和 `StationCapacitySnapshot` 可保留为站点通用能力，但容量字段应从“车位”扩展为“库存位/库位/取还柜格”。
- 调拨规则中的“空闲车辆”应改为“可调拨资产”，状态轴保留 `idle/reserved/renting/controlled/maintenance/disabled`，中文展示按资产类型覆盖。

## 验证

- `npm run build -w @rimo/shared`：通过
- `npm run db:validate`：通过
- `npm run build -w @rimo/api`：通过
- `npm run build -w @rimo/admin`：通过

## 未完成项

- 尚未做真实 TBox 供应商接入，仅保留预留指令和模拟结果。
- 车辆证照/随车物品已提供 API、MySQL 落库、车辆详情聚合和车辆档案详情页维护弹窗；后续继续接统一附件中心、到期提醒任务和取还车交接核验。
- 站点容量快照目前由 seed/内存样例提供，后续应由订单占用、车辆所在站点和还车预测自动生成。

## 2026-06-09 追加

- 沿用既有 `codex/fleet-ops` 分支，没有新建分支。
- 已先将分支快进到 `origin/codex/integration/store-rental-mvp@839c7a9`，确保基于最新集成成果继续开发。
- 本轮补 `MD-13 车辆证照`、`MD-14 车辆随车物资` 的营运端落地：车辆详情页新增证照与物资页签，支持新增/编辑证照、附件地址预留、到期提醒天数、随车物资数量与状态。

## 2026-06-09 MD-16 追加

- 当前分支里 `MD-10 车辆调拨`、`MD-11 车务看板` 已有首版前后端和 MySQL 地基，本轮选择缺口最大的 `MD-16 站点容量与排队` 推进。
- 共享 DTO `StationCapacitySnapshot` 新增取车队列、还车队列、总队列、整备缓冲分钟、预计等待分钟、压力等级和压力原因。
- Prisma `StationCapacitySnapshot` 同步新增排队压力字段，并新增 migration `20260609000200_station_capacity_queue`。
- 后端新增 `POST /store-rental/stations/capacity-snapshots/refresh`，内存模式和 `STORE_RENTAL_DATA_SOURCE=mysql` 均按车辆当前位置、订单取还车队列和站点营业日历生成容量快照。
- 站点详情“库存/容量”页签新增容量压力摘要、取还车队列、预计等待和刷新按钮；刷新后重新读取快照列表。
- 开发台账已把 `MD-10/MD-11/MD-12/MD-13/MD-14/MD-15/MD-16` 从旧的 Pending/Reserved 口径同步为当前分支实际 In Progress 状态；技术文档已补接口和 MySQL 落库说明。

验证：

- `npm run build -w @rimo/shared`
- `DATABASE_URL=... npm run db:validate`
- `DATABASE_URL=... npm run db:generate`
- `npm run build -w @rimo/api`
- `npm run build -w @rimo/admin`

## 2026-06-09 MD-10 闭环补齐

- 当前分支保持 `codex/fleet-ops`，本轮未新建分支、未修改 PRD 或 HTML 原型。
- 抽查发现 `MD-10 车辆调拨` 已有 service/repository 流转逻辑，但 controller、前端 API client 和页面未暴露确认/出发/到达/取消动作，MySQL 模式下创建任务后会停留在 `pending`，前端却显示“已执行”。
- 后端新增 `PATCH /store-rental/vehicles/transfer-tasks/:id`，支持 `approve`、`depart`、`arrive`、`cancel`。MySQL 创建阶段和确认阶段均校验履约中订单占用；确认时车辆进入 `controlled` 管控，到达时回写车辆当前门市/据点、服务类型、位置流水、操作日志和容量快照。
- 内存数据源同步改为“创建申请 -> 确认管控 -> 出发 -> 到达回写/取消释放”，避免 memory/mysql 行为分叉。
- 前端 `VehicleTransferView.vue` 已接调拨任务状态流转按钮，任务状态展示为待确认、已确认、已出发、已完成、已取消，并在到达/取消后刷新车辆位置和任务记录。

验证：

- `npm run build -w @rimo/shared`：通过
- `npm run db:generate`：通过
- `npm run build -w @rimo/api`：通过
- `npm run build -w @rimo/admin`：通过
- `git diff --check`：通过
- `npx prisma validate --schema apps/api/prisma/schema.prisma`：未注入 `DATABASE_URL` 时失败；尝试通过单次命令注入临时 `DATABASE_URL` 被本地审批系统因工作区额度不足拒绝，未继续绕路执行。
