/**
 * AIN-02/S01 · C01/C02 草案，不是运行授权或可执行工具目录。
 * 身份由服务端建立；类型/schema 合法不代表资源可访问。AIN-04 必须在每步及结果重放前重验授权。
 * 未冻结：不注册 HTTP 路由、handler、模型或 Worker；具体业务投影在后续切片定义。
 */
export { AI_CONTRACT_DRAFT_VERSION } from "@rental-os/platform-contracts/ai-gateway";
export type { AiAudience, AiPlatformScope, AiTenantScope, AiWorkspaceScope, AiExecutionScope, AiLocationScope, AiOperatorAccess, AiContextBase, AiExecutionContext } from "@rental-os/platform-contracts/ai-gateway";
import { AI_CONTRACT_DRAFT_VERSION, type AiAudience, type AiExecutionScope } from "@rental-os/platform-contracts/ai-gateway";
import { AI_TOOL_DRAFT_VERSION, type AiErrorCode, type AiToolError } from '@rental-os/platform-contracts/ai-task';
export { AI_TOOL_DRAFT_VERSION, AI_ERROR_CODES } from '@rental-os/platform-contracts/ai-task';
export type { AiFactReference, AiErrorCode, AiRecoveryAction, AiToolError } from '@rental-os/platform-contracts/ai-task';
export const AI_TOOL_CODES = Object.freeze([
  "rental.order.explain", "rental.catalog.search", "rental.availability.check",
  "membership.customer.resolve", "rental.quote.preview", "rental.order.propose",
  "rental.order.commit", "rental.change.preview", "tenant.opening.diagnose",
  "tenant.config.propose", "tenant.notifications.commit", "membership.profile.propose", "membership.profile.commit", "inspection.draft.extract",
  "operations.risks.list", "platform.category.propose"
] as const);
export type AiToolCode = typeof AI_TOOL_CODES[number];
export type AiRisk = "R0" | "R1" | "R2" | "R3";
export type AiToolMaturity = "unavailable" | "preview_only" | "executable";

/** 模型侧最小输入示例；orderId 仍须按当前会话与资源归属核验。不是通用执行代理。 */
export interface AiOrderExplainInput {
  orderId: string;
}
export interface AiOrderExplainRequestDraft {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  toolCode: "rental.order.explain";
  toolVersion: typeof AI_TOOL_DRAFT_VERSION;
  input: AiOrderExplainInput;
}

export type AiAuthorizationCheck =
  | "current_identity" | "audience" | "scope" | "membership" | "permission"
  | "data_scope" | "location_scope" | "resource_ownership" | "field_visibility"
  | "capability" | "subscription" | "controller_preconditions";

/**
 * 工具契约的描述格式，不包含函数名加载/SQL/URL/终端能力。
 * 初始草案强制 unavailable，不能通过写入一个 executable 字段开放工具。
 * schema ID 只是文档关联；后续执行层必须解析到已验证的严格 schema，不能按名字猜测。
 */
export interface AiToolContractDraft {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  contractStatus: "draft";
  code: AiToolCode;
  version: typeof AI_TOOL_DRAFT_VERSION;
  description: string;
  aiMaturity: Extract<AiToolMaturity, "unavailable">;
  businessMaturity: "implemented" | "preview_only" | "not_implemented";
  risk: AiRisk;
  audiences: AiAudience[];
  scopeKinds: AiExecutionScope["kind"][];
  /** 原路由的 any-of 仅是第一道候选检查，不能替代下面的附加授权。 */
  permissionAnyOf: string[];
  authorization: "revalidate_each_step_and_replay";
  additionalChecks: AiAuthorizationCheck[];
  capabilityCodes: string[];
  subscriptionFeatures: string[];
  inputSchemaId: string;
  outputSchemaId: string;
  preconditions: string[];
  sideEffects: string[];
  redactionRules: string[];
  limits: { maxResults: number; timeoutMs: number; maxAttempts: number };
  idempotency: "read_only" | "business_action" | "proposal_revision" | "pending";
  retry: "no_retry" | "bounded_read" | "reconcile_before_retry";
  resultChecks: string[];
  manualExit: string;
  ownerModule: string;
  blockers: string[];
}

/** 结果未知不是失败后可直接重试；必须先核对已发生的业务副作用。 */
export type AiToolFailure = {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
} & (
  | { status: "failed"; error: AiToolError & { code: Exclude<AiErrorCode, "AI_RESULT_UNKNOWN"> } }
  | { status: "unknown"; error: AiToolError & { code: "AI_RESULT_UNKNOWN"; retryable: false; nextAction: "reconcile" } }
);
