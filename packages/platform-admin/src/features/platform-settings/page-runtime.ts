/** 原页面使用现有管理生命周期和唯一请求，失效响应不投影到后续页面。 */
import { useMemo } from "react";
import { useManagementLifetime } from "../access/management-lifetime";
import type { AdminRequestOptions, AdminRuntime } from "../../runtime";

export function usePlatformPageRuntime(audience: "saas" | "tenant", permission: string) {
  const lifetime = useManagementLifetime(audience, permission);
  const { runtime, epoch } = lifetime;
  const request = useMemo<AdminRuntime["request"]>(() => async <T>(path: string, options?: AdminRequestOptions) => {
    const current = lifetime.current();
    const signal = options?.signal ? AbortSignal.any([current, options.signal]) : current;
    const result = await runtime.request<T>(path, { ...options, signal });
    lifetime.current();
    return result;
  }, [runtime, epoch, audience, permission]);
  return { request, epoch, isCurrent: lifetime.isCurrent };
}
