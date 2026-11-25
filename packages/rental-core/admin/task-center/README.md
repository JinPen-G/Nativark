# Rental 任务中心

本模块保留原任务中心及 Rental 规则、日历、开业、会员、通知和经营待办页面。只组装原业务消费者，不创建认证会话、业务权限、模型调用或第二套任务执行器。

## 入口与宿主

[入口](index.ts)导出 [TaskCenterPage](TaskCenterPage.tsx) 和[原请求端口组装](runtime.ts)。宿主先用同一个 RentalBrowserAdminSession 创建 [Rental 助手上下文](../assistant/host.tsx)，再由已有 RentalAssistantHost 包裹页面；本模块通过 useRentalAssistant 复用其请求、会话代次、取消信号和当前登记导航。Core 路由、菜单及权限仍由宿主登记。旧组合后台沿[原路由](../../../../apps/admin/src/app/AppRouter.tsx)和[原助手适配](../../../../apps/admin/src/features/ai-operator/legacy-host.tsx)消费下表中的窄入口。

通用 AI 工作台、管理语言、样式、原任务读取契约和模型操作继续来自 [ai-native-admin](../../../ai-native-admin/README.md) 正式出口；公共 AI 包不反向导入 Rental。九个对话页面及订单交接仍属于 [assistant](../assistant/host.tsx)，任务中心与它们共用同一上下文。

## 页面与原业务链

| 页面或片段 | 职责 |
| --- | --- |
| [AutomationExplanation](AutomationExplanation.tsx) | 原待办解释与只读事实 |
| [AutomationPolicySettings](AutomationPolicySettings.tsx) | 自动化政策原确认、保存及恢复 |
| [AutomationRefundRecords](AutomationRefundRecords.tsx) | 退款原记录与核对入口 |
| [AutomationReviewSection](AutomationReviewSection.tsx) | 经营待办分区与登记导航 |
| [AutomationReviewWorkbench](AutomationReviewWorkbench.tsx) | 经营待办原授权和任务准备 |
| [BusinessOutboxObservation](BusinessOutboxObservation.tsx) | 业务失败待发箱只读观察 |
| [CalendarDraftPreparation](CalendarDraftPreparation.tsx) | 日历草稿原准备和恢复 |
| [EntrySceneCatalog](EntrySceneCatalog.tsx) | 原场景目录与可见范围 |
| [MemberNameFlow](MemberNameFlow.tsx) | 会员姓名原提案和再确认 |
| [NotificationChangeFlow](NotificationChangeFlow.tsx) | 通知配置原提案和再确认 |
| [OpeningIntegrationStatus](OpeningIntegrationStatus.tsx) | 开业集成状态纯展示 |
| [ReadinessDiagnosticsCard](ReadinessDiagnosticsCard.tsx) | 原开业诊断及九分区人工入口 |
| [TaskCalendarDraft](TaskCalendarDraft.tsx) | 原任务日历材料与草稿 |
| [TaskCenterPage](TaskCenterPage.tsx) | 列表、筛选、分页、历史及任务详情 |
| [TaskFaultObservation](TaskFaultObservation.tsx) | 原错误、限流和外部结果观察 |
| [TaskOpeningProposals](TaskOpeningProposals.tsx) | 开业分区候选、差异与原提案恢复 |
| [TaskOutcomeObservation](TaskOutcomeObservation.tsx) | 原任务结果与依据观察 |
| [TaskReadPolicy](TaskReadPolicy.tsx) | 原任务读取政策确认及回读 |
| [TaskRecovery](TaskRecovery.tsx) | 原任务取消、继续、接管及原收据定位 |
| [TaskRuleDraft](TaskRuleDraft.tsx) | 原任务规则材料与草稿准备 |
| [TaskRuleDraftView](TaskRuleDraftView.tsx) | 规则差异纯展示 |
| [TaskUsageObservation](TaskUsageObservation.tsx) | 原用量、计费和运行时序观察 |

页面 → 同目录原 session/reader → [API 工厂](api/aiTaskRecovery.ts)及 runtime → 原 HTTP Controller、Guard、ALS 和业务服务。规则与日历仍读取原引用和历史材料，准备、批准、提交与原收据读取各自保留。会员、通知入口继续由[会员模块上下文](../membership/page-context.tsx)和原业务消费者约束；本模块不会扩大跨空间或租户会员权限。

[任务中心](TaskCenterPage.tsx)保留原筛选、日期、游标、折叠和明确启动的有界跟随；对话历史日志键仍只含租户、空间与用户 ID，外层当前会话另查代次。切换任务、会话失效、隐藏页面或撤权时，旧读取和旧事实按原流程撤回。unknown 只读同一原操作，不更换操作键或自动重发写请求。

[经营待办导航](automation-original-navigation.ts)只消费宿主登记与当前授权：订单和检查进入原订单详情，仅退款可回退对账；通知进入原通知配置，普通配置进入开业页。原 ID、租户、空间、人员、audience 和取消检查全部保留。[开业诊断](ReadinessDiagnosticsCard.tsx)保留九分区、账号不可用时的角色入口、会员分区原普通权限及当前登记检查；导航前仍重读并比较原事实。纯 data 诊断展示不要求助手 Provider。

API 工厂绑定同一 session，不新建客户端。除下表 12 份 API 外，[场景目录 reader](entry-scene-catalog-api.ts)和开业诊断中的原场景 POST 也复用该运输；路径、DTO、超时、取消、认证重试边界和原操作恢复均由原调用保留。

## 原路径到唯一实现

以下是 50 份原文件的完整映射：22 份 TSX、16 份状态或读取辅助、12 份 API。旧路径只做公共出口、同会话绑定及原可选参数兼容，不保留第二份正文。

| 原路径 | 唯一实现 |
| --- | --- |
| [apps/admin/src/features/ai-native/AutomationExplanation.tsx](../../../../apps/admin/src/features/ai-native/AutomationExplanation.tsx) | [packages/rental-core/admin/task-center/AutomationExplanation.tsx](AutomationExplanation.tsx) |
| [apps/admin/src/features/ai-native/AutomationPolicySettings.tsx](../../../../apps/admin/src/features/ai-native/AutomationPolicySettings.tsx) | [packages/rental-core/admin/task-center/AutomationPolicySettings.tsx](AutomationPolicySettings.tsx) |
| [apps/admin/src/features/ai-native/AutomationRefundRecords.tsx](../../../../apps/admin/src/features/ai-native/AutomationRefundRecords.tsx) | [packages/rental-core/admin/task-center/AutomationRefundRecords.tsx](AutomationRefundRecords.tsx) |
| [apps/admin/src/features/ai-native/AutomationReviewSection.tsx](../../../../apps/admin/src/features/ai-native/AutomationReviewSection.tsx) | [packages/rental-core/admin/task-center/AutomationReviewSection.tsx](AutomationReviewSection.tsx) |
| [apps/admin/src/features/ai-native/AutomationReviewWorkbench.tsx](../../../../apps/admin/src/features/ai-native/AutomationReviewWorkbench.tsx) | [packages/rental-core/admin/task-center/AutomationReviewWorkbench.tsx](AutomationReviewWorkbench.tsx) |
| [apps/admin/src/features/ai-native/BusinessOutboxObservation.tsx](../../../../apps/admin/src/features/ai-native/BusinessOutboxObservation.tsx) | [packages/rental-core/admin/task-center/BusinessOutboxObservation.tsx](BusinessOutboxObservation.tsx) |
| [apps/admin/src/features/ai-native/CalendarDraftPreparation.tsx](../../../../apps/admin/src/features/ai-native/CalendarDraftPreparation.tsx) | [packages/rental-core/admin/task-center/CalendarDraftPreparation.tsx](CalendarDraftPreparation.tsx) |
| [apps/admin/src/features/ai-native/EntrySceneCatalog.tsx](../../../../apps/admin/src/features/ai-native/EntrySceneCatalog.tsx) | [packages/rental-core/admin/task-center/EntrySceneCatalog.tsx](EntrySceneCatalog.tsx) |
| [apps/admin/src/features/ai-native/MemberNameFlow.tsx](../../../../apps/admin/src/features/ai-native/MemberNameFlow.tsx) | [packages/rental-core/admin/task-center/MemberNameFlow.tsx](MemberNameFlow.tsx) |
| [apps/admin/src/features/ai-native/NotificationChangeFlow.tsx](../../../../apps/admin/src/features/ai-native/NotificationChangeFlow.tsx) | [packages/rental-core/admin/task-center/NotificationChangeFlow.tsx](NotificationChangeFlow.tsx) |
| [apps/admin/src/features/ai-native/OpeningIntegrationStatus.tsx](../../../../apps/admin/src/features/ai-native/OpeningIntegrationStatus.tsx) | [packages/rental-core/admin/task-center/OpeningIntegrationStatus.tsx](OpeningIntegrationStatus.tsx) |
| [apps/admin/src/features/ai-native/ReadinessDiagnosticsCard.tsx](../../../../apps/admin/src/features/ai-native/ReadinessDiagnosticsCard.tsx) | [packages/rental-core/admin/task-center/ReadinessDiagnosticsCard.tsx](ReadinessDiagnosticsCard.tsx) |
| [apps/admin/src/features/ai-native/TaskCalendarDraft.tsx](../../../../apps/admin/src/features/ai-native/TaskCalendarDraft.tsx) | [packages/rental-core/admin/task-center/TaskCalendarDraft.tsx](TaskCalendarDraft.tsx) |
| [apps/admin/src/features/ai-native/TaskCenterPage.tsx](../../../../apps/admin/src/features/ai-native/TaskCenterPage.tsx) | [packages/rental-core/admin/task-center/TaskCenterPage.tsx](TaskCenterPage.tsx) |
| [apps/admin/src/features/ai-native/TaskFaultObservation.tsx](../../../../apps/admin/src/features/ai-native/TaskFaultObservation.tsx) | [packages/rental-core/admin/task-center/TaskFaultObservation.tsx](TaskFaultObservation.tsx) |
| [apps/admin/src/features/ai-native/TaskOpeningProposals.tsx](../../../../apps/admin/src/features/ai-native/TaskOpeningProposals.tsx) | [packages/rental-core/admin/task-center/TaskOpeningProposals.tsx](TaskOpeningProposals.tsx) |
| [apps/admin/src/features/ai-native/TaskOutcomeObservation.tsx](../../../../apps/admin/src/features/ai-native/TaskOutcomeObservation.tsx) | [packages/rental-core/admin/task-center/TaskOutcomeObservation.tsx](TaskOutcomeObservation.tsx) |
| [apps/admin/src/features/ai-native/TaskReadPolicy.tsx](../../../../apps/admin/src/features/ai-native/TaskReadPolicy.tsx) | [packages/rental-core/admin/task-center/TaskReadPolicy.tsx](TaskReadPolicy.tsx) |
| [apps/admin/src/features/ai-native/TaskRecovery.tsx](../../../../apps/admin/src/features/ai-native/TaskRecovery.tsx) | [packages/rental-core/admin/task-center/TaskRecovery.tsx](TaskRecovery.tsx) |
| [apps/admin/src/features/ai-native/TaskRuleDraft.tsx](../../../../apps/admin/src/features/ai-native/TaskRuleDraft.tsx) | [packages/rental-core/admin/task-center/TaskRuleDraft.tsx](TaskRuleDraft.tsx) |
| [apps/admin/src/features/ai-native/TaskRuleDraftView.tsx](../../../../apps/admin/src/features/ai-native/TaskRuleDraftView.tsx) | [packages/rental-core/admin/task-center/TaskRuleDraftView.tsx](TaskRuleDraftView.tsx) |
| [apps/admin/src/features/ai-native/TaskUsageObservation.tsx](../../../../apps/admin/src/features/ai-native/TaskUsageObservation.tsx) | [packages/rental-core/admin/task-center/TaskUsageObservation.tsx](TaskUsageObservation.tsx) |
| [apps/admin/src/features/ai-native/automation-original-navigation.ts](../../../../apps/admin/src/features/ai-native/automation-original-navigation.ts) | [packages/rental-core/admin/task-center/automation-original-navigation.ts](automation-original-navigation.ts) |
| [apps/admin/src/features/ai-native/automation-policy-session.ts](../../../../apps/admin/src/features/ai-native/automation-policy-session.ts) | [packages/rental-core/admin/task-center/automation-policy-session.ts](automation-policy-session.ts) |
| [apps/admin/src/features/ai-native/automation-review-session.ts](../../../../apps/admin/src/features/ai-native/automation-review-session.ts) | [packages/rental-core/admin/task-center/automation-review-session.ts](automation-review-session.ts) |
| [apps/admin/src/features/ai-native/entry-scene-catalog-api.ts](../../../../apps/admin/src/features/ai-native/entry-scene-catalog-api.ts) | [packages/rental-core/admin/task-center/entry-scene-catalog-api.ts](entry-scene-catalog-api.ts) |
| [apps/admin/src/features/ai-native/member-name-reconfirmation.ts](../../../../apps/admin/src/features/ai-native/member-name-reconfirmation.ts) | [packages/rental-core/admin/task-center/member-name-reconfirmation.ts](member-name-reconfirmation.ts) |
| [apps/admin/src/features/ai-native/member-name-session.ts](../../../../apps/admin/src/features/ai-native/member-name-session.ts) | [packages/rental-core/admin/task-center/member-name-session.ts](member-name-session.ts) |
| [apps/admin/src/features/ai-native/notification-change-session.ts](../../../../apps/admin/src/features/ai-native/notification-change-session.ts) | [packages/rental-core/admin/task-center/notification-change-session.ts](notification-change-session.ts) |
| [apps/admin/src/features/ai-native/notification-reconfirmation.ts](../../../../apps/admin/src/features/ai-native/notification-reconfirmation.ts) | [packages/rental-core/admin/task-center/notification-reconfirmation.ts](notification-reconfirmation.ts) |
| [apps/admin/src/features/ai-native/original-reconfirmation-journal.ts](../../../../apps/admin/src/features/ai-native/original-reconfirmation-journal.ts) | [packages/rental-core/admin/task-center/original-reconfirmation-journal.ts](original-reconfirmation-journal.ts) |
| [apps/admin/src/features/ai-native/original-reconfirmation-session.ts](../../../../apps/admin/src/features/ai-native/original-reconfirmation-session.ts) | [packages/rental-core/admin/task-center/original-reconfirmation-session.ts](original-reconfirmation-session.ts) |
| [apps/admin/src/features/ai-native/readiness-diagnostics.ts](../../../../apps/admin/src/features/ai-native/readiness-diagnostics.ts) | [packages/rental-core/admin/task-center/readiness-diagnostics.ts](readiness-diagnostics.ts) |
| [apps/admin/src/features/ai-native/task-calendar-draft-session.ts](../../../../apps/admin/src/features/ai-native/task-calendar-draft-session.ts) | [packages/rental-core/admin/task-center/task-calendar-draft-session.ts](task-calendar-draft-session.ts) |
| [apps/admin/src/features/ai-native/task-opening-proposal-session.ts](../../../../apps/admin/src/features/ai-native/task-opening-proposal-session.ts) | [packages/rental-core/admin/task-center/task-opening-proposal-session.ts](task-opening-proposal-session.ts) |
| [apps/admin/src/features/ai-native/task-read-policy-session.ts](../../../../apps/admin/src/features/ai-native/task-read-policy-session.ts) | [packages/rental-core/admin/task-center/task-read-policy-session.ts](task-read-policy-session.ts) |
| [apps/admin/src/features/ai-native/task-recovery-session.ts](../../../../apps/admin/src/features/ai-native/task-recovery-session.ts) | [packages/rental-core/admin/task-center/task-recovery-session.ts](task-recovery-session.ts) |
| [apps/admin/src/features/ai-native/task-rule-draft-session.ts](../../../../apps/admin/src/features/ai-native/task-rule-draft-session.ts) | [packages/rental-core/admin/task-center/task-rule-draft-session.ts](task-rule-draft-session.ts) |
| [apps/admin/src/api/aiAutomationExplanations.ts](../../../../apps/admin/src/api/aiAutomationExplanations.ts) | [packages/rental-core/admin/task-center/api/aiAutomationExplanations.ts](api/aiAutomationExplanations.ts) |
| [apps/admin/src/api/aiAutomationOriginalRefunds.ts](../../../../apps/admin/src/api/aiAutomationOriginalRefunds.ts) | [packages/rental-core/admin/task-center/api/aiAutomationOriginalRefunds.ts](api/aiAutomationOriginalRefunds.ts) |
| [apps/admin/src/api/aiAutomationPolicies.ts](../../../../apps/admin/src/api/aiAutomationPolicies.ts) | [packages/rental-core/admin/task-center/api/aiAutomationPolicies.ts](api/aiAutomationPolicies.ts) |
| [apps/admin/src/api/aiAutomationReviews.ts](../../../../apps/admin/src/api/aiAutomationReviews.ts) | [packages/rental-core/admin/task-center/api/aiAutomationReviews.ts](api/aiAutomationReviews.ts) |
| [apps/admin/src/api/aiMemberName.ts](../../../../apps/admin/src/api/aiMemberName.ts) | [packages/rental-core/admin/task-center/api/aiMemberName.ts](api/aiMemberName.ts) |
| [apps/admin/src/api/aiNotificationChanges.ts](../../../../apps/admin/src/api/aiNotificationChanges.ts) | [packages/rental-core/admin/task-center/api/aiNotificationChanges.ts](api/aiNotificationChanges.ts) |
| [apps/admin/src/api/aiOpeningDiagnostics.ts](../../../../apps/admin/src/api/aiOpeningDiagnostics.ts) | [packages/rental-core/admin/task-center/api/aiOpeningDiagnostics.ts](api/aiOpeningDiagnostics.ts) |
| [apps/admin/src/api/aiTaskCalendarDraft.ts](../../../../apps/admin/src/api/aiTaskCalendarDraft.ts) | [packages/rental-core/admin/task-center/api/aiTaskCalendarDraft.ts](api/aiTaskCalendarDraft.ts) |
| [apps/admin/src/api/aiTaskOpeningProposals.ts](../../../../apps/admin/src/api/aiTaskOpeningProposals.ts) | [packages/rental-core/admin/task-center/api/aiTaskOpeningProposals.ts](api/aiTaskOpeningProposals.ts) |
| [apps/admin/src/api/aiTaskReadPolicy.ts](../../../../apps/admin/src/api/aiTaskReadPolicy.ts) | [packages/rental-core/admin/task-center/api/aiTaskReadPolicy.ts](api/aiTaskReadPolicy.ts) |
| [apps/admin/src/api/aiTaskRecovery.ts](../../../../apps/admin/src/api/aiTaskRecovery.ts) | [packages/rental-core/admin/task-center/api/aiTaskRecovery.ts](api/aiTaskRecovery.ts) |
| [apps/admin/src/api/aiTaskRuleDraft.ts](../../../../apps/admin/src/api/aiTaskRuleDraft.ts) | [packages/rental-core/admin/task-center/api/aiTaskRuleDraft.ts](api/aiTaskRuleDraft.ts) |

## 消费者与验证入口

[ConversationDetail](../assistant/ai-native/ConversationDetail.tsx)使用原开业诊断和读取政策，[ConversationOpeningExecution](../assistant/ai-native/ConversationOpeningExecution.tsx)消费原规则草稿；[EntrySceneCatalog](EntrySceneCatalog.tsx)供原助手场景入口复用。规则、日历及会员的旧正式消费者通过下表原入口继续获得原事实、权限和状态机。

必要类型检查使用既有 [check-selected-prisma-types](../../../../scripts/check-selected-prisma-types.cjs) 与 [admin 实际配置](../tsconfig.json)。定向行为复用 [B10 任务观察与工作台](../../../../tests/ai-native-b10-workbench.test.cjs)、[任务恢复](../../../../tests/ai-native-task-recovery.test.cjs)和[开业材料消费](../../../../tests/ai-native-lane-a-opening-consumption.test.cjs)等原入口。源码、类型和离线冒烟不能替代当前宿主页面、真实数据库及外部服务验收。
