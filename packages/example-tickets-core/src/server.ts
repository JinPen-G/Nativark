/** 样例使用租户范围；绑定和权限来源须由原宿主提供，注册成功不创造绑定或业务数据。 */
import type { CoreBinding, CoreScopeRequest, CoreServerContribution } from "@rental-os/core-contracts";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION, TICKETS_DATA_VERSION } from "./contracts";

export interface TicketsScopeAuthority {
  resolveAuthorizedBinding(request: CoreScopeRequest): Promise<CoreBinding | undefined>;
}

export function createTicketsServer(authority: TicketsScopeAuthority): CoreServerContribution {
  return {
    coreId: TICKETS_CORE_ID,
    implementationVersion: TICKETS_CORE_VERSION,
    async resolveScope(request) {
      if (request.scope.coreId !== TICKETS_CORE_ID || request.scope.tenantId !== request.principal.tenantId
        || request.scope.container || request.principal.audience !== "operator") return { status: "denied" };
      const binding = await authority.resolveAuthorizedBinding(request);
      if (!binding) return { status: "unbound" };
      if (binding.coreId !== TICKETS_CORE_ID || binding.tenantId !== request.principal.tenantId || binding.container)
        return { status: "denied" };
      return { status: "resolved", binding };
    },
    async readReadiness(binding) {
      return binding.coreId === TICKETS_CORE_ID && !binding.container && binding.dataVersion === TICKETS_DATA_VERSION
        ? { status: "ready" }
        : { status: "unavailable", code: "tickets_data_version", message: "工单绑定或数据版本不符合当前实现" };
    }
    // 没有移除检查器时宿主继续阻止移除代码，保留历史工单/操作收据读取者。
  };
}
