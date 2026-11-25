# 原 Agent 工作台与 Copilot

本模块保留原管理后台的 Agent 工作台、导航、聊天与工作区、Copilot 侧栏、上下文选择、报价核对和原订单收据界面。页面结构、文案和样式沿用原实现；业务执行、报价、审批和模型运输仍由原服务端负责。

[组合入口](index.tsx) 的 `createRentalAssistant({ session, useNavigation })` 接收该宿主已经创建的 `RentalBrowserAdminSession`。返回的 `Provider` 只绑定上下文，不创建 DOM 或第二份身份；`CopilotProvider` 与 `OperatorProvider` 必须在同一宿主中各挂一次，保留原 `CopilotProvider → OperatorProvider → 页面` 顺序。`CopilotLayout` 包裹原内容区，`CopilotSection` 继续供给治理、外观等页面的原上下文插槽。

[宿主适配](host.tsx) 复用原 HTTP、会话代次、取消信号和同一个 `AiAdminHost`。导航端口须随实际登记和授权变化更新：

- `routes` 保留完整原页面标识与原路径，包括菜单之外的详情页；这份目录本身不授予访问权。
- `canAccess(route)` 根据当前已登记页面、真实 Core 准入及原用户权限判定。未选装、未登记或撤权均返回 `false`。
- `resolve(originalHref)` 只把原深链接映到当前登记且获权的宿主地址，保留查询参数和片段；无法定位返回 `null`。页面仍沿原 `navigate` 传递会话定位状态。
- `originalPath(currentPathname)` 将当前宿主地址还原成原页面路径，供原上下文捕获、业务锚点和可见性检查使用。

原页面 → [Operator 状态](ai-operator/OperatorContext.tsx)／[Copilot 状态](copilot/CopilotProvider.tsx) → [原会话运输](api/aiConversations.ts) → 原会话、任务和业务 API。显示工件与模型控制通过既有 `ai-native-admin` 接点提供。这里没有新的任务执行器、认证刷新或业务授权。菜单撤回会令保留回调失效并撤下结果；原 unknown 操作键、会话定位和跨标签锁继续由 [NativeOperatorSession](ai-operator/native-session.ts) 与 [CopilotOrderSession](copilot/copilot-order-session.ts) 保管，恢复只核原操作。

[原会话历史](ai-native/ConversationHistory.tsx) 保留默认收起、按需读取与原会话定位；详情、准备、确认、启动和结果仍是原独立步骤。与任务中心共用其目录、读取政策、开业诊断和规则草稿组件，恢复键不加入页面代次。

工厂同时提供 [日历入口](ai-native/CalendarSourceEntry.tsx)、[规则入口](ai-native/RuleSourceEntry.tsx)、[未发送通知草稿](ai-native/NotificationDraftFlow.tsx) 和 [品类助手](ai-native/CategoryAssistFlow.tsx)，供原页面插槽消费。日历与规则使用同一已绑定的任务中心；通知保留租户会员敏感字段权限。品类平台模式读取原 SaaS 身份并允许无经营空间，经营空间模式读取同一租户与空间身份；草稿、发布、政策、准备和采用分别确认，未知结果继续核原操作。

归档组件、动画、CSS 和来源许可保留在 [Agent archive](ai-operator/archive/SOURCE.md) 与 [Copilot archive](copilot/archive/SOURCE.md)。构建宿主必须沿用原 `copilotArchiveStyles` 隔离，识别本模块 `copilot/archive/ai-side-panel/side-panel.css` 的路径，并在业务内容区保留 `data-admin-content` 边界；不得直接把归档全局 reset 应用到业务表单。

[原控制台历史测试](../../../../tests/ai-native-console-history.test.cjs) 检查会话原键、迟到读取、隐藏／卸载、当前菜单撤回、同一运输及原语言显示。此类离线检查不代替正式组合后的浏览器页面、样式和实际权限验收。
