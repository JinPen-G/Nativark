/** Rental 宿主的实际发行组合；调用者提供已构建字节和固定来源。
 * OpenAPI 来自原同源工厂，旧路径许可来自真实挂载处理器，不产生伪造发行清单。 */
import { createRentalPackage } from "@rental-os/rental-core/package";
import { RENTAL_PORTABLE_OPENAPI_FILE } from "@rental-os/rental-core/http-openapi";
import { rentalHostLegacyApiRoutes, rentalHostReleaseOpenApi } from "./openapi";

export function createRentalHostPackage(input: Omit<Parameters<typeof createRentalPackage>[0], "contributions" | "legacyApiRoutes">,
  edition: "legacy-host" | "portable" = "legacy-host") {
  if (edition !== "legacy-host" && edition !== "portable") throw new Error("未登记的 Rental 发行类型");
  const legacyFile = "dist/http-openapi.json", files = new Map(input.files);
  if (files.has(legacyFile) || files.has(RENTAL_PORTABLE_OPENAPI_FILE)) {
    throw new Error("Rental OpenAPI 由本次同源工厂生成，不能覆盖调用方文件");
  }
  const portable = edition === "portable";
  const file = portable ? RENTAL_PORTABLE_OPENAPI_FILE : legacyFile;
  // 两种文档从同一处理器生成，独立更新保留旧文档路径；清单仍只选择一个正式入口。
  for (const document of [legacyFile, RENTAL_PORTABLE_OPENAPI_FILE] as const) {
    files.set(document, Buffer.from(JSON.stringify(rentalHostReleaseOpenApi(document)) + "\n"));
  }
  return createRentalPackage({ ...input, files, contributions: { openapi: file },
    legacyApiRoutes: portable ? [] : rentalHostLegacyApiRoutes() });
}
