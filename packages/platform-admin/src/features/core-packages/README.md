# Core 包管理页面

[CorePackagesPage](CorePackagesPage.tsx)提供当前注册目录、GitHub Topic 发现和底座/Core独立版本三个视图。[客户端](client.ts)复用唯一 AdminRuntime，查询键带原会话代次，离开视图释放查询，权限变化后拒绝旧响应。普通租户在挂载查询前拒绝。

页面必须接收宿主提供的 `brandName: string`，沿用当前 AdminRuntime 和 QueryClient。原后台从现有租户/用户品牌解析传入，公共宿主从 `options.brandName` 传入。

页面从正式 `@rental-os/platform-core-host/core-package-ports` 消费同源路径和投影类型，搜索校验复用 `@rental-os/core-contracts/github-discovery`。宿主须提供这些正式子出口并将页面接入原 SaaS 路由/菜单，HTTP 接入见[服务端模块](../../../../platform-core-host/src/core-packages/README.md)。

发现每页20项，关键词发送服务端，刷新重新读取原公开源。首次加载和读取失败保留查询栏，关键词校验复用正式 schema，错误就地显示。候选始终未审核和包未校验，选择仓库后才读取固定提交、清单和Release。离线/限流可以显示带原时间的过期查询，旧候选暂停操作，当前注册目录使用独立读取。结果不完整或超过GitHub前1000项上限时提示缩小关键词。

GitHub仓库地址可直接输入，回车应用修剪后的地址，由原服务端仓库合同校验。输入草稿保留，清除关闭所选仓库；Topic行选择同步地址。仓库查询和刷新使用独立查询键，Topic加载、失败、关键词与翻页均保留所选仓库，仓库结果按自身状态显示。

发行详情的选择版本动作进入[公共侧栏](CorePackagePreparationDialog.tsx)。先重新核对所见 Release 的完整 pin，再保存不可覆盖的发行引用。移动 Tag、提交或资产变化时要求重新读取仓库。保存的引用进入同一服务端下载、包校验及候选准备，按当前锁定组合判断新安装或单 Core 更新。

版本表分别呈现实际使用包、锁定版本、合同/数据条件和可用状态。底座、单 Core 和所选平台数据能力各有准备更新入口，使用宿主已登记的固定包引用。使用已下载包入口进入同一 Core 安装预检，支持本地和私有来源。缺部署或包证据显示不可用，实际空注册显示空目录。

[操作状态](useCorePackagePreparation.ts)在页面内同步防重，发行保存及准备请求关闭认证重发。写入前按本人/租户保存最小 sessionStorage 核对指针，存储失败时阻止派发。重新进入或 HTTP 失应答后读取同一发行引用或候选 SHA；403、409、取消和超时均保留原指针。发行记录 absent 仅表示当前未读到，继续保留原指针。服务端明确返回发布前 unavailable 或核定相符成功回执后清理本机标记，清理失败与已确认的服务端结果分别呈现。

预览显示完整候选组合、数据版本、文件清单及 SHA；确认准备使用同一请求和 expectedSha256。预览及准备等待上限为240秒。候选一直显示待部署，部署人员按固定材料继续备份、兼容检查、迁移及实际运行验证，注册、租户授权和成员分配分别办理。发布元数据、下载/包校验、部署注册、租户授权和业务生效沿各自原事实显示。

确认绑定到本次显示的预览。不同发行、包引用或更新目标需要重新核对；同动作只有相同输入可共用在途请求，旧按钮回调在写入本机指针或派发前拒绝。原结果视图只核对已保存的发行引用或候选 SHA，不提供再次准备动作。

所选平台数据能力在独立版本表中显示自身标识、固定发行、实际包和数据条件。能力的完整包或原迁移观察缺失时显示不可用，依赖它的 Core 沿原必需能力合同判断。注册目录继续消费宿主提供的业务 Core 集合。

能力的准备更新入口发送同一 `platform-capability` 目标和 `capabilityId`，服务端读取宿主登记的完整能力包，核来源、版本、全部文件与不可变迁移链后生成候选。能力准备继续使用原 SHA 和回执核对机制。

运行时路径复用服务端的[发行浏览器协议](../../../../platform-core-host/src/core-package-selection/protocol.ts)及[候选浏览器协议](../../../../platform-core-host/src/core-package-preparation/protocol.ts)，宿主通过对应正式子出口提供，浏览器运行时仅载入路径常量。服务端校验与存储见[发行模块](../../../../platform-core-host/src/core-package-selection/README.md)和[候选准备模块](../../../../platform-core-host/src/core-package-preparation/README.md)。

本模块复用公共 PageHeading、Tabs、ContentTransition、Table、QueryState 和 UIArc 状态组件。完整宿主、真实 GitHub 和浏览器验证由装配片按授权核收。
