/**
 * Core 发布包的唯一清单定义，类型从 schema 推导；发现和检查阶段只读取数据。
 * 清单不授予租户/成员权限，不加载模块，也不代表迁移、业务或 AI 工具已经就绪。
 */
import { z } from "zod";
import { CoreReleaseVersionSchema, CoreVersionRangeSchema, isCoreVersionSupported } from "./version";

export const CORE_CONTRACT_VERSION = "0.1.0";
export const CORE_MANIFEST_FILE = "core.manifest.json";
export const CoreIdSchema = z.string().min(1).max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$(?![\s\S])/, "使用小写字母、数字和单个连字符，且以字母开头");

export const CorePackagePathSchema = z.string().min(1).max(240).refine(value => {
  if (/[\\<>:"|?*#%\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split("/").every(part => part.length > 0 && part !== "." && part !== ".."
    && part.trim() === part && !part.endsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}, "使用包内相对文件路径；禁止绝对路径、上级目录、链接语法和不可移植的文件名");

const repositoryUrl = z.string().url().max(500).refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}, "来源使用不含凭据、查询和片段的 HTTPS 仓库地址");
const localId = z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$(?![\s\S])/);
export const CoreArtifactHashSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/, "使用小写 SHA-256 摘要");
export const CoreSourceSchema = z.object({
  repository: repositoryUrl,
  commit: z.string().length(40).regex(/^[a-f0-9]{40}$/)
}).strict();
export const CoreMigrationSchema = z.object({
  id: localId, file: CorePackagePathSchema, sha256: CoreArtifactHashSchema
}).strict();
export const CoreDataContractSchema = z.object({
  version: CoreReleaseVersionSchema,
  readable: CoreVersionRangeSchema,
  migrations: z.array(CoreMigrationSchema).max(1000)
}).strict().superRefine((data, context) => {
  const ids = new Set<string>(), files = new Set<string>();
  data.migrations.forEach((migration, index) => {
    if (ids.has(migration.id)) context.addIssue({ code: "custom", path: ["migrations", index, "id"], message: "迁移标识重复" });
    if (files.has(migration.file)) context.addIssue({ code: "custom", path: ["migrations", index, "file"], message: "迁移文件重复" });
    ids.add(migration.id); files.add(migration.file);
  });
  if (CoreReleaseVersionSchema.safeParse(data.version).success
    && CoreVersionRangeSchema.safeParse(data.readable).success
    && !isCoreVersionSupported(data.version, data.readable))
    context.addIssue({ code: "custom", path: ["readable"], message: "实现必须能够读取自己声明的数据版本" });
});
export type CoreDataContract = z.infer<typeof CoreDataContractSchema>;

export const CoreManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: CoreIdSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(100),
  version: CoreReleaseVersionSchema,
  source: CoreSourceSchema,
  license: z.string().trim().min(1).max(100),
  compatibility: z.object({
    platform: CoreVersionRangeSchema,
    contract: CoreVersionRangeSchema
  }).strict(),
  runtime: z.object({ node: CoreVersionRangeSchema }).strict(),
  entries: z.object({
    server: CorePackagePathSchema,
    admin: CorePackagePathSchema.optional(),
    openapi: CorePackagePathSchema.optional(),
    ai: CorePackagePathSchema.optional(),
    jobs: CorePackagePathSchema.optional(),
    events: CorePackagePathSchema.optional()
  }).strict(),
  permissions: z.array(z.object({
    resource: localId,
    action: localId,
    name: z.string().trim().min(1).max(100)
  }).strict()).max(500),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tenant") }).strict(),
    z.object({ kind: z.literal("container"), containerType: localId }).strict()
  ]),
  data: CoreDataContractSchema,
  requires: z.array(z.object({
    capability: localId,
    version: CoreVersionRangeSchema
  }).strict()).max(100),
  assets: z.array(CorePackagePathSchema).max(1000).optional()
}).strict().superRefine((manifest, context) => {
  const unique = (values: string[], field: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) context.addIssue({ code: "custom", path: [field, index], message: "声明重复" });
      seen.add(value);
    });
  };
  unique(manifest.permissions.map(p => `${p.resource}:${p.action}`), "permissions");
  unique(manifest.requires.map(item => item.capability), "requires");
});

export type CoreManifest = z.infer<typeof CoreManifestSchema>;

/** 新贡献使用统一命名空间；旧 Rental 权限码在其兼容适配中保留原语义。 */
export function corePermissionCode(coreId: string, permission: Pick<CoreManifest["permissions"][number], "resource" | "action">): string {
  return `${coreId}:${permission.resource}:${permission.action}`;
}
