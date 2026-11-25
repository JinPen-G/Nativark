/** 原设置请求复用所选宿主的唯一运输；当前身份/权限在发送和返回时分别核对。
 * 取消或失应答不证明写入失败；写请求不因认证刷新而自动重发，恢复仍读原收据。 */
import type { AdminRequestOptions } from "@rental-os/platform-admin/runtime";
import type { AiAdminHost } from "../host";

export interface AiSettingsAccess {
  audience: "platform" | "tenant";
  permission: string;
  workspace?: boolean;
  /** 按实际动作声明；POST 也可能只是读原配置或收据。 */
  write: boolean;
}

export function createAiSettingsRequest(host: AiAdminHost) {
  return async <T>(path: string, access: AiSettingsAccess, options: AdminRequestOptions = {}): Promise<T> => {
    const { runtime, getSession } = host;
    const epoch = runtime.currentSessionEpoch();
    const identity = () => {
      const session = getSession();
      return JSON.stringify([session.user, session.tenant, session.currentWorkspaceId]);
    };
    const owner = identity();
    const signal = options.signal
      ? AbortSignal.any([options.signal, runtime.currentSessionSignal()])
      : runtime.currentSessionSignal();
    const check = () => {
      const session = getSession();
      if (signal.aborted || epoch !== runtime.currentSessionEpoch() || owner !== identity()
        || !session.sessionVerified || !session.authenticated || !session.user
        || Boolean(session.user.isSaasAdmin) !== (access.audience === "platform")
        || access.audience === "tenant" && !session.tenant?.tenantId
        || access.workspace && !session.currentWorkspaceId
        || !session.hasPermission(access.permission)) throw new DOMException("AI_SCOPE_CHANGED", "AbortError");
    };
    check();
    const result = await runtime.request<T>(path, {
      ...options,
      signal,
      ...(access.write ? { retryAuthentication: false } : {}),
    });
    check();
    return result;
  };
}
