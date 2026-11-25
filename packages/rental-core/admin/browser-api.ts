/** Rental 浏览器会话的原 HTTP 入口，身份、空间与令牌仍由服务端裁定。 */
import type {
  ChangePasswordRequest,
  LoginRequest,
  RefreshSessionRequest,
} from "@rental-os/platform-contracts";
import type {
  LoginResponse,
  SessionContextResponse,
  SwitchWorkspaceRequest,
} from "@rental-os/rental-core/auth-contracts";
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";

export function createRentalAdminSessionApi(request: AdminRuntime["request"]) {
  return {
    login: (payload: LoginRequest) => request<LoginResponse>("/auth/login", { method: "post", data: payload }),
    logout: (payload: RefreshSessionRequest) => request<{ loggedOut: boolean }>("/auth/logout", { method: "post", data: payload }),
    changePassword: (payload: ChangePasswordRequest) => request<LoginResponse>("/auth/change-password", { method: "post", data: payload }),
    switchWorkspace: (payload: SwitchWorkspaceRequest) => request<LoginResponse>("/auth/switch-workspace", { method: "post", data: payload }),
    sessionContext: () => request<SessionContextResponse>("/auth/session-context"),
  };
}
