/** 当前宿主提供真实范围和会话刷新，能力请求保持原经营空间与会话代次。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalCapabilityApi, type RentalCapabilityApi } from "./client";

export interface RentalCapabilityPageContext {
  api: RentalCapabilityApi;
  /** 由当前租户、经营空间、用户、权限和宿主会话代次组成。 */
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  /** 沿宿主原会话读取刷新已启用能力，菜单使用同一授权快照。 */
  refreshSession: () => Promise<unknown>;
}

export function createRentalCapabilityPageContext({ runtime, scopeKey, currentScopeKey, refreshSession }: {
  runtime: AdminRuntime;
  scopeKey: string;
  currentScopeKey: RentalCapabilityPageContext["currentScopeKey"];
  refreshSession: RentalCapabilityPageContext["refreshSession"];
}): RentalCapabilityPageContext {
  const assertCurrent = () => {
    if (!scopeKey || currentScopeKey() !== scopeKey)
      throw new DOMException("能力页面的会话或经营空间已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Result,>(path: string,
    options?: AdminRequestOptions): Promise<Result> => {
    assertCurrent();
    const result = await runtime.request<Result>(path, options);
    assertCurrent();
    return result;
  };
  return {
    api: createRentalCapabilityApi(request),
    scopeKey,
    currentScopeKey,
    refreshSession: async () => {
      assertCurrent();
      return refreshSession();
    }
  };
}
