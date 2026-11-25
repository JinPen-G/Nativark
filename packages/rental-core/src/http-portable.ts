/** 从已审定的 Rental v1 实际处理器派生公开包入口和宿主路径映射。
 * 映射在原 Guard 和请求作用域前完成。身份、授权、参数解析及业务执行仍走同一原处理器。 */
import type { CoreOpenApiContribution } from "@rental-os/core-contracts";
import type { RentalHttpAccessPolicy } from "./http-access-policy";

const originalPrefix = "/api/rental/v1";
const portablePrefix = "/api/cores/rental/v1";
export const RENTAL_PORTABLE_OPENAPI_FILE = "dist/http-openapi-portable.json";
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const shape = (path: string) => path.replace(/:[a-z0-9_]+|\{[a-z0-9_]+\}/giu, "{}").toLowerCase();

function matchOriginalRoute(path: string) {
  const segments = path.split("/").slice(1);
  if (segments.some(segment => !/^(?::[a-z0-9_]+|[a-z0-9_.-]+)$/iu.test(segment))) {
    throw new Error(`Rental 公开入口缺少可核定的路径模板：${path}`);
  }
  return new RegExp(`^/${segments.map(segment => segment.startsWith(":") ? "[^/]+" : segment.replace(/\./gu, "\\.")).join("/")}$`, "iu");
}

function isOrdinaryPath(path: string): boolean {
  return path.split("/").slice(1).every(segment => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded !== "." && decoded !== ".." && /^[^/\\%?#\p{Cc}]+$/u.test(decoded);
    } catch {
      return false;
    }
  });
}

export function createRentalPortableHttp(policy: Pick<RentalHttpAccessPolicy, "routes" | "assertReviewed">,
  original: CoreOpenApiContribution) {
  policy.assertReviewed();
  const routes = new Map<string, { method: string; pattern: RegExp; eligible: boolean; published: boolean }>();
  for (const route of policy.routes) {
    const source = `/api${route.path}`;
    if (!source.startsWith(`${originalPrefix}/`)) continue;
    const method = route.method.toLowerCase();
    const key = `${method} ${shape(source)}`;
    if (routes.has(key)) throw new Error(`Rental 公开入口遇到重复实际处理器：${key}`);
    routes.set(key, { method, pattern: matchOriginalRoute(source),
      eligible: methods.has(method) && !route.review.ingress && route.review.kind !== "disabled-feature",
      published: false });
  }

  const paths: CoreOpenApiContribution["paths"] = {};
  for (const [path, operations] of Object.entries(original.paths)) {
    if (!path.startsWith(`${originalPrefix}/`)) continue;
    const projected: Record<string, unknown> = {};
    for (const [method, value] of Object.entries(operations)) {
      if (!methods.has(method)) continue;
      const route = routes.get(`${method} ${shape(path)}`);
      if (!route) throw new Error(`Rental 公开文档没有实际处理器：${method} ${path}`);
      if (!route.eligible) continue;
      if (!value || typeof value !== "object" || !("operationId" in value) || typeof value.operationId !== "string"
        || !value.operationId.startsWith("rental.")) {
        throw new Error(`Rental 公开文档缺少正式操作标识：${method} ${path}`);
      }
      route.published = true;
      projected[method] = { ...value, operationId: `rental.portable.${value.operationId.slice("rental.".length)}` };
    }
    if (Object.keys(projected).length) paths[portablePrefix + path.slice(originalPrefix.length)] = projected;
  }
  if (!Object.keys(paths).length) throw new Error("Rental 公开入口缺少已审定的业务路径");
  const actualRoutes = [...routes.values()];

  return {
    contribution: { paths, schemas: original.schemas } satisfies CoreOpenApiContribution,
    originalUrl(method: string, url: string): string | undefined {
      const queryStart = url.indexOf("?");
      const path = queryStart < 0 ? url : url.slice(0, queryStart);
      if (!path.startsWith(`${portablePrefix}/`) || !isOrdinaryPath(path)) return;
      const originalPath = originalPrefix + path.slice(portablePrefix.length);
      const requestMethod = method.toLowerCase();
      const matches = actualRoutes.filter(route => route.method === requestMethod && route.pattern.test(originalPath));
      // Nest 可在模板路径之前匹配同形的字面路径。只有所有可能目标都已发布时才映射。
      if (!matches.length || matches.some(route => !route.published)) return;
      return originalPath + (queryStart < 0 ? "" : url.slice(queryStart));
    },
  };
}
