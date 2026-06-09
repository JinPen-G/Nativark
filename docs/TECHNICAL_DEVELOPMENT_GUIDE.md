# 技术开发文档

本文档记录当前门市租赁 MVP 的技术实现，并为后续通用租赁平台改造保留清晰边界。

## 技术栈

- 前端：Vue 3、Vite、TypeScript、Pinia、Vue Router、Element Plus、Tailwind CSS。
- 后端：NestJS、TypeScript。
- 共享包：`@rimo/shared` 维护前后端共用 DTO、枚举和状态。
- 数据库：MySQL。当前 MVP 默认使用后端内存数据；平台底座可通过 `PLATFORM_DATA_SOURCE=mysql` 切到 Prisma/MySQL，门市租赁可通过 `STORE_RENTAL_DATA_SOURCE=mysql` 逐步切换站点、车辆、客户、订单、费用和月结域。
- 本地辅助：Docker Compose 预留 MySQL、Redis。

## 目录结构

```text
rimo-store-rental-platform/
  apps/
    admin/        营运端前端，门店端也复用该端
    api/          NestJS API
  packages/
    shared/       前后端共享类型
  docs/           技术开发文档和通用租赁改造说明
```

交接给其他 AI 或开发者时，先读取 `docs/AI_HANDOFF.md`，再读取本技术文档和 `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md`。

## 前端架构

### 入口

- `apps/admin/src/main.ts`：注册 Vue、Pinia、Router、Element Plus 和图标。
- `apps/admin/src/router.ts`：路由、登录守卫、页面级权限校验。
- `apps/admin/src/api/client.ts`：Axios 实例、token、租户上下文、401 处理。
- `apps/admin/src/stores/auth.ts`：登录态、租户上下文、用户权限。
- `apps/admin/src/components/AppLayout.vue`：营运端统一侧边栏、顶部栏、菜单权限过滤。

### 当前页面

- `LoginView.vue`：登录页，按原型左右分栏，保留验证码和语言切换。
- `OrganizationManagementView.vue`：组织架构，按 `employees.html` 的组织树和部门编辑思路维护营运部门、车行、门店和站点；当前组织仍服务汽车租赁，后续通用租赁可改名为运营组织/服务网点/仓库层级。
- `UserManagementView.vue`：平台账户管理，包含租户、组织、角色、启停、重置密码。
- `PermissionsView.vue`：角色权限管理，包含业务线授权和权限矩阵。
- `PlatformGovernanceView.vue`：平台治理中心，包含审计日志、数据字典、编号规则、租户初始化。
- `RentalRulesView.vue`：门市租赁规则。
- `ProductPricingView.vue`：基础产品定价。
- `DynamicPricingView.vue`：动态调价策略。
- `StationsView.vue`：服务站点管理。
- `VehicleGroupsView.vue`：车型组管理。
- `VehiclesView.vue`：车辆档案库，包含车辆详情抽屉、维保/事故记录新增、车辆证照与随车物资维护、车辆状态动作和筛选预设。
- `VehicleTransferView.vue`：车辆调拨管理，包含调拨任务列表、调拨创建、确认、出发、到达、取消和任务流转。
- `VehicleStatusListView.vue`：车辆速查表，包含车辆状态、TBox 绑定和异常车务筛选。
- `VehicleConsoleView.vue`：车辆控制台，包含 TBox 预留远控指令 mock。
- `TboxManagementView.vue`：TBox 设备管理，包含设备台账和车辆绑定。
- `ValueAddedServicesView.vue`：增值服务管理。
- `NewOrderView.vue`：新建门市订单。
- `OrdersView.vue`：门市租赁订单列表，已接入筛选预设保存、设默认、删除和默认视图自动应用。
- `OrderDetailView.vue`：门市租赁订单详情工作台，包含订单动作、履约信息、费用中心。
- `FinanceCenterView.vue`：财务结算中心，覆盖资金流水、预授权押金、企业月结、发票收据、手工调账和财务对账。
- `OfficialVehicleContractsView.vue`：合同与单据中心，包含单据统计、筛选、模板卡片、订单关联生成、打印/下载 mock、mock 签署和单据快照。

当前已接入的营运端基础页面：

- 系统通用参数：已按原型 `system_rules.html` 开发，作为平台级配置中心处理。
- 车辆调拨：已按原型 `vehicle_transfer.html` 开发第一版，作为车辆位置和履约资源调整模块处理；创建任务只生成调拨申请，到达确认后才回写车辆门市/据点和位置流水。
- 车务看板：已按原型 `vehicle_status_list.html`、`vehicle_console.html` 开发第一版，作为车辆状态监控和批量处置入口。
- TBox 设备管理：已按原型 `tbox_management.html` 开发第一版，本期只做设备台账和 mock 集成。

当前未完整开发、但已纳入正式任务或后续增强的营运端页面：

- 合同与单据：当前 MVP 已按原型 `official_vehicle_contracts.html` 完成页面、订单关联、打印下载 mock 和 mock 签署；后续补租户可编辑模板、真实 PDF/附件中心、真实电子签/打印 provider 和审计报表。

这些模块中，会员、等级方案、企业客户、车务看板、车辆调拨、合同与单据、TBox 当前都没有独立 PRD，先以原型字段、列表、详情、状态、审核、等级权益、额度、打印下载和设备档案交互为准，后续如果补 PRD，再回写业务规则和权限颗粒度。

当前已落地的客户运营页面和接口：

- 个人会员：`MembersView.vue`、`MemberDetailView.vue`、`MemberReviewView.vue`；列表已接入关键字、会员状态、审核状态、标签、分页、筛选统计和筛选预设，并在列表页补齐新增/编辑弹窗。新增/编辑走 `saveMember`，编辑前用 `getMemberDetail` 回填手机号、邮箱、证件、认证、紧急联系人、标签和风控备注。
- 客户等级方案：`MembershipPlansView.vue`；等级保存已做后端层级、折扣比例、免费服务次数校验，个人订单报价会读取启用等级方案并生成租金/押金权益。
- 企业客户：`CorporatesView.vue`、`CorporateDetailView.vue`；列表已接入关键字、企业状态、合同状态、分页、筛选统计和筛选预设。
- 新建订单客户接入：`NewOrderView.vue` 已切换到真实会员/企业客户接口，不再使用原型客户 seed

当前已落地的客户运营接口：

- `GET/POST/PUT /store-rental/members`
- `GET /store-rental/members/:id`
- `POST /store-rental/members/:id/risk-actions`
- `GET /store-rental/member-reviews`
- `POST /store-rental/member-reviews/:id/process`
- `GET/POST/PUT /store-rental/membership-plans`
- `GET/POST/PUT /store-rental/corporates`
- `GET /store-rental/corporates/:id`
- `GET /store-rental/corporates/:id/monthly-bills`
- `POST /store-rental/corporates/:id/monthly-bills/:billId/settle`
- `GET/POST /store-rental/corporates/:id/contracts/:contractId/attachments`

当前客户运营与订单联动已具备：

- 会员列表返回真实会员等级、认证状态、标签、积分余额、筛选统计和分页结果；会员列表页可直接新增/编辑资料并刷新后端分页结果；`NewOrderView.vue` 继续通过前端 client 兼容数组式会员下拉。
- 客户等级方案的 `orderDiscountPercent` 和 `depositDiscountPercent` 已接入 `POST /store-rental/pricing/quote`：个人订单按启用等级方案计算租金折扣、押金折扣、费用项、报价说明和订单快照；企业/月结订单不使用个人会员权益。
- 企业客户详情支持月结配置字段：账单邮箱、对账单邮箱、对账联系人、自动生成月结、授信预警阈值。
- 企业客户详情支持合同台账字段：合同编号、名称、状态、生效期、门市范围、附件文件名、备注。
- 会员列表和详情支持风控动作：暂停、拉黑、恢复。动作会写入会员时间线，并把黑名单/人工限制同步到关联订单风险标记。
- 新建订单页下单时会引用真实会员和企业客户 ID；后端会校验会员状态、身份证/驾驶证认证、企业状态、企业结算模式和授信额度。
- 成功创建订单后，会回写会员最近订单、会员时间线、企业最近订单和企业活跃订单数。
- 企业详情页已接月结账单第一版：按月归集企业月结订单、展示账单明细、登记回款并更新余额。

### 登录与权限

前端登录态存在 localStorage：

- `rimo_access_token`
- `rimo_tenant`
- `rimo_user`

请求时会自动写入：

- `Authorization: Bearer <token>`
- `x-tenant-id`
- `x-tenant-code`

页面权限分两层：

- 菜单层：`AppLayout.vue` 根据 `authStore.hasPermission` 过滤菜单。
- 路由层：`router.ts` 根据 `route.meta.permission` 拦截直接 URL 访问。

注意：前端权限只做交互保护，真正的接口保护在后端 `ApiAuthGuard`。

## 后端架构

### 入口

- `apps/api/src/app.module.ts`：注册控制器、服务、全局响应拦截器和 API 守卫。
- `apps/api/src/contracts/openapi-document.ts`：接口契约源，维护 OpenAPI paths、DTO schema 名称、operationId 和权限扩展字段。
- `apps/api/src/modules/openapi/openapi.controller.ts`：运行时 OpenAPI JSON 端点，路径为 `/api/openapi.json`。
- `apps/api/src/common/request-id.interceptor.ts`：统一响应结构 `{ data, requestId }`。
- `apps/api/src/common/api-auth.guard.ts`：登录保护和接口权限校验。

### 平台模块

文件：

- `modules/auth/auth.controller.ts`
- `modules/auth/auth.service.ts`
- `modules/platform/platform.controller.ts`
- `modules/platform/platform.service.ts`
- `modules/platform/platform.repository.ts`
- `modules/database/prisma.service.ts`

职责：

- 登录。
- 当前用户。
- 租户列表。
- 组织列表。
- 组织架构创建、编辑、启停。
- 平台账户管理。
- 角色管理。
- 权限树。
- 审计日志查询。
- 数据字典治理。
- 编号规则配置和试生成。
- 列表筛选预设，支持订单、车辆、会员、企业客户列表保存视图、设默认和删除。
- 租户初始化模板预览和执行。

数据源：

- 默认 `PLATFORM_DATA_SOURCE=memory`，继续使用内存 demo 数据，方便本地无数据库启动。
- 设置 `PLATFORM_DATA_SOURCE=mysql` 后，登录、当前用户、租户、组织、权限树、角色、系统用户、系统参数、审计日志、数据字典、编号规则、筛选预设和租户初始化走 `PlatformRepository/Prisma`。
- `DATABASE_CONNECT_ON_START=false` 时 API 启动不主动连库；切到 `mysql` 后实际访问平台接口会连接数据库。

平台治理接口：

1. `GET /platform/audit-logs`：查询平台操作审计。内存模式读演示日志；MySQL 模式读 `OperationLog`。
2. `GET /platform/dictionaries`、`PUT /platform/dictionaries/:code`：维护数据字典。MySQL 模式写 `SystemParameterSet.module=platform-dictionaries`。
3. `GET /platform/number-rules`、`PUT /platform/number-rules/:code`、`POST /platform/number-rules/generate`：维护和试生成编号。MySQL 模式写 `SystemParameterSet.module=platform-number-rules`，生成时递增当前流水并写审计。
4. `GET /platform/tenant-bootstrap/preview`、`POST /platform/tenant-bootstrap`：初始化租户、默认营运组织、默认角色、平台管理员、系统参数、数据字典和编号规则。

后续通用租赁改造时，平台治理优先保持品类无关：审计使用 `objectType/objectId/action`，字典按模块分组，编号规则按 `module/code` 分组。汽车相关的 `VEHICLE_LICENSE` 应迁移为通用 `ASSET_CERTIFICATE` 或按品类扩展。

当前 SaaS 数据：

- `tenant_001 / demo / RIMO 香港租户`
- `tenant_002 / demo2 / RIMO 深圳租户`

默认账号：

- `demo / admin / 123456`
- `demo / store / 123456`
- `demo / pricing / 123456`
- `demo2 / admin / 123456`

### 门市租赁模块

文件：

- `modules/store-rental/store-rental.controller.ts`
- `modules/store-rental/store-rental.service.ts`

职责：

- 租赁规则。
- 价格计划。
- 报价试算。
- 站点。
- 车型组。
- 车辆实例。
- 站点、车型组、车辆实例的后端保存校验、状态动作、维保/事故记录。
- 增值服务。
- 订单创建。
- 订单列表和详情。
- 订单动作。
- 费用中心查询、新增费用、费用减免、收款、退款、企业月结登记。
- 财务结算中心：资金流水、预授权押金台账、发票/收据、手工调账、企业月结和对账异常。
- 调度看板、候选车辆、预览式智能优化、应用预分配、硬锁和调度页人工改派。
- 调度任务池和调度事件审计。
- 外部集成预留。
- 企业端/H5 预留接口说明。

当前门市租赁业务默认仍是内存数据。已新增 `StoreRentalRepository` 和 `STORE_RENTAL_DATA_SOURCE=memory|mysql`：设置为 `mysql` 后，租赁业务规则当前版本/历史版本、站点列表分页/筛选/保存、站点营业日历、站点容量/排队快照、车型组、车辆列表分页/筛选/保存/删除校验/车辆状态更新、车辆出入站流水、车况照片记录、维保记录、事故/出险记录、车辆操作日志、车辆调拨任务与流转、车辆证照、随车物资、TBox 台账、个人会员列表分页/筛选/详情/保存、会员审核、会员风控、客户等级方案、企业客户列表分页/筛选/详情/保存、企业联系人、企业合同、订单创建/查询、订单费用中心、检查记录、资金流水、预授权押金台账、发票/收据、手工调账、订单时间线、续租快照、改派动作、改还车门市/据点动作、终止类动作、订单事故登记、调度预分配/硬锁/人工改派、调度事件审计和企业月结账单走 Prisma/MySQL。

租赁业务规则版本实现口径：

- `GET /store-rental/rules` 读取当前生效规则；`PUT /store-rental/rules` 每次保存生成新 `RULE-STORE-YYYYMMDD-序号`，旧生效版本归档。
- `GET /store-rental/rules/versions` 和 `GET /store-rental/rules/versions/:version` 用于配置页历史版本列表和只读详情。MySQL 模式写入 `RentalRuleSet`，内容采用 `{ snapshot, metadata }`，其中 `snapshot` 保存完整 `StoreRentalRuleConfig`，`metadata` 保存保存人、保存时间和变更原因。
- 报价入口会先刷新当前规则版本，确保 `PricingQuoteResult.snapshots.ruleVersion` 和后续订单基线快照绑定真实生效版本。
- 后续通用租赁平台改造时，应把 `StoreRentalRuleConfig` 抽象为 `RentalRuleConfig`，保留版本、状态、生效时间、押金/保证金、取消、爽约、逾期、履约检查等通用结构；汽车特有的取还车、车辆整备、油电量规则迁移到品类扩展配置。

订单域 MySQL 第一期覆盖：

- `POST /store-rental/orders`：读取 MySQL 会员/企业主档，写入订单本体、价格快照、规则快照、初始费用、资金记录和时间线，并回写会员/企业统计。
- `GET /store-rental/orders`、`GET /store-rental/orders/:id`、`GET /store-rental/orders/:id/fees`：从订单、费用、资金、检查、时间线、结算摘要表读取。
- `GET /store-rental/contracts`、`GET /store-rental/contracts/templates`、`POST /store-rental/orders/:id/contracts`、`POST /store-rental/contracts/:id/print-mock`、`POST /store-rental/contracts/:id/sign-mock`：合同与单据中心、模板清单、订单关联生成、打印/下载 mock 和签署 mock。MySQL 模式复用 `OrderContractDocument`，扩展字段写入 `payload` JSON。
- `POST /store-rental/orders/:id/remarks`、`PATCH /store-rental/orders/:id/remarks/:remarkId/close`：订单备注与跟进第一版，支持内部备注、客户备注、回访记录、履约跟进、责任人、跟进时间、提醒时间和关闭状态。MySQL 模式写入 `OrderRemarkRecord`，关闭动作只更新备注/跟进记录，不改变订单主状态。
- `POST /store-rental/orders/:id/fees`、`/fees/:feeId/waive`、`/transactions`：人工费用、减免、收退款/月结交易落库。
- `POST /store-rental/orders/:id/actions/:action`：MySQL 模式已接入主流程动作 `payment-success`、`start-pickup`、`pickup-inspection`、`return-inspection`、`confirm-settlement`，以及 `extend-rental`、`redirect-order`、`change-return-store`、`change-return-station`、`cancel`、`mark-no-show`、`reject-order`、`close-order`、`register-accident`；其中改还车门市/据点已支持后续预约冲突快捷改派一期。本轮新增订单操作记录、请求摘要幂等和取车操作锁校验。
- `GET /store-rental/orders/:id/operation-records`：订单级操作记录，记录关键动作、请求摘要、幂等键、锁状态、操作人、完成状态和返回结果摘要。
- `GET /store-rental/orders/:id/notifications`：订单级客户通知留痕，记录事件、模板、渠道、目标号码快照、mock 发送状态、关联动作和发送时间。
- `GET/POST /store-rental/corporates/:id/monthly-bills`：企业月结账单、明细和回款记录落库。月结账单行只在成功 `monthly_bill` 交易后生成，避免待挂账订单提前进入账单。

后续通用租赁平台改造时，订单/费用域不要直接绑定“车辆”概念。当前 schema 中 `vehicleGroupSnapshot`、`assignedVehicleSnapshot`、`plateNo`、`mileage`、`fuelLevelPercent`、`batteryLevelPercent` 等字段是汽车租赁特化字段；改造成摄影器材、露营器材等通用租赁时，应抽象为 `AssetGroup`、`AssetInstance`、`AssetInspectionMetric` 和可配置检查项，同时保留订单、费用、资金、结算和月结账单的主结构。

## 共享类型

文件：`packages/shared/src/index.ts`

当前关键类型：

- SaaS：`TenantContext`、`TenantSummary`、`OrganizationSummary`。
- 权限：`SystemRoleRow`、`SystemUserRow`、`PermissionModule`、`SystemDataScope`。角色同时保存页面/菜单权限 `permissions`、按钮权限 `buttonPermissions` 和数据范围 `dataScope`。
- 系统参数：`SystemRulesConfig`、`SystemPushRule`、`SystemAiCallLog`。
- 平台治理：`PlatformFilterPreset`、`SavePlatformFilterPresetRequest`、`PlatformAuditLogRow`、`PlatformDictionaryGroup`、`PlatformNumberRule`。
- 规则：`StoreRentalRuleConfig`、`StoreRentalRuleVersionRecord`、`SaveStoreRentalRuleConfigRequest`。
- 定价：`PricingPlanSummary`、`PricingPlanDetail`、`PricingQuoteRequest`、`PricingQuoteResult`。
- 主数据：`StoreStationSummary`、`VehicleGroupMaster`、`VehicleInstanceSummary`、`StoreValueAddedServiceSummary`。
- 订单：`StoreRentalOrderSummary`、`StoreRentalOrderDetail`、`CreateStoreRentalOrderRequest`、`StoreRentalOrderActionResult`。
- 合同与单据：`StoreRentalContractRecord`、`StoreRentalContractCenter`、`StoreRentalContractCenterRow`、`StoreRentalContractTemplate`、`StoreRentalContractPrintResult`、`StoreRentalContractMockSignResult`。
- 订单备注与跟进：`StoreRentalOrderRemarkRecord`、`CreateStoreRentalRemarkRequest`、`CloseStoreRentalRemarkRequest`，覆盖内部备注、客户备注、回访/履约跟进、责任人、提醒时间和关闭状态。
- 费用中心：`StoreRentalFeeCenter`、`StoreRentalFeeLedgerItem`、`StoreRentalTransactionRecord`、`CreateStoreRentalFeeRequest`、`CreateStoreRentalTransactionRequest`、`WaiveStoreRentalFeeRequest`。
- 财务中心：`FinanceOverviewMetrics`、`FinanceTransactionRow`、`FinancePreAuthorizationRow`、`SaveFinancePreAuthorizationRequest`、`FinanceDocumentRow`、`FinanceDocumentAuditItem`、`SaveFinanceDocumentRequest`、`FinanceManualAdjustmentRow`、`SaveFinanceManualAdjustmentRequest`、`FinanceReconciliationRow`。
- 调度：`StoreRentalDispatchBoard`、`StoreRentalDispatchOrderRow`、`StoreRentalDispatchCandidate`、`StoreRentalDispatchPlan`、`StoreRentalDispatchResultRow`、`StoreRentalDispatchApplyResult`、`StoreRentalDispatchTaskPool`、`StoreRentalDispatchTask`、`StoreRentalDispatchEvent`。
- 订单留痕：`StoreRentalOrderOperationRecord`、`StoreRentalOrderNotificationRecord`。

后续通用化时不要直接删除这些类型，应新增通用类型并逐步映射。

## 接口契约

PF-18 第一版已落地为代码内契约，不引入额外 Swagger 依赖，避免把当前大量 TypeScript interface DTO 重写成装饰器类。

当前入口：

- 运行时文档：`GET /api/openapi.json`，返回原始 OpenAPI 3.0.3 JSON，不经过 `{ data, requestId }` 包装。
- 契约源：`apps/api/src/contracts/openapi-document.ts`，包含 `API_CONTRACT_OPERATIONS` 和 `OPENAPI_COMPONENT_SCHEMAS`。
- 校验脚本：`npm run contract:validate`，执行 `scripts/validate-api-contracts.cjs`。

校验内容：

- 扫描 `apps/api/src/modules/**/*.controller.ts` 的 Nest 路由装饰器，和契约清单逐项比对。
- 检查 OpenAPI paths 与契约清单一致，防止新增接口后漏补契约。
- 检查 `operationId` 唯一、`x-requiredPermissions` 存在、路径参数声明完整、schema `$ref` 指向有效组件。
- 当前已覆盖 169 个控制器操作，包含健康检查、认证、平台治理、系统用户/角色、门市租赁主数据、客户、订单、费用、调度、租赁规则版本和预留接口。

响应口径：

- 除 `/api/openapi.json` 外，运行时 API 响应仍由 `RequestIdInterceptor` 包装为 `{ data, requestId }`。
- OpenAPI 文档按这个包装口径描述 200 响应；原始契约端点单独返回 OpenAPI document，便于外部工具直接读取。
- 权限以 `x-requiredPermissions` 和 `x-permissionMode=any` 承载，和当前 `ApiAuthGuard` 的“任一权限命中”口径保持一致。

当前边界：

- 关键平台 DTO 已补字段级 schema；部分复杂业务 DTO 暂用 `type: object` + `additionalProperties` 占位，后续按高频接口逐步细化。
- 校验脚本当前做路由/契约一致性，不做请求样例的运行时回放；后续可以接前端 API client 生成、CI 检查和核心接口样例校验。

## API 权限

当前权限码：

```text
store-rental:rules:manage
store-rental:order:view
store-rental:order:operate
store-rental:order:settle
store-rental:order:create
store-rental:order:pickup
store-rental:order:return
store-rental:order:extend
store-rental:order:cancel
store-rental:order:close
store-rental:order:fee-manage
store-rental:dispatch:manage
store-rental:price:manage
store-rental:station:view
store-rental:station:manage
store-rental:vehicle-group:manage
store-rental:vehicle:view
store-rental:vehicle:manage
store-rental:vehicle:status-action
store-rental:member:view
store-rental:member:manage
store-rental:member:risk-action
store-rental:corporate:view
store-rental:corporate:manage
store-rental:corporate:monthly-settle
store-rental:service:manage
store-rental:report:view
system:user:manage
system:role:manage
system:params:manage
system:audit:view
system:dictionary:manage
system:number-rule:manage
system:tenant:bootstrap
system:button:export
system:tenant:manage
```

`ApiAuthGuard` 当前按路径匹配权限。后续接数据库时建议改为：

- 路由元数据装饰器，例如 `@RequirePermissions(...)`。
- 权限从数据库或缓存加载。

按钮级权限当前作为角色的 `buttonPermissions` 保存，登录时会与 `permissions` 合并到 `AuthUser.permissions`，便于前端统一用 `hasPermission` / `hasAnyPermission` 判断。后端 `ApiAuthGuard` 对关键写接口保留原有管理权限兼容，同时增加按钮权限码：

- 订单动作：新建、取车、还车、延长、取消/爽约、拒绝/关闭、结算。
- 合同与单据：合同中心和模板读取使用 `store-rental:order:view`；订单关联生成、打印/下载 mock、mock 签署使用 `store-rental:order:operate`。
- 订单备注与跟进：新增备注、回访/履约跟进和关闭待跟进使用 `store-rental:order:operate`；终态订单允许新增备注，但不改变订单主状态。
- 费用动作：新增费用、减免、登记收款/退款/月结。
- 会员动作：暂停、拉黑、恢复。
- 车辆动作：启停、调拨/位置流水、维保、事故/出险。
- 企业动作：企业月结回款。
- 系统动作：列表/报表导出。

数据范围当前取值为 `all`、`organization`、`store`、`own`，已经在角色和登录用户上承载，但内存 MVP 还没有按数据范围过滤查询结果。接 MySQL 和 repository 层时，应在查询层统一追加租户、组织、门市、本人条件，不能只依赖前端隐藏。

后续通用租赁改造时，建议把 `store-rental:*` 权限迁移成通用 `rental:*` 命名，汽车专有按钮只保留在门市汽车租赁插件/模块内；`dataScope` 可以继续复用。
- 平台管理员仍固定全权限。
- 在页面级和接口级权限之外，新增按钮级权限和数据权限任务已列入台账，应和角色模板、组织归属、租户初始化一起设计。

## 主数据闭环

当前主数据已从纯页面维护提升为后端校验驱动：

1. 站点列表：`GET /store-rental/stations`，带查询参数时返回 `StoreStationListResult`，无查询参数时兼容返回数组。
2. 站点层级：`GET /store-rental/stations/hierarchy`
3. 新增站点：`POST /store-rental/stations`
4. 编辑站点：`PUT /store-rental/stations/:id`
5. 站点营业日历：`GET/PUT /store-rental/stations/:id/calendar`
6. 站点容量快照列表：`GET /store-rental/stations/capacity-snapshots`
7. 站点容量快照刷新：`POST /store-rental/stations/capacity-snapshots/refresh`
8. 车型组列表：`GET /store-rental/vehicle-groups`
9. 新增车型组：`POST /store-rental/vehicle-groups`
10. 编辑车型组：`PUT /store-rental/vehicle-groups/:id`
11. 删除车型组：`DELETE /store-rental/vehicle-groups/:id`
12. 车辆列表：`GET /store-rental/vehicles`，带查询参数时返回 `VehicleListResult`，无查询参数时兼容返回数组。
13. 车辆详情：`GET /store-rental/vehicles/:id`
14. 新增车辆维保记录：`POST /store-rental/vehicles/:id/maintenance-records`
15. 新增车辆事故/出险记录：`POST /store-rental/vehicles/:id/accident-records`
16. 新增车辆：`POST /store-rental/vehicles`
17. 编辑车辆：`PUT /store-rental/vehicles/:id`
18. 车辆状态动作：`PATCH /store-rental/vehicles/:id/status`
19. 车辆调拨任务：`GET /store-rental/vehicles/transfer-tasks`、`POST /store-rental/vehicles/transfer-tasks`、`PATCH /store-rental/vehicles/transfer-tasks/:id`

系统参数接口：

1. 读取系统参数：`GET /platform/system-rules`
2. 保存参数分区：`PUT /platform/system-rules/:sectionKey`
3. AI 模型连接测试：`POST /platform/system-rules/ai-test`

平台治理接口：

1. 审计日志：`GET /platform/audit-logs`
2. 筛选预设列表：`GET /platform/filter-presets?scopeKey=store-rental.orders`
3. 保存筛选预设：`POST /platform/filter-presets`
4. 设为默认筛选预设：`PUT /platform/filter-presets/:id/default`
5. 删除筛选预设：`DELETE /platform/filter-presets/:id`
6. 数据字典列表：`GET /platform/dictionaries`
7. 保存数据字典：`PUT /platform/dictionaries/:code`
8. 编号规则列表：`GET /platform/number-rules`
9. 保存编号规则：`PUT /platform/number-rules/:code`
10. 编号试生成：`POST /platform/number-rules/generate`
11. 租户初始化模板：`GET /platform/tenant-bootstrap/preview`
12. 执行租户初始化：`POST /platform/tenant-bootstrap`

`sectionKey` 当前按原型保存按钮拆分为 `memberRegister`、`memberPoints`、`fleetMaintenance`、`fleetCleaning`、`calendarFixed`、`calendarSpecial`、`push`、`aiModel`。MVP 阶段系统参数仍在内存中保存；接 MySQL 后建议拆为 `system_rule_configs`、`system_push_rules`、`system_ai_model_configs`、`system_ai_call_logs`，并按租户保存版本和更新人。

筛选预设使用独立 `FilterPreset` 表，按 `tenantId + scopeKey + name` 唯一，`scopeKey` 当前限定为 `store-rental.orders`、`store-rental.vehicles`、`store-rental.members`、`store-rental.corporates`。保存、设默认、删除会写入 `OperationLog`；同一租户同一 scope 的默认预设由 service/repository 主动保持单选。营运端订单、车辆、会员和企业客户列表已接入同一套 API 与前端控件。后续改造成通用租赁平台时，建议把 scope 命名扩展为 `rental.orders`、`rental.assets`、`rental.members`、`rental.corporates` 或按租赁品类增加前缀，表结构和 service 逻辑可保持不变。

数据字典和编号规则当前复用 `SystemParameterSet`，模块分别为 `platform-dictionaries` 和 `platform-number-rules`。审计日志复用 `OperationLog`。后续如果字典/编号规则的版本发布、审批、回滚要求变复杂，再拆独立表；MVP 阶段优先保证租户级配置可持久化和可验证。

通用租赁改造时，`fleet.maintenance` 和 `fleet.cleaning` 不应继续固定为汽车保养/清洁，应迁移为通用“库存标的运维规则”：摄影器材可映射为检修、校准、清洁提醒，露营装备可映射为清洁、缺件、损耗检查提醒。

当前主数据校验规则：

- 站点：据点名称、所属门市必填；可用车位不能大于总车位；本期至少启用一个门市租赁服务能力；24H 自助启用时必须配置自助取还方式。
- 站点层级接口只返回全部、车行、门市三级范围节点，不返回据点节点；右侧据点列表负责展示、搜索、筛选和编辑。
- 站点营业日历支持设置营业/暂停/关闭、营业时间和当日容量上限；容量刷新会读取当日营业日历，关闭或暂停时可用车位为 0。
- 站点容量快照由车辆当前位置、订单取还车队列、站点车位和营业日历生成，返回可用车位、站内车辆、取车队列、还车队列、整备缓冲分钟、预计等待分钟、压力等级和压力原因。当前先用于站点详情页展示，后续接新建订单和调度冲突提示。
- 车型组：品牌、型号、门市产品组必填；车组标准价必须大于 0；免费里程和超程单价不能为负；删除前校验是否被车辆或订单引用。
- 车辆：车牌、车型组、当前门市必填；车牌和 VIN 唯一；VIN 为 17 位；当前服务类型必须包含在可服务类型内；空闲/已预约且启用的车辆必须位于已启用对应门市租赁能力的据点。
- 可用性和自动派车匹配已读取车辆启用状态、营运状态、服务类型和据点服务能力，不再只看车辆状态字段。
- 车辆详情接口返回车辆概况、关联订单、出入站流水、车况照片、维保记录、事故记录、车辆证照、随车物资和操作日志。设置 `STORE_RENTAL_DATA_SOURCE=mysql` 后，车辆主表、车辆位置流水表、车况照片表、维保表、事故表、证照表、随车物资表和车辆操作日志已走 MySQL；订单关联记录仍来自当前订单内存数据。
- 已新增 `POST /store-rental/vehicles/:id/location-events`，支持营运端在车辆详情页补录取还车、调拨、人工调整和车机同步流水。当前写入内存 map，并在记录时间晚于当前最近操作时间时回写车辆当前位置、里程、最近操作人和最近操作时间。
- 已新增 `PATCH /store-rental/vehicles/:id/location-events/:recordId`，支持编辑人工补录和调拨流水。当前会校验门市/站点归属、里程合法性，并对 `transfer` 类型增加“履约中订单阻断调拨”的基础校验。
- 车辆调拨任务创建后保持 `pending`，前端通过 `PATCH /store-rental/vehicles/transfer-tasks/:id` 推进 `approve`、`depart`、`arrive`、`cancel`。`approve` 会把可调拨车辆转入 `controlled` 管控并二次校验履约中订单占用；`arrive` 才回写车辆当前门市/据点、服务类型、位置流水、操作日志和站点容量快照。
- 已新增 `POST /store-rental/vehicles/:id/condition-photos`，支持在车辆详情页补录车况照片记录。MySQL 模式下照片记录已落 `VehicleConditionPhotoRecord`，但照片本身仍是 URL 字符串；后续附件中心完成后，应改为附件表 + 引用关系。
- 已新增 `GET/PUT /store-rental/vehicles/:id/credentials` 和 `GET/PUT /store-rental/vehicles/:id/onboard-items`，支持车辆证照与随车物资列表和保存。车辆详情页已新增“证照与物资”页签，证照支持类型、编号、状态、签发/到期、提醒天数和附件地址预留；随车物资支持类别、标准/实际数量、缺失/损坏状态、赔付金额和盘点时间。后续附件中心完成后，证照附件应从 URL 字符串迁为统一文件资产引用。
- 新增维保记录会写入 `vehicleMaintenanceRecords`，处理中/待处理记录会把非租赁中车辆切到 `maintenance`，并追加“新增维保记录”操作日志。新增事故/出险记录会写入 `vehicleAccidentRecords`，未结案记录会把非租赁中车辆切到 `controlled`，并追加“新增事故/出险记录”操作日志。MySQL 模式下记录表、车辆当前状态和 `OperationLog` 已同步写入；后续要进一步收敛为显式事务和完整状态变更历史表。
- 已新增维保记录更新接口和事故记录更新接口。当前支持把维保记录标记完成、把事故/出险记录标记结案，并根据是否仍存在未完成维保/未结案事故自动把车辆状态在 `maintenance`、`controlled`、`idle` 之间回写。MySQL 模式下该状态回写已接 repository；后续要补完整的状态变更历史表。
- 前端车辆详情头部已增加占用排程提示，当前根据 `relatedOrders` 中未释放库存的订单状态做前端计算，展示“当前占用/未来占用”卡片。接 MySQL 后建议把这块下沉为后端统一 occupancy summary，避免前端自行推导状态。

## 订单闭环

当前 MVP 订单闭环：

1. 规则配置：`GET/PUT /store-rental/rules`
2. 价格计划：`GET /store-rental/pricing/plans`
3. 报价试算：`POST /store-rental/pricing/quote`，当前会返回价格版本、行销方案、会员等级权益、费用项、折扣来源、分段计费和快照字段。
4. 资源可用性：`POST /store-rental/availability`
5. 创建订单：`POST /store-rental/orders`
6. 订单列表：`GET /store-rental/orders`
7. 订单详情：`GET /store-rental/orders/:id`
8. 订单动作：`POST /store-rental/orders/:id/actions/:action`
9. 费用中心：`GET /store-rental/orders/:id/fees`
10. 新增费用：`POST /store-rental/orders/:id/fees`
11. 费用减免：`POST /store-rental/orders/:id/fees/:feeId/waive`
12. 登记资金流水：`POST /store-rental/orders/:id/transactions`
13. 调度看板：`GET /store-rental/dispatch/board`
14. 调度任务池：`GET /store-rental/dispatch/tasks`
15. 调度事件：`GET /store-rental/dispatch/events`
16. 智能优化预览：`POST /store-rental/dispatch/optimize`
17. 应用优化结果：`POST /store-rental/dispatch/apply`
18. 取车前硬锁：`POST /store-rental/dispatch/hard-lock`
19. 调度页人工改派：`POST /store-rental/dispatch/manual-reassign`
20. 财务总览：`GET /store-rental/finance/overview`
21. 财务资金流水：`GET /store-rental/finance/transactions`
22. 预授权押金台账：`GET/POST/PUT /store-rental/finance/pre-authorizations`
23. 发票/收据：`GET/POST/PUT /store-rental/finance/documents`
24. 手工调账：`GET/POST /store-rental/finance/manual-adjustments`
25. 调账审核入账：`POST /store-rental/finance/manual-adjustments/:id/process`
26. 财务对账：`GET /store-rental/finance/reconciliation`

发票/收据实现口径：

- `FinanceDocument` 保留订单、会员、企业和月结账单快照字段；本轮新增 `relatedFeeIds`、原单/替换单号、作废原因/处理人、重开时间和 `auditTrail`，用于支撑费用级关联、单据重开和操作留痕。
- 财务结算页“发票收据” Tab 支持录入多个费用 ID、查看最近审计动作、查看“重开自/已重开为”链路，并可对非草稿单据执行重开。重开会创建新单据，同时把原单置为 `voided`，记录作废原因和替换单号。
- MySQL 模式下以上字段落 `FinanceDocument` 结构化列；旧扩展信息仍兼容 `metadata`。当前不直接接发票平台 SDK，真实开票、红冲、作废同步继续走后续 `InvoiceAdapter`。

当前支持的动作：

- `payment-success`
- `start-pickup`
- `pickup-inspection`
- `extend-rental`
- `return-inspection`
- `confirm-settlement`
- `mark-no-show`
- `reject-order`
- `close-order`
- `cancel`

后端会校验状态机，不允许跨状态误操作：

| 动作 | 允许状态 | 结果 |
| --- | --- | --- |
| `payment-success` | `pending_payment` | `reserved` |
| `start-pickup` | `reserved`、`pickup_overdue` | `inspecting`，创建取车操作锁 |
| `pickup-inspection` | `inspecting` | `renting`，释放操作锁并锁定车辆 |
| `extend-rental` | `renting`、`renewing` | `renewing`，更新预计还车时间，生成“续租租金”费用项 |
| `extend-rental` | `overdue` | `renewing`，按补办续租处理，必须通过收款/风控校验 |
| `return-inspection` | `renting`、`renewing`、`overdue`、`accident_processing` | `settlement_pending` |
| `confirm-settlement` | `settlement_pending` | 按 `balanceDue` 进入 `payment_due`、`refund_pending` 或 `completed` |
| `confirm-settlement` | `payment_due`、`refund_pending` | 收款/退款处理完成后进入 `completed` |
| `redirect-order` | `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing` | 主状态保持不变；更新绑定车辆、派车状态、目标/原车辆状态、风险标记、改派费用和订单时间线 |
| `change-return-store` | `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing` | 主状态保持不变；更新订单当前还车门市、returnStationId/快照、风险标记、调度费差额和订单时间线 |
| `change-return-station` | `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing` | 主状态保持不变；同门市换据点不收费，跨门市据点按门市口径计算差额 |
| `register-accident` | `renting`、`renewing`、`overdue`、`accident_processing`、`settlement_pending`、`payment_due`、`refund_pending`、`completed` | 履约中进入 `accident_processing`；结算中和已完成保持主状态；写车辆事故记录、事故费用、订单时间线和车辆受控状态 |
| `mark-no-show` | `pickup_overdue` | `no_show`，校验已超过保留时长，释放库存，生成爽约费 |
| `reject-order` | `inspecting` | `rejected`，取车资质不通过时释放操作锁和库存，可录入拒绝履约费用 |
| `close-order` | `pending_payment`、`reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing` | `closed`，客户无责关闭，客户自付全额退款并释放预授权，企业月结不生成账单 |
| `cancel` | `pending_payment`、`reserved`、`pickup_overdue` | `cancelled`，按取消规则生成取消费、减免、退款或月结记录 |

取车/还车动作会写入 `inspectionRecords`；结算动作会写入 `settlementSummary`。`settlementSummary.balanceDue` 按 PRD 区分客户待补缴、待退款和企业月结挂账，企业月结订单不进入客户补缴/退款状态。后续通用租赁改造时，这两块应迁移为领取/归还检查记录和通用结算汇总。

费用中心接口不只返回页面展示数据，还会更新后端内存中的订单财务数据：

- 新增费用：写入费用台账；企业月结订单会同步生成月结资金记录。
- 延长用车：写入 `stage=rental`、`code=extension_rent` 的系统费用项；立即收款写入 `payment` 资金记录，还车时结算保持待处理，企业月结不生成客户收款交易。
- 改派：同车组默认不产生费用；升级/降级按差价写入 `redirection_fee` 或 `redirection_refund`，免费升级不生成费用但必须填写原因；取车前差价进入取车尾款，履约中差价进入还车结算，企业月结订单以 `monthly_billing` 费用项进入后续账单。
- 改还车门市/据点：按取车门市到原/新还车门市的异地还车费计算差额，写入 `return_store_change_fee` 或 `return_store_change_refund`；同一还车门市下换据点不收费，企业月结订单以 `monthly_billing` 费用项进入后续账单。
- 取消/爽约/拒绝履约/关闭：终止类订单会将原基础租金和服务费置为 `voided`，再按 PRD 生成 `cancellation_fee`、`no_show_fee`、`rejection_fee`、`close_refund`；客户自付订单优先写入预授权扣款/释放和退款流水，企业月结订单只把责任费用进入月结，关闭订单不进入月结。
- 事故登记：写入车辆事故记录和订单时间线；客户责任、第三方责任或责任待定且预估费用大于 0 时生成 `accident_damage`，已完成订单补录生成 `accident_post_charge`。企业月结已完成订单补录事故费用时立即写成功 `monthly_bill` 交易；未完成月结订单仅以 `monthly_billing` 费用项进入后续还车月结。客户自付已完成订单补录事故费用时主状态保持 `completed`，支付状态标记为待补缴。
- 费用减免：写入减免资金记录；还车结算费用会同步影响 `settlementSummary.discountAmount`、`transactionAmount` 和 `balanceDue`。
- 登记资金流水：支持收款、退款、月结登记；当订单处于待补缴或待退款时，登记成功会推动订单进入完成状态并释放车辆。
- 所有费用动作会追加订单 `timeline`，后续接 MySQL 时应迁移为独立财务流水和操作审计表。

延长用车实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/订单/延长用车.md`，只允许 `renting`、`renewing`、`overdue` 执行；弹窗打开/关闭不改状态、不改时间、不生成费用。
- 后端确认时校验新还车时间必须晚于当前预计还车时间，并校验当前车牌从旧还车时间到新还车时间加 `pickupReturn.turnaroundMinutes` 的库存冲突；规则默认值为 60 分钟。
- 当前内存 MVP 还没有完整订单计费快照表，续租费用先按订单基线租金和租期反推日租口径生成，费用项 `snapshotRef` 使用 `extension:<orderNo>:<timestamp>` 保留事件级快照引用；后续接 MySQL 时应拆出 `order_extension_snapshots` 表保存新增计费时段、价格版本、营销版本、规则版本、试算结果、结算方式和操作时间。
- 客户自付订单在逾期补办、延长超过 24 小时、续租金额超过 1000 元或存在黑名单/证件异常/高风险标记时必须选择立即收款并确认收款成功；企业月结订单不发起客户收款，费用进入企业账单。
- `settlementSummary.finalReceivableAmount` 会随续租费用增加；立即收款同步增加已处理金额，还车时结算保持待收，企业月结进入 `monthlyBillAmount`。

改派实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/订单/订单改派.md` 和 `order_detail.html`，订单详情提供“订单改派 & 车辆升级”弹窗，包含当前车辆、手动选择/系统推荐、车组筛选、候选车辆、差价试算、差价处理方式、改派原因和备注。
- 后端动作 `redirect-order` 只允许 `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing` 执行；改派不改变订单主状态，只改变绑定车辆、派车状态、费用明细、车辆状态和操作记录。
- 目标车辆必须启用且空闲，不能与当前车牌相同，不能跨车行，并会校验订单租期内目标车辆是否已有占用冲突；已有未处理费用时必须管理员覆盖并填写备注。
- 同车组改派不产生价格差异；跨车组按订单原租期或履约剩余时段计算差价。`priceHandling=diff` 生成 `redirection_fee`/`redirection_refund`，`priceHandling=free` 仅允许正向升级且必须填写免费升级原因。
- MySQL 模式下，改派会通过 repository 更新订单绑定车辆和车型组快照、写入费用项、订单时间线、原车辆释放状态和目标车辆占用状态。当前还没有独立 `order_dispatch_events` 表，后续订单快速改派和完整调度审计仍需继续开发。
- 通用租赁平台改造时，把“车辆改派”抽象成 `AssetInstanceReplacement`。车牌、车组、里程、油电量是汽车字段；摄影器材/露营器材等品类应替换为资产实例、资产组、检查指标和可配置替换费用规则。

调度实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/智能调度派车规则.md`、`智能调度派车算法.md` 和 `营运端/dispatch.html`，营运端新增 `/dispatch` 车辆排程看板，页面包含日/周/月视图、门市/车型组筛选、车辆甘特排程、待处理调度队列、订单抽屉、车辆抽屉、智能优化弹窗和 AI 分析预留。
- 后端调度 API 不在订单创建时锁具体车辆；订单创建仍只锁车组库存。`/dispatch/optimize` 只生成预览方案，`/dispatch/apply` 经人工确认后才写入 `pre_assigned` 预分配车辆。
- 自动/手动批量优化只纳入 `mainStatus=reserved` 且 `dispatchStatus=pending|pre_assigned` 的订单；`locked`、`manual_reassigned`、`upgraded`、临近取车保护、待支付、履约中、事故处理中、终止状态等订单会返回跳过原因。
- 候选车辆过滤遵循 PRD 硬约束：车辆启用、非受控/维保/停用、同车行、不跨门市调度、同车组、当前门市匹配取车门市、服务类型匹配、据点能力可交付、订单时段加整备缓冲不冲突。AI 分析只能在候选池内给建议，不能绕过硬约束。
- 优化排序当前按 PRD 口径实现：占用时长长优先、订单金额高优先、取车时间早优先、创建顺序早优先；评分以车型组日租价近似机会成本，后续如果补车辆月成本、调拨成本和历史利用率，应替换为 PRD 算法中的完整成本项。
- `/dispatch/hard-lock` 用于取车前硬锁具体车辆：已有预分配且仍满足约束时保持原车硬锁，否则重新匹配；无可用车时把订单置为 `dispatch_manual_required` 并进入人工调度队列。
- `/dispatch/manual-reassign` 是调度页轻量入口，只处理已预订或逾期未取订单，确认时仍复用同车行、车辆状态、时段冲突和服务能力校验；更复杂的差价、免费升等、企业月结调增/调减继续走订单详情的 `redirect-order` 改派流程。
- `/dispatch/tasks/close` 用于调度员关闭已确认处理的任务。后端写入 `alert_closed` 调度事件，事件 payload 保存 `taskKey=orderId:taskType`；任务池实时派生时读取最近关闭事件并过滤对应任务，调度页右侧任务卡片提供“关闭任务”入口。
- MySQL 模式下，调度 API 通过现有 repository 读取订单、车辆、车型组和站点，并写回订单绑定车辆、派车状态、车辆状态和订单时间线。已新增 `DispatchEvent` 表和 migration，repository 先用 raw SQL 写入/查询调度事件，避免当前开发服务占用 Prisma Client DLL 时阻断构建。当前任务池从订单、车辆有效性、派车状态、临近硬锁和最新事件实时派生，还没有独立任务状态表；后续 DP-04 应补认领、关闭、处理状态、数据权限过滤和任务报表。
- 调度事件当前覆盖：智能优化预览、应用优化成功、应用优化失败、硬锁成功、硬锁失败、调度页人工改派。PRD 中 AI 分析请求日志、AI 推荐采纳结果、调度告警关闭、车辆释放和完整改派链路仍需继续补齐。
- 通用租赁平台改造时，把“调度派车”抽象为 `AssetDispatch`。车辆、车牌、车型组、门市车辆整备缓冲是汽车租赁字段；摄影器材、露营器材等品类应迁移为资产实例候选池、领取/归还地点能力、整备/清洁缓冲、库存实例冲突和可配置评分规则。

改还车门市/据点实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/订单/订单还车.md` 和 `order_detail.html`，订单详情提供“改还车门市 / 转单”和“改还车据点”入口，弹窗展示取车门市、当前还车门市/据点、新目标、变更原因、备注、当前异地费、新异地费和本次差额。
- 后端动作 `change-return-store`、`change-return-station` 允许状态与 PRD 一致：`reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing`；确认后订单主状态保持不变。
- 目标门市/据点必须启用、服务状态正常、具备当前订单服务能力，且本期只支持同车行。若原还车门市存在占用当前车辆的后续预约/待取车/锁车订单，前端按原型展示“原还车门市存在后续预约”冲突卡片；冲突未处理时后端阻断确认，点击“快捷改派后续订单”后会随当前转单提交解析标记和候选车辆。
- 快捷改派后续订单复用 `redirect-order` 的核心规则：后端会为后续订单匹配同车组或可升级的空闲车辆，检查启用状态、服务类型、同车行、目标时段无其他订单占用、同车组或价格不低于原车组；即使前端传入候选车，后端也会重新做排程和车组价格校验。成功后释放后续订单对原车辆的预约占用，但原车辆仍按当前订单状态保持占用，并更新后续订单车辆/车型组快照、费用项、结算汇总和时间线。
- 费用按“新异地还车费 - 旧异地还车费”计算；差额为正生成 `return_store_change_fee`，差额为负生成 `return_store_change_refund`。客户自付订单不强制转单时收款，差额进入取车尾款或还车结算；企业月结订单进入后续月结。
- MySQL 模式下，`updateOrderState` 会同步 `returnStationId`、`returnStoreSnapshot`、费用项、结算汇总和订单时间线；若触发后续预约快捷改派，还会同步后续订单绑定车辆、费用、结算、时间线以及原/目标车辆状态。当前还没有独立转单事件表，后续应接 `order_dispatch_events` 或 `order_return_location_change_events`，并在调度页展示完整链路。
- 通用租赁平台改造时，把“还车门市/据点”抽象为 `ReturnLocation` 或 `FulfillmentLocation`，把异地还车费抽象为跨地点履约费；摄影器材、露营器材等品类可以复用“地点变更差额 + 履约权限转移 + 后续占用冲突”的模型。

事故出险实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/订单/事故出险处理.md` 和 `order_detail.html`，订单详情“更多操作”提供事故登记入口，`accident_processing` 状态显示为“处理事故”。
- 后端动作 `register-accident` 必填事故描述和责任归属；事故时间默认当前时间但前端弹窗按原型提供可编辑时间。
- `renting`、`renewing`、`overdue` 登记事故后进入 `accident_processing`；`accident_processing` 追加事故记录时状态保持；`settlement_pending`、`payment_due`、`refund_pending` 和 `completed` 登记事故时主状态保持不变。
- 车辆联动当前第一版先将未结案事故车辆转入 `controlled`。PRD 中“事故导致后续订单解除占用、自动改派或进入人工调度队列”的强联动尚未完成，后续应落到调度事件表和人工调度任务池。
- 通用租赁平台改造时，不要把事故域写死为汽车事故。建议抽象为 `AssetIncidentRecord`、`incident_fee`、`post_charge` 和可配置责任归属/处理状态；车辆字段如车牌、里程、油电量、维修/停运应迁移成具体资产类型的检查项和状态动作。

取消、关闭和爽约实现口径：

- 依据 `02_PRD与产品文档/PRD与方案/门市租赁/订单/取消与关闭订单.md`，终止类动作执行后会释放车辆、派车状态和操作锁；历史派车关系暂保留在订单时间线和费用/流水记录中，后续接 MySQL 时应拆出 `order_operation_logs`、`order_dispatch_events` 和 `order_terminal_actions`。
- 取消订单只允许 `pending_payment`、`reserved`、`pickup_overdue`；待支付取消或免费取消不收费，有责取消按当前规则快照计算取消费，支持特殊减免。
- 标记爽约只允许 `pickup_overdue`，并校验当前时间已超过取车时间加 `noShow.vehicleHoldHours`；费用代码为 `no_show_fee`。
- 拒绝履约只允许 `inspecting`，费用由门店按资质/风控结果手工录入，费用代码为 `rejection_fee`；后续分步取车向导完成后，应把入口移入取车资质核验步骤。
- 关闭订单用于客户无责异常关闭；客户自付订单写入 `close_refund` 和退款流水，企业月结订单不生成企业账单。通用租赁改造时，“车辆资源释放”要替换为对应品类库存实例释放，“预授权”要抽象为保证金/押金/冻结额度。

订单备注与跟进实现口径：

- 依据 `订单详情.md` 和 `order_detail.html`，备注入口对全部订单状态开放，终态订单允许新增备注但不改变订单主状态。
- 备注/跟进记录使用 `OrderRemarkRecord`：`category` 区分内部备注、客户备注、回访记录、履约跟进、取车/还车/费用/风险和客户跟进；`visibility` 区分内部与客户可见；`responsibleName`、`followUpAt`、`reminderAt` 支撑责任人、跟进时间和提醒时间。
- 订单详情“通知与跟进”区域展示全部备注/跟进记录，待跟进记录可关闭；关闭动作写入 `status=closed`、`closedAt`、`closedBy`、`closeNote`，同时追加订单时间线，但不触发费用、车辆或主状态变化。
- MySQL 模式下新增和关闭分别走 `POST /store-rental/orders/:id/remarks`、`PATCH /store-rental/orders/:id/remarks/:remarkId/close`，内存模式保持同样 DTO 和行为。提醒时间当前只作为可查询字段保存，后续接 `PF-12` 通知中心或 `PF-16` 定时作业时再触发站内信/短信。
- 通用租赁平台改造时，该模型可保留为订单级 `OrderFollowupRecord`；汽车专有上下文只应留在内容和分类展示文案里，不应把车牌、门市、事故等字段写死进备注主表。

这些动作后续应迁移为通用履约动作：

- 支付成功。
- 领取检查完成。
- 归还检查完成。
- 结算确认。
- 取消。

`/store-rental/availability` 是后续通用租赁改造的关键接口。当前返回车组可用数量，未来应改造成库存标的可用性：

- 汽车：车型组、车辆实例、取还门店、车辆状态。
- 摄影器材：器材组、器材实例、领取/归还网点、维修/在租状态。
- 露营器材：套装组、具体套装/组件库存、清洁/损耗状态。

## 外部集成边界

当前接口只返回 mock：

- `GET /store-rental/integrations`
- `GET /store-rental/client-endpoints`

后续真实接入时应保持业务服务不直接依赖供应商 SDK，而是通过 adapter：

- `PaymentAdapter`
- `InvoiceAdapter`
- `NotificationAdapter`
- `FileStorageAdapter`
- `IotAdapter`
- `MapAdapter`
- `AiDispatchAdapter`

这块以 mock 和预留接入为主，台账对应 `INT-01`。独立营运端入口曾短暂下线，已按用户要求恢复为原来的入口和页面状态；后续新增/变更仍需记录 PRD/原型依据和用户确认。同时配套的平台底座还包括：

- `PF-11` 租户初始化：默认角色/参数/菜单模板和租户级配置。
- `PF-12` 通知预留：短信/邮件/站内消息模板、触发规则、mock 发送日志只作为业务页面通知留痕的底层接口。
- `PF-13` 导入导出/打印预留：Excel 导入导出、模板下载、PDF/打印只在订单、合同、列表等已有 PRD/原型页面中接入。

当前 infra-adapters 分支已新增统一基础设施接口，相关独立营运端页面已按用户要求恢复：

- `GET /integrations/dashboard`：返回附件、通知、adapter 日志、异步任务、打印任务、TBox 台账和导入导出模板；仅作接口预留。
- `GET /files`：返回附件元数据，支持按 `businessModule/businessType/businessId/uploadScene/status/limit` 查询对象附件。
- `POST /store-rental/corporates/:id/contracts/:contractId/attachments`：为真实企业合同创建 mock 附件元数据，写入 `FileAsset.businessType=corporate_contract`、`businessId=contractId`，并回写企业合同 `attachments` 文件名列表。
- `GET /store-rental/corporates/:id/contracts/:contractId/attachments`：按企业合同读取附件元数据。
- `GET /integrations/data-exchange/templates`：返回数据交换模板，当前覆盖服务站点、车辆档案、个人会员、企业客户、门市订单导出，以及会员导入校验。
- `POST /integrations/data-exchange/jobs`：创建数据交换任务。后端写入 `AsyncJob`，payload 保存模板编码、目标对象、筛选快照、导入模式和 mock 文件名，并写入 `ExternalAdapterLog`。
- `POST /jobs/:id/run`：手动执行任务。若任务为 `data_export` 或 `data_template_download`，会创建导出/模板 `FileAsset` 元数据；若任务为 `data_import_validate`，会创建导入校验报告 `FileAsset` 元数据。
- `POST /jobs/print`：生成 mock 打印/合同单据，写入 `DocumentPrintJob` 和对应 PDF `FileAsset` 元数据。

PF-13 当前数据边界：

- 不新增独立导入导出表，复用 `AsyncJob`、`FileAsset` 和 `ExternalAdapterLog`，因此 `INFRA_DATA_SOURCE=mysql` 下可落 MySQL。
- MVP 不解析真实 Excel，不生成真实二进制文件，不写入站点、车辆、会员、企业客户、订单业务主表。
- 真实接入时优先从已有 PRD/原型页面进入，例如订单详情、合同与单据、车辆/会员/企业客户列表；独立“附件与打印中心”或“外部接入与任务”页面已恢复，但后续扩展必须补业务依据。

PF-15 当前数据边界：

- 企业合同附件第一片不做真实 multipart 上传，不生成二进制文件；前端只在企业详情合同场景保留 mock PDF 附件元数据，不保留独立附件中心入口。
- 统一附件引用以 `FileAsset.businessModule/businessType/businessId` 承载，本轮企业合同固定为 `store_rental/corporate_contract/:contractId`。
- `CorporateContract.attachments` 继续保留文件名数组，作为企业合同台账列表展示字段；真实附件明细、存储 key、mock 下载 URL 和上传人落 `FileAsset`。
- 设置 `INFRA_DATA_SOURCE=mysql` 后，附件元数据走 Prisma/MySQL；未设置时使用内存数据，仍会写 `ExternalAdapterLog` 标记 `mock-file-storage-adapter`。
- 后续真实接入点是 `FileStorageAdapter`：对象存储上传、签名 URL、访问控制、病毒扫描、清理 job、下载鉴权和电子签署回存。

## MySQL 落库建议

当前 Prisma schema 已扩展为 MySQL 主干模型。平台底座已完成 repository 和 `PLATFORM_DATA_SOURCE=memory|mysql` 切换；门市租赁的站点、车辆和客户域已完成 `STORE_RENTAL_DATA_SOURCE=memory|mysql` 第一版切换。schema 已覆盖：

- 平台底座：租户、组织、用户、多角色、角色权限、权限码、系统参数集、筛选预设、平台审计日志、数据字典配置、编号规则配置。
- 门市租赁主数据：履约站点、站点营业日历、站点容量/排队快照、车型组、车辆实例、车辆位置流水、车况照片、维保记录、事故/出险记录、车辆调拨任务、车辆证照、随车物资、TBox 台账和指令记录。
- 客户域：会员、会员风控事件、会员时间线、客户等级方案、企业客户、联系人、合同、企业月结账单。
- 规则与订单域：租赁业务规则版本、订单、合同/交接单/结算单、取还车检查记录、履约时间线、续租快照、费用项、资金记录、预授权押金台账、发票/收据、人工调账、订单操作记录、客户通知记录、订单备注/跟进、操作锁、幂等记录、企业月结明细。

下一阶段建议按下面顺序推进真实数据层：

1. 平台基础数据已完成第一版：租户、组织、账号、角色、按钮权限、数据范围、系统参数、数据字典、编号规则、审计日志和租户初始化。
2. `StoreRentalRepository` 已完成第一版：租赁业务规则版本、站点、站点营业日历、站点容量/排队快照、车型组、车辆主数据读写；站点列表已补 `StoreStationListQuery/StoreStationListResult`，营运端可按关键字、服务能力、服务状态、据点状态和车行/门市范围分页查询；车辆列表已补 `VehicleListQuery/VehicleListResult`，营运端可按车牌/VIN、营运状态、服务类型、当前位置分页查询；旧数组调用继续兼容订单、调度、TBox 和调拨。
3. 服务层逐步只调用 repository，不直接操作数组。
4. 门市租赁主数据事件已完成第一版：车辆位置流水、车况照片、维保记录、事故/出险记录、车辆操作日志。
5. 客户域已完成第一版：会员、客户等级方案、企业客户、企业联系人、企业合同；会员列表已补 `MemberListQuery/MemberListResult`，内存模式和 MySQL 模式都支持关键字、状态、审核状态、标签、分页和筛选统计；客户等级方案已接入报价权益，后续通用租赁改造时可把“会员等级”抽成“客户分层/权益方案”，折扣对象从车辆租金和押金替换为设备租金、押金、耗材或服务包；企业客户列表已补 `CorporateListQuery/CorporateListResult`，内存模式和 MySQL 模式都支持企业简称/全称关键字、企业状态、合同状态、分页和筛选统计。
6. 最后迁订单域：订单、费用中心、资金记录、订单状态流转、操作日志、照片和附件。迁移时要把新建订单当前的内存写入改成 `StoreRentalOrder`，并把企业月结从派生结果改成账单表、明细表和回款表。

不要把 MySQL 表直接按页面字段堆出来，优先按领域建模：

- 租户。
- 组织。
- 用户。
- 角色。
- 权限。
- 租赁标的分组。
- 库存实例。
- 履约地点。
- 价格计划。
- 规则版本。
- 订单。
- 订单快照。
- 检查记录。
- 调度事件。
- 操作日志。

当前 schema 校验命令：

```powershell
$env:DATABASE_URL='mysql://root:password@localhost:3306/rimo_store_rental'
npx prisma validate --schema apps/api/prisma/schema.prisma
```

当前已补 seed 与根脚本：

- `apps/api/prisma/seed.ts`
- `npm run db:generate`
- `npm run db:validate`
- `npm run db:migrate`
- `npm run db:seed`
- `docs/DATABASE_BOOTSTRAP.md`
- `apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql`
- `apps/api/prisma/migrations/20260608000200_add_dispatch_events/migration.sql`
- `apps/api/prisma/migrations/20260609000200_station_capacity_queue/migration.sql`
- `apps/api/prisma/migrations/20260609000200_add_finance_pre_authorizations/migration.sql`
- `apps/api/prisma/migrations/20260609000300_add_finance_document_reissue_links/migration.sql`
- `apps/api/prisma/migrations/20260609000100_add_order_operation_notification_records/migration.sql`
- `apps/api/src/modules/platform/platform.repository.ts`
- `apps/api/src/modules/store-rental/store-rental.repository.ts`

注意：`db:seed` 初始化的是可验证基础数据。平台模块可通过 `PLATFORM_DATA_SOURCE=mysql` 使用这些数据，包含登录、用户、角色、系统参数、数据字典、编号规则和平台审计；租赁业务规则保存/历史版本、站点分页列表、站点营业日历、站点容量/排队快照、车型组、车辆分页列表/详情事件、车辆调拨、车辆证照、随车物资、TBox、会员列表分页/详情/审核/风控、客户等级方案、企业客户列表分页/详情、订单、费用、检查记录、资金流水、预授权押金台账、发票/收据、手工调账、续租、改派、改还车门市/据点、终止动作、事故登记、调度事件、订单操作记录、客户通知记录和企业月结账单可通过 `STORE_RENTAL_DATA_SOURCE=mysql` 使用这些数据。

`PlatformRepository` 已覆盖租户、组织、权限树、角色、用户、系统参数、平台审计、筛选预设、数据字典、编号规则和租户初始化的基础读写和 DTO 映射。`PlatformService` 已增加 `PLATFORM_DATA_SOURCE=memory|mysql` 开关。`StoreRentalRepository` 已覆盖租赁业务规则版本、站点、站点营业日历、站点容量/排队快照、车型组、车辆基础读写、站点/车辆列表分页筛选、车辆详情事件、车辆调拨、车辆证照、随车物资、TBox、客户域、会员/企业客户列表分页筛选、订单域、费用/资金、预授权押金台账、发票/收据费用关联、重开链路、手工调账、检查记录、时间线、续租快照、改派动作、改还车门市/据点动作、转单后续预约快捷改派一期、事故记录、调度事件、订单操作记录、客户通知记录和企业月结基础读写，并通过 `metadata` JSON 保留原型扩展字段。下一步迁事故后续订单联动、统一审计、通知模板和完整幂等。

操作锁、幂等和通知留痕实现口径：

- 订单关键动作进入 `runOrderAction/runMysqlOrderAction` 时会生成稳定请求摘要；同一订单、同一动作、同一幂等键或请求摘要已完成时，直接返回已保存的动作结果，防止重复提交造成重复收费、重复状态推进或重复通知。
- `start-pickup` 继续创建取车操作锁；`pickup-inspection` 和 `reject-order` 必须持有未过期的有效操作锁，且默认只能由持锁操作人提交，管理员覆盖需显式传 `overrideOperationLock=true`。
- 操作记录落 `OrderOperationRecord`，包含动作、请求摘要、幂等键、锁状态、操作人、完成状态、结果摘要和过期时间；内存模式保留最近 80 条。
- 客户通知留痕落 `OrderNotificationRecord`，当前为 mock 短信发送记录，覆盖支付、取车、续租、改派、改还车、还车、结算、事故、取消/爽约/拒绝/关闭等动作；同时追加订单时间线，保证现有订单详情页能看到发送状态。

## 开发约定

- 原型和 PRD 只读，不要改。
- 页面复刻以原型为准，当前系统顶栏可按实际系统统一。
- 字体使用：`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`。
- 后端新增接口必须经过 `ApiAuthGuard`。
- 前端新增页面必须配置 `route.meta.permission`。
- 新增共享类型必须先考虑后续通用租赁映射。
- 新增 mock 集成必须在文档标注真实接入点。

## 后续开发优先级

当前基础框架已覆盖登录、租户、用户、角色、权限。下一阶段业务功能优先级：

1. 完善主数据：站点、车型组、车辆、增值服务的校验、筛选、状态流转。
2. 接 MySQL：平台底座、门市租赁主数据、客户域、订单/费用/资金/检查/续租/改派/改还车/转单快捷改派/终止/事故/月结已完成第一版，继续迁事故后续订单联动、统一审计和幂等。
3. 补系统参数、权限深化和租户初始化；通知、导入导出、打印、附件、异步任务和 adapter 层已恢复历史入口，后续扩展必须依附明确 PRD/原型业务页面或记录用户确认。
4. 补会员、客户等级方案和企业客户：页面和真实后端接口已完成第一版，会员列表和企业客户列表分页筛选已完成，客户等级权益已接入个人订单报价；继续补附件、审核材料、风控规则、等级自动升级和权益核销。
5. 补车辆调拨、车务看板、合同与单据增强、TBox 设备台账，完善营运侧真实操作闭环。
6. 完善定价：价格版本、车型组价格、异店还车费、增值服务联动。
7. 完善新建订单：资源可用性、报价快照、客户/企业信息、预授权 mock。
8. 完善订单详情：时间线、费用明细、快照、取还车动作、结算动作。
