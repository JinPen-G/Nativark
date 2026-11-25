/** 部署停新复用公共 SystemParameterSet，不建立迁移账或默认开放状态。
 * 管理方原 Tenant X → canonical X；业务原事务仅持 canonical S 至提交。
 * canonical、不可变原收据及原审计同事务；失 COMMIT 应答只按原操作核对，不重试。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  CoreDeploymentAdmissionStateSchema, CoreIdSchema,
  type CoreDeploymentAdmissionState, type CoreDeploymentAdmissionObservation, type CorePrincipal
} from "@rental-os/core-contracts";
import { CoreAccessError } from "./access";
import type {
  CoreDeploymentAdmission, CoreDeploymentAdmissionExecution, CoreDeploymentAdmissionLease,
  CoreDeploymentAdmissionReceipt, CoreDeploymentAdmissionRepository, CoreDeploymentAdmissionRequest
} from "./deployment-admission";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "./mysql";

const tenantId = "tenant_platform";
const moduleName = (coreId: string) => `core-deployment-admission:${coreId}`;
type Reader = Pick<CoreHostSqlTransaction, "$queryRaw">;
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const json = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;
const version = (value: unknown): number | undefined => {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 && number <= 2147483647 ? number : undefined;
};
const sameActor = (left: CorePrincipal, right: CorePrincipal) => left.tenantId === right.tenantId
  && left.subjectId === right.subjectId && left.audience === right.audience;
function principal(value: unknown): value is CorePrincipal {
  return object(value) && Object.keys(value).length === 3 && id(value.tenantId) && id(value.subjectId) && value.audience === "operator";
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every(object)) throw new CoreAccessError("core_unavailable", "部署准入存储返回不符合原结构");
  return value;
}
function ownRow(row: Row, coreId: string, status: "effective" | "archived"): boolean {
  return id(row.id) && row.tenantId === tenantId && row.module === moduleName(coreId) && row.status === status;
}
function canonical(row: Row, coreId: string): CoreDeploymentAdmissionState {
  const parsed = CoreDeploymentAdmissionStateSchema.safeParse(json(row.content));
  if (!ownRow(row, coreId, "effective") || version(row.versionNo) !== 1 || !parsed.success || parsed.data.coreId !== coreId)
    throw new CoreAccessError("core_unavailable", "部署准入当前记录损坏或归属不符");
  return parsed.data;
}
function parseReceipt(value: unknown, coreId: string, actor: CorePrincipal, operationId: string): CoreDeploymentAdmissionReceipt {
  const content = json(value);
  if (!object(content) || Object.keys(content).length !== 3 || !principal(content.actor) || !sameActor(content.actor, actor)
    || typeof content.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(content.fingerprint))
    throw new CoreAccessError("operation_conflict", "部署准入原收据主体或结构不符");
  const parsed = CoreDeploymentAdmissionStateSchema.safeParse(content.result);
  if (!parsed.success || parsed.data.coreId !== coreId || parsed.data.operationId !== operationId)
    throw new CoreAccessError("operation_conflict", "部署准入原收据不属于该 Core 或操作");
  const result = parsed.data;
  // 与原 change 输入的固定摘要对应；成功结果 revision - 1 就是该次 expectedRevision。
  const fingerprint = createHash("sha256").update(JSON.stringify([actor.tenantId, actor.subjectId, actor.audience,
    coreId, result.state, result.revision - 1, operationId])).digest("hex");
  if (content.fingerprint !== fingerprint) throw new CoreAccessError("operation_conflict", "部署准入原收据摘要与结果不符");
  return { actor: { ...actor }, fingerprint, result };
}
function duplicate(error: unknown): boolean {
  return object(error) && (error.code === "P2002" || error.code === "ER_DUP_ENTRY" || error.code === 1062
    || error.code === "P2010" && object(error.meta) && (error.meta.code === "1062" || error.meta.code === 1062));
}

/** tx 必须为调用方业务原事务；这里不锁平台父 Tenant，也不另开只读事务。 */
export function createMysqlCoreDeploymentAdmission(tx: Reader): CoreDeploymentAdmission {
  const readCurrent = async (value: string): Promise<CoreDeploymentAdmissionObservation> => {
    const coreId = CoreIdSchema.parse(value);
    try {
      const found = rows(await tx.$queryRaw`
        SELECT id, tenantId, module, versionNo, status, content, operator FROM SystemParameterSet
        WHERE tenantId = ${tenantId} AND module = ${moduleName(coreId)} AND versionNo = 1 LOCK IN SHARE MODE`);
      if (!found.length) return { coreId, state: "unknown", reason: "尚未登记部署准入" };
      if (found.length !== 1) return { coreId, state: "unknown", reason: "部署准入当前记录不唯一" };
      return canonical(found[0], coreId);
    } catch {
      // 不向调用方暴露驱动原文，也不把损坏/读失败解释成 stopped 或 accepting。
      return { coreId, state: "unknown", reason: "部署准入当前记录不可核定" };
    }
  };
  return { readCurrent, async requireAccepting(coreId) {
    if ((await readCurrent(coreId)).state !== "accepting")
      throw new CoreAccessError("core_unavailable", "该 Core 的部署当前未开放新准入");
  } };
}

export interface MysqlCoreDeploymentAdmissionAuthority<Tx extends CoreHostSqlTransaction> {
  /** 原 principal.lock(actor, tenant_platform) 持 Tenant X；首次缺 canonical 也沿此父锁串行。 */
  lock(tx: Tx, request: CoreDeploymentAdmissionRequest): Promise<CoreDeploymentAdmissionLease>;
  audit(tx: Tx, receipt: CoreDeploymentAdmissionReceipt): Promise<void>;
}

class MysqlDeploymentAdmissionRepository implements CoreDeploymentAdmissionRepository {
  private locked: Row[] = [];
  private orphaned = false;
  constructor(private readonly tx: CoreHostSqlTransaction, private readonly request: CoreDeploymentAdmissionRequest,
    private readonly assertActive: () => void, private readonly audit: (receipt: CoreDeploymentAdmissionReceipt) => Promise<void>) {}

  async lock(): Promise<void> {
    this.assertActive();
    this.locked = rows(await this.tx.$queryRaw`
      SELECT id, tenantId, module, versionNo, status, content, operator FROM SystemParameterSet
      WHERE tenantId = ${tenantId} AND module = ${moduleName(this.request.coreId)} AND versionNo = 1 FOR UPDATE`);
    if (!this.locked.length) {
      const archived = rows(await this.tx.$queryRaw`
        SELECT id FROM SystemParameterSet WHERE tenantId = ${tenantId} AND module = ${moduleName(this.request.coreId)}
          AND status = 'archived' LIMIT 1 FOR UPDATE`);
      this.orphaned = archived.length !== 0;
    }
    this.assertActive();
  }

  async current(): Promise<CoreDeploymentAdmissionState | undefined> {
    this.assertActive();
    if (!this.locked.length && !this.orphaned) return undefined;
    if (this.locked.length !== 1) throw new CoreAccessError("core_unavailable", "部署准入当前记录缺失或不唯一，不能重新初始化");
    try { return canonical(this.locked[0], this.request.coreId); }
    catch { throw new CoreAccessError("core_unavailable", "部署准入当前记录不可核定"); }
  }

  async receipt(operationId: string): Promise<CoreDeploymentAdmissionReceipt | undefined> {
    this.assertActive();
    if (!id(operationId)) throw new CoreAccessError("operation_conflict", "部署准入原操作键无效");
    // 查全部 archived；JSON 字符串精确比较不受配置表默认字符排序规则影响，不限最新版本。
    const found = rows(await this.tx.$queryRaw`
      SELECT id, tenantId, module, versionNo, status, content, operator FROM SystemParameterSet
      WHERE tenantId = ${tenantId} AND module = ${moduleName(this.request.coreId)} AND status = 'archived'
        AND JSON_EXTRACT(content, '$.result.operationId') = CAST(${JSON.stringify(operationId)} AS JSON)
      ORDER BY versionNo FOR UPDATE`);
    this.assertActive();
    if (!found.length) return undefined;
    if (found.length !== 1) throw new CoreAccessError("operation_conflict", "部署准入原操作存在重复收据");
    try {
      const row = found[0], receipt = parseReceipt(row.content, this.request.coreId, this.request.actor, operationId);
      if (!ownRow(row, this.request.coreId, "archived") || version(row.versionNo) !== receipt.result.revision + 1
        || row.operator !== receipt.actor.subjectId)
        throw new CoreAccessError("operation_conflict", "部署准入原收据版本或归属不符");
      return receipt;
    } catch { throw new CoreAccessError("operation_conflict", "部署准入原收据损坏或归属不符"); }
  }

  async save(input: CoreDeploymentAdmissionReceipt): Promise<void> {
    this.assertActive();
    if (this.request.purpose !== "change") throw new CoreAccessError("denied", "部署准入读取不能写入状态或收据");
    const operationId = object(input) && object(input.result) ? input.result.operationId : undefined;
    if (!id(operationId)) throw new CoreAccessError("operation_conflict", "部署准入待保存收据缺少原操作键");
    const receipt = parseReceipt(input, this.request.coreId, this.request.actor, operationId);
    const current = await this.current(), next = receipt.result;
    if (next.revision !== (current?.revision ?? 0) + 1)
      throw new CoreAccessError("revision_conflict", "部署准入修订与锁定的当前记录不符");
    if (current?.operationId === next.operationId)
      throw new CoreAccessError("operation_conflict", "部署准入当前操作缺少可核定原收据，不能再次写入");
    if (await this.receipt(next.operationId)) throw new CoreAccessError("operation_conflict", "部署准入原操作已有收据，不能再次写入");
    this.assertActive();
    const rowId = current ? this.locked[0].id : randomUUID();
    let changed: number;
    try {
      changed = current ? await this.tx.$executeRaw`
        UPDATE SystemParameterSet SET content = CAST(${JSON.stringify(next)} AS JSON), operator = ${receipt.actor.subjectId},
          effectiveAt = CURRENT_TIMESTAMP(3), updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ${rowId} AND tenantId = ${tenantId} AND module = ${moduleName(this.request.coreId)}
          AND versionNo = 1 AND status = 'effective' AND content = CAST(${JSON.stringify(current)} AS JSON)`
        : await this.tx.$executeRaw`
        INSERT INTO SystemParameterSet (id, tenantId, module, versionNo, status, content, operator, effectiveAt, createdAt, updatedAt)
        VALUES (${rowId}, ${tenantId}, ${moduleName(this.request.coreId)}, 1, 'effective', CAST(${JSON.stringify(next)} AS JSON),
          ${receipt.actor.subjectId}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
    } catch (error) {
      if (duplicate(error)) throw new CoreAccessError("revision_conflict", "部署准入当前记录已被占用");
      throw error;
    }
    if (changed !== 1) throw new CoreAccessError("revision_conflict", "部署准入当前记录比较更新失败");
    this.assertActive();
    try {
      const recorded = await this.tx.$executeRaw`
        INSERT INTO SystemParameterSet (id, tenantId, module, versionNo, status, content, operator, effectiveAt, createdAt, updatedAt)
        VALUES (${randomUUID()}, ${tenantId}, ${moduleName(this.request.coreId)}, ${next.revision + 1}, 'archived',
          CAST(${JSON.stringify(receipt)} AS JSON), ${receipt.actor.subjectId}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
      if (recorded !== 1) throw new CoreAccessError("operation_conflict", "部署准入原收据未唯一写入");
    } catch (error) {
      if (duplicate(error)) throw new CoreAccessError("operation_conflict", "部署准入原收据版本已被占用");
      throw error;
    }
    await this.audit(receipt);
    this.assertActive();
    this.locked = [{ id: rowId, tenantId, module: moduleName(this.request.coreId), versionNo: 1,
      status: "effective", content: structuredClone(next), operator: receipt.actor.subjectId }];
  }
}

export function createMysqlCoreDeploymentAdmissionExecution<Tx extends CoreHostSqlTransaction>(
  client: CoreHostSqlClient<Tx>, authority: MysqlCoreDeploymentAdmissionAuthority<Tx>
): CoreDeploymentAdmissionExecution {
  return { run(request, work) {
    if (!principal(request.actor) || !["change", "original_receipt", "read_current"].includes(request.purpose))
      throw new CoreAccessError("denied", "部署准入管理需要原平台操作员主体与明确目的");
    const selected = Object.freeze({ ...request, coreId: CoreIdSchema.parse(request.coreId), actor: Object.freeze({ ...request.actor }) });
    return client.$transaction(async tx => {
      let active = true;
      const original = await authority.lock(tx, selected);
      const assertActive = () => {
        if (!active || !original || !principal(original.actor) || !sameActor(original.actor, selected.actor)
          || original.canManage !== true || typeof original.revalidate !== "function")
          throw new CoreAccessError("denied", "部署准入管理租约已经失效或原主体不符");
      };
      const lease: CoreDeploymentAdmissionLease = Object.freeze({ actor: selected.actor, canManage: true,
        async revalidate() { assertActive(); await original.revalidate(); assertActive(); } });
      const repository = new MysqlDeploymentAdmissionRepository(tx, selected, assertActive, receipt => authority.audit(tx, receipt));
      try {
        assertActive();
        await repository.lock();
        const result = await work(repository, lease);
        await lease.revalidate();
        return result;
      } finally { active = false; }
    }, { isolationLevel: "ReadCommitted" });
  } };
}
