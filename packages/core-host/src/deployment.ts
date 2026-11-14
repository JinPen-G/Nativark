/**
 * 实际部署锁与受控Core服务注册、数据观察的接点，供授权/绑定/业务调用核当前可用性。
 * 发行锁和真实观察由宿主所有者提供，业务授权继续由原租户与成员服务管理。
 */
import {
  CoreDataObservationSchema, CoreDeploymentLockSchema, registerCoreServers,
  CoreManifestSchema, isCoreVersionSupported, type CoreDeploymentLock, type CoreDataObservation,
  type CoreServerRegistration, type CoreDataContract
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "./access";

export interface CoreDeploymentObservationSource {
  /** 读取当前实际迁移账、未完成执行及物理数据版本，不从包清单推导应用状态。 */
  read(): Promise<CoreDataObservation>;
}
export interface CoreDeployedCatalogue {
  readonly registrations: ReadonlyMap<string, CoreServerRegistration>;
  readonly availability: CoreDeploymentAvailability;
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
}): CoreDeployedCatalogue {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  const registered = registerCoreServers(input.registrations, lock.platform.versions);
  if (!registered.ok) throw new CoreAccessError("core_unavailable", registered.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
  const pins = new Map(lock.cores.map(pin => [pin.manifest.id, pin]));
  if (registered.registrations.size !== pins.size) throw new CoreAccessError("core_unavailable", "实际Core组合与部署锁的集合不一致");
  for (const [coreId, registration] of registered.registrations) {
    const pin = pins.get(coreId);
    if (!pin || JSON.stringify(pin.manifest) !== JSON.stringify(CoreManifestSchema.parse(registration.manifest)))
      throw new CoreAccessError("core_unavailable", `Core ${coreId} 的受控实现清单与部署锁不一致`);
  }
  const requireRegistered = async (coreId: string) => {
    if (!registered.registrations.has(coreId)) throw new CoreAccessError("core_unavailable", "该Core尚未在当前部署注册");
  };
  return {
    registrations: registered.registrations,
    availability: {
      requireRegistered,
      async requireAvailable(coreId) {
        await requireRegistered(coreId);
        const observed = CoreDataObservationSchema.parse(await input.observations.read());
        if (!dataAvailable(lock.platform.data, observed.platform))
          throw new CoreAccessError("core_unavailable", "平台实际数据或迁移执行状态尚未就绪");
        const pin = pins.get(coreId)!;
        const core = observed.cores.find(item => item.coreId === coreId);
        if (!dataAvailable(pin.manifest.data, core))
          throw new CoreAccessError("core_unavailable", "该Core实际数据或迁移执行状态尚未就绪");
      }
    }
  };
}
