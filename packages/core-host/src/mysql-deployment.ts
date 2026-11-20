/** 读取原Prisma迁移收据与模块真实物理观察；无新迁移账、DDL、Client生成或缺数据成功回退。 */
import { sqltag as sql } from "@prisma/client/runtime/library";
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
  dataCapabilities?: readonly (CoreMysqlDataPlan & { capabilityId: string })[];
}): CoreDeploymentObservationSource {
  const plan = (value: CoreMysqlDataPlan) => {
    const data = CoreDataContractSchema.parse(value.data), names = [...value.migrationNames];
    if (names.length !== data.migrations.length || new Set(names).size !== names.length
      || names.some(name => typeof name !== "string" || !name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)))
      throw new CoreAccessError("core_unavailable", "模块迁移ID与原Prisma账名称未完整对应");
    return { names, ids: new Map(names.map((name, index) => [name, data.migrations[index].id])), physical: value.readPhysical.bind(value) };
  };
  const platform = { ...plan(input.platform), owner: "platform" };
  const cores = input.cores.map(value => {
    const coreId = CoreIdSchema.parse(value.coreId);
    return { ...plan(value), coreId, owner: `core:${coreId}` };
  });
  const capabilities = (input.dataCapabilities ?? []).map(value => {
    const capabilityId = CoreIdSchema.parse(value.capabilityId);
    return { ...plan(value), capabilityId, owner: `platform-capability:${capabilityId}` };
  });
  if (new Set(cores.map(core => core.coreId)).size !== cores.length)
    throw new CoreAccessError("core_unavailable", "实际数据观察不能重复登记Core");
  if (new Set(capabilities.map(capability => capability.capabilityId)).size !== capabilities.length)
    throw new CoreAccessError("core_unavailable", "实际数据观察不能重复登记能力");
  const namespaceOwner = (name: string): string | undefined => {
    const match = /^(core|platform-capability)\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.(.+)$/u.exec(name);
    return match && CoreIdSchema.safeParse(match[2]).success ? `${match[1]}:${match[2]}` : undefined;
  };
  const owners = new Map<string, string>();
  for (const module of [platform, ...cores, ...capabilities]) for (const name of module.names) {
    const namespace = namespaceOwner(name);
    if (owners.has(name) || namespace !== undefined && namespace !== module.owner)
      throw new CoreAccessError("core_unavailable", "原Prisma迁移名称跨模块冲突或违背正式命名空间归属");
    owners.set(name, module.owner);
  }
  // 旧名称保持显式映射；正式命名空间也能识别本版未声明的未来迁移。
  // 公共旧账没有统一前缀，剩余无法归属的记录不能当作无关账而略过。
  const receiptOwner = (name: string) => owners.get(name) ?? namespaceOwner(name) ?? "platform";
  const database: Reader = { $queryRaw: input.database.$queryRaw.bind(input.database) };
  const read = async (module: ReturnType<typeof plan> & { owner: string }, receipts: readonly Receipt[]): Promise<CoreDataObservation["platform"] | undefined> => {
    let observed: CorePhysicalDataObservation | undefined;
    try { observed = await module.physical(database); }
    catch {
      // 物理读取属于该模块：缺表/驱动失败与缺证据同样省略观察，不能牵连无依赖Core。
      // 平台缺观察仍由下方整体拒绝；所需能力和更新预检也各自拒绝缺失项，不补ready。
      return;
    }
    if (!observed) return;
    const parsed = CorePhysicalDataObservationSchema.safeParse(observed);
    if (!parsed.success) return;
    const physical = parsed.data;
    const appliedMigrations: CoreDataObservation["platform"]["appliedMigrations"] = [];
    const seen = new Set<string>();
    let execution: CoreMigrationExecution = { state: "ready" };
    for (const receipt of receipts) {
      if (receiptOwner(receipt.migrationName) !== module.owner) continue;
      const id = module.ids.get(receipt.migrationName);
      // 标记回退不等于撤销DDL/数据回填；旧实现仍须认识该所属迁移才能评估原链。
      if (!id) return;
      if (receipt.rolledBackAt !== null) {
        if (!(receipt.rolledBackAt instanceof Date) || !Number.isFinite(receipt.rolledBackAt.getTime())) return;
        continue; // 原回滚收据不计已应用，也不证明物理DDL已恢复。
      }
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
    // 读取完整原账而不是只查本版清单。新增表/纯回填可能不改变旧表的物理摘要；
    // 完整所属链仍是拒绝旧实例的必要证据。查询失败和无法识别归属的坏行拒绝全部。
    const receipts = await database.$queryRaw<Receipt[]>(sql`
      SELECT migration_name AS migrationName, checksum, finished_at AS finishedAt, rolled_back_at AS rolledBackAt,
        (logs IS NOT NULL AND logs <> '') AS hasFailure FROM _prisma_migrations
      ORDER BY started_at, id`);
    if (!Array.isArray(receipts) || receipts.some(receipt => !receipt || typeof receipt.migrationName !== "string"
      || !receipt.migrationName || receipt.migrationName.length > 255 || /[\u0000-\u001f\u007f]/u.test(receipt.migrationName)))
      throw new CoreAccessError("core_unavailable", "原Prisma迁移账的模块归属不可核定");
    const platformState = await read(platform, receipts);
    if (!platformState) throw new CoreAccessError("core_unavailable", "平台实际物理数据状态尚未核定");
    const coreStates = await Promise.all(selected.map(async core => {
      const state = await read(core, receipts);
      return state ? { ...state, coreId: core.coreId } : undefined;
    }));
    const capabilityStates = await Promise.all(capabilities.map(async capability => {
      const state = await read(capability, receipts);
      return state ? { ...state, capabilityId: capability.capabilityId } : undefined;
    }));
    return CoreDataObservationSchema.parse({ platform: platformState, cores: coreStates.filter(state => state !== undefined),
      ...(input.dataCapabilities ? { dataCapabilities: capabilityStates.filter(state => state !== undefined) } : {}) });
  } };
}
