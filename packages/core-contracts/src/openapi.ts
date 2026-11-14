/**
 * Core 的 OpenAPI 3.0 片段与确定性组合；仅组织接口文档，不创建路由或授予调用权限。
 * 现有 Rental 旧路由通过宿主明确给出的兼容清单接入，Core 自己不能声明例外。
 */
import { z } from "zod";
import type { CoreManifest } from "./manifest";

const object = z.record(z.unknown());
export const CoreOpenApiContributionSchema = z.object({
  paths: z.record(object),
  schemas: z.record(object)
}).strict();
export type CoreOpenApiContribution = z.infer<typeof CoreOpenApiContributionSchema>;
export interface CoreOpenApiIssue { code: string; field: string; message: string }
export interface CoreOpenApiSource {
  manifest: CoreManifest;
  contribution: CoreOpenApiContribution;
}
export interface PlatformOpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  paths: CoreOpenApiContribution["paths"];
  components: { schemas: CoreOpenApiContribution["schemas"]; [key: string]: unknown };
  [key: string]: unknown;
}
const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const componentName = /^[A-Za-z0-9_.-]+$(?![\s\S])/;

/** 已解析的片段采用标准 OpenAPI 字段；本检查只负责归属和最小文档约束。 */
export function checkCoreOpenApi(
  manifest: CoreManifest,
  contribution: CoreOpenApiContribution,
  legacyRoutes: readonly string[] = []
): CoreOpenApiIssue[] {
  const issues: CoreOpenApiIssue[] = [];
  const add = (code: string, field: string, message: string) => issues.push({ code, field, message });
  const namespace = `${manifest.id}.`;
  const prefix = `/api/cores/${manifest.id}`;
  const operationIds = new Set<string>();
  if (!manifest.entries.openapi) add("openapi_not_declared", "entries.openapi", "清单没有声明 OpenAPI 文件入口");
  for (const name of Object.keys(contribution.schemas)) {
    if (!componentName.test(name) || !name.startsWith(namespace) || name.length === namespace.length)
      add("schema_namespace", `schemas.${name}`, `schema 名称须以 ${namespace} 开头`);
  }
  for (const [route, item] of Object.entries(contribution.paths)) {
    const normalized = route.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, "parameter");
    if (!/^\/[A-Za-z0-9_./-]+$(?![\s\S])/.test(normalized) || normalized.split("/").slice(1).some(part => !part || part === "." || part === ".."))
      add("api_path", `paths.${route}`, "接口路径须为规范的本地 OpenAPI 路径");
    let count = 0;
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      count++;
      const key = `${method.toUpperCase()} ${route}`;
      const field = `paths.${route}.${method}`;
      if (route !== prefix && !route.startsWith(`${prefix}/`) && !legacyRoutes.includes(key))
        add("route_namespace", field, `新接口须位于 ${prefix}；旧路径例外仅由宿主授予`);
      if (!isObject(operation)) { add("api_operation", field, "HTTP 操作必须是对象"); continue; }
      const id = operation.operationId;
      if (typeof id !== "string" || !componentName.test(id) || !id.startsWith(namespace) || id.length === namespace.length)
        add("operation_namespace", `${field}.operationId`, `operationId 须以 ${namespace} 开头`);
      else if (operationIds.has(id)) add("duplicate_operation", `${field}.operationId`, "operationId 重复");
      else operationIds.add(id);
      if (typeof operation.summary !== "string" || !operation.summary.trim()) add("api_summary", field, "接口必须说明用途 summary");
      if (!isObject(operation.responses) || !Object.keys(operation.responses).length) add("api_response", field, "接口必须声明 responses");
      if (!Array.isArray(operation.security)) add("api_security", field, "接口须显式声明 security；公开接口使用空数组，文档声明不授予权限");
    }
    if (!count) add("api_path", `paths.${route}`, "路径至少需要一个 HTTP 操作");
  }
  for (const ref of schemaReferences(contribution)) {
    if (typeof ref !== "string" || !/^#\/components\/schemas\/[A-Za-z0-9_.-]+$(?![\s\S])/.test(ref))
      add("api_reference", "$ref", "片段仅允许本地 components/schemas 引用，不自动读取外部 URL 或文件");
  }
  return issues;
}

function schemaReferences(input: unknown): unknown[] {
  const result: unknown[] = [], queue: Array<{ value: unknown; map: boolean }> = [{ value: input, map: true }];
  const seen = new Set<object>();
  while (queue.length) {
    const { value, map } = queue.pop()!;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (!map && Object.hasOwn(value, "$ref")) result.push((value as Record<string, unknown>).$ref);
    for (const [key, child] of Object.entries(value)) {
      // 例子/default/enum 是业务值，属性映射中的 "$ref" 也可能只是合法字段名。
      if (!map && (["example", "value", "default", "enum"].includes(key) || key.startsWith("x-"))) continue;
      queue.push({ value: child, map: !map && ["schemas", "properties", "responses", "content", "headers", "examples", "links", "callbacks"].includes(key)
        || value === input });
    }
  }
  return result;
}

/** 只在整份组合无冲突时返回新文档；失败不修改原平台或任一 Core 片段。 */
export function composeCoreOpenApi(
  platform: PlatformOpenApiDocument,
  cores: readonly CoreOpenApiSource[],
  legacyRoutes: Readonly<Record<string, readonly string[]>> = {}
): { document?: PlatformOpenApiDocument; issues: CoreOpenApiIssue[] } {
  const issues: CoreOpenApiIssue[] = [];
  const document = structuredClone(platform);
  const operationIds = new Set<string>();
  const coreIds = new Set<string>();
  const routeShapes = new Set(Object.keys(document.paths).map(route => route.replace(/\{[^}]+\}/g, "{}")));
  for (const item of Object.values(document.paths)) for (const [method, operation] of Object.entries(item))
    if (methods.has(method) && isObject(operation) && typeof operation.operationId === "string") operationIds.add(operation.operationId);

  for (const { manifest, contribution } of cores) {
    if (coreIds.has(manifest.id)) issues.push({ code: "duplicate_core", field: manifest.id, message: "API 组合包含重复 Core" });
    coreIds.add(manifest.id);
    const ownIssues = checkCoreOpenApi(manifest, contribution, Object.hasOwn(legacyRoutes, manifest.id) ? legacyRoutes[manifest.id] : []);
    issues.push(...ownIssues);
    if (ownIssues.length) continue;
    for (const [name, schema] of Object.entries(contribution.schemas)) {
      if (Object.hasOwn(document.components.schemas, name)) issues.push({ code: "schema_collision", field: name, message: "schema 与已装配文档重复" });
      else document.components.schemas[name] = structuredClone(schema);
    }
    for (const [route, item] of Object.entries(contribution.paths)) {
      const shape = route.replace(/\{[^}]+\}/g, "{}");
      if (routeShapes.has(shape)) issues.push({ code: "route_collision", field: route, message: "路由与已装配文档重复，参数改名不形成新路径" });
      else { routeShapes.add(shape); document.paths[route] = structuredClone(item); }
      for (const [method, operation] of Object.entries(item)) {
        if (!methods.has(method) || !isObject(operation) || typeof operation.operationId !== "string") continue;
        if (operationIds.has(operation.operationId)) issues.push({ code: "operation_collision", field: operation.operationId, message: "operationId 与已装配文档重复" });
        operationIds.add(operation.operationId);
      }
    }
    for (const reference of schemaReferences(contribution)) {
      const name = (reference as string).slice("#/components/schemas/".length);
      if (!Object.hasOwn(contribution.schemas, name) && !Object.hasOwn(platform.components.schemas, name))
        issues.push({ code: "schema_reference_missing", field: reference as string, message: "引用须指向本 Core 或平台提供的 schema，不能隐式依赖另一个 Core" });
    }
  }
  return issues.length ? { issues } : { document, issues };
}
