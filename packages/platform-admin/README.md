# 公共后台

`@rental-os/platform-admin` 承载原 React/UIArc 后台的真实公共呈现。业务 Core 用 `/core` 声明页面与操作，使用 `/ui` 的表单、列表和反馈。宿主提供已经验证的身份、唯一 HTTP 客户端和查询缓存。公共包不导入 Rental 页面、权限模型、业务 API 或 AI 执行器。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [公共应用工厂](src/application.tsx)、[组合参数](src/application-context.ts) | `/application` 为零Core及工单宿主提供同一登录/设置/受保护路由，宿主只传品牌、唯一会话和已登记页面 |
| [Core授权目录](src/CoreAccessPage.tsx)、[可见性口径](src/application-access.ts) | SaaS选择真实租户和已登记Core；租户选择真实成员和服务端可分配Core，复用同一授权面板与原操作核对 |
| [Core包管理](src/features/core-packages/README.md) | `/core-packages` 提供同一 SaaS 页面与请求，发现、版本、固定发行及 pending 候选共用原会话和查询缓存 |
| [公共订阅](src/features/subscription/README.md) | 六条原路由、版本对比、申请与办理、目录与年费、无金额到期浮窗，复用同一宿主会话和请求 |
| [公共第三方服务](src/features/integrations/README.md) | 原目录、配置抽屉和测试反馈；零Core与工单宿主共用同一路由、权限、请求及双语文案 |
| [公共租户/人员/角色](src/features/access/PublicManagementPages.tsx)、[权限编辑器](src/features/access/PermissionMatrix.tsx) | SaaS租户创建/资料/状态与本租户人员角色管理；共用原目录、保存、草稿与权限组件，旧Rental入口转接 |
| [公共平台管理](src/features/platform-settings/README.md) | 原组织、安全、平台参数/运维、演示预约和官方日历，保持原字段、列表、弹层与双语文案；公共应用和原后台消费同一实现 |
| [公共字典与编号](src/features/platform-tools/README.md) | 原两个页签、列表与表单、首组字典创建和取号结果，原后台与公共应用共用请求及词条 |
| [公共邀请、寄件与客服](src/features/messaging/README.md)、[成员入口](src/features/access/PublicMemberInvitations.tsx) | `/messaging` 提供原页面和请求工厂；公共应用登记匿名邀请、对应租户登录及受保护邮件目录，基础角色/组织和原操作键保持 |
| [正式出口](src/index.ts)、[壳组合](src/PlatformShell.tsx) | Provider、完整侧栏、面包屑/页名、通知、休息和面板，导航由获权 Core 页面声明生成 |
| [运行时端口](src/runtime/index.ts)、[查询边界](src/runtime/session-queries.ts) | 宿主提供当前服务端会话、请求、订阅及代次；切身份先中止旧请求再清缓存，不推断业务回滚 |
| [公共浏览器会话](src/runtime/browser-session.ts)、[HTTP](src/runtime/browser-http.ts)、[登录/改密](src/session-pages.tsx) | 独立公共Web宿主使用同一认证执行者；原Rental只适配原存储、空间与刷新收据 |
| [页面接入手册](src/core/README.md)、[Core 出口](src/core/index.ts)、[路由](src/core/CoreRoutes.tsx)、[页面](src/core/CorePage.tsx) | 路由、主按钮、真实就绪/范围、表单/列表和原结果管理；服务端继续复核授权 |
| [UI 出口](src/components/ui/index.ts)、[主题](src/app/theme.tsx)、[语言](src/app/locale.tsx) | 单一 Context 与原组件适配，提供卡片事实、原图标及列表宽度；Core 可提供字典；只读自身登记的词条，未知文案保留原文，原后台保留完整业务字典 |
| [原生卡片控件](src/native-ui.ts) | `/native-ui` 提供原 UIArc Button / Checkbox、HoverCard / HoverCardProfile、BarChart 及头像样式，保留原变体、命中区域和动效；一般业务 Form / Button 使用 `/ui` |
| [外壳](src/components/BusinessShell.tsx)、[页头插槽](src/components/workspace/WorkspaceHeader.tsx) | 原几何与动效、单个活动路由、表单原生提交关联及卸载清理 |
| [详情与事实布局](src/components/RecordDetailLayout.tsx)、[看板](src/components/kanban-board/KanbanBoard.tsx) | `/ui` 供给原记录布局/内容栈、事实/可选展开、QueryState/内容切换、列表控件和受控看板，Core提供业务事实和回调 |
| [构建适配](config/vite.ts)、[样式](src/styles.css) | 同源 UIArc 别名、动效偏好、按钮图标与严格看板适配；环境/代理由宿主管理 |
| [原后台适配](../../apps/admin/src/app/adminRuntime.ts) | 原 authStore/request/queryClient 消费端口，旧源码入口窄转接同一公共实现 |

## 宿主与业务贡献

| 消费者 | 职责与依赖入口 |
| --- | --- |
| [零 Core](../../apps/platform-admin/README.md) | 以公共浏览器会话和空页面注册表组装公共应用，保留公共管理、设置与个人入口 |
| [Rental](../../apps/rental-admin/README.md)、[双 Core](../../apps/example-multi-core-admin/README.md) | 宿主登记所选页面。两者共用 [Rental 浏览器装配](../rental-core/admin/browser/README.md)，由已验证会话提供经营范围、原深链接和业务通知。双 Core 另登记工单贡献 |
| [工单](../../apps/example-tickets-admin/README.md) | 公共浏览器会话加 [工单页面贡献](../example-tickets-core/admin/index.tsx)，页面与操作使用所属 Core 的绑定、就绪和访问状态 |
| [原管理后台](../../apps/admin/src/app/App.tsx)、[原路由](../../apps/admin/src/app/AppRouter.tsx) | 保留原会话、路由和业务组合，逐项转接公共组件和 Rental 页面。原 AI 工作台与平台模型配置消费 [AI 呈现包](../ai-native-admin/README.md)，Operator/Copilot 的业务接点由 Rental 宿主提供 |

业务页面从 [Rental 后台导读](../rental-core/admin/README.md) 进入。统一登记订单、工单、能力、地点、商品资产、商业、治理、会员、工作台与报表、渠道、开业、支付对账十二组页面。各组导读给出业务数据、操作和权限来源。页面贡献使用公共 UI、宿主请求与查询缓存，服务端按身份、经营范围及业务权限裁定。

Rental 客户入口分别由[租户网站](../../apps/tenant-website/README.md)、[企业门户](../../apps/enterprise-portal/README.md)、[客户小程序](../../apps/miniprogram/README.md)和[员工小程序](../../apps/staff-miniprogram/README.md)装配。可复用页面、会话和业务客户端分别进入 [网站 UI](../rental-core/clients/website-ui/README.md)、[网站请求](../rental-core/clients/website/README.md)、[企业门户页面](../rental-core/clients/enterprise-portal/README.md)、[企业请求](../rental-core/clients/enterprise/README.md)、[客户原生贡献](../rental-core/clients/miniprogram/README.md)及[员工原生贡献](../rental-core/clients/staff/README.md)。Web 宿主提供构建、站点入口与会话运输，原生宿主负责原页面、设备运输及存储。服务端对应 [Rental HTTP 入口](../../apps/rental-api/README.md)。

[静态官网](../../apps/website/README.md)与 [Next.js 官网](../../apps/website-next/README.md)承载公开营销内容和演示预约。预约提交到原[公开演示申请入口](../../apps/api/src/modules/demo-requests/public-demo-request.controller.ts)。租户商城的商品、预约和订单页面在租户网站宿主。第三方组件和保留适配从 [UIArc](../ui-arc/README.md) 及本页的来源说明追溯。

## 登录、外观与原页面呈现

拆分沿用原管理后台的呈现。侧栏的分组、顺序、简称、图标、搜索与收展保持原样；租户业务项由当前 Core 和成员授权过滤，SaaS 增加 Core 管理。页头的面包屑、时钟、通知、休息及页面操作使用原同行结构，正文继续复用原组件。由可信宿主提供的 `PlatformShellProps.layout` 可接回原 Agent/Copilot 的导航与内容插槽，接口授权仍由所属服务端核验。

公共平台页面继续使用原路由和权限。宿主显式提供 `platformAiPage` 时，原平台 AI 配置页进入同一 SaaS 菜单及 Router；[组合工厂](../ai-native-admin/src/platform-application.tsx)复用宿主唯一 `AdminRuntime`，页面选择不启用模型或业务工具。Rental 的原公共页面领域文案由 [Core 文案贡献](../rental-core/admin/public-page-content.ts)提供。

[登录页](src/features/auth/LoginPage.tsx)保留原双栏演示、租户专属网址、验证码与第三方预览、语言主题切换及原密码表单。可选 `loginDisplay` 只提供公开品牌和显式开发快捷入口，登录继续调用宿主唯一会话；`initialPage` 与 `onboardingPage` 只能在当前获权登记页面里选择。主面板没有额外 Core 状态抽屉。

[外观与音效](src/features/appearance/AppearancePage.tsx)复用原主题、账户色、租户圆角、动效与音效四组设置，保留乐观修订和账户/租户/浏览器各自归属；旧后台通过可选配置面板和会话回调消费同一页。原首次改密由[同源组件](src/features/auth/PasswordChangeGate.tsx)呈现。

四个独立 Web 宿主将公共 Vite 接点的 `publicDir` 用作品牌和登录演示素材目录；默认图标使用原 SVG，租户图标与浏览器标签的失败回退和深浅对比各自处理。原后台保持已登记公共目录。类型和离线断言通过后仍需用同一固定发行在实际浏览器核对布局及交互。

## 宿主接入

普通宿主从 `/runtime` 创建一次 `createBrowserAdminSession`，将它与品牌、可选页面注册表传给 `/application` 的 `createPlatformAdminApplication` 即可挂载。零Core省略 `pages`；增加Core只改宿主组合与Core自身贡献。实际最小组合见[零Core App](../../apps/platform-admin/src/App.tsx)和[工单入口](../../apps/example-tickets-admin/src/main.tsx)。公共应用创建唯一 Data Router，并将同一注册表用于菜单、直接路由和面包屑。

无可用菜单时首页使用[导航状态提示](src/coreNavigationMessage.ts)，只有 `coreNavigationEntries(pages, context, locale)` 生成可访问侧栏入口时才提示选择 Core。当前 Core 已授权而宿主未装配其页面时提示部署管理员处理，已有登记页但没有可导航入口时提示核对页面入口与权限。租户未开通、成员未分配、部署准入不可用和 SaaS 管理提示继续分别呈现，中文与英文使用同一判断。

Core 的界面词条通过可选 `messages` 传给同一应用工厂，沿原语言 Context 与公共词条合并。多个 Core 由宿主按受控顺序合并资源。Rental 组合从 `@rental-os/rental-core/admin/messages` 导入 `rentalAdminMessages`；[实际资源](../rental-core/admin/messages.ts)保留原词条及六模块合并顺序，Core 作者可以用相同接点提供自己的词条。[组合参数](src/application-context.ts)

有业务容器的宿主再提供 `getCoreContainer(coreId, pageId)`，返回当前已验证范围的 `{ type, id }`；租户范围页面可返回 `undefined`。路由每次读取当前值，变化后替换旧页面及主动作，同一个 Router 不捕获首次装配的容器。所需范围和配置就绪仍由所属 Core 的服务端贡献裁定。

需要经营空间选择、业务通知或详情的宿主，可向 `/application` 提供 `Shell` 组件。它接收 `PlatformShellProps` 并包装同一 `PlatformShell`，传递公共菜单、页面、退出和正文。`contextSwitcher` 供给当前已验证业务上下文的控件，`notifications` 与 `notificationDetails` 供给真实通知和详情。原空间切换仍提交服务端响应并推进同一会话的请求与缓存代次。[组合参数](src/application-context.ts) · [公共壳及插槽](src/PlatformShell.tsx)

通知文案从 `/notifications` 使用 `useNotificationText`。结果声音从 `/sound` 使用 `captureSoundScope` 和 `emitSoundEvent`，沿用宿主唯一 UI Provider 的已验证身份范围、原偏好和跨标签去重。[通知文案](src/notifications.ts) · [声音出口](src/sound.ts)

通知铃铛由 [HeaderNotifications](src/features/notifications/HeaderNotifications.tsx) 消费宿主的消息、读状态更新、刷新和详情投影。Rental 组合经 [业务通知适配](../rental-core/admin/browser-notifications/README.md) 读取原待办与事件，并按当前身份重新建立范围。休息计时与播放器由 [RestProvider](src/features/rest/RestProvider.tsx) 按当前租户会话挂载。声音由 [交互监听](src/features/sound/GlobalInteractionSounds.tsx) 和 [结果事件服务](src/features/sound/soundService.ts) 使用本机偏好与同一身份范围。验证入口见[原休息播放器行为](../../tests/admin-rest-player.test.cjs)和[原声音行为](../../tests/admin-sound.test.cjs)。

宿主采用服务端返回的新业务范围后，同步调用 `session.invalidateBusinessScope()`。它中止旧请求、递增会话代次、清除同一查询缓存并通知页面，保留公共登录身份和凭据。已有宿主自行供给 `AdminRuntime` 时，在原切换提交点执行等价的取消、代次、缓存及订阅通知；不要创建第二套缓存。[组合参数](src/application-context.ts) · [范围与路由](src/core/CoreRoutes.tsx) · [公共会话](src/runtime/browser-session.ts)

该应用同时登记 `/invite` 和 `/login/:tenantCode`。公开邀请客户端复用会话创建时的公开 API 基址 `session.apiBaseURL`，与认证请求、租户头和刷新凭据隔离；租户编码只用于表单预填。人员邀请默认提交空业务范围，已有 Rental 宿主从 `/messaging` 提供原经营空间插槽；具体业务授权仍由所属 Core 在原事务裁定。寄件和客服目录按当前集成权限进入，邮件配置目标沿正式公共集成路由。

公共应用在 `/platform/core-packages` 登记 Core 包管理页面和菜单，要求已验证的 SaaS 身份及 `system:tenant:manage` 或 `*`。原后台通过 `/core-packages` 消费同一页面，并传入原品牌解析结果。公共语言 Provider 合并同源包管理词条，页面继续使用宿主唯一 AdminRuntime 和 QueryClient。[页面与操作状态](src/features/core-packages/README.md)

浏览器路径常量及投影类型来自 `platform-core-host` 的三个正式协议子出口。公共、Rental、工单、双 Core 和原 Web 宿主均在 dev、build、lint 前构建 `@rental-os/platform-core-host`，随后按原入口运行。实际 API 对应公共包管理装配，缺实际部署证据或原包材料显示 `unavailable`。[公共 API 接入](../../apps/platform-api/README.md)

已有完整宿主可按下面端口逐层接入。

1. 用 `platformAdminVite()` 的 `plugins`、`postcss`、`alias` 合并宿主 Vite 配置，再按原顺序接 Tailwind 与 React 插件。仅宿主加载环境配置。
2. 入口加载 `@rental-os/platform-admin/styles`。单一 `AdminUiProvider` 提供主题、语言、UI 与同一查询缓存。
3. `AdminRuntimeProvider` 提供 `AdminRuntime`。快照必须稳定，只有原服务端响应可以置 `sessionVerified`。
4. 受控组合调用正式 Core 页面注册函数，将同一注册表传给 `PlatformShell.pages` 和 `createCoreRouteElements`。公共菜单由宿主按原权限提供。
5. 页面通过 `CorePage` 的操作声明复用原主按钮，通过 `useCoreRequest` 消费本 Core 路径和会话/页面围栏。实际例子及 Agent 模板见[五步接入手册](../core-contracts/README.md#五步快速接入)。

CorePage 的 `title`、`summary` 可显示当前受权对象；`actions` 可声明图标、危险程度、等待状态和等待文案，公共按钮继续等待真实Promise并复验当前操作。`RecordDetailLayout` 接收事实、返回回调及可选Core页头，`RecordDetailStack`提供原内容间距。`KanbanBoard`只映射已经获权的数据和业务回调，宿主调用一次 `platformAdminVite()` 即带入保留看板的严格构建适配。实际接入见[Rental养护工单](../rental-core/admin/work-orders/README.md)和[工作台与经营报表](../rental-core/admin/operations/README.md)。

多分区配置页从 `/shell` 复用 `SettingsGroups` 和 `WorkspacePageActions`，由当前页声明配置分组及主操作；内容、保存请求和权限由 Core 提供。治理类页面直接使用 `/ui` 的原导航、日历、通知、安全及团队图标出口，复用同一主题与几何。[外壳出口](src/shell.ts) · [UI 出口](src/components/ui/index.ts)

`CoreAdminPageAction.slot` 省略时进入顶部主操作栏；返回声明 `slot: "navigation"`，刷新等辅助动作声明 `slot: "tools"`。它们共用当前权限、等待状态和卸载保护。页签传入 `CorePage.view`；要把工具放在同一内容行，设置 `toolsPlacement="view"`，无需自行调整页头 CSS。[页面适配](src/core/CorePage.tsx)

使用 `RecordDetailLayout.header` 自定义页头时，第二个参数提供 `actions`、`navigation`、`tools` 三个插槽；原单参数回调仍收到主动作和返回的组合。类型 `RecordDetailHeaderSlots` 从 `/ui` 导出。[详情布局](src/components/RecordDetailLayout.tsx)

需要沿用原详情分组类时，从 `@rental-os/platform-admin/record-detail.module.css` 默认导入原 CSS 模块。该正式出口直接供给 `RecordDetailLayout` 使用的同一文件，会员详情可复用 `disclosure`、`sectionTitle` 和 `stack`。[详情样式](src/components/RecordDetailLayout.module.css) · [包出口](package.json)

面包屑、休息/通知、当前页面主操作和面板收展共用首行，常规首行52px，4px视觉内距计入其中；可选时间在下方独立20px行，`null` / `false` 不留空行。窄屏由公共壳安排操作换行和收展入口，整个页头按内容增高。Core 只声明自己的 `actions`，公共壳负责按钮样式和位置。已有自定义宿主用 `BusinessShell.headerPanelControl` 提供末尾面板入口，`headerActions` 的旧时钟自动移到独立时间行，其余操作保持。[公共壳](src/components/BusinessShell.tsx) · [面板入口](src/components/workspace/WorkspacePanel.tsx)

需要保留原操作的单次提交语义时，使用 `runtime.request<T>(path, { method: "post", data: command, retryAuthentication: false })`。这会禁止401后刷新并重发该请求；普通请求仍沿原规则最多刷新一次。结果不明时调用该Core的原查询或收据接口，不换操作键重发。[请求合同](src/runtime/index.ts) · [唯一执行者](src/runtime/browser-http.ts)

`/forms` 同时提供 `readSettingsReference`、`retainSettingsReference`、`clearSettingsReference` 和对应类型，供页面保留非敏感原操作引用。沿用既有导出名和错误标识；键由业务按当前身份与对象限定，损坏或不可写的存储会阻止新操作，不把本地引用作为权限。[操作引用实现](src/operation-reference.ts)

设置分区从 `/forms` 使用 `SettingsWorkspace`、`SettingsGroups`、`revealSettingsValidation` 和 `SettingsSection` 类型。卡片事实、列表宽度、原图标与 `ListPreflightError` 从 `/ui` 使用。聚合出口再导出同一组件、常量和错误类，隐藏表单校验、预览退出及列表写入前的错误识别沿原实现。[设置分区](src/components/settings/SettingsWorkspace.tsx) · [表单出口](src/forms.ts) · [UI 出口](src/components/ui/index.ts)

订单和经营展示从 `/ui` 使用原动作图标、`ADMIN_TABLE_COLUMN_WIDTH`、`ADMIN_INSIGHT_METRICS`、`AnimatedCountText` 与 `PageEnter`。页面加载复用 `/shell` 的 `LoadingState`。这些入口供给同一常量、数值展示、路由入场和像素网格组件，业务页面保留原参数及动作位置。[UI 出口](src/components/ui/index.ts) · [加载出口](src/shell.ts) · [原路由入场](src/components/workspace/PageEnter.tsx)

已呈现动作的定位标识是 `data-core-page`（当前 `page.key`）与 `data-core-action`（声明的 `action.id`）。深链接必须先映射为本页已登记动作，再用两个值一起查找当前入口；只滚动或聚焦，执行继续等待用户操作。禁用按钮有可聚焦容器，原因沿原Tooltip展示，撤权后不会留下动作入口。[页头动作适配](src/core/CorePage.tsx)

无 Core 时传空注册表，壳保留侧栏、面包屑/页名、铃铛、面板及联系管理员的提示。休息入口向已验证租户会话开放，SaaS 账号隐藏该入口。默认通知为空，不开放通用 Agent。通知内容/详情和可选面板通过宿主端口提供。公共包本身不拥有登录凭据、API 代理或可用权限。

## 来源与验证

原 UIArc 源码仍在 [ui-arc](../ui-arc/README.md)，保留来源与许可。侧栏许可及来源随[实际源码](src/components/animate-sidebar/LICENSE.md)移动；[路由动效来源](src/components/workspace/sources.json)、[休息组件来源](src/features/rest/archive/SOURCE.md)及[看板来源/原hash](src/components/kanban-board/SOURCE.md)保留。

`npm run lint -w @rental-os/platform-admin` 检查源码类型，宿主负责 Vite 产物。只读组件来源核验为 `node scripts/audit-admin-components.cjs --json`。这些命令不证明浏览器、真实 HTTP、数据库保存或独立安装通过。

真实零Core消费者见[公共Web宿主](../../apps/platform-admin/README.md)。新宿主使用 `/forms` 的草稿同步/离页保护及 `/motion` 的启动入口、`usePrefersReducedMotion` 与原 `motionTokens`，同一偏好驱动保留组件。既有 `/source/` 转接路径在 [包配置](package.json) 中逐项映射实际文件及扩展名，TypeScript与Vite均消费同一出口；它们只承担原后台兼容。新业务页面使用正式 `/core`、`/ui` 等出口，统一能力查询不重复列出这些兼容路径。

原消息中心的 CSS 转接也由包配置明确登记，读取同一[通知样式](src/features/notifications/notifications.css)。新宿主仍从 `/styles` 加载公共样式，不复制旧宿主样式或依赖未登记的子路径。

公共应用按当前身份显示“租户 Core 授权”或“成员 Core 分配”。前者只由 SaaS 管理员读取当前部署目录并为租户开通/停用；后者从服务端 `assignable` 选择本租户已获权 Core，不要求管理者先分配给自己。地址参数只定位真实目录对象，缺失对象不挂载命令。提交中的路由/对象切换被阻止，未知结果保留原核对编号；分配与业务角色各自管理，界面可见性不代替服务端权限。

人员、角色和 SaaS 租户沿原列表、行内操作及侧窗维护，旧 `/settings/users/:id` 等地址定位同一目录中的编辑器。租户行操作补“Core 授权”，只把当前真实 `tenantId` 带到 `/platform/core-access?target=<租户ID>` 预选目录；开通仍由授权页重读并单独确认。租户成员 Core 分配保留原 `/settings/member-cores` 受权入口。一次性密码仅在原结果弹窗显示。[管理路由](src/features/access/PublicManagementPages.tsx) · [原账号列表与侧窗](src/features/access/PublicOperationsAccountPage.tsx) · [原租户列表与弹层](src/features/access/PublicTenantManagementPage.tsx) · [授权目录](src/CoreAccessPage.tsx)

资料保存的按钮与回车共用一次请求，结果未确认保留草稿，重新打开前先重读目录。目录显示账号停用、租户冻结/停用及原授权记录，新开通需先恢复账号状态；unknown 按原对象、Core、账号和 `operationId` 核对收据。成员入口消费服务端 `canManageMembers`，候选仍取 `assignable` 或已注册目录。租户、人员和角色目录页的保存、口令重置、角色删除及 Core 开通/分配/绑定显式关闭401刷新重发。其他请求默认允许401后刷新并重发一次，网络和业务错误沿原失败处理。无 Core 时公共资料与角色页照常使用。[面板与原结果](src/core/CoreAccessPanel.tsx) · [单次命令客户端](src/core/management-client.ts)

SaaS“租户管理”读取公共租户目录；创建还须有 `system:tenant:bootstrap` 权限。无 Core 时保留原租户名称、编码及管理员资料表单；所选 Rental 通过 `PublicManagementCoreAdapter` 补回原品类/版本/币种、可选首履约点和经营空间管理，仍由同一原 bootstrap 事务创建。编辑弹窗只修改原租户名称，不清除既有后台简称。状态弹窗保留原目标状态、必填原因及会话撤销说明，恢复租户保留原 Core 授权和成员分配。

[本人资料、账户外观与租户设置](src/SettingsPage.tsx)共用草稿同步和原保存 Promise，其中租户外观携带原 `expectedRevision`。保存显式禁止401后刷新重发；失败保留草稿，重新读取原设置核对后再保存。本人资料的空电话明确清除，人员资料沿原账号表单提交电话字段，处理规则由原管理服务裁定。

“人员管理”和“角色权限”复用公共目录/保存接口；角色权限从实际已登记目录选择，默认新角色为本人数据范围，不采用Rental经营空间默认值。固定管理员角色只读，人员资料保留原角色/组织/管理员字段；一次性创建口令只在当前页显示，不进入缓存或存储。保存与回车共用同一Promise，失败先重读核对，后台刷新保留草稿。权限搜索/对照组件和草稿模型通过 `/access` 正式导出，数据和保存由宿主提供。

公共管理按基础租户成员的完整租户范围识别明确权限或 `*`，当前 Core 的权限不能替代它。新增/编辑成员读取角色选项时，人员管理权和角色管理权任一满足即可；创建、修改及删除角色继续要求角色管理权，提交和返回前由服务端复验。

人员目录保留原“编辑授权”行操作、启停开关和重置密码确认框，当前账号不能在此停用；管理员账号仍由服务端复验权限。所选 Rental 在同一大侧窗中保留账号资料、基础角色及全部空间/地点授权，整体走原 `/platform/users/access` 单事务。普通角色的删除仍明确确认，固定/已分配角色由原服务端拒绝；权限矩阵的隐藏授权、草稿与键盘行为保持原实现。写入不自动重发，已确认结果不被后续目录刷新失败替换，临时密码只留当前弹窗。订阅接入见上方公共模块。

“组织管理”沿 `/settings/organizations` 显示原列表、筛选、编辑及状态控件；受权读取与全租户维护分别判定。“安全基线”沿原 `/platform/system` 提供登录限流、密码策略、脱敏和二次确认设置，保存要求当前 SaaS 身份及参数管理权限。原后台组织页签与安全页复用同一组件，六个请求通过宿主唯一客户端发送。个人改密仍使用“账号安全”。[路由、权限、草稿及接入](src/features/platform-settings/README.md)

“账号安全”让所有已验证账号用当前密码修改本人密码，复用 `/session-pages` 的同一表单和会话端口。首次强制改密仍使用完整面板，公共设置使用嵌入形式；确认输入只参与前端校验，HTTP只发送当前/新密码。草稿和提交中有离开保护，成功清空输入并由原会话轮换更新当前身份，失败保留输入。不在本地存储密码。

“第三方服务”沿原 `/tenant/integrations` 进入。公共应用与原Rental后台共用同一页面；租户平台管理员、明确集成权限或通配权限可见，SaaS账号沿原规则不进入租户配置页。目录、保存及连接测试使用宿主唯一请求入口，供应商可用性与历史配置由服务端裁定。集成双语在公共模块维护，Core无需再复制词条。[页面与请求](src/features/integrations/index.ts) · [公共文案](src/features/integrations/messages.ts)

记录事实和浮层退出可从正式 `/shell` 的 `RecordFacts`、`RecordFact` 及 `/ui` 的 `useModalDismissal` 使用。旧Rental路径已转接这些实际出口，Core作者无需导入兼容源码路径。

“平台工具”沿原 `/platform/tools` 使用 `/platform-tools` 的页面与 `usePlatformToolsTabs`；需要嵌入原页面时复用其页签和结果浮层。`/platform-tools/client` 提供五个原请求方法，消费宿主唯一 HTTP 客户端。字典与编号各自按原权限开放，SaaS 账号不进入租户工具。零 Core 缺省列表为空，可填写首个字典项建立第一组；编号保存省略页面没有编辑控件的当前流水，由服务在锁内保留最新值。取号成功与随后刷新失败分别反馈。[简单接入及表单行为](src/features/platform-tools/README.md)
