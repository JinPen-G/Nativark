/** 运行前只读取实际依赖位置的标准包；相同版本名不足以替代固定文件摘要。 */
import { dirname, resolve } from "node:path";
import type { CoreDeploymentLock, CoreHostVersions } from "@rental-os/core-contracts";
import { requireRentalDataPackage } from "@rental-os/rental-core/data-package";

export function requireRentalDeploymentPackage(pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const root = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
  return requireRentalDataPackage(root, pin, host);
}
