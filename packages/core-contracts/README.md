# Core 接入契约

这个包让底座和业务 Core 使用同一份清单、版本规则和对象引用。正式入口为 `@rental-os/core-contracts`；目录检查使用 Node 专用出口 `@rental-os/core-contracts/package`。包不导入 Rental、Nest、Prisma 或模型 SDK。

**目前已实现清单、静态包检查与 OpenAPI 贡献组合。** 普通业务宿主、注册授权、页面和持久化样例仍在拆分中。下面的检查可以运行；检查通过不代表 Core 已安装或业务可用。完整接入手册在[五步快速接入](../../docs/平台底座/Core接入/平台Core接入-开发任务.md#core-quick-start)随实现维护。

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

## 源码路线与验证

[公共出口](src/index.ts) → [清单](src/manifest.ts) / [版本](src/version.ts) / [组合预检](src/compatibility.ts) / [对象引用](src/reference.ts) / [OpenAPI贡献](src/openapi.ts)。[命令入口](src/check.ts) → [目录检查](src/package.ts) → 同一清单与 OpenAPI schema。目录检查不会解释或执行模块入口。

```sh
npm test -w @rental-os/core-contracts
```

[单一验证入口](test/core-contracts.test.cjs)使用本树源码进行类型检查和编译，运行必要合同用例后清理本树 `output/.tmp/core-contracts`。它验证空/单/双 Core 声明、独立版本、越界/链接路径、迁移摘要、缺文件与 CLI；这些是静态及离线行为证据，不是租户、数据库或浏览器验收。

[正式需求](../../docs/平台底座/Core接入/平台Core接入-需求.md)与[任务](../../docs/平台底座/Core接入/平台Core接入-开发任务.md)维护全量交付；[开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md)记录已实现阶段，[协作接续](../../docs/平台底座/Core接入/平台Core接入-协作接续.md)定位下一入口。
