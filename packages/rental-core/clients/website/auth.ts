/** Rental 官网认证与本人资料客户端复用宿主原会话、运输和原引用清理。
 * 服务端裁定客户身份，资料读取经宿主当前会话围栏，只释放原个人页面所需字段。 */
import { CLIENT_API_VERSION } from "../../src/client-contracts";
import type {
  ClientChallengeRequest,
  ClientMembershipLoginRequest,
  ClientPersonalMembershipRegistrationRequest,
  ClientPersonalMembershipRegistrationResponse,
  ClientProfileView,
  ClientRegistrationChallengeResponse,
  ClientSmsLoginRequest,
  VerifyClientRegistrationChallengeResponse,
} from "../../src/client-contracts";
import type {
  customerLogin,
  logoutCustomerSession,
  switchCustomerWorkspace,
} from "@rental-os/web-client";
import type { RentalWebsiteSessionRequest } from "./session";

export interface RentalWebsiteAuthPorts {
  clientV1: string;
  postPublic: <T>(path: string, payload: unknown) => Promise<T>;
  customerLogin: typeof customerLogin;
  logoutCustomerSession: typeof logoutCustomerSession;
  minimizeRecovery: () => void | Promise<void>;
}

type ChallengeInput = Pick<ClientChallengeRequest, "tenantCode" | "identifier" | "idempotencyKey" | "purpose">;
type ChallengeResult = ClientRegistrationChallengeResponse;
type RegistrationInput = Pick<ClientPersonalMembershipRegistrationRequest,
  "tenantCode" | "name" | "phone" | "password" | "verificationToken" | "idempotencyKey" | "consent">;
type RegistrationResult = Required<Pick<ClientPersonalMembershipRegistrationResponse,
  "result" | "customerId" | "membershipStatus">>;

export function createRentalWebsiteAuthClient(ports: RentalWebsiteAuthPorts) {
  return {
    createChallenge(input: ChallengeInput) {
      return ports.postPublic<ChallengeResult>("/auth/challenges", { ...input, method: "sms" });
    },
    verifyChallenge(challengeId: string, code: string) {
      return ports.postPublic<Pick<VerifyClientRegistrationChallengeResponse, "verificationToken">>(
        `/auth/registration/challenges/${encodeURIComponent(challengeId)}/verify`, { code },
      );
    },
    smsLogin(input: Pick<ClientSmsLoginRequest, "tenantCode" | "loginIdentifier" | "verificationToken">, isCurrent?: () => boolean) {
      return ports.customerLogin(input.tenantCode, ports.clientV1, "/auth/sms-login", input, isCurrent);
    },
    passwordLogin(input: Pick<ClientMembershipLoginRequest, "tenantCode" | "loginIdentifier" | "password">, isCurrent?: () => boolean) {
      return ports.customerLogin(input.tenantCode, ports.clientV1, "/auth/login", input, isCurrent);
    },
    register(input: RegistrationInput) {
      return ports.postPublic<RegistrationResult>("/auth/register", input);
    },
    async logout(tenantCode: string) {
      try {
        return await ports.logoutCustomerSession(tenantCode, ports.clientV1);
      } finally {
        await ports.minimizeRecovery();
      }
    },
  };
}

export interface RentalWebsiteProfileReadOwner {
  customerId: string;
  workspaceCode: string;
  current: () => boolean;
}

export interface RentalWebsiteAccountPorts {
  clientV1: string;
  authedJson: RentalWebsiteSessionRequest;
  currentTenantCode: () => string | undefined;
  switchCustomerWorkspace: typeof switchCustomerWorkspace;
  captureOwnProfileReadSession: () => RentalWebsiteProfileReadOwner | null;
  readOnce: (path: string, init: RequestInit) => Promise<unknown>;
  error: (status: number, message: string) => Error;
}

/** 原个人只读页面的字段投影。联系人和企业主体资料由各自受权业务入口维护。 */
export type OwnProfileReadView = Pick<ClientProfileView,
  "apiVersion" | "customerId" | "customerType" | "name" | "phoneMasked" | "email"
  | "identityVerified" | "identityNoMasked" | "accountStatus" | "workspace">;

export function createRentalWebsiteAccountClient(ports: RentalWebsiteAccountPorts) {
  return {
    me() {
      return ports.authedJson<Record<string, unknown>>("/auth/me");
    },
    switchWorkspace(workspaceCode: string) {
      const tenantCode = ports.currentTenantCode();
      if (!tenantCode) throw ports.error(401, "请先登录当前商户");
      return ports.switchCustomerWorkspace(tenantCode, ports.clientV1, workspaceCode);
    },
    async profile(signal?: AbortSignal): Promise<OwnProfileReadView> {
      const owner = ports.captureOwnProfileReadSession();
      if (!owner?.current() || signal?.aborted) throw ports.error(401, "本人资料会话已变化");
      const controller = new AbortController();
      const stop = () => controller.abort();
      const timer = setTimeout(stop, 15000);
      signal?.addEventListener("abort", stop, { once: true });
      try {
        // 原 GET 只观察一次，刷新或中断使这次读取失效，重新读取使用新的当前会话。
        const value = await ports.readOnce("/profile", { signal: controller.signal });
        if (controller.signal.aborted || signal?.aborted || !owner.current()) {
          throw ports.error(401, "本人资料会话已变化");
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw ports.error(502, "本人资料返回内容无法核验");
        }
        const profile = value as Partial<ClientProfileView>;
        const workspace = profile.workspace;
        if (profile.apiVersion !== CLIENT_API_VERSION || profile.customerId !== owner.customerId || profile.customerType !== "personal"
          || typeof profile.name !== "string" || !profile.name || typeof profile.phoneMasked !== "string"
          || profile.email !== undefined && typeof profile.email !== "string"
          || typeof profile.identityVerified !== "boolean" || profile.identityNoMasked !== undefined && typeof profile.identityNoMasked !== "string"
          || !["active", "suspended", "closed"].includes(String(profile.accountStatus))
          || !workspace || workspace.workspaceCode !== owner.workspaceCode || typeof workspace.workspaceName !== "string"
          || typeof workspace.categoryCode !== "string" || typeof workspace.membershipStatus !== "string"
          || workspace.isDefault !== undefined && typeof workspace.isDefault !== "boolean") {
          throw ports.error(502, "本人资料返回内容无法核验");
        }
        return {
          apiVersion: CLIENT_API_VERSION,
          customerId: profile.customerId,
          customerType: "personal",
          name: profile.name,
          phoneMasked: profile.phoneMasked,
          identityVerified: profile.identityVerified,
          accountStatus: profile.accountStatus as OwnProfileReadView["accountStatus"],
          ...(profile.email !== undefined ? { email: profile.email } : {}),
          ...(profile.identityNoMasked !== undefined ? { identityNoMasked: profile.identityNoMasked } : {}),
          workspace: {
            workspaceCode: workspace.workspaceCode,
            workspaceName: workspace.workspaceName,
            categoryCode: workspace.categoryCode,
            membershipStatus: workspace.membershipStatus,
            ...(workspace.isDefault !== undefined ? { isDefault: workspace.isDefault } : {}),
          },
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}
