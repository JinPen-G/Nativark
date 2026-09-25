# Rental OS

面向多品类实物租赁的多租户 SaaS 平台。系统以一套通用租赁内核（Rental Core）支撑摄影设备、露营装备、车辆载具和工程设备四类经营，品类之间的差异通过经营空间的业务规则和按需启用的能力（capability）实现，代码中不做品类分支。

目前已交付运营管理端、后台 API、客户端与员工端两个微信小程序、租户消费者官网以及平台营销官网。租赁内核、下单流程和在线支付适配器（境内支付宝/微信、境外 Stripe 多币种）均已开发完成，正在逐步接入真实的 AppID、收单账户、短信与文件服务，并进行真机与真库验收；独立移动 APP 尚未启动。开发从[开发任务总索引](docs/多品类租赁平台开发任务.md)进入各分册。

各端的构建与配置说明见其各自的 README：[客户端小程序](apps/miniprogram/README.md)、[员工端小程序](apps/staff-miniprogram/README.md)、[租户消费者官网](apps/tenant-website/README.md)、[平台营销官网](apps/website/README.md)。

## 目录

- [核心概念](#核心概念)
- [内核与能力](#内核与能力)
- [仓库结构](#仓库结构)
- [架构约束](#架构约束)
- [本地开发](#本地开发)
- [测试](#测试)
- [运维](#运维)
- [已知限制](#已知限制)
- [文档](#文档)

---

## 核心概念

系统有三层身份，在需求、代码和数据中含义一致：

| 概念 | 含义 | 数据边界 |
| --- | --- | --- |
| SaaS 租户 tenant | 使用本系统经营租赁业务的商户 | 同一租户对应一个小程序；客户账号、主档、会员状态、免费方案在租户内共享 |
| 经营空间 workspace | 租户下的经营单元，每个空间只经营一种品类 | 商品、资产、库存、地点、定价、订单、优惠券、资金、报表按空间隔离 |
| 租赁客户 customer | 向商户租用设备的个人或企业 | 同一客户在不同租户下的数据、权益、优惠券相互隔离 |

```text
SaaS 租户
├─ 经营空间 A（摄影设备）——独立的商品、资产、价格、订单
├─ 经营空间 B（露营装备）——独立的商品、资产、价格、订单
└─ 运营账号通过成员关系进入一个或多个空间，可在不同空间拥有不同角色
```

三条数据规则：

- 订单、库存、价格、优惠券、资金、报表等经营事实同时携带 `tenantId` 和 `workspaceId`；租户共享的客户与会员数据不按空间复制，也不能借此开放跨空间的经营数据。
- 租户身份和当前空间只来自服务端已验证的会话，不采信客户端提交的 `tenantId` / `workspaceId`。
- 一个业务会话同时只有一个当前空间。运营端切换空间会重新校验成员资格；客户端切换服务空间不再入会，但由服务端校验目标空间、更新会话并清空旧空间缓存。

租户会员以 `CustomerMembership` 表达，唯一键为 `(tenantId, customerId)`，注册策略、审核和企业员工关系归属租户。每条已实现的金额权益带 `scope`（`tenant` / `workspaces` / `categories`），指定列表非空且空间归属由服务端校验；个人与企业分别取当前有效方案，按预约身份择一，同类减免取最大值、不叠加，历史订单按快照金额结算、不随方案变化重算。会员维护权限与验收状态以任务台账 `MEMBER-TENANT-01` 为准，本文不作为生产放行依据。

品类在空间创建时确定。空间一旦产生商品、资产或订单，就不能再通过常规设置切换品类，更换品类等同于新建空间或执行一次显式的数据迁移。

## 内核与能力

四个品类平级，都基于同一个 Rental Core 模型：`camera`（摄影设备）、`camping`（露营装备）、`vehicle`（车辆载具）、`construction`（工程设备）。车辆载具不是附加或兼容品类。

通用能力统一实现一次：商品组与套装、序列化资产与数量库存、报价、订单与生命周期、履约地点、营业日历、价格与优惠、押金与预授权、检查与异常、结算与报表。

品类专有或可跨品类复用的功能封装为能力（capability），目前注册 18 个：

- 全品类：`serialized_inventory`、`quantity_inventory`、`bundle_inventory`、`pickup`、`return`、`delivery`、`locker`、`usage_reading`、`qualification`
- 限定品类：`dispatch`、`iot`（车辆/工程），`inspection_care`（摄影/车辆/工程），`vehicle_relocation`（车辆），`construction_transport`（工程），`camera_kit_handover`、`camera_compatibility`（摄影），`camping_kit_integrity`、`camping_cleaning_turnaround`（露营）

能力由经营空间按需启用。注册表在启动阶段做一致性校验（`rental-extension-registry.ts`）：引用未注册的 code、自依赖、既依赖又互斥、依赖同品类下不适用的能力，都会在启动或测试阶段直接失败。能力的运行时挂载通过 `capability-hook.runtime.ts` 完成，内核只识别钩子、不感知具体能力。

计价单位是内核的一等概念，共 9 种：`hour`、`shift`、`day_24h`、`calendar_day`、`night`、`week`、`month`、`usage`、`package`。摄影按天、车辆按 24 小时、露营按夜、工程按班次，均由配置选择计价单位实现，没有各自独立的计费代码。

## 仓库结构

```text
apps/api               NestJS 10 + Prisma 5，统一前缀 /api
apps/admin             React 19 + Ant Design 6 + Vite 8，运营管理端
apps/miniprogram       原生微信小程序 + TypeScript，客户端（一个租户一个包，默认 demo 租户）
apps/staff-miniprogram 原生微信小程序 + TypeScript，员工端（一套包服务所有租户，登录时输入租户编码）
apps/tenant-website    React 19 + Vite 8，租户消费者官网（一套部署服务多租户）
apps/website           平台营销官网（纯静态）
packages/shared        前后端契约的唯一来源，按依赖方向拆为 core / platform / infrastructure / common
apps/api/prisma        schema.prisma 与增量迁移
scripts                契约、DTO、鉴权、管理端静态门禁，以及 scripts/ops 运维脚本
tests                  纯计算、静态契约、专项与真库 E2E 测试
docs                   需求、任务、技术、数据库与界面规范
```

每个 `apps/*` 都有独立的 README 说明自身的构建、预览和配置；本文件只讲平台整体和共同约束。

### API 模块

| 模块 | 职责 | 路由 | 规模 |
| --- | --- | --- | --- |
| `rental-core` | 当前唯一的新业务入口：目录/资产/库存、订单全生命周期、定价与优惠、日历、规则版本、资金事件、capability 治理、空间报表 | `/api/rental/v1`、`/api/platform/official-calendars` | 46 文件 / 约 22.8k 行 |
| `platform` | 租户、经营空间、组织角色账号、权限树、系统规则、安全基线、审计、字典与编号规则、租户共享客户主档与合并、会员/审核/免费方案/企业员工 | `/api/platform`、`/api/membership` | 约 9.3k 行 |
| `client` | 独立的客户认证与 session，租户会员自助、服务空间切换及本人报价/订单，不复用运营令牌 | `/api/client/v1` | 契约见客户端 API 说明 |
| `auth` | 登录、会话上下文、刷新登出、改密、切换空间 | `/api/auth` | 约 0.6k 行 |
| `integrations` | 适配器日志、支付运行时、数据交换任务、TBox 车联网设备 | `/api/integrations` | 约 1.9k 行 |
| `database` / `health` / `files` / `jobs` / `notifications` / `openapi` | Prisma 服务、探针与桩 | 各自前缀 | 合计 < 0.2k 行 |

早期的单品类租赁模块（约 25.7k 行）和配套的 `reports` 模块（约 2.0k 行）已于 2026-09-04 整体下线，连同 57 张专用表一并删除，退役过程可在 `git log` 查询。

`rental-core` 内部按职责分层，主要文件：`rental-business.service.ts`（报价与全部金额计算，最大的文件）、`rental-core.service.ts`（订单聚合与状态机）、`*-fact.repository.ts` 与 `*-config.repository.ts`（事实与配置分开存储）、`workspace-capability.service.ts` 和 `capability-hook.runtime.ts`（能力启用与钩子运行时），以及一批纯函数计算模块：`rental-pricing-strategy.ts`、`rental-security-deposit.ts`、`rental-discount-selection.ts`、`rental-early-return.ts`、`rental-rule-defaults.ts`、`rental-money.ts`。

金额相关的计算刻意做成纯函数、与数据库访问分离，以便用不连库的专项测试逐条覆盖各种计费场景。

### 管理端

路由集中定义在 `apps/admin/src/app/navigation.tsx` 的 `APP_ROUTES`，`AppRouter.tsx` 负责懒加载与挂载。每个路由都经过 `canAccessRoute` 的四道校验：`audience`（平台面与租户面分离）、`permission`、`capability`、`categories`，全部通过才渲染。前端的菜单隐藏不替代后端数据权限，真正的边界在 API 的逐路由鉴权。

## 架构约束

以下约束都有对应的检查或机制保证，不只是文档约定；改动相关代码前建议先读这一节。

### 空间是数据边界

经营空间由 `resolveScopeWorkspaceId`（`apps/api/src/modules/rental-core/workspace-scope.ts`）解析，来源优先级固定：有请求会话时取会话空间（由认证守卫从 `auth_sessions` 写入，客户端无法伪造）；无会话的路径（seed、租户初始化、快照回填）才取租户默认空间。找不到默认空间时直接拒绝，不猜测空间 id。这里的回退发生在没有会话的初始化路径上，不参与鉴权判断，与鉴权时的危险回退不是一回事。

### 配置不可变，快照进订单

规则、价格、营业日历都是只追加的版本，发布后不可改写。报价与订单创建时把当时生效的版本 `structuredClone` 进各自的快照字段（`ruleSnapshot`、`rateSnapshot`、`calendarSnapshot`），之后无论配置如何变化，历史订单复算的结果不变。

由此对新代码有一条要求：向 `RentalRuleConfig` 新增规则块必须是可选的，读取统一走 `rental-rule-defaults.ts` 的 `effective*Rule` 缺省解析，且缺省值必须等于新增字段之前的行为，否则存量订单会在配置未改的情况下改变金额。缺省集中在一个模块，是为了让报价侧和订单侧取到同一份。

### 订单金额只有一个入口

对订单金额的任何改动都走 `applyChargeTo`（`rental-core.service.ts`）：按 `code` 去重追加费用明细，累加 `adjustmentAmount`，推导 `finalPayableAmount` 与 `totalAmount`，再重算价内税。绕过它直接改字段会导致总额变化无法追溯到具体费用。

需要维持的不变量：押金不是费用明细。非押金明细之和等于 `payableAmount`；押金与预授权是独立字段，一个需退还、一个只是冻结，都不计入本次交易收入。价内税是应收金额的拆分而非追加，因此存在标量列、不进明细。

金额取整只有一个实现：`rental-money.ts` 的 `roundMoney`，带 `Number.EPSILON` 修正舍入边界，不要再写裸的 `Math.round(x * 100) / 100`。

### 品类差异只能是配置

通用页面与计算模块中不允许出现 `if (categoryCode === ...)` 这类分支。例如车辆「提前一天以上还车才退租金」与摄影「提前即退」的差异，由空间规则的 `minAdvanceHours` 表达，而非两段代码。当前计费与计算模块无品类分支，`categoryCode` 只用于状态按空间归档和一致性校验；新增品类时只需在品类定义里补充术语与导航配置。

### 资金写入必须幂等

所有涉及资金的写路径都走 `RentalIdempotentActionService.execute`。`fallbackKey` 不能包含当前状态：状态写进键后，重放时状态已变、键随之改变，幂等就失效了。键应按业务动作构造，例如续租的键包含目标归还时间，因为延长到不同时间是不同的业务。

### 契约与鉴权逐条校验

四个静态门禁用于防止静默失败，前三个由 `npm run contract:validate` 串起，第四个是 `npm run test:admin`：

| 脚本 | 作用 |
| --- | --- |
| `validate-api-contracts.cjs` | 校验控制器路由与 OpenAPI 文档逐条对齐，覆盖全部操作 |
| `validate-dto-coverage.cjs` | 全局 `ValidationPipe` 开启 `whitelist: true`，会剥离没有校验装饰器的属性，而 `implements` 无法阻止（TS 只要求实现必填成员），因此 DTO 漏声明一个可选字段会造成请求成功但数据静默丢失。脚本用编译器 API 静态比对：`class X implements Y` 中 Y 的每个成员都必须在 X 上声明并带至少一个校验装饰器 |
| `validate-route-permissions.cjs` | 兜底权限已从早期的 `return []`（空数组直接放行）改为默认拒绝，脚本进一步确保新增路由不漏配权限，全部路由需命中显式规则或公共白名单 |
| `validate-react-admin.cjs` | 保证管理端的结构约定（外壳、导航、鉴权包装、样式基线）不被局部改动绕过 |

## 本地开发

```bash
cp .env.example .env
docker compose up -d mysql redis
npm install
npm run db:generate
npm run db:validate
npm run dev
```

- API：`http://localhost:3000/api`（`API_PORT` 可改）
- 管理端：`http://localhost:5175`（`REACT_ADMIN_PORT` 可改），`/api` 经 Vite 代理到 API
- 部署在反向代理之后时设置 `TRUST_PROXY_HOPS=<可信跳数>`（对应 Express `trust proxy`），否则限流看到的来源地址会是代理地址；不设或设 0 表示直连、忽略 `X-Forwarded-For`

`npm run dev` 会先构建 `packages/shared`，再并行启动 API 与管理端。两端引用 shared 的方式不同：API 依赖编译产物 `dist/`，管理端 Vite 把 `@rental-os/shared` 直接指向 `src/index.ts`。因此改动契约后，管理端热更新立即生效，而 API 需要重新构建 shared 才能识别；测试脚本也读 `dist/`，所以每个 `test:*` 都会先构建 shared。

Windows 上执行 `prisma generate` 前需先停掉 API 开发服务器，否则 `query_engine-windows.dll.node` 被占用会导致 EPERM。

### 微信小程序

```bash
npm run build:miniprogram           # 本机联调构建：按 src/config/public.ts 常量打包（默认 demo 租户 + http://localhost:3000），产物在 apps/miniprogram/dist
npm run build:miniprogram:release   # 发布构建：apiOrigin 必须是 HTTPS 根地址，任何 http（含回环）一律拒绝
npm run test:miniprogram            # 36 项静态/宿主替身测试：页面/Tab/组件结构、WXSS/WXML 语法、数据绑定与组件属性、无密钥、构建模式、401 刷新、切换丢弃、清单幂等、支付单复用与 JSAPI 校验、时区、状态分组、契约对账
```

一个租户一个包。换租户只需修改 `apps/miniprogram/src/config/public.ts` 的 `tenantCode`（首版绑定演示租户 `demo`，与 `npm run db:seed:demo` 一致）；正式发布时把 `apiOrigin` 改为 HTTPS 地址、填入该小程序的 `appId`，再执行 `npm run build:miniprogram:release`。环境变量 `MINIPROGRAM_TENANT_CODE` / `MINIPROGRAM_API_ORIGIN` / `MINIPROGRAM_APP_ID` 仅在显式设置时覆盖代码常量，供 CI 批量打包。包通过租户编码确定商户，商户名称、Logo、客服、协议、帮助等展示内容来自租户级客户端渠道配置；AppSecret 只保存在服务端 `mini_program_channels` 的加密列，不进小程序包。

工程分层：`src/config/public.ts`（包内唯一部署配置，全部公开）、`src/core/*`（请求、会话、清单、支付、状态、时区、路由、收藏、目录缓存）、`src/api/*`（客户端 API 封装）、`src/contracts/planned.ts`（已交付契约清单与静态对账入口）、`src/pages/*`（22 页 / 4 Tab）、`src/components/*`（7 个组件）、`src/assets/*`（品牌 Logo 与 Tab 图标，由 `scripts/generate-assets.cjs` 生成）。共享契约只允许 `import type`，构建会拒绝运行时依赖。

页面按 V2 设计稿实现，覆盖首页、分类、设备详情、确认订单、订单列表、我的等主要流程。用微信开发者工具导入 `apps/miniprogram`（工程根目录含 `project.config.json`，代码目录为 `dist/`）；没有正式 AppID 时选测试号，并在「详情 → 本地设置」勾选不校验合法域名。本机联调需先 `npm run dev` 启动 API 并执行过 `npm run db:seed:demo`；联调构建会在 `dist/config/public.json` 写入 `allowLocalApi: true`，仅放宽回环地址，发布构建不带该标记。

小程序已接通首期主要客户端 API：微信手机号登录、短信验证码登录、账号密码登录与注册、注销、游客目录、目录与参考起价、报价、下单、地址簿与配送地址快照、本人订单、取消预览与取消、续租、检查费用确认与异议、资金状态、微信 JSAPI 支付、资料、会员、资质、优惠券。运营后台的「客户端渠道」页支持租户维护品牌、客服、协议、帮助、横幅和发布服务。剩余的真库、真实 Provider 与宿主任务以[客户端共用开发任务](docs/开发任务/客户端共用开发任务.md)和[微信小程序开发任务](docs/开发任务/微信小程序开发任务.md)为准。

版本：Nest 10.4.15 / Prisma 5.22.0 / React 19.2.8 / antd 6.6.0 / Vite 8.2.1。根目录与 API 使用 TypeScript 5.6，管理端固定 7.0.2；仓库未声明 `engines`，开发环境按 `@types/node ^22` 对齐。迁移与 Seed 见[数据库启动与初始化](docs/数据库启动与初始化.md)。账号、密码、token、密钥一律不进仓库文档。

## 测试

默认门禁：

```bash
npm run test:rental-foundation
```

该命令串起 23 个步骤：三个工作区的类型检查、管理端结构门禁、契约/DTO/鉴权三件套、Prisma schema 校验、seed 类型检查，以及计价策略、调价、Core 订单、日历范围、capability（注册表/钩子/器材）、扩展一致性、摄影兼容、业务报价、状态持久化、SaaS 基础、租户隔离、报表指标、提前归还、续租延期、价内税、结算币种等专项。

以下内容不在默认门禁内，需单独运行：

```bash
npm run test:mysql-e2e          # 真库 E2E：租户隔离、外键、唯一约束、过期预占
npm run test:report-workspace   # 空间报表（需专用库，脚本会拒绝在共享库上运行）
npm run test:customer-master    # 客户主档系列（另有 operations/corporate/merge/admin/order-subjects）
npm run test:ui-nav             # 管理端动态术语
npm run test:ops-dedicated      # 运维专项（另有 ops-release / ops-upgrade）
npm run test:coupon-budget-mutation      # 变异测试：摘除约束后测试必须失败
npm run test:rule-version-chain-mutation
```

多数专项测试使用 `tests/helpers/absorbing-config-store.cjs`（读返回空、写丢弃）来跑不连库的纯计算，它刻意不实现查询语义：模拟 Prisma 的外键、唯一约束和事务回滚，容易造成「对假实现通过、对真 MySQL 失败」的分叉，项目此前的一次跨租户泄露就曾被内存固件掩盖。因此租户隔离、外键完整性、唯一约束、过期预占过滤这类断言只放在 `tests/mysql-e2e.test.cjs`，纯计算专项不覆盖。

变异测试（`*-mutation`）用于验收：脚本摘除一处约束后重新运行测试，测试必须因此失败，以确认测试确实在检验目标约束。

涉及数据库的改动，除运行命令外还需实际验证五项：空库部署、已有库升级、Seed 幂等、重启恢复、双租户并发隔离。

## 运维

`scripts/ops/` 是一组运维脚本，按「先只读、再写入、最后才操作服务」分层，默认 fail-closed：

| 命令 | 作用 |
| --- | --- |
| `npm run ops:preflight` | 发布或恢复前的只读环境预检，任一项不通过即以非零退出 |
| `npm run ops:migration-status` | 只运行 `prisma validate` 和 `migrate status`，不顺带应用迁移 |
| `npm run ops:backup` | 导出专用库，并校验文件非空、退出码为 0、含结束标记，避免把 0 字节文件当作备份成功 |
| `npm run ops:restore-drill` | 恢复到新建的演练库并校验；向源库恢复属于事故处置，不用于验证备份 |
| `npm run ops:restore-source` | 用升级前的历史备份构造一个落后于当前 schema 的源库，否则 `migrate deploy` 无迁移可应用 |
| `npm run ops:upgrade-drill` | 在克隆库上完整演练：验证备份 → 恢复 → `migrate deploy` → 独立端口启动 API → 健康检查 → 从同一备份恢复回滚库 → 输出人工切换步骤 → 清理 |
| `npm run ops:release-build` | 生成发布构建并将产物绑定到当前 Git 提交 |
| `npm run ops:release-gate` | 对发布候选运行只读门禁，默认 dry-run，写清单需显式加 `--emit` |

所有运维脚本的连接信息只来自 `DATABASE_URL`，目标库必须显式为专用库，共享库和生产库名一律拒绝。

到期任务调度：API 进程内置 `RentalDueJobScheduler`，默认每 60 秒（`RENTAL_DUE_JOB_INTERVAL_MS`，毫秒，最小 1000）遍历每个经营空间，依次处理待支付过期、领取逾期/爽约核对、通知重试、到期价格调整；`RENTAL_DUE_JOBS_DISABLED=1` 或 `NODE_ENV=test` 时不启动。多实例部署无需改表：每个「任务 × 租户 × 空间」用 MySQL 命名锁 `rental-os:due:<job>:<tenantId>:<workspaceId>` 互斥，拿不到锁即跳过本轮，单轮每空间每任务最多处理 50 单。手动接口（`orders/expire-pending`、`orders/reconcile-pickup-overdue`、`notification-logs/retry-due`、`pricing-plans/adjustments/run-due`）保留给运维补偿，与调度器共用幂等键。

## 已知限制

- 早期单品类租赁域已于 2026-09-04 整体退役：旧 API 路由、业务模块、管理端 8 个页面、两个 API 客户端的 182 个遗留函数以及 57 张专用表全部删除，权限码统一使用 `rental-os:*` 命名空间。
- 在线支付适配器已实现但需真实凭证才生效：境内支付宝/微信、境外 Stripe（多币种）已接入 `PaymentRuntimeService`（下单、查单、退款、回调验签、连接测试），收单平台按经营空间结算币种过滤（境内为支付宝/微信 CNY，境外为 Stripe 的 HKD/SGD/USD/EUR）。每个租户需在后台配置真实密钥并通过 live 连接测试后才走真实收款，demo 与未配置的租户仍为 offline/simulation。押金、预授权、通知目前仍是模拟的，状态使用 `simulated` 或同等语义，不记录或展示为真实的冻结、发送、送达。
- 不做跨空间汇总：跨空间的订单、收入、库存、客户消费汇总不在当前阶段，未来实现也只能基于明确的租户级查询权限。
- `tests/mysql-e2e.test.cjs` 中仍有历史专用段落（7 处、约 49 行）。它需要专用库、不在默认门禁内，本轮未改动；修改这个约 1 万行的真库 E2E 需要一次专门的带库会话。
- `requiredCapability` 目前只映射两个已删除的历史调度/T-Box 前缀。守卫层的能力门禁机制本身有效，并被 `extension-consistency` 的变异测试覆盖，因此保留；将它重新指向一个现行路由是一个产品决定。
- `rental_os` 数据库基线已完成迁移收口：新命名迁移已执行，旧分支的失败迁移记录已清理；运行时使用 `rental_os` 数据库和账号，原库仅作受保护回退。租户统一会员改造的部署与验收见 `MEMBER-TENANT-01`。
- 区间利用率在数据层不存在：资产与库存只有当前状态、无状态变更历史，因此空间报表的资产口径是读取瞬间的快照。该说明随报表出参一起下发，页面和 CSV 导出都会显示。

## 文档

| 文档 | 定位 |
| --- | --- |
| [多品类租赁平台需求说明](docs/多品类租赁平台需求说明.md) | 平台业务规则与共同验收的权威来源，渠道细则见其第 4.11 节 |
| [客户端小程序需求说明](docs/客户端小程序需求说明.md) | 小程序完整功能蓝图，含首期页面/字段/交互/UI 细则及后续分期；进度不在需求文档维护 |
| [技术开发指南](docs/技术开发指南.md) | 架构、模块边界、权限、API、数据与开发规范 |
| [开发任务总索引](docs/多品类租赁平台开发任务.md) | 当前方向、分册入口、跨端依赖和待确认事项 |
| [后台开发任务](docs/开发任务/后台开发任务.md) | SaaS 平台、运营后台、业务内核、品类与生产运行的未完成任务 |
| [客户端共用开发任务](docs/开发任务/客户端共用开发任务.md) | 多个客户自助端共用的 API、渠道配置、支付、短信、文件与安全任务 |
| [微信小程序开发任务](docs/开发任务/微信小程序开发任务.md) | 微信小程序首期收口、真实宿主验收和后续储备 |
| [预约网站开发任务](docs/开发任务/预约网站开发任务.md) | 客户预约 Web/H5 的后续规划，与企业官网分开 |
| [APP 开发任务](docs/开发任务/APP开发任务.md) | iOS/Android APP 的后续规划与共用依赖 |
| [已完成任务归档](docs/归档/多品类租赁平台已完成任务归档.md) | 唯一历史归档，不作为当前排期 |
| [数据库启动与初始化](docs/数据库启动与初始化.md) | MySQL、迁移、Seed、备份与数据库验收；租户会员增量合并与共享库部署确认边界 |
| [客户端 API 接口说明](docs/客户端API接口说明.md) | 独立客户认证、租户会员、服务空间上下文与本人订单 API 边界 |
| [多币种收款方案调研](docs/多币种收款方案调研-20260924.md) | 跨境收单（Stripe 首发）、按结算币种适配收单平台的场景、选型与实施计划 |
| [管理端界面设计规范](docs/管理端界面设计规范.md) | 页面结构、组件用法与视觉基线 |

需求、技术、数据库和界面规范默认锁定；任务只在对应分册维护进行中和未完成项，完成后移入统一归档，README 不重复维护进度。
