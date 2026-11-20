/** Rental 宿主的实际发行组合；调用者提供已构建字节和固定来源。
 * OpenAPI 来自原同源工厂，旧路径许可来自真实挂载处理器，不产生伪造发行清单。 */
import { createRentalPackage } from "@rental-os/rental-core/package";
import { createRentalOpenApi } from "@rental-os/rental-core/http-openapi";
import { rentalHostLegacyApiRoutes } from "./openapi";

export function createRentalHostPackage(input: Omit<Parameters<typeof createRentalPackage>[0], "contributions" | "legacyApiRoutes">) {
  const file = "dist/http-openapi.json", files = new Map(input.files);
  if (files.has(file)) throw new Error("Rental OpenAPI 由本次同源工厂生成，不能覆盖调用方文件");
  files.set(file, Buffer.from(JSON.stringify(createRentalOpenApi()) + "\n"));
  return createRentalPackage({ ...input, files, contributions: { openapi: file }, legacyApiRoutes: rentalHostLegacyApiRoutes() });
}
