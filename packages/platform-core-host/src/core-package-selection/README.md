# 固定发行选择与原引用

[应用入口](application.ts)将平台管理员选择的 GitHub 发行接入原下载与候选准备。它复用 [GitHub 正式合同](../../../core-contracts/src/github.ts)和[原公共主体围栏](../../../platform-server/src/modules/platform/platform-principal.authority.ts)，在外部读取前后核对原主体、会话及真实 SaaS 权限，保存时持原事务锁。[请求 schema 和宿主端口](ports.ts)绑定完整 pin，[浏览器协议](protocol.ts)的运行时常量可以单独消费。

## 宿主组合

宿主提供同一数据库、原用户读取、[固定发行读取](artifact-source.ts)和[独占引用存储](file-store.ts)，再用 `composePlatformCorePackageSelection` 组成应用。引用目录由部署配置指定，调用方负责准备普通目录及其访问权。目录与所有父目录均须可核定为普通目录，记录只包含固定发行身份，不包含凭据或临时下载地址；私有发行记录仅供当前平台管理主体读取，不属于公开索引。

显式 `visibility: "private"` 的选择沿[来源配置](../../README.md#githubcom-私有固定发行)取得当前服务端权限。预览、首次选择和重复选择都复核远端完整 pin；已有引用不跳过来源权限。保存前在原事务内锁身份和来源修订，再发布不可覆盖记录。撤销取包凭据后仍允许当前平台管理员读取原引用以核对未知结果，该回读不授予重新下载、准备或部署资格。

`createCorePackageReleaseReferenceFileStore` 为完整 pin 生成 `github-<SHA-256>` 引用，保存唯一 JSON 记录。已记录引用保持原 pin 和选择时间。保存使用同卷临时目录与硬链接发布，目标已存在时读取原记录。临时目录在退出路径清理，发布失应答返回原引用供回读。目录或记录读取失败返回 `unavailable`，只有可核定的文件缺失返回 `absent`。

将同一存储传给 `createPlatformCorePackageSelectedArtifactSource`，所得 `artifacts` 直接供[原预检](../core-package-preflight/application.ts)和[原候选准备](../core-package-preparation/application.ts)使用。宿主原固定包来源通过 `local` 供给，现有引用继续可用。所选发行使用[原 GitHub 下载器](../core-package-preparation/github-source.ts)核对 Tag、Release、资产长度、摘要与包清单，保留一个已下载固定包并合并同发行在途读取。引用在每次读取及下载返回前重新核定。

`legacyApiRoutes` 由宿主可信策略按 Core ID 供给精确的 HTTP 方法 / 路径，并传给同一固定下载器。完整装配共用该策略与原预检、候选生成和文件准备。发布前使用原事务记录 `requested` 审计并复验当前主体，发布后的提交失应答或撤权携带同一发行引用返回 `unknown`。[统一装配与审计](../core-package-assembly.ts)

## HTTP 和状态

[Nest 模块](http.ts)注册三个 `POST /platform/core-packages/` 入口，路径来自浏览器协议。

| 路径 | 请求 | 结果 |
| --- | --- | --- |
| `preview-release` | 正式 GitHub 发行选择 | 完整 pin、原引用、查询时间与未审核状态 |
| `select-release` | 原预览返回的 `release` | 已保存或原已保存引用，失应答携带同一引用 |
| `release-reference` | 原 `reference` | 原记录、可核定缺失或读取不可用 |

预览与引用记录保留 `package=unchecked`。下载和标准包校验由原预检完成，候选准备继续返回 `pending`。部署、注册、租户授权与成员分配使用[原管理入口](../core-management.controller.ts)，各阶段分别记录事实。

宿主挂载 `CorePackageSelectionHttpModule` 时，同时向原 Guard 登记 `createPlatformCorePackageSelectionHttpAccess()` 的固定路径。公共 API 使用正式 `CorePackageAssemblyModule` 供给同一四组应用、唯一 HTTP 准入和 OpenAPI 组合。浏览器从正式协议子出口读取类型和路径。[公共宿主装配](../../../../apps/platform-api/src/core-assembly.ts)

## 验证入口

定向验证覆盖固定引用到原下载、预检和候选准备，重复选择、可信缺失与读取失败、Tag 变化、记录损坏、保存失应答及当前撤权。文件存储检查应执行原实现的发布和清理分支，模拟文件系统与实际目标文件系统的证据分别记录。真实 GitHub、HTTP 监听、浏览器和部署沿对应环境授权核收。[候选准备职责](../core-package-preparation/README.md) · [标准包导读](../../../core-contracts/README.md)
