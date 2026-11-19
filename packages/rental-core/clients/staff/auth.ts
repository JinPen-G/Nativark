/** Rental 员工小程序认证客户端。原 Staff 请求供给受众、鉴权及范围，
 * 会话保存与退出清理由宿主完成，身份和成员资格由原服务端复核。 */
import type { ChangePasswordRequest } from "@rental-os/platform-contracts";
import type { LoginResponse } from "../../src/auth-contracts";
import type { RentalStaffClientPorts } from "./ports";

export interface RentalStaffAuthPorts extends RentalStaffClientPorts {
  refreshToken: () => string;
  saveSession: (response: LoginResponse, reason: string) => unknown;
  clearSession: (reason: string) => void;
}

export function createRentalStaffAuthApi(ports: RentalStaffAuthPorts) {
  const { request, refreshToken, saveSession, clearSession } = ports;

  /**
   * 认证：租户编码 + 运营账号 + 密码；请求员工专属认证路由并保存 staff 受众会话。
   */
  async function login(tenantCode: string, account: string, password: string): Promise<LoginResponse> {
    const response = await request<LoginResponse>("/auth/login", { method: "POST", auth: "none", data: { tenantCode: tenantCode.trim(), account: account.trim(), password } });
    saveSession(response, "login");
    return response;
  }

  async function logout(): Promise<void> {
    const token = refreshToken();
    if (token) {
      try {
        await request("/auth/logout", { method: "POST", data: { refreshToken: token }, scope: "tenant", replayAfterRefresh: false });
      } catch {
        // 服务端撤销失败不影响本机清理。
      }
    }
    clearSession("logout");
  }

  /** 切换经营空间：服务端校验成员资格后换发访问令牌（refreshToken 不变）。 */
  async function switchWorkspace(workspaceId: string): Promise<LoginResponse> {
    const response = await request<LoginResponse>("/auth/switch-workspace", { method: "POST", data: { workspaceId }, scope: "tenant" });
    saveSession(response, "switch-workspace");
    return response;
  }

  function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const body: ChangePasswordRequest = { currentPassword, newPassword } as ChangePasswordRequest;
    return request<void>("/auth/change-password", { method: "POST", data: body, scope: "tenant" });
  }

  return { login, logout, switchWorkspace, changePassword };
}
