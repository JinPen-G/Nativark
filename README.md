# Rental OS

面向**多品类实物租赁**的多租户 SaaS 平台。一套通用租赁内核（Rental Core）经营摄影设备、露营装备、车辆载具和工程设备，品类差异通过经营空间的业务规则与按需启用的 capability 表达，而不是靠代码里的品类分支。

当前交付**营运管理端 + 后台 API**。小程序与 App 不做页面，只保留独立、可版本化的客户端 API 边界。

---

## 1. 三层身份，别混淆

这三个词在需求、代码和数据里含义固定，读错一个后面全错：

| 概念 | 是什么 | 数据含义 |
| --- | --- | --- |
| **SaaS 租户** tenant | 用这套系统做租赁生意的**商户** | 客户主档在租户内共享 |
| **经营空间** workspace | 租户下的一个经营单元，**只经营一种品类** | 业务隔离边界：商品、资产、库存、地点、定价、订单、权益、报表全部按空间隔离 |
| **租赁客户** customer | 向商户租东西的个人或企业 | 同一客户在不同租户下的数据、权益、优惠券互相隔离 |

```text
SaaS 租户
├─ 经营空间 A（品类：摄影设备）——独立的商品/资产/价格/订单
├─ 经营空间 B（品类：露营装备）——独立的商品/资产/价格/订单
└─ 租户账号通过成员关系进入一个或多个空间，且可在不同空间拥有不同角色
```

三条硬规则：

- 所有经营事实同时带 `tenantId` 和 `workspaceId`。少带一个，跨空间数据就会汇进同一张报表，而那种错误在页面上只表现为「数字偏大」。
- 租户身份与当前空间**只能来自服务端已验证的会话**，绝不采信客户端提交的 `tenantId` / `workspaceId`。
- 一个业务会话同时只有一个当前空间；切换空间必须由服务端重新校验成员资格，并清空前一个空间的业务缓存。

品类在空间创建时确定。空间一旦产生商品、资产或订单，就不允许通过普通设置切换品类——换品类等于新建空间或做一次显式数据迁移。

## 2. 一套内核，按空间启用能力

四个正式品类：`camera`（摄影设备）、`camping`（露营装备）、`vehicle`（车辆载具）、`construction`（工程设备）。**车辆不是兼容品类**，它和其他三个平级，走同一个 Rental Core 模型。

通用的部分一次实现：商品组与套装、序列化资产与数量库存、报价、订单与生命周期、履约地点、营业日历、价格与优惠、押金与预授权、检查与异常、结算与报表。

品类独特或跨品类复用的部分做成 **capability**，当前注册 18 个：

- 全品类可用：`serialized_inventory`、`quantity_inventory`、`bundle_inventory`、`pickup`、`return`、`delivery`、`locker`、`usage_reading`、`qualification`
- 限定品类：`dispatch`（车辆/工程）、`iot`（车辆/工程）、`inspection_care`（摄影/车辆/工程）、`vehicle_relocation`（车辆）、`construction_transport`（工程）、`camera_kit_handover` 与 `camera_compatibility`（摄影）、`camping_kit_integrity` 与 `camping_cleaning_turnaround`（露营）

capability 由经营空间按需启用，注册表本身在启动期做一致性门禁（`rental-extension-registry.ts`）——依赖引用未注册的 code、自依赖、既依赖又互斥、依赖一个在同品类下不适用的能力，都在启动/测试阶段直接失败，而不是等运营在页面上点到一个点不动的开关。能力的运行时挂载走 `capability-hook.runtime.ts`：Core 不认识具体能力，只认识钩子。

计价单位是内核的一等公民，共 9 种：`hour`、`shift`、`day_24h`、`calendar_day`、`night`、`week`、`month`、`usage`、`package`。摄影按天、车辆按 24 小时、露营按夜、工程按班次，靠的是配置选择哪个单位，不是四套计费代码。

## 3. 仓库地图

```text
apps/api           NestJS 10 + Prisma 5，统一前缀 /api
apps/admin         React 19 + Ant Design 6 + Vite 8 管理端
packages/shared    前后端唯一契约来源，按依赖方向拆成 core / platform / infrastructure / common
apps/api/prisma    schema.prisma：89 model / 12 enum，87 个迁移
scripts            契约、DTO、鉴权、管理端的静态门禁 + scripts/ops 运维演练
tests              44 个 .cjs 专项，纯计算与真库 E2E 分开
docs               正式需求、技术指南、数据库与界面规范
```

### API 模块

| 模块 | 职责 | 路由 | 规模 |
| --- | --- | --- | --- |
| `rental-core` | **当前唯一新业务入口**。目录/资产/库存、订单全生命周期、定价与优惠、日历、规则版本、资金事件、capability 治理、空间报表 | `/api/rental/v1`、`/api/platform/official-calendars` | 46 文件 / 约 22.8k 行 |
| `platform` | 租户、经营空间、组织角色账号、权限树、系统规则、安全基线、审计、字典与编号规则、共享客户主档与合并 | `/api/platform`、`/api/membership` | 约 9.3k 行 |
| `auth` | 登录、会话上下文、刷新登出、改密、切换空间 | `/api/auth` | 约 0.6k 行 |
| `integrations` | 适配器日志、模拟调用、数据交换任务、TBox 车联网设备 | `/api/integrations` | 约 1.9k 行 |
| `database` / `health` / `files` / `jobs` / `notifications` / `openapi` | Prisma 服务、存活探测与桩 | 各自前缀 | 合计 < 0.2k 行 |

历史门市租赁面（`/api/store-rental/*`，25.7k 行）与门市时代的 `reports` 模块（2.0k 行）**已于 2026-09-04 整体下线**，连同 57 张只服务于它们的表。仓库里不再有这一层，`git log` 可查退役过程。

`rental-core` 内部按职责分层，值得记住的几个：`rental-business.service.ts`（报价与全部金额计算，最大的一个文件）、`rental-core.service.ts`（订单聚合与状态机）、`*-fact.repository.ts` / `*-config.repository.ts`（事实与配置分开落库）、`workspace-capability.service.ts` + `capability-hook.runtime.ts`（能力启用与钩子运行时）、以及一批**纯函数计算模块**：`rental-pricing-strategy.ts`、`rental-security-deposit.ts`、`rental-discount-selection.ts`、`rental-early-return.ts`、`rental-rule-defaults.ts`、`rental-money.ts`。

纯函数模块是刻意的：凡是「凭什么收这笔钱」需要逐条回放的计算，都不允许写在 service 里和数据库访问缠在一起，这样它才能被不连库的专项测试逐条钉住。

### 管理端

路由集中定义在 `apps/admin/src/app/navigation.tsx` 的 `APP_ROUTES`，`AppRouter.tsx` 只做懒加载与挂载。每个路由都过 `canAccessRoute`，四道闸门同时成立才渲染：`audience`（平台面与租户面严格分离）、`permission`、`capability`、`categories`。

前端隐藏不替代后端数据权限——菜单看不见只是少一次误点，真正的边界在 API 的逐路由鉴权上。

## 4. 架构约束，以及执行它的东西

这个仓库的约束**不靠文档自觉**，每一条后面都有一个会让你的改动失败的东西。改代码前先读这一节，能省掉大部分返工。

### 4.1 空间是数据边界

经营空间由 `resolveScopeWorkspaceId`（`apps/api/src/modules/rental-core/workspace-scope.ts`）解析，两条来源优先级固定：请求路径取会话空间（认证守卫从 `auth_sessions` 写入，客户端伪造不了）；无会话路径（seed、租户初始化、快照回填）才取该租户的默认空间。找不到默认空间时**明确拒绝**，不猜一个空间 id 写进去。

这里的"回退"和鉴权时的危险回退不是一回事：后者会让一个本该被拒的无空间会话拿到数据，前者发生在根本没有会话的初始化路径上，不参与任何鉴权判断。

### 4.2 配置不可变，快照进订单

规则、价格、营业日历都是**只追加的版本**，发布后不可改写。报价与订单创建时把当时生效的版本 `structuredClone` 进自己的快照字段（`ruleSnapshot`、`rateSnapshot`、`calendarSnapshot`）。之后无论配置怎么改，历史订单复算出来的还是当初那个数。

由此产生一条对新代码的硬要求：**往 `RentalRuleConfig` 加规则块必须是可选的**，并且读取一律走 `rental-rule-defaults.ts` 里的 `effective*Rule` 缺省解析。缺省值不是随便挑的，它必须**等于新增字段之前的行为**——否则存量订单会在没人改配置的情况下改变金额。缺省集中在一个模块，是为了让报价侧和订单侧取到同一份，两边各写一遍 `?? { … }` 迟早对不上。

### 4.3 订单金额只有一个入口

任何对订单金额的改动都必须走 `applyChargeTo`（`rental-core.service.ts`）：按 `code` 去重地追加一条费用明细 → 累加 `adjustmentAmount` → 推出 `finalPayableAmount` 与 `totalAmount` → 重算价内税额。绕过它直接改字段，就会出现「总额变了但说不出是哪笔钱」。

要守住的不变量：**押金不是费用明细**。非押金明细之和等于 `payableAmount`；押金与预授权是独立字段，一个要退、一个只是冻结，都不是本次交易的收入。价内税同理——税额是应收的**拆分**而不是追加，因此存在标量列里，不进明细，否则上面那个等式立刻破。

金额取整只有一个实现：`rental-money.ts` 的 `roundMoney`，带 `Number.EPSILON` 修正舍入边界（`Math.round(1.005 * 100)` 会得到 100 而不是 101）。不要再写裸 `Math.round(x * 100) / 100`。

### 4.4 品类差异只能是配置

通用页面与计算模块里**不允许** `if (categoryCode === ...)` 这类分支。汽车门市「提前一天以上还车才退租金」和摄影器材「提前就退」的差别，由经营空间规则里的 `minAdvanceHours` 表达，不是两段代码。

当前状态：计费与计算模块里没有品类分支，`categoryCode` 只出现在状态按空间归档与一致性校验上。新增品类时，只需在品类定义里补术语与导航显示配置，通用导航即可接入。

### 4.5 资金写入必须幂等

所有会动钱的写路径走 `RentalIdempotentActionService.execute`。`fallbackKey` 里**不得包含当前状态**——把状态写进键，重放时状态已变，键也就变了，幂等失效。键要按"这是哪一次业务动作"构造：续租的键包含目标归还时间，因为延长到不同时间是不同的业务。

### 4.6 契约与鉴权逐条核对

四个静态门禁——前三个由 `npm run contract:validate` 串起，第四个是 `npm run test:admin`。它们防的都是**静默失败**：

| 脚本 | 防什么 |
| --- | --- |
| `validate-api-contracts.cjs` | 控制器路由与 OpenAPI 文档逐条对齐。当前 378 个操作全覆盖 |
| `validate-dto-coverage.cjs` | 全局 `ValidationPipe` 开了 `whitelist: true`，会**剥离没有校验装饰器的属性**。`implements` 挡不住这件事（TS 只要求实现必填成员），于是 DTO 漏声明一个可选字段 = 请求成功但数据静默少一块。脚本用编译器 API 静态比对：`class X implements Y`，Y 的每个成员都必须在 X 上声明且带至少一个校验装饰器。当前 92 个 DTO 类、506 个字段 |
| `validate-route-permissions.cjs` | 兜底权限早前是 `return []`，而空数组直接放行——每个没被显式分支覆盖的路由都是无鉴权接口。兜底已改为默认拒绝，但"默认拒绝"只是把漏网路由从静默放行变成运行时 403；真正要防的是**新增路由时忘记补权限**。当前 378 条路由全部命中显式规则或公共白名单 |
| `validate-react-admin.cjs` | 管理端的结构性约定（外壳、导航、鉴权包装、样式基线）不被局部改动绕开 |

## 5. 本地启动

```bash
cp .env.example .env
docker compose up -d mysql redis
npm install
npm run db:generate
npm run db:validate
npm run dev
```

- API：`http://localhost:3000/api`（`API_PORT` 可改）
- 管理端：`http://localhost:5175`（`REACT_ADMIN_PORT` 可改），`/api` 由 Vite 代理到 API

`npm run dev` 会先构建 `packages/shared` 再并行起 API 与管理端。两端读 shared 的方式不同，值得知道：**API 依赖编译产物 `dist/`**，管理端的 Vite 把 `@store-rental/shared` 直接 alias 到 `src/index.ts`。所以改完契约，管理端热更新立刻看得到，API 却要重新构建 shared 才认——只在管理端验证过就以为改通了，是这里最容易踩的坑。测试脚本也读 `dist/`，因此每个 `test:*` 都先构建 shared。

Windows 上跑 `prisma generate` 前必须先停掉 API 开发服务器，否则 `query_engine-windows.dll.node` 被占用导致 EPERM。

版本：Nest 10.4.15 / Prisma 5.22.0 / React 19.2.8 / antd 6.6.0 / Vite 8.2.1。根与 API 用 TypeScript 5.6，管理端固定在 7.0.2。仓库未声明 `engines`，开发按 `@types/node ^22` 对齐。

迁移与 Seed 见 [数据库启动与初始化](docs/数据库启动与初始化.md)。**账号、密码、token、密钥一律不进仓库文档**。

## 6. 验证

默认门禁一条命令：

```bash
npm run test:rental-foundation
```

它串起 23 步：三个工作区的类型检查、管理端结构门禁、契约与 DTO 与鉴权三件套、Prisma schema 校验、seed 类型检查，然后是计价策略、调价、Core 订单、日历范围、capability（注册表/钩子/器材）、扩展一致性、摄影兼容、业务报价、状态持久化、SaaS 基础、租户隔离、报表指标、提前归还、续租延期、价内税、结算币种。

**它不覆盖什么，必须说清楚**——这些专项要单独跑：

```bash
npm run test:mysql-e2e          # 真库 E2E：租户隔离、外键、唯一约束、过期预占
npm run test:report-workspace   # 空间报表（需专用库，脚本会拒绝跑在共享库上）
npm run test:customer-master    # 客户主档系列（另有 operations/corporate/merge/admin/order-subjects）
npm run test:ui-nav             # 管理端动态术语
npm run test:ops-dedicated      # 运维专项（另有 ops-release / ops-upgrade）
npm run test:coupon-budget-mutation      # 变异测试：摘掉约束后测试必须变红
npm run test:rule-version-chain-mutation
```

测试风格上有一条重要边界。多数专项用 `tests/helpers/absorbing-config-store.cjs` 这个「吸收式 store」（读返回空、写丢弃）跑不连库的纯计算，它**刻意不实现查询语义**：忠实模拟 Prisma 的外键、唯一约束和事务回滚会带来「对着假实现通过、对着真 MySQL 失败」的分叉——这个项目的一次 P0 跨租户泄露正是被内存模式固件掩盖的。所以租户隔离、外键完整性、唯一约束、过期预占过滤这类断言**只放在 `tests/mysql-e2e.test.cjs`**，纯计算专项不假装覆盖。

变异测试（`*-mutation`）是验收手段：脚本摘掉一处约束再跑测试，测试**必须**因此变红。它是在测「测试本身有没有在测东西」，不是破坏代码。

涉及数据库的改动，除了跑命令还要真正验证五件事：空库部署、已有库升级、Seed 幂等、重启恢复、双租户并发隔离。

## 7. 运维演练

`scripts/ops/` 下是一套按「先只读、再写、最后才碰服务」分层的运维脚本，默认全部 fail-closed：

| 命令 | 做什么 |
| --- | --- |
| `npm run ops:preflight` | 发布/恢复前的只读环境预检，任何一项不过就退非零 |
| `npm run ops:migration-status` | 只跑 `prisma validate` + `migrate status`，**刻意不**顺手应用迁移 |
| `npm run ops:backup` | 导出专用库，并判三件事：文件非空、退出码为 0、有结束标记。少一个，「备份成功」可能只是个 0 字节文件 |
| `npm run ops:restore-drill` | 恢复到**新建的**演练库并校验。往源库恢复是事故处置，不是验证备份可用 |
| `npm run ops:restore-source` | 用一份**升级前**的历史备份造一个落后于当前 schema 的源库——否则 `migrate deploy` 新增 0 条，只证明了 deploy 能跑 |
| `npm run ops:upgrade-drill` | 在克隆库上完整演练：验证备份 → 恢复 → `migrate deploy` → 独立端口起 API → 健康检查 → 从同一份备份恢复回滚库 → 输出人工切换步骤 → 清理 |
| `npm run ops:release-build` | 生成发布构建并把产物绑定到当前 Git 提交 |
| `npm run ops:release-gate` | 固定发布候选跑只读门禁；默认 dry-run，写清单必须显式 `--emit` |

所有运维脚本的连接信息**只**来自 `DATABASE_URL`，目标库必须显式是专用库，共享/生产库名一律拒绝。

## 8. 已知边界与技术债

写在这里而不是藏着，因为它们会直接影响你怎么读代码：

- **门市域已整体退役**（2026-09-04）：`/api/store-rental/*` 的 119 个路由、`store-rental` 与 `reports` 两个模块、管理端 8 个退役页面、两个 API 客户端里 182 个遗留函数、以及 57 张只服务于它们的表全部删除。门禁里加了反向断言：两个 API 客户端都不得再出现 `/store-rental/`，退役页面文件不得重新出现。注意 `store-rental:*` **权限码命名空间保留**——它是全系统（含 Rental Core）在用的权限前缀，与那批 URL 是两件事。
- **支付、预授权、通知目前是模拟的**，状态必须用 `simulated` 或同等明确语义，不得记录或展示为真实收款、冻结、发送、送达。
- **不做跨空间汇总**。跨空间的订单、收入、库存、客户消费汇总不在当前阶段；未来做也只能基于明确的租户级查询权限。
- **`tests/mysql-e2e.test.cjs` 里仍有门市段落**（7 处、约 49 行引用）。它需要专用库才能跑、不在默认门禁里，因此这次没有动——盲改这个 10k 行的唯一真库 E2E 只会造出一份看起来有覆盖的假象。修它需要一次带专用库的专门会话。
- **`requiredCapability` 目前只映射两个已删除的前缀**（`/store-rental/dispatch`、`/store-rental/tbox-devices`）。守卫层的能力门禁机制本身是活的、且被 `extension-consistency` 的变异测试钉着（未启用必拒、缺服务 fail-closed），所以刻意保留；但它需要重新指向一个**现行**的应受能力约束的路由，这是个产品决定。
- **`rental_pricing_groups.categoryCode` 存在库与 schema 漂移**，且库里有一条本地不存在的迁移 `20260828006000_capability_config_audit_snapshots`。两者可能同源，尚未查清。
- **区间利用率在数据上不存在**。资产与库存只有当前状态、没有状态变更历史，因此空间报表的资产口径是**读取瞬间的快照**。这条说明跟着报表出参一起下发，页面和 CSV 导出都必须显示——只写在文档里，运营照样会把快照当区间利用率用。

## 9. 文档

| 文档 | 定位 |
| --- | --- |
| [多品类租赁平台需求说明](docs/多品类租赁平台需求说明.md) | **唯一**需求、业务规则与验收来源。代码与它冲突时改代码 |
| [技术开发指南](docs/技术开发指南.md) | 架构、模块边界、权限、API、数据与开发规范 |
| [多品类租赁平台开发任务](docs/多品类租赁平台开发任务.md) | **唯一**任务与进度台账。README 不复制进度，避免两个互相冲突的事实来源 |
| [数据库启动与初始化](docs/数据库启动与初始化.md) | MySQL、迁移、Seed、备份与数据库验收 |
| [管理端界面设计规范](docs/管理端界面设计规范.md) | 页面结构、组件用法与视觉基线 |
| [AI 开发接手提示词](AI开发接手提示词.md) | 任意 AI 开始开发前的统一入口 |

前四份默认锁定：需求与任务台账只在明确要求下修改，开发过程中只更新任务状态并按规定格式追加进度记录。
