# Core 接入契约

这个包让底座和业务 Core 使用同一份清单、版本规则和对象引用。正式入口为 `@rental-os/core-contracts`；目录检查使用 Node 专用出口 `@rental-os/core-contracts/package`。包不导入 Rental、Nest、Prisma 或模型 SDK。

**目前已实现清单、静态包检查、OpenAPI 贡献组合、服务端注册合同及独立升级预检。** 普通业务宿主、授权持久化、页面和业务样例仍在拆分中。下面的检查可以运行；检查通过不代表 Core 已安装或业务可用。完整接入手册在[五步快速接入](../../docs/平台底座/Core接入/平台Core接入-开发任务.md#core-quick-start)随实现维护。

## 先检查一个 Core 包

在已按仓库锁文件准备依赖的工程根目录运行，PowerShell 与 Bash 用法相同。

```sh
npm run build -w @rental-os/core-contracts
node packages/core-contracts/dist/check.js <解包后的Core目录> --json
```

包根需要 `core.manifest.json`、`README.md`、`LICENSE`、随版本生成的 `CORE_GUIDE.md`，以及清单中列出的入口、资源与迁移。第一条命令只编译本包；第二条只读文件，没有下载、解压、加载业务模块或执行迁移。

提供宿主版本资料后，可以进一步检查兼容范围和必需能力。

```sh
node packages/core-contracts/dist/check.js <解包后的Core目录> --host <宿主版本JSON> --json
```

宿主 JSON 的结构为 `platform`、`contract`、`node` 三个实际发行版本和 `capabilities` 能力版本表。没有实现对应公共能力时，能力表不填该项。字段定义分别见[宿主资料](src/compatibility.ts)、[唯一清单 schema](src/manifest.ts)；类型由 schema 推导，不另维护一份字段定义。

输出中的 `scope` 固定为 `package-static`。`compatibilityChecked=false` 表示未指定宿主资料。退出码 `0` 表示所选静态检查通过，`1` 表示包不合格，`2` 表示命令用法或读取失败。机器读取时使用上面的 `node ... --json`，标准输出只有一份 JSON。

| 常见结果 | 处理方式 |
| --- | --- |
| `manifest_invalid` | 按 `field` 定位必填字段、版本格式、未知属性或重复声明 |
| `file_unavailable` | 将声明的入口和交付文档放入包内；不要用本机绝对路径引用 |
| `path_outside` / `linked_path` / `path_collision` | 使用普通包内文件，清除上级路径、符号链接和大小写冲突 |
| `checksum_mismatch` | 核对迁移原文和发布清单，不能改已应用迁移来适配旧包 |
| `platform_version` / `contract_version` / `node_version` | 选择在所声明兼容区间内的底座、合同与 Node.js 版本 |
| `missing_capability` / `capability_version` | 准备实际需要的公共能力，或选择兼容 Core；不填假能力让检查变绿 |

检查读取不含凭据的来源元数据。清单解析前限制为 256 KiB，迁移和 OpenAPI JSON 单文件上限 32 MiB；其余入口和资源只查文件元信息。检查对象应是本次独占、内容不再变化的解包目录，部署前仍须核对整个发布包摘要。该工具不审核业务代码，也不把清单来源视为代码可信证明。

## 命名、版本与权限

- Core ID 使用小写字母、数字和连字符，例如 `rental`、`example-tickets`，不使用租赁品类编码充当 Core 类型。
- 当前合同版为 `0.1.0`。首版支持确定的三段数字发行版本；兼容区间使用包含下限的 `minInclusive` 和不含上限的 `maxExclusive`，不解释 `latest`、npm 范围或预发行标签。
- 底座发行、Core 实现、合同和数据各有自己的版本。清单和宿主资料先经各自 schema 解析，再调用 `checkCoreCombination` 检查组合；它支持空组合，也拒绝同 ID 的两个实现、缺能力和不兼容版本。
- Core 权限声明由本地 `resource` 与 `action` 组成，`corePermissionCode` 输出 `<coreId>:<resource>:<action>`。这是权限目录的声明，不会授予任何角色；旧 Rental 权限保持原兼容适配。
- 业务可以只以租户为范围，也可以声明自己的容器类型。对象键同时包含 Core、租户、容器与对象类型/ID；它只定位对象，不能作为授权证据或替换历史幂等键。
- `admin`、`openapi`、`ai`、`jobs`、`events` 均为可选入口；未提供 AI 不要求写空工具。已声明入口必须存在。业务是否可用仍由后续真实装配、注册、授权和就绪决定。

## 给 Core 附上 API 说明

在清单 `entries.openapi` 指向一份包内 JSON，内容使用标准 OpenAPI 3.0 的 `paths` 和 `schemas` 两个集合。`schemas` 对应最终文档的 `components.schemas`，字段不再维护第三套私有 DTO。该 JSON 应从 Core 实际接口合同生成或与其一同验证，不能把没有实现的路由写成已经支持。

- 新接口路径位于 `/api/cores/<coreId>/...`，`operationId` 和 schema 名以 `<coreId>.` 开头。
- 每个操作写明 `summary`、`responses` 和显式 `security`；其余 OpenAPI 标准字段可描述参数、请求体、错误和示例。公开接口使用空 `security`，仍须由真实 Controller/Guard 实现对应政策。
- `$ref` 只使用本地 `#/components/schemas/...`，引用本 Core 或平台公共 schema；不能借另一个 Core 的 schema 隐式取得依赖。检查不访问外部 URL。
- 包检查会读取该 JSON 并核对归属和最小文档字段。该检查不替代完整 OpenAPI 规范校验、Controller/DTO 对照和实际接口验证。

宿主从正式出口调用 `CoreOpenApiContributionSchema.parse` 和 `composeCoreOpenApi(platformDocument, selectedCores)`。只有所有贡献无冲突时才返回 `document`；失败返回定位明确的 `issues`，不修改原文档。结果可用于原 `/api/openapi.json` 入口与同版本离线输出，现有主应用的实际接线尚待宿主阶段。

保留 Rental 旧路径时，受控宿主可给检查器/组合器传入属于该 Core 的精确 `METHOD /path` 白名单；这个例外由宿主维护，不在 Core 清单中提供，也不会创建或放宽任何路由授权。静态检查命令默认使用新 Core 命名空间。原 operationId/schema 名称的兼容映射尚待实际迁移片核定，目前没有替换原主应用文档。

## 提供服务端贡献

包的 `entries.server` 指向本 Core 的服务端入口。受控宿主从该入口直接导入真实实现，并把实例作为 `CoreServerRegistration.server` 传给 `registerCoreServers(registrations, hostVersions)`。检查器没有 `load(path)`，不会拿清单中的字符串直接执行代码。

[服务端合同](src/server.ts)要求贡献的 `coreId`、`implementationVersion` 与清单一致。它只承担公共生命周期需要的窄接点，订单、工单等业务 API 继续使用各自的类型化 Controller/应用服务。

| 接点 | Core 提供什么 | 宿主负责什么 |
| --- | --- | --- |
| `resolveScope` | 根据当前主体验证本 Core 的租户/容器范围，返回绑定、拒绝或未建立绑定 | 原认证、租户 Core 授权、适用成员分配；不能把客户端提交的标识视为可信身份 |
| `readReadiness` | 读取当前业务配置，返回就绪、明确缺项或不可用 | 分别表达授权、绑定和业务就绪，不因注册成功就显示业务可用 |
| `initialization`，可选 | 仅需要初始业务事实时提供；用 `defineCoreInitializer` 按自己的 schema 解析输入一次 | 锁定原操作、当前权限和候选绑定，在同一事务内写绑定、业务初始事实及审计；提交后发布可见变化 |
| `assessRemoval`，可选 | 返回在途、unknown、回调、作业和历史读取阻碍 | 汇合平台自身依赖；缺少检查器或存在阻碍时不能移除代码 |

`registerCoreServers` 支持空组合和多个不同 Core，检查失败返回 `issues`，不会返回部分注册表；成功返回 `registrations`。注册不会调用上述业务方法，也不会创建数据库记录、路由、定时任务或 AI 工具。现有 Nest 组合与持久化服务接线仍待宿主切片；当前函数通过不表示主应用已完成拆分。

[授权与生命周期 schema](src/lifecycle.ts)分别定义租户 Core 授权、成员分配、绑定、就绪和原操作引用。已保存事实的修订从 1 开始；变更请求的 `expectedRevision=0` 只表示记录尚不存在。成员分配请求不包含 `tenantId`，由当前租户身份确定管理边界。合同不定义 Core 独立到期日，统一期限继续由原订阅服务维护。

`CorePrincipal` 仅是原认证服务解析后的主体定位，不携带可自报的权限数组。`CoreTransaction` 是宿主事务回调内的临时句柄，适配器只解析成当前 Core 的受限仓储，回调结束后失效；类型标记不能替代运行时校验。目前只定义该合同，尚无可供业务调用的通用事务执行器。

停用只关闭对应普通业务和新 Agent 任务；数据、绑定、成员撤权及原收据继续保留。恢复先读取原绑定并复核当前条件，不调用首次初始化。`CoreOperationReference` 只定位原操作，不能根据超时、程序重启或再次开通认定旧操作未执行。

## 声明页面与操作

[页面合同](src/admin.ts)已提供 `CorePageDescriptorSchema`、`CoreAdminContribution`、`CorePageAction` 和 `registerCoreAdminPages`。路由描述中的ID/局部路径、名称、可选父级与菜单、权限是同一份数据；组件由Core代码直接绑定。统一注册后路径位于 `/cores/<id>/...`，重复页面、同形路径、缺上级/循环或清单未声明的权限会拒绝，失败不返回部分注册表。

例如，工单的路由元数据可以写成下面这样；这里只演示已实现schema的描述，不是完整可运行页面。

```ts
const route = CorePageDescriptorSchema.parse({
  id: "tickets",
  path: "/tickets",
  title: { default: "工单", translations: { "en-US": "Tickets" } },
  menu: {},
  permissions: [{ resource: "ticket", action: "read" }]
});
// 在本Core中绑定实际组件：{ ...route, component: TicketsPage }
```

每个页面只声明自己的操作，`CorePageAction`区分四类。

| kind | Core提供 | 框架适配应采用的既有行为 |
| --- | --- | --- |
| `navigate` | 已登记页面目标及参数 | 导航，不显示业务写入成功 |
| `open` | 打开本页表单/弹窗的方法 | 只打开，不提前提交 |
| `command` | 返回真实Promise的业务方法，可选确认内容 | 既有动作/确认按钮、加载/结果反馈及重复点击保护 |
| `save` | 本页Form及有明确字段类型的onSave | 原SaveButton先校验再单次保存，与回车提交共用 |

例如“新建工单”是 `kind: "open"`，由本页提供 `open`，`emphasis: "primary"` 表达主操作；无需自行指定CSS。动作可声明附加权限和当前不可用原因。`resolveCorePageLocation`只按已登记目标编码参数，不能导航任意外部URL；注册或路径存在均不授予当前用户访问权。

**当前已实现描述/注册与路径解析，React页面呈现适配尚未接入。** 后续07通过原BusinessShell/WorkspaceHeader和按钮适配消费这些类型，保留完整左栏、面包屑行、铃铛、休息、收展与统一页面模式；不能把类型声明存在当主按钮已自动显示。字段类型、动态动作和既有表单Promise都保留在Core/React代码中，不执行JSON表达式。

## 分别更新底座或一个 Core

先构建本包，再用实际发行元数据和迁移账快照执行只读预检。

```sh
node packages/core-contracts/dist/plan-update.js <当前锁JSON> <升级请求JSON> <数据观察JSON> --json
```

三份输入分别按[升级合同](src/update.ts)中的 `CoreDeploymentLockSchema`、`CoreUpdateRequestSchema`、`CoreDataObservationSchema` 解析。当前锁固定底座与每个 Core 的发行版本、提交、包摘要及兼容资料；升级请求只选择 `platform` 或一个 `core`。数据观察由目标环境原迁移账提供，包含实际数据版本与有序迁移摘要，不能复制清单当作数据库已完成的证明。本命令不连接数据库。

检查依次核对来源与不可变发行、全部选中模块的版本兼容、数据可读性和迁移历史。已发布迁移只追加，不能改原文件、顺序或摘要。若有新迁移，实际数据须先处于当前发行的完整基线，数据版本必须前进；中断或记录矛盾时先核对原迁移，不自动重做。

成功结果的 `status` 分为 `unchanged`、`candidate`、`migration_required`。`candidate` 是返回值中的新锁，原输入文件及未选择更新的 Core 保持；`migrations` 指出所属模块和待执行链，不表示已经应用。`owner=platform` 表示底座，`owner=core:<id>` 表示业务 Core，二者即使名称相同也不混用。

| 拒绝结果 | 需要处理的内容 |
| --- | --- |
| `source_conflict` / `release_changed` / `release_metadata_changed` | 核对原来源；同版本提交、包摘要或元数据变造须重新发布新版本 |
| `core_not_installed` / `core_identity` | 新增 Core 先走安装；更新不能换成另一 Core |
| `platform_version` / `contract_version` / `missing_capability` | 核对整个候选组合的兼容范围与必要公共能力 |
| `data_unavailable` / `data_observation_conflict` | 从真实迁移账取得完整一致的版本与摘要 |
| `migration_changed` / `migration_history` / `migration_baseline` | 原迁移链须不可变；先核对历史或未完成迁移 |
| `other_module_not_ready` | 当前其他模块的迁移未完成，不能借此次更新一并隐式升级 |
| `release_rollback` / `data_rollback` | 使用已有验证的程序/数据恢复方案；这个命令只准备前进升级 |

退出码 `0` 表示预检通过，`1` 表示候选被拒绝，`2` 表示输入/用法或读取失败。这个阶段只输出候选，后续还须核对包摘要、用户改动、在途/历史执行依赖，按授权执行迁移、组合构建与切换并取得实际验证。锁文件不存用户配置、Key 或租户授权；本工具不自动写文件或部署，也不能据此宣称更新已经成功。

## 生成随包指南与归档

`CORE_GUIDE.md` 从任务册的快速入口和Agent模板生成。传入Core清单与含 `repository`/`commit` 的底座来源JSON，底座提交必须已在当前本地Git中存在；来源不含凭据。

```sh
node packages/core-contracts/dist/generate-guide.js <Core清单JSON> <底座来源JSON>
```

命令只向标准输出写Markdown，不覆盖包内已有指南。程序内可从正式出口调用 `renderCoreGuide(manifest, taskDocument, platformSource)`；所有引用指向指定提交。缺少原文锚点会拒绝生成，指南保留对应版本的支持状态。完整页面接入要求见[页面声明](../../docs/平台底座/Core接入/平台Core接入-开发任务.md#declarative-page-contract)，目前既有页面原语仍待正式Core适配接线。

Node专用出口 `@rental-os/core-contracts/archive` 提供 `createCoreArchive(files)` 与 `readCoreArchive(bytes, expectedSha256)`，采用USTAR+gzip。相同文件按固定排序、权限和时间打包；校验整个压缩包SHA-256后返回内存文件。首版最多5000文件、单文件32MiB、解压总量128MiB，只接普通文件，不接PAX/软硬链接、目录条目、重复或越界路径。包内禁止实际 `.env`、Git元数据和node_modules；保留 `.env.example` 模板入口。

## 打包与本地安装准备

将清单中的入口、迁移和资源，以及README/LICENSE/CORE_GUIDE.md放在一个固定的Core交付目录。源文件、依赖声明及其他构建材料需要随包交付时，在清单`assets`显式列出；打包只读取声明集合，不扫描整个工作区。

```sh
node packages/core-contracts/dist/pack.js <Core交付目录> <新包路径.tgz> [宿主版本JSON]
node packages/core-contracts/dist/prepare-install.js <Core包.tgz> <SHA256> <既有独占待部署根目录> <宿主版本JSON>
```

输出包的父目录和待部署根目录须由部署者预先选定并存在，均使用不经过链接的普通目录。第一条命令拒绝覆盖已有包，输出JSON中的`sha256`用于第二条命令；第二条先检查整个压缩包、同一清单/文件/API规范及宿主兼容，全部通过后才写待部署目录。包不允许夹带未声明文件，不执行包内源码或安装脚本。

准备结果为`prepared`或`already_prepared`，`deployment`始终为`pending`，并给出实际目录、Core ID、版本与摘要。目录使用该发行的完整摘要区分；重复操作核对原文件字节后复用，已有目录被用户修改、缺文件或出现链接时明确拒绝覆盖。失败只清理这次创建的暂存目录，不改活动组合或其他已准备版本。两个命令成功退出0，输入/兼容/文件失败退出1并在stderr说明原因；成功stdout只包含JSON。

程序调用使用Node专用`@rental-os/core-contracts/install`出口的`packCoreDirectory`和`prepareCoreInstall`。解包文件检查与原目录检查共用[包检查实现](src/package.ts)。此阶段已具备本地文件准备，后续仍需受控组合构建、迁移/数据核对、实际部署注册，再办理租户授权与成员分配；远端Release获取和Topic发现尚未连接。包完整性不能证明代码已经审核。

## 源码路线与验证

[公共出口](src/index.ts) → [清单](src/manifest.ts) / [版本](src/version.ts) / [组合预检](src/compatibility.ts) / [对象引用](src/reference.ts) / [OpenAPI贡献](src/openapi.ts) / [授权与生命周期](src/lifecycle.ts) / [服务端注册](src/server.ts) / [页面声明](src/admin.ts) / [升级预检](src/update.ts) / [指南生成](src/guide.ts)。[包检查命令](src/check.ts) → [目录/文件检查](src/package.ts) → 同一清单与 OpenAPI schema；[升级命令](src/plan-update.ts) → 升级输入schema与纯预检；[指南命令](src/generate-guide.ts)读取固定Git任务原文。[打包](src/pack.ts)/[安装准备命令](src/prepare-install.ts) → [文件准备](src/install.ts) → [归档](src/archive.ts)，仅走Node出口；这些入口不加载Core业务代码。

```sh
npm test -w @rental-os/core-contracts
```

[单一验证入口](test/core-contracts.test.cjs)使用本树源码进行类型检查和编译，运行必要合同用例后清理本树 `output/.tmp/core-contracts`。它验证空/单/双 Core 声明、独立版本、越界/链接路径、迁移摘要、缺文件与 CLI；这些是静态及离线行为证据，不是租户、数据库或浏览器验收。

[正式需求](../../docs/平台底座/Core接入/平台Core接入-需求.md)与[任务](../../docs/平台底座/Core接入/平台Core接入-开发任务.md)维护全量交付；[开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md)记录已实现阶段，[协作接续](../../docs/平台底座/Core接入/平台Core接入-协作接续.md)定位下一入口。
