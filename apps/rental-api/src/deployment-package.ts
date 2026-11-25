/** 运行前只读取实际依赖位置的标准包；相同版本名不足以替代固定文件摘要。 */
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CoreDeploymentLock, CoreHostVersions } from "@rental-os/core-contracts";
import { requireRentalDataPackage } from "@rental-os/rental-core/data-package";
import { rentalHostLegacyApiRoutes, rentalHostReleaseOpenApi } from "./openapi";

export function requireRentalDeploymentPackage(pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const root = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
  const selected = requireRentalDataPackage(root, pin, host, rentalHostLegacyApiRoutes());
  const expectedOpenApi = rentalHostReleaseOpenApi(selected.manifest.entries.openapi);
  if (!selected.openapi || !isDeepStrictEqual(selected.openapi, JSON.parse(JSON.stringify(expectedOpenApi))))
    throw new Error("Rental 固定包缺少与当前实际处理器同源的 OpenAPI 贡献");
  return selected;
}
