/** Rental 客户小程序认证客户端。路径、凭证用途、会话采用与错误沿原客户端，
 * 服务端核验身份、注册、微信绑定及本人注销，宿主维护原会话与请求围栏。 */
import type {
  ClientAccountClosureChallengeRequest,
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
} from "../../src/client-contracts";
import type { RentalMiniProgramClientPorts, RentalMiniProgramPublicConfig } from "./ports";

/** 认证动作复用原请求、公开渠道配置和会话采用，由宿主维护凭据与当前身份。 */
export interface RentalMiniProgramAuthPorts extends RentalMiniProgramClientPorts {
  publicConfig: RentalMiniProgramPublicConfig;
  contractMissing: (error: unknown) => boolean;
  featureUnavailable: (message: string) => Error;
  currentServiceCode: () => string;
  refreshToken: () => string;
  saveSession: (response: ClientMembershipSessionResponse, serviceCode: string, reason: string) => unknown;
  clearSession: (reason: string) => void;
}

export function createRentalMiniProgramAuthApi(ports: RentalMiniProgramAuthPorts) {
  const { request, publicConfig, contractMissing, featureUnavailable,
    currentServiceCode, refreshToken, saveSession, clearSession } = ports;

  /**
   * 账号相关接口。密码登录、微信手机号登录、短信登录均由服务端提供；
   * 商户未配置渠道/短信时服务端返回 503，页面显示“尚未开通”并给备用入口。
   */
  const clientId = () => (publicConfig.appId ? `miniprogram:${publicConfig.appId}` : "miniprogram");

  async function loginWithPassword(input: { loginIdentifier: string; password: string; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
    const body: ClientMembershipLoginRequest = {
      tenantCode: publicConfig.tenantCode,
      loginIdentifier: input.loginIdentifier,
      password: input.password,
      workspaceCode: input.serviceCode || undefined,
      clientId: clientId()
    };
    return request<ClientMembershipSessionResponse>("/auth/login", { method: "POST", data: body, auth: "none" });
  }

  /** 微信手机号一键登录（MP-02A）：只提交两个一次性凭证，openid/手机号由服务端换取。 */
  async function loginWithWechatPhone(input: { loginCode: string; phoneCode: string; consent: ClientAgreementConsent; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
    const body: ClientWechatPhoneLoginRequest = {
      tenantCode: publicConfig.tenantCode,
      appId: publicConfig.appId || undefined,
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
  async function bindWechat(loginCode: string): Promise<ClientWechatBindResponse> {
    return request<ClientWechatBindResponse>("/auth/wechat/bind", { method: "POST", data: { loginCode, appId: publicConfig.appId || undefined }, scope: "tenant", replayAfterRefresh: false });
  }

  /** 用途化验证码（registration / login）。 */
  async function createChallenge(input: { purpose: "registration" | "login"; method: "sms" | "email"; identifier: string; idempotencyKey: string; serviceCode?: string }): Promise<ClientRegistrationChallengeResponse> {
    return request<ClientRegistrationChallengeResponse>("/auth/challenges", {
      method: "POST",
      auth: "none",
      data: { tenantCode: publicConfig.tenantCode, workspaceCode: input.serviceCode || undefined, method: input.method, identifier: input.identifier, idempotencyKey: input.idempotencyKey, purpose: input.purpose }
    });
  }

  /** 兼容旧调用：注册用途的验证码。 */
  async function createRegistrationChallenge(input: { method: "sms" | "email"; identifier: string; idempotencyKey: string; serviceCode?: string }): Promise<ClientRegistrationChallengeResponse> {
    return createChallenge({ ...input, purpose: "registration" });
  }

  async function verifyRegistrationChallenge(challengeId: string, code: string): Promise<VerifyClientRegistrationChallengeResponse> {
    return request<VerifyClientRegistrationChallengeResponse>(`/auth/registration/challenges/${encodeURIComponent(challengeId)}/verify`, {
      method: "POST",
      auth: "none",
      data: { code }
    });
  }

  /** 短信验证码登录（MP-02B）：证明须为 login 用途。 */
  async function loginWithSms(input: { loginIdentifier: string; verificationToken: string; serviceCode?: string }): Promise<ClientMembershipSessionResponse> {
    const body: ClientSmsLoginRequest = { tenantCode: publicConfig.tenantCode, loginIdentifier: input.loginIdentifier, verificationToken: input.verificationToken, workspaceCode: input.serviceCode || undefined, clientId: clientId() };
    return request<ClientMembershipSessionResponse>("/auth/sms-login", { method: "POST", data: body, auth: "none" });
  }

  async function registerPersonal(input: Omit<ClientPersonalMembershipRegistrationRequest, "tenantCode" | "workspaceCode"> & { serviceCode?: string }): Promise<ClientPersonalMembershipRegistrationResponse> {
    const { serviceCode, ...rest } = input;
    return request<ClientPersonalMembershipRegistrationResponse>("/auth/register", {
      method: "POST",
      auth: "none",
      data: { tenantCode: publicConfig.tenantCode, workspaceCode: serviceCode || undefined, ...rest }
    });
  }

  async function logout(): Promise<void> {
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
  async function switchService(serviceCode: string): Promise<ClientMembershipSessionResponse> {
    const response = await request<ClientMembershipSessionResponse>("/auth/switch-workspace", {
      method: "POST",
      data: { workspaceCode: serviceCode },
      scope: "tenant",
      replayAfterRefresh: true
    });
    saveSession(response, serviceCode, "switch-service");
    return response;
  }

  async function membershipStatus(): Promise<ClientMembershipStatusResponse> {
    return request<ClientMembershipStatusResponse>("/auth/me", { scope: "tenant" });
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request("/auth/change-password", { method: "POST", data: { currentPassword, newPassword }, scope: "tenant" });
  }

  /* ---------- MP-02B：本人注销 ---------- */

  async function closurePreview(): Promise<ClientAccountClosurePreview> {
    return request<ClientAccountClosurePreview>("/auth/closure/preview", { scope: "tenant" });
  }

  async function closureChallenge(input?: ClientAccountClosureChallengeRequest): Promise<ClientRegistrationChallengeResponse> {
    return request<ClientRegistrationChallengeResponse>("/auth/closure/challenge", {
      method: "POST", ...(input === undefined ? {} : { data: input }), scope: "tenant", replayAfterRefresh: false
    });
  }

  async function closeAccount(input: ClientAccountClosureRequest): Promise<ClientAccountClosureResponse> {
    return request<ClientAccountClosureResponse>("/auth/closure", { method: "POST", data: input, scope: "tenant", replayAfterRefresh: false });
  }

  /** 登录/注册成功后统一落会话。 */
  function adoptSession(response: ClientMembershipSessionResponse, preferredServiceCode?: string, reason = "login"): void {
    saveSession(response, preferredServiceCode || currentServiceCode(), reason);
  }

  return {
    loginWithPassword,
    loginWithWechatPhone,
    bindWechat,
    createChallenge,
    createRegistrationChallenge,
    verifyRegistrationChallenge,
    loginWithSms,
    registerPersonal,
    logout,
    switchService,
    membershipStatus,
    changePassword,
    closurePreview,
    closureChallenge,
    closeAccount,
    adoptSession,
  };
}
