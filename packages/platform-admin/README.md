# 公共后台

`@rental-os/platform-admin` 承载原 React/UIArc 后台的真实公共呈现。业务 Core 用 `/core` 声明页面与操作，使用 `/ui` 的表单、列表和反馈。宿主提供已经验证的身份、唯一 HTTP 客户端和查询缓存。公共包不导入 Rental 页面、权限模型、业务 API 或 AI 执行器。

## 阅读路线

| 入口 | 职责与直接消费者 |
| --- | --- |
| [公共应用工厂](src/application.tsx)、[组合参数](src/application-context.ts) | `/application` 为零Core及工单宿主提供同一登录/设置/受保护路由，宿主只传品牌、唯一会话和已登记页面 |
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

真实零Core消费者见[公共Web宿主](../../apps/platform-admin/README.md)。新宿主使用 `/forms` 的草稿同步/离页保护及 `/motion` 启动入口；`/source/*` 仅为既有源码兼容转接，新业务页面使用正式 `/core`、`/ui` 等出口。
