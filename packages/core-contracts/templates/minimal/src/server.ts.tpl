/** 当前绑定与业务就绪由真实宿主提供；没有权威时不可用，注册不创建绑定或授予角色。 */
import { isCoreVersionSupported, type CoreBinding, type CoreScopeRequest, type CoreServerContribution } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION, DATA_READABLE } from "./contracts";

export interface ScopeAuthority {
  resolveAuthorizedBinding(request: CoreScopeRequest): Promise<CoreBinding | undefined>;
  readReadiness: CoreServerContribution["readReadiness"];
}
export function createServer(authority: ScopeAuthority): CoreServerContribution {
  return {
    coreId: CORE_ID, implementationVersion: CORE_VERSION,
    async resolveScope(request) {
      if (request.scope.coreId !== CORE_ID || request.scope.tenantId !== request.principal.tenantId
        || request.scope.container || request.principal.audience !== "operator") return { status: "denied" };
      if (typeof authority?.resolveAuthorizedBinding !== "function") return { status: "denied" };
      const binding = await authority.resolveAuthorizedBinding(request);
      if (!binding) return { status: "unbound" };
      if (binding.coreId !== CORE_ID || binding.tenantId !== request.principal.tenantId || binding.container)
        return { status: "denied" };
      return { status: "resolved", binding };
    },
    async readReadiness(binding) {
      if (binding.coreId !== CORE_ID || binding.container || !isCoreVersionSupported(binding.dataVersion, DATA_READABLE)
        || typeof authority?.readReadiness !== "function")
        return { status: "unavailable", code: "core_adapter_unavailable", message: "缺少当前数据与业务就绪依据" };
      return authority.readReadiness(binding);
    }
  };
}
