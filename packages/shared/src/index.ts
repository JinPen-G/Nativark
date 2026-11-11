/**
 * 职责：前后端共享契约的公共入口，只做正式再导出，保持消费者的导入路径稳定。
 *
 * 调用方使用 `@rental-os/shared`；模块内部按职责组织，不用深层源码路径绕过出口。
 *
 * 本包同时导出类型、schema、常量与运行时工具，并非纯类型包；只需类型时用 import type。
 * 新增或调整导出须核对生产者、DTO/OpenAPI、各端消费者和构建边界，不把源码与 dist 一致视为当然。
 */
export * from "./agent-desktop";
export * from "./common";
export * from "./core";
export * from "./platform";
export * from "./infrastructure";
export * from "./client";
export * from "./enterprise";
export * from "./enterprise-workflows";
export * from "./enterprise-transfer-decision";
export * from "./enterprise-policy";
export * from "./enterprise-expense";
export * from "./enterprise-exchange";
export * from "./rental-exchange-inspection-preparation";
export * from "./tenant-integrations";
export * from "./workspace-names";
export * from "./rental-rule-defaults";
export * from "./subscription";
export * from "./demo-request";
export * from "./client-rich-text";
export * from "./category-governance";
export * from "./ai-native";
export * from "./ai-catalog-read";
export * from "./ai-order-candidates-draft";
export * from "./ai-extension-preview-http-draft";
export * from "./ai-workbench-display-draft";
export * from "./ai-conversation-draft";
export * from "./ai-task-draft";
export * from "./ai-task-input-draft";
export { AI_TASK_INPUT_DRAFT_SCHEMAS } from "./ai-task-input-draft-schemas";
export * from "./ai-scene-request-draft";
export { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from "./ai-scene-request-draft-schemas";
export * from "./ai-quote-selection-draft";
export { AI_QUOTE_SELECTION_DRAFT_SCHEMAS } from "./ai-quote-selection-draft-schemas";
export * from "./ai-gateway-draft";
export * from "./ai-knowledge-draft";
export * from "./ai-usage-draft";
export * from "./ai-provider-discovery-draft";
export * from "./ai-events-draft";
export * from "./ai-inspection-draft";
export * from "./ai-inspection-persistence";
export * from "./ai-inspection-manual-http-draft";
export * from "./ai-inspection-lifecycle-http-draft";
export { AI_GATEWAY_DRAFT_SCHEMAS } from "./ai-gateway-draft-schemas";
export type { AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
export { AI_KNOWLEDGE_DRAFT_SCHEMAS } from "./ai-knowledge-draft-schemas";
export { AI_USAGE_DRAFT_SCHEMAS } from "./ai-usage-draft-schemas";
export { AI_EVENTS_DRAFT_SCHEMAS } from "./ai-events-draft-schemas";
export { AI_INSPECTION_DRAFT_SCHEMAS } from "./ai-inspection-draft-schemas";
export * from "./ai-proposal-draft";
export { AI_PROPOSAL_DRAFT_SCHEMAS } from "./ai-proposal-draft-schemas";
export * from "./ai-approval-application-draft";
export { AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS } from "./ai-approval-application-draft-schemas";
export * from "./ai-approved-settings-draft";
export { AI_APPROVED_SETTINGS_DRAFT_SCHEMAS } from "./ai-approved-settings-draft-schemas";

export * from "./ai-order-facts-draft";
export { AI_ORDER_FACTS_DRAFT_SCHEMAS } from "./ai-order-facts-draft-schemas";
export { AI_SCOPE_DRAFT_SCHEMAS } from './ai-scope-draft-schemas';
export * from './ai-business-material-draft';
export { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS } from './ai-business-material-draft-schemas';
export * from './ai-order-explanation-http-v2';
export * from './ai-scene-model-observation-draft';
export { AI_SCENE_MODEL_OBSERVATION_SCHEMAS } from './ai-scene-model-observation-draft-schemas';
export * from './ai-task-scene-observation-draft';
export { AI_TASK_SCENE_OBSERVATION_SCHEMAS } from './ai-task-scene-observation-draft-schemas';
export * from './ai-order-read-http-draft';
export * from "./ai-entry-action-draft";
export * from "./ai-booking-draft";
export * from "./ai-booking-validation";
export * from "./ai-knowledge-policy-management-draft";
export { AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS } from "./ai-entry-management-draft-schemas";
export * from "./ai-entry-http-draft";
export * from "./ai-task-recovery-draft";
export * from "./ai-task-observation-draft-schemas";
export * from "./ai-scene-quote-http-draft";
export * from "./ai-scene-quote-validation";
export * from "./ai-client-policy-http-draft";
export * from "./ai-original-policy-http-draft";
export * from "./ai-retention-http-draft";
export * from "./ai-category-draft-http";
export * from "./ai-client-quote-draft";
export * from "./ai-client-quote-booking-draft";
export * from "./ai-client-entry-draft-schemas";
export * from "./ai-knowledge-consumption-http-draft";
export * from "./ai-knowledge-management-http-draft";
export * from "./ai-memory-management-http-draft";
export * from "./ai-budget-management-http-draft";
export * from "./ai-text-capability-http-draft";
export * from "./ai-automation-review-queue-http-draft";
export * from "./ai-automation-review-http-draft";
export * from "./ai-automation-policy-http-draft";
export * from "./ai-automation-event-task-http-draft";
export * from "./ai-task-performance-draft";
export * from "./ai-task-confirmation-history-draft";
export * from "./ai-counting-http-draft";
export * from "./ai-credit";
export * from "./ai-client-entry-http-draft-schemas";
export * from './ai-member-name';

export * from './ai-task-rule-draft';

export * from './ai-task-calendar-draft';
export * from './ai-task-calendar-draft-preparation';

export * from './ai-task-order-handoff';

export * from './ai-task-read-policy';
