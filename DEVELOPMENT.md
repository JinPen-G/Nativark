# RIMO 门市租赁平台开发说明

这个目录是从零开始的真实 MVP 工程，和仓库根目录的 PRD、知识库、静态原型隔离。

## Git 边界

本目录已经作为门市租赁平台的独立 Git 仓库使用，后续门市租赁代码、开发文档、数据库迁移和任务台账都在本目录内提交。

- 子项目提交目录：`05_代码与工程/rimo-store-rental-platform`
- 子项目默认分支：`main`
- 外层大仓库只保留 PRD、原型、知识库等资料，不再跟踪本目录内的开发文件。
- 需要提交门市租赁功能时，先进入本目录再执行 `git status`、`git add`、`git commit`。

## 开发文档索引

- `docs/TECHNICAL_DEVELOPMENT_GUIDE.md`：当前前后端平台的技术开发文档，记录模块边界、权限、接口、数据模型和开发规范。
- `docs/GENERAL_RENTAL_MIGRATION_GUIDE.md`：后续从汽车门市租赁改造成通用租赁平台的改造指南，明确哪些文件、字段、页面、规则和接口需要调整。
- `docs/DOMAIN_BOUNDARY_DECISIONS.md`：当前阶段的领域边界和命名决策，用于避免代码继续绑定死汽车租赁。
- `docs/AI_HANDOFF.md`：交接给其他 AI 或开发者时优先阅读的当前状态说明。

## 工程边界

- `apps/admin`：营运端 Vue3 应用，门店端也复用该端，只通过角色和权限限制功能。
- `apps/api`：NestJS API，先提供门市租赁 MVP 的接口和模拟集成。
- `packages/shared`：前后端共享的枚举、DTO 和基础类型。
- `docker-compose.yml`：本地 MySQL、Redis，用于后续真实数据和异步任务。

当前实现仍以“门市汽车租赁”为业务入口，但新增能力应尽量按通用租赁抽象理解：

- 车辆实例 = 当前阶段的租赁标的实例，未来可替换为摄影器材、露营装备等库存实例。
- 车型组 = 当前阶段的租赁标的分组/商品组，未来可替换为器材型号组、套装组或 SKU 组。
- 站点/门市 = 租赁履约网点，未来仍可复用为仓库、门店、自提点或寄送履约点。
- 取还车验车 = 领取/归还检查，未来可复用为设备出库检查、归还质检、损耗确认。

## 当前 MVP 页面

- `/rental-rules`：租赁业务规则，覆盖交易授权、待支付保留、异地还车、计费、取还车、取消、爽约、超时和续租规则。
- `/stations`：服务站点管理，仅实现门市租赁和 24H 门市服务能力。
- `/vehicle-groups`：车型组管理，维护车型基础信息并关联门市租赁产品组。
- `/vehicles`：车辆档案库，维护车辆实例、当前位置、服务类型、TBox CID 和特殊车辆标记。
- `/service-products`：基础产品定价，按原型复刻门市租赁产品组和里程费规则。
- `/pricing`：动态调价策略，按原型复刻门市标准价、历史版本和定时调价计划。
- `/services`：增值服务管理，仅实现门市租赁服务、价格、库存和历史版本。
- `/new-order`：新建门市订单，使用规则、可用性和价格进行报价试算并创建订单。
- `/orders`：门市租赁订单列表和详情抽屉，支持支付成功、取车验车、还车验车、结算确认、取消等 MVP 状态动作。
- `/reports`：数据报表，覆盖经营概览、订单报表、车辆报表、财务报表、导出任务和本地 MySQL 运维日志。
- `/users`：平台账户管理，支持租户内账号、组织、角色、启停和重置密码。
- `/permissions`：权限管理，平台管理员固定全权限，其他角色按业务线和权限码配置。

分时租赁相关页签只保留原型位置，不实现业务逻辑。

## 本地启动

```bash
cd rimo-store-rental-platform
copy .env.example .env
docker compose up -d
npm install
npm run dev
```

启动后：

- API: `http://localhost:3000/api`
- 营运端: `http://localhost:5173`

如果本机已有旧项目占用 `5173`，可以分开启动并把当前营运端固定到 `5174`：

```bash
npm run dev:api
npm run dev:admin:5174
```

对应访问地址：

- API: `http://localhost:3000/api`
- 营运端: `http://localhost:5174`

本地开发时不要长期同时跑 `npm run build` 和 API watch；生产构建会清理 API 的 `dist`。如果构建后 `3000` 不响应，重新执行 `npm run dev:api`。

默认 MySQL 连接：

```text
mysql://rimo:rimo@localhost:3306/rimo_store_rental
```

当前 MVP 支持内存数据和 MySQL 数据源。报表、导出任务和运维日志按 MySQL 口径开发；验证报表前建议执行 `npm run db:seed:reports` 补齐演示订单、费用、月结和运维日志数据。

## MVP 集成策略

支付、发票、短信、TBox、地图、文件存储和 AI 调度先保留适配器边界，默认返回模拟结果。这样第一阶段能跑完整效果，后面替换真实供应商时不改业务流程。
