/**
 * 固定底座/Core版本和包摘要，按真实数据观察生成单对象升级候选。
 * 只作纯预检，不下载、覆盖配置、执行迁移或改变运行/授权状态。
 */
import { z } from "zod";
import {
  CoreArtifactHashSchema, CoreDataContractSchema, CoreIdSchema, CoreManifestSchema,
  CoreMigrationSchema, CoreSourceSchema, type CoreDataContract
} from "./manifest";
import { checkCoreCombination, CoreHostVersionsSchema } from "./compatibility";
import { CoreReleaseVersionSchema, compareCoreReleaseVersions, isCoreVersionSupported } from "./version";

export const CorePackagePinSchema = z.object({
  manifest: CoreManifestSchema,
  sha256: CoreArtifactHashSchema
}).strict();
export const CorePlatformReleaseSchema = z.object({
  versions: CoreHostVersionsSchema,
  source: CoreSourceSchema,
  sha256: CoreArtifactHashSchema,
  data: CoreDataContractSchema
}).strict();

/** 锁文件只保存可复现发行元数据，不接收用户配置、凭据或租户授权。 */
export const CoreDeploymentLockSchema = z.object({
  lockVersion: z.literal(1),
  platform: CorePlatformReleaseSchema,
  cores: z.array(CorePackagePinSchema)
}).strict().superRefine((lock, context) => {
  const seen = new Set<string>();
  lock.cores.forEach((pin, index) => {
    if (seen.has(pin.manifest.id)) context.addIssue({ code: "custom", path: ["cores", index], message: "组合存在重复 Core" });
    seen.add(pin.manifest.id);
  });
});
export type CoreDeploymentLock = z.infer<typeof CoreDeploymentLockSchema>;

export const CoreUpdateRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("platform"), release: CorePlatformReleaseSchema }).strict(),
  z.object({ kind: z.literal("core"), coreId: CoreIdSchema, release: CorePackagePinSchema }).strict()
]);
export type CoreUpdateRequest = z.infer<typeof CoreUpdateRequestSchema>;

const observation = z.object({
  version: CoreReleaseVersionSchema,
  appliedMigrations: z.array(CoreMigrationSchema.pick({ id: true, sha256: true }))
}).strict();
export const CoreDataObservationSchema = z.object({
  platform: observation,
  cores: z.array(observation.extend({ coreId: CoreIdSchema }).strict())
}).strict().superRefine((data, context) => {
  const seen = new Set<string>();
  data.cores.forEach((core, index) => {
    if (seen.has(core.coreId)) context.addIssue({ code: "custom", path: ["cores", index], message: "Core 数据观察重复" });
    seen.add(core.coreId);
  });
});
export type CoreDataObservation = z.infer<typeof CoreDataObservationSchema>;

export interface CoreUpdateIssue { owner: string; code: string; field: string; message: string }
export type CoreUpdateResult =
  | { ok: false; scope: "update-preflight"; issues: CoreUpdateIssue[] }
  | {
    ok: true;
    scope: "update-preflight";
    status: "unchanged" | "candidate" | "migration_required";
    candidate: CoreDeploymentLock;
    migrations: Array<{ owner: string; fromVersion: string; toVersion: string; entries: CoreDataContract["migrations"] }>;
  };

// JSON对象字段顺序不改变发布内容；比较元数据时只归一键顺序，不重排迁移/能力等数组。
function sameData(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/**
 * 输入先经各自schema解析。只替换明确选择的一项，其他Core及全部用户配置留在原位。
 * 数据观察由迁移账原所有者供给；预检结果不得替代切换前对真实状态/历史执行者的复核。
 */
export function planCoreUpdate(
  current: CoreDeploymentLock, request: CoreUpdateRequest, observed: CoreDataObservation
): CoreUpdateResult {
  const candidate = structuredClone(current);
  const issues: CoreUpdateIssue[] = [];
  const migrations: Extract<CoreUpdateResult, { ok: true }>["migrations"] = [];
  const selected = request.kind === "platform" ? "platform" : `core:${request.coreId}`;
  const add = (owner: string, code: string, field: string, message: string) =>
    issues.push({ owner, code, field, message });
  const checkRelease = (owner: string, previous: { version: string; source: z.infer<typeof CoreSourceSchema>; sha256: string },
    next: typeof previous) => {
    if (previous.source.repository !== next.source.repository)
      add(owner, "source_conflict", "source.repository", "升级不能将已登记模块静默替换为另一来源");
    if (previous.version === next.version && (previous.sha256 !== next.sha256 || previous.source.commit !== next.source.commit))
      add(owner, "release_changed", "sha256", "同版本的提交或包摘要已变化，请使用新发行版本");
    if (compareCoreReleaseVersions(next.version, previous.version) < 0)
      add(owner, "release_rollback", "version", "本入口仅准备前进升级；程序回退须使用已验证的数据/历史兼容方案");
  };

  if (request.kind === "platform") {
    checkRelease("platform", { ...current.platform, version: current.platform.versions.platform },
      { ...request.release, version: request.release.versions.platform });
    if (current.platform.versions.platform === request.release.versions.platform
      && !sameData(current.platform, request.release))
      add("platform", "release_metadata_changed", "release", "同一底座发行的锁定资料不能被改写");
    candidate.platform = structuredClone(request.release);
  } else {
    const index = candidate.cores.findIndex(pin => pin.manifest.id === request.coreId);
    if (index < 0) add(selected, "core_not_installed", "coreId", "只能更新组合中已有的 Core，新 Core 须先走安装准备");
    if (request.release.manifest.id !== request.coreId)
      add(selected, "core_identity", "release.manifest.id", "候选包与所选 Core 标识不同");
    if (index >= 0) {
      checkRelease(selected, { ...current.cores[index].manifest, sha256: current.cores[index].sha256 },
        { ...request.release.manifest, sha256: request.release.sha256 });
      if (current.cores[index].manifest.version === request.release.manifest.version
        && !sameData(current.cores[index], request.release))
        add(selected, "release_metadata_changed", "release", "同一 Core 发行的锁定资料不能被改写");
      candidate.cores[index] = structuredClone(request.release);
    }
  }
  if (issues.length) return { ok: false, scope: "update-preflight", issues };
  for (const issue of checkCoreCombination(candidate.cores.map(pin => pin.manifest), candidate.platform.versions).issues)
    add(`core:${issue.coreId}`, issue.code, issue.field, issue.message);

  const checkData = (owner: string, previous: CoreDataContract, next: CoreDataContract,
    actual: z.infer<typeof observation> | undefined) => {
    if (!actual) { add(owner, "data_unavailable", "data", "缺少所属模块当前数据版本和迁移账，不能用清单代替"); return; }
    if (compareCoreReleaseVersions(next.version, previous.version) < 0)
      add(owner, "data_rollback", "data.version", "升级候选不能降低所属模块的数据版本");
    // 已发布迁移只追加；即便尚未应用，也不能改同名历史文件来适配新版本。
    previous.migrations.forEach((migration, index) => {
      const target = next.migrations[index];
      if (!target || target.id !== migration.id || target.file !== migration.file || target.sha256 !== migration.sha256)
        add(owner, "migration_changed", `data.migrations.${index}`, "已发布迁移被删除、重排或修改");
    });
    let historyMatches = true;
    actual.appliedMigrations.forEach((migration, index) => {
      const target = next.migrations[index];
      if (!target || target.id !== migration.id || target.sha256 !== migration.sha256) {
        historyMatches = false;
        add(owner, "migration_history", `appliedMigrations.${index}`, "实际迁移账与候选不可变链不一致");
      }
    });
    if (!historyMatches) return;
    const pending = next.migrations.slice(actual.appliedMigrations.length);
    if (pending.length) {
      if (owner !== selected) add(owner, "other_module_not_ready", "data.migrations", "未选择更新的模块仍有待应用迁移，请先核对当前部署");
      else if (actual.version !== previous.version || actual.appliedMigrations.length !== previous.migrations.length)
        add(owner, "migration_baseline", "data", "实际数据必须与当前发行的完整迁移基线一致，先核对未完迁移");
      else if (compareCoreReleaseVersions(next.version, actual.version) <= 0)
        add(owner, "data_version_unchanged", "data.version", "新增迁移须使用前进的数据版本");
      else migrations.push({ owner, fromVersion: actual.version, toVersion: next.version, entries: pending });
    } else {
      if (actual.version !== next.version)
        add(owner, "data_observation_conflict", "data.version", "实际迁移链已完整，但数据版本与该链的目标版本不同");
      if (previous.version !== next.version && previous.migrations.length === next.migrations.length)
        add(owner, "data_version_without_migration", "data.version", "数据版本变更必须有对应前进迁移");
      if (!isCoreVersionSupported(actual.version, next.readable))
        add(owner, "data_version", "data.readable", "当前数据版本不在候选实现可读范围，且没有待应用的前进迁移");
    }
  };
  checkData("platform", current.platform.data, candidate.platform.data, observed.platform);
  const dataByCore = new Map(observed.cores.map(core => [core.coreId, core]));
  for (const [index, pin] of candidate.cores.entries())
    checkData(`core:${pin.manifest.id}`, current.cores[index].manifest.data, pin.manifest.data, dataByCore.get(pin.manifest.id));
  if (issues.length) return { ok: false, scope: "update-preflight", issues };
  const unchanged = sameData(candidate, current);
  return { ok: true, scope: "update-preflight", status: migrations.length ? "migration_required" : unchanged ? "unchanged" : "candidate",
    candidate, migrations };
}
