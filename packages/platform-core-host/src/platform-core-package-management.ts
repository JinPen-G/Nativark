/**
 * SaaS 管理者只读发现、受控注册和独立版本，复用原目录的主体、租户锁及权限复验。
 * 外部读取在两次原权限围栏之间执行，避免联网时占用数据库锁，返回前撤权仍拒绝。
 * 包准备和部署归原 install/update/deployment，租户使用权归原授权服务。
 */
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CoreDataObservationSchema, CoreDeploymentLockSchema, CorePackagePinSchema, CorePlatformReleaseSchema,
  CorePlatformDataCapabilityReleaseSchema, checkCoreCombination, coreDeploymentHostVersions, coreRegisteredSummary,
  planCoreUpdate, type CoreRegisteredSummary, type CoreUpdateIssue
} from "@rental-os/core-contracts";
import {
  GitHubCoreDiscoveryQuerySchema, GitHubCoreReadError, GitHubCoreRepositorySchema, createGitHubCoreDiscovery,
  type GitHubCoreDiscoveryResult
} from "@rental-os/core-contracts/github";
import { inspectGitHubCoreRepository } from "@rental-os/core-contracts/github-repository";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import type {
  CorePackageAvailability, CorePackageDeploymentSource, CorePackageDiscoverySource,
  CorePackageHttpApplication, CorePackageReadFailure, CorePackageVersions
} from "./core-package-ports";
import { createPlatformCoreCatalogueReader } from "./platform-core-catalogue";

const discoveryRequest = z.object({ query: GitHubCoreDiscoveryQuerySchema, refresh: z.boolean().default(false) }).strict();
const repositoryRequest = z.object({ repository: GitHubCoreRepositorySchema, includeReleases: z.boolean().default(false) }).strict();
const deploymentSnapshot = z.object({
  lock: CoreDeploymentLockSchema,
  installed: z.object({
    platform: CorePlatformReleaseSchema.nullable(), cores: z.array(CorePackagePinSchema),
    dataCapabilities: z.array(CorePlatformDataCapabilityReleaseSchema).optional()
  }).strict(),
  data: CoreDataObservationSchema.nullable()
}).strict();
const missingDiscovery: CorePackageReadFailure = { code: "discovery_unavailable", message: "当前宿主尚未提供 GitHub 发现读取" };

/** 显式供给公开 GitHub 的只读适配，一个宿主复用一个分页缓存实例。构造时不联网。 */
export function createPlatformCorePackageDiscovery(fetcher: typeof fetch = fetch, now: () => number = Date.now): CorePackageDiscoverySource {
  const discover = createGitHubCoreDiscovery(fetcher, now);
  return {
    discover,
    inspect(repository, includeReleases) {
      const deadline = AbortSignal.timeout(90_000);
      return inspectGitHubCoreRepository(repository, { includeReleases }, (url, options) => fetcher(url, {
        ...options, signal: options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline
      }));
    }
  };
}

function availability(owner: string, issues: CoreUpdateIssue[], dependencies: string[] = []): CorePackageAvailability {
  const applicable = issues.filter(issue => ["deployment", "platform", owner, ...dependencies].includes(issue.owner));
  return applicable.length ? { status: "unavailable", issues: applicable } : { status: "available" };
}

function readFailure(error: GitHubCoreReadError): CorePackageReadFailure {
  return { code: error.code, message: error.message,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) };
}

export function composePlatformCorePackageManagement<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
  deployment?: CorePackageDeploymentSource;
  discovery?: CorePackageDiscoverySource;
  now?: () => number;
}): CorePackageHttpApplication {
  const registered = createPlatformCoreCatalogueReader(input), now = input.now ?? Date.now;

  async function managedRead<T>(work: (current: CoreRegisteredSummary[]) => Promise<T>): Promise<T> {
    const reference = () => {
      const identity = getRequestIdentity();
      return { tenantId: identity?.tenantId, userId: identity?.userId, audience: identity?.audience,
        accessSession: identity?.accessSession && { ...identity.accessSession } };
    };
    const original = reference();
    const current = await registered();
    try { return await work(current); }
    // 查询成功或失败都复核原身份。撤权后不得把公开缓存当成仍有管理权限。
    finally {
      if (!isDeepStrictEqual(original, reference())) throw new CoreAccessError("denied", "Core 包查询的原主体或会话已变化");
      await registered();
    }
  }

  async function versions(current: CoreRegisteredSummary[]): Promise<CorePackageVersions> {
    let value: Awaited<ReturnType<CorePackageDeploymentSource["read"]>>;
    try { value = await input.deployment?.read(); }
    catch {
      return { status: "unavailable", error: {
        code: "deployment_read_failed", message: "当前部署证据读取失败，请由部署人员核对" } };
    }
    if (value === undefined) return { status: "unavailable", error: {
      code: "deployment_unavailable", message: "缺少当前部署的锁定发行、实际包和数据观察" } };
    const parsed = deploymentSnapshot.safeParse(value);
    if (!parsed.success) return { status: "unavailable", error: {
      code: "deployment_invalid", message: "当前部署证据不符合发行和数据合同，请由部署人员核对" } };
    const { lock, installed, data } = parsed.data;
    const issues: CoreUpdateIssue[] = [];
    const add = (owner: string, code: string, field: string, message: string) => issues.push({ owner, code, field, message });
    if (!installed.platform) add("platform", "package_unavailable", "installed.platform", "缺少底座实际使用包的校验证据");
    else if (!isDeepStrictEqual(installed.platform, lock.platform))
      add("platform", "package_mismatch", "installed.platform", "底座实际使用包与部署锁的版本、来源或摘要不一致");
    const byId = new Map(current.map(core => [core.id, core]));
    if (current.length !== lock.cores.length || lock.cores.some(pin => !byId.has(pin.manifest.id)))
      add("deployment", "registration_mismatch", "cores", "当前服务注册集合与部署锁不一致");
    const installedById = new Map<string, z.infer<typeof CorePackagePinSchema>>();
    for (const pin of installed.cores) {
      if (installedById.has(pin.manifest.id) || !lock.cores.some(locked => locked.manifest.id === pin.manifest.id))
        add("deployment", "installed_mismatch", "installed.cores", "实际使用包集合包含重复或未锁定的 Core");
      installedById.set(pin.manifest.id, pin);
    }
    for (const pin of lock.cores) {
      const owner = `core:${pin.manifest.id}`, actual = installedById.get(pin.manifest.id);
      if (!actual) add(owner, "package_unavailable", "installed.cores", "缺少该 Core 实际使用包的校验证据");
      else if (!isDeepStrictEqual(actual, pin)) add(owner, "package_mismatch", "installed.cores", "Core 实际使用包与部署锁不一致");
      if (!isDeepStrictEqual(byId.get(pin.manifest.id), coreRegisteredSummary(pin.manifest)))
        add(owner, "registration_mismatch", "registered", "Core 当前服务注册与锁定清单不一致");
    }
    const capabilityPackages = new Map<string, z.infer<typeof CorePlatformDataCapabilityReleaseSchema>>();
    for (const release of installed.dataCapabilities ?? []) {
      if (capabilityPackages.has(release.id) || !lock.dataCapabilities?.some(locked => locked.id === release.id))
        add("deployment", "installed_mismatch", "installed.dataCapabilities", "实际能力包集合包含重复或未锁定的能力");
      capabilityPackages.set(release.id, release);
    }
    for (const release of lock.dataCapabilities ?? []) {
      const owner = `platform-capability:${release.id}`, actual = capabilityPackages.get(release.id);
      if (!actual) add(owner, "package_unavailable", "installed.dataCapabilities", "缺少所选能力完整实际包的校验证据");
      else if (!isDeepStrictEqual(actual, release))
        add(owner, "package_mismatch", "installed.dataCapabilities", "实际能力包的版本、来源或完整摘要与部署锁不一致");
    }
    if (!data) add("deployment", "data_unavailable", "data", "缺少原迁移账和实际物理数据观察");
    else {
      const checked = planCoreUpdate(lock, { kind: "platform", release: lock.platform }, data);
      if (!checked.ok) issues.push(...checked.issues);
      if (data.platform.execution?.state !== "ready")
        add("platform", "execution_unavailable", "data.platform.execution", "底座原迁移执行尚未确认就绪");
      const observations = new Map(data.cores.map(core => [core.coreId, core]));
      for (const pin of lock.cores) if (observations.get(pin.manifest.id)?.execution?.state !== "ready")
        add(`core:${pin.manifest.id}`, "execution_unavailable", "data.cores.execution", "Core 原迁移执行尚未确认就绪");
    }
    return { status: "observed",
      platform: { locked: lock.platform, current: installed.platform, availability: availability("platform", issues) },
      cores: lock.cores.map(pin => ({ locked: pin, current: installedById.get(pin.manifest.id) ?? null,
        registered: byId.has(pin.manifest.id), availability: availability(`core:${pin.manifest.id}`, issues,
          pin.manifest.requires.map(requirement => `platform-capability:${requirement.capability}`)) })),
      ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: lock.dataCapabilities.map(release => ({
        locked: release, current: capabilityPackages.get(release.id) ?? null,
        availability: availability(`platform-capability:${release.id}`, issues)
      })) }) };
  }

  return {
    catalogue: () => managedRead(async current => {
      const observed = await versions(current);
      return { checkedAt: new Date(now()).toISOString(), registered: current, versions: observed };
    }),
    discover: value => managedRead(async () => {
      const request = discoveryRequest.parse(value);
      if (!input.discovery) return { status: "unavailable", error: missingDiscovery };
      return input.discovery.discover(request.query, request.refresh);
    }),
    repository: value => managedRead(async current => {
      const request = repositoryRequest.parse(value);
      if (!input.discovery) return { status: "unavailable", error: missingDiscovery };
      let inspection: Awaited<ReturnType<CorePackageDiscoverySource["inspect"]>>;
      try { inspection = await input.discovery.inspect(request.repository, request.includeReleases); }
      catch (error) {
        if (error instanceof GitHubCoreReadError) return { status: "unavailable", error: readFailure(error) };
        if (error instanceof z.ZodError) return { status: "unavailable", error: {
          code: "response_invalid", message: "GitHub 仓库资料不符合 Core 发现合同，请重新核对" } };
        throw error;
      }
      const deployed = await versions(current);
      // 声明兼容仅使用实际底座包版本；锁文件独自存在时不作可安装判断。
      const capabilities = deployed.status === "observed" ? deployed.dataCapabilities ?? [] : [];
      const host = deployed.status === "observed" && deployed.platform.current
        && isDeepStrictEqual(deployed.platform.current, deployed.platform.locked)
        && capabilities.every(capability => capability.current && isDeepStrictEqual(capability.current, capability.locked))
        ? coreDeploymentHostVersions({ platform: deployed.platform.current, dataCapabilities: capabilities.map(capability => capability.current!) })
        : undefined;
      return { status: "observed", inspection, compatibility: inspection.cores.map(core => ({ manifestFile: core.manifestFile,
        status: core.manifest && host ? "checked" : "unavailable",
        issues: core.manifest && host ? checkCoreCombination([core.manifest], host).issues : [] })) };
    })
  };
}
