/** Rental 能力目录、原配置写入与生命周期审计复用宿主唯一认证请求。 */
import type {
  SaveWorkspaceCapabilityRequest,
  UpgradeWorkspaceCapabilityRequest,
  WorkspaceCapabilityAuditEvent,
  WorkspaceCapabilityInstance,
  WorkspaceCapabilityOverview
} from "@rental-os/rental-core";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";

type ReadOptions = Pick<AdminRequestOptions, "signal">;

export function createRentalCapabilityApi(request: AdminRuntime["request"]) {
  return {
    capabilities: (options?: ReadOptions) => request<WorkspaceCapabilityOverview>(
      "/rental/v1/capabilities", options?.signal ? { signal: options.signal } : undefined
    ),
    saveCapability: (data: SaveWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>(
      "/rental/v1/capabilities", { method: "put", data }
    ),
    upgradeCapability: (code: string, data: UpgradeWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>(
      `/rental/v1/capabilities/${encodeURIComponent(code)}/upgrade`, { method: "post", data }
    ),
    capabilityAudits: (code?: string, options?: ReadOptions) => request<WorkspaceCapabilityAuditEvent[]>(
      "/rental/v1/capability-audits", {
        params: { code },
        ...(options?.signal ? { signal: options.signal } : {})
      }
    )
  };
}

export type RentalCapabilityApi = ReturnType<typeof createRentalCapabilityApi>;
