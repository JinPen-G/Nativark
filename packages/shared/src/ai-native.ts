/**
 * AIN-02/S01 · C01/C02 草案，不是运行授权或可执行工具目录。
 * 身份由服务端建立；类型/schema 合法不代表资源可访问。AIN-04 必须在每步及结果重放前重验授权。
 * 未冻结：不注册 HTTP 路由、handler、模型或 Worker；具体业务投影在后续切片定义。
 */
import type { AuthUser, SystemDataScope } from "./platform";

export const AI_CONTRACT_DRAFT_VERSION = "ain-c01-c02-draft-1" as const;
export const AI_TOOL_DRAFT_VERSION = "draft-1" as const;
export const AI_TOOL_CODES = Object.freeze([
  "rental.order.explain", "rental.catalog.search", "rental.availability.check",
  "membership.customer.resolve", "rental.quote.preview", "rental.order.propose",
  "rental.order.commit", "rental.change.preview", "tenant.opening.diagnose",
  "tenant.config.propose", "tenant.notifications.commit", "membership.profile.propose", "inspection.draft.extract",
  "operations.risks.list", "platform.category.propose"
] as const);
export type AiToolCode = typeof AI_TOOL_CODES[number];
export type AiAudience = "operator" | "staff" | "client" | "automation";
export type AiRisk = "R0" | "R1" | "R2" | "R3";
export type AiToolMaturity = "unavailable" | "preview_only" | "executable";

export interface AiPlatformScope { kind: "platform" }
export interface AiTenantScope { kind: "tenant"; tenantId: string }
export interface AiWorkspaceScope { kind: "workspace"; tenantId: string; workspaceId: string }
export type AiExecutionScope = AiPlatformScope | AiTenantScope | AiWorkspaceScope;

/** 复用既有岗位数据/地点口径；selected 空列表表示无可访问地点，绝不折算为 all。 */
export type AiLocationScope = NonNullable<AuthUser["locationScope"]> & (
  { mode: "all"; locationIds: [] } | { mode: "selected"; locationIds: string[] }
);
export interface AiOperatorAccess {
  permissions: NonNullable<AuthUser["permissions"]>;
  dataScope: SystemDataScope;
  locationScope: AiLocationScope;
  organizationId?: string;
}

interface AiContextBase {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
  /** 最近一次由服务端解析授权的时点，不是长期授权凭据。 */
  authorizedAt: string;
}

/**
 * 仅供可信服务器内部传递，不作为任意客户端/模型请求体。
 * SaaS 身份与后台共用 operator audience，但只能声明 platform 范围；不能默认进入租户。
 * automation 是未来独立主体的契约，不表示已有自动主体或执行器。
 * 匿名任务迁移、企业用人授权与完整 C01 授权修订留待后续冻结。
 */
export type AiExecutionContext = AiContextBase & (
  | { audience: "operator"; actor: { kind: "saas_admin"; userId: string }; scope: AiPlatformScope; permissions: string[] }
  | { audience: "operator" | "staff"; actor: { kind: "user"; userId: string }; scope: AiTenantScope | AiWorkspaceScope; access: AiOperatorAccess }
  | { audience: "client"; actor: { kind: "customer"; customerId: string }; scope: AiTenantScope | AiWorkspaceScope }
  | { audience: "automation"; actor: { kind: "automation"; subjectId: string; policyId: string; policyRevision: number; expiresAt: string }; scope: AiTenantScope | AiWorkspaceScope; access: AiOperatorAccess }
);

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

/** 来源是资源引用而非任意下载 URL；打开时重新鉴权，不把引用本身当能力令牌。 */
export interface AiFactReference {
  scope: AiExecutionScope;
  resourceType: "order" | "quote" | "configuration" | "report" | "inspection" | "knowledge";
  resourceId: string;
  observedAt: string;
  /** 缺历史依据不能伪装为当前规则或已冻结快照；兼容办理建议须显式标记来源。 */
  basis:
    | { kind: "current" }
    | { kind: "snapshot"; version: string }
    | { kind: "missing"; reason: "snapshot_missing" | "source_unavailable" }
    | { kind: "legacy_current_fallback"; reason: "snapshot_missing" };
}

export const AI_ERROR_CODES = Object.freeze([
  "AI_DISABLED", "AI_PROVIDER_UNAVAILABLE", "AI_BUDGET_EXCEEDED", "AI_TOOL_UNAVAILABLE",
  "AI_SCOPE_CHANGED", "AI_APPROVAL_EXPIRED", "AI_PROPOSAL_STALE", "AI_RESULT_UNKNOWN",
  "AI_INVALID_INPUT", "AI_UNSUPPORTED_VERSION", "AI_ACCESS_DENIED", "AI_BUSINESS_REJECTED"
] as const);
export type AiErrorCode = typeof AI_ERROR_CODES[number];
export type AiRecoveryAction = "none" | "clarify" | "reconfirm" | "reauthorize" | "reconcile" | "retry_later" | "manual";
interface AiToolErrorDetails {
  /** 服务端面向当前受众的安全文案，不含堆栈/密钥/越权对象是否存在的提示。 */
  message: string;
  missingFields: string[];
}
/** 独立消费错误时也必须保留未知结果的核对语义，不能只由外层状态封套约束。 */
export type AiToolError = AiToolErrorDetails & (
  | { code: Exclude<AiErrorCode, "AI_RESULT_UNKNOWN">; retryable: boolean; nextAction: AiRecoveryAction }
  | { code: "AI_RESULT_UNKNOWN"; retryable: false; nextAction: "reconcile" }
);

/** 结果未知不是失败后可直接重试；必须先核对已发生的业务副作用。 */
export type AiToolFailure = {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
} & (
  | { status: "failed"; error: AiToolError & { code: Exclude<AiErrorCode, "AI_RESULT_UNKNOWN"> } }
  | { status: "unknown"; error: AiToolError & { code: "AI_RESULT_UNKNOWN"; retryable: false; nextAction: "reconcile" } }
);
