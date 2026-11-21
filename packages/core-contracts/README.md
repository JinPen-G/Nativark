# Core 接入契约

这个包让底座和业务 Core 使用同一份清单、版本规则和对象引用。正式入口为 `@rental-os/core-contracts`；目录检查使用 Node 专用出口 `@rental-os/core-contracts/package`。包不导入 Rental、Nest、Prisma 或模型 SDK。

**目前已实现清单/页面/服务端合同、静态包检查、OpenAPI 贡献组合、独立升级预检及本地/固定 GitHub Release 包准备。** [公共宿主适配](../platform-core-host/README.md)已提供真实身份、授权/绑定和HTTP主接点，默认无Core宿主消费空目录；选中Core的完整运行/持久化、页面和安装验证仍在拆分中。开发新Core从下面的五步开始，本手册与代码一起公开发布。

## 单独取出底座源码

已检出的维护者仓库可以从一个完整 Git 提交导出零 Core 源码包。先构建本包，再运行以下命令，将 `<完整SHA>` 替换为要交付的已提交版本。

```sh
npm run build -w @rental-os/core-contracts
npm run export:platform -- --repo . --repository https://github.com/JinPen-G/Nativark --commit <完整SHA> --out nativark-platform.tgz
```

解包后包含公共 API、公共后台、平台包、UIArc 源码和许可、公共数据库链及必要配置。独立后端运行包所需的具名打包脚本也随源码提供，按[公共 API 的运行包步骤](../../apps/platform-api/README.md#独立后端运行包)使用。根 workspace、默认构建/启动命令和 npm v3 锁文件按同一闭包生成。包内 README 给出安装、初始化和启动步骤，`platform.source.json` 保存固定来源及文件摘要。现有输出文件会被拒绝，不读取工作区未提交代码。[发行实现](src/platform-source.ts) · [命令入口](src/export-platform.ts)

`@rental-os/core-contracts/platform-source` 也提供文件集与归档接口，可用于源码发行。它只准备源码；运行环境和业务 Core 由使用者按接入说明配置。

<a id="core-quick-start"></a>

## 五步快速接入

准备 Node.js 22 LTS、npm 锁定依赖和独立 MySQL 开发库，环境配置见[根 README](../../README.md#本地运行)。默认无Core的[API宿主](../../apps/platform-api/README.md)和[后台宿主](../../apps/platform-admin/README.md)是公共框架；[工单Core](../example-tickets-core/README.md)提供业务链的开发样例。完整安装与真实运行验收仍在继续，具体命令的前置按各宿主说明准备。

1. **从最小Core确定业务和标识。** 以工单包为参考，在自己的Core中实现实体、状态、校验和存储。维护[业务合同](../example-tickets-core/src/contracts.ts)、[清单](../example-tickets-core/src/manifest.ts)及[独立迁移](../example-tickets-core/migrations/001-tickets.sql)，更换Core ID、名称、版本和业务字段。Core自行选择租户或自己的容器范围；会员、库存、金额等领域规则由业务决定。清单使用本文的唯一schema，固定声明来源、兼容范围、权限、入口和数据版本。
2. **提供同源服务与API。** 参考[服务](../example-tickets-core/src/service.ts)、[HTTP合同](../example-tickets-core/src/http.ts)、[服务端贡献](../example-tickets-core/src/server.ts)和[Nest适配](../example-tickets-core/src/nest.ts)。复用公共当前身份、Core授权与成员范围，业务再校验角色、对象及提交条件；OpenAPI从同一请求/响应schema生成。Core可以省略AI贡献，普通业务仍按原权限工作。
3. **声明页面和本页主按钮。** 参考[工单四页](../example-tickets-core/admin/index.tsx)，从 `@rental-os/platform-admin/core` 使用 `CorePage`、`useCoreForm`、`CoreList` 和 `useCoreRequest`。声明路由、父级、权限和页面动作，复用框架侧栏、面包屑、主按钮、表单反馈及缓存隔离。页面通过已注册映射导航，避免自行复制外壳或请求客户端。宿主接入见[工单Web的三处装配](../../apps/example-tickets-admin/README.md#接入只看这三处)。
4. **构建并检查固定标准包。** 包含 `core.manifest.json`、实际入口、同版本 `openapi.json`、生成的 `CORE_GUIDE.md`、README、LICENSE及所声明迁移。先提交自己的源码，再按[工单打包说明](../example-tickets-core/README.md)构建并生成一个新包；用下面的共用检查核清单、路径、入口和兼容。安装准备和更新预检分别见本文后面的说明，未知结果沿原包或操作读取。
5. **只在宿主装配，然后授权使用。** 参考[工单API装配](../../apps/example-tickets-api/src/assembly.ts)和[Web入口](../../apps/example-tickets-admin/src/main.tsx)，将受控Core贡献交给公共宿主，两端使用同一标准包和部署锁。按[服务端步骤](../../apps/example-tickets-api/README.md)准备迁移、初始化公共账号并登记精确权限；SaaS管理员授权租户，租户管理员分配成员及业务角色，再完成Core绑定与业务设置。包、租户授权、成员分配和业务就绪分别成立。

```sh
npm run build -w @rental-os/core-contracts
node packages/core-contracts/dist/check.js <已解包Core目录> --host <宿主版本JSON> --json
node packages/core-contracts/dist/capabilities.js --query CorePage --json
```

验证至少覆盖业务正常操作、未授权/跨租户拒绝、同请求键读取原结果、单Core停用与重开，以及不选该Core时公共登录和设置可用。服务端事务、授权与原收据负责正确性，界面防重不能替代它们。底座和Core各自发布新版本，使用同一版本锁预检；数据迁移保留原文，升级不重置用户配置或授权。

<a id="core-agent-template"></a>

## 交给开发Agent的任务模板

将下面的文本和目标业务要求一起交给Agent。无需提供维护者的内部开发文档。

```text
请在这个仓库开发一个业务Core。
先读 packages/core-contracts/README.md 的五步快速接入，
按需要查看 packages/example-tickets-core 和两个工单宿主的真实入口。
Core ID、业务范围、字段、动作与角色按我提供的业务要求定义。
复用正式平台合同、身份、存储协调、后台外壳、表单、列表和请求工具。
页面路由与主按钮用正式贡献声明，只修改Core及明确的宿主装配配置。
请求/响应和OpenAPI使用同一schema，权限、对象、事务与幂等在服务端校验。
AI工具可选，不提供时不要扫描API或数据库自行补工具。
同步源码职责和Core README，生成标准包、CORE_GUIDE.md与API资料。
每个完整切片只做必要类型检查和一次相关冒烟，不新增大量测试脚本。
交付包版本/摘要、实际修改入口、验证结果和未验条件。
安装、迁移、服务启动与真实业务连接按我明确授权的环境执行。
```

### 快速路径之外按需查阅

查功能从下方能力索引开始；查字段和注册规则沿正式源码；查宿主、数据或界面分别看对应模块README。后续章节提供包检查、服务端/HTTP/页面贡献、独立更新和GitHub发现的详细参考。

## 找到平台已有的功能

开发 Agent 可以先按任务查询，再打开结果给出的源码和接入资料。在已准备依赖的源码根目录构建本包后运行以下命令，PowerShell 与 Bash 使用相同参数。

```sh
npm run build -w @rental-os/core-contracts
node packages/core-contracts/dist/capabilities.js --query SaveButton --json
node packages/core-contracts/dist/capabilities.js --query 工单 --kind page --json
node packages/core-contracts/dist/capabilities.js --id "api:GET:/api/auth/me" --json
node packages/core-contracts/dist/capabilities.js --owner example-tickets --json
```

每项结果包含名称、类型、归属、版本、源码路径和行号、正式导入或 HTTP/页面入口，以及可用的文档链接和原声明元数据。公共导出还给出直接导入计数和前5个源码位置，可以从已有消费者了解用法。统计支持具名和默认导入、namespace 的确定成员，以及字面量 `import()` / `require()` 的解构和成员读取。同一 namespace 绑定重复读取同一导出只计一次。动态模块名、动态成员名及整模块传递保持未展开，`directImportsStatus=not-indexed` 的零计数表示缺少可定位的本仓声明。查询默认返回20项，使用 `--limit`（最多100项）和 `--offset` 分页，`nextOffset` 给出下一页位置。`--owner` 按输出中的准确归属筛选，`--kind` 支持 `module`、`export`、`ui`、`page`、`api`、`extension`。`--repo` 可显式指定本次源码根目录。

索引从 workspace 包出口、TypeScript 导出与源码说明、Controller 路由、后台 `APP_ROUTES`、Core 清单与页面贡献和 UIArc 来源清单读取。workspace 支持 `packages/*` 等一层通配目录，以及底座源码发行中的 `packages/core-contracts` 等显式目录。正式出口按实际条件和构建目录映射到源码，`rootDir` / `outDir` 使用原 TypeScript 配置及其本仓继承配置；配置不可读取时保留未解析出口，不用历史生成物补成源码。兼容转接参与符号解析，直接导入统计读取已发现 workspace 的 `src`。局部别名沿导入文件所属的原 TypeScript 配置解析。Controller 与旧后台路由只从本次所选 workspace 取得，零 Core 底座和所选 Core 的来源分别保留。源码新增或迁移后再次查询即可反映变化。新增 Core 使用自己的正式包出口、清单、页面和 API 贡献登记能力，宿主可通过 `@rental-os/core-contracts/development` 的 `describeCoreDevelopmentCapabilities` 取得同源目录，查询合同由该出口提供。[能力目录实现](src/development.ts)

Core 条目读取正式清单声明中的静态标识、版本、范围和依赖，页面与 HTTP 条目附同一清单出处及包版本。构建时注入的来源、动态权限和未解析字段保留在 `unresolvedMetadata`。`httpContract.schemas` 定位 Controller 使用的合同，`openapiSource.schemas` 定位正式操作表的请求、参数和响应说明。公共操作表按同源 `/api` 路径及 `Platform.*` schema 名连接资料，公共与 Rental 各使用自己的正式 schema 聚合。

字段读取保留原 `expression`、声明和引用。字面量、静态对象/数组、常量及本仓单一返回表达式可给出 `schema`，`fieldSources` 用 JSON Pointer 定位其中已有字段的源码行，引用条目同时提供递归 schema 和各自缺口。原必填、可空、默认值、单位及描述随声明读取。`sourceFields` 列出原 AST 的字段表达式和出处，Zod 的 `omit`、校验或转换仍沿原表达式核对。动态调用、展开、计算键、递归表达式及原宽泛对象分别列出原因，状态为 `source-reference`。未知展开可能覆盖的早期属性从已展开结果移除。缺少本地引用时标记 `not-indexed`。`schemas.parameters.schema` 给出从正式参数声明和同源生成器规则读取的路径/查询列表。公共显式列表覆盖推导，Rental 显式路径参数保留自己的限制，生成器只补缺少的路径项。查询 schema 的原枚举、范围和默认值随资料提供；来源见 `sources`。字符串字面量数组经单参数同步箭头函数 `map` 生成的参数列表也可静态读取，并只追踪所选字段的 schema；读取器不执行表达式，其他动态映射继续保留来源缺口。未知列表、schema 或覆盖继续列入 `parameters:source-reference`。[静态字段读取](src/repository-openapi.ts)

可确定的 `Object.assign`、同模块顺序明确的顶层后置组合、本地同步纯函数和成员引用按最后覆盖顺序读取，字段出处跟随最终声明。未知来源可能覆盖的旧字段会失效，后续明确字段仍可定位；循环、未知写入、访问器或无法确定的组合保留实际来源与缺口。扫描不会执行这些调用。

`openapiSource.controllerParameters` 将列表连接到实际 Controller 参数。类型、可选标记、`defaultExpression` 和静态 `declaredDefault` 沿原声明提供，`defaultStatus` 及 `defaultIssues` 说明动态默认值。无参 `@Query()` 引用本仓可静态枚举的平面DTO时，字段名逐一对应已有正式参数，保留原类型、可选标记、校验/转换表达式与源码行号；该对应不从DTO另生成schema。继承、泛型、构造/方法、计算或静态字段、动态Query名、默认与pipe继续标明来源缺口。品类候选 `operation` 的可选string、upgrade/restore及默认upgrade沿正式HTTP声明读取。生成器字段与Controller声明可分别核对，实际输入转换及业务限制继续由原入口执行。[公共订阅参数消费](../platform-server/src/modules/subscription/subscription-platform.controller.ts) · [Rental参数生成规则](../rental-core/src/http-openapi-contract.ts)

`controllerRequestBodies` 定位原 `@Body()` 参数及其 DTO 属性、类型、默认表达式和装饰器，`fieldNamesStatus` 只说明字段名称是否能静态定位。DTO 资料保持 `source-reference`，JSON Schema 的完整性沿 `schemas` 中的 `status` / `issues` 判断。正则字面量的 `.source` 和所选静态约束读取原声明；动态构造、继承、泛型及运行转换保留缺口。未索引引用的 `mapSources` 指向实际 schema 聚合入口，`schema-map:source-reference` 表示聚合尚未展开，`schema-reference:not-indexed` 表示静态集合缺少所选引用。请求体字段资料与返回体、校验和业务运行分别核对。[请求体与引用读取](src/repository-openapi.ts)

`apiFieldsStatus=indexed` 表示已登记字段资料可静态读取。正式接口贡献的 `details.openapi` 保留请求体、参数、响应、递归引用和 JSON Pointer，原 `x-schemaStatus`、`x-schemaGaps` 继续表达字段完整性。Controller/DTO 对照、动态资料与实际运行按各自入口核验。CLI 显示来源、状态和缺口，`--json` 保留完整资料。

CSS 转导出在本仓资产存在时登记 `declarationStatus=source-asset`，`sources` 同时保留资产和转导出位置。外部转导出沿所属包的依赖声明登记 `external-dependency`，`reexport.dependency` 给出包名、版本范围和声明出处。其实现与运行支持由原依赖提供。其余缺少本仓目标的转导出保留正式导入、原模块和本地位置，`declarationStatus=unresolved` 与对应 `issues` 同时出现。

例如，查询工单分派接口。

```sh
node packages/core-contracts/dist/capabilities.js --id "api:POST:/api/cores/example-tickets/tickets/{ticketId}/assign"
```

结果从 [TicketsController.assign](../example-tickets-core/src/nest.ts) 定位 [TICKETS_HTTP.assign](../example-tickets-core/src/http.ts) 的 params、body 和 response；body 保留 `AssignTicketSchema.omit({ ticketId: true })` 原表达式，并链接 [AssignTicketSchema](../example-tickets-core/src/contracts.ts)。同一合同供 [OpenAPI 生成器](../example-tickets-core/src/openapi.ts) 使用，已登记贡献中的 Request/Response 引用可按 `details.openapi.schemas` 打开。业务调用继续沿 [TicketsService.assign](../example-tickets-core/src/service.ts) → [TicketRepository](../example-tickets-core/src/service.ts) → [MySQL 私有适配](../example-tickets-core/src/mysql.ts)，范围和原操作说明见 [工单模块](../example-tickets-core/README.md)。

输出固定 `audience=development`，`source.snapshot=working-tree` 和当前 Git 修订说明本次读取位置。Git 检出目录同时给出 `source.workingTreeChanged`，表示扫描时是否有未提交修改；当前修订不是这些修改的固定版本。`coverage` 列出实际扫描的来源，并从 Git 跟踪的 workspace 与独立客户端包清单标明未检出的 `notPresent`；已检出但不属于当前扫描范围的独立包标为 `partial`。静态解析缺口通过 `issues` 表达。源码声明、宿主登记和运行验证分别核定，API 的 `registration` 标记源码或明确宿主登记，UIArc 条目标记为保留源码。用途/约束优先读取准确的源码注释和模块 README，缺少说明的条目保留准确入口供后续整改。

扫描只解析仓库内的声明资料，动态函数和自定义表达式保持待核对。已使用的 `Object.freeze` 通过语法读取参数，扫描过程调用原注册函数的次数为零。普通查询退出0，`--check` 遇到 `issues`、`partial` 或 `notPresent` 退出1，用法/读取失败退出2。`--json` 的标准输出为一份 JSON。源码索引的TypeScript工具是开发依赖，使用包含开发依赖的源码环境运行。

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

`@rental-os/core-contracts/deployment` 提供 `createCoreMigrationDeployment`，将固定底座原迁移与锁中Core标准包组为一份新的Prisma迁移目录。它核包摘要、版本、全部声明文件和原SQL，Core原账名称由 `corePrismaMigrationName` 单源生成，排序不符合原链会拒绝。结果仅内存文件，由明确部署准备命令写入独占新目录；不执行SQL、不补账、不覆盖活动组合。[源码](src/deployment.ts) · [工单准备命令](../../apps/example-tickets-api/src/prepare-deployment.ts)

`writeCoreMigrationDeployment(directory, files)` 将这些文件排他写入绝对路径下的新目录，最后写部署锁。两个宿主的准备命令共用这个写入器。写入失败时只清理本次创建、身份和内容仍一致的文件及空目录，保留并行写入或被改写的内容；全部写成后即使结果输出失应答，也保留原候选，按原目录和锁核对。[Rental准备命令](../../apps/rental-api/src/prepare-deployment.ts)

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

宿主构建或启动前，可从 `/install` 调用 `requireCorePackagePin(directory, pin, hostVersions)`，核实际标准包的ID、版本、固定来源和全部声明文件摘要。前后端使用同一个部署锁；函数只读核验，不执行包代码、安装或迁移。[工单Web配置](../../apps/example-tickets-admin/vite.config.ts)与[API适配](../../apps/example-tickets-api/src/deployment-package.ts)共同消费这一实现。

## 命名、版本与权限

- Core ID 使用小写字母、数字和连字符，例如 `rental`、`example-tickets`，不使用租赁品类编码充当 Core 类型。
- 当前合同版为 `0.1.1`。支持确定的三段数字发行版本；兼容区间使用包含下限的 `minInclusive` 和不含上限的 `maxExclusive`，不解释 `latest`、npm 范围或预发行标签。
- 底座发行、Core 实现、合同和数据各有自己的版本。清单和宿主资料先经各自 schema 解析，再调用 `checkCoreCombination` 检查组合；它支持空组合，也拒绝同 ID 的两个实现、缺能力和不兼容版本。
- Core 权限声明由本地 `resource` 与 `action` 组成，`corePermissionCode` 输出 `<coreId>:<resource>:<action>`。这是权限目录的声明，不会授予任何角色；旧 Rental 权限保持原兼容适配。
- 业务可以只以租户为范围，也可以声明自己的容器类型。容器 Core 同时提供租户级业务时，显式声明 `tenantScope: true`，并将合同兼容下限设为 `0.1.1` 或更新版本；省略该字段仍要求提供容器。租户、各容器分别建立绑定，权限不能互相推导。对象键同时包含 Core、租户、容器与对象类型/ID；它只定位对象，不能作为授权证据或替换历史幂等键。
- `admin`、`openapi`、`ai`、`jobs`、`events` 均为可选入口；未提供 AI 不要求写空工具。已声明入口必须存在。业务是否可用仍由后续真实装配、注册、授权和就绪决定。

## 给 Core 附上 API 说明

在清单 `entries.openapi` 指向一份包内 JSON，内容使用标准 OpenAPI 3.0 的 `paths` 和 `schemas` 两个集合。`schemas` 对应最终文档的 `components.schemas`，字段不再维护第三套私有 DTO。该 JSON 应从 Core 实际接口合同生成或与其一同验证，不能把没有实现的路由写成已经支持。

- 新接口路径位于 `/api/cores/<coreId>/...`，`operationId` 和 schema 名以 `<coreId>.` 开头。
- 每个操作写明 `summary`、`responses` 和显式 `security`；其余 OpenAPI 标准字段可描述参数、请求体、错误和示例。公开接口使用空 `security`，仍须由真实 Controller/Guard 实现对应政策。
- `$ref` 只使用本地 `#/components/schemas/...`，引用本 Core 或平台公共 schema；不能借另一个 Core 的 schema 隐式取得依赖。检查不访问外部 URL。
- 包检查会读取该 JSON 并核对归属和最小文档字段。该检查不替代完整 OpenAPI 规范校验、Controller/DTO 对照和实际接口验证。

宿主从正式出口调用 `CoreOpenApiContributionSchema.parse` 和 `composeCoreOpenApi(platformDocument, selectedCores)`。只有所有贡献无冲突时才返回 `document`；失败返回定位明确的 `issues`，不修改原文档。结果用于实际 `/api/openapi.json` 与同版本离线输出。公共、Rental 和工单宿主消费同一组合器，挂载集合由宿主提供。[公共文档](../../apps/platform-api/README.md) · [Rental 文档](../../apps/rental-api/src/openapi.ts) · [原组合](../../apps/api/src/contracts/openapi-document.ts)

简单Zod3请求/响应可用正式出口 `coreOpenApiSchema(schema)`生成OpenAPI 3.0字段。当前支持普通对象、字符串/数字/布尔、枚举/基础字面量、数组、判别联合、可选/可空/默认值和已列明的基础校验；未知类型、refine/transform等额外逻辑明确拒绝，不静默丢规则。字段默认值须是可序列化纯值；业务前提仍在操作说明中表达。实际消费者见[工单HTTP合同及生成器](../example-tickets-core/src/openapi.ts)，Controller同片核对路径、输入与输出，生成成功不代表接口已经部署。

保留 Rental 旧路径时，受控宿主可给检查器/组合器传入属于该 Core 的精确 `METHOD /path` 白名单；这个例外由宿主维护，不在 Core 清单中提供，也不会创建或放宽任何路由授权。静态检查命令默认使用新 Core 命名空间。原组合通过[同源文档适配](../../apps/api/src/contracts/openapi-document.ts)维持原 operationId、schema 名称及已挂载旧路径，兼容映射不改变原接口授权。

## 提供服务端贡献

包的 `entries.server` 指向本 Core 的服务端入口。受控宿主从该入口直接导入真实实现，并把实例作为 `CoreServerRegistration.server` 传给 `registerCoreServers(registrations, hostVersions)`。检查器没有 `load(path)`，不会拿清单中的字符串直接执行代码。

[服务端合同](src/server.ts)要求贡献的 `coreId`、`implementationVersion` 与清单一致。它只承担公共生命周期需要的窄接点，订单、工单等业务 API 继续使用各自的类型化 Controller/应用服务。

| 接点 | Core 提供什么 | 宿主负责什么 |
| --- | --- | --- |
| `resolveScope` | 根据当前主体验证本 Core 的租户/容器范围，返回绑定、拒绝或未建立绑定 | 原认证、租户 Core 授权、适用成员分配；不能把客户端提交的标识视为可信身份 |
| `readReadiness` | 读取当前业务配置，返回就绪、明确缺项或不可用 | 分别表达授权、绑定和业务就绪，不因注册成功就显示业务可用 |
| `initialization`，可选 | 仅需要初始业务事实时提供；用 `defineCoreInitializer` 按自己的 schema 解析输入一次 | 锁定原操作、当前权限和候选绑定，在同一事务内写绑定、业务初始事实及审计；提交后发布可见变化 |
| `assessRemoval`，可选 | 返回在途、unknown、回调、作业和历史读取阻碍 | 汇合平台自身依赖；缺少检查器或存在阻碍时不能移除代码 |

`registerCoreServers` 支持空组合和多个不同 Core，检查失败返回 `issues`，不会返回部分注册表；成功返回 `registrations`。注册不会调用上述业务方法，也不会创建数据库记录、路由、定时任务或 AI 工具。实际 Nest 组合与持久化由[公共 Core 宿主](../platform-core-host/README.md)和所选 Core 适配供给。注册函数本身不办理初始化、迁移或代码加载。

需要任务推进的 Core 可以从 `@rental-os/platform-server/ai-runtime` 使用原公共 Runner，把自己的受控工具接到业务效果端口，由宿主供给当前授权、正式计划、原租约、仓储和累计资源。这个入口不依赖 Rental，工具发布、模型 Gateway 和业务批准仍按各自实际接点办理；没有 AI 贡献的 Core 不需要实现这些端口。[公共任务 Runner 接入](../platform-server/src/ai-runtime/README.md)

[授权与生命周期 schema](src/lifecycle.ts)分别定义租户 Core 授权、成员分配、绑定、就绪和原操作引用。已保存事实的修订从 1 开始；变更请求的 `expectedRevision=0` 只表示记录尚不存在。成员分配请求不包含 `tenantId`，由当前租户身份确定管理边界。合同不定义 Core 独立到期日，统一期限继续由原订阅服务维护。

`CorePrincipal` 仅是原认证服务解析后的主体定位，不携带可自报的权限数组。`CoreTransaction` 是宿主事务回调内的临时句柄，适配器只解析成当前 Core 的受限仓储，回调结束后失效；类型标记不能替代运行时校验。[平台绑定适配](../core-host/README.md#首次绑定与原结果)已有同事务初始化及私有句柄解析，实际宿主必须供给原身份与当前部署，缺失时不得以清单或本地缓存补授权。

停用只关闭对应普通业务和新 Agent 任务；数据、绑定、成员撤权及原收据继续保留。恢复先读取原绑定并复核当前条件，不调用首次初始化。`CoreOperationReference` 只定位原操作，不能根据超时、程序重启或再次开通认定旧操作未执行。

## 登记Core的HTTP政策

Core从实际接口方法/路径及权限声明生成 `CoreHttpContribution`，宿主调用 `registerCoreHttpRoutes([{ manifest, contribution }])`。每条声明本Core相对路径、精确动作权限、原认证audiences、business/original_receipt及是否新增业务；注册不调用Controller、授权角色或执行业务。[HTTP政策合同](src/http.ts)

结果成功时提供 `registry.resolve(method, path, audience)`，path为原宿主归一、剥离 `/api`后的路径。未知方法/路径/分面不返回政策；同一路径参数与静态段重叠、重复标识、未声明权限或错误Core/版本拒绝，失败不返回部分目录。大小写匹配和GET的隐式HEAD沿原Express语义，GET/HEAD政策不得重叠；参数值仍由所属Controller/schema校验。旧Rental路径沿原兼容政策，新Core不声明旧路由例外。

[工单示范](../example-tickets-core/src/http.ts)的 `createTicketsHttpContribution()`直接从TICKETS_HTTP生成九条政策，Nest和OpenAPI仍消费同一声明；分页与旧数组读取共享本Core读取权限。实际部署目录在创建时通过可选 `http`接收贡献，主应用Guard统一消费目录及当前原身份准入；新增Core无需修改Guard内的逐业务判断。未知政策或无贡献的路径保持原默认拒绝。[宿主接线](../../apps/api/src/modules/core-host/README.md#core业务http准入)

## Core 管理 HTTP 合同

`CORE_MANAGEMENT_HTTP`给出当前平台管理面的十一个操作，Controller和 `createCoreManagementOpenApi()` 共用同一份方法/路径与schema。前缀为 `/api/platform/core-host`，目录、授权/成员/绑定变更、当前事实、原操作收据及移除预检分别有自己的入口。[HTTP合同](src/management-http.ts) · [接口资料生成器](src/management-openapi.ts)

| 操作 | 方法与相对路径 | 原管理要求 |
| --- | --- | --- |
| 当前Core登记目录 | GET `registered` | SaaS管理员与租户管理权 |
| 租户Core开通/停用 | POST `tenant-grants` | SaaS管理员与租户管理权 |
| 成员Core分配/撤回 | POST `member-assignments` | 本租户账号管理权 |
| 首次绑定/复用绑定 | POST `bindings` | 本租户管理权、当前Core/成员使用权和初始化范围 |
| 原初始化操作只读核对 | POST `binding-operations/read` | 当前租户管理权与本人原操作 |
| 当前租户Core授权及修订 | POST `tenant-grants/read` | SaaS管理员与租户管理权 |
| 当前成员Core分配及修订 | POST `member-assignments/read` | 本租户账号管理权 |
| 当前Core范围绑定及修订 | POST `bindings/read` | 本租户管理权 |
| 原租户Core授权操作只读核对 | POST `tenant-grant-operations/read` | 当前SaaS管理权与本人原操作 |
| 原成员Core分配操作只读核对 | POST `member-assignment-operations/read` | 当前租户管理权与本人对该成员的原操作 |
| Core移除阻碍只读预检 | POST `removal/read` | 当前SaaS管理员与租户管理权限 |

`coreManagementHttpPolicy`用于原Guard消费准确方法/路径的管理政策。当前API有对应Controller/原主体服务组合，实际主Guard/AppModule接线沿PCH宿主片办理。[API适配](../../apps/api/src/modules/core-host/README.md)

成功响应沿原 `{ data, requestId }` 信封，原键冲突与对象修订冲突返回409，当前权限不足403，部署/数据未就绪503，输入400和会话401分别表达。初始化配置由所选Core自己的schema解析，接口资料链接该Core配置说明。目录投影只给正式显示字段，完整清单沿受控注册维护。

提交管理变更前，页面先使用对应只读入口取得当前修订。返回 `recorded` 时使用事实中的 `revision`，尚未建立记录返回 `unavailable`，初次变更使用0。读取始终核当前主体和管理权限，停用/撤回状态及旧收据仍各自保留。绑定读取按租户/Core/容器定位，原操作核对继续使用单独的原收据入口。

变更结果未知时，保存原operationId并调用对应的原操作只读入口。`recorded`返回原操作结果，之后另读当前事实；`unavailable`只表示暂未取得收据，不证明旧操作未提交，不能自动重发。原结果读取不创建锁行、事实或审计。[后台管理适配](../platform-admin/src/core/README.md#管理core开通与成员分配)提供相同流程。

移除预检读取 `CoreRemovalObservation`，状态为blocked或clear。Core的assessRemoval与平台实际准入/任务/回调/作业/历史依赖共同核对；缺检查器、未确认停新或依赖不完整均blocked。clear只说明当前只读观察无阻碍，实际部署须复核并执行停新/排空，不是删除/迁移许可，也不删除业务数据。[宿主检查](../core-host/README.md#移除代码前读取依赖)

## 读取当前成员可用的Core

`GET /api/platform/core-host/session-context`返回当前operator会话的Core目录，合同为 `CORE_SESSION_HTTP` 和 `CoreSessionContextSchema`。只投影本人获分配且租户已开通的已登记Core、原授权/成员修订及当前角色持有的本Core精确权限；租户管理者另得到可分配候选，候选不授予本人业务使用权。[会话目录合同](src/session-http.ts)

`cores=[]`是合法结果。`tenantHasRegisteredGrant=false`表示当前租户没有已登记Core的开通授权，可提示联系SaaS管理员；为true且本人集合为空时可提示联系租户管理员分配。部署、绑定、业务就绪与对象范围由各自真实接点继续核验，目录不声称所有业务已经可执行。`canUseCorePage(context, coreId, permissions)`只检查当前目录中的成员使用权和精确页面权限，宿主还须核定其余准入条件。

接口资料由 `createCoreSessionOpenApi()` 同源生成。实际原会话读取与独立Controller已提供，原Guard须将这一条GET明确登记为已登录operator的自助入口，主AppModule和OpenAPI总组合仍沿宿主公共窗口办理。SaaS全部登记目录与租户成员自助目录分别使用各自入口。

## 读取Core范围与业务就绪

`POST /api/platform/core-host/scope/read`接收 `coreId` 与Core需要时的 `container`，主体由原会话确定。返回unbound或bound；bound包含当前绑定及Core真实返回的ready/configuration_required/unavailable。读取不会首次初始化、补默认配置或执行业务。[范围HTTP合同](src/scope-http.ts) · [服务端范围合同](src/server.ts)

宿主先核当前成员使用权，再调用已登记Core的 `resolveScope` 和 `readReadiness`，返回前重新核原身份/授权和绑定修订、数据版本。Core返回绑定必须属于原租户和所选范围。范围服务拥有自己的事务，宿主不在调用它时跨事务持有人员锁；最终业务请求仍须原Guard/服务端再次授权。`createCoreScopeOpenApi()`提供同源接口资料，主组合/Guard接线沿公共窗口办理。[API适配](../../apps/api/src/modules/core-host/README.md#当前core范围与就绪)

## 声明页面与操作

[页面合同](src/admin.ts)已提供 `CorePageDescriptorSchema`、`CoreAdminContribution`、`CorePageAction` 和 `registerCoreAdminPages`。路由描述中的ID/局部路径、名称、可选父级与菜单、权限是同一份数据；组件由Core代码直接绑定。统一注册后路径位于 `/cores/<id>/...`，重复页面、同形路径、缺上级/循环或清单未声明的权限会拒绝，失败不返回部分注册表。

`purpose: "configuration"`仅用于Core自己的配置页面，获权且范围读取成功后可在未绑定/未就绪时进入；默认页面要求真实ready。`coreNavigationEntries`从当前本人Core/页面权限过滤菜单，`coreBreadcrumbEntries`沿同一父级链生成名称与允许的链接，无权父级不带可访问链接。[导航生成](src/navigation.ts) · [React路由适配](../platform-admin/src/core/README.md#宿主只装配一次)

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

React 的 `CoreAdminPageAction` 还可声明 `slot`。省略时使用主操作栏，返回用 `"navigation"`，刷新等工具用 `"tools"`；都保留同一权限与页面生命周期。页签和查询视图交给 `CorePage.view`，需要同行工具时使用 `toolsPlacement="view"`。[按钮与页头接入](../platform-admin/README.md#宿主接入)

**描述、注册、路径解析和[公共React页面适配](../platform-admin/src/core/index.ts)已提供。** 零Core和工单宿主共用同一应用工厂、页面注册表及授权目录；左栏、面包屑行、铃铛、休息和收展由公共壳提供。Rental旧路由仍通过兼容入口使用自身当前身份，完整标准装配继续迁移。字段类型、动态动作和表单Promise留在Core/React代码中；浏览器、真实HTTP/数据库及多Core完整运行仍须实际验收。

Rental 的商品、订单、养护、会员及经营页面通过 `createRentalAdminContribution(version, contexts)` 合入同一 Core。工作台和报表由 `useOperationsContext` 提供当前会话、业务范围、客户预览与已认证的 JSON / CSV 请求，页面复用同一外壳和原按钮；无需修改底座内部。[统一贡献](../rental-core/admin/index.tsx) · [工作台三步接入与原权限](../rental-core/admin/operations/README.md#接入与旧宿主)

Rental 的会员、渠道等页面使用独立租户绑定；订单等空间业务使用 `rental-workspace` 容器绑定。标准 [服务端贡献](../rental-core/src/server.ts) 和 [平台适配](../rental-core/src/platform-host.ts) 共用原当前账号、Core 授权、成员分配及绑定，空间业务额外核原空间成员和已保存配置。宿主供给同一数据库及真实部署观察，组合工厂本身不创建空间或开通租户。[原组合工厂](../../apps/api/src/modules/core-host/original-rental.ts)

## 组合 Prisma 源码

使用 Prisma 的宿主从 `@rental-os/core-contracts/prisma` 导入 `composeCorePrismaSchema`，传入公共源码和所选 Core 的贡献。

```ts
const schema = composeCorePrismaSchema(publicSchema, [
  { id: manifest.id, schema: coreSchema, publicRelations },
]);
```

Core 提供自己的 `model` / `enum`。`publicRelations` 按公共模型名列出需要追加的关系字段，例如 `{ Tenant: ["tickets Ticket[]"] }`；关系目标必须属于这个 Core，公共列、默认值、索引及生成器仍由底座维护。字段、模型或 Core 标识重复，覆盖公共声明或包含未知顶层语句时，组合在生成客户端前拒绝。空贡献数组生成公共源码，多个 Core 复用同一入口。

公共表需要追加真实外键时，宿主从已校验的 Core 迁移调用 `mysqlForeignKeyExtension(sql)`，将结果传给 `createPublicPlatformDataPlan(keys)`。结构观察会核对这些约束的原列、目标与删除/更新规则；额外外键或缺少所选约束都不能冒充就绪。[结构接点](../platform-core-host/src/mysql-structure.ts) · [公共数据计划](../../apps/platform-api/src/platform-data.ts)

组合函数只返回源码。宿主在自己的客户端输出目录执行原 Prisma 校验与生成，部署迁移仍从固定包和版本锁准备；既有组合库继续核原迁移账与历史恢复依据。[源码](src/prisma.ts) · [迁移准备](src/deployment.ts)

Rental 已提供自己的完整业务 schema、关系贡献和 MySQL 数据计划。宿主用 `createRentalPrismaContribution` 组合源码，将 `createRentalMysqlDataPlan().publicForeignKeys` 交给公共计划，再用两份计划观察原迁移账；Core 作者无需将业务模型复制到平台 schema。[Rental三步数据接入](../rental-core/prisma/README.md)

## 分别更新底座或一个 Core

先构建本包，再用实际发行元数据和迁移账快照执行只读预检。

底座源码发行版本取[根包](../../package.json)的 `version`；Core 实现版本取自己的正式清单，Rental 的来源是[发行身份](../rental-core/src/core-identity.ts)。源码或产物变化时使用新发行版本，合同与数据版本按各自变化维护。只更新底座时复用原 Core 包、提交和摘要；只更新一个 Core 时保留原底座与其他 Core 的固定引用，避免把未变更模块按新仓库提交重新打包。

```sh
node packages/core-contracts/dist/plan-update.js <当前锁JSON> <升级请求JSON> <数据观察JSON> --json
```

三份输入分别按[升级合同](src/update.ts)中的 `CoreDeploymentLockSchema`、`CoreUpdateRequestSchema`、`CoreDataObservationSchema` 解析。当前锁固定底座与每个 Core 的发行版本、提交、包摘要及兼容资料；升级请求选择 `platform`、一个 `core`，或已选装的一个 `platform-capability`。数据观察由目标环境原迁移账提供，包含实际数据版本与有序迁移摘要，不能复制清单当作数据库已完成的证明。本命令不连接数据库。

检查依次核对来源与不可变发行、全部选中模块的版本兼容、数据可读性和迁移历史。已发布迁移只追加，不能改原文件、顺序或摘要。若有新迁移，实际数据须先处于当前发行的完整基线，数据版本必须前进；中断或记录矛盾时先核对原迁移，不自动重做。

普通更新保留Core的业务范围声明及原绑定。租户范围与容器范围互换、容器类型更名，以及增加或取消 `tenantScope` 都返回 `scope_changed`，即使实现和数据版本前进也不能借这一入口转换。需要改变范围时，先核定原绑定、数据和权限的专门迁移方案；兼容的同范围修复继续按原更新路径办理。

新宿主的迁移观察还提供 `execution`。原迁移账和物理结构核同后使用 `state: "ready"`，执行中、失败和未知分别使用 `running`、`failed`、`unknown`，携带原迁移标识/摘要，以及已知的语句进度、物理观察摘要和固定恢复SQL。出现未完成状态时预检返回 `migration_incomplete`，原DDL部分提交必须先根据真实结构与原执行收据处理。恢复SQL来源和摘要须核定后按目标环境授权执行，完成物理回读和原迁移账登记后重新观察。旧调用方的缺省字段沿原完整基线约束兼容，新宿主始终显式提供状态。[迁移观察合同](src/update.ts)

成功结果的 `status` 分为 `unchanged`、`candidate`、`migration_required`。`candidate` 是返回值中的新锁，原输入文件及未选择更新的 Core／能力保持；`migrations` 指出所属模块和待执行链，不表示已经应用。`owner=platform` 表示底座，`owner=core:<id>` 表示业务 Core，`owner=platform-capability:<id>` 表示选装公共数据能力，名称相同也不混用。

| 拒绝结果 | 需要处理的内容 |
| --- | --- |
| `source_conflict` / `release_changed` / `release_metadata_changed` | 核对原来源；同版本提交、包摘要或元数据变造须重新发布新版本 |
| `core_not_installed` / `core_identity` | 新增 Core 先走安装；更新不能换成另一 Core |
| `capability_not_installed` / `capability_identity` | 新增公共数据能力须先准备固定包和组合，不能借更新更换能力标识 |
| `scope_changed` | 业务范围或容器类型改变须先核定原绑定、数据和权限迁移，不能作为普通版本更新 |
| `platform_version` / `contract_version` / `missing_capability` | 核对整个候选组合的兼容范围与必要公共能力 |
| `data_unavailable` / `data_observation_conflict` | 从真实迁移账取得完整一致的版本与摘要 |
| `migration_changed` / `migration_history` / `migration_baseline` | 原迁移链须不可变；先核对历史或未完成迁移 |
| `migration_incomplete` | 原迁移仍在执行、失败或未知，先核物理状态及固定恢复条件，完成后重新读取迁移账 |
| `other_module_not_ready` | 当前其他模块的迁移未完成，不能借此次更新一并隐式升级 |
| `release_rollback` / `data_rollback` | 使用已有验证的程序/数据恢复方案；这个命令只准备前进升级 |

退出码 `0` 表示预检通过，`1` 表示候选被拒绝，`2` 表示输入/用法或读取失败。这个阶段只输出候选，后续还须核对包摘要、用户改动、在途/历史执行依赖，按授权执行迁移、组合构建与切换并取得实际验证。锁文件不存用户配置、Key 或租户授权；本工具不自动写文件或部署，也不能据此宣称更新已经成功。

### 选装公共数据能力

AI 等公共数据能力通过可省略的 `lock.dataCapabilities` 选择，单独固定版本、实际发行来源、完整包摘要、schema／迁移和公共／Core 数据前置。[能力合同](src/data-capability.ts)不将能力注册成业务 Core，也不发布业务工具或自动启动作业。旧锁省略此字段时保持原组合。

Node 出口 `@rental-os/core-contracts/platform-data-package` 提供 `readPlatformDataCapabilityPackage(directory, release)` 和 `requirePlatformDataCapabilityFiles(files, release)`，只读取明确文件、校验整个归档与逐文件摘要，不执行包代码或 SQL。宿主兼容检查使用 `coreDeploymentHostVersions(lock)`，数据前置使用 `checkPlatformDataCapabilities(lock)`；缺选装能力仍按原 `manifest.requires` 兼容规则拒绝。

`createCoreMigrationDeployment({ lock, platform, cores, dataCapabilities })` 中的能力字节 Map 必须与锁中所选集合完整一致，部署顺序为公共 → `core.*` → `platform-capability.*`。能力迁移用自身 ID 命名空间，保留原摘要与顺序；未选材料、缺包或摘要变化都会拒绝。只有所选数据所有者的真实物理观察和原执行账均就绪，才通过宿主数据门禁。[迁移组合](src/deployment.ts) · [原账观察](../core-host/README.md#读取原迁移账与实际结构)

独立更新请求使用 `{ kind: "platform-capability", capabilityId, release }`，观察项位于 `dataCapabilities` 并包含必需的 `execution`。预检保留底座与其他 Core／能力，拒绝改写已发布迁移、同版本资料变造、降版、缺观察及unknown。[AI数据包示例](../ai-native-data/README.md#显式选装与独立更新)

## 生成随包指南与归档

`CORE_GUIDE.md` 从本README的五步快速入口和Agent模板生成。传入Core清单与含 `repository`/`commit` 的底座来源JSON，底座提交必须已在当前本地Git中存在并包含这份公开手册；来源不含凭据。

```sh
node packages/core-contracts/dist/generate-guide.js <Core清单JSON> <底座来源JSON>
```

命令只向标准输出写Markdown，不覆盖包内已有指南。程序内可从正式出口调用 `renderCoreGuide(manifest, guideDocument, platformSource)`；公开手册及源码引用固定到指定提交，服务端、后台、API及已声明可选贡献链接到包内入口。README/LICENSE也可从生成指南直接打开。缺少原文锚点会拒绝生成，指南保留对应版本的支持状态。页面接入见[公共后台包](../platform-admin/README.md)和本文页面声明章节。

打包时复用正式出口 `pinCoreDocumentationLinks(text, sourceFile, source)`，以原源码文件路径解释相对链接并固定到本次提交，保留外链、围栏及行内代码示例。抽出的章节锚点指回公开手册；完整README可传第四参数true保留本页锚点。链接越出固定源码仓库时拒绝，生成过程不访问网络或执行文档命令。[生成源码](src/guide.ts) · [工单打包消费者](../example-tickets-core/src/package.ts)

Node专用出口 `@rental-os/core-contracts/archive` 提供 `createCoreArchive(files)` 与 `readCoreArchive(bytes, expectedSha256)`，采用USTAR+gzip。相同文件按固定排序、权限和时间打包；校验整个压缩包SHA-256后返回内存文件。首版最多5000文件，包含清单、README/LICENSE/CORE_GUIDE.md、入口、迁移与资源的去重集合；清单资源和归档共用同一总数上限。单文件32MiB、解压总量128MiB，只接普通文件，不接PAX/软硬链接、目录条目、重复或越界路径。包内禁止实际 `.env`、Git元数据和node_modules；保留 `.env.example` 模板入口。

## 打包与本地安装准备

将清单中的入口、迁移和资源，以及README/LICENSE/CORE_GUIDE.md放在一个固定的Core交付目录。源文件、依赖声明及其他构建材料需要随包交付时，在清单`assets`显式列出；打包只读取声明集合，不扫描整个工作区。

```sh
node packages/core-contracts/dist/pack.js <Core交付目录> <新包路径.tgz> [宿主版本JSON]
node packages/core-contracts/dist/prepare-install.js <Core包.tgz> <SHA256> <既有独占待部署根目录> <宿主版本JSON>
```

输出包的父目录和待部署根目录须由部署者预先选定并存在，均使用不经过链接的普通目录。第一条命令拒绝覆盖已有包，输出JSON中的`sha256`用于第二条命令；第二条先检查整个压缩包、同一清单/文件/API规范及宿主兼容，全部通过后才写待部署目录。包不允许夹带未声明文件，不执行包内源码或安装脚本。

正式包的子路径类型同时通过exports/typesVersions提供，当前Node/CommonJS构建和NodeNext消费都从发布元数据定位，不使用深层源码别名。Node文件系统/归档接点仅从对应子路径导入，公共运行入口仍不加载这些开发工具。

准备结果为`prepared`或`already_prepared`，`deployment`始终为`pending`，并给出实际目录、Core ID、版本与摘要。目录使用该发行的完整摘要区分；重复操作核对原文件字节后复用，已有目录被用户修改、缺文件或出现链接时明确拒绝覆盖。失败只清理这次创建的暂存目录，不改活动组合或其他已准备版本。两个命令成功退出0，输入/兼容/文件失败退出1并在stderr说明原因；成功stdout只包含JSON。

程序调用使用Node专用`@rental-os/core-contracts/install`出口的`packCoreDirectory`和`prepareCoreInstall`。解包文件检查与原目录检查共用[包检查实现](src/package.ts)。此阶段已具备本地文件准备，后续仍需受控组合构建、迁移/数据核对、实际部署注册，再办理租户授权与成员分配；包完整性不能证明代码已经审核。

[工单示范](../example-tickets-core/README.md#构建与打包)提供pack:core命令，将固定源码构建、清单/API/手册生成及声明文件收集合成一个包。作者从同一标准复用所需步骤，平台安装仍只读检查标准文件，不执行包内打包命令或脚本。

## 从 GitHub 固定发行准备

Core 作者先按前面的命令生成标准包，文件命名为 `<Core ID>-<版本>.tgz`，例如 `example-tickets-0.1.1.tgz`。在公开仓库创建 `v0.1.1` Tag 和非预发行 Release，将这个包作为 Release 资产上传。同仓多个 Core 使用 `example-tickets/v0.1.1` 形式的独立 Tag；清单中的 `source.repository` 和 `source.commit` 对应该仓库和 Tag 实际指向的提交。包内清单可在构建阶段注入固定来源，避免用未提交工作区或 `target_commitish` 的分支名替代提交。

部署者先读取选定发行，将输出 JSON 保存为一份固定来源记录。下面的命令显式访问公开 GitHub，无需本机 Key；首版不读取环境变量或 Git 凭据来访问私有仓库。

```sh
node packages/core-contracts/dist/github-release.js inspect <owner/repo> <Core ID> <版本> [Tag]
node packages/core-contracts/dist/github-release.js prepare <固定Release JSON> <既有独占待部署根目录> <宿主版本JSON>
```

未传 Tag 时使用 `v<版本>`。`inspect` 输出源仓库、Core/版本/Tag、实际提交、Release/资产 ID、字节数及 GitHub 的 SHA-256 摘要。`prepare` 在下载前后分别回读固定资料，核对同一 Tag、Release 和资产，再将包传给原 `prepareCoreInstall`；包内 ID、版本、源仓库和提交必须完全相符。所有检查完成才写候选目录，结果仍为 `deployment=pending`，不会自动启动业务或覆盖当前组合。

| 获取结果 | 处理方式 |
| --- | --- |
| 缺固定资产/摘要、草稿或预发行 | 上传上述命名的完整标准包并发布正式版本；旧资产没有 GitHub 摘要时，可改用已核定 SHA-256 的本地包入口 |
| `release_changed` | Tag提交、Release/资产ID或包资料已改变，停止当前准备；核对来源并选择新版本，不覆盖旧固定记录 |
| `rate_limited` / `network` / HTTP失败 | 按提示稍后手动重试，已准备版本与当前业务保持可用 |
| 包来源不符/摘要不符/不兼容 | 回到作者发行与宿主版本资料检查，不能直接绕过本地包检查 |

Node专用出口 `@rental-os/core-contracts/github` 提供 `inspectGitHubCoreRelease`、`prepareGitHubCoreRelease` 及两份输入 schema。两条命令成功退出0，失败退出1；成功stdout只有JSON，失败stderr不包含响应正文、签名下载URL或凭据。下载有时间/大小上限，仅跟随GitHub受支持的HTTPS资产地址，失败没有落地半包。固定内容的检查不证明发布者或代码已经审核。

仓库可添加 `nativark-core` Topic供发现入口检索；**Topic本身不发布版本、不安装也不授权**。GitHub行为依据[按Tag读取Release](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)、[资产与摘要](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)、[读取引用](https://docs.github.com/en/rest/git/refs#get-a-reference)和[附注Tag](https://docs.github.com/en/rest/git/tags#get-a-tag)。本阶段使用离线HTTP响应验证，真实标准包发行下载尚未验收。

## 发现公开 Core 仓库

```sh
node packages/core-contracts/dist/github-release.js discover [关键词] [页码]
```

命令只搜索公开、未归档且带 `nativark-core` Topic的仓库。关键词用于名称/简介，不接受其他GitHub查询表达式；每页20条、最多读取GitHub搜索允许的1000个结果。返回来源、许可信息、更新时间、查询时间、下一页和不完整结果标记；描述仅作为普通文本显示，不能渲染成HTML。候选的`review=unreviewed`与`package=unchecked`不能替代平台确认和包检查。

宿主从同一 `@rental-os/core-contracts/github` 出口创建一个 `createGitHubCoreDiscovery()` 实例并复用它，再调用 `discover({ text, page }, refresh)`。实例缓存最近50页，每页5分钟；并发相同查询共用一次读取，`refresh=true`跳过缓存。缓存只含公开元数据，进程退出可以丢弃，命令每次运行不会保存磁盘缓存。

只需发现查询与结果时，使用正式子出口 `@rental-os/core-contracts/github-discovery`，其 JavaScript 和类型声明随同一包构建。后台客户端通过 `import type` 复用这些类型，实际查询由服务端的发现入口处理。[发现合同与实现](src/github-discovery.ts)

返回状态为`fresh`、`cached`或`unavailable`。远端不可达/限流/格式错误时，`unavailable.error`保留原因；有原缓存时附带`stale`及其原始查询时间，没有缓存时不伪造空结果。`discover`命令始终将这个结构写stdout，unavailable退出1，成功退出0；用法错误写stderr并退出1。实际已安装Core继续由宿主独立维护，发现失败不触碰它们。

候选仓库通过下面的固定根清单/索引读取核定Core元数据，再由固定Release入口准备包。SaaS 管理员通过[公共包管理页](../platform-admin/src/features/core-packages/README.md)和[服务端接点](../platform-core-host/README.md#core-包管理接入)查看来源、许可、底座/Core 版本及固定候选，确认后准备待部署材料；构建、迁移、注册、租户授权和成员分配仍是各自明确步骤。检索规则依据[GitHub仓库搜索](https://docs.github.com/en/rest/search/search#search-repositories)。

## 从仓库确认 Core 清单

选择候选仓库后，运行下面命令读取固定提交里的清单。只有需要查看发行状态时附 `--releases`，可减少发现请求。

```sh
node packages/core-contracts/dist/github-release.js repository owner/repo
node packages/core-contracts/dist/github-release.js repository owner/repo --releases
```

单Core仓库在根目录公开 `core.manifest.json`。同仓多个Core的根目录使用 `core.index.json`，内容如下，`manifest`使用本仓相对文件路径，每个Core标识与其清单一致。

```json
{
  "indexVersion": 1,
  "cores": [
    { "id": "example-tickets", "manifest": "cores/tickets/core.manifest.json" },
    { "id": "workflow", "manifest": "cores/workflow/core.manifest.json" }
  ]
}
```

清单中的来源提交是实际Core发行源码，仓库索引本身可以在后续提交维护。读取器先固定默认分支当时的提交，再用该commit读取全部索引/清单，核Contents文件路径、Base64长度和Git Blob摘要。根索引schema和Core清单沿唯一合同解析，重复标识/路径及越界拒绝，每个仓库最多20个Core。[仓库读取](src/github-repository.ts)

结果中的Core状态为 `metadata_only`、`release_available`、`source_only`、`invalid` 或 `unavailable`。仓库整体可为完整identified、部分partial、无清单或不合法。Release元数据使用单Core `v版本` 或多Core `Core ID/v版本` Tag核对，状态仍保留 `review=unreviewed`、`package=unchecked`，下载安装和包检查按前述固定Release入口执行。某个清单读取失败保留其他Core已取得的结果，限流输出原retryAfter秒数，已装配Core继续自己的运行链。

程序调用使用 `@rental-os/core-contracts/github-repository` 的 `inspectGitHubCoreRepository`。读取器只解析公开资料，源码与发行目录的真实安装/运行验证沿PCH宿主交付。

## 源码路线与验证

[公共出口](src/index.ts) → [清单](src/manifest.ts) / [版本](src/version.ts) / [组合预检](src/compatibility.ts) / [对象引用](src/reference.ts) / [OpenAPI贡献](src/openapi.ts) / [授权与生命周期](src/lifecycle.ts) / [服务端注册](src/server.ts) / [页面声明](src/admin.ts) / [升级预检](src/update.ts) / [指南生成](src/guide.ts)。[包检查命令](src/check.ts) → [目录/文件检查](src/package.ts) → 同一清单与 OpenAPI schema；[升级命令](src/plan-update.ts) → 升级输入schema与纯预检；[指南命令](src/generate-guide.ts)读取固定Git提交的本公开手册。[打包](src/pack.ts)/[安装准备命令](src/prepare-install.ts)及[GitHub命令](src/github-release.ts) → [Topic发现](src/github-discovery.ts)/[固定Release获取](src/github.ts) → [文件准备](src/install.ts) → [归档](src/archive.ts)。发现与发行共用[只读传输](src/github-http.ts)，仅走Node出口；这些入口不加载Core业务代码。

```sh
npm test -w @rental-os/core-contracts
```

[单一验证入口](test/core-contracts.test.cjs)使用本树源码进行类型检查和编译，运行必要合同用例后清理本树 `output/.tmp/core-contracts`。它验证空/单/双 Core 声明、独立版本、越界/链接路径、迁移摘要、缺文件与 CLI；这些是静态及离线行为证据，不是租户、数据库或浏览器验收。

公开使用说明以本手册及各源码模块README为入口。维护者的内部需求、任务、记录与接续在本地单独维护，标准包和指南生成均不依赖它们。
