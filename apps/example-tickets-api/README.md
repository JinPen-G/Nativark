# 公共底座与工单 Core 示范宿主

这个组合只选择 `example-tickets`，不构建或导入Rental。公共登录、租户 / 人员角色、外观、身份与数据库从独立公共包复用，工单领域 / 迁移 / HTTP属于工单Core。默认无Core仍用 [公共宿主](../platform-api/README.md) 的独立命令。

| 阅读路线 | 入口 |
| --- | --- |
| 固定包和部署准备 | [准备命令](src/prepare-deployment.ts)、[包核验](src/deployment-package.ts)；不安装或执行DDL，成功只显示pending |
| Core权限登记 | [显式命令](src/register-permissions.ts)核相同包/锁后，在同一公共库事务登记六项工单权限；不自动授权或改角色 |
| 受控组合 | [装配](src/assembly.ts)、[Nest模块](src/app.module.ts)；只选择一个Core，版本与包摘要固定，公共与业务使用一个数据库实例 |
| 当前准入 | [公共Core宿主](../../packages/platform-core-host/README.md)、[工单标准宿主](../../packages/example-tickets-core/src/platform-host.ts)；当前账号 / Core授权 / 成员分配 / 订阅 / 绑定与业务权限 |
| 实际数据 | [平台数据计划](../platform-api/src/platform-data.ts)、[工单物理检查](../../packages/example-tickets-core/src/mysql.ts)；原Prisma账和实际结构分别核验 |
| 当前版本与更新材料 | [实际读取源](src/core-package-sources.ts)；核固定底座归档、六公共运行包、完整工单包及原迁移观察 |
| 业务与界面 | [工单README](../../packages/example-tickets-core/README.md)、[业务HTTP](../../packages/example-tickets-core/src/nest.ts)、[四页贡献](../../packages/example-tickets-core/admin/index.tsx) |

SaaS 的四组 Core 包管理 Controller 也从同一[应用工厂](src/assembly.ts)取得数据库、账号和真实工单注册目录。包管理与工单 HTTP 政策通过公共组合接点供给同一个 Guard，包接口资料并入本宿主 OpenAPI。[公共包管理装配](../../packages/platform-core-host/src/core-package-assembly.ts)

配置 `CORE_PACKAGE_STORAGE_ROOT` 为宿主独占的绝对目录，按[包管理存储约定](../../packages/platform-core-host/src/core-packages/README.md)准备原归档、发行和候选目录。`CORE_PLATFORM_PACKAGE_REFERENCE` 指向该目录 `archives/index.json` 中与启动锁完全相同的底座源码归档引用；实际 Nest 装配将两项配置传给当前版本及更新材料读取源。

读取源从六个公共包的正式静态入口核 `platform-host.context.json` 同源编译证据，要求 `host=example-tickets` 及 `apps/example-tickets-api/prisma-deployment/core.deployment.lock.json` 等于当前锁。实际公共 schema / 13份原SQL和完整工单包须与固定归档逐字节一致；只允许一个工单Core和空数据能力集合。版本读取复用本宿主的原Prisma账及物理观察，更新材料读取本身不查库。缺配置、固定引用或运行收据保持 unavailable，已有但不一致的材料拒绝读取。受控组合仍可通过 `composeTicketsApplication` 的第三个参数显式注入来源，生产默认不使用替代证据；候选准备沿原待部署状态保存。

独立运行包由 [公共宿主打包器](../../scripts/package-platform-host.cjs) 选择此组合。完成下述构建及部署锁准备后，在本仓库根目录执行；把示例绝对路径替换成同一固定组合的实际材料路径。

```sh
node scripts/package-platform-host.cjs --host example-tickets --lock "/absolute/prepared-tickets/core.deployment.lock.json" --platform-package "/absolute/releases/platform-source.tgz" --platform-client "/absolute/rental-OS/apps/platform-api/generated/client/index.d.ts" --tickets-package "/absolute/prepared/example-tickets" --output "/absolute/releases/example-tickets-host.tgz"
```

全部材料及输出路径须为绝对路径，`--platform-client` 必须指向执行脚本的本树 `apps/platform-api/generated/client/index.d.ts`，`--tickets-package` 使用已核定的完整工单包目录，`--output` 必须是尚不存在的 `.tgz`。依赖默认读取本树 `node_modules`；需指定已有依赖目录时追加 `--deps "/absolute/managed/node_modules"`。包保留完整工单包、组合迁移和公共观察所需原SQL，不加载Rental或AI；打包与材料核验不代表真实迁移、镜像构建或部署已经完成。

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

底座发行JSON使用正式 `CorePlatformReleaseSchema`，包含真实来源提交、整体摘要、平台 / 合同 / Node版本及当前公共数据计划，不能使用`latest`或占位摘要。结果返回 `core.deployment.lock.json` 与所选公共迁移加1份工单的Prisma迁移组合；原SQL字节 / 摘要保留，输出路径不得覆盖已有部署。准备命令不连接数据库、不执行Core安装脚本。

在获准独立数据库部署环境，使用同一组合的 schema 路径执行 `prisma migrate deploy --schema <新部署目录>/schema.prisma`，然后按公共宿主命令创建SaaS主体。Core迁移原账名称固定为 `core.example-tickets.tickets.initial`，与运行观察相同；不能手工补“迁移成功”收据。配置 `CORE_DEPLOYMENT_LOCK` 指向同一固定锁、`DATABASE_URL` / `AUTH_TOKEN_SECRET` 后运行 `npm run start -w @rental-os/example-tickets-api`。

运行依赖中的 `@rental-os/example-tickets-core` 必须是这份已准备包的相同字节。宿主启动前重新核包与锁的ID / 版本 / 来源 / 摘要，实际公共和工单表 / 迁移状态还须通过准入检查。源码目录只有TS或缺清单时拒绝运行，不将作者的源码测试称为包已安装。

同一部署环境完成公共库初始化后，显式登记标准包声明的工单权限。命令读取当前进程的 `DATABASE_URL` 和 `CORE_DEPLOYMENT_LOCK`，不会加载环境文件。它会写公共Permission目录，须在获准的部署环境执行；重复执行保留原ID和角色关联，冲突整笔回滚。

```sh
npm run register:permissions -w @rental-os/example-tickets-api
```

成功输出 `status=registered`、所选Core版本与 `permissions=6`，随后权限树可读到精确工单权限。登记失败时核包摘要、权限归属/类型及数据库，不能跳过门禁或用通配角色补成功。该命令不应用迁移、创建业务数据或授予租户/成员Core。

SaaS管理员先创建测试租户，再使用 `/api/platform/core-host/tenant-grants` 开通工单；租户管理员给本人及需要的成员分配Core与工单角色，再办理首次绑定。业务入口是 `/api/cores/example-tickets/...`，支持创建 / 分派 / 开始 / 关闭及分页 / 原收据。包 / 注册、租户授权、成员分配、绑定 / 数据就绪分别成立。[同源接口资料](../../packages/example-tickets-core/src/openapi.ts) · [快速指南](../../packages/core-contracts/README.md#五步快速接入)

正式包内的实际根装配与材料校验已离线验证，包括唯一公共40模型Client、工单服务 / HTTP 与包管理装配、完整材料及原观察调用边界、缺失和篡改材料拒绝。验证没有执行应用生命周期；真实环境的首次 npm 安装、镜像构建、数据库 / HTTP / 后台页面及部署验收仍须另验。
