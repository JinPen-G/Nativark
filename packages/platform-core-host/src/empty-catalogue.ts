/** 受控装配明确选择零Core的目录。没有默认业务、数据就绪或授权，所有Core准入都拒绝。 */
import { registerCoreHttpRoutes } from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";

export function createEmptyCoreCatalogue(): CoreDeployedCatalogue {
  const routes = registerCoreHttpRoutes([]);
  if (!routes.ok) throw new Error("空Core HTTP目录不符合正式合同");
  const unavailable = async () => { throw new CoreAccessError("core_unavailable", "当前宿主未装配任何业务Core"); };
  return Object.freeze({
    get registrations() { return new Map(); },
    http: routes.registry,
    availability: Object.freeze({ requireRegistered: unavailable, requireAvailable: unavailable })
  });
}
