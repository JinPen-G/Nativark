import type {
  ClientAccountClosurePreview,
  ClientAccountClosureRequest,
  ClientAccountClosureResponse,
  ClientAgreementConsent,
  ClientMembershipLoginRequest,
  ClientMembershipSessionResponse,
  ClientMembershipStatusResponse,
  ClientPersonalMembershipRegistrationRequest,
  ClientPersonalMembershipRegistrationResponse,
  ClientRegistrationChallengeResponse,
  ClientSmsLoginRequest,
  ClientWechatBindResponse,
  ClientWechatPhoneLoginRequest,
  VerifyClientRegistrationChallengeResponse
} from "@rental-os/shared";
import { PUBLIC_CONFIG } from "../config/public";
import { contractMissing, featureUnavailable } from "../contracts/planned";
import { request } from "../core/http";
import { clearSession, currentServiceCode, refreshToken, saveSession } from "../core/session";

/**
 * 账号相关接口。密码登录、微信手机号登录、短信登录均由服务端提供；
 * 商户未配置渠道/短信时服务端返回 503，页面显示“尚未开通”并给备用入口。
 */
const clientId = () => (PUBLIC_CONFIG.appId ? `miniprogram:${PUBLIC_CONFIG.appId}` : "miniprogram");

export async function loginWithPassword(input: { loginIdentifier: string; password: string; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
  const body: ClientMembershipLoginRequest = {
    tenantCode: PUBLIC_CONFIG.tenantCode,
    loginIdentifier: input.loginIdentifier,
    password: input.password,
    workspaceCode: input.serviceCode || undefined,
    clientId: clientId()
  };
  return request<ClientMembershipSessionResponse>("/auth/login", { method: "POST", data: body, auth: "none" });
}

/** 微信手机号一键登录（MP-02A）：只提交两个一次性凭证，openid/手机号由服务端换取。 */
export async function loginWithWechatPhone(input: { loginCode: string; phoneCode: string; consent: ClientAgreementConsent; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
  const body: ClientWechatPhoneLoginRequest = {
    tenantCode: PUBLIC_CONFIG.tenantCode,
    appId: PUBLIC_CONFIG.appId || undefined,
    loginCode: input.loginCode,
    phoneCode: input.phoneCode,
    consent: input.consent,
    workspaceCode: input.serviceCode || undefined,
    clientId: clientId()
  };
  try {
    return await request<ClientMembershipSessionResponse>("/auth/wechat/phone-login", { method: "POST", data: body, auth: "none" });
  } catch (error) {
    if (contractMissing(error)) throw featureUnavailable("商户尚未开通微信手机号登录，请使用短信验证码或密码登录");
    throw error;
  }
}

/** 已登录后绑定当前微信身份（用于小程序内微信支付）。loginCode 一次性，会话刷新后不能重放，由调用方重新取 code。 */
export async function bindWechat(loginCode: string): Promise<ClientWechatBindResponse> {
  return request<ClientWechatBindResponse>("/auth/wechat/bind", { method: "POST", data: { loginCode, appId: PUBLIC_CONFIG.appId || undefined }, scope: "tenant", replayAfterRefresh: false });
}

/** 用途化验证码（registration / login）。 */
export async function createChallenge(input: { purpose: "registration" | "login"; method: "sms" | "email"; identifier: string; idempotencyKey: string; serviceCode?: string }): Promise<ClientRegistrationChallengeResponse> {
  return request<ClientRegistrationChallengeResponse>("/auth/challenges", {
    method: "POST",
    auth: "none",
    data: { tenantCode: PUBLIC_CONFIG.tenantCode, workspaceCode: input.serviceCode || undefined, method: input.method, identifier: input.identifier, idempotencyKey: input.idempotencyKey, purpose: input.purpose }
  });
}

/** 兼容旧调用：注册用途的验证码。 */
export async function createRegistrationChallenge(input: { method: "sms" | "email"; identifier: string; idempotencyKey: string; serviceCode?: string }): Promise<ClientRegistrationChallengeResponse> {
  return createChallenge({ ...input, purpose: "registration" });
}

export async function verifyRegistrationChallenge(challengeId: string, code: string): Promise<VerifyClientRegistrationChallengeResponse> {
  return request<VerifyClientRegistrationChallengeResponse>(`/auth/registration/challenges/${encodeURIComponent(challengeId)}/verify`, {
    method: "POST",
    auth: "none",
    data: { code }
  });
}

/** 短信验证码登录（MP-02B）：证明须为 login 用途。 */
export async function loginWithSms(input: { loginIdentifier: string; verificationToken: string; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
  const body: ClientSmsLoginRequest = { tenantCode: PUBLIC_CONFIG.tenantCode, loginIdentifier: input.loginIdentifier, verificationToken: input.verificationToken, workspaceCode: input.serviceCode || undefined, clientId: clientId() };
  return request<ClientMembershipSessionResponse>("/auth/sms-login", { method: "POST", data: body, auth: "none" });
}

export async function registerPersonal(input: Omit<ClientPersonalMembershipRegistrationRequest, "tenantCode" | "workspaceCode"> & { serviceCode?: string }): Promise<ClientPersonalMembershipRegistrationResponse> {
  const { serviceCode, ...rest } = input;
  return request<ClientPersonalMembershipRegistrationResponse>("/auth/register", {
    method: "POST",
    auth: "none",
    data: { tenantCode: PUBLIC_CONFIG.tenantCode, workspaceCode: serviceCode || undefined, ...rest }
  });
}

export async function logout(): Promise<void> {
  const token = refreshToken();
  if (token) {
    try {
      await request("/auth/logout", { method: "POST", data: { refreshToken: token }, auth: "none", scope: "tenant" });
    } catch {
      // 服务端撤销失败也要清本机凭据；refresh token 到期后自然失效。
    }
  }
  clearSession("logout");
}

/** 切换当前服务：服务端复核并换发会话；本地只记录服务端结果。 */
export async function switchService(serviceCode: string): Promise<ClientMembershipSessionResponse> {
  const response = await request<ClientMembershipSessionResponse>("/auth/switch-workspace", {
    method: "POST",
    data: { workspaceCode: serviceCode },
    scope: "tenant",
    replayAfterRefresh: true
  });
  saveSession(response, serviceCode, "switch-service");
  return response;
}

export async function membershipStatus(): Promise<ClientMembershipStatusResponse> {
  return request<ClientMembershipStatusResponse>("/auth/me", { scope: "tenant" });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request("/auth/change-password", { method: "POST", data: { currentPassword, newPassword }, scope: "tenant" });
}

/* ---------- MP-02B：本人注销 ---------- */

export async function closurePreview(): Promise<ClientAccountClosurePreview> {
  return request<ClientAccountClosurePreview>("/auth/closure/preview", { scope: "tenant" });
}

export async function closureChallenge(): Promise<ClientRegistrationChallengeResponse> {
  return request<ClientRegistrationChallengeResponse>("/auth/closure/challenge", { method: "POST", scope: "tenant" });
}

export async function closeAccount(input: ClientAccountClosureRequest): Promise<ClientAccountClosureResponse> {
  return request<ClientAccountClosureResponse>("/auth/closure", { method: "POST", data: input, scope: "tenant", replayAfterRefresh: false });
}

/** 登录/注册成功后统一落会话。 */
export function adoptSession(response: ClientMembershipSessionResponse, preferredServiceCode?: string, reason = "login"): void {
  saveSession(response, preferredServiceCode || currentServiceCode(), reason);
}
