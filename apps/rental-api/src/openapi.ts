/** 宿主从真实 HTTP 政策授予逐条旧路径许可，并与实际发行清单组合文档。
 * 文档不证明部署/权限可用；未描述字段、未挂路径与停用功能保留明确缺口。 */
import { composeCoreOpenApi, CoreDeploymentLockSchema, type CoreDeploymentLock, type CoreOpenApiSource } from "@rental-os/core-contracts";
import { isDeepStrictEqual } from "node:util";
import { createPlatformOpenApi } from "@rental-os/platform-server";
import { createPlatformCoreOpenApi, createPlatformCorePackageOpenApi } from "@rental-os/platform-core-host";
import { createRentalOpenApi, RENTAL_HTTP_DOCUMENTATION_GAPS } from "@rental-os/rental-core/http-openapi";
import { createRentalHostHttpPolicy } from "./http-policy";

type Policy = ReturnType<typeof createRentalHostHttpPolicy>;
const shape = (path: string) => path.replace(/^\/api(?=\/)/, "").replace(/:[^/]+|\{[^}]+\}/g, "{}").toLowerCase();
const key = (method: string, path: string) => `${method.toUpperCase()} ${shape(path)}`;
const operationMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

/** A Core contribution can request an exact legacy path only when this host
 * actually mounts the same reviewed method/handler. Missing docs are not invented. */
export function createRentalHostOpenApiContribution(policy: Policy = createRentalHostHttpPolicy()) {
  policy.assertReviewed();
  const routes = new Map(policy.routes.map(route => [key(route.method, route.path), route]));
  if (routes.size !== policy.routes.length) throw new Error("Rental 宿主重复挂载同形 HTTP 处理器");
  const contribution = createRentalOpenApi(), covered = new Set<string>(), legacyRoutes: string[] = [];
  for (const [path, item] of Object.entries(contribution.paths)) for (const [method, value] of Object.entries(item)) {
    if (!operationMethods.has(method)) continue;
    const identity = key(method, path), route = routes.get(identity);
    if (!route || covered.has(identity)) throw new Error(`Rental 文档没有唯一实际挂载处理器：${method.toUpperCase()} ${path}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Rental 文档操作格式无效");
    covered.add(identity); legacyRoutes.push(`${method.toUpperCase()} ${path}`);
    const operation = value as Record<string, unknown>;
    operation["x-hostHandler"] = `${route.controller.name}.${route.handlerName}`;
    operation["x-hostAccess"] = route.review.kind;
    operation["x-hostAvailability"] = route.review.kind === "disabled-feature" ? "unavailable" : "current-authorization-and-deployment-required";
    if (route.recovery) operation["x-coreDisabledRecovery"] = route.recovery.kind;
  }
  const missing = policy.routes.filter(route => !covered.has(key(route.method, route.path))).map(route => {
    const gap = RENTAL_HTTP_DOCUMENTATION_GAPS.find(item => item.kind === "missing-operation"
      && key(item.method, item.path) === key(route.method, route.path)
      && item.source === `${route.controller.name}.${route.handlerName}`);
    if (!gap) throw new Error(`Rental 新增未描述处理器：${route.controller.name}.${route.handlerName}`);
    return { method: gap.method, path: gap.path, source: gap.source, kind: gap.kind,
      availability: route.review.kind === "disabled-feature" ? "unavailable" : "current-authorization-and-deployment-required" };
  });
  for (const gap of RENTAL_HTTP_DOCUMENTATION_GAPS) {
    if (gap.kind === "missing-operation" && !missing.some(item => key(item.method, item.path) === key(gap.method, gap.path)))
      throw new Error(`Rental 文档缺口与实际挂载不一致：${gap.source}`);
    if (gap.kind === "unmounted-legacy-operation" && routes.has(key(gap.method, gap.path)))
      throw new Error(`Rental 原未挂路径已变化，须核对其正式文档：${gap.source}`);
  }
  return { contribution, legacyRoutes: Object.freeze(legacyRoutes.sort()), documentationGaps: [
    ...missing, ...RENTAL_HTTP_DOCUMENTATION_GAPS.filter(gap => gap.kind === "unmounted-legacy-operation")
  ] };
}

export function rentalHostLegacyApiRoutes(): readonly string[] {
  return createRentalHostOpenApiContribution().legacyRoutes;
}

export function createRentalHostOpenApi(lockValue: CoreDeploymentLock, policy: Policy = createRentalHostHttpPolicy(),
  additional: readonly CoreOpenApiSource[] = []) {
  const lock = CoreDeploymentLockSchema.parse(lockValue);
  const rental = lock.cores.find(pin => pin.manifest.id === "rental"), extras = lock.cores.filter(pin => pin.manifest.id !== "rental");
  if (!rental || additional.length !== extras.length
    || new Set(additional.map(item => item.manifest.id)).size !== additional.length
    || additional.some(item => !extras.some(pin => isDeepStrictEqual(pin.manifest, item.manifest))))
    throw new Error("Rental 文档及额外贡献须逐项来自实际宿主完整清单");
  const { contribution, legacyRoutes, documentationGaps } = createRentalHostOpenApiContribution(policy);
  const result = composeCoreOpenApi(createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi())),
    [{ manifest: rental.manifest, contribution }, ...additional], { rental: legacyRoutes });
  if (!result.document) throw new Error(result.issues.map(issue => `${issue.field}: ${issue.message}`).join("\n"));
  result.document["x-rentalDocumentationGaps"] = documentationGaps;
  result.document["x-rentalSchemaStatus"] = "incomplete";
  return result.document;
}
