# Rental OS

面向摄影设备、露营装备、车辆载具和工程设备等实物租赁业务的多租户 SaaS 项目。各端共用 Rental Core、服务端身份与权限、经营空间数据边界，以及既有订单、库存和资金流程。

AI Native 是在原有业务上的智能入口：理解需求、读取受权事实、形成建议或草稿、调用受控工具，并引导用户回到正式页面。它不替代 Rental Core，也不因能生成答案就拥有业务操作权限。

本文是项目介绍与导航，不是完成度报告、部署证明或执行命令的授权。当前范围看需求，任务百分比看开发任务，接手现场看协作接续，实际已做与未验部分看开发记录。

## 从哪里开始

| 你要做什么 | 阅读入口 |
| --- | --- |
| 了解项目和目录 | 本文的[项目组成](#项目组成)与[业务边界](#业务边界) |
| 查看需求、任务和进度 | [项目文档导航](docs/文档导航.md)，各专项资料集中在同一文件夹 |
| 让 AI 或开发者接手修改 | 先读 [AGENTS.md](AGENTS.md)，再读本次专项的正式依据与当前接续 |
| 继续 AI Native | [需求](<docs/AI Native/AI Native-需求.md>)、[开发任务](<docs/AI Native/AI Native-开发任务.md>)、[当前接续](<docs/AI Native/AI Native-协作接续.md>)、[开发记录](<docs/AI Native/AI Native-开发记录.md>) |
| 继续 MCP / Harness 接入 | [MCP 接续](docs/MCP服务/MCP服务-协作接续.md)、[Harness 插件接续](docs/Harness插件/Harness插件-协作接续.md)；原[Agent 接入改造接续](docs/Agent接入改造/Agent接入改造-协作接续.md)保留独立状态，不继承旧进度 |
| 继续品类治理与版本发布（Rental内部） | [需求](<docs/Rental Core/品类治理/品类治理-需求.md>)、[开发任务](<docs/Rental Core/品类治理/品类治理-开发任务.md>)、[当前接续](<docs/Rental Core/品类治理/品类治理-协作接续.md>)、[接手导读](<docs/Rental Core/品类治理/品类治理-接手与验收导读.md>)；暂停不取消原租赁品类需求 |
| 平台接入其他业务Core（跨行业） | [需求](docs/平台底座/Core接入/平台Core接入-需求.md)、[开发任务](docs/平台底座/Core接入/平台Core接入-开发任务.md)、[当前接续](docs/平台底座/Core接入/平台Core接入-协作接续.md)、[接入指南](docs/平台底座/Core接入/平台Core接入-接入指南.md)；仅文档准备，不代表已经可换装CRM/TMS |
| 了解架构或接口 | [项目开发指南](docs/公共技术资料/开发指南/项目-开发指南.md)、[客户端 API 说明](docs/公共技术资料/接口说明/客户端-API说明.md)、[OpenAPI 源码](apps/api/src/contracts/openapi-document.ts) |

AI 开发规则只在 `AGENTS.md` 维护一份；[CLAUDE.md](CLAUDE.md) 是引用它的 Claude Code 入口，不维护另一套规则。其他工具若不能自动发现项目规则，应在其项目入口显式引用并读取 `AGENTS.md`。入口文件不是强制权限机制，安全约束仍须由代码和验证落实。

## 项目组成

这是 npm workspaces 仓库。依赖版本以各 `package.json` 和根目录 `package-lock.json` 为准，不在 README 重复列容易过时的版本、文件数和测试数。

| 目录 | 用途 | 主要入口 |
| --- | --- | --- |
| `apps/api/` | NestJS API、认证、业务服务与 AI Native；Prisma 模型和迁移也在该工程内 | [启动入口](apps/api/src/main.ts)、[应用装配](apps/api/src/app.module.ts) |
| `apps/admin/` | React / Vite 租户管理后台及平台管理界面 | [页面启动](apps/admin/src/main.tsx)、[本端开发约定](apps/admin/AGENTS.md) |
| `apps/miniprogram/` | 客户微信小程序 | [说明](apps/miniprogram/README.md) |
| `apps/staff-miniprogram/` | 员工微信小程序 | [说明](apps/staff-miniprogram/README.md) |
| `apps/tenant-website/` | 租户消费者官网与预约入口，不是平台营销网站 | [说明](apps/tenant-website/README.md) |
| `apps/website/` | Rental OS 平台营销网站，静态网页工程 | [说明](apps/website/README.md) |
| `packages/shared/` | 前后端公共类型、枚举、校验 schema 与运行时工具 | [公共出口](packages/shared/src/index.ts) |
| `packages/ui-arc/` | 管理后台 UIArc 源码保留与适配资料 | [说明](packages/ui-arc/README.md) |
| `packages/mcp-server/` | 标准 MCP 受控接入工程，正式业务仍由原服务端授权与执行 | [说明](packages/mcp-server/README.md) |
| `clients/harness-plugin/` | Harness 客户端接入增强，消费标准 MCP，不重建业务工具 | [说明](clients/harness-plugin/README.md) |
| `clients/agent-desktop/` | 原定制客户端、Harness 参考源码与许可保留；不作为新专项的完成证据 | [说明](clients/agent-desktop/README.md) |
| `scripts/` | 构建、静态检查、数据库与运维辅助脚本 | [根命令清单](package.json) |
| `tests/` | 业务、契约、离线替身、宿主及数据库等不同层级的验证 | 按本次改动选择已有验证入口 |
| `docs/` | 按专项分类的需求、任务、接续、开发记录与未来规划 | [文档导航](docs/文档导航.md) |

根 workspaces 只包含 `apps/*` 和 `packages/*`；`clients/` 按自身说明工作，不由根构建自动覆盖。目录存在不表示对应端、场景或第三方集成已完成验收。其他参考工程、设计与品牌原稿不能当作当前业务实现，是否清理或提交需单独确认。

### 后端阅读路线

| 想了解什么 | 先看哪里 |
| --- | --- |
| HTTP 启动、全局校验及模块注册 | [main.ts](apps/api/src/main.ts)、[app.module.ts](apps/api/src/app.module.ts) |
| 当前身份、租户与空间权限 | [auth](apps/api/src/modules/auth)、[API Guard](apps/api/src/common/api-auth.guard.ts)及相关业务服务 |
| 租赁规则、报价、订单与库存 | [rental-core](apps/api/src/modules/rental-core) |
| 租户、成员、共享客户和会员 | [platform](apps/api/src/modules/platform) |
| 客户独立认证及本人业务 | [client](apps/api/src/modules/client) |
| 支付、文件和其他外部适配 | [integrations](apps/api/src/modules/integrations) |
| AI Native 正式应用接点 | [应用 providers](apps/api/src/modules/ai-native/ai-native-application.providers.ts)，再追踪对应场景和注入依赖 |
| AI Native 步骤推进与恢复 | [运行器](apps/api/src/modules/ai-native/runner/ai-task-runner.service.ts)及其 ports / 仓储适配 |
| 数据结构与增量迁移 | [Prisma 目录](apps/api/prisma) |

从实际消费者和装配入口向下阅读，不把某个独立类、接口或 `ready` 标志当成整条执行链已接通。

## 业务边界

- **租户与经营空间不同。** 租户共享的客户和会员事实，不意味着订单、库存、价格、资金或报表也可跨空间读取。
- **客户端输入不是授权。** 当前身份、租户、空间、地点和数据范围由服务端正式认证与权限链解析；页面隐藏不替代后端校验。
- **业务事实由原业务域决定。** 商品是否可租、库存、报价、金额、资格、订单状态及支付结果不能由 AI 或前端推断成正式结果。
- **保留历史依据。** 报价和订单的规则、价格、履约及检查快照按原关联读取，不能用当前设置补写历史事实。
- **业务阶段不能混同。** 可用性查询不等于库存预占，报价不等于建单，提案不等于批准，请求已提交不等于业务执行成功；押金、预授权、应收、实收和退款也须按原契约分别表达。
- **各端复用同一业务底座。** 传统列表、表单和人工流程继续保留；AI Native 服务端模型使用唯一 Gateway、预算单账。[MCP 服务](docs/MCP服务/MCP服务-需求.md)提供标准受控业务通路，[Harness 插件](docs/Harness插件/Harness插件-需求.md)按需补客户端接入，Harness 本地模型由用户自配直连自付。业务权限、审批、Core 和原收据仍由原服务端决定；实际云端模型委托仍走原 Gateway。原 Agent 接入改造成果独立保留，缺依赖保持不可用，不把新包或接入规划当业务已上线。

具体规则及验收以正式需求和开发指南为准，本文不另立一套业务规范。

## 本地运行

下面是人工配置与联调的入口，不是 AI 接手后应自动执行的一串命令。它们可能读取环境文件、写构建产物、启动服务或连接数据库；离线任务不得直接照抄运行。

### 环境准备

1. 确认当前工作树、Node.js / npm 与依赖兼容性；已有环境不重复安装或覆盖配置。
2. 新环境由开发者按 `.env.example` 配置本地环境，密钥、账号和连接凭据不得提交或贴入报告。
3. 按[数据库启动指南](docs/公共技术资料/开发指南/数据库-启动指南.md)确认目标库、备份及迁移状态。生成 Prisma client、执行迁移和 Seed 是不同操作，不把启动项目等同于清库初始化。
4. 安装、启动、连接外部依赖和修改数据库，均须符合本次明确授权。

### 常用开发命令

在当前工作树根目录执行，具体行为先查看 [package.json](package.json)：

```bash
npm run dev                 # API 与管理后台；先构建 shared
npm run dev:api             # 只启动 API；先构建 shared
npm run dev:admin           # 只启动管理后台；先构建 shared
npm run dev:tenant-website  # 租户消费者官网开发服务器
```

API 默认入口为 `http://localhost:3000/api`；管理后台默认 `http://localhost:5175`，通过 Vite 代理访问 API。实际地址以当前端口配置及进程输出为准。

客户与员工小程序的构建、AppID 和微信宿主导入按各端 README 操作；平台营销网站按自身静态预览说明操作。命令成功不等于微信宿主、浏览器或真实业务验收通过。

### shared 与生成产物

API 通过包出口使用 `packages/shared/dist`；管理后台 Vite 将 `@rental-os/shared` 指向源码。修改公共契约时须核对生产者、消费者与产物版本，不能只凭一端热更新判断两端一致。

普通构建和部分测试会重建 shared；`db:generate`、`db:validate` 等根脚本会加载环境配置。离线开发必须先核对脚本，再使用本树已有隔离方案，不覆盖其他工作树共用的生成物。Windows 上运行中的进程还可能占用 Prisma 引擎，不能靠删锁或复制另一棵树的 client 绕过问题。

## 验证与运维

已有检查入口包括：

| 入口 | 用途与注意事项 |
| --- | --- |
| `npm run docs:check` | 白名单文档本地文件链接、共用规则入口及 AI Native 任务表算术；不加载业务或环境、不联网、不写产物；不检查锚点/外网/全历史，也不判定验收 |
| `npm run test:docs` | 文档检查器的离线回归；只验证检查规则，不启动应用 |
| `npm run contract:validate` | 控制器 / OpenAPI、DTO、路由权限及客户写入归属检查 |
| `npm run test:admin` | 管理后台结构与约定检查，不是浏览器验收 |
| `npm run lint` | 工作区类型检查链；包含 shared 构建，不是纯只读操作 |
| `npm run test:rental-foundation` | 多步骤底座回归；包含构建和环境相关命令，不是通用离线入口 |
| 根目录 `test:*` 脚本 | 按改动选择业务专项；先检查其是否连库、读取环境或调用外部服务 |
| `scripts/ops/` 与 `ops:*` | 发布预检、备份、恢复和升级等；先确认目标、授权及脚本实际行为 |

AI Native 离线验证的 preload、固定无效数据库地址及隔离产物规则见 [AGENTS.md](AGENTS.md) 和[当前接续](<docs/AI Native/AI Native-协作接续.md>)。文档检查器的白名单与实现见[scripts/validate-docs.cjs](scripts/validate-docs.cjs)；新增检查不授予真库测试、服务启动或业务完成认定权限。

报告须区分：源码 / 静态检查、类型检查、实际实现的离线行为、构建、浏览器 / 微信宿主、真实数据库 / 外部集成、正式验收与发布。未执行的部分写未验，不用局部通过代替整项完成。

## 文档怎么维护

- **README**：项目介绍、目录、使用入口；不维护当前任务流水。
- **AGENTS**：所有开发 AI 共用的稳定规则；不是当前派工或权限凭证。
- **需求 / 开发任务**：正式依据。未经负责人授权不改需求、任务安排和验收；日常任务仅更新有依据的完成百分比。
- **协作接续**：覆盖更新最新现场、当前未完成事项和接手入口，不累积已完成历史。
- **开发记录**：按原任务记录已做、剩余、关键提交及实际证据；近期与归档分开维护。
- **未来规划 / 历史归档**：分别保留未来设计和原始历史，不作为当前施工授权。

完整分类、专项状态和归档规则以[文档导航](docs/文档导航.md)为入口。不要把环境现场、测试数量或临时交接进度重新堆回 README。
