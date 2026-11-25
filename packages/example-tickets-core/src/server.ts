/** 样例使用租户范围；绑定和权限来源须由原宿主提供，注册成功不创造绑定或业务数据。 */
import { isCoreVersionSupported, type CoreBinding, type CoreScopeRequest, type CoreServerContribution } from "@rental-os/core-contracts";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION, TICKETS_DATA_READABLE } from "./contracts";

export interface TicketsScopeAuthority {
  resolveAuthorizedBinding(request: CoreScopeRequest): Promise<CoreBinding | undefined>;
  /** 原业务数据所有者读取移除依赖；未提供时保持宿主的缺检查器拒绝。 */
  assessRemoval?: CoreServerContribution["assessRemoval"];
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
      // 兼容更新保留原绑定；它的初始化版本不替代宿主对当前物理库/迁移账的就绪检查。
      return binding.coreId === TICKETS_CORE_ID && !binding.container && isCoreVersionSupported(binding.dataVersion, TICKETS_DATA_READABLE)
        ? { status: "ready" }
        : { status: "unavailable", code: "tickets_data_version", message: "工单绑定或数据版本不符合当前实现" };
    },
    ...(authority.assessRemoval ? { assessRemoval: authority.assessRemoval.bind(authority) } : {})
  };
}
