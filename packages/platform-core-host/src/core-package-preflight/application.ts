/** SaaS 包检查和单对象候选规划，复用原目录权限、归档检查及 update 纯预检。
 * 来源读取位于原权限围栏之间，当前组合和原数据变化时拒绝返回过期候选。
 * 活动文件、迁移账、授权和业务动作继续由各自原执行入口维护。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CoreDataObservationSchema, CoreDeploymentLockSchema, CorePackagePinSchema, CorePlatformReleaseSchema,
  CorePlatformDataCapabilityReleaseSchema, checkCoreCombination, checkPlatformDataCapabilities,
  coreDeploymentHostVersions, planCoreUpdate, type CoreHostVersions, type CoreUpdateIssue
} from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, readCoreArchive } from "@rental-os/core-contracts/archive";
import { corePackageFiles, inspectCorePackageFiles, type CorePackageInspection } from "@rental-os/core-contracts/package";
import { createPlatformSource } from "@rental-os/core-contracts/platform-source";
import { requirePlatformDataCapabilityFiles } from "@rental-os/core-contracts/platform-data-package";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { CorePackageCatalogue, CorePackageDeploymentSource, CorePackageLegacyApiRoutes, CorePackageReadFailure } from "../core-package-ports";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "../ports";
import { composePlatformCorePackageManagement } from "../platform-core-package-management";
import {
  CorePackageArtifactSchema, CorePackageInspectRequestSchema, CorePackageUpdatePlanRequestSchema,
  type CorePackageArtifact, type CorePackageArtifactRead, type CorePackageArtifactSource,
  type CorePackageInstallPlan, type CorePackageInspectedArtifact, type CorePackagePlanRead,
  type CorePackagePreflightApplication
} from "./ports";

const deploymentSnapshot = z.object({
  lock: CoreDeploymentLockSchema,
  installed: z.object({
    platform: CorePlatformReleaseSchema.nullable(), cores: z.array(CorePackagePinSchema),
    dataCapabilities: z.array(CorePlatformDataCapabilityReleaseSchema).optional()
  }).strict(),
  data: CoreDataObservationSchema.nullable()
}).strict();
type DeploymentSnapshot = z.infer<typeof deploymentSnapshot>;
const unavailable = (code: string, message: string) => ({ status: "unavailable" as const, error: { code, message } });

function comparableDeploymentSnapshot(value: unknown): unknown {
  const parsed = deploymentSnapshot.safeParse(value);
  if (!parsed.success || !parsed.data.data) return value;
  const data = parsed.data.data;
  for (const observed of [data.platform, ...data.cores, ...(data.dataCapabilities ?? [])]) {
    const execution = observed.execution;
    if (execution && execution.state !== "ready" && execution.physicalState) {
      // 只在解析后的比对副本归一采样时间，原收据、物理摘要及返回证据保留原值。
      execution.physicalState.observedAt = "1970-01-01T00:00:00.000Z";
    }
  }
  return parsed.data;
}

export function inspectCorePackageArtifact(artifact: CorePackageArtifact, host: CoreHostVersions | undefined,
  legacyApiRoutes: CorePackageLegacyApiRoutes): CorePackageInspection {
  const sha256 = artifact.kind === "core" ? artifact.pin.sha256 : artifact.release.sha256;
  let files: ReadonlyMap<string, Uint8Array>;
  try { files = readCoreArchive(artifact.bytes, sha256).files; }
  catch {
    return { ok: false, scope: "package-static", compatibilityChecked: false,
      issues: [{ code: "archive_invalid", file: "artifact", message: "发布包摘要、归档格式或资源限额检查失败" }] };
  }
  if (artifact.kind === "core") {
    const allowedRoutes = Object.hasOwn(legacyApiRoutes, artifact.pin.manifest.id) ? legacyApiRoutes[artifact.pin.manifest.id] : [];
    const result = inspectCorePackageFiles(files, host, allowedRoutes);
    if (result.manifest) {
      if (!isDeepStrictEqual(result.manifest, artifact.pin.manifest)) result.issues.push({
        code: "release_mismatch", file: "core.manifest.json", message: "包清单与宿主锁定的完整发行资料不一致" });
      const declared = new Set(corePackageFiles(result.manifest));
      for (const file of files.keys()) if (!declared.has(file)) result.issues.push({
        code: "undeclared_file", file, message: "发布包包含清单未声明的额外文件" });
    }
    result.ok = result.issues.length === 0;
    return result;
  }
  const result: CorePackageInspection = { ok: false, scope: "package-static", compatibilityChecked: false, issues: [] };
  if (artifact.kind === "platform-capability") {
    try { requirePlatformDataCapabilityFiles(files, artifact.release); }
    catch (error) { result.issues.push({ code: "capability_package_invalid", file: "artifact",
      message: error instanceof Error ? error.message : "能力包的完整文件、schema、迁移或归档摘要与固定发行不一致" }); }
    result.ok = result.issues.length === 0;
    return result;
  }
  try {
    // 用原零 Core 发行生成器复核同一文件集，包含来源、workspace、锁文件及私有资料排除规则。
    const source = createPlatformSource(files, artifact.release.source);
    if (source.version !== artifact.release.versions.platform) result.issues.push({
      code: "platform_version", file: "package.json", message: "底座包版本与宿主锁定的发行版本不同" });
    if (source.files.size !== files.size || [...source.files].some(([file, bytes]) => {
      const original = files.get(file);
      return original === undefined || !Buffer.from(original).equals(bytes);
    })) result.issues.push({ code: "platform_source_mismatch", file: "platform.source.json",
      message: "底座包与固定来源生成的公共源码发行不一致" });
    for (const migration of artifact.release.data.migrations) {
      const file = `apps/platform-api/${migration.file}`, bytes = files.get(file);
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== migration.sha256) result.issues.push({
        code: "migration_mismatch", file, message: "底座迁移资源与固定发行的数据合同不一致" });
    }
  } catch {
    result.issues.push({ code: "platform_source_invalid", file: "platform.source.json",
      message: "底座包缺少有效的公共源码、来源或依赖锁定资料" });
  }
  result.ok = result.issues.length === 0;
  return result;
}

function readySnapshot(current: CorePackageCatalogue, value: unknown):
  | { status: "ready"; snapshot: DeploymentSnapshot & { data: NonNullable<DeploymentSnapshot["data"]> } }
  | { status: "unavailable"; error: CorePackageReadFailure } {
  if (current.versions.status !== "observed") return { status: "unavailable", error: current.versions.error };
  const versions = current.versions;
  const currentIssues = [versions.platform.availability, ...versions.cores.map(core => core.availability),
    ...(versions.dataCapabilities ?? []).map(capability => capability.availability)]
    .flatMap(availability => availability.status === "unavailable" ? availability.issues : []);
  if (currentIssues.length) return unavailable("deployment_not_ready",
    currentIssues.map(issue => `[${issue.owner}] ${issue.message}`).join("。"));
  const parsed = deploymentSnapshot.safeParse(value);
  if (!parsed.success || !parsed.data.data) return unavailable("deployment_unavailable", "缺少有效的当前部署和原数据观察");
  const snapshot = parsed.data;
  const locked = { lockVersion: 1, platform: versions.platform.locked, cores: versions.cores.map(core => core.locked),
    ...(versions.dataCapabilities === undefined ? {} : { dataCapabilities: versions.dataCapabilities.map(capability => capability.locked) }) };
  const installed = new Map(snapshot.installed.cores.map(pin => [pin.manifest.id, pin]));
  const capabilities = new Map((snapshot.installed.dataCapabilities ?? []).map(release => [release.id, release]));
  if (!isDeepStrictEqual(snapshot.lock, locked) || !isDeepStrictEqual(snapshot.installed.platform, versions.platform.current)
    || installed.size !== snapshot.installed.cores.length || installed.size !== versions.cores.length
    || versions.cores.some(core => !isDeepStrictEqual(installed.get(core.locked.manifest.id), core.current))
    || capabilities.size !== (snapshot.installed.dataCapabilities?.length ?? 0)
    || capabilities.size !== (versions.dataCapabilities?.length ?? 0)
    || versions.dataCapabilities?.some(capability => !isDeepStrictEqual(capabilities.get(capability.locked.id), capability.current)))
    return unavailable("deployment_changed", "部署锁或实际包在预检读取期间已变化，请重新读取");
  const data = snapshot.data!;
  const baseline = planCoreUpdate(snapshot.lock, { kind: "platform", release: snapshot.lock.platform }, data);
  if (!baseline.ok || data.platform.execution?.state !== "ready"
    || snapshot.lock.cores.some(pin => data.cores.find(core => core.coreId === pin.manifest.id)?.execution?.state !== "ready")
    || snapshot.lock.dataCapabilities?.some(release => data.dataCapabilities?.find(capability => capability.capabilityId === release.id)?.execution.state !== "ready"))
    return unavailable("deployment_not_ready", "原迁移账、执行收据或数据版本与当前组合不一致，请先核对原结果");
  return { status: "ready", snapshot: { ...snapshot, data } };
}

function installPlan(snapshot: DeploymentSnapshot, artifact: Extract<CorePackageArtifact, { kind: "core" }>): CorePackageInstallPlan {
  const { pin } = artifact, current = snapshot.lock.cores.find(core => core.manifest.id === pin.manifest.id);
  if (current) {
    if (isDeepStrictEqual(current, pin)) return { ok: true, scope: "install-preflight", status: "unchanged",
      candidate: structuredClone(snapshot.lock), initialMigrations: [] };
    const sourceConflict = current.manifest.source.repository !== pin.manifest.source.repository;
    return { ok: false, scope: "install-preflight", issues: [{ owner: `core:${pin.manifest.id}`,
      code: sourceConflict ? "source_conflict" : "core_already_installed", field: "manifest.id",
      message: sourceConflict ? "同标识 Core 已登记另一来源，请先明确处理来源冲突" : "同标识 Core 已装配，请使用单项更新预检" }] };
  }
  if (snapshot.data?.cores.some(core => core.coreId === pin.manifest.id)) return { ok: false, scope: "install-preflight",
    issues: [{ owner: `core:${pin.manifest.id}`, code: "existing_core_data", field: "data",
      message: "该 Core 已有原数据观察，请先核对原部署和恢复条件" }] };
  const candidate = structuredClone(snapshot.lock);
  candidate.cores.push(structuredClone(pin));
  const issues: CoreUpdateIssue[] = [...checkPlatformDataCapabilities(candidate),
    ...checkCoreCombination(candidate.cores.map(core => core.manifest), coreDeploymentHostVersions(candidate))
      .issues.map(issue => ({ owner: `core:${issue.coreId}`, code: issue.code, field: issue.field, message: issue.message }))];
  if (issues.length) return { ok: false, scope: "install-preflight", issues };
  return { ok: true, scope: "install-preflight", status: "candidate", candidate,
    initialMigrations: structuredClone(pin.manifest.data.migrations) };
}

export function composePlatformCorePackagePreflight<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
  deployment?: CorePackageDeploymentSource;
  artifacts?: CorePackageArtifactSource;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  now?: () => number;
}): CorePackagePreflightApplication {
  const management = composePlatformCorePackageManagement(input), now = input.now ?? Date.now;
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const reference = () => {
    const identity = getRequestIdentity();
    return { tenantId: identity?.tenantId, userId: identity?.userId, audience: identity?.audience,
      accessSession: identity?.accessSession && { ...identity.accessSession } };
  };

  async function managedRead<T>(withData: boolean,
    work: (current: CorePackageCatalogue, value: unknown) => Promise<T>): Promise<T> {
    const principal = reference(), current = await management.catalogue();
    let value: unknown, readFailed = false;
    try {
      if (withData) {
        try { value = structuredClone(await input.deployment?.read()); }
        catch { readFailed = true; }
      }
      return await work(current, value);
    } finally {
      let changed = false;
      if (withData && !readFailed && value !== undefined) {
        try { changed = !isDeepStrictEqual(comparableDeploymentSnapshot(value),
          comparableDeploymentSnapshot(await input.deployment?.read())); }
        catch { changed = true; }
      }
      if (!isDeepStrictEqual(principal, reference())) throw new CoreAccessError("denied", "包预检的原主体或会话已变化");
      const latest = await management.catalogue();
      if (!isDeepStrictEqual(principal, reference())) throw new CoreAccessError("denied", "包预检的原主体或会话已变化");
      if (changed || !isDeepStrictEqual(current.registered, latest.registered) || !isDeepStrictEqual(current.versions, latest.versions))
        throw new CoreAccessError("revision_conflict", "当前部署、注册或原数据在包预检期间已变化，请重新读取");
    }
  }

  async function readArtifact(reference: string, current: CorePackageCatalogue): Promise<
    | { read: Extract<CorePackageArtifactRead, { status: "unavailable" }> }
    | { read: CorePackageInspectedArtifact; artifact: CorePackageArtifact }
  > {
    if (!input.artifacts) return { read: unavailable("artifact_source_unavailable", "当前宿主尚未登记安装包读取来源") };
    let value: CorePackageArtifact | undefined;
    try { value = await input.artifacts.read(reference); }
    catch (error) {
      if (error instanceof CoreAccessError) throw error;
      return { read: unavailable("artifact_read_failed", "固定安装包读取失败，请核对原来源") };
    }
    if (value === undefined) return { read: unavailable("artifact_unavailable", "所选安装包引用尚不可用") };
    const parsed = CorePackageArtifactSchema.safeParse(value);
    if (!parsed.success || parsed.data.bytes.length > CORE_ARCHIVE_LIMITS.totalBytes)
      return { read: unavailable("artifact_invalid", "安装包来源未提供有效且限额内的固定发行和字节") };
    // 复制本次字节，避免复用缓存被另一读取者修改后影响已经开始的检查。
    const artifact = { ...parsed.data, bytes: Buffer.from(parsed.data.bytes) };
    const host = current.versions.status === "observed" && current.versions.platform.current
      && current.versions.platform.availability.status === "available"
      && (current.versions.dataCapabilities ?? []).every(capability => capability.availability.status === "available")
      ? coreDeploymentHostVersions({ platform: current.versions.platform.current,
        dataCapabilities: (current.versions.dataCapabilities ?? []).map(capability => capability.current!) }) : undefined;
    const inspection = inspectCorePackageArtifact(artifact, host, legacyApiRoutes);
    const { bytes: _bytes, ...summary } = artifact;
    return { artifact, read: { status: "inspected", reference, checkedAt: new Date(now()).toISOString(),
      review: "unreviewed", artifact: summary, inspection } };
  }

  async function plan(value: unknown, updating: boolean): Promise<CorePackagePlanRead> {
    return managedRead(true, async (current, observed) => {
      const request = updating
        ? { operation: "update" as const, value: CorePackageUpdatePlanRequestSchema.parse(value) }
        : { operation: "install" as const, value: CorePackageInspectRequestSchema.parse(value) };
      const loaded = await readArtifact(request.value.reference, current);
      if (!("artifact" in loaded)) return loaded.read;
      const { read, artifact } = loaded;
      if (!read.inspection.ok) return { ...read, plan: unavailable("package_rejected",
        read.inspection.issues.map(issue => `[${issue.file}] ${issue.message}`).join("。")) };
      const ready = readySnapshot(current, observed);
      if (ready.status !== "ready") return { ...read, plan: ready };
      if (request.operation === "install") {
        if (artifact.kind !== "core") return { ...read, plan: unavailable("artifact_kind", "新增安装只接受 Core 标准包") };
        return { ...read, plan: { status: "checked", deployment: "pending", result: installPlan(ready.snapshot, artifact) } };
      }
      const update = request.value;
      if (update.kind === "core" && artifact.kind === "core") return { ...read, plan: {
        status: "checked", deployment: "pending", result: planCoreUpdate(ready.snapshot.lock,
          { kind: "core", coreId: update.coreId, release: artifact.pin }, ready.snapshot.data) } };
      if (update.kind === "platform" && artifact.kind === "platform") return { ...read, plan: {
        status: "checked", deployment: "pending", result: planCoreUpdate(ready.snapshot.lock,
          { kind: "platform", release: artifact.release }, ready.snapshot.data) } };
      if (update.kind === "platform-capability" && artifact.kind === "platform-capability") return { ...read, plan: {
        status: "checked", deployment: "pending", result: planCoreUpdate(ready.snapshot.lock,
          { kind: "platform-capability", capabilityId: update.capabilityId, release: artifact.release }, ready.snapshot.data) } };
      return { ...read, plan: unavailable("artifact_kind", "固定包类型与所选更新对象不同") };
    });
  }

  return {
    inspect: value => managedRead(false, async current => {
      const request = CorePackageInspectRequestSchema.parse(value);
      return (await readArtifact(request.reference, current)).read;
    }),
    install: value => plan(value, false),
    update: value => plan(value, true)
  };
}
