# 通用租赁平台改造指南

本文档用于后续把当前“门市汽车租赁平台”改造成通用租赁平台，例如摄影器材、露营器材、设备租赁等。

## 改造目标

目标不是简单替换页面文案，而是把业务能力从“汽车”抽象为“可预约、可占用、可领取、可归还、可质检、可计费的租赁标的”。

改造后的平台应支持：

- 多租户 SaaS。
- 多业务线或多品类：汽车、摄影器材、露营器材、办公设备等。
- 标的分组和实例库存。
- 可用性查询、资源占用、履约检查、归还质检、损耗/赔偿结算。
- 押金、租金、超时费、损坏费、清洁费、增值服务费。
- 企业月结或个人支付。
- 站点自提、门店归还、物流寄送等履约方式。

## 推荐改造顺序

### 1. 新增通用领域模型

优先在 `packages/shared/src/index.ts` 中新增通用类型，不要直接删除汽车类型。

建议新增：

- `RentalCategory`：租赁品类，例如 `vehicle`、`camera`、`camping`。
- `RentalItemGroup`：标的分组，替代 `VehicleGroupMaster`。
- `RentalInventoryItem`：库存实例，替代 `VehicleInstanceSummary`。
- `FulfillmentLocation`：履约地点，替代或泛化 `StoreStationSummary`。
- `RentalInspectionTemplate`：领取/归还检查模板。
- `RentalUsageMetric`：使用量指标，例如里程、快门次数、小时数、损耗等级。
- `RentalPricingPlan`：通用定价计划。
- `RentalOrder`：通用订单。

迁移策略：

- 第一阶段新增通用类型，保留汽车类型，做字段映射。
- 第二阶段 API 同时返回汽车 DTO 和通用 DTO。
- 第三阶段页面切换到通用 DTO，再删除汽车 DTO。

### 2. 后端服务拆分

当前核心文件：

- `apps/api/src/modules/store-rental/store-rental.service.ts`
- `apps/api/src/modules/store-rental/store-rental.controller.ts`

建议迁移为：

- `modules/rental-core`：通用规则、定价、订单、履约状态机。
- `modules/inventory`：标的分组、库存实例、可用性。
- `modules/fulfillment`：履约站点、领取、归还、质检。
- `modules/store-rental`：汽车门市租赁适配层，只处理汽车文案和汽车字段映射。

不要一次性重写。先把 `StoreRentalService` 里的方法按责任拆出去：

- `quote` -> `PricingEngine`
- `createOrder` / `runOrderAction` -> `RentalOrderWorkflow`
- `listVehicleGroups` / `listVehicles` -> `InventoryService`
- `listStations` -> `FulfillmentLocationService`
- `getRuleConfig` -> `RentalRuleService`

### 3. 数据库改造

当前 MVP 是内存数据，后续接 MySQL 时表结构要预留通用化空间。

建议表：

- `tenants`
- `organizations`
- `users`
- `roles`
- `permissions`
- `rental_categories`
- `rental_item_groups`
- `rental_inventory_items`
- `fulfillment_locations`
- `rental_pricing_plans`
- `rental_pricing_rules`
- `rental_rule_versions`
- `rental_orders`
- `rental_order_snapshots`
- `rental_order_fee_items`
- `rental_inventory_holds`
- `rental_inspection_templates`
- `rental_inspection_records`
- `rental_operation_logs`

汽车专有字段不要直接塞进主表，应放扩展 JSON 或品类扩展表：

- `vehicle_profile_ext`
- `camera_profile_ext`
- `camping_profile_ext`

示例：

- 汽车：车牌、VIN、座位数、里程、TBox CID。
- 摄影器材：品牌、型号、序列号、快门数、传感器规格、配件清单。
- 露营器材：容量、重量、套装组件、清洁等级、损耗等级。

### 4. 前端页面改造

当前页面：

- `VehicleGroupsView.vue`：车型组管理。
- `VehiclesView.vue`：车辆档案库。
- `StationsView.vue`：服务站点管理。
- `ProductPricingView.vue`：基础产品定价。
- `DynamicPricingView.vue`：动态调价策略。
- `RentalRulesView.vue`：租赁业务规则。
- `NewOrderView.vue`：新建门市订单。
- `OrdersView.vue`：门市租赁订单。

建议迁移：

- `VehicleGroupsView.vue` -> `ItemGroupsView.vue`
- `VehiclesView.vue` -> `InventoryItemsView.vue`
- `StationsView.vue` -> `FulfillmentLocationsView.vue`
- `NewOrderView.vue` -> `RentalOrderCreateView.vue`
- `OrdersView.vue` -> `RentalOrdersView.vue`

页面文案可通过品类配置驱动：

```ts
const categoryUiConfig = {
  vehicle: {
    itemLabel: "车辆",
    groupLabel: "车型组",
    pickupLabel: "取车",
    returnLabel: "还车",
    identifierLabel: "车牌号",
    usageMetricLabel: "里程"
  },
  camera: {
    itemLabel: "器材",
    groupLabel: "器材组",
    pickupLabel: "领取",
    returnLabel: "归还",
    identifierLabel: "序列号",
    usageMetricLabel: "快门次数"
  }
};
```

### 5. 权限改造

当前权限码：

- `store-rental:*`
- `system:*`

通用化建议：

- `rental:rules:manage`
- `rental:pricing:manage`
- `rental:item-group:manage`
- `rental:inventory:view`
- `rental:inventory:manage`
- `rental:location:view`
- `rental:location:manage`
- `rental:order:view`
- `rental:order:operate`
- `rental:order:settle`
- `rental:inspection:manage`
- `rental:report:view`

迁移时可以先让汽车权限和通用权限并存：

- `store-rental:order:view` 兼容映射到 `rental:order:view`。
- 后端守卫允许任一权限命中。
- 页面菜单优先读取通用权限，旧权限作为兼容。

### 6. 定价与规则改造

汽车当前规则包括：

- 押金/预授权。
- 待支付资源保留。
- 异地还车。
- 日租/时租转换。
- 提前取车/提前还车。
- 取消、爽约、超时、续租。
- 取还车验车。
- 企业月结。

通用租赁应抽象为：

- 押金策略：固定押金、租金比例、免押、企业授信。
- 资源占用：待支付占用、确认占用、履约占用。
- 履约方式：自提、归还、寄送、上门取送。
- 计费周期：小时、天、周、月。
- 超额使用费：里程、小时、次数、损耗等级。
- 取消规则：免费取消、有责取消、阶梯扣费。
- 爽约规则：未领取、逾期未领取。
- 归还规则：逾期归还、损坏、缺件、清洁费。
- 检查模板：按品类配置检查项。

### 7. 订单状态改造

当前汽车状态仍可复用，但文案要泛化。

推荐通用状态：

- `pending_payment`
- `reserved`
- `pickup_overdue` -> 可泛化为 `fulfillment_overdue`
- `inspecting`
- `renting`
- `renewing`
- `overdue`
- `accident_processing` -> 可泛化为 `issue_processing`
- `settlement_pending`
- `payment_due`
- `refund_pending`
- `completed`
- `cancelled`
- `no_show`
- `closed`

前端显示文案通过品类配置决定：

- 汽车：取车、还车、验车。
- 摄影器材：领取、归还、质检。
- 露营器材：领取、归还、清点。

### 8. 可用性与资源占用改造

当前汽车门市租赁新增了 `/store-rental/availability`，用于按车组、取还时间和已有订单占用计算可用库存。后续通用租赁应把它迁移为 `/rental/availability`。

通用可用性输入：

- 租赁品类。
- 标的分组或具体标的。
- 履约地点。
- 领取时间。
- 归还时间。
- 履约方式：自提、门店、物流、上门。

通用可用性输出：

- 标的分组。
- 总库存。
- 可用库存。
- 已占用库存。
- 维修/清洁/停用库存。
- 推荐履约地点。
- 不可租原因。

资源占用建议拆成两类：

- 软占用：待支付保留，超时释放。
- 履约操作锁：员工开始领取/取车后进入 `inspecting`，用于防止多人同时处理同一订单；确认交付后释放操作锁。
- 硬占用：已支付、已预订、履约中、归还结算中，必须通过订单状态释放。

检查记录也应通用化：

- 汽车：里程、油量/电量、车况照片、客户签名、损伤说明。
- 摄影器材：快门次数、镜头/机身外观、配件清单、传感器状态、样张/照片。
- 露营器材：组件清点、清洁等级、破损情况、缺件说明、照片。

当前 `inspectionRecords` 已经按 `pickup/return` 两类保存，未来迁移时可把文案改成领取检查/归还检查，字段改为品类配置驱动。

结算汇总也应通用化：

- 汽车：超时费、超里程费、油/电补差、清洁费、损伤赔偿、异店还车差额。
- 摄影器材：超时费、超快门/超使用次数、配件缺失、设备损伤、清洁/检测费。
- 露营器材：超期费、组件缺失、清洁费、破损赔偿、打包服务费。

当前 `settlementSummary` 已拆出 `returnFeeTotal`、`returnTransactionTotal`、`balanceDue`、客户待补缴/待退款和 `monthlyBillAmount`。迁移为通用租赁时不要把这些字段写死为汽车费用名称，只保留“归还阶段差额结算”的资金口径。

### 9. 外部集成改造

当前 mock 集成：

- 支付/预授权。
- 发票。
- 短信通知。
- TBox 车控。
- 地图。
- AI 调度。

通用化时改为适配器：

- `PaymentAdapter`
- `NotificationAdapter`
- `InvoiceAdapter`
- `IotAdapter`
- `MapDistanceAdapter`
- `LogisticsAdapter`
- `FileStorageAdapter`
- `AiRecommendationAdapter`

汽车的 TBox 只是 `IotAdapter` 的一个实现；摄影器材可能接智能柜，露营器材可能不接 IoT。

## 文件级改造清单

| 文件 | 当前职责 | 通用化改造 |
| --- | --- | --- |
| `packages/shared/src/index.ts` | 全部共享 DTO/枚举 | 新增通用租赁 DTO，逐步替换车辆/车型组类型。 |
| `apps/api/src/modules/store-rental/store-rental.service.ts` | 门市租赁规则、定价、订单、主数据 | 拆为 rental-core、inventory、fulfillment，store-rental 保留适配层。 |
| `apps/api/src/modules/store-rental/store-rental.controller.ts` | 门市租赁 API | 新增 `/rental/*` 通用 API，保留 `/store-rental/*` 兼容。 |
| `apps/api/src/common/api-auth.guard.ts` | API 权限拦截 | 新旧权限码兼容映射。 |
| `apps/admin/src/router.ts` | 页面路由和权限 | 增加品类路由或通过租户配置决定默认业务线。 |
| `apps/admin/src/components/AppLayout.vue` | 菜单导航 | 菜单从业务线配置生成，不写死车辆菜单。 |
| `apps/admin/src/views/VehicleGroupsView.vue` | 车型组管理 | 改成通用标的分组，汽车字段做可选扩展。 |
| `apps/admin/src/views/VehiclesView.vue` | 车辆档案库 | 改成库存实例，按品类渲染扩展字段。 |
| `apps/admin/src/views/RentalRulesView.vue` | 汽车租赁规则 | 改成通用规则页，按品类启用/隐藏规则块。 |
| `apps/admin/src/views/NewOrderView.vue` | 新建门市订单 | 改成通用新建订单，标的选择和检查模板按品类加载。 |
| `apps/admin/src/views/OrdersView.vue` | 门市订单列表 | 改成通用订单列表，状态文案按品类配置。 |

## 不建议现在做的事

- 不建议现在把所有 `Vehicle*` 类型立刻改名，否则会打断当前门市租赁 MVP 交付。
- 不建议把所有页面做成完全动态表单，否则原型复刻质量会下降。
- 不建议为了未来品类提前引入复杂插件化架构；当前只需要把字段、状态、权限、接口边界记录清楚。

## 当前开发约束

从现在开始新增功能时应遵守：

- 新增业务规则要同时记录汽车含义和通用含义。
- 新增外部系统接口必须放在适配器或 mock 边界里。
- 新增页面字段如果是汽车专有字段，应在代码注释或文档里标明未来通用字段。
- 新增权限优先考虑是否能映射成通用权限。
- 订单、价格、规则必须保留快照概念，因为通用租赁同样需要历史追溯。
