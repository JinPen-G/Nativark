/** 运行前核定同一已准备CRM包。只读包/元数据，不下载或执行包内安装脚本。 */
import { dirname, resolve } from "node:path";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import type { CoreHostVersions } from "@rental-os/core-contracts";

export function requireCrmDeploymentPackage(pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const root = resolve(dirname(require.resolve("@rental-os/crm-core")), "..");
  return requireCorePackagePin(root, pin, host);
}
