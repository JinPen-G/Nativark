# Rental OS 项目长期备忘

## 项目定位
多品类实物租赁的多租户 SaaS。一套 Rental Core 内核支撑 `camera` / `camping` / `vehicle` / `construction` 四品类，差异靠经营空间业务规则 + 按需启用的 capability 表达，**不允许代码里写品类分支**。当前交付营运管理端 + 后台 API。定位是 R1 内部经营演练，不是生产放行。

## 三层身份（读错一个后面全错）
- **SaaS 租户 tenant**：商户；客户主档在租户内共享。
- **经营空间 workspace**：租户下的经营单元，只经营一种品类；业务隔离边界（商品/资产/库存/地点/定价/订单/权益/报表全按空间隔离）。
- **租赁客户 customer**：租客；同一客户在不同租户下数据、权益、优惠券互相隔离。

## 六条硬约束（每条都有会让改动失败的东西）
1. **空间是数据边界** — 空间只从服务端会话取（`resolveScopeWorkspaceId`），绝不采信客户端提交的 `tenantId`/`workspaceId`。
2. **配置不可变，快照进订单** — 规则/价格/日历只追加版本，下单时 `structuredClone` 进 `ruleSnapshot`/`rateSnapshot`/`calendarSnapshot`。往 `RentalRuleConfig` 加规则块必须可选，读取走 `rental-rule-defaults.ts` 的 `effective*Rule`，缺省值必须等于新增字段之前的行为。
3. **订单金额只有一个入口** — 必须走 `applyChargeTo`。押金**不是**费用明细；非押金明细之和 = `payableAmount`；价内税存标量列不进明细。取整统一 `rental-money.ts` 的 `roundMoney`（带 EPSILON 修正），禁止裸 `Math.round(x*100)/100`。
4. **品类差异只能是配置** — 通用页面与计算模块禁止 `if (categoryCode === ...)`。
5. **资金写入必须幂等** — 走 `RentalIdempotentActionService.execute`；`fallbackKey` 里**不得包含当前状态**，要按「这是哪一次业务动作」构造。
6. **四个静态门禁** — `validate-api-contracts.cjs`（路由 ↔ OpenAPI）、`validate-dto-coverage.cjs`（DTO 校验装饰器覆盖，防静默剥离字段）、`validate-route-permissions.cjs`（兜底默认拒绝，防漏鉴权）、`validate-react-admin.cjs`。前三个由 `npm run contract:validate` 串起。

## 仓库地图
- `apps/api` — NestJS 10 + Prisma 5，前缀 `/api`。`rental-core` 是唯一新业务入口（46 文件/约 22.8k 行）；最大文件 `rental-business.service.ts`（336KB）。纯函数计算模块刻意独立，便于不连库测试。
- `apps/admin` — React 19 + Ant Design 6 + Vite 8。路由集中在 `navigation.tsx` 的 `APP_ROUTES`，四道闸门：audience / permission / capability / categories。前端隐藏不替代后端数据权限。
- `apps/website` — 品牌官网（React 版，未提交）。
- `packages/shared` — 前后端唯一契约来源，`index.ts` 只做再导出；拆 core/platform/infrastructure/common。
- `apps/api/prisma` — schema.prisma（89 model / 12 enum）+ 96 迁移。
- 门市域（`/api/store-rental/*`）已于 2026-09-04 整体退役，删 57 张表。**但 `store-rental:*` 权限码命名空间保留**，是全系统在用的权限前缀，与那批 URL 无关。

## 环境与运行要点
- 启动：`cp .env.example .env` → `docker compose up -d mysql redis` → `npm install` → `npm run db:generate` → `npm run db:validate` → `npm run dev`。
- API `http://localhost:3000/api`；管理端 `http://localhost:5175`。
- **两端读 shared 方式不同**：API 依赖编译产物 `dist/`，管理端 Vite 直接 alias 到 `src/index.ts`。改完契约只在管理端验证通过 ≠ API 认账，必须重新构建 shared。
- Windows 跑 `prisma generate` 前必须先停 API 开发服务器，否则 `query_engine-windows.dll.node` 被占用报 EPERM。
- 默认门禁：`npm run test:rental-foundation`（23 步）。真库 E2E、空间报表、客户主档、运维等需单独跑。
- 测试风格边界：多数专项用「吸收式 store」（读返回空、写丢弃）跑纯计算，刻意不实现查询语义。**租户隔离、外键、唯一约束、过期预占这类断言只放 `tests/mysql-e2e.test.cjs`**，纯计算专项不假装覆盖。

## 环境已知限制（本机沙箱）
- Chrome / Edge / agent-browser 在本沙箱内**无法启动**（静默退出、无法写盘）；验证网页只能靠静态分析或自建 DOM 垫片自检，取不到真实浏览器截图。

## 官网静态版交付（2026-09-10 创建）
- 位置：`D:\工作文件\rental-os-website\`（独立目录，不在主仓库 git 内）。
- 结构：`index.html` + `style.css` + `script.js` + `images/`（4 张 AI 图）+ `favicon.svg` + `image-prompts.json`；`_dev/selftest.cjs` 为开发期自检（非交付物）。
- 全部相对路径 `./`，双击 HTML 即可运行，整目录可单独部署，不需 Node/打包。
- 数据集中在 `script.js` 顶部（`INDUSTRIES` / `FLOW` / `FAQS`），改文案只改一处。
- 数据源真身仍在 `apps/website/src/main.tsx`（React 版）；静态版是它的等价移植。
