/** Rental 的标准 Core 服务端贡献。业务空间和配置仍由原 Rental 应用创建；
 * 本入口解析已授权的原空间绑定、读取当前配置，不重建空间或改写品类历史。 */
import { isCoreVersionSupported, matchesCoreScope, type CoreBinding, type CoreScopeRequest,
  type CoreServerContribution } from "@rental-os/core-contracts";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION, RENTAL_WORKSPACE_CONTAINER_TYPE, RENTAL_CORE_SCOPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";

export interface RentalServerAuthority {
  resolveAuthorizedBinding(request: CoreScopeRequest): Promise<CoreBinding | undefined>;
  readReadiness: CoreServerContribution["readReadiness"];
  assessRemoval?: CoreServerContribution["assessRemoval"];
}

export function isRentalCoreScope(scope: Pick<CoreBinding, "coreId" | "container">): boolean {
  return scope.coreId === RENTAL_CORE_ID && matchesCoreScope(RENTAL_CORE_SCOPE, scope.container);
}

export function createRentalServer(authority: RentalServerAuthority): CoreServerContribution {
  return {
    coreId: RENTAL_CORE_ID,
    implementationVersion: RENTAL_CORE_VERSION,
    async resolveScope(request) {
      if (!isRentalCoreScope(request.scope) || request.scope.tenantId !== request.principal.tenantId
        || request.principal.audience !== "operator") return { status: "denied" };
      const binding = await authority.resolveAuthorizedBinding(request);
      if (!binding) return { status: "unbound" };
      if (!isRentalCoreScope(binding) || binding.tenantId !== request.scope.tenantId
        || binding.container?.type !== request.scope.container?.type
        || binding.container?.id !== request.scope.container?.id) return { status: "denied" };
      return { status: "resolved", binding };
    },
    async readReadiness(binding) {
      if (!isRentalCoreScope(binding) || !isCoreVersionSupported(binding.dataVersion, RENTAL_DATA_READABLE))
        return { status: "unavailable", code: "rental_binding_version", message: "Rental绑定范围或数据版本不兼容" };
      return authority.readReadiness(binding);
    },
    ...(authority.assessRemoval ? { assessRemoval: authority.assessRemoval.bind(authority) } : {})
  };
}

export { RENTAL_CORE_ID, RENTAL_CORE_VERSION, RENTAL_WORKSPACE_CONTAINER_TYPE, RENTAL_CORE_SCOPE } from "./core-identity";
