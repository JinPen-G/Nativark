# 公共后台

`@rental-os/platform-admin` 承载原 React/UIArc 后台的真实公共呈现。业务 Core 用 `/core` 声明页面与操作，使用 `/ui` 的表单、列表和反馈。宿主提供已经验证的身份、唯一 HTTP 客户端和查询缓存。公共包不导入 Rental 页面、权限模型、业务 API 或 AI 执行器。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [公共应用工厂](src/application.tsx)、[组合参数](src/application-context.ts) | `/application` 为零Core及工单宿主提供同一登录/设置/受保护路由，宿主只传品牌、唯一会话和已登记页面 |
| [Core授权目录](src/CoreAccessPage.tsx)、[可见性口径](src/application-access.ts) | SaaS选择真实租户和已登记Core；租户选择真实成员和服务端可分配Core，复用同一授权面板与原操作核对 |
| [公共订阅](src/features/subscription/README.md) | 六条原路由、版本对比、申请与办理、目录与年费、无金额到期浮窗，复用同一宿主会话和请求 |
| [公共第三方服务](src/features/integrations/README.md) | 原目录、配置抽屉和测试反馈；零Core与工单宿主共用同一路由、权限、请求及双语文案 |
| [公共租户/人员/角色](src/features/access/PublicManagementPages.tsx)、[权限编辑器](src/features/access/PermissionMatrix.tsx) | SaaS租户创建/资料/状态与本租户人员角色管理；共用原目录、保存、草稿与权限组件，旧Rental入口转接 |
| [公共组织与安全设置](src/features/platform-settings/README.md) | 原组织列表/编辑器、安全基线与概览、请求及双语文案；公共应用和原后台消费同一实现 |
| [公共字典与编号](src/features/platform-tools/README.md) | 原两个页签、列表与表单、首组字典创建和取号结果，原后台与公共应用共用请求及词条 |
| [正式出口](src/index.ts)、[壳组合](src/PlatformShell.tsx) | Provider、完整侧栏、面包屑/页名、通知、休息和面板，导航由获权 Core 页面声明生成 |
| [运行时端口](src/runtime/index.ts)、[查询边界](src/runtime/session-queries.ts) | 宿主提供当前服务端会话、请求、订阅及代次；切身份先中止旧请求再清缓存，不推断业务回滚 |
| [公共浏览器会话](src/runtime/browser-session.ts)、[HTTP](src/runtime/browser-http.ts)、[登录/改密](src/session-pages.tsx) | 独立公共Web宿主使用同一认证执行者；原Rental只适配原存储、空间与刷新收据 |
| [Core 出口](src/core/index.ts)、[路由](src/core/CoreRoutes.tsx)、[页面](src/core/CorePage.tsx) | 路由、主按钮、真实就绪/范围、表单/列表和原结果管理；服务端继续复核授权 |
| [UI 出口](src/components/ui/index.ts)、[主题](src/app/theme.tsx)、[语言](src/app/locale.tsx) | 单一 Context 与原组件适配，Core 可提供字典，原后台保留完整业务字典 |
| [外壳](src/components/BusinessShell.tsx)、[页头插槽](src/components/workspace/WorkspaceHeader.tsx) | 原几何与动效、单个活动路由、表单原生提交关联及卸载清理 |
| [构建适配](config/vite.ts)、[样式](src/styles.css) | 同源 UIArc 别名、动效偏好与按钮图标；环境/代理由宿主管理 |
| [原后台适配](../../apps/admin/src/app/adminRuntime.ts) | 原 authStore/request/queryClient 消费端口，旧源码入口窄转接同一公共实现 |

## 宿主接入

普通宿主从 `/runtime` 创建一次 `createBrowserAdminSession`，将它与品牌、可选页面注册表传给 `/application` 的 `createPlatformAdminApplication` 即可挂载。零Core省略 `pages`；增加Core只改宿主组合与Core自身贡献。实际最小组合见[零Core App](../../apps/platform-admin/src/App.tsx)和[工单入口](../../apps/example-tickets-admin/src/main.tsx)。公共应用创建唯一 Data Router，并将同一注册表用于菜单、直接路由和面包屑。

已有完整宿主可按下面端口逐层接入。

1. 用 `platformAdminVite()` 的 `plugins`、`postcss`、`alias` 合并宿主 Vite 配置，再按原顺序接 Tailwind 与 React 插件。仅宿主加载环境配置。
2. 入口加载 `@rental-os/platform-admin/styles`。单一 `AdminUiProvider` 提供主题、语言、UI 与同一查询缓存。
3. `AdminRuntimeProvider` 提供 `AdminRuntime`。快照必须稳定，只有原服务端响应可以置 `sessionVerified`。
4. 受控组合调用正式 Core 页面注册函数，将同一注册表传给 `PlatformShell.pages` 和 `createCoreRouteElements`。公共菜单由宿主按原权限提供。
5. 页面通过 `CorePage` 的操作声明复用原主按钮，通过 `useCoreRequest` 消费本 Core 路径和会话/页面围栏。实际例子及 Agent 模板见[接入指南](../../docs/平台底座/Core接入/平台Core接入-开发任务.md#core-quick-start)。

无 Core 时传空注册表，壳保留全部公共控件及联系管理员的提示，默认通知为空，不开放通用 Agent。通知内容/详情和可选面板通过宿主端口提供。公共包本身不拥有登录凭据、API 代理或可用权限。

## 来源与验证

原 UIArc 源码仍在 [ui-arc](../ui-arc/README.md)，保留来源与许可。侧栏许可及来源随[实际源码](src/components/animate-sidebar/LICENSE.md)移动；[路由动效来源](src/components/workspace/sources.json)和[休息组件来源](src/features/rest/archive/SOURCE.md)保留。源码/静态/类型证据和剩余运行缺口见[开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-public-admin-boundary-20261115)。

`npm run lint -w @rental-os/platform-admin` 检查源码类型，宿主负责 Vite 产物。只读组件来源核验为 `node scripts/audit-admin-components.cjs --json`。这些命令不证明浏览器、真实 HTTP、数据库保存或独立安装通过。

真实零Core消费者见[公共Web宿主](../../apps/platform-admin/README.md)。新宿主使用 `/forms` 的草稿同步/离页保护及 `/motion` 启动入口。既有 `/source/` 转接路径在 [包配置](package.json) 中逐项映射实际文件及扩展名，TypeScript与Vite均消费同一出口；它们只承担原后台兼容。新业务页面使用正式 `/core`、`/ui` 等出口，统一能力查询不重复列出这些兼容路径。

公共应用按当前身份显示“租户 Core 授权”或“成员 Core 分配”。前者只由 SaaS 管理员读取当前部署目录并为租户开通/停用；后者从服务端 `assignable` 选择本租户已获权 Core，不要求管理者先分配给自己。地址参数只定位真实目录对象，缺失对象不挂载命令。提交中的路由/对象切换被阻止，未知结果保留原核对编号；分配与业务角色各自管理，界面可见性不代替服务端权限。

SaaS“租户管理”读取公共租户目录；创建还须有 `system:tenant:bootstrap` 权限。填写租户编码、名称和管理员资料即可创建，无需Core/品类/空间。保存返回的临时密码只在当前页显示，管理员首次登录改密；之后再按上段开通Core。租户详情只修改名称与简称，状态页单独选择启用/冻结/停用并填写原因，分别调用原接口；恢复租户保留原Core授权及成员分配。

“人员管理”和“角色权限”复用公共目录/保存接口；角色权限从实际已登记目录选择，默认新角色为本人数据范围，不采用Rental经营空间默认值。固定管理员角色只读，人员资料保留原角色/组织/管理员字段；一次性创建口令只在当前页显示，不进入缓存或存储。保存与回车共用同一Promise，失败先重读核对，后台刷新保留草稿。权限搜索/对照组件和草稿模型通过 `/access` 正式导出，数据和保存由宿主提供。

人员目录可重置其他成员口令，管理员账号另须租户管理员权限；本人走修改密码入口。重置明确确认后调用原接口，撤销旧会话并返回临时密码。普通角色可明确删除，固定/已分配角色由服务端拒绝。失败不自动重发，先读当前目录；再次重置属于新操作，会替换此前口令。已确认结果单独显示，不被后续目录失败遮住；临时密码仅留当前页并可复制。订阅接入见上方公共模块。

“组织管理”沿 `/settings/organizations` 显示原列表、筛选、编辑及状态控件；受权读取与全租户维护分别判定。“安全基线”沿原 `/platform/system` 提供登录限流、密码策略、脱敏和二次确认设置，保存要求当前 SaaS 身份及参数管理权限。原后台组织页签与安全页复用同一组件，六个请求通过宿主唯一客户端发送。个人改密仍使用“账号安全”。[路由、权限、草稿及接入](src/features/platform-settings/README.md)

“账号安全”让所有已验证账号用当前密码修改本人密码，复用 `/session-pages` 的同一表单和会话端口。首次强制改密仍使用完整面板，公共设置使用嵌入形式；确认输入只参与前端校验，HTTP只发送当前/新密码。草稿和提交中有离开保护，成功清空输入并由原会话轮换更新当前身份，失败保留输入。不在本地存储密码。

“第三方服务”沿原 `/tenant/integrations` 进入。公共应用与原Rental后台共用同一页面；租户平台管理员、明确集成权限或通配权限可见，SaaS账号沿原规则不进入租户配置页。目录、保存及连接测试使用宿主唯一请求入口，供应商可用性与历史配置由服务端裁定。集成双语在公共模块维护，Core无需再复制词条。[页面与请求](src/features/integrations/index.ts) · [公共文案](src/features/integrations/messages.ts)

记录事实和浮层退出可从正式 `/shell` 的 `RecordFacts`、`RecordFact` 及 `/ui` 的 `useModalDismissal` 使用。旧Rental路径已转接这些实际出口，Core作者无需导入兼容源码路径。

“平台工具”沿原 `/platform/tools` 使用 `/platform-tools` 的页面与 `usePlatformToolsTabs`；需要嵌入原页面时复用其页签和结果浮层。`/platform-tools/client` 提供五个原请求方法，消费宿主唯一 HTTP 客户端。字典与编号各自按原权限开放，SaaS 账号不进入租户工具。零 Core 缺省列表为空，可填写首个字典项建立第一组；编号保存省略页面没有编辑控件的当前流水，由服务在锁内保留最新值。取号成功与随后刷新失败分别反馈。[简单接入及表单行为](src/features/platform-tools/README.md)
