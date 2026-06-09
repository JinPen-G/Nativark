# RIMO 门市租赁平台 AI 交接说明

更新时间：2026-06-10

本文用于把当前门市租赁 MVP 工程转交给其他 AI 或开发者继续做。接手方应先读本文，再读开发台账和技术文档。

## 1. 当前工程位置

主工程目录：

```text
D:\工作文件\RIMORental\05_代码与工程\rimo-store-rental-platform
```

Git 边界：

- 门市租赁平台已经拆成独立 Git 仓库，仓库根目录就是上面的 `rimo-store-rental-platform`。
- 后续开发、提交、分支管理和状态检查都在该目录内执行，不再把门市租赁代码提交到外层大仓库。
- 外层大仓库只作为 PRD、原型、知识库和项目资料容器；PRD/原型仍然只读。

不要再使用旧路径：

```text
D:\工作文件\RIMORental\rimo-store-rental-platform
```

当前仓库做过目录重组，Git 状态里可能同时看到旧根目录文件删除、新编号目录未跟踪。这是整理资料目录后的状态，不要为了“清理”而回滚这些目录。

## 2. 接手前必须遵守的边界

- PRD、原型、业务知识库是依据，只读，不要改。
- 代码和开发文档只写在 `05_代码与工程\rimo-store-rental-platform` 内。
- 页面视觉按原型复刻，顶栏按当前系统统一顶栏处理。
- 业务逻辑按 PRD 和业务知识库，不能只看原型。
- 当前仍保留 SaaS 架构，至少支持 1-2 个租户本地跑通。
- 当前阶段只完整推进营运端，门店端复用营运端并靠权限区分。
- 企业端和用户 H5 暂时只预留接口边界，不做完整页面。
- 营运端的个人会员管理、客户等级方案、企业客户管理已列为正式开发任务；这三块当前无独立 PRD，先按原型严格复刻页面、字段和交互。
- 车务看板、车辆调拨、合同单据、TBox 设备管理也已列为正式任务；其中 TBox 先做台账和 mock 集成，不接真实 IoT。
- 分时租赁相关 tab 或入口可保留视觉位置，不开发业务逻辑。
- 外部集成先 mock：支付、发票、短信、TBox、地图、文件存储、AI 调度。独立集成中心、通知中心、附件与打印、异步任务中心曾短暂下线，已按用户要求恢复为原来的入口和页面状态。
- 工作台、排班表、战情室、渠道团票不开发，不要重新排回任务优先级。

## 3. 资料入口

项目内开发文档：

- `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md`：开发任务台账，继续开发前先读，开发后必须更新。
- `docs/TECHNICAL_DEVELOPMENT_GUIDE.md`：技术实现、接口、权限、MySQL 落库建议。
- `docs/GENERAL_RENTAL_MIGRATION_GUIDE.md`：后续从汽车租赁改成通用租赁平台的改造指南。
- `docs/DOMAIN_BOUNDARY_DECISIONS.md`：当前领域边界和命名决策。
- `DEVELOPMENT.md`：本地启动、工程边界、默认账号。

根目录资料入口：

- PRD：`02_PRD与产品文档\PRD\门市租赁`
- 原型：`03_原型与页面\营运端`
- 业务知识库和决策台账：`01_业务知识库与决策台账\业务知识库`
- 项目说明：`PROJECT_README.md`

## 4. 技术栈和工程结构

技术栈：

- 前端：Vue 3、Vite、TypeScript、Pinia、Vue Router、Element Plus、Tailwind CSS。
- 后端：NestJS、TypeScript。
- 共享类型：`@rimo/shared`。
- 数据库：MySQL。当前 MVP 默认使用后端内存数据；平台底座可通过 `PLATFORM_DATA_SOURCE=mysql` 切到 Prisma/MySQL。
- 本地环境预留：Docker Compose 的 MySQL、Redis。

工程结构：

```text
rimo-store-rental-platform/
  apps/
    admin/        营运端前端，门店端也复用
    api/          NestJS API
  packages/
    shared/       前后端共享 DTO、枚举、状态
  docs/           开发文档和交接文档
```

关键代码：

- 前端路由：`apps/admin/src/router.ts`
- 统一布局和菜单：`apps/admin/src/components/AppLayout.vue`
- API client：`apps/admin/src/api/client.ts`
- 登录状态：`apps/admin/src/stores/auth.ts`
- 后端入口：`apps/api/src/app.module.ts`
- API 权限守卫：`apps/api/src/common/api-auth.guard.ts`
- 门市租赁控制器：`apps/api/src/modules/store-rental/store-rental.controller.ts`
- 门市租赁服务：`apps/api/src/modules/store-rental/store-rental.service.ts`
- 平台用户/角色/权限服务：`apps/api/src/modules/platform/platform.service.ts`
- 平台 MySQL 仓储：`apps/api/src/modules/platform/platform.repository.ts`
- Prisma 服务：`apps/api/src/modules/database/prisma.service.ts`
- 共享类型：`packages/shared/src/index.ts`

## 5. 本地运行和验证

推荐接手后执行：

```bash
cd D:\工作文件\RIMORental\05_代码与工程\rimo-store-rental-platform
npm install
npm run build
```

说明：

- 由于项目从旧根目录迁移到 `05_代码与工程`，`node_modules/@rimo/*` 的 workspace junction 可能指向旧路径。
- 本次交接前已执行 `npm install` 刷新链接，`npm run build` 已通过。
- 如果接手方复制或移动目录后构建报 `Cannot find module '@rimo/shared'`，先重新执行 `npm install`。
- 当前 `npm install` 报告 22 个依赖漏洞，暂未处理。不要直接 `npm audit fix --force`，可能引入破坏性升级。
- `npm run build` 通过时仍会有 Vite CJS deprecation 和 chunk size warning，这是现阶段已知警告。

开发启动：

```bash
npm run dev
```

默认访问：

- API: `http://localhost:3000/api`
- 营运端: `http://localhost:5173`

如果 5173 被占用：

```bash
npm run dev:api
npm run dev:admin:5174
```

默认账号：

- `demo / admin / 123456`
- `demo / store / 123456`
- `demo / pricing / 123456`
- `demo2 / admin / 123456`

如需验证平台底座 MySQL 模式，先按 `docs/DATABASE_BOOTSTRAP.md` 执行 migration 和 seed，再设置：

```powershell
$env:PLATFORM_DATA_SOURCE="mysql"
```

如需验证门市租赁 MySQL 模式，设置：

```powershell
$env:STORE_RENTAL_DATA_SOURCE="mysql"
```

该开关目前覆盖站点、车型组、车辆主数据、车辆详情事件、会员、会员审核、会员风控、客户等级方案、企业客户、企业联系人、企业合同、订单创建/查询、费用中心、检查记录、资金流水、预授权押金台账、发票/收据、手工调账、订单时间线、续租、改派、改还车门市/据点、终止类动作、事故登记和企业月结账单一期。事故后续订单联动、统一审计、幂等锁、导出打印和附件仍需继续开发。

不设置时默认 `memory`，无需启动数据库也能跑前后端。

## 6. 当前已实现范围

平台基础：

- Vue3/NestJS monorepo。
- 登录、租户识别、token、路由守卫。
- 平台用户管理、角色管理、权限管理。
- 平台管理员固定全权限，其他账号按角色权限。
- 前端菜单、路由、后端 `ApiAuthGuard` 都已接权限码。
- 系统通用参数第一版已开发：按 `system_rules.html` 新增页面 `/system-rules`，后端新增 `/platform/system-rules`、分区保存和 AI 连接 mock 测试，权限码为 `system:params:manage`。
- 平台底座已支持 `PLATFORM_DATA_SOURCE=memory|mysql`：默认内存，切到 `mysql` 后登录、当前用户、租户、组织、权限树、角色、系统用户、系统参数读写走 Prisma/MySQL。

主数据：

- 服务站点管理：列表、保存、服务能力、服务状态、车位校验、站点层级树。
- 车型组管理：基础资料、产品组、标准价、免费里程、超程单价、特殊车辆管控、删除引用校验。
- 车辆档案库：车辆列表、编辑、新增、车型组和据点动态选项、车牌/VIN 校验、服务类型和据点能力校验。
- 车辆状态动作：启用、停用、发起维保、结束维保、批量启停。
- 主数据/客户域/订单域 MySQL 第一版：已新增 `StoreRentalRepository` 和 `STORE_RENTAL_DATA_SOURCE=memory|mysql`，站点、车型组、车辆列表/保存/删除校验/车辆状态更新、出入站流水、车况照片、维保、事故、车辆操作日志、会员、会员审核、会员风控、客户等级方案、企业客户、企业联系人、企业合同、订单创建/查询、费用中心、检查记录、资金流水、预授权押金台账、发票/收据、手工调账、订单时间线、续租、改派、改还车门市/据点、终止动作、事故登记和企业月结账单可切到 Prisma/MySQL；原型扩展字段存入主表 `metadata` JSON 或领域 JSON 字段。
- 车辆详情抽屉：车辆概况、订单记录、出入站流水、车况照片、维保/事故记录、操作记录。
- 车辆维保/事故新增记录：已接后端，新增后会刷新详情、回写车辆状态、追加操作日志。
- 车辆维保记录完成、事故记录结案：已接后端更新接口，详情页可直接完成/结案，并按未结记录自动回写车辆状态。
- 车辆出入站流水新增：已接后端，支持在车辆详情页补录流水，并在记录时间为最新时回写车辆当前位置、站点和里程。
- 车辆出入站流水编辑：已接后端，支持编辑人工补录和调拨流水；调拨时如车辆存在履约中订单，会阻断提交。
- 车辆车况照片补录：已接后端，当前支持通过图片 URL 方式补录照片时间线。
- 车辆占用排程提示：车辆详情头部会提示当前/未来订单占用，便于调拨、停用、改派前先核对影响。
- 增值服务管理：列表和保存已有 MVP。

规则和定价：

- 门市租赁规则配置已有 MVP。
- 基础产品定价、价格计划、报价试算已有 MVP。
- 动态调价页面框架已有，但策略表和试算仍待补强。

客户运营：

- 个人会员管理第一版已开发：列表、详情、审核页面和基础后端接口已落地。
- 会员风控第一版已开发：会员列表/详情可暂停、拉黑、恢复；动作写入会员时间线并同步订单风险标记。
- 客户等级方案第一版已开发：等级列表、编辑和保存接口已落地。
- 企业客户管理第二版已开发：列表、详情页面和基础后端接口已落地，详情已补月结配置、合同台账和月结账单。

车务运营与单据：

- 车辆调拨尚未开发，但已列入正式任务，按原型 `vehicle_transfer.html` 执行。
- 车务看板/车辆状态看板尚未开发，但已列入正式任务，按原型 `vehicle_status_list.html`、`vehicle_console.html` 执行。
- 合同与单据尚未开发，但已列入正式任务，按原型 `official_vehicle_contracts.html` 执行。
- TBox 设备管理尚未开发，但已列入正式任务，按原型 `tbox_management.html` 执行；本期只做设备台账和 mock 集成。

订单闭环：

- 新建订单：可用性查询、报价、创建订单，客户来源已切到真实会员/企业客户接口。
- 订单列表：状态展示、动作入口和统计。
- 独立订单详情页 `/orders/:id`：摘要、操作栏、客户预约、派车、取还车、履约事件、财务分栏。
- 订单动作：支付成功、开始取车、取车验车、延长用车/补办续租、订单改派、改还车门市/据点、还车验车、结算确认、取消订单、标记爽约、拒绝履约、关闭订单、事故登记/处理事故。
- 费用中心：查询、新增费用、费用减免、登记收款、退款、企业月结。
- 财务结算中心：新增 `/finance` 页面，覆盖资金流水、预授权押金、企业月结、发票收据、手工调账和财务对账。
- 状态机后端有校验，不能任意跨状态操作。
- MySQL 模式订单一期：`POST /store-rental/orders` 会写订单本体、价格/规则快照、初始费用、资金记录和时间线；订单列表、详情、费用中心从数据库读取；人工费用、减免、资金登记落库；预授权押金台账、发票/收据和人工调账已有独立财务表与接口；主流程动作 `payment-success`、`start-pickup`、`pickup-inspection`、`return-inspection`、`confirm-settlement`，以及 `extend-rental`、`redirect-order`、`change-return-store`、`change-return-station`、`cancel`、`mark-no-show`、`reject-order`、`close-order`、`register-accident` 已持久化；改还车门市/据点的后续预约冲突快捷改派一期已随 `change-return-store/change-return-station` 联动持久化；企业月结账单、明细和回款落库，且只在成功 `monthly_bill` 交易后生成账单行。
- MySQL 模式尚未完成：事故导致车辆不可用后的后续订单解除占用/自动改派/人工调度队列、独立转单事件表、统一审计、幂等锁和完整附件上传仍需继续接入。调度事件表 `DispatchEvent` 已完成第一版，但还没有任务处理状态表。

权限深化：

- 角色已拆分页面/菜单权限 `permissions`、按钮权限 `buttonPermissions` 和数据范围 `dataScope`。
- 权限管理页沿用原型 `permissions.html` 的角色列表、业务线授权和 Tab 权限矩阵，已支持按钮权限勾选和数据范围选择。
- 登录用户会合并普通权限与按钮权限，前端通过 `hasAnyPermission` 控制订单动作、费用处理、会员风控、车辆状态动作、企业月结回款、系统导出等按钮显隐。
- 后端 `ApiAuthGuard` 已对上述关键写接口增加按钮权限校验，并保留原有管理权限兼容。
- 当前数据范围只随角色/用户承载，尚未在内存查询层过滤；接 MySQL/repository 时要补 `all/organization/store/own` 的统一数据过滤。

MySQL / Prisma：

- `apps/api/prisma/schema.prisma` 已是 MySQL provider，并扩展为主干业务模型。
- 已覆盖平台用户多角色、角色权限、按钮权限/数据范围、系统参数、站点、车型组、车辆台账、会员、企业客户、订单、费用/资金、月结账单、检查记录、订单时间线、续租快照和改派所需车辆/车型组快照字段。
- `StoreRentalRepository` 已实现订单、费用、资金、预授权押金台账、发票/收据、人工调账、检查、时间线、车辆状态更新、还车门市/据点快照更新和企业月结账单第一版 DTO 映射；`StoreRentalService` 已把订单创建/查询、费用中心、财务结算中心、资金登记、主流程动作、续租、改派、改还车门市/据点、终止动作、事故登记和企业月结接口接入 `STORE_RENTAL_DATA_SOURCE=mysql`。
- 已用临时 `DATABASE_URL=mysql://root:password@localhost:3306/rimo_store_rental` 通过 `npx prisma validate --schema apps/api/prisma/schema.prisma`。
- 已新增 `apps/api/prisma/seed.ts`，可重复初始化 demo/demo2 租户、组织、用户、角色权限、系统参数、站点、车型组、车辆、会员等级、会员和企业客户。
- 根脚本已补：`db:generate`、`db:validate`、`db:migrate`、`db:seed`；执行说明见 `docs/DATABASE_BOOTSTRAP.md`。
- 已新增全局 `DatabaseModule` 和 `PrismaService`，后续 repository 可直接注入；默认 `DATABASE_CONNECT_ON_START=false`，不会影响当前内存 MVP 启动。
- 已生成初始 migration SQL：`apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql`。
- 已新增 `PlatformRepository`，覆盖租户、组织、权限树、角色、用户、系统参数的基础读写和 shared DTO 映射。
- 已新增 `PLATFORM_DATA_SOURCE=memory|mysql` 开关。默认 `memory`；设置 `mysql` 后，`PlatformService` 的登录、当前用户、租户、组织、权限树、角色、用户、系统参数接口走 `PlatformRepository/Prisma`。
- 已新增 `StoreRentalRepository` 和 `STORE_RENTAL_DATA_SOURCE=memory|mysql` 开关。默认 `memory`；设置 `mysql` 后，站点、车型组、车辆主数据、车辆详情事件、客户域、订单/费用/资金/检查/时间线、续租、改派、改还车门市/据点、转单后续预约快捷改派一期、终止动作、事故登记和企业月结接口走 `StoreRentalRepository/Prisma`。
- 下一步继续补事故后续订单联动、独立转单事件表、调度任务处理状态、统一审计、幂等锁和完整附件上传，不能把当前订单域一期理解为全业务闭环完成。

本轮新增的客户运营/订单联动能力：

- 会员列表接口现在返回真实积分余额，订单页积分抵扣不再依赖原型 seed。
- 企业客户详情支持维护：账单邮箱、对账单邮箱、对账联系人、自动生成月结、授信预警阈值。
- 企业客户详情支持合同台账编辑：合同编号、名称、状态、生效期、门市范围、附件文件名、备注。
- 新建订单创建时会传递真实 `memberId`、`corporateId`，后端会校验会员状态、企业状态和企业月结配置。
- 新建订单后端会校验会员证件/驾驶证认证、会员风控状态和企业授信额度；前端不再在接口失败时用本地 fallback 创建成功。
- 订单创建成功后会回写会员最近订单、会员时间线、企业最近订单和企业活跃订单数。
- 企业详情页可查看 `/store-rental/corporates/:id/monthly-bills` 月结账单，并通过 `/settle` 登记回款。
- `STORE_RENTAL_DATA_SOURCE=mysql` 下，上述会员/等级/企业接口读取和保存 MySQL；新建订单会读取 MySQL 客户主档并回写会员订单数、会员时间线和企业活跃订单数；企业月结账单、明细和回款记录已走月结账单表，且只在成功 `monthly_bill` 交易后生成账单行。

本轮新增的延长用车能力：

- 新增订单动作 `extend-rental`，只允许 `renting`、`renewing`、`overdue`；`overdue` 按补办续租处理，成功后回到 `renewing`。
- 后端会校验新预计还车时间、同车牌延长时段加 60 分钟订单间隔内的后续占用、客户自付必须立即收款场景。
- 费用中心新增 `stage=rental`、`code=extension_rent` 的“续租租金”；立即收款生成 `payment`，还车时结算保持待处理，企业月结进入月结账单且不生成客户收款交易。
- 订单列表和详情页都已接入延长/补办续租弹窗，展示当前/新还车时间、延长时长、库存检测、费用试算、结算方式、备注。
- 当前事件级快照是 `snapshotRef=extension:<orderNo>:<timestamp>` 的引用，不是完整快照表；后续持久化时要补 `order_extension_snapshots`。

本轮新增的订单改派能力：

- 新增订单动作 `redirect-order`，只允许 `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing`；改派成功后订单主状态保持不变。
- 后端会校验目标车辆启用/空闲、不能同车牌、不能跨车行、租期排程冲突、未处理费用和管理员覆盖备注。
- 费用中心新增 `redirection_fee` 和 `redirection_refund`；同车组不产生费用，免费升级必须填写原因，企业月结订单差价进入后续月结。
- 订单详情页已按 `order_detail.html` 增加“订单改派 & 车辆升级”弹窗，支持手动选择/系统推荐、车组筛选、候选车辆、差价试算、差价/免费升级、原因和备注。
- `STORE_RENTAL_DATA_SOURCE=mysql` 下，改派会写订单绑定车辆、车型组快照、费用项、订单时间线、原车辆释放状态和目标车辆占用状态。
- 仍需继续：后续订单冲突快速改派、独立调度事件表、完整改派链路审计和调度/风控报表。

本轮新增的改还车门市/据点能力：

- 新增订单动作 `change-return-store`、`change-return-station`，允许状态为 `reserved`、`pickup_overdue`、`inspecting`、`renting`、`renewing`、`overdue`、`accident_processing`；确认后订单主状态保持不变。
- 后端会校验目标门市/据点启用、服务状态正常、具备当前订单服务能力、同车行，以及原还车门市是否存在占用当前车辆的后续预约/待取车/锁车订单；冲突未处理时阻断转单，处理时会按改派规则快捷改派后续订单。
- 费用中心新增 `return_store_change_fee` 和 `return_store_change_refund`；同门市换据点不收费，跨门市按新旧异地还车费差额进入取车尾款、还车结算或企业月结。
- 订单详情页已按 `order_detail.html` 增加改还车门市/据点弹窗，展示取车门市、当前还车门市/据点、新目标、原因、备注、当前异地费、新异地费和本次差额。
- 订单详情页已按原型冲突卡片补“原还车门市存在后续预约”和“快捷改派后续订单”。前端选择快捷改派后，后端会为后续订单匹配同车组或可升级空闲车，并再次校验时段占用、服务类型、同车行和价格不降级，成功后释放后续订单对原车的预约占用，但原车仍按当前订单状态继续占用，同时更新后续订单车辆/费用/结算/时间线。
- `STORE_RENTAL_DATA_SOURCE=mysql` 下，改还车会写 `returnStationId`、还车门市快照、费用项、结算汇总和订单时间线；若触发快捷改派，也会持久化后续订单改派结果和车辆状态。
- 仍需继续：独立转单事件表、调度页联动详情、数据权限和转单审计报表。

本轮新增的调度看板能力：

- 新增共享调度 DTO 和接口：`GET /store-rental/dispatch/board`、`POST /store-rental/dispatch/optimize`、`POST /store-rental/dispatch/apply`、`POST /store-rental/dispatch/hard-lock`、`POST /store-rental/dispatch/manual-reassign`。
- 新增调度任务池和事件流接口：`GET /store-rental/dispatch/tasks`、`GET /store-rental/dispatch/events`。
- 后端按 `智能调度派车规则.md` 和 `智能调度派车算法.md` 实现候选车辆硬约束过滤、预览式智能优化、应用前重校验、预分配写入、取车前硬锁和调度页人工改派。
- 前端新增 `apps/admin/src/views/DispatchView.vue`、`/dispatch` 路由、侧边栏菜单和 `store-rental:dispatch:manage` 权限入口；页面按 `dispatch.html` 方向包含日/周/月排程、筛选、车辆甘特、后端任务池队列、调度事件流、订单/车辆抽屉、优化弹窗和 AI 分析预留。
- AI 分析仍是 mock/预留，只展示模型配置、提示词版本、风险诊断和“AI 不直接改订单”的约束；真实调用需后续接 `AiDispatchAdapter`、租户 API Key 和请求日志。
- `STORE_RENTAL_DATA_SOURCE=mysql` 下，调度接口复用现有 repository 读订单/车辆/车型组/站点，并写回订单绑定车辆、派车状态、车辆状态和订单时间线；已新增 `DispatchEvent` 表/migration，repository 先用 raw SQL 写入/查询事件，任务池暂从订单状态和车辆有效性实时派生，尚未拆独立任务状态表。
- 本轮冒烟：`/dispatch/board` 返回 2 笔排程；`/dispatch/optimize` 生成 1 笔可应用优化；`/dispatch/apply` 将 `SR202605060002` 预分配到 `BCP 7315`；`/dispatch/hard-lock` 将该单更新为 `locked`。
- 追加冒烟：`/dispatch/tasks` 返回 `SR202605060002` 待派车任务；`/dispatch/optimize` 写入 `optimization_preview` 事件；`/dispatch/apply` 后任务池变为 0，事件流出现 `optimization_apply`。

预留：

- 企业端接口边界：`/api/enterprise/store-rental/orders`
- H5 接口边界：`/api/h5/store-rental/*`
- 外部集成 mock：`/store-rental/integrations`、`/store-rental/client-endpoints`；营运端独立入口已按用户要求恢复。

## 7. 当前主要接口

平台：

- `POST /auth/login`
- `GET /auth/me`
- `GET /platform/tenants`
- `GET /platform/organizations`
- `GET /platform/users`
- `POST/PUT /platform/users`
- `PUT /platform/users/:id/status`
- `POST /platform/users/:id/reset-password`
- `GET /platform/roles`
- `POST/PUT /platform/roles`
- `PUT /platform/roles/:id/permissions`
- `GET /platform/permission-tree`

门市租赁主数据：

- `GET/PUT /store-rental/rules`
- `GET /store-rental/stations`
- `GET /store-rental/stations/hierarchy`
- `POST/PUT /store-rental/stations`
- `GET /store-rental/vehicle-groups`
- `POST/PUT /store-rental/vehicle-groups`
- `DELETE /store-rental/vehicle-groups/:id`
- `GET /store-rental/vehicles`
- `GET /store-rental/vehicles/:id`
- `POST /store-rental/vehicles/:id/location-events`
- `PATCH /store-rental/vehicles/:id/location-events/:recordId`
- `POST /store-rental/vehicles/:id/condition-photos`
- `POST/PUT /store-rental/vehicles`
- `PATCH /store-rental/vehicles/:id/status`
- `POST /store-rental/vehicles/:id/maintenance-records`
- `PATCH /store-rental/vehicles/:id/maintenance-records/:recordId`
- `POST /store-rental/vehicles/:id/accident-records`
- `PATCH /store-rental/vehicles/:id/accident-records/:recordId`
- `GET /store-rental/value-added-services`
- `POST/PUT /store-rental/value-added-services`
- `GET/POST/PUT /store-rental/members`
- `GET /store-rental/members/:id`
- `GET /store-rental/member-reviews`
- `POST /store-rental/member-reviews/:id/process`
- `GET/POST/PUT /store-rental/membership-plans`
- `GET/POST/PUT /store-rental/corporates`
- `GET /store-rental/corporates/:id`

门市租赁订单：

- `GET /store-rental/pricing/plans`
- `GET /store-rental/pricing/plans/:id`
- `POST /store-rental/pricing/quote`
- `POST /store-rental/availability`
- `GET /store-rental/workflow`
- `POST /store-rental/orders`
- `GET /store-rental/orders`
- `GET /store-rental/orders/:id`
- `POST /store-rental/orders/:id/actions/:action`
- `GET /store-rental/orders/:id/fees`
- `POST /store-rental/orders/:id/fees`
- `POST /store-rental/orders/:id/fees/:feeId/waive`
- `POST /store-rental/orders/:id/transactions`
- `GET /store-rental/dispatch/board`
- `GET /store-rental/dispatch/tasks`
- `GET /store-rental/dispatch/events`
- `POST /store-rental/dispatch/optimize`
- `POST /store-rental/dispatch/apply`
- `POST /store-rental/dispatch/hard-lock`
- `POST /store-rental/dispatch/manual-reassign`

## 8. 任务状态摘要

Done：

- PF-01 工程结构。
- PF-02 登录与租户。
- PF-03 用户、角色、权限。
- MD-08 车型组删除引用校验。
- OR-01 订单主状态。
- OR-02 资源可用性。

In Progress：

- MD-01 站点管理。
- MD-02 车型组基础资料。
- MD-03 车辆实例管理。
- MD-04 增值服务。
- MD-05 站点能力。
- MD-06 站点和能力校验。
- MD-07 车辆状态动作。
- MD-09 车辆详情。
- PR-01 租赁规则。
- PR-02 基础价格。
- OR-03 新建订单。
- OR-04 订单列表。
- OR-05 订单详情。
- OR-06 取车。
- OR-07 还车。
- OR-08 费用中心。
- OR-09 取消/关闭/爽约第一版。
- OR-10 延长用车第一版。
- OR-11 改派第一版。
- OR-12 改还车门市/据点第一版。
- OR-13 事故出险第一版。
- DP-01 调度看板第一版。
- OR-14 订单快照。
- DOC-01 技术文档。

Pending：

- PR-03 动态调价策略完整实现。
- PR-04 行销方案。
- OR-10 延长用车继续补完整事件级快照、补充协议、后续订单改派和按钮级逾期续租权限。
- OR-11 改派继续补后续订单冲突快速改派、完整链路审计和调度/风控报表。
- OR-12 改还车门市/据点继续补独立转单事件表、权限数据范围和调度页联动。
- OR-13 继续补事故记录列表/结案、照片真实上传、事故车辆不可用后的后续订单解除占用/自动改派/人工调度队列。
- DP-01/DP-03/DP-04 继续补异常车辆后续订单自动解除/改派、任务认领/关闭、数据权限过滤、AI 请求日志、告警关闭事件和调度审计报表。

新增高优先级正式任务：

- PF-05 MySQL 持久化：不再是纯后续规划，已提升为正式开发项。
- PF-06 数据层：Prisma schema、migration、repository、seed。
- PF-07 基础设施：文件上传、配置、缓存、异步任务保留底层能力；相关历史独立页面已按用户要求恢复，后续新增/变更仍需审计依据。
- PF-08 系统参数后续：补 MySQL 参数表、数据字典治理、通知发送日志、打印/编号参数联动和租户初始化默认参数。
- PF-11 租户初始化：默认角色/参数/菜单模板和租户级配置。
- PF-12 通知预留：短信/邮件/站内消息模板和 mock 发送日志只允许接入已有业务页面。
- PF-13 导入导出/打印预留：Excel 导入导出、模板下载、PDF/打印只允许接入已有 PRD/原型页面。
- CRM-01/02/03：个人会员列表、详情、审核。
- CRM-04：客户等级方案、权益规则、升级条件。
- COR-01/02：企业客户列表、详情、额度、联系人、合同信息。
- MD-10/11/12：车辆调拨、车务状态看板、TBox 设备管理。
- OR-15：合同与单据。
- RP-01：报表中心。
- INT-01：支付、发票、通知、文件、地图、IoT、AI 统一 adapter 层仅作为底层预留，不能单独暴露无原型营运端页面。

Reserved：

- DP-02 AI 调度。
- EX-01 企业端。
- H5-01 用户 H5。

## 9. 下一步建议

优先顺序建议按批次执行，不要并行乱插：

1. Phase A：`PF-05/PF-06/PF-11`，平台、站点/车型组/车辆、车辆详情事件、客户域、订单/费用/月结、续租、改派、改还车、转单快捷改派一期、终止、事故和调度事件 MySQL 切换已完成第一版，下一步补事故后续订单联动、独立转单事件、任务状态表、统一审计、幂等和租户初始化。
2. Phase B：`PF-08/PF-10` 优先补系统参数和权限深化；`PF-12/PF-13/INT-01` 只保留底层预留，必须等具体 PRD/原型页面再接入。
3. Phase C：`CRM-01/02/03/04`、`COR-01/02`，补会员、等级方案、企业客户。
4. Phase D：`MD-09/MD-10/MD-11/MD-12`，补车辆详情、车辆调拨、车务看板、TBox 台账。
5. Phase E：`OR-05/06/07/08/09/15`，补订单详情、取还车向导、费用审计、取消关闭、合同单据。
6. Phase F：`DP-01`、`DP-03/04`、`OR-11/12/13`、`PR-03/04`、`RP-01`，调度看板第一版已接入，继续补调度事件、任务池、异常履约、动态调价、行销和报表。

原则：

- 不要跳过 Phase A 直接堆更多业务页，否则后面会被内存数据结构反噬。
- 订单、车辆、调度相关功能继续做时，前后端必须同步，不能只补页面。
- 每完成一个批次，都要更新 `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md` 和 `docs/TECHNICAL_DEVELOPMENT_GUIDE.md`。

推荐直接按 Sprint 执行：

1. Sprint 1-2：MySQL、repository、seed、租户初始化；当前平台模块、站点/车型组/车辆主数据、车辆详情事件、客户域、订单/费用/月结、续租、改派、改还车、转单快捷改派一期、终止、事故和调度事件已完成第一版，继续补事故后续订单联动、独立转单事件、任务状态表、统一审计、幂等和租户初始化。
2. Sprint 3-4：系统参数、权限深化、审计、编号中心、数据字典、观测、接口契约、事件入出站、筛选预设、版本发布记录；通知、导出打印、附件、adapter 只做业务页面内接入，不做独立中心页。
3. Sprint 5-6：会员、等级方案、企业客户、会员风控、企业月结配置、企业合同台账。
4. Sprint 7-8：车辆照片、证照、随车物资、站点营业日历、站点容量、调拨、车务看板、TBox 台账。
5. Sprint 9-10：订单详情、取还车向导、报价快照解释、费用审计、合同与单据、预授权、发票、幂等、跟进备注、人工调账、企业月结账单、客户通知留痕。
6. Sprint 11-12：调度看板第一版已完成；继续补调度事件、改派链路、调度任务池、异常履约、动态调价、行销、报表、对账、风控报表、定时作业、测试、备份恢复、发布回滚、演示数据工厂。

详细 Sprint 定义见 `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md` 的“推荐冲刺清单”。
每个 Sprint 建议改哪些层、哪些文件、怎么验收，见同一文件里的 “Sprint 实施清单”。

## 9.1 2026-06-09 多分支并行状态

当前继续使用既有分支，不再新增 `codex/next-*`。用户已要求清理多余子智能体，当前调度策略改为“一分支一负责人”；本线程已从今天会话日志核对并尝试关闭 17 个历史 agent id，管理器均返回 `not found`，因此当前没有保留运行中的 worker。

接手方应先查看 `docs/branch-worklogs/integration-store-rental-mvp.md` 的“2026-06-09 多分支目标分发记录”和“回收与补派记录”。后续如重新并行开发，只能为每个有效功能分支保留一个负责人，不要为同一分支反复新开 worker。分支功能只有在提交哈希、验证命令且集成主线合并验证通过后，才能在全局台账中标为完成。

最新回收状态：

- `codex/foundation-platform` 已完成 PF-18，提交 `2ac0a52`；主线程已收口 PF-22，提交 `353e735`；两者已合入 integration，合并提交 `22863e9`。
- `codex/fleet-ops` 已完成 MD-16，提交 `fa2b9fb`；第二轮 MD-10 车辆调拨生命周期提交 `aa81b05`。
- `codex/infra-adapters` 已完成 PF-13/PF-15 底层能力提交 `4f37e7e`、`d5172c3`；独立入口曾在 integration 纠偏下线，后续已按用户要求恢复。
- `codex/pricing-marketing` 已由主线程完成 PR-03/PR-05 动态调价试算入口，提交 `b726a1b`。
- `codex/customer-finance` 已完成 OR-16 预授权与押金台账第一版，提交 `1bd8bec`；第二轮 OR-17 发票/收据补开与重开关联提交 `855b5f4`。
- `codex/dispatch-exception` 已完成 OR-18/OR-22 订单操作记录和客户通知留痕第一版，提交 `f6990b0`；第二轮 DP-04 因 Windows 沙箱拦截基础命令未产出提交，worker 不再保留。
- `codex/order-fulfillment` 已完成 OR-15 合同与单据 MVP，提交 `bb44e93`；第二轮 OR-19 订单备注与跟进提交 `eb40a02`。
- `codex/reports-ops` 已完成报表导出任务真实 CSV 生成和下载接口，提交 `d93f614`。

## 10. 接手 AI 的工作方式

每次继续开发前：

1. 先读 `docs/AI_HANDOFF.md`。
2. 再读 `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md`。
3. 对当前要做的模块，读取对应 PRD 和原型。
4. 查代码中的现有页面、API client、共享 DTO、后端 service/controller。
5. 实现时前后端同步，不能只做静态页面。
6. 构建验证：`npm run build`。
7. 更新 `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md` 和 `docs/TECHNICAL_DEVELOPMENT_GUIDE.md`。
8. 如涉及通用租赁抽象，更新或参考 `docs/GENERAL_RENTAL_MIGRATION_GUIDE.md` 和 `docs/DOMAIN_BOUNDARY_DECISIONS.md`。

开发时注意：

- 工作台、排班表不开发，不要再排进任务优先级。
- 当前目标是门市租赁核心功能和业务流程闭环。
- 前端页面要按原型，业务逻辑要按 PRD。
- 目前数据都是内存数据，重启后会恢复 demo 初始化状态。
- 新增接口要走 `ApiAuthGuard`，新增页面要加 `route.meta.permission`。
- 后续通用租赁改造不要直接删除汽车 DTO，应先新增通用 DTO，再逐步映射。
