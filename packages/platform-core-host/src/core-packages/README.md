# Core 包管理读取

[应用工厂](../platform-core-package-management.ts)提供当前注册目录、独立版本、GitHub Topic 分页和固定提交仓库检查。[窄端口](../core-package-ports.ts)是同源请求路径与浏览器投影，[Nest 模块和 Guard 接点](../core-package-http.ts)提供真实 Controller。宿主通过正式包出口消费这些文件，再在原模块和 Guard 组合中接入。

```ts
const packages = composePlatformCorePackageManagement({
  database, users, catalogue, deployment,
  discovery: createPlatformCorePackageDiscovery(),
});
const httpModule = CorePackageHttpModule.register(packages);
const access = createPlatformCorePackageHttpAccess();
```

`database`、`users` 和 `catalogue`复用当前 Core 应用的同一依赖。每次查询从原 `createPlatformCoreCatalogueReader` 进入，锁原 SaaS 主体、租户、角色和会话，外部读取后再次复核。联网期间释放数据库锁，撤权、令牌到期或会话切换后拒绝返回结果。发现缓存仅含公开候选元数据。

`deployment.read()`必须一次读取同一活动组合的实际部署锁、已校验使用包及原迁移账和物理观察。安装证据限定为实际使用包的原校验结果，Core 复用原 `requireCorePackagePin` 的字节检查。缺源、读取失败或合同不符显示不可用，实际注册目录独立保留，零 Core 注册仍返回空目录。版本读取复用原 `planCoreUpdate` 的同版本纯预检，并要求原迁移执行明确 ready。

组合所选的数据能力保留原完整发行锁，实际使用包经 `requirePlatformDataCapabilityFiles` 核查，数据观察沿能力原迁移账提供。版本投影分别显示能力的锁定包、实际包和可用状态，必需能力版本使用 `coreDeploymentHostVersions`。缺包、摘要变化和 unknown 迁移按所属能力给出缺口，依赖该能力的 Core 同步显示不可用。未选择能力的旧组合继续省略该字段。

| 路径 | 输入与结果 |
| --- | --- |
| `GET /platform/core-packages/catalogue` | 当前注册、查询时间及底座和每个 Core 的锁定发行、实际包、注册与可用状态 |
| `POST /platform/core-packages/discover` | `{ query: { text, page }, refresh }`，复用原 Topic 分页、缓存和带原时间的过期快照 |
| `POST /platform/core-packages/repository` | `{ repository, includeReleases }`，公开 GitHub 规范地址，按固定提交读取根索引或清单，按需读取固定 Release |
| `GET /platform/core-packages/private-source` | 当前平台 SaaS 管理员读取允许仓库、修订与凭据配置状态，禁止缓存 |
| `POST /platform/core-packages/private-source` | 按原 `expectedRevision` 保存启用状态/允许仓库，或一次轮换/撤销凭据，只返回脱敏配置 |

仓库候选始终未审核，包状态为 unchecked。发布元数据、包校验、下载、受控部署注册、租户授权和业务生效分别判定。声明兼容来自实际底座包版本和原 `checkCoreCombination`，安装状态由实际包及受控部署证据判断。GitHub 离线或限流时，当前目录继续独立查询。

完整公共接入使用 `composePlatformCorePackageAssembly` 和 `CorePackageAssemblyModule.register`，共用当前数据库、账号、注册目录和实际提交意图审计。宿主配置绝对存储根并准备 `releases`、`candidates` 普通子目录。原 Core 与四组包管理政策经 `createPlatformCorePackageAssemblyHttpAccess` 合并为唯一准入 provider，路径匹配须唯一。[公共装配](../core-package-assembly.ts) · [公共 API 供给](../../../../apps/platform-api/src/core-assembly.ts)

固定包预检和候选准备继续复用原 install、update 和 deployment，由宿主供给实际包来源、完整材料及独占存储。零 Core 公共宿主可通过启动锁、本地底座引用与实际运行模块目录供给标准底座证据，原数据状态沿同一 MySQL 观察读取；缺证据时保留 `unavailable`，注册目录返回实际空集合。可信旧路径许可来自宿主精确策略，按 Core ID 传给下载、检查、原部署生成器和文件准备。[当前发行读取](../core-package-deployment.ts) · [固定包预检](../core-package-preflight/README.md) · [候选准备与原结果读取](../core-package-preparation/README.md)

`createCorePackageOpenApi()` 覆盖读取、包预检、发行选择、候选准备和私有配置实际协议。全部接口返回 HTTP 200 的原 `data` / `requestId` 包装，错误状态及 unavailable、unknown、absent、pending 分别说明。私有配置请求的 token 为只写字段，不进入任何响应；配置轮换、撤销与复权边界见[来源说明](../../README.md#githubcom-私有固定发行)。请求复用原 schema，来源、版本、清单、迁移和候选指纹的跨字段约束随对应结构说明。宿主登记同版 Controller 后，使用正式 `createPlatformCorePackageOpenApi(document)` 合并原文档，输入复制及路径 / schema 冲突拒绝沿同一函数维护。[同版本接口片段](openapi.ts)
