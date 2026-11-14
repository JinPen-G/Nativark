/**
 * 开发能力索引的唯一数据合同与查询。源码、页面和接口资料由各自正式声明贡献。
 * 调用方取得定位信息；运行工具发布和当前业务授权继续由其原服务维护。
 */
import { z } from "zod";
import { CorePackagePathSchema, corePermissionCode, type CoreManifest } from "./manifest";
import { corePageText, type CoreAdminContribution } from "./admin";
import type { CoreOpenApiContribution } from "./openapi";

export const DevelopmentCapabilityKindSchema = z.enum(["module", "export", "ui", "page", "api", "extension"]);
export type DevelopmentCapabilityKind = z.infer<typeof DevelopmentCapabilityKindSchema>;

export const DevelopmentSourceReferenceSchema = z.object({
  path: CorePackagePathSchema,
  line: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional()
}).strict();
export type DevelopmentSourceReference = z.infer<typeof DevelopmentSourceReferenceSchema>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.record(jsonValue)
]));

export const DevelopmentCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: DevelopmentCapabilityKindSchema,
  owner: z.string().min(1),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  sources: z.array(DevelopmentSourceReferenceSchema).min(1),
  documentation: z.array(DevelopmentSourceReferenceSchema),
  entry: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("import"), module: z.string().min(1), symbol: z.string().min(1),
      typeOnly: z.boolean(), visibility: z.enum(["public", "host"]) }).strict(),
    z.object({ kind: z.literal("http"), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"]),
      path: z.string().startsWith("/") }).strict(),
    z.object({ kind: z.literal("page"), path: z.string().startsWith("/") }).strict()
  ]).optional(),
  details: z.record(jsonValue).optional()
}).strict();
export type DevelopmentCapability = z.infer<typeof DevelopmentCapabilitySchema>;

export const DevelopmentCapabilityIndexSchema = z.object({
  schemaVersion: z.literal(1),
  audience: z.literal("development"),
  source: z.object({ snapshot: z.literal("working-tree"), revision: z.string().regex(/^[a-f0-9]{40}$/).optional(),
    version: z.string().min(1) }).strict(),
  coverage: z.array(z.object({ source: CorePackagePathSchema, count: z.number().int().nonnegative(),
    state: z.enum(["indexed", "partial", "not_present"]) }).strict()),
  issues: z.array(z.object({ code: z.string().min(1), path: CorePackagePathSchema, message: z.string().min(1) }).strict()),
  capabilities: z.array(DevelopmentCapabilitySchema)
}).strict().superRefine((index, context) => {
  const ids = new Set<string>();
  index.capabilities.forEach((capability, position) => {
    if (ids.has(capability.id)) context.addIssue({ code: "custom", path: ["capabilities", position, "id"], message: "能力标识重复" });
    ids.add(capability.id);
  });
});
export type DevelopmentCapabilityIndex = z.infer<typeof DevelopmentCapabilityIndexSchema>;

export const DevelopmentCapabilityQuerySchema = z.object({
  query: z.string().trim().optional(),
  id: z.string().min(1).optional(),
  kind: DevelopmentCapabilityKindSchema.optional(),
  owner: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(20)
}).strict();
export type DevelopmentCapabilityQuery = z.input<typeof DevelopmentCapabilityQuerySchema>;

/** 宿主将同一份已登记贡献用于开发资料，组件与业务方法始终由原注册源持有。 */
export function describeCoreDevelopmentCapabilities(input: {
  manifest: CoreManifest;
  admin?: CoreAdminContribution<unknown>;
  openapi?: CoreOpenApiContribution;
  directory?: string;
}): DevelopmentCapability[] {
  const { manifest, admin, openapi } = input;
  const directory = input.directory ? CorePackagePathSchema.parse(input.directory) + "/" : "";
  const path = (file: string) => CorePackagePathSchema.parse(directory + file);
  const documentation = [{ path: path("README.md") }, { path: path("CORE_GUIDE.md") }];
  const capabilities: DevelopmentCapability[] = [{
    id: `core:${manifest.id}`,
    name: manifest.name,
    kind: "module",
    owner: manifest.id,
    version: manifest.version,
    description: manifest.description,
    sources: [{ path: path("core.manifest.json") }],
    documentation,
    details: { compatibility: manifest.compatibility, scope: manifest.scope, requires: manifest.requires,
      permissions: manifest.permissions.map(permission => corePermissionCode(manifest.id, permission)), entries: manifest.entries }
  }];
  if (admin) {
    if (admin.coreId !== manifest.id || admin.implementationVersion !== manifest.version || !manifest.entries.admin)
      throw new Error("开发资料的页面贡献须与已登记 Core 清单一致");
    for (const page of admin.pages) capabilities.push({
      id: `page:${manifest.id}:${page.id}`,
      name: corePageText(page.title, "zh-CN"),
      kind: "page",
      owner: manifest.id,
      version: manifest.version,
      sources: [{ path: path(manifest.entries.admin), symbol: page.id }],
      documentation,
      entry: { kind: "page", path: `/cores/${manifest.id}${page.path === "/" ? "" : page.path}` },
      details: { permissions: page.permissions.map(permission => corePermissionCode(manifest.id, permission)),
        ...(page.parent ? { parent: page.parent } : {}), ...(page.menu ? { menu: page.menu } : {}) }
    });
  }
  if (openapi) {
    if (!manifest.entries.openapi) throw new Error("开发资料的 API 贡献须在 Core 清单中登记");
    for (const [route, methods] of Object.entries(openapi.paths)) {
      for (const [method, value] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
        const operation = value as { summary: string; operationId: string; description?: string };
        capabilities.push({
          id: `api:${method.toUpperCase()}:${route}`,
          name: operation.summary,
          kind: "api",
          owner: manifest.id,
          version: manifest.version,
          description: operation.description,
          sources: [{ path: path(manifest.entries.openapi), symbol: operation.operationId }],
          documentation,
          entry: { kind: "http", method: method.toUpperCase() as "GET", path: route },
          details: { operationId: operation.operationId }
        });
      }
    }
  }
  return capabilities.map(capability => DevelopmentCapabilitySchema.parse(capability));
}

/** 先缩小到相关能力，再返回正文和来源，避免每次读取整份仓库索引。 */
export function queryDevelopmentCapabilities(index: DevelopmentCapabilityIndex, input: DevelopmentCapabilityQuery = {}) {
  const query = DevelopmentCapabilityQuerySchema.parse(input);
  const words = query.query?.toLowerCase().split(/\s+/u).filter(Boolean) ?? [];
  const matches = index.capabilities.filter(capability => {
    if (query.id && capability.id !== query.id) return false;
    if (query.kind && capability.kind !== query.kind) return false;
    if (query.owner && capability.owner !== query.owner) return false;
    const text = JSON.stringify(capability).toLowerCase();
    return words.every(word => text.includes(word));
  });
  const end = Math.min(query.offset + query.limit, matches.length);
  return {
    schemaVersion: index.schemaVersion,
    audience: index.audience,
    source: index.source,
    total: index.capabilities.length,
    matched: matches.length,
    offset: query.offset,
    nextOffset: end < matches.length ? end : null,
    coverage: {
      indexed: index.coverage.filter(source => source.state === "indexed").length,
      partial: index.coverage.filter(source => source.state === "partial"),
      notPresent: index.coverage.filter(source => source.state === "not_present")
    },
    issues: index.issues,
    capabilities: matches.slice(query.offset, end)
  };
}
