# {{CORE_ID}}

`{{PACKAGE_NAME}}` 是租户范围的“本人条目”Core，包含真实 MySQL 读写、列表/详情/新建/编辑/归档页面、同源 HTTP/OpenAPI、标准包命令和可启动的 API/后台宿主。底座依赖固定于[提交 {{PLATFORM_SHA}}]({{PLATFORM_URL}}/packages/core-contracts/README.md)，精确版本、公开手册摘要与命名空间保存在 [core.scaffold.json](core.scaffold.json)。使用者不需要维护者的私有资料。

条目只属于创建它的当前租户成员；角色中的四项精确权限决定能读、创建、编辑或归档。SaaS 管理员不取得业务身份。包内没有账号、密钥、业务 Seed、默认角色授权、AI 工具或第二套认证实现。

## 在固定公开底座开发

将本包放在所选底座的 `{{TARGET}}`，显式加入根 `package.json.workspaces`。所有 `@rental-os/*` 依赖都使用同一底座中的 workspace，不能把私有 workspace 版本号当作 npm 公网发行。外部依赖版本从同一根 npm v3 锁提取；生成器不修改根 package/lock，也不执行安装。

在获得本地依赖和独立数据库环境的操作许可后，按同版锁流程运行 `npm install --package-lock-only --ignore-scripts`、`npm ci --ignore-scripts`。公共 Client 使用唯一 `apps/platform-api/prisma/schema.prisma`；本 Core 的三张表沿参数化 SQL 读写，不需要另造或扩展公共 Prisma 模型。以下命令在源码工作区根执行，实际数据库配置由部署者提供：

```sh
npm run prisma:generate -w @rental-os/platform-api
npm run build -w @rental-os/platform-api
npm run build -w {{PACKAGE_NAME}}
npm run lint -w {{PACKAGE_NAME}}
npm run lint:admin -w {{PACKAGE_NAME}}
node packages/core-contracts/dist/capabilities.js --repo {{TARGET}} --query ItemService --json
```

本包的 `lint` 会读取本包 `dist` 供 API 宿主解析；首次使用先执行 `build`，后续修改沿 build → lint → lint:admin。无需连接业务库的源码检查也可复用底座的 `scripts/check-selected-prisma-types.cjs --mode platform --config <本包或host的tsconfig路径>`。类型检查通过不代表实际数据库或页面通过。

| 修改对象 | 唯一入口与边界 |
| --- | --- |
| 字段、状态与输入 | [contracts](src/contracts.ts)，所有请求严格校验，不接受客户端 tenantId/createdBy |
| 业务与幂等 | [service](src/service.ts)，本人范围、修订条件、归档后不可编辑；同键同输入读取原结果 |
| 持久化与审计 | [mysql](src/mysql.ts)，原身份锁后取得租户业务锁；条目、回执、平台审计同事务 |
| 原平台接入 | [platform-host](src/platform-host.ts)，原身份/权限/Core准入/成员/订阅/绑定，不实现新 Guard |
| 数据就绪和移除 | [data-plan](src/data-plan.ts)、[server](src/server.ts)，原迁移摘要、公共结构观察器及移除依赖读取 |
| HTTP 与接口资料 | [http](src/http.ts) 的方法、路径和 schema 同时供 [Nest](src/nest.ts)、[OpenAPI](src/openapi.ts) 使用 |
| 四个页面 | [admin](admin/index.tsx)，复用 CorePage/CoreList/useCoreForm/useCoreRequest；详情内编辑和归档 |
| 显式宿主组合 | [API装配](host/api/src/assembly.ts)、[模块](host/api/src/app.module.ts)、[Web入口](host/admin/src/main.tsx) |
| 清单与原迁移 | [manifest](src/manifest.ts)、[SQL](migrations/001-items.sql)，已应用迁移只追加，不能修改原文 |

## 制作并准备标准包

提交本 Core 实际源码，固定仓库 HTTPS 地址和完整 SHA。`package.json.version` 与 `CORE_VERSION` 保持一致；Core 来源属于自己的项目，不能用底座 SHA 代替。以下第三个参数是生成时同源的 `packages/core-contracts/README.md`，打包按保存的 LF 文本摘要核验。

```sh
npm run pack:core -w {{PACKAGE_NAME}} -- <Core仓库HTTPS地址> <完整Core提交> <同源底座接入README绝对路径> <既有父目录中的新包.tgz>
```

打包先编译 Core 与 API 宿主，再复用正式 `corePackageFiles`、`inspectCorePackageFiles`、`renderCoreGuide` 和 `createCoreArchive`，只包含清单声明的文件，拒绝覆盖已有输出。归档含 API 的实际 JS、页面源码、OpenAPI、CORE_GUIDE、说明、许可与原迁移，不携带底座实现或 node_modules。单独读取元数据可用 `npm run metadata -w {{PACKAGE_NAME}} -- openapi` 或 `-- manifest <Core仓库HTTPS地址> <完整提交>`。

部署者在另一份同源、干净的公开底座中准备自己的依赖、公共 Client 和公共 API 构建。把 Core tgz 带入该工作区，宿主版本 JSON 取真实底座发行的 `versions`，包括实际 platform/contract/node/capabilities；不使用占位摘要或浮动 main。将标准包准备到该底座的**既有 `packages` 目录**，以保持公开 UI 构建配置的相邻包关系：

```sh
node packages/core-contracts/dist/prepare-install.js <Core.tgz> <SHA256> <底座根/packages绝对路径> <宿主版本JSON>
node packages/core-contracts/dist/check.js <返回的directory> --host <宿主版本JSON> --json
```

准备命令返回 `prepared / already_prepared` 与 `deployment=pending`，不会安装依赖、连接数据库或运行包代码。将返回的实际包目录（`packages/<ID>-<版本>-<摘要>`）加入该独立宿主根 workspaces，并按同源锁流程准备依赖。不要同时保留另一个同名源码包，不覆盖开发者的原目录，也不在已准备包中重建 API；其声明文件必须保持标准包原字节。两端实际解析的 `{{PACKAGE_NAME}}` 都须指向此完整标准包。

## 准备数据和运行宿主

[部署准备命令](host/api/src/prepare-deployment.ts)接收正式 `CorePlatformReleaseSchema` 发行 JSON、同一已准备 Core 目录与新部署目录。底座发行资料沿[公共 API 的固定发行入口]({{PLATFORM_URL}}/apps/platform-api/README.md#固定发行与部署锁)取得；实际公共数据计划须匹配。下面的命令在独立宿主根执行：

```sh
npm run prepare:deployment -w {{PACKAGE_NAME}} -- <固定底座发行JSON> <已准备Core目录> <新部署目录>
```

返回的新目录包含 `core.deployment.lock.json`、数据源 schema 和公共原迁移加本 Core 原迁移，仍为 pending。数据库先区分空库、已初始化且兼容、未知或不兼容旧库；读失败不是空库，未知旧库停止并沿原升级办法处理。安装办理顺序可对照[固定公共安装说明](https://github.com/JinPen-G/Zelo/blob/a471b9472804a6bf0a9b5681a94650b9929c87b5/apps/platform-api/README.md#从诊断到初始化与就绪)，实际依赖仍以本包固定的底座材料为准。

只有在明确获准的目标环境，才执行组合迁移及公共初始化：

```sh
node node_modules/prisma/build/index.js migrate deploy --schema <新部署目录>/schema.prisma
npm run initialize -w @rental-os/platform-api
```

公共初始化只创建原 SaaS 主体，不创建业务租户、条目或 Core 授权；已有账号沿原初始化合同保留，不重置密码。当前进程提供自己的 `DATABASE_URL`、`AUTH_TOKEN_SECRET`；初始化时另提供 `SEED_PLATFORM_PASSWORD`。本包不读取 `.env`，不要将这些值写入源码或归档。

PowerShell 设置当前进程的固定锁后，两端使用同一个标准包启动；Bash 用等价的 `export CORE_DEPLOYMENT_LOCK=...`。下面的启动命令会监听端口并访问配置的业务库，须在获准环境执行。

```powershell
$env:CORE_DEPLOYMENT_LOCK = '<新部署目录>/core.deployment.lock.json'
npm run start:api -w {{PACKAGE_NAME}}
# 在另一个相同配置的终端：
npm run build:admin -w {{PACKAGE_NAME}}
npm run dev:admin -w {{PACKAGE_NAME}}
```

API 默认 3000，`API_PORT` 可显式调整；Web 默认 5177，`ADMIN_PORT` 可调整，开发代理 `API_PROXY_TARGET` 默认 `http://127.0.0.1:3000`。浏览器固定请求同源 `/api`；正式 Web 部署使用同源 API 或受控反向代理。API `TRUST_PROXY_HOPS` 默认 0，只有核定代理跳数的环境才配置。Vite 不读取 `.env`、不公开进程密钥，只向浏览器提供通过包摘要核验的清单。

启动前会拒绝 Core 标识、版本、源码来源或完整字节与锁不一致的包，以及 Node/合同版本不符的组合。原 `CoreHostPermissionStartup` 在监听前登记四项精确权限目录；登记不是角色授权。[唯一生命周期](host/api/src/lifecycle.ts)等待原权限登记、Guard 和完整处理器结束，HTTP 关闭后释放同一数据库池，客户端断线不取消已派发的事务。

## 准入、授权、使用和停用

公共健康入口是 `/api/health`，本宿主组合资料是 `/api/openapi.json`。管理请求都复用[正式管理合同]({{PLATFORM_URL}}/packages/core-contracts/src/management-http.ts)，字段与错误从该版本 OpenAPI 读取：

1. SaaS 管理员登录并完成原首次改密，读取 `POST /api/platform/core-host/deployment-admission/read`，指定 `coreId: "{{CORE_ID}}"`。仅确认尚无记录时，用唯一 `operationId`、`expectedRevision: 0` 向 `deployment-admission` 显式登记 `accepting`。已有 stopped/修订保持原事实；失应答只查 `deployment-admission-operations/read`。
2. 经公共租户管理创建业务租户和首个管理员，再从“租户 Core 授权”开通本 Core。租户管理员登录，在角色权限中显式选择 `{{CORE_ID}}:item:read`、`{{CORE_ID}}:item:create`、`{{CORE_ID}}:item:update`、`{{CORE_ID}}:item:archive` 所需项，在人员管理中分配角色，并在“成员 Core 分配”分配自己和业务成员。每项使用其适用身份，SaaS 会话不能调用条目业务。
3. 已分配的租户管理员进入“条目设置”，通过原绑定服务完成首次设置；重复进入只读取原绑定。成员随后可使用列表、新建、详情编辑与归档。列表搜索和总数来自同一数据库观察，后台不生成替代业务数据。新建仍受原订阅新业务准入约束。
4. 成功写入返回原 `{data,requestId}` 信封内的 `operationId` 与条目快照。网络错误、超时或500不证明没有提交；页面保留原操作键并只读 `/api/cores/{{CORE_ID}}/operations/<原键>`。暂不可用时继续保留定位，不换键重发。精确拒绝、旧修订与未知结果分别处理。
5. 停用与重开仍走原租户 Core 授权入口：先读 `tenant-grants/read`，按当前修订显式更改并核原收据；成员撤回使用 `member-assignments`。停用不删除绑定、条目或原回执，重开不重新分配已撤回成员。普通业务继续核 Core/成员/权限；原回执入口只在当前精确读权限、原绑定、本人对象及原操作者均成立时读取历史结果，不恢复业务执行权。

Core 已提供真实历史与未归档依赖检查。完整移除还需要平台任务、回调及历史依赖权威：宿主通过 `composeApplication` 的 `platformRemoval` 参数接入原 `CorePlatformRemovalSource` 后，才有完整 `removal/read`；默认未提供时保持不可用，不把停用视为排空或删除许可。

本模板接入的是正式 Core 管理与 CLI 包准备。在线版本发现、付费授权及 AI 不在此宿主中装配；没有权威时不可用。静态包准备不代表迁移、部署准入、授权、绑定或业务已经成功。

## 只改 Core 的小扩展

从同一固定公开底座重新生成本模板，给列表增加“说明包含”筛选；无需改底座、数据库或已有迁移。先在 [contracts](src/contracts.ts) 的 `ListQuerySchema` 加：

```ts
description: z.string().trim().max(160).optional(),
```

再在 [mysql](src/mysql.ts) 的 `visible_items` CTE 中，紧跟已有标题筛选加一段参数化条件：

```ts
${query.description ? sql`AND LOCATE(${query.description}, description) > 0` : empty}
```

最后在 [列表页面](admin/index.tsx) 增加 `description` 输入状态、把 `description.trim()` 加入 `listKey`，请求 `params` 加 `description: description.trim() || undefined`，并在 `controls` 加同款带 `aria-label` 的 Input。输入变化同标题一样执行 `setOffset(0)`，保持原页大小、本人范围和当前请求代次。OpenAPI 与 Nest 自动沿同一个 ListQuerySchema 接收字段，不另外抄 DTO。

沿上述 build/lint/lint:admin 和标准包检查复验；在获准环境确认“同标题、不同说明”的本人条目可筛出正确正文与总数，清空恢复列表，其他成员/租户仍不可见。已发行 Core 升 `package.json.version` 和 `CORE_VERSION`（例如 `0.1.1`），数据版本保持不变；提交并打包新的固定 SHA，按原更新预检准备新组合，不修改旧包或旧迁移。

独立验收还需在实际环境核：持久化读写及重启、四页操作、未授权/跨租户拒绝、同键原结果、停用/重开与成员撤回保留，以及上述小扩展。源代码、离线类型/合同/构建结果和真实数据库/浏览器证据分别记录；没有实际运行记录时不能据此宣布整条链已验收。
