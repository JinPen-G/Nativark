# Rental 与工单公共后台示范

本应用将 Rental 的业务页面与工单的列表、新建、详情和配置页登记到同一公共后台。登录、公共设置、菜单、面包屑、主操作、主题和请求缓存由公共应用供给。[组合入口](src/main.tsx) · [公共页面合同](../../packages/core-contracts/README.md#声明页面与操作) · [公共应用](../../packages/platform-admin/src/application.tsx)

## 装配

1. 按宿主锁文件准备依赖与 Rental、`example-tickets` 两个固定标准包，API 使用相同的包版本、来源与摘要。
2. 将 `CORE_DEPLOYMENT_LOCK` 指向同一固定部署锁，`cores` 显式包含这两个包。构建逐包校验实际字节，并核对底座及所选数据能力的 `coreDeploymentHostVersions`。[构建入口](vite.config.ts) · [包校验](../../packages/core-contracts/src/install.ts) · [部署合同](../../packages/core-contracts/src/update.ts)
3. 在具备对应环境的工程中执行 `npm run build -w @rental-os/example-multi-core-admin`，本地开发使用 `npm run dev -w @rental-os/example-multi-core-admin`。Web API 基址由 `VITE_API_BASE_URL` 提供，默认 `/api`，开发端口默认 `5179`。
4. SaaS 管理员授权租户使用两个 Core，租户管理员通过公共成员 Core 分配页分别分配成员。每个 Core 继续校验自己的业务权限和就绪条件。[授权页面](../../packages/platform-admin/src/CoreAccessPage.tsx)

## 源码职责

- [main](src/main.tsx)创建唯一 `createRentalBrowserAdminSession`，将两份真实页面贡献放入同一注册表，再交给 `createPlatformAdminApplication`。公共应用与 Rental 正文使用同一 runtime、会话代次和 QueryClient。
- [MultiCoreShell](src/MultiCoreShell.tsx)持续挂载正式 Rental 薄壳和通知 Provider。当前获权 Rental 页面显示经营空间选择，工单与公共页显示公共上下文。Core 撤权后的当前目录更新关闭相应菜单、动作和通知读取，工单原操作状态沿同一正文保留。
- [Rental 导航](../../packages/rental-core/admin/browser-navigation.ts)维护原深链接、通知对象定位及已验证的 `rental-workspace` 投影。工单按租户范围进入正式路由，缺经营空间的成员仍可使用获权工单和适用公共设置。
- [Rental 贡献](../../packages/rental-core/admin/index.tsx)与[工单贡献](../../packages/example-tickets-core/admin/index.tsx)提供真实正文及类型化动作，原写入、权限、历史与 unknown 核对规则沿各自实现运行。

源码取出时包含本应用、`config/environment.cjs` 及其类型声明、公共 `core-contracts`、`platform-contracts`、`platform-admin`、`shared`、`ui-arc`、`ui-motiq` 与两个 Core 的已选依赖闭包。依赖声明见[应用包](package.json)，构建接点使用公共正式出口。

## 页面与动作边界

- 宿主接受新的租户或经营空间投影时，通过原会话切换及 `session.invalidateBusinessScope()` 更新同一代次、请求信号和查询缓存。公共路由按登记参数、当前 Core 授权、成员分配与真实绑定生成页面生命周期。[组合参数](../../packages/platform-admin/src/application-context.ts) · [页面路由](../../packages/platform-admin/src/core/CoreRoutes.tsx)
- 动作执行时即时读取同一 QueryClient 的当前目录、绑定与就绪投影，并复核原会话。当前 Core 的授权或绑定修订变化使旧回调失效，其他 Core 的目录更新保留当前页的草稿和原操作。配置页沿当前获权入口读取首次设置状态，初始化及收据核对绑定当前管理资格和所属 Core 修订。[目录](../../packages/platform-admin/src/core/useCoreSession.ts) · [范围](../../packages/platform-admin/src/core/useCoreScope.ts) · [请求](../../packages/platform-admin/src/core/useCoreRequest.ts)
- 按钮和表单回车共用一次保存，异步校验值及完成反馈绑定原表单实例与页面代次。替换或卸载后，旧保存结果以 `AbortError` 返回。初始化结果未知时继续保留原操作号，恢复后沿原收据接口核对。[表单](../../packages/platform-admin/src/core/useCoreForm.ts) · [初始化与核对](../../packages/platform-admin/src/core/useCoreBinding.ts)
- Core 通过页面声明进入原页头、按钮、确认和保存适配。保留标签页沿公共 `WorkspaceHeaderScope` 提供活动状态，非当前页的确认与保存回调在派发前关闭。公共 `PageHeading` 由当前页在 layout 认领浏览器标题，退出时仅释放自己的认领并回退品牌，保留已被下一页认领的标题。标签页中的原表单和操作状态随正文保留。[页面适配](../../packages/platform-admin/src/core/CorePage.tsx) · [页头](../../packages/platform-admin/src/components/PageHeading.tsx) · [活动范围与 portal](../../packages/platform-admin/src/components/workspace/WorkspaceHeader.tsx)

## 验证边界

本片完成公共后台及双 Core 示例的源码类型检查、原工单与订单表单定向用例，以及真实公共组合、路由和 hooks 源码的离线授权、范围与生命周期冒烟。目录及就绪响应、业务请求和 Form 使用明确 fixture，查询缓存使用原 QueryClient。零 Core 与双 Core 均核对同一公共壳、runtime、QueryClient 和唯一 Router。真实双 Core API 装配、持久化、浏览器实页、生产构建、干净标准包安装与正式多 Core 验收由对应宿主阶段继续完成。

页头退出沿上述组合与 hooks 证据，另以四组离线反例核对非当前页写标题、卸页等待下一路由、旧确认及旧保存校验的关闭。标题清理包含 A 与 B 同标题时的 owner 区分，旧动作包含退出再返回同一标签页后的回调失效及当前新操作。该验证使用源码 hook facade 与明确 document fixture。

在途初始化另核对所属 Core 与其他 Core 的修订变化。其他 Core 更新后正常接收原初始化结果，管理资格、原会话或所属 Core 修订改变时保留原操作号，继续沿原结果核对。
