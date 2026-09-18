import type {
  ClientMembershipLoginRequest,
  ClientMembershipSessionResponse,
  ClientMembershipStatusResponse,
  ClientPersonalMembershipRegistrationRequest,
  ClientPersonalMembershipRegistrationResponse,
  ClientRegistrationChallengeResponse,
  VerifyClientRegistrationChallengeResponse
} from "@rental-os/shared";
import { PUBLIC_CONFIG } from "../config/public";
import { PLANNED_CONTRACTS, contractMissing, plannedUnavailable, type WechatPhoneLoginRequest } from "../contracts/planned";
import { request } from "../core/http";
import { clearSession, currentServiceCode, refreshToken, saveSession } from "../core/session";

/**
 * 账号相关接口。密码登录与注册是现有契约；微信手机号登录与短信登录是拟新增契约，
 * 服务端未提供时抛出 UNAVAILABLE，由页面显示“尚未开通”并提供备用入口。
 */
export async function loginWithPassword(input: { loginIdentifier: string; password: string; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
  const body: ClientMembershipLoginRequest = {
    tenantCode: PUBLIC_CONFIG.tenantCode,
    loginIdentifier: input.loginIdentifier,
    password: input.password,
    workspaceCode: input.serviceCode || undefined,
    clientId: PUBLIC_CONFIG.appId ? `miniprogram:${PUBLIC_CONFIG.appId}` : "miniprogram"
  };
  return request<ClientMembershipSessionResponse>("/auth/login", { method: "POST", data: body, auth: "none" });
}

/** 微信手机号一键登录（拟新增 MP-02A）。 */
export async function loginWithWechatPhone(input: WechatPhoneLoginRequest): Promise<ClientMembershipSessionResponse> {
  try {
    return await request<ClientMembershipSessionResponse>(PLANNED_CONTRACTS.wechatPhoneLogin.path, {
      method: "POST",
      data: { tenantCode: PUBLIC_CONFIG.tenantCode, appId: PUBLIC_CONFIG.appId, ...input },
      auth: "none"
    });
  } catch (error) {
    if (contractMissing(error)) throw plannedUnavailable("wechatPhoneLogin");
    throw error;
  }
}

export async function createRegistrationChallenge(input: { method: "sms" | "email"; identifier: string; idempotencyKey: string; serviceCode?: string }): Promise<ClientRegistrationChallengeResponse> {
  return request<ClientRegistrationChallengeResponse>("/auth/registration/challenges", {
    method: "POST",
    auth: "none",
    data: { tenantCode: PUBLIC_CONFIG.tenantCode, workspaceCode: input.serviceCode || undefined, method: input.method, identifier: input.identifier, idempotencyKey: input.idempotencyKey }
  });
}

export async function verifyRegistrationChallenge(challengeId: string, code: string): Promise<VerifyClientRegistrationChallengeResponse> {
  return request<VerifyClientRegistrationChallengeResponse>(`/auth/registration/challenges/${encodeURIComponent(challengeId)}/verify`, {
    method: "POST",
    auth: "none",
    data: { code }
  });
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

/** 登录/注册成功后统一落会话。 */
export function adoptSession(response: ClientMembershipSessionResponse, preferredServiceCode?: string, reason = "login"): void {
  saveSession(response, preferredServiceCode || currentServiceCode(), reason);
}
