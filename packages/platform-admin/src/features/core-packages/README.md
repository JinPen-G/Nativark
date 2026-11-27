# Core 包管理页面

[CorePackagesPage](CorePackagesPage.tsx)提供当前注册目录、GitHub Topic 发现和底座/Core独立版本三个视图。[客户端](client.ts)复用唯一 AdminRuntime，查询键带原会话代次，离开视图释放查询，权限变化后拒绝旧响应。普通租户在挂载查询前拒绝。

## 公开 Rental Core 的五步

已公开验证的组合使用 Zelo 测试底座 `0.1.16` 和 Rental Core `0.1.12`。Rental 要求底座 `>=0.1.12 <0.2.0`、接入合同 `>=0.1.1 <0.2.0`、Node `>=22.12.0 <25.0.0`。[底座发行](https://github.com/JinPen-G/Zelo/releases/tag/v0.1.16) · [Rental 发行](https://github.com/JinPen-G/Zelo-rental-core/releases/tag/v0.1.12)

标准资产为 `rental-0.1.12.tgz`，SHA-256 为 `7179a27231aed503ab294639093d3bb7f101a51cf63c5c3e984d43329c835574`，发行源码为 `50ba3335592893a3b7a4d440ba85b764b2ca8e24`（注：`0.1.12`–`0.1.14` 历史归档构建于仓库更名前；更名后的新版本使用 `JinPen-G/Zelo-rental-core` 来源与 `zelo-core` Topic 发现）。

| 步骤 | 操作与核对结果 |
| --- | --- |
| 1. 发现 | SaaS 管理员进入 `/platform/core-packages` 的“发现 Core”，搜索 `rental`，选择 `JinPen-G/Zelo-rental-core`。 |
| 2. 下载与校验 | 在 `v0.1.12` 详情点“选择版本”，核对上面的来源和摘要，保存固定发行引用，再按预览确认“准备候选”。成功回执显示“候选已准备，待部署”。 |
| 3. 部署注册 | 部署人员按[Rental 宿主步骤](https://github.com/JinPen-G/Zelo-rental-core/blob/dfb929a71e9e5802c0077ca8552f38f7b301f604/workspace/apps/rental-api/README.md)使用固定包与部署锁，完成构建、迁移和启动，在“当前目录”核对注册来源及版本。首次准入按[正式管理步骤](../../../../platform-core-host/README.md#部署准入与存量切换)读取当前状态并登记 `accepting`。 |
| 4. 租户授权 | SaaS 管理员进入 `/platform/core-access` 的“租户 Core 授权”，选目标租户与 `rental`，核对当前修订并保存授权。租户列表的“Core 授权”动作也进入此页。 |
| 5. 成员分配 | 租户管理员进入 `/settings/member-cores` 的“成员 Core 分配”，给指定成员分配 `rental`，再按原角色和经营空间入口配置业务权限及绑定。当前目录、租户授权、成员分配与业务范围分别回读。 |

授权和分配使用同一[管理面板](../../core/CoreAccessPanel.tsx)。应答不明时选择“核对原结果”，沿原发行引用、候选摘要或管理操作读取原收据。

页面必须接收宿主提供的 `brandName: string`，沿用当前 AdminRuntime 和 QueryClient。原后台从现有租户/用户品牌解析传入，公共宿主从 `options.brandName` 传入。

页面从正式 `@rental-os/platform-core-host/core-package-ports` 消费同源路径和投影类型，搜索校验复用 `@rental-os/core-contracts/github-discovery`。宿主须提供这些正式子出口并将页面接入原 SaaS 路由/菜单，HTTP 接入见[服务端模块](../../../../platform-core-host/src/core-packages/README.md)。

发现每页20项，关键词发送服务端，刷新重新读取原公开源。首次加载和读取失败保留查询栏，关键词校验复用正式 schema，错误就地显示。候选始终未审核和包未校验，选择仓库后才读取固定提交、清单和Release。离线/限流可以显示带原时间的过期查询，旧候选暂停操作，当前注册目录使用独立读取。结果不完整或超过GitHub前1000项上限时提示缩小关键词。

GitHub仓库地址可直接输入，回车应用修剪后的地址，由原服务端仓库合同校验。输入草稿保留，清除关闭所选仓库；Topic行选择同步地址。仓库查询和刷新使用独立查询键，Topic加载、失败、关键词与翻页均保留所选仓库，仓库结果按自身状态显示。

发行详情的选择版本动作进入[公共侧栏](CorePackagePreparationDialog.tsx)。先重新核对所见 Release 的完整 pin，再保存不可覆盖的发行引用。移动 Tag、提交或资产变化时要求重新读取仓库。保存的引用进入同一服务端下载、包校验及候选准备，按当前锁定组合判断新安装或单 Core 更新。

版本表分别呈现实际使用包、锁定版本、合同/数据条件和可用状态。底座、单 Core 和所选平台数据能力各有准备更新入口，使用宿主已登记的固定包引用。使用已下载包入口进入同一 Core 安装预检，支持本地和私有来源。缺部署或包证据显示不可用，实际空注册显示空目录。

[操作状态](useCorePackagePreparation.ts)在页面内同步防重，发行保存及准备请求关闭认证重发。写入前按本人/租户保存最小 sessionStorage 核对指针，存储失败时阻止派发。该指针只覆盖同一标签页会话内的重载，不保证关闭标签页后或其他标签页恢复。关闭标签页前须另行保存原发行引用或候选 SHA；关闭后使用当前有效 SaaS 会话，通过[正式原回执 HTTP](../../../../platform-core-host/src/core-package-preparation/http.ts)的 `POST /api/platform/core-packages/preparation-receipt` 与 `{"sha256":"<原候选SHA>"}` 核对候选。发行选择则按[发行回执协议](../../../../platform-core-host/src/core-package-selection/protocol.ts)读取原引用。

HTTP 失应答后读取同一发行引用或候选 SHA；403、409、取消和超时均保留原指针。发布后取消等待或连接中断不等于撤销发布。发行记录 absent、候选目录缺失时返回的 unavailable 都只表示当前未取得原结果，不证明原请求未执行或已终止，不能据此自动重发或清除指针。只有服务端明确返回发行保存或准备请求的发布前 unavailable，或核定相符成功回执后，页面才清理本机标记；清理失败与已确认的服务端结果分别呈现。

预览显示完整候选组合、数据版本、文件清单及 SHA；确认准备使用同一请求和 expectedSha256。预览及准备等待上限为240秒。候选一直显示待部署，部署人员按固定材料继续备份、兼容检查、迁移及实际运行验证，注册、租户授权和成员分配分别办理。发布元数据、下载/包校验、部署注册、租户授权和业务生效沿各自原事实显示。

确认绑定到本次显示的预览。不同发行、包引用或更新目标需要重新核对；同动作只有相同输入可共用在途请求，旧按钮回调在写入本机指针或派发前拒绝。原结果视图只核对已保存的发行引用或候选 SHA，不提供再次准备动作。

所选平台数据能力在独立版本表中显示自身标识、固定发行、实际包和数据条件。能力的完整包或原迁移观察缺失时显示不可用，依赖它的 Core 沿原必需能力合同判断。注册目录继续消费宿主提供的业务 Core 集合。

能力的准备更新入口发送同一 `platform-capability` 目标和 `capabilityId`，服务端读取宿主登记的完整能力包，核来源、版本、全部文件与不可变迁移链后生成候选。能力准备继续使用原 SHA 和回执核对机制。

运行时路径复用服务端的[发行浏览器协议](../../../../platform-core-host/src/core-package-selection/protocol.ts)及[候选浏览器协议](../../../../platform-core-host/src/core-package-preparation/protocol.ts)，宿主通过对应正式子出口提供，浏览器运行时仅载入路径常量。服务端校验与存储见[发行模块](../../../../platform-core-host/src/core-package-selection/README.md)和[候选准备模块](../../../../platform-core-host/src/core-package-preparation/README.md)。

本模块复用公共 PageHeading、Tabs、ContentTransition、Table、QueryState 和 UIArc 状态组件。完整宿主、真实 GitHub 和浏览器验证由装配片按授权核收。
