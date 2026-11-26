/** Host adapter for public AI admission. The fixed data archive remains a separate input. */
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from '@rental-os/core-contracts';
import { createCoreDeployedCatalogue } from '@rental-os/core-host';
import { createMysqlCoreDeploymentObservation, type CoreMysqlDataPlan } from '@rental-os/core-host/mysql-deployment';
import { readPublicAiDataPackage } from './public-data-package';
import { createPublicAiMysqlDataPlan } from './public-mysql-data';

/** Bind the zero-Core host to its selected public archive and real migration account.
 * Each caller reopens the same data observation on its own Client or transaction. */
export function createZeroCorePublicAiDataAvailability(input: { lock: CoreDeploymentLock; platform: CoreMysqlDataPlan;
  files: ReadonlyMap<string, Uint8Array> }) {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  const selected = lock.dataCapabilities?.find(release => release.id === "ai-native");
  if (lock.cores.length !== 0 || !selected) throw new Error("公共 AI 设置需要选定的零 Core 数据组合");
  const { contribution } = readPublicAiDataPackage(input.files, selected);
  const ai = { ...createPublicAiMysqlDataPlan(contribution), capabilityId: selected.id };
  return async (database: Parameters<CoreMysqlDataPlan["readPhysical"]>[0]) => {
    const observations = createMysqlCoreDeploymentObservation({ database, platform: input.platform, cores: [], dataCapabilities: [ai] });
    await createCoreDeployedCatalogue({ lock, registrations: [], observations }).requireDataCapabilityAvailable(ai.capabilityId);
  };
}
