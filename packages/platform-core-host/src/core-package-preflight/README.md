# 固定包检查与更新预检

[HTTP 入口](http.ts) → [管理应用](application.ts) → [原目录与权限](../platform-core-package-management.ts) / [原包检查](../../../core-contracts/src/package.ts) / [原更新预检](../../../core-contracts/src/update.ts)。[私有来源端口](ports.ts)由宿主供给，[本地归档读取器](archive-source.ts)读取已下载并登记的固定包。

宿主为每个引用登记普通 `.tgz` 文件及完整发行资料。后台只发送引用标识，来源读取前后核原 SaaS 主体、角色、租户和会话。Core 包复用原 SHA-256、USTAR、清单、入口、迁移及 OpenAPI 检查。底座包按原公共源码发行生成器复核来源、文件、workspace、锁文件与数据迁移资源。平台数据能力包沿[完整包校验](../../../core-contracts/src/platform-data-package.ts)核固定归档、全部文件、schema与迁移摘要。字节及本地文件路径由服务端持有。

配置 `storageDirectory` 的公共装配从 `archives/index.json` 读取本地登记，归档路径相对于同一 `archives` 普通目录。文件使用 `CorePackageArchiveIndexSchema` 的 `core-package-archives-1` 格式，`artifacts` 每项包含 `reference`、`file` 和原 `artifact` 投影，支持 Core、底座和平台数据能力包。登记最多1000项，索引最多32 MiB，重复引用、额外字段、越界路径及链接均拒绝。宿主显式提供的 `localArtifacts` 继续优先。[登记合同与读取器](archive-source.ts) · [统一供给](../core-package-assembly.ts)

索引在首次本地请求时读取，并发请求共用同一次读取。成功后固定本进程的登记，改动登记由部署人员重启装配后采用；失败后可在下一请求重读。归档每次读取仍核对普通路径、文件身份及读取前后状态，实际摘要和标准包内容沿同一预检验证。后台的“使用已下载包”直接发送已登记引用。

来自私有固定 Release 的登记项还须保留 `privateRelease`（正式完整私有 pin），其 Core ID、版本、来源与摘要必须等于 `artifact.pin`。索引只由受信宿主维护，不可删除此字段把已下载私有包重标为公开材料。管理应用在读取前调用来源的 `authorize(reference)`，重新核当前 SaaS 来源配置及远端 pin，并在返回前复验。自定义 `localArtifacts` 须提供同等接点；缺私有适配时拒绝新的获取/预检/准备，不能用本地副本绕过。[来源配置](../../README.md#githubcom-私有固定发行)

读取器的底层 `read` 继续只核受管本地文件，专供原运行证据使用；不以 GitHub token 可用性决定已安装组合能否运行。统一装配将管理来源与实际运行观察分开，私有取包撤权后仍可核本地原包，不删除资产或数据。只有受控管理链调用 `authorize` 后才可把这些字节用于新的候选操作。

| 固定入口 | 返回内容 |
| --- | --- |
| `POST /platform/core-packages/inspect` | 固定发行、静态检查与具体缺口 |
| `POST /platform/core-packages/plan-install` | 新 Core 候选组合及初始迁移资源 |
| `POST /platform/core-packages/plan-update` | 指定底座、单 Core 或已选平台数据能力的原兼容、迁移和来源预检 |

检查使用 `reference`。更新同时指定 `kind`，Core 更新提供 `coreId`，平台数据能力更新提供 `capabilityId`。请求 schema、响应类型和固定路径沿同一 [端口](ports.ts)读取。

旧 API 兼容许可由宿主通过 `legacyApiRoutes` 按 Core ID 提供精确的 `METHOD /api/path` 集合，并在应用构造时保存本次可信策略。原标准包检查使用同一集合，未供给、错误 Core、错误方法或通配字符串继续返回 `route_namespace`。请求和包清单的额外许可字段沿原严格 schema 拒绝。[统一装配](../core-package-assembly.ts)

安装和更新规划要求实际包、服务注册、部署锁及原数据观察一致，原迁移执行明确 ready。读取中发生撤权、换会话、部署或数据变化时拒绝过期结果。同标识另一来源、改字节同版本、历史迁移变动、缺依赖和未完成迁移按原规则给出缺口。重复安装同一实际包返回原组合，原 Core 数据已存在时先核恢复条件。

所选平台数据能力沿原锁保留完整发行、实际包和数据观察，Core 的必需能力版本复用 `coreDeploymentHostVersions`。能力实际包缺失、摘要不同或迁移处于 unknown 时拒绝候选。底座或单 Core 更新保留全部所选能力及其公共/Core 数据前置。单能力更新读取宿主登记的 `platform-capability` 完整包，复用 `planCoreUpdate` 核目标标识、来源、版本、不可变迁移链及组合前置。缺来源明确不可用，已有能力的新发行进入[同一候选准备](../core-package-preparation/README.md)。

候选的 `deployment` 为 `pending`。包下载、独占目录准备、受控构建、原迁移执行、部署注册、租户授权和成员分配分别沿原入口完成。初始迁移资源供部署人员核查，实际数据和执行条件在部署时复验。社区完整性与审核状态分别表达。

原迁移处于 unknown / failed / running 时，预检保留原迁移引用和物理证据并返回不可用。重复物理采样的时间在比对副本中归一，原结果保留实际采样时间；迁移状态、ID、摘要、完成数量、恢复引用、数据版本或物理摘要变化仍触发部署冲突。

本模块通过 `composePlatformCorePackagePreflight`、`CorePackagePreflightHttpModule.register` 和 `createPlatformCorePackagePreflightHttpAccess` 装配。来源由 `createPlatformCorePackageArchiveSource` 或实际受控来源提供，缺来源明确 unavailable。完整公共宿主通过正式 `CorePackageAssemblyModule` 共用四组应用、原 Guard 和 OpenAPI。[公共 API 供给](../../../../apps/platform-api/src/core-assembly.ts)

验证复用原目录主体围栏、Core 合同与归档，并覆盖固定引用、坏包、来源冲突、单项更新、原数据变化和实际 Nest 容器注入。离线 fixture、真实 HTTP / 数据库、浏览器和干净标准包安装分别记录。
