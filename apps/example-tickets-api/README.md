# 公共底座与工单 Core 示范宿主

这个组合只选择 `example-tickets`，不构建或导入Rental。公共登录、租户 / 人员角色、外观、身份与数据库从独立公共包复用，工单领域 / 迁移 / HTTP属于工单Core。默认无Core仍用 [公共宿主](../platform-api/README.md) 的独立命令。

| 阅读路线 | 入口 |
| --- | --- |
| 固定包和部署准备 | [准备命令](src/prepare-deployment.ts)、[包核验](src/deployment-package.ts)；不安装或执行DDL，成功只显示pending |
| 受控组合 | [装配](src/assembly.ts)、[Nest模块](src/app.module.ts)；只选择一个Core，版本与包摘要固定，公共与业务使用一个数据库实例 |
| 当前准入 | [公共Core宿主](../../packages/platform-core-host/README.md)、[工单标准宿主](../../packages/example-tickets-core/src/platform-host.ts)；当前账号 / Core授权 / 成员分配 / 订阅 / 绑定与业务权限 |
| 实际数据 | [平台数据计划](../platform-api/src/platform-data.ts)、[工单物理检查](../../packages/example-tickets-core/src/mysql.ts)；原Prisma账和实际结构分别核验 |
| 业务与界面 | [工单README](../../packages/example-tickets-core/README.md)、[业务HTTP](../../packages/example-tickets-core/src/nest.ts)、[四页贡献](../../packages/example-tickets-core/admin/index.tsx) |

准备项目锁定依赖后，构建示范宿主。

```sh
npm run db:platform:generate
npm run build:example-tickets-api
npm run lint:example-tickets-api
```

取得一个与当前源码 / 合同兼容的标准工单包，按 [Core准备链](../../packages/core-contracts/README.md#打包与本地安装准备) 核验并解包。包内须有实际dist、清单、同版本OpenAPI / 指南 / README / 许可和迁移。用底座实际发行资料JSON与已准备Core包生成新部署目录。

```sh
node apps/example-tickets-api/dist/prepare-deployment.js <固定底座发行JSON> <已准备工单包目录> <新部署目录>
```

底座发行JSON使用正式 `CorePlatformReleaseSchema`，包含真实来源提交、整体摘要、平台 / 合同 / Node版本及当前公共数据计划，不能使用`latest`或占位摘要。结果返回 `core.deployment.lock.json` 与4份公共加1份工单的Prisma迁移组合；原SQL字节 / 摘要保留，输出路径不得覆盖已有部署。准备命令不连接数据库、不执行Core安装脚本。

在获准独立数据库部署环境，使用同一组合的 schema 路径执行 `prisma migrate deploy --schema <新部署目录>/schema.prisma`，然后按公共宿主命令创建SaaS主体。Core迁移原账名称固定为 `core.example-tickets.tickets.initial`，与运行观察相同；不能手工补“迁移成功”收据。配置 `CORE_DEPLOYMENT_LOCK` 指向同一固定锁、`DATABASE_URL` / `AUTH_TOKEN_SECRET` 后运行 `npm run start -w @rental-os/example-tickets-api`。

运行依赖中的 `@rental-os/example-tickets-core` 必须是这份已准备包的相同字节。宿主启动前重新核包与锁的ID / 版本 / 来源 / 摘要，实际公共和工单表 / 迁移状态还须通过准入检查。源码目录只有TS或缺清单时拒绝运行，不将作者的源码测试称为包已安装。

SaaS管理员先创建测试租户，再使用 `/api/platform/core-host/tenant-grants` 开通工单；租户管理员给本人及需要的成员分配Core与工单角色，再办理首次绑定。业务入口是 `/api/cores/example-tickets/...`，支持创建 / 分派 / 开始 / 关闭及分页 / 原收据。包 / 注册、租户授权、成员分配、绑定 / 数据就绪分别成立。[同源接口资料](../../packages/example-tickets-core/src/openapi.ts) · [快速指南](../../docs/平台底座/Core接入/平台Core接入-开发任务.md#core-quick-start)

当前已有实际Nest组合、内存类型、必要离线SQL业务及部署迁移组合证据；严格包核验接入后的干净包运行、真实数据库 / HTTP / 后台页面仍待验证。[当前缺口与证据](../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
