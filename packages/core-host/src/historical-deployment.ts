/** 显式旧账准入。历史迁移与新装合同分别保留，不产生“新装已执行”的观察或升级候选。
 * 宿主读取器须核完整原账、所选增量和每个所有者的真实物理结构；本层只核其目标合同。
 */
import { isDeepStrictEqual } from "node:util";
import { CoreDataContractSchema, CorePhysicalDataObservationSchema,
  type CoreDataContract, type CorePhysicalDataObservation } from "@rental-os/core-contracts";
import { CoreAccessError } from "./access";

export interface CoreHistoricalDataObservation {
  /** 原账中的名字、SQL摘要及原收据数量；不能填新装迁移ID。 */
  original: { sourceCommit: string; ledgerSha256: string; successful: number; rolledBack: number };
  /** 只列本次确实已执行的追加迁移。 */
  additions: readonly { name: string; sha256: string }[];
  owners: readonly { owner: string; contract: CoreDataContract; physical: CorePhysicalDataObservation }[];
}
export interface CoreHistoricalDataSource {
  /** 每次使用调用方的同一数据库/事务，不能缓存一次启动通过代替业务时复核。 */
  read(): Promise<CoreHistoricalDataObservation>;
}

export function requireHistoricalDataContract(observed: CoreHistoricalDataObservation, owner: string,
  contract: CoreDataContract): void {
  const unavailable = () => new CoreAccessError("core_unavailable", "旧账桥接的原来源或实际数据合同尚未核定");
  if (!/^[a-f0-9]{40}$/u.test(observed.original?.sourceCommit)
    || !/^[a-f0-9]{64}$/u.test(observed.original?.ledgerSha256)
    || !Number.isSafeInteger(observed.original.successful) || observed.original.successful < 1
    || !Number.isSafeInteger(observed.original.rolledBack) || observed.original.rolledBack < 0
    || new Set(observed.owners.map(item => item.owner)).size !== observed.owners.length) throw unavailable();
  const record = observed.owners.find(item => item.owner === owner);
  const data = CoreDataContractSchema.safeParse(record?.contract);
  const physical = CorePhysicalDataObservationSchema.safeParse(record?.physical);
  if (!data.success || !physical.success || !isDeepStrictEqual(data.data, contract)
    || physical.data.version !== contract.version) throw unavailable();
}
