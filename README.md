# Rental OS

Rental OS 是面向摄影设备、露营装备、车辆载具和工程设备等品类的多租户 SaaS 租赁平台。

- SaaS 租户是使用系统经营租赁业务的商户，不是租用设备的客户。
- 一个 SaaS 租户可建立多个经营空间，每个空间经营一种设备品类。
- 平台使用通用 Rental Core 处理商品、资产、库存、报价、订单和履约。
- `vehicle` 与摄影、露营、工程设备一样是 Rental Core 的正式品类；车辆调度、TBox、工程资质、智能柜和物流等通过品类 capability 按需启用。

## 文档

- [AI 开发接手提示词](AI开发接手提示词.md)：任意 AI 开始开发前的统一入口；默认锁定。
- [多品类租赁平台需求说明](docs/多品类租赁平台需求说明.md)：唯一需求、业务规则和验收来源；默认锁定。
- [多品类租赁平台开发任务](docs/多品类租赁平台开发任务.md)：唯一开发任务和进度台账；开发 AI 仅可更新任务状态并追加规定格式的进度记录。
- [技术开发指南](docs/技术开发指南.md)：当前架构、模块边界、权限、API、数据和开发规范；默认锁定。
- [数据库启动与初始化](docs/数据库启动与初始化.md)：MySQL、迁移、Seed、备份和数据库验收；默认锁定。

## 工程结构

```text
apps/admin       React 19 + Ant Design 6 管理端
apps/api         NestJS API 与 Prisma
packages/shared  前后端共享契约
scripts          构建、验证和数据库脚本
tests            Rental Core、SaaS 隔离和业务回归
docs             当前正式文档
```

- 管理端：React 19.2.8、Ant Design 6.6.0、Vite 8.2.1。
- API：NestJS 10，统一前缀 `/api`。
- 通用租赁 API：`/api/rental/v1/*`。
- `/api/store-rental/*` 是历史门市租赁参考接口，不属于新平台产品入口；新业务统一使用 `/api/rental/v1/*`。
- 数据目标：Prisma + MySQL；进程内模式只用于测试或明确演示。

## 开发进度

当前任务状态、验证证据和后续入口只记录在 [多品类租赁平台开发任务](docs/多品类租赁平台开发任务.md)。README 不复制阶段进度，避免形成多个相互冲突的事实来源。

## 本地启动

```powershell
Copy-Item .env.example .env
docker compose up -d mysql redis
npm install
npm run db:generate
npm run db:validate
npm run dev
```

默认地址：

- API：`http://localhost:3000/api`
- 管理端：`http://localhost:5175`

数据库迁移与 Seed 见 [数据库启动与初始化](docs/数据库启动与初始化.md)。账号、密码、token 和密钥不得写入仓库文档。

## 验证

```powershell
npm run test:rental-foundation
npm run build
git diff --check
```

这些命令不替代真实 MySQL E2E。涉及数据库的任务必须同时验证空库部署、已有库升级、Seed 幂等、重启恢复和双租户并发隔离。
