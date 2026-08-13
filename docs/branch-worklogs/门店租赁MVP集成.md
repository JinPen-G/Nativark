# Integration Store Rental MVP Worklog

更新时间：2026-06-09

目标分支：`codex/integration/store-rental-mvp`

## 本轮定位

本分支只负责门市租赁 MVP 的集成收口框架，不抢业务实现。业务实现仍由各功能分支完成；本分支在分支提交、推送、验证结果清楚后，再按顺序合并、处理冲突、统一更新全局开发台账和技术文档。

本轮使用独立 worktree：

`历史外层 worktree（已废弃）/integration-store-rental-mvp`

原因：主工作树当前被 `codex/infra-adapters` 占用并存在未提交改动，不能切换分支或覆盖其他 worker 的工作。

## 项目约束

- 严格按用户最新要求、项目规则、门市租赁 PRD 和原型执行。
- 不修改 PRD 文件、原型文件、历史资料和归档资料。
- 不做工作台。
- 不开发分时租赁；原型内出现分时租赁 tab 时只保留页面结构表达，不实现分时业务。
- 当前优先营运端；H5 和企业端只预留接口。
- MySQL 是真实落地目标，不能只做静态页面。
- 前后端同步开发，页面按原型，逻辑按 PRD。
- 业务分支只写 `docs/branch-worklogs/*`；全局台账由 integration 分支在合并后统一更新。

## 分支状态快照

当前集成分支：`codex/integration/store-rental-mvp`

当前集成提交：`22863e9 合并平台底座筛选预设能力`

已合并并推送到集成分支：

- `origin/codex/foundation-platform`：平台治理、安全基线、租户初始化、字典和编号规则。
- `origin/codex/infra-adapters`：外部接入、文件、通知、异步任务、打印和 TBox mock 边界。
- `origin/codex/fleet-ops`：站点、车辆、车辆详情、车辆调拨、车务看板、TBox、证照和随车物资第一版。
- `origin/codex/pricing-marketing`：定价、报价、动态调价、营销方案第一版。
- `origin/codex/order-fulfillment`：订单、费用、取还车、续租、改派、事故和履约记录第一版。
- `origin/codex/customer-finance`：会员、企业客户、客户等级、企业月结和财务中心第一版。
- `origin/codex/dispatch-exception`：调度异常、AI 分析预留、车辆不可用后续订单处理第一版。
- `origin/codex/reports-ops`：经营报表、财务报表、导出任务、MySQL 运维脚本和报表演示 seed。

当前不再新增 `codex/next-*` 分支；后续开发继续沿用上述既有功能分支，或在集成分支做小范围收口。

子智能体调度策略已修正为“一分支一负责人”。不再为同一分支完成一小段后反复新开 worker；当前已核对并关闭/回收所有可定位的历史 agent，multi-agent 管理器返回均为 `not found`，后续只在确有并发必要时为每个有效分支保留一个负责人。

## 合并顺序建议

标准顺序：

1. `codex/foundation-platform`
2. `codex/infra-adapters`
3. `codex/fleet-ops`
4. `codex/pricing-marketing`
5. `codex/customer-finance`
6. `codex/order-fulfillment`
7. `codex/dispatch-exception`
8. `codex/reports-ops`

当前不直接合并的原因：

- `foundation-platform` 和 `infra-adapters` 是平台底座，按顺序应先进入，但远端尚未完成。
- 已完成的 `fleet-ops`、`pricing-marketing`、`order-fulfillment`、`dispatch-exception` 都改到了 shared 类型、Prisma schema、store-rental service/controller、API client 等共享文件。
- 若跳过底座分支先合并业务分支，后续 foundation/infra 进入时冲突会被放大，且更难判断权限、通用参数、审计、通知、导入导出、文件等底层能力的最终归属。

可调整策略：

- 若需要尽快看业务集成效果，可以先在临时实验分支按 `fleet -> pricing -> order -> dispatch` 做一次试合并；验证通过后再决定是否回写到 integration。
- 正式 integration 分支仍建议等待 `foundation-platform` 和 `infra-adapters` 推送后再开始主线合并。

## 高风险冲突文件

核心共享文件：

- `05_代码与工程/store-rental-platform/apps/api/prisma/schema.prisma`
- `05_代码与工程/store-rental-platform/apps/api/prisma/seed.ts`
- `05_代码与工程/store-rental-platform/packages/shared/src/index.ts`
- `05_代码与工程/store-rental-platform/apps/api/src/modules/store-rental/store-rental.controller.ts`
- `05_代码与工程/store-rental-platform/apps/api/src/modules/store-rental/store-rental.repository.ts`
- `05_代码与工程/store-rental-platform/apps/api/src/modules/store-rental/store-rental.service.ts`
- `05_代码与工程/store-rental-platform/apps/admin/src/api/client.ts`
- `05_代码与工程/store-rental-platform/apps/admin/src/router.ts`
- `05_代码与工程/store-rental-platform/apps/admin/src/components/AppLayout.vue`

业务页面高风险区域：

- 订单：`OrderDetailView.vue`、`NewOrderView.vue`
- 调度：`DispatchView.vue`
- 车辆/站点：`StationsView.vue`、车辆调拨、车辆状态、车辆控制台、TBox 页面
- 定价/营销：`DynamicPricingView.vue`、`MarketingView.vue`
- 客户/财务：个人会员、企业客户、客户等级、押金/预授权、发票/收据、月结账单、对账页面

数据库迁移风险：

- 多个分支都新增 Prisma migration，且部分目录时间戳接近或相同前缀。
- 合并后必须检查 migration 目录排序、表名唯一性、外键关系、枚举命名和 seed 数据是否重复。
- 不允许为了通过验证而删除业务分支 migration；如有冲突，应保留真实业务表并调整命名/依赖顺序。

## 每次合并流程

合并前：

1. `git fetch origin`
2. `git status --short --branch`
3. 确认当前位于 `codex/integration/store-rental-mvp`
4. 确认 worktree 干净
5. 查看候选分支最新提交和分支日志
6. 查看候选分支相对 integration 的改动文件
7. 执行 PRD/原型偏离审计：列出候选分支新增/修改的菜单、路由、页面、接口和任务项，并逐项标注 PRD 或原型依据
8. 如果出现无依据的独立页面、菜单、路由或任务项，必须记录偏离风险、用户确认情况和处理结论；用户已要求恢复的历史入口按恢复状态处理

合并动作：

1. 优先按顺序合并远端分支，例如 `git merge --no-ff origin/codex/foundation-platform`
2. 发生冲突时先记录冲突文件，不直接粗暴取一边
3. 冲突解决必须保留双方业务能力，尤其是 Prisma schema、shared DTO、API client 和 store-rental service 的新增能力
4. 若无法明确判断 PRD/原型归属，先停止合并并记录待确认，不自行编造需求

合并后：

1. 更新对应 `docs/branch-worklogs/门店租赁MVP集成.md` 合并记录
2. 重新执行 PRD/原型偏离审计，确认合并结果没有新增无依据可见功能
3. 运行验证命令
4. 验证通过后提交一次集成提交
5. 推送 `codex/integration/store-rental-mvp`
6. 只在合并稳定后再更新全局台账和技术文档

## 验证清单

基础命令：

```powershell
npm run build -w @store-rental/shared
npm run build -w @store-rental/api
npm run build -w @store-rental/admin
npx prisma validate --schema apps/api/prisma/schema.prisma
git diff --check
```

如果使用根脚本：

```powershell
npm run db:validate
npm run build
```

本地 MySQL 跑通清单：

1. 确认 `.env` 或本地环境变量指向 MySQL，例如 `DATABASE_URL=mysql://user:password@127.0.0.1:3306/store_rental_mvp`
2. 确认 MySQL 数据库已创建，字符集建议 `utf8mb4`
3. 首次运行依赖安装：`npm install`
4. 生成 Prisma Client：`npm run db:generate`
5. 校验 schema：`npm run db:validate`
6. 本地开发库执行 migration：`npm run db:migrate`
7. 写入演示/验证数据：`npm run db:seed`
8. 启动营运端和 API：`npm run dev`
9. 用 1-2 个租户验证登录、权限、基础资料、定价、订单、调度、财务/报表入口
10. 检查新增/修改页面、菜单、路由是否能对应 `docs/门店租赁开发任务.md` 的“资料依据”和“已开发内容合规审计”

注意：

- integration 分支每合并一个业务分支后都要重新跑 Prisma validate 和前后端 build。
- MySQL migration/seed 的真实执行结果必须记录到本文件，不能只记录命令。
- 如果独立 worktree 没有 `node_modules`，需要先执行 `npm install`；否则 build 会因为缺依赖失败。

## 全局台账更新规则

业务分支职责：

- 只更新自己的 `docs/branch-worklogs/<branch>.md`
- 记录本分支实现项、PRD/原型依据、接口、数据库表、验证命令、未完成项
- 不直接改全局台账，减少并行冲突

integration 分支职责：

- 合并各业务分支后统一更新 `docs/门店租赁开发任务.md`
- 同步更新 `docs/技术开发指南.md`
- 同步更新 `docs/AI_HANDOFF.md`
- 必要时补充 `docs/数据库启动与初始化.md` 的 MySQL migration/seed 说明
- 全局文档必须写清楚“已合并且验证通过”和“分支已完成但未合并”的区别

## 后续监控项

当前没有等待推送的既有功能分支；所有已拆功能分支均已合入 `codex/integration/store-rental-mvp`。

继续开发时按已有分支承接：

- 平台底座深化：`codex/foundation-platform`、`codex/infra-adapters`
- 站点车辆深化：`codex/fleet-ops`
- 定价营销深化：`codex/pricing-marketing`
- 订单履约深化：`codex/order-fulfillment`
- 客户财务深化：`codex/customer-finance`
- 调度异常深化：`codex/dispatch-exception`
- 报表运维深化：`codex/reports-ops`

## 2026-06-09 多分支目标分发记录

本轮继续使用既有 worktree 和既有分支，不再创建新的 `codex/next-*` 分支。分发原则：

- 每个 worker 只在指定 worktree 内开发，不能修改 PRD、原型、业务知识库。
- 所有业务实现必须先读 `docs/门店租赁开发任务.md`、`docs/AI_HANDOFF.md`、`docs/技术开发指南.md` 和本分支工作日志。
- 有 PRD 的按 PRD 做业务规则，有原型的按原型做页面；无独立 PRD 的基础功能按原型字段、交互和当前系统权限规则落地。
- 前后端同步开发，涉及持久化时同步补 Prisma/MySQL、repository/service/controller/API client/页面。
- 每个 worker 完成后必须更新自己的 `docs/branch-worklogs/<branch>.md`，并说明验证命令、提交哈希和未完成项。

| 分支 | worktree | worker | 本轮目标 | 当前监控状态 |
| --- | --- | --- | --- | --- |
| `codex/order-fulfillment` | `.worktrees/order-fulfillment` | `019ea8a6-14ba-7ab3-bfd7-5424847b6507` / Hubble | OR-15 合同与单据，按 `official_vehicle_contracts.html` 和订单详情合同区补模板、订单关联、打印下载、mock 签署状态，要求前后端和 MySQL 同步 | 已分发，等待 worker 提交和验证结果 |
| `codex/customer-finance` | `.worktrees/customer-finance` | `019ea8a6-29ae-7001-9980-dea7b9b4c72e` / Chandrasekhar | OR-16 预授权与押金、OR-17 发票与收据、OR-20 人工调账中选择当前缺口最大的闭环项推进，要求财务/客户域真实落库 | 已分发，等待 worker 提交和验证结果 |
| `codex/fleet-ops` | `.worktrees/fleet-ops` | `019ea8a6-3e62-79a1-8dda-a1da311a205f` / Dirac | MD-10 车辆调拨、MD-11 车务看板、MD-16 站点容量与排队中选择当前缺口最大的闭环项推进 | 已分发，等待 worker 提交和验证结果 |
| `codex/foundation-platform` | `.worktrees/foundation-platform` | `019ea8a6-535c-7fe3-9586-2c75f2c40b34` / Euler | PF-18 接口契约或 PF-22 搜索与筛选预设，优先落 OpenAPI/DTO 契约或通用筛选视图 MySQL 持久化 | 已分发，等待 worker 提交和验证结果 |
| `codex/dispatch-exception` | `.worktrees/dispatch-exception` | `019ea8a6-68d5-70e2-86ee-b0237fe73ac9` / Harvey | OR-18 操作锁与幂等、OR-22 客户通知留痕或调度异常任务池中选择当前最能闭环的一项 | 已分发，等待 worker 提交和验证结果 |
| `codex/infra-adapters` | `.worktrees/infra-adapters` | `019ea8a6-7d97-7551-827a-d766880e790e` / Rawls | 历史派发记录。PF-13/PF-15/PF-16 曾纠偏为底层预留；后续用户要求恢复独立页面、菜单和路由 | 已回收；独立入口已恢复 |
| `codex/pricing-marketing` | `.worktrees/pricing-marketing-round2` | `019eac05-057c-73f3-9dce-eb023d23da98` / Meitner | PR-03 动态调价、PR-04 行销方案、PR-05 报价快照解释的后续深化 | worker 启动后因会话 token 失效退出，未产出可合并结果；该 worktree 仍保留既有未提交改动，禁止直接合并 |
| `codex/reports-ops` | `.worktrees/reports-ops` | 未启动新 worker | 订单、车辆、客户、财务、调度报表和导出任务深化 | 受当前子智能体线程上限影响，等待线程释放后再分发 |

监控动作：

1. 定期等待上述 worker 返回最终结果。
2. 对每个完成分支检查 `git status --short`、最新提交、验证命令和分支工作日志。
3. 分支结果稳定后再按本文件“合并顺序建议”进入 `codex/integration/store-rental-mvp`。
4. 合并后统一更新全局台账、技术文档、交接文档和 MySQL 验证记录。

### 2026-06-09 回收与补派记录

已完成但尚未合入集成主线：

| 分支 | 提交 | 完成项 | 验证摘要 | 集成状态 |
| --- | --- | --- | --- | --- |
| `codex/foundation-platform` | `2ac0a52` | PF-18 接口契约第一版，新增 OpenAPI 文档、契约校验脚本和 `/openapi` 入口 | `contract:validate`、API build、全量 build、db validate、diff check 通过 | 已合并：`22863e9` |
| `codex/foundation-platform` | `353e735` | PF-22 搜索与筛选预设，新增 MySQL `FilterPreset`、平台筛选预设接口、OpenAPI 契约和订单/车辆列表保存视图入口 | db generate、Prisma validate、shared/API/admin/full build、contract validate、diff check 通过 | 已合并：`22863e9` |
| `codex/fleet-ops` | `fa2b9fb` | MD-16 站点容量与排队，新增容量快照刷新、队列、预计等待和 MySQL 字段 | shared/API/admin/build/db validate/diff check 通过 | 待后续合并 |
| `codex/fleet-ops` | `aa81b05` | MD-10 车辆调拨生命周期，补确认、出发、到达、取消、容量重校验、车辆位置回写、操作日志和前端动作 | shared build、db generate、API/admin build、diff check 通过；db validate 因环境额度未补跑 | 待后续合并 |
| `codex/infra-adapters` | `4f37e7e` | PF-13 导入导出/打印基础补强；独立前端入口曾下线，后续已按用户要求恢复 | `npm install`、db generate、全量 build、db validate 通过；integration 已执行恢复 | 已恢复独立入口 |
| `codex/infra-adapters` | `d5172c3` | PF-15 企业合同附件第一版；独立附件中心曾下线，后续已按用户要求恢复 | db generate、full build、diff check 通过；db validate 因环境额度未补跑；integration 已执行恢复 | 已恢复独立入口 |
| `codex/pricing-marketing` | `b726a1b` | PR-03/PR-05 动态调价试算入口，复用真实报价接口展示价格版本、行销版本、规则链和分段 | shared/API/admin build、db generate、db validate、diff check 通过 | 待后续合并 |
| `codex/customer-finance` | `1bd8bec` | OR-16 预授权与押金台账第一版，新增冻结、释放、扣款、押金台账和财务中心入口 | db generate、shared/API/admin/full build、Prisma validate、diff check 通过 | 待后续合并 |
| `codex/customer-finance` | `855b5f4` | OR-17 发票/收据补开与重开关联，补财务中心入口、schema/migration、repository/service/shared 文档 | db generate、full build、diff check 通过；db validate 因环境额度未补跑 | 待后续合并 |
| `codex/dispatch-exception` | `f6990b0` | OR-18/OR-22 订单操作记录和客户通知留痕第一版，新增订单操作/通知记录表、接口和调度页入口 | shared/API/admin/full build、Prisma validate、diff check 通过 | 待后续合并 |
| `codex/order-fulfillment` | `bb44e93` | OR-15 合同与单据 MVP，新增合同单据独立页、订单详情合同区、模板/打印/签署 mock 边界 | shared/API/admin/full build、db validate、diff check 通过 | 待后续合并 |
| `codex/order-fulfillment` | `eb40a02` | OR-19 订单备注与跟进第一版，新增订单备注/跟进表、接口、订单详情入口和文档 | shared/API/admin/full build、diff check 通过；Prisma validate 因环境额度未补跑 | 待后续合并 |
| `codex/reports-ops` | `d93f614` | RP-01/RP-02 报表导出任务补强，后端生成真实 CSV、落 `ReportExportJob` 并提供下载接口 | db validate、reports test、full build、diff check 通过 | 待后续合并 |

当前保留 worker：

| 分支 | worktree | worker | 本轮任务 | 状态 |
| --- | --- | --- | --- | --- |
| `codex/fleet-ops` | `.worktrees/fleet-ops` | `019eab99-e5f3-7592-91f7-4b7b67a296d9` / Copernicus | MD-15/MD-16/MD-11 中选择有 PRD/原型依据的车辆站点闭环切片，依据 `服务站点管理.md`、`门市租赁调度边界与履约规则.md`、`stations.html`、`vehicle_status_list.html`、`vehicle_console.html` | 合入 integration 时冲突，已停止；冲突文件：`apps/admin/src/api/client.ts`、`docs/门店租赁开发任务.md`、`docs/技术开发指南.md` |
| `codex/order-fulfillment` | `.worktrees/order-fulfillment` | `019eab9a-27c9-70a2-89b7-721507dd937e` / Beauvoir | OR-06/OR-07/OR-18/OR-19 中选择订单履约闭环切片，依据订单取车/还车/详情/费用 PRD 和 `order_detail.html` | 合入 integration 时冲突，已停止；冲突文件：`apps/admin/src/api/client.ts`、`apps/admin/src/router.ts`、`apps/api/src/modules/store-rental/store-rental.repository.ts`、两份全局文档 |
| `codex/reports-ops` | `.worktrees/reports-ops` | `019eab9a-6c91-7851-a02c-532b6c15cdf6` / Tesla | RP-01/RP-02/RP-03 中选择已有 `/reports` 报表深化切片，依据订单/调度 PRD 和营运端相关原型 | 已分发，要求先合入 `origin/codex/integration/store-rental-mvp@28233eb`；若冲突立即停止 |

已关闭 worker 记录：

| 分支 | worktree | worker | 停止状态 |
| --- | --- | --- | --- |
| `codex/foundation-platform` | `.worktrees/foundation-platform` | `019eab8c-7b18-7cd2-8c5f-24d64f93212d` / Hume | 已关闭；worktree 留有未提交数据权限改动，未验证、未提交、未推送 |
| `codex/fleet-ops` | `.worktrees/fleet-ops` | `019eab8c-bdc8-7d72-9392-9047571796df` / Pascal | 已关闭；只执行 status/fetch，worktree 干净 |
| `codex/pricing-marketing` | `.worktrees/pricing-marketing-round2` | `019eab8d-0673-7881-8a9e-09f1f983bedc` / Galileo | 已关闭；worktree 留有未提交报价快照相关改动，未验证、未提交、未推送 |
| `codex/pricing-marketing` | `.worktrees/pricing-marketing-round2` | `019eac05-057c-73f3-9dce-eb023d23da98` / Meitner | 已关闭；会话 token 失效退出，未产生可用结果 |
| `codex/order-fulfillment` | `.worktrees/order-fulfillment` | `019eab8d-43b3-7581-8094-cce032d4f286` / Archimedes | 已关闭；未产生改动，worktree 干净 |
| `codex/customer-finance` | `.worktrees/customer-finance` | `019eab8d-8667-7f73-ae7b-7fceb0478733` / Herschel | 已关闭；worktree 处于 merge conflict，禁止继续开发或合并，需后续单独处理 |
| `codex/dispatch-exception` | `.worktrees/dispatch-exception` | `019eab8d-c696-71a0-934e-d753010e5960` / Godel | 已关闭；worktree 处于 merge conflict，禁止继续开发或合并，需后续单独处理 |

### 2026-06-09 恢复后 worktree 状态

| 分支 | 当前状态 | 下一步 |
| --- | --- | --- |
| `codex/integration/store-rental-mvp` | 干净，最新提交 `28233eb`，历史入口已恢复并推送 | 可作为后续合并基线 |
| `codex/fleet-ops` | 干净 | 可继续派发车辆/站点任务 |
| `codex/order-fulfillment` | 干净 | 可继续派发订单履约任务 |
| `codex/reports-ops` | 干净 | 可补派报表深化任务 |
| `codex/foundation-platform` | 有未提交数据权限改动 | 先隔离，待审计后决定保留、重做或清理 |
| `codex/pricing-marketing` | 有未提交报价快照改动 | 先隔离，待审计后决定保留、重做或清理 |
| `codex/customer-finance` | merge conflict | 禁止继续派发；后续需先完成冲突处理或重建干净 worktree |
| `codex/dispatch-exception` | merge conflict | 禁止继续派发；后续需先完成冲突处理或重建干净 worktree |
| `codex/fleet-ops` | merge conflict | 本轮合入 integration 产生冲突；禁止继续派发，后续需先完成冲突处理或重建干净 worktree |
| `codex/order-fulfillment` | merge conflict | 本轮合入 integration 产生冲突；禁止继续派发，后续需先完成冲突处理或重建干净 worktree |

- 已按用户要求停止保留多余子智能体；今天会话日志中可定位的 17 个 agent id 均已尝试关闭，工具返回 `not found`，说明已结束或被系统回收。
- `codex/dispatch-exception` 第二轮 Sartre / `019eaad0-b8b2-7721-9f9f-e942d43b0877` 未产生提交；其基础命令被 Windows 沙箱拦截，后续不再继续保留。
- 后续如继续并行开发，只允许“一分支一个负责人”，同一分支不得重复开新 worker。

等待线程释放后补派：

- 优先使用干净 worktree：`codex/fleet-ops`、`codex/order-fulfillment`、`codex/reports-ops`。
- 暂不继续 `codex/foundation-platform`、`codex/pricing-marketing`、`codex/customer-finance`、`codex/dispatch-exception`，直到未提交改动或冲突完成审计。

## 本轮结果

- 已使用独立 integration worktree 完成所有既有功能分支合并。
- 每合并一个功能分支后均执行 `npm run db:generate`、MySQL Prisma validate、shared/API/admin build；`reports-ops` 额外执行 `node tests/reports-metrics.test.cjs`。
- 所有合并结果已推送到 `origin/codex/integration/store-rental-mvp`。
- 用户提醒后，已停止并清理本轮误开的 4 个空 `codex/next-*` 分支和 worktree，后续不再扩散新分支。
- 用户指出通知、附件打印、异步任务、外部接入和安全基线等独立页面缺少明确 PRD/原型依据；本轮曾纠偏下线这些独立营运端菜单和路由，随后用户要求恢复成原来的样子，当前已恢复页面、菜单、路由和前端 API。
- 本轮继续补平台底座：新增营运端“组织架构”独立页面，复用 `employees.html` 组织树/部门管理交互，新增 `/platform/organizations` 创建、编辑、启停接口，MySQL `OrganizationUnit` 增加 `status` 字段并写平台审计。
- 本轮继续收口 PF-22：会员列表接入会员状态、审核状态筛选预设；企业客户列表接入企业状态、合同状态筛选预设；订单、车辆、会员、企业客户四类核心列表均具备保存视图、设默认、删除和默认视图自动应用。
- 本轮按用户最新优先级继续补真实业务功能：会员、车辆、站点、企业客户四类基础资料列表已接后端分页/筛选，内存模式和 `STORE_RENTAL_DATA_SOURCE=mysql` 模式均返回分页结果；旧数组调用保留给新建订单、订单详情、调度、TBox 和调拨等既有流程。
- 本轮按用户要求停止继续做契约优先，回到基础功能闭环：个人会员管理页已按 `members.html` 补新增/编辑弹窗，编辑先拉详情回填完整资料，新增/编辑均调用真实 `POST/PUT /store-rental/members`，保存后刷新分页列表。
- 本轮继续补客户等级方案与新建订单报价联动：等级方案保存增加后端校验，个人订单报价读取启用等级方案并生成租金折扣、押金折扣、费用项、报价说明和会员权益快照；企业/月结订单不使用个人会员权益。
- 本轮继续补 PR-01/PF-23：门市租赁业务规则保存改为生成新历史版本，新增规则版本列表/详情 API、OpenAPI 契约、MySQL `RentalRuleSet` 仓储、规则页当前版本卡片和历史版本只读详情弹窗；报价入口刷新当前规则版本，保证后续订单快照绑定真实规则版本。

## 本轮 baseline 验证记录

依赖准备：

- 独立 worktree 初始没有 `node_modules`，首次 `npm run build -w @store-rental/shared` 因 `tsc` 不存在失败。
- 已执行 `npm install`，安装成功；npm audit 提示 25 个既有依赖风险，未在本轮处理。
- 已执行 `npm run db:generate`，Prisma Client 生成成功。

通过项：

- `npm run build -w @store-rental/shared`
- `npm run build -w @store-rental/api`
- `npm run build -w @store-rental/admin`
- `npm run build`
- `npm run contract:validate`
- `$env:DATABASE_URL='mysql://root:root@127.0.0.1:3306/store_rental_mvp'; npm run db:validate`
- `git diff --check`

说明：

- `npm run build -w @store-rental/admin` 有 Vite CJS API deprecated 和 chunk 超 500 kB 警告，不影响本次 baseline 通过。
- 本轮 `npm run contract:validate` 覆盖 169 个控制器操作。
- 直接执行 `npm run db:validate` 时因未配置 `DATABASE_URL` 失败；注入占位 MySQL URL 后 schema validate 通过。
- 本轮没有执行 MySQL migration/seed，因为未配置真实本地 MySQL 账号和数据库；后续集成合并后需要按上方 MySQL 跑通清单执行并记录实际结果。
