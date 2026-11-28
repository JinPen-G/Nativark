/** 运行前只读核定本宿主实际解析的标准包；同名/同版本不能替代固定字节。 */
import { dirname, resolve } from "node:path";
import type { CoreDeploymentLock, CoreHostVersions } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
export function requireDeploymentPackage(pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  return requireCorePackagePin(resolve(dirname(require.resolve("{{PACKAGE_NAME}}")), ".."), pin, host);
}
