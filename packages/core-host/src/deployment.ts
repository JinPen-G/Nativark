/**
 * 实际部署锁与受控Core服务注册、数据观察的接点，供授权/绑定/业务调用核当前可用性。
 * 发行锁和真实观察由宿主所有者提供，业务授权继续由原租户与成员服务管理。
 */
import {
  CoreDataObservationSchema, CoreDeploymentLockSchema, registerCoreServers, registerCoreHttpRoutes,
  CoreManifestSchema, isCoreVersionSupported, checkPlatformDataCapabilities, coreDeploymentHostVersions,
  type CorePlatformDataCapabilityRelease, type CoreDeploymentLock, type CoreDataObservation,
  type CoreServerRegistration, type CoreDataContract, type CoreHttpContribution, type CoreHttpRegistry
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "./access";

export interface CoreDeploymentObservationSource {
  /** 准入读取平台与目标Core，省略目标时供升级预检读取全组合；不从包清单推导应用状态。 */
  read(coreId?: string): Promise<CoreDataObservation>;
}
export interface CoreDeployedCatalogue {
  readonly registrations: ReadonlyMap<string, CoreServerRegistration>;
  readonly availability: CoreDeploymentAvailability;
  readonly http: CoreHttpRegistry;
  /** 可选公共能力的独立准入；只检查所选能力及其数据前置，不授予 Core 或 AI 业务权。 */
  requireDataCapabilityAvailable(capabilityId: string): Promise<void>;
}

/** 同一事务复用已核定的固定目录，避免每个业务作用点重新解析整组清单和 HTTP 政策。
 * 只复用组合对象；每次 requireAvailable 仍读取当前事务的真实迁移账与物理状态。
 * 工厂由宿主按实际事务对象调用，根读取继续使用普通部署目录。 */
export function createCoreTransactionCatalogues<Transaction extends object>(
  create: (transaction: Transaction) => CoreDeployedCatalogue
): (transaction: Transaction) => CoreDeployedCatalogue {
  const catalogues = new WeakMap<Transaction, CoreDeployedCatalogue>();
  return transaction => {
    let catalogue = catalogues.get(transaction);
    if (!catalogue) {
      catalogue = create(transaction);
      catalogues.set(transaction, catalogue);
    }
    return catalogue;
  };
}

/** 保存受控组合的方法引用；绑定原服务实例，保留其仓储及运行状态。 */
function fixedRegistration(registration: CoreServerRegistration): CoreServerRegistration {
  const { server } = registration;
  const contribution = Object.freeze({
    coreId: server.coreId,
    implementationVersion: server.implementationVersion,
    resolveScope: server.resolveScope.bind(server),
    readReadiness: server.readReadiness.bind(server),
    ...(server.initialization ? { initialization: Object.freeze({ initialize: server.initialization.initialize.bind(server.initialization) }) } : {}),
    ...(server.assessRemoval ? { assessRemoval: server.assessRemoval.bind(server) } : {})
  });
  return { manifest: registration.manifest, server: contribution };
}

function dataAvailable(data: CoreDataContract, observation: CoreDataObservation["platform"] | undefined): boolean {
  return Boolean(observation && observation.execution?.state === "ready"
    && observation.version === data.version
    && isCoreVersionSupported(observation.version, data.readable)
    && observation.appliedMigrations.length === data.migrations.length
    && observation.appliedMigrations.every((migration, position) => migration.id === data.migrations[position].id
      && migration.sha256 === data.migrations[position].sha256));
}

/** 清单由唯一schema解析，实际服务从受控组合直接传入，与发行锁的源码/版本逐项匹配。 */
export function createCoreDeployedCatalogue(input: {
  lock: CoreDeploymentLock;
  registrations: readonly CoreServerRegistration[];
  observations: CoreDeploymentObservationSource;
  /** 当前已装配Controller的同源政策；未提供HTTP的Core可以省略，缺政策的路由仍默认拒绝。 */
  http?: readonly CoreHttpContribution[];
}): CoreDeployedCatalogue {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  const capabilityIssues = checkPlatformDataCapabilities(lock);
  if (capabilityIssues.length) throw new CoreAccessError("core_unavailable", capabilityIssues.map(issue => `${issue.owner}:${issue.field} ${issue.message}`).join("\n"));
  const manifests = input.registrations.map(registration => ({ ...registration, manifest: CoreManifestSchema.parse(registration.manifest) }));
  const registered = registerCoreServers(manifests, coreDeploymentHostVersions(lock));
  if (!registered.ok) throw new CoreAccessError("core_unavailable", registered.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
  const pins = new Map(lock.cores.map(pin => [pin.manifest.id, pin]));
  if (registered.registrations.size !== pins.size) throw new CoreAccessError("core_unavailable", "实际Core组合与部署锁的集合不一致");
  for (const [coreId, registration] of registered.registrations) {
    const pin = pins.get(coreId);
    if (!pin || JSON.stringify(pin.manifest) !== JSON.stringify(registration.manifest))
      throw new CoreAccessError("core_unavailable", `Core ${coreId} 的受控实现清单与部署锁不一致`);
  }
  const registrations = new Map([...registered.registrations].map(([id, registration]) => [id, fixedRegistration(registration)]));
  const policies = registerCoreHttpRoutes((input.http ?? []).map(contribution => {
    const registration = registrations.get(contribution.coreId);
    if (!registration) throw new CoreAccessError("core_unavailable", "HTTP贡献不属于当前部署登记的Core");
    return { manifest: registration.manifest, contribution };
  }));
  if (!policies.ok) throw new CoreAccessError("core_unavailable", policies.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
  const requireRegistered = async (coreId: string) => {
    if (!registrations.has(coreId)) throw new CoreAccessError("core_unavailable", "该Core尚未在当前部署注册");
  };
  const capabilities = new Map((lock.dataCapabilities ?? []).map(release => [release.id, release]));
  const requireCapabilityData = (release: CorePlatformDataCapabilityRelease, observed: CoreDataObservation) => {
    const capability = observed.dataCapabilities?.find(item => item.capabilityId === release.id);
    if (!dataAvailable(lock.platform.data, observed.platform) || !dataAvailable(release.data, capability))
      throw new CoreAccessError("core_unavailable", "所选平台能力实际数据或原迁移执行状态尚未就绪");
    for (const prerequisite of release.prerequisites.cores) {
      const pin = pins.get(prerequisite.coreId);
      const core = observed.cores.find(item => item.coreId === prerequisite.coreId);
      if (!pin || !dataAvailable(pin.manifest.data, core))
        throw new CoreAccessError("core_unavailable", "所选平台能力的 Core 数据前置尚未就绪");
    }
  };
  const catalogue: CoreDeployedCatalogue = {
    http: policies.registry,
    async requireDataCapabilityAvailable(capabilityId) {
      const release = capabilities.get(capabilityId);
      if (!release) throw new CoreAccessError("core_unavailable", "该数据能力未在当前部署选择");
      requireCapabilityData(release, CoreDataObservationSchema.parse(await input.observations.read()));
    },
    get registrations() {
      // ReadonlyMap只约束类型；返回隔离清单，调用方改副本不能改本次部署。
      return new Map([...registrations].map(([id, registration]) => [id,
        { manifest: CoreManifestSchema.parse(registration.manifest), server: registration.server }]));
    },
    availability: {
      requireRegistered,
      async requireAvailable(coreId) {
        await requireRegistered(coreId);
        const pin = pins.get(coreId)!;
        const required = pin.manifest.requires.flatMap(requirement => {
          const release = capabilities.get(requirement.capability);
          return release ? [release] : [];
        });
        // 能力可以依赖另一 Core 的数据；仅此情形需要完整组合观察，普通 Core 仍读取原目标。
        const observed = CoreDataObservationSchema.parse(await input.observations.read(required.length ? undefined : coreId));
        if (!dataAvailable(lock.platform.data, observed.platform))
          throw new CoreAccessError("core_unavailable", "平台实际数据或迁移执行状态尚未就绪");
        const core = observed.cores.find(item => item.coreId === coreId);
        if (!dataAvailable(pin.manifest.data, core))
          throw new CoreAccessError("core_unavailable", "该Core实际数据或迁移执行状态尚未就绪");
        for (const release of required) requireCapabilityData(release, observed);
      }
    }
  };
  Object.freeze(catalogue.availability);
  return Object.freeze(catalogue);
}
