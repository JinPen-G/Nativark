# 公共底座与工单 Core 示范宿主

这个组合只选择 `example-tickets`，不构建或导入Rental。公共登录、租户 / 人员角色、外观、身份与数据库从独立公共包复用，工单领域 / 迁移 / HTTP属于工单Core。默认无Core仍用 [公共宿主](../platform-api/README.md) 的独立命令。

## 单工单的五步

以下步骤在独立宿主的所选源码根目录办理，实际依赖和运行版本由固定发行锁确定。公共包提供同一身份、数据库和外壳，工单包提供业务及页面。

| 步骤 | 操作 | 出口 |
| --- | --- | --- |
| 1 | 按[公共 API](../platform-api/README.md#默认零-core-的五步)准备独立配置与公共 schema / Client，再构建本宿主 | 本树唯一公共 41 模型 Client 和公共 / 工单 API 编译产物 |
| 2 | 按[公开打包和安装准备](../../packages/core-contracts/README.md#打包与本地安装准备)取得完整固定工单包 | `prepared / already_prepared`、完整包摘要及待部署目录 |
| 3 | 以[固定底座发行 JSON](../platform-api/README.md#固定发行与部署锁)及同一工单包执行下方准备命令 | 新目录中的 `core.deployment.lock.json`、所选公共数据计划的迁移（当前 `0.1.9` 为 14 份）与工单 1 份原迁移 |
| 4 | 在目标环境应用组合迁移、初始化公共账号、装配同一标准包并登记精确权限 | 公共 / 工单物理观察可核同，权限目录包含 6 项工单权限 |
| 5 | 两端使用同一包和锁，启动 API / Web，再核部署准入、授权及绑定 | SaaS 显式登记所选 Core 的部署准入并开通租户，租户管理员分配自己和成员及角色，首次设置后完成业务链 |

工单三张业务表由本 Core 的参数化 SQL 适配读写，两条宿主路径均从 `apps/platform-api/prisma/schema.prisma` 生成公共 Client。准备目录中的 `schema.prisma` 为原迁移命令提供数据源，Client 的生成来源仍为上述公共 schema。[公共数据库](../platform-api/src/database.ts) · [组合迁移生成器](../../packages/core-contracts/src/deployment.ts) · [工单 SQL 适配](../../packages/example-tickets-core/src/mysql.ts)

API 启动读取当前进程 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、`CORE_DEPLOYMENT_LOCK`。锁中 Node 和 Core 合同版本须与当前进程实际版本一致，宿主在装配前拒绝不匹配的锁。权限登记读取同一进程的 `DATABASE_URL` 与 `CORE_DEPLOYMENT_LOCK`，初始化口令沿公共宿主步骤提供。锁路径取步骤 3 返回的实际 `core.deployment.lock.json`，包管理的归档存储及当前底座引用见下方配置。Web 的公开基址和代理另按[工单后台](../example-tickets-admin/README.md#本地使用)供给。

反向代理部署可设置进程配置 `TRUST_PROXY_HOPS` 为非负安全整数，默认 `0` 不信任转发头。只在 API 无法绕过代理直达、代理链跳数固定且入口代理正确重写转发头时，按实际跳数配置（例如单层受控代理设为 `1`）。公共限流继续使用 Express 据此解析的 `request.ip`，不直接采信任意 `X-Forwarded-For`，演示预约仍为每地址 5 次 / 600 秒，邀请阈值也保持原规则。非法配置在创建应用前拒绝。[启动实现](src/main.ts)

| 阅读路线 | 入口 |
| --- | --- |
| 固定包和部署准备 | [准备命令](src/prepare-deployment.ts)、[包核验](src/deployment-package.ts)；不安装或执行DDL，成功只显示pending |
| Core权限登记 | [显式命令](src/register-permissions.ts)核相同包/锁后，在同一公共库事务登记六项工单权限；不自动授权或改角色 |
| 受控组合 | [装配](src/assembly.ts)、[Nest模块](src/app.module.ts)；只选择一个Core，版本与包摘要固定，公共与业务使用一个数据库实例，持主体锁的部署观察复用当前事务 |
| 唯一生命周期 | [启动/排空](src/lifecycle.ts)、[启动失败关闭](src/main.ts)；权限登记、原Guard和完整处理器结束后，HTTP关闭再断同一池；断线不取消原业务 |
| 当前准入 | [公共Core宿主](../../packages/platform-core-host/README.md)、[工单标准宿主](../../packages/example-tickets-core/src/platform-host.ts)；当前账号 / Core授权 / 成员分配 / 订阅 / 绑定与业务权限 |
| 实际数据 | [平台数据计划](../platform-api/src/platform-data.ts)、[工单物理检查](../../packages/example-tickets-core/src/mysql.ts)；原Prisma账和实际结构分别核验 |
| 当前版本与更新材料 | [实际读取源](src/core-package-sources.ts)；核固定底座归档、六公共运行包、完整工单包及原迁移观察 |
| 业务与界面 | [工单README](../../packages/example-tickets-core/README.md)、[业务HTTP](../../packages/example-tickets-core/src/nest.ts)、[四页贡献](../../packages/example-tickets-core/admin/index.tsx) |

SaaS 的四组 Core 包管理 Controller 也从同一[应用工厂](src/assembly.ts)取得数据库、账号和真实工单注册目录。包管理与工单 HTTP 政策通过公共组合接点供给同一个 Guard，包接口资料并入本宿主 OpenAPI。[公共包管理装配](../../packages/platform-core-host/src/core-package-assembly.ts)

配置 `CORE_PACKAGE_STORAGE_ROOT` 为宿主独占的绝对目录，按[包管理存储约定](../../packages/platform-core-host/src/core-packages/README.md)准备原归档、发行和候选目录。`CORE_PLATFORM_PACKAGE_REFERENCE` 指向该目录 `archives/index.json` 中与启动锁完全相同的底座源码归档引用；实际 Nest 装配将两项配置传给当前版本及更新材料读取源。

读取源从六个公共包的正式静态入口核 `platform-host.context.json` 同源编译证据，要求 `host=example-tickets` 及 `apps/example-tickets-api/prisma-deployment/core.deployment.lock.json` 等于当前锁。实际公共 schema、所选公共数据计划中的全部原 SQL 和完整工单包须与固定归档逐字节一致；只允许一个工单Core和空数据能力集合。版本读取复用本宿主的原Prisma账及物理观察，更新材料读取本身不查库。缺配置、固定引用或运行收据保持 unavailable，已有但不一致的材料拒绝读取。受控组合仍可通过 `composeTicketsApplication` 的第三个参数显式注入来源，生产默认不使用替代证据；候选准备沿原待部署状态保存。[公共数据计划](../platform-api/src/platform-data.ts)

## 独立后端运行包

独立运行包由 [公共宿主打包器](../../scripts/package-platform-host.cjs) 选择此组合。完成下述构建及部署锁准备后，在本仓库根目录执行；把示例绝对路径替换成同一固定组合的实际材料路径。

```sh
node scripts/package-platform-host.cjs --host example-tickets --lock "/absolute/prepared-tickets/core.deployment.lock.json" --platform-package "/absolute/releases/platform-source.tgz" --platform-client "/absolute/rental-OS/apps/platform-api/generated/client/index.d.ts" --tickets-package "/absolute/prepared/example-tickets" --output "/absolute/releases/example-tickets-host.tgz"
```

运行包 Dockerfile 固定 Node 24.13.0，底座发行的 `versions.node` 须与它一致，合同版本沿同一正式出口。全部材料及输出路径须为绝对路径，`--platform-client` 必须指向执行脚本的本树 `apps/platform-api/generated/client/index.d.ts`，`--tickets-package` 使用已核定的完整工单包目录，`--output` 必须是尚不存在的 `.tgz`。依赖默认读取本树 `node_modules`，需指定已有依赖目录时追加 `--deps "/absolute/managed/node_modules"`。包保留完整工单包、组合迁移和公共观察所需原SQL，不加载Rental或AI，打包与材料核验不代表真实迁移、镜像构建或部署已经完成。

## 准备标准包与部署锁

准备项目锁定依赖及公共 Client 后，构建示范宿主。

```sh
npm run prisma:generate -w @rental-os/platform-api
npm run build -w @rental-os/example-tickets-api
npm run lint -w @rental-os/example-tickets-api
```

取得一个与当前源码 / 合同兼容的标准工单包，按 [Core准备链](../../packages/core-contracts/README.md#打包与本地安装准备) 核验并解包。包内须有实际dist、清单、同版本OpenAPI / 指南 / README / 许可和迁移。安装准备的宿主版本 JSON 取同一底座发行的完整 `versions`，含实际 platform / contract / node 和能力映射，字段沿[公共版本合同](../../packages/core-contracts/src/compatibility.ts)。用底座实际发行资料JSON与已准备Core包生成新部署目录。

```sh
node apps/example-tickets-api/dist/prepare-deployment.js <固定底座发行JSON> <已准备工单包目录> <新部署目录>
```

底座发行JSON使用正式 `CorePlatformReleaseSchema`，包含真实来源提交、整体摘要、平台 / 合同 / Node版本及当前公共数据计划，不能使用`latest`或占位摘要。结果返回 `core.deployment.lock.json` 与所选公共迁移加1份工单的Prisma迁移组合；原SQL字节 / 摘要保留，输出路径不得覆盖已有部署。准备命令不连接数据库、不执行Core安装脚本。

## 登记、授权与使用

在获准独立数据库部署环境，使用同一组合的 schema 路径执行 `node node_modules/prisma/build/index.js migrate deploy --schema <新部署目录>/schema.prisma`，再运行 `npm run initialize -w @rental-os/platform-api` 创建SaaS主体。Core迁移原账名称固定为 `core.example-tickets.tickets.initial`，与运行观察相同，实际成功收据由原 Prisma 迁移账产生。当前进程提供同一独立库的 `DATABASE_URL`、初始化所需 `SEED_PLATFORM_PASSWORD`、认证所需 `AUTH_TOKEN_SECRET`，并将 `CORE_DEPLOYMENT_LOCK` 指向准备命令返回的固定锁。

运行依赖中的 `@rental-os/example-tickets-core` 必须是这份已准备包的相同字节。源码检出的 npm workspace 解析到 `packages/example-tickets-core`，部署者在独占宿主中将同一待部署包的[完整声明文件集](../../packages/core-contracts/src/package.ts)供给该实际解析目录，再构建 Web 和启动 API，已有作者稿先保全并核定去向。独立后端运行包已把完整标准包放入这个 workspace。公共 / 工单 API 的编译步骤在包供给前完成，保留所选包的实际 dist 和资料字节。宿主启动前重新核包与锁的ID / 版本 / 来源 / 摘要，实际公共和工单表 / 迁移状态还须通过准入检查。源码目录只有TS或缺清单时拒绝运行，不将作者的源码测试称为包已安装。

同一部署环境完成公共库初始化后，显式登记标准包声明的工单权限。命令读取当前进程的 `DATABASE_URL` 和 `CORE_DEPLOYMENT_LOCK`，不会加载环境文件。它会写公共Permission目录，须在获准的部署环境执行；重复执行保留原ID和角色关联，冲突整笔回滚。

本宿主的标准 Nest 模块在 HTTP 监听前，通过同一 `CoreHostPermissionStartup` 和公共库 Serializable 事务登记已核包清单。构造模块期间不查库，显式初始化与 Nest 钩子共用原 Promise。唯一[宿主生命周期](src/lifecycle.ts)在初始化前接管公共数据库的连接/关闭钩子；停止时先阻止未开始的登记和新请求，等待同一在途登记、原 Guard 与完整处理器，HTTP dispose 后再断开同一池。并发关闭共用原排空和断库结果，启动入口在 init/listen 失败后关闭同一个应用。客户端断线只弃置响应，原处理器继续到完成或失败；多值、文件和原错误仍交原 HTTP 出口。

显式命令可用于部署阶段提前核对。新增工单权限只进入可配置目录，角色和成员分配仍经原接口办理；生命周期包装调用同一个原 `PlatformAuthGuard`，不复制或放宽授权。[标准启动接线](src/app.module.ts) · [公共启动对象](../../packages/platform-core-host/src/core-host.module.ts) · [数据库归属接点](../platform-api/src/database.ts)

```sh
npm run register:permissions -w @rental-os/example-tickets-api
```

成功输出 `status=registered`、所选Core版本与 `permissions=6`，随后权限树可读到精确工单权限。登记失败时核包摘要、权限归属/类型及数据库，不能跳过门禁或用通配角色补成功。该命令不应用迁移、创建业务数据或授予租户/成员Core。

权限登记成功后，执行 `npm run start -w @rental-os/example-tickets-api`，再按[同包工单 Web 步骤](../example-tickets-admin/README.md#本地使用)启动界面。

当前 SaaS 管理者先通过 `POST /api/platform/core-host/deployment-admission/read` 读取工单部署准入。新部署尚无记录时，使用唯一 `operationId`、`expectedRevision: 0` 显式向 `POST /api/platform/core-host/deployment-admission` 提交已核定的 `accepting` 状态，并读回当前修订与原操作收据。已有 `stopped` 或其他修订按原事实办理，未知应答沿 `POST /api/platform/core-host/deployment-admission-operations/read` 只读核对。请求及错误字段从同版本[管理 HTTP 合同](../../packages/core-contracts/src/management-http.ts)与[部署准入说明](../../packages/platform-core-host/README.md#部署准入与存量切换)读取。该状态由同库原配置行持久化，工单新绑定及普通业务在原事务内复验。

部署准入、实际数据、租户授权、成员分配和绑定分别核定。完成部署准入登记后，SaaS管理员先创建测试租户，再使用 `/api/platform/core-host/tenant-grants` 开通工单，租户管理员给本人及需要的成员分配Core与工单角色，再办理首次绑定。业务入口是 `/api/cores/example-tickets/...`，支持创建 / 分派 / 开始 / 关闭及分页 / 原收据。包 / 注册、租户授权、成员分配、绑定 / 数据就绪分别成立。[同源接口资料](../../packages/example-tickets-core/src/openapi.ts) · [快速指南](../../packages/core-contracts/README.md#五步快速接入)

正式包已在独立 Windows 宿主完成按锁文件安装、唯一公共40模型Client、公共与工单原迁移、真实 API 启动和业务冒烟。验证覆盖 SaaS 授权、成员分配、首次绑定、创建/分派/开始/关闭、修订及同键冲突、租户隔离、成员撤权、Core停用/重开和原收据；数据库与 API 重启后原绑定、业务和操作结果保留。包检查仍独立核缺失及篡改材料，不以业务成功放宽来源或摘要。工单完整后台、同宿主双Core、Linux镜像和发布分别验收。

## 验证入口与前置卡点

公开标准包使用 `node packages/core-contracts/dist/check.js <已准备工单目录> --host <同版宿主版本JSON> --json` 核清单、入口和兼容。必要类型沿[内存类型入口](../../scripts/check-selected-prisma-types.cjs)的 `--mode platform --config apps/example-tickets-api/tsconfig.json`。完整源码中的[原运行包 runner](../../tests/rental-host-package.test.cjs)复用[单工单材料用例](../../tests/platform-host-package-cases.cjs)，覆盖完整包、唯一公共 Client、实际根装配、缺失及篡改材料拒绝，它的运行范围及隔离前置以源码为准。

首次绑定或普通业务因部署准入 unknown 拒绝时，先按上述 SaaS 管理步骤读取并核定原状态。缺 Client 先回公共 schema 生成步骤，缺清单或包摘要不符核同一待部署包与实际解析目录，公共数据版本不符核固定发行与本宿主原计划，权限目录缺项使用同一部署锁登记。绑定和原操作返回未知时保留原键，沿[只读结果及当前事实](../../packages/core-contracts/README.md#core-管理-http-合同)核对。单工单的独立安装、原迁移、业务HTTP及持久重启已有实际冒烟；完整工单Web、双Core和独立升级继续按各自组合核收。
