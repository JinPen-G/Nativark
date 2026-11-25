/** 平台演示预约只读客户端；复用当前 SaaS 会话，不联系线索或改变预约状态。 */
import { useMemo } from "react";
import type { DemoRequestListQuery, DemoRequestPage } from "@rental-os/platform-contracts";
import type { AdminRuntime } from "../../runtime";
import { usePlatformPageRuntime } from "./page-runtime";

export function createDemoRequestsApi(request: AdminRuntime["request"]) {
  return {
    list: (query: DemoRequestListQuery, signal?: AbortSignal) =>
      request<DemoRequestPage>("/platform/demo-requests", { params: query, signal })
  };
}

export function useDemoRequestsApi() {
  const { request, epoch } = usePlatformPageRuntime("saas", "system:demo-request:view");
  return { api: useMemo(() => createDemoRequestsApi(request), [request]), epoch };
}
