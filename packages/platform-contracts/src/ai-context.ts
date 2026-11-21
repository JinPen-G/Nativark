/** 服务端建立的AI身份与范围；类型/schema不授予权限。
 * 公共平台、租户和原workspace范围保持原版本，业务对象及当前授权由Core参加者复验。 */
import type { AuthUser, SystemDataScope } from "./index";

export const AI_CONTRACT_DRAFT_VERSION = "ain-c01-c02-draft-1" as const;

export type AiAudience = "operator" | "staff" | "client" | "automation";

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

export interface AiContextBase {
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
