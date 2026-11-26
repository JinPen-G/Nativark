/** AI 文档从原单源操作裁剪至本宿主真实挂载范围。缺失操作继续显式留缺口，
 * 不把其它宿主或未接完的模型/任务能力放进本发行可调用路径。 */
import type { CoreDeploymentLock, CoreOpenApiSource } from "@rental-os/core-contracts";
import { buildPaths, RENTAL_HTTP_OPERATIONS, type SchemaObject } from "@rental-os/rental-core/http-openapi";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import { AI_HTTP_COMPONENT_SCHEMAS, AI_HTTP_OPERATIONS } from "@rental-os/ai-native-server/runtime/contracts/http-openapi";
import { AI_STAFF_INSPECTION_HTTP_DRAFT } from "@rental-os/shared";
import { createRentalHostOpenApi } from "./openapi";
import { RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS, createRentalAiHttpPolicy } from "./ai-http-policy";

// 原 OpenAPI 使用 {name}，Nest 使用 :name；统一声明模板后仍按实际方法与处理器闭集选择。
const templatePath = (path: string) => matchableRequestPath(path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, ":$1"));

export function createRentalAiOpenApi(lock: CoreDeploymentLock, policy = createRentalAiHttpPolicy(),
  additional: readonly CoreOpenApiSource[] = []) {
  policy.assertReviewed();
  const rental = createRentalHostOpenApi(lock, { ...policy,
    routes: Object.freeze(policy.routes.filter(route => !RENTAL_AI_CONTROLLERS.some(controller => route.controller === controller))) }, additional);
  // 此组合确实装配原检查证据工厂，恢复其同源成功合同；无 AI 的固定 Core
  // 贡献继续保留 503。文档选择来自已审定处理器，不是请求或清单的启用标记。
  const evidencePath = "/api/staff/v1/uploads/{fileAssetId}/inspection-binding";
  const evidence = rental.paths[evidencePath]?.post as Record<string, unknown> | undefined;
  const originalEvidence = RENTAL_HTTP_OPERATIONS.find(operation => operation.path === evidencePath && operation.method === "post");
  if (!evidence || !originalEvidence || evidence["x-hostAccess"] !== "transactional-write")
    throw new Error("AI 检查证据文档缺少同源实际写入接点");
  const rentalReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rentalReferences);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== "$ref" || typeof child !== "string" || !child.startsWith("#/components/schemas/"))
        return [key, rentalReferences(child)];
      const name = `rental.${child.slice("#/components/schemas/".length)}`;
      if (!Object.hasOwn(rental.components!.schemas!, name)) throw new Error("AI 检查证据缺少原 Rental schema");
      return [key, `#/components/schemas/${name}`];
    }));
  };
  const originalResponses = (buildPaths([originalEvidence])[evidencePath].post as Record<string, unknown>).responses;
  evidence.responses = rentalReferences(originalResponses);
  delete evidence["x-availability"];
  const routes = policy.routes.filter(route => RENTAL_AI_CONTROLLERS.some(controller => route.controller === controller));
  const manualBase = matchableRequestPath(`/${AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}`);
  const selected = AI_HTTP_OPERATIONS.filter(operation => {
    const path = templatePath(operation.path), method = operation.method.toUpperCase();
    if (path.startsWith(manualBase + "/") && !RENTAL_AI_INSPECTION_OPERATIONS.includes(path.slice(manualBase.length + 1))) return false;
    return routes.some(route => route.method === method && (route.path === path
      || route.path === manualBase + "/:operation" && path.startsWith(manualBase + "/")));
  });
  const identities = selected.map(operation => `${operation.method} ${operation.path}`);
  if (new Set(identities).size !== identities.length) throw new Error("AI 原文档有重复操作，不能覆盖产物");
  const paths = buildPaths(selected), schemas: Record<string, SchemaObject> = {};
  const prefix = "#/components/schemas/";
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== "$ref" || typeof child !== "string" || !child.startsWith(prefix)) return [key, rewrite(child)];
      const name = child.slice(prefix.length), target = `ai-native.${name}`;
      if (!(target in schemas)) {
        const source = AI_HTTP_COMPONENT_SCHEMAS[name];
        if (!source) throw new Error(`AI 原 schema 引用缺失：${name}`);
        schemas[target] = {};
        schemas[target] = rewrite(source) as SchemaObject;
      }
      return [key, prefix + target];
    }));
  };
  const contribution = rewrite(paths) as typeof paths;
  for (const [path, methods] of Object.entries(contribution)) {
    if (Object.prototype.hasOwnProperty.call(rental.paths, path)) throw new Error("AI 文档与原宿主路径冲突");
    rental.paths[path] = methods;
  }
  Object.assign(rental.components!.schemas!, schemas);
  rental["x-aiNativeMountedControllers"] = RENTAL_AI_CONTROLLERS.map(controller => controller.name);
  const expandedRoutes = routes.flatMap(route => route.path === `${manualBase}/:operation`
    ? RENTAL_AI_INSPECTION_OPERATIONS.map(operation => ({ method: route.method, path: `${manualBase}/${operation}` }))
    : [{ method: route.method, path: route.path }]);
  rental["x-aiNativeDocumentationGaps"] = expandedRoutes.filter(route =>
    !selected.some(item => item.method.toUpperCase() === route.method && templatePath(item.path) === route.path))
    .map(route => ({ ...route, path: `/api${route.path}`, kind: "missing-original-operation" }));
  return rental;
}
