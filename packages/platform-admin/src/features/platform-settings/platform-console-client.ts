/** SaaS 原组织/账号/角色/审计页复用现有公共客户端。
 * 页面准入不放宽服务端租户政策，接口拒绝保留原失败 Promise。
 */
import { useMemo } from "react";
import { createPublicManagementApi } from "../access/management-client";
import { usePlatformPageRuntime } from "./page-runtime";

export { createPublicManagementApi as createPlatformConsoleApi } from "../access/management-client";

export function usePlatformConsoleApi() {
  const { request, epoch, isCurrent } = usePlatformPageRuntime("saas", "system:user:manage");
  const api = useMemo(() => createPublicManagementApi(request), [request]);
  return { api, epoch, isCurrent };
}
