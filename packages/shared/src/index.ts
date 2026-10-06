/**
 * 前后端共享契约的**唯一入口**。
 *
 * 本文件刻意只做再导出：所有引用方写 `@rental-os/shared`，
 * 声明搬到哪个域文件都不影响它们，因此拆分可以继续做而不引发一次大改。
 *
 * 依赖方向全部是 `import type`，运行时零耦合：
 *   infrastructure → platform → core，core → platform 只取一个类型。
 */
export * from "./common";
export * from "./core";
export * from "./platform";
export * from "./infrastructure";
export * from "./client";
export * from "./tenant-integrations";
export * from "./workspace-names";
export * from "./rental-rule-defaults";
export * from "./subscription";
export * from "./demo-request";
export * from "./client-rich-text";
export * from "./category-governance";
export * from "./ai-native";
export * from "./ai-task-draft";
export * from "./ai-task-input-draft";
export { AI_TASK_INPUT_DRAFT_SCHEMAS } from "./ai-task-input-draft-schemas";
export * from "./ai-gateway-draft";
export * from "./ai-knowledge-draft";
export * from "./ai-usage-draft";
export * from "./ai-events-draft";
export * from "./ai-inspection-draft";
export { AI_GATEWAY_DRAFT_SCHEMAS } from "./ai-gateway-draft-schemas";
export { AI_KNOWLEDGE_DRAFT_SCHEMAS } from "./ai-knowledge-draft-schemas";
export { AI_USAGE_DRAFT_SCHEMAS } from "./ai-usage-draft-schemas";
export { AI_EVENTS_DRAFT_SCHEMAS } from "./ai-events-draft-schemas";
export { AI_INSPECTION_DRAFT_SCHEMAS } from "./ai-inspection-draft-schemas";
export * from "./ai-proposal-draft";
export { AI_PROPOSAL_DRAFT_SCHEMAS } from "./ai-proposal-draft-schemas";

export * from "./ai-order-facts-draft";
export { AI_ORDER_FACTS_DRAFT_SCHEMAS } from "./ai-order-facts-draft-schemas";
