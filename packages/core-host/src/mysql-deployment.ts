/** 读取原Prisma迁移收据与模块真实物理观察；无新迁移账、DDL、Client生成或缺数据成功回退。 */
import { join, sqltag as sql } from "@prisma/client/runtime/library";
import { CoreDataContractSchema, CoreDataObservationSchema, CoreIdSchema, CorePhysicalDataObservationSchema,
  type CoreDataContract, type CoreDataObservation, type CorePhysicalDataObservation, type CoreMigrationExecution } from "@rental-os/core-contracts";
import { CoreAccessError } from "./access";
import type { CoreHostSqlTransaction } from "./mysql";
import type { CoreDeploymentObservationSource } from "./deployment";

type Reader = Pick<CoreHostSqlTransaction, "$queryRaw">;
export interface CoreMysqlDataPlan {
  data: CoreDataContract;
  /** 原部署所登记的Prisma migration_name，与模块不可变迁移ID对应，顺序与data.migrations相同。 */
  migrationNames: readonly string[];
  /** 各数据所有者的实际表/列/约束检查；缺失/未知返回undefined，不照抄data.version。 */
  readPhysical(database: Reader): Promise<CorePhysicalDataObservation | undefined>;
}
type Receipt = { migrationName: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null; hasFailure: number | bigint | boolean };

/** 每次读取当前原账，按模块隔离缺失观察；平台缺物理证据拒绝全部新准入。 */
export function createMysqlCoreDeploymentObservation(input: {
  database: Reader;
  platform: CoreMysqlDataPlan;
  cores: readonly (CoreMysqlDataPlan & { coreId: string })[];
}): CoreDeploymentObservationSource {
  const plan = (value: CoreMysqlDataPlan) => {
    const data = CoreDataContractSchema.parse(value.data), names = [...value.migrationNames];
    if (names.length !== data.migrations.length || new Set(names).size !== names.length
      || names.some(name => typeof name !== "string" || !name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)))
      throw new CoreAccessError("core_unavailable", "模块迁移ID与原Prisma账名称未完整对应");
    return { names, ids: new Map(names.map((name, index) => [name, data.migrations[index].id])), physical: value.readPhysical.bind(value) };
  };
  const platform = plan(input.platform), cores = input.cores.map(value => ({ ...plan(value), coreId: CoreIdSchema.parse(value.coreId) }));
  if (new Set(cores.map(core => core.coreId)).size !== cores.length)
    throw new CoreAccessError("core_unavailable", "实际数据观察不能重复登记Core");
  const database: Reader = { $queryRaw: input.database.$queryRaw.bind(input.database) };
  const read = async (module: ReturnType<typeof plan>, receipts: readonly Receipt[]): Promise<CoreDataObservation["platform"] | undefined> => {
    const observed = await module.physical(database);
    if (!observed) return;
    const parsed = CorePhysicalDataObservationSchema.safeParse(observed);
    if (!parsed.success) return;
    const physical = parsed.data;
    const appliedMigrations: CoreDataObservation["platform"]["appliedMigrations"] = [];
    const seen = new Set<string>();
    let execution: CoreMigrationExecution = { state: "ready" };
    for (const receipt of receipts) {
      const id = module.ids.get(receipt.migrationName);
      if (!id || receipt.rolledBackAt !== null) continue;
      // 损坏的是所属模块的迁移证据，不能据此关闭另一Core；省略后目标准入明确拒绝。
      if (seen.has(receipt.migrationName)) return;
      seen.add(receipt.migrationName);
      if (typeof receipt.checksum !== "string" || !/^[a-f0-9]{64}$/.test(receipt.checksum))
        return;
      if (receipt.finishedAt !== null) {
        if (!(receipt.finishedAt instanceof Date) || !Number.isFinite(receipt.finishedAt.getTime())) return;
        // 保留原账的执行顺序和摘要，不能按清单重排成看似匹配的已应用链。
        appliedMigrations.push({ id, sha256: receipt.checksum });
      }
      else if (execution.state === "ready") {
        // 未结束收据不能证明进程仍在运行，也不能把applied_steps_count当DDL已完成语句数。
        execution = { state: receipt.hasFailure === true || receipt.hasFailure === 1 || receipt.hasFailure === 1n ? "failed" : "unknown",
          migration: { id, sha256: receipt.checksum }, physicalState: { observedAt: physical.observedAt, sha256: physical.sha256 } };
      }
    }
    return { version: physical.version, appliedMigrations, execution };
  };
  return { async read(coreId) {
    const target = coreId === undefined ? undefined : CoreIdSchema.parse(coreId);
    const selected = target === undefined ? cores : cores.filter(core => core.coreId === target);
    if (coreId !== undefined && !selected.length) throw new CoreAccessError("core_unavailable", "目标Core没有登记实际数据观察");
    const names = [...new Set([platform, ...selected].flatMap(module => module.names))];
    // 一次读取所选模块原账，再由各所有者读取物理结构；查询/驱动失败仍原样向上报告。
    const receipts = names.length ? await database.$queryRaw<Receipt[]>(sql`
      SELECT migration_name AS migrationName, checksum, finished_at AS finishedAt, rolled_back_at AS rolledBackAt,
        (logs IS NOT NULL AND logs <> '') AS hasFailure FROM _prisma_migrations
      WHERE migration_name IN (${join(names)}) ORDER BY started_at, id`) : [];
    const platformState = await read(platform, receipts);
    if (!platformState) throw new CoreAccessError("core_unavailable", "平台实际物理数据状态尚未核定");
    const coreStates = await Promise.all(selected.map(async core => {
      const state = await read(core, receipts);
      return state ? { ...state, coreId: core.coreId } : undefined;
    }));
    return CoreDataObservationSchema.parse({ platform: platformState, cores: coreStates.filter(state => state !== undefined) });
  } };
}
