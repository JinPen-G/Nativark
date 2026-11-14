/** Core HTTP路由的受控政策登记；只查已登记方法/路径，不加载处理器、不授予角色或替代业务校验。 */
import { z } from "zod";
import { CoreIdSchema, corePermissionCode, type CoreManifest } from "./manifest";
import { CoreReleaseVersionSchema } from "./version";

const localId = z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$(?![\s\S])/);
const routePath = z.string().min(1).max(240).refine(path => {
  if (path === "/") return true;
  const segments = path.split("/");
  return segments.shift() === "" && segments.every(segment => /^(?:[a-z0-9][a-z0-9_-]*|:[a-z][a-zA-Z0-9]*)$(?![\s\S])/.test(segment))
    && new Set(segments.filter(segment => segment.startsWith(":"))).size === segments.filter(segment => segment.startsWith(":")).length;
}, "使用Core内规范HTTP路径；不支持通配、表达式、外部URL或重复参数");

export const CoreHttpRouteSchema = z.object({
  id: localId,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  path: routePath,
  audiences: z.array(z.enum(["operator", "staff", "client"])).min(1).max(3),
  permissions: z.array(z.object({ resource: localId, action: localId }).strict()),
  purpose: z.enum(["business", "original_receipt"]),
  /** 对新增收费/业务承诺的归类由Core明确声明，最终期限仍由原服务复核。 */
  startsNewBusiness: z.boolean()
}).strict().superRefine((route, context) => {
  if (new Set(route.audiences).size !== route.audiences.length)
    context.addIssue({ code: "custom", path: ["audiences"], message: "认证分面不能重复" });
  if (route.purpose === "original_receipt" && (route.startsNewBusiness || !["GET", "HEAD", "POST"].includes(route.method)))
    context.addIssue({ code: "custom", path: ["purpose"], message: "原收据只能使用明确的只读方法且不创建新业务" });
});
export type CoreHttpRoute = z.infer<typeof CoreHttpRouteSchema>;
export const CoreHttpContributionSchema = z.object({
  coreId: CoreIdSchema,
  implementationVersion: CoreReleaseVersionSchema,
  routes: z.array(CoreHttpRouteSchema).max(1000)
}).strict();
export type CoreHttpContribution = z.infer<typeof CoreHttpContributionSchema>;
export interface CoreHttpPolicy extends CoreHttpRoute { coreId: string; key: string; fullPath: string; permissionCodes: string[] }
export interface CoreHttpRegistry {
  readonly entries: readonly CoreHttpPolicy[];
  /** path使用原宿主归一后、剥离/api但保留参数大小写的路径；未知路由保持未登记。 */
  resolve(method: string, path: string, audience: "operator" | "staff" | "client"): CoreHttpPolicy | undefined;
}
export type CoreHttpRegistrationResult = { ok: true; registry: CoreHttpRegistry }
  | { ok: false; issues: Array<{ coreId: string; field: string; message: string }> };

function overlaps(left: string, right: string): boolean {
  const a = left.split("/"), b = right.split("/");
  return a.length === b.length && a.every((part, index) => part.startsWith(":") || b[index].startsWith(":") || part === b[index]);
}

/** HTTP贡献由Core的实际接口声明生成，范围和原结果政策仍由所属服务执行，空组合合法。 */
export function registerCoreHttpRoutes(sources: readonly { manifest: CoreManifest; contribution: CoreHttpContribution }[]): CoreHttpRegistrationResult {
  const issues: Array<{ coreId: string; field: string; message: string }> = [], entries: CoreHttpPolicy[] = [], coreIds = new Set<string>();
  for (const { manifest, contribution } of sources) {
    const add = (field: string, message: string) => issues.push({ coreId: manifest.id, field, message });
    const parsed = CoreHttpContributionSchema.safeParse(contribution);
    if (!parsed.success) { parsed.error.issues.forEach(issue => add(issue.path.join("."), issue.message)); continue; }
    if (coreIds.has(manifest.id)) add("coreId", "同一组合不能重复登记Core HTTP贡献");
    coreIds.add(manifest.id);
    if (parsed.data.coreId !== manifest.id || parsed.data.implementationVersion !== manifest.version)
      add("implementationVersion", "HTTP贡献的Core标识和实现版本须与当前清单一致");
    const allowed = new Set(manifest.permissions.map(permission => corePermissionCode(manifest.id, permission))), ids = new Set<string>();
    for (const route of parsed.data.routes) {
      if (ids.has(route.id)) add(`routes.${route.id}`, "HTTP操作标识重复");
      ids.add(route.id);
      const permissionCodes = route.permissions.map(permission => corePermissionCode(manifest.id, permission));
      if (permissionCodes.some(code => !allowed.has(code))) add(`routes.${route.id}.permissions`, "HTTP操作引用清单未声明的权限");
      const fullPath = `/cores/${manifest.id}${route.path === "/" ? "" : route.path}`;
      const matchesMethod = (entry: CoreHttpPolicy) => entry.method === route.method
        || [entry.method, route.method].every(method => method === "GET" || method === "HEAD");
      if (entries.some(entry => matchesMethod(entry) && entry.audiences.some(audience => route.audiences.includes(audience))
        && overlaps(entry.fullPath, fullPath))) add(`routes.${route.id}.path`, "HTTP路径与已有政策重叠，不能依赖处理器登记顺序决定授权");
      entries.push({ ...route, coreId: manifest.id, key: `${manifest.id}:${route.id}`, fullPath, permissionCodes });
    }
  }
  if (issues.length) return { ok: false, issues };
  const matchers = entries.map(entry => ({ entry, pattern: new RegExp("^" + entry.fullPath.split("/")
    .map(segment => segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/") + "$(?![\\s\\S])", "i") }));
  const registry: CoreHttpRegistry = {
    get entries() { return matchers.map(({ entry }) => structuredClone(entry)); },
    resolve(method, path, audience) {
      const exact = method.toUpperCase();
      const find = (verb: string) => matchers.find(({ entry, pattern }) => entry.method === verb
        && entry.audiences.includes(audience) && pattern.test(path));
      // Express沿原GET提供HEAD；登记时禁止二者重叠，不能因隐式HEAD落入空权限。
      const found = find(exact) ?? (exact === "HEAD" ? find("GET") : undefined);
      return found && structuredClone(found.entry);
    }
  };
  return { ok: true, registry: Object.freeze(registry) };
}
