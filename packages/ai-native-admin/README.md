# AI Native 后台呈现

本包承接原管理后台已支持的 AI 工作台组件、交互与样式。原页面通过相同实现接入，宿主显式选用；公共零 Core 应用不静态加载此包。订单、报价、会员及品类事实和业务呈现仍归对应 Core。

## 接入边界

- `@rental-os/ai-native-admin/workbench` 对应 [工作台出口](src/workbench.ts)，复用原任务列表、详情、表单、知识来源、记忆、取消和动态展示。
- `@rental-os/ai-native-admin/host` 对应 [宿主端口](src/host.tsx)，使用既有 `AdminRuntime`、当前主体和明确任务/模型控制端口；不创建会话、查询缓存、模型或第二条业务执行链。
- `@rental-os/ai-native-admin/source/api/aiTaskCenter`、`/source/api/aiModelControl`、`/source/api/aiRequestTiming` 分别对应同名 `src/api/*.ts`，原 API 兼容入口消费同一实现。
- 原路径逐项转接 `@rental-os/ai-native-admin/source/ai-native/<原文件名>`。原操作、权限、展示生命周期与 unknown 恢复语义不因迁移改变。
- Rental 的订单事实入口位于 [Rental 业务适配](../rental-core/admin/ai/OrderFactsEntry.tsx)，通过 `createRentalBrowserAdminHost({ OrderFactsEntry })` 进入两种 Rental 宿主；该组件沿当前订单上下文消费正式请求。

## 原合同的窄出口

生产消费者使用 `@rental-os/shared/ai-admin`，仅转出以下原声明和运行值。不能复制 DTO，也不能用 `@rental-os/shared` 总出口替代窄入口。包配置、出口与所选宿主由组合方维护。首片的 62 个符号如下，类型与值以原声明为准。

| 符号 | 原声明 |
| --- | --- |
| `AI_CONVERSATION_HTTP_DRAFT` | [packages/shared/src/ai-conversation-draft.ts](../shared/src/ai-conversation-draft.ts) |
| `AI_PROPOSAL_DRAFT_VERSION` | [packages/shared/src/ai-proposal-draft.ts](../shared/src/ai-proposal-draft.ts) |
| `AI_SCENE_REQUEST_DRAFT_VERSION` | [packages/shared/src/ai-scene-request-draft.ts](../shared/src/ai-scene-request-draft.ts) |
| `AI_STEP_STATUSES_DRAFT` | [packages/platform-contracts/src/ai-task.ts](../platform-contracts/src/ai-task.ts) |
| `AI_TASK_CENTER_HTTP_DRAFT` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AI_TASK_DRAFT_VERSION` | [packages/platform-contracts/src/ai-task.ts](../platform-contracts/src/ai-task.ts) |
| `AI_TASK_STATUSES_DRAFT` | [packages/platform-contracts/src/ai-task.ts](../platform-contracts/src/ai-task.ts) |
| `AI_WORKBENCH_CONTEXT_DRAFT_VERSION` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AI_WORKBENCH_DISPLAY_DRAFT_VERSION` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS` | [packages/shared/src/ai-workbench-display-http-draft.ts](../shared/src/ai-workbench-display-http-draft.ts) |
| `AI_WORKBENCH_DISPLAY_LIMITS` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AI_WORKBENCH_MODEL_CONTROL_SCHEMAS` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AI_WORKBENCH_MODEL_CONTROL_VERSION` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiApprovalApplicationReferenceDraft` | [packages/shared/src/ai-approval-application-draft.ts](../shared/src/ai-approval-application-draft.ts) |
| `AiGatewayCapabilityAssessmentDraft` | [packages/platform-contracts/src/ai-gateway-draft.ts](../platform-contracts/src/ai-gateway-draft.ts) |
| `AiTaskBudgetUsagePageDraft` | [packages/shared/src/ai-scene-request-draft.ts](../shared/src/ai-scene-request-draft.ts) |
| `AiTaskBudgetUsageSummaryDraft` | [packages/shared/src/ai-scene-request-draft.ts](../shared/src/ai-scene-request-draft.ts) |
| `AiTaskBusinessObservationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskClarificationAnswerDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskClarificationObservationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskClarificationProgressDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskClarificationReceiptQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskClientVisibleReceiptDraft` | [packages/shared/src/ai-task-performance-draft.ts](../shared/src/ai-task-performance-draft.ts) |
| `AiTaskClientVisibleReportDraft` | [packages/shared/src/ai-task-performance-draft.ts](../shared/src/ai-task-performance-draft.ts) |
| `AiTaskClientVisibleSourceDraft` | [packages/shared/src/ai-task-performance-draft.ts](../shared/src/ai-task-performance-draft.ts) |
| `AiTaskConfirmationHistoryDraft` | [packages/shared/src/ai-task-confirmation-history-draft.ts](../shared/src/ai-task-confirmation-history-draft.ts) |
| `AiTaskDecisionQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskEventPageDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskEventResetDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskHumanContinuationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskHumanContinueDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskHumanDecisionReceiptDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskHumanReviewDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskInputAnswerDraft` | [packages/shared/src/ai-task-input-draft.ts](../shared/src/ai-task-input-draft.ts) |
| `AiTaskInputFieldDraft` | [packages/shared/src/ai-task-input-draft.ts](../shared/src/ai-task-input-draft.ts) |
| `AiTaskMetadataPageDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskMetadataQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskModelObservationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskModelSourceObservationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskModelSourceQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskOutcomeSampleDraft` | [packages/shared/src/ai-task-performance-draft.ts](../shared/src/ai-task-performance-draft.ts) |
| `AiTaskPerformanceObservationDraft` | [packages/shared/src/ai-task-performance-draft.ts](../shared/src/ai-task-performance-draft.ts) |
| `AiTaskReviewQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskSnapshotDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskStopObservationDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTaskStopQueryDraft` | [packages/shared/src/ai-task-draft.ts](../shared/src/ai-task-draft.ts) |
| `AiTenantModelSettingsSummaryDraft` | [packages/shared/src/ai-usage-draft.ts](../shared/src/ai-usage-draft.ts) |
| `AiWorkbenchAuthoritativeSummaryDraft` | [packages/shared/src/ai-workbench-display-http-draft.ts](../shared/src/ai-workbench-display-http-draft.ts) |
| `AiWorkbenchContextDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchDisplayBindingDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchFieldMaterialDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchHostDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchModelControlCommand` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiWorkbenchModelControlKind` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiWorkbenchModelControlObservation` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiWorkbenchModelControlPreparation` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiWorkbenchModelControlReference` | [packages/shared/src/ai-workbench-model-control-draft.ts](../shared/src/ai-workbench-model-control-draft.ts) |
| `AiWorkbenchMountBindingDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchPresentationDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `AiWorkbenchSandboxMessageDraft` | [packages/shared/src/ai-workbench-display-draft.ts](../shared/src/ai-workbench-display-draft.ts) |
| `isAiTaskInputContractDraft` | [packages/shared/src/ai-task-input-draft.ts](../shared/src/ai-task-input-draft.ts) |
| `validateAiTaskInputAnswersDraft` | [packages/shared/src/ai-task-input-draft.ts](../shared/src/ai-task-input-draft.ts) |

`AI_TASK_DRAFT_VERSION`、`AI_TASK_STATUSES_DRAFT`、`AI_STEP_STATUSES_DRAFT` 由原 `shared/ai-task-draft` 再导出公共 `platform-contracts/ai-task` 同值；`AiGatewayCapabilityAssessmentDraft` 可直接从公共 `platform-contracts/ai-gateway` 导出。不要引入 Rental 根包运行时或服务端模块来取得类型。

## 来源与验收

原 UIArc 组件与主题继续消费 `@rental-os/platform-admin`；不得改 vendor。原 Operator/Copilot 归档、SOURCE 和许可保持原位与原字节，具体后续贡献必须保持同源。必要类型与离线行为核对不代表真实浏览器、模型、数据库或发布验收。

## 组合原平台模型配置

[平台模型配置模块](src/platform-model-settings/README.md)复用原模型目录、编辑、原操作收据和能力证据。选装公共 SaaS 模型设置的宿主从 `@rental-os/ai-native-admin/platform-model-settings/public-application` 使用 [createPublicPlatformModelSettingsPage(runtime)](src/public-platform-application.tsx)，将返回组件传给现有 `platformAiPage`。同一 `runtime` 来自宿主已经验证的会话，不另外登录或建缓存。该页面通过[公共设置服务](../ai-native-server/src/public-platform-model-settings.ts)读取 `platform/ai/providers` 的五条原路由。

[原完整组合](src/platform-application.tsx)继续使用 `createPlatformModelSettingsPage(runtime)`，从相同模型配置视图插入原预算、费率和额度办理。模型配置合同来自 [platform-contracts/ai-usage](../platform-contracts/src/ai-usage.ts)，原完整组合继续消费原财务合同。入口需实际服务器完成数据选择、当前角色及对应配置授权。

[公共源码发行清单](package.public.json)包含原模型、费率、预算和额度页的源码、样式及原请求器。宿主登记[公共财务模块](../ai-native-server/src/public-platform-finance.ts)后，使用 `createPublicPlatformModelSettingsPage(session.runtime, { finance: true })` 选装原财务入口。使用[公共装包入口](../ai-native-server/public-package.cjs)取其闭包，由公共后台原构建消费。[公共安装说明](README.public.md)
