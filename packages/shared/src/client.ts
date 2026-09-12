/**
 * 客户端 API 的独立契约（MEMBER-01F）。
 *
 * 这里故意不复用后台 `SystemUserRow`、运营登录请求或后台会员 DTO：
 * 客户账号与运营账号是两套认证边界，客户端也必须明确目标租户与经营空间。
 * 本文件只固化 v1 的请求/响应形状；验证码 provider、客户端页面和真实发信另行激活。
 */

export const CLIENT_API_VERSION = "v1" as const;
export const CLIENT_REGISTRATION_CHANNEL = "app" as const;

export const CLIENT_VERIFICATION_METHODS = ["sms", "email"] as const;
export type ClientVerificationMethod = (typeof CLIENT_VERIFICATION_METHODS)[number];

export const CLIENT_REGISTRATION_CHALLENGE_STATUSES = [
  "pending_verification",
  "verified",
  "expired",
  "consumed"
] as const;
export type ClientRegistrationChallengeStatus =
  (typeof CLIENT_REGISTRATION_CHALLENGE_STATUSES)[number];

/**
 * 客户端目标不能依赖后台当前会话；正式 API 通过公开的租户/空间编码解析目标，
 * 服务端随后校验租户、空间状态、品类和注册模式。响应和 token 不向客户端暴露内部 id。
 */
export interface ClientWorkspaceTarget {
  tenantCode: string;
  workspaceCode: string;
}

export interface ClientRegistrationChallengeRequest extends ClientWorkspaceTarget {
  method: ClientVerificationMethod;
  identifier: string;
  /** 同一次点击/重试的业务幂等键，不能用手机号或验证码代替。 */
  idempotencyKey: string;
}

export interface ClientRegistrationChallengeResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  challengeId: string;
  status: ClientRegistrationChallengeStatus;
  method: ClientVerificationMethod;
  maskedDestination: string;
  expiresAt: string;
  retryAfterSeconds?: number;
}

/** 验证码交换为一次性短期证明，不把原始验证码带进注册请求或日志。 */
export interface VerifyClientRegistrationChallengeRequest {
  challengeId: string;
  code: string;
}

export interface VerifyClientRegistrationChallengeResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  verificationToken: string;
  expiresAt: string;
}

export interface ClientAgreementConsent {
  userAgreementVersion: string;
  privacyPolicyVersion: string;
  agreedAt: string;
}

/**
 * APP 注册请求。服务端依据 verificationToken、目标空间和注册策略创建/复用主档，
 * 客户端不能提交 tenantId、workspaceId、directApprove、reviewedBy 或最终会员状态。
 */
export interface ClientPersonalMembershipRegistrationRequest extends ClientWorkspaceTarget {
  name: string;
  phone: string;
  email?: string;
  identityNo?: string;
  verificationToken: string;
  consent: ClientAgreementConsent;
  idempotencyKey: string;
}

export const CLIENT_REGISTRATION_RESULTS = ["pending_review", "active"] as const;
export type ClientRegistrationResult = (typeof CLIENT_REGISTRATION_RESULTS)[number];

export interface ClientPersonalMembershipRegistrationResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  result: ClientRegistrationResult;
  registrationId: string;
  customerId?: string;
  /** 只返回客户端可理解的状态，不返回后台审核权限、操作者或内部数据范围。 */
  reviewStatus: "pending" | "approved";
  membershipStatus: "pending_activation" | "active";
}

/** 客户端登录与后台运营登录完全分离，token 不能互换。 */
export interface ClientMembershipLoginRequest {
  tenantCode: string;
  loginIdentifier: string;
  password: string;
  clientId?: string;
}

export interface ClientMembershipSessionResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  customer: {
    customerId: string;
    customerType: "personal" | "corporate";
    displayName: string;
    loginIdentifierMasked: string;
  };
  workspaces: Array<{
    workspaceCode: string;
    workspaceName: string;
    categoryCode: string;
    membershipStatus: string;
  }>;
}

export interface ClientMembershipReviewStatus {
  registrationId: string;
  status: "pending" | "approved" | "rejected" | "supplement_required" | "cancelled";
  reason?: string;
  updatedAt: string;
}

export interface ClientMembershipQualificationStatus {
  qualificationType: string;
  status: "not_submitted" | "pending" | "approved" | "rejected" | "expired" | "revoked";
  expiresAt?: string;
  reviewComment?: string;
  updatedAt: string;
}
