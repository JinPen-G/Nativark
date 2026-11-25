/** 可选平台数据能力的固定发行与组合前置。能力不注册成业务 Core，也不授予业务或 AI 权限。
 * 包摘要与数据文件摘要分别锁定；实际物理状态和原迁移账由宿主观察，不由本合同推导。 */
import { z } from "zod";
import { CORE_PACKAGE_FILE_LIMIT, CoreArtifactHashSchema, CoreDataContractSchema, CoreIdSchema, CoreMigrationSchema,
  CorePackagePathSchema, CoreSourceSchema } from "./manifest";
import { CoreReleaseVersionSchema, CoreVersionRangeSchema, isCoreVersionSupported } from "./version";
import type { CoreHostVersions } from "./compatibility";
import type { CoreDeploymentLock, CoreUpdateIssue } from "./update";

export const CorePlatformDataCapabilityReleaseSchema = z.object({
  id: CoreIdSchema,
  version: CoreReleaseVersionSchema,
  source: CoreSourceSchema,
  /** 整个固定代码/资料/数据包的确定性归档摘要，不是仅 SQL 材料的指纹。 */
  sha256: CoreArtifactHashSchema,
  compatibility: z.object({ platform: CoreVersionRangeSchema, contract: CoreVersionRangeSchema }).strict(),
  runtime: z.object({ node: CoreVersionRangeSchema }).strict(),
  schema: z.object({ file: CorePackagePathSchema, sha256: CoreArtifactHashSchema }).strict(),
  files: z.array(CoreMigrationSchema.pick({ file: true, sha256: true })).min(1).max(CORE_PACKAGE_FILE_LIMIT),
  data: CoreDataContractSchema,
  /** SQL 和关系组合的前置；CoreManifest.requires 仍表示已有宿主能力要求。 */
  prerequisites: z.object({
    platform: CoreVersionRangeSchema,
    cores: z.array(z.object({
      coreId: CoreIdSchema,
      version: CoreVersionRangeSchema,
      migrations: z.array(CoreMigrationSchema.pick({ id: true, sha256: true })).max(1000).optional()
    }).strict()).max(100)
  }).strict()
}).strict().superRefine((release, context) => {
  const files = new Map<string, string>();
  release.files.forEach((artifact, index) => {
    if (files.has(artifact.file)) context.addIssue({ code: "custom", path: ["files", index], message: "能力包文件重复" });
    files.set(artifact.file, artifact.sha256);
  });
  for (const artifact of [release.schema, ...release.data.migrations])
    if (files.get(artifact.file) !== artifact.sha256)
      context.addIssue({ code: "custom", path: ["files"], message: "能力 schema/迁移与包文件摘要不一致" });
  const cores = new Set<string>();
  release.prerequisites.cores.forEach((core, index) => {
    if (cores.has(core.coreId)) context.addIssue({ code: "custom", path: ["prerequisites", "cores", index], message: "数据前置 Core 重复" });
    cores.add(core.coreId);
  });
  release.data.migrations.forEach((migration, index) => {
    if (!migration.id.startsWith(`${release.id}.`))
      context.addIssue({ code: "custom", path: ["data", "migrations", index, "id"], message: "能力迁移须使用所属能力命名空间" });
    if (migration.file === release.schema.file)
      context.addIssue({ code: "custom", path: ["data", "migrations", index, "file"], message: "迁移不能覆盖能力 schema" });
  });
});
export type CorePlatformDataCapabilityRelease = z.infer<typeof CorePlatformDataCapabilityReleaseSchema>;

/** 独立能力版本不改写底座发行；沿原 requires 检查时读取所选能力的合并版本视图。 */
export function coreDeploymentHostVersions(lock: Pick<CoreDeploymentLock, "platform" | "dataCapabilities">): CoreHostVersions {
  return { ...lock.platform.versions, capabilities: {
    ...lock.platform.versions.capabilities,
    ...Object.fromEntries((lock.dataCapabilities ?? []).map(release => [release.id, release.version]))
  } };
}

/** 只核定固定发行之间的可组合关系，不据此声明数据库或运行能力已就绪。 */
export function checkPlatformDataCapabilities(lock: CoreDeploymentLock): CoreUpdateIssue[] {
  const issues: CoreUpdateIssue[] = [], cores = new Map(lock.cores.map(pin => [pin.manifest.id, pin.manifest]));
  for (const release of lock.dataCapabilities ?? []) {
    const owner = `platform-capability:${release.id}`;
    const add = (code: string, field: string, message: string) => issues.push({ owner, code, field, message });
    const versions = lock.platform.versions;
    if (Object.hasOwn(versions.capabilities, release.id) && versions.capabilities[release.id] !== release.version)
      add("capability_version", "version", "独立能力不能覆盖底座已声明的不同能力版本");
    for (const key of ["platform", "contract"] as const)
      if (!isCoreVersionSupported(versions[key], release.compatibility[key]))
        add(`${key}_version`, `compatibility.${key}`, "底座版本不在能力发行的兼容范围");
    if (!isCoreVersionSupported(versions.node, release.runtime.node))
      add("node_version", "runtime.node", "Node.js 版本不在能力发行的支持范围");
    if (!isCoreVersionSupported(lock.platform.data.version, release.prerequisites.platform))
      add("platform_data_version", "prerequisites.platform", "公共数据版本不满足能力材料的前置");
    release.prerequisites.cores.forEach((requirement, index) => {
      const core = cores.get(requirement.coreId), field = `prerequisites.cores.${index}`;
      if (!core) { add("core_data_missing", field, `能力所需 Core ${requirement.coreId} 未被选择`); return; }
      if (!isCoreVersionSupported(core.data.version, requirement.version))
        add("core_data_version", `${field}.version`, "Core 数据版本不满足能力材料的前置");
      for (const migration of requirement.migrations ?? []) {
        const actual = core.data.migrations.find(entry => entry.id === migration.id);
        if (!actual || actual.sha256 !== migration.sha256)
          add("core_data_migration", `${field}.migrations`, "能力所需 Core 迁移与固定摘要不一致");
      }
    });
  }
  return issues;
}
