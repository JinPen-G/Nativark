/** 部署停新只裁定后续准入，不撤销已提交动作或声称已排空。
 * 控制与不可变原收据同事务提交；身份、持久锁及审计由原平台适配供给。 */
import { createHash } from "node:crypto";
import {
  CORE_DEPLOYMENT_ADMISSION_MAX_REVISION, ChangeCoreDeploymentAdmissionSchema,
  CoreDeploymentAdmissionQuerySchema, CoreDeploymentAdmissionOperationQuerySchema,
  CoreDeploymentAdmissionStateSchema, type CoreDeploymentAdmissionState,
  type CoreDeploymentAdmissionObservation, type CorePrincipal
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "./access";

/** 绑定到业务原事务。requireAccepting 须持当前读锁至该事务提交，不能另开观察事务代替。 */
export interface CoreDeploymentAdmission {
  readCurrent(coreId: string): Promise<CoreDeploymentAdmissionObservation>;
  requireAccepting(coreId: string): Promise<void>;
}
export interface CoreDeploymentAdmissionReceipt {
  actor: CorePrincipal;
  fingerprint: string;
  result: CoreDeploymentAdmissionState;
}
export interface CoreDeploymentAdmissionRequest {
  actor: CorePrincipal;
  coreId: string;
  purpose: "change" | "original_receipt" | "read_current";
}
export interface CoreDeploymentAdmissionLease {
  actor: CorePrincipal;
  canManage: boolean;
  revalidate(): Promise<void>;
}
export interface CoreDeploymentAdmissionRepository {
  current(): Promise<CoreDeploymentAdmissionState | undefined>;
  receipt(operationId: string): Promise<CoreDeploymentAdmissionReceipt | undefined>;
  save(receipt: CoreDeploymentAdmissionReceipt): Promise<void>;
}
export interface CoreDeploymentAdmissionExecution {
  run<T>(request: CoreDeploymentAdmissionRequest, work: (repository: CoreDeploymentAdmissionRepository,
    lease: CoreDeploymentAdmissionLease) => Promise<T>): Promise<T>;
}

export class CoreDeploymentAdmissionService {
  constructor(private readonly execution: CoreDeploymentAdmissionExecution,
    private readonly deployment: Pick<CoreDeploymentAvailability, "requireRegistered">) {}

  change(actor: CorePrincipal, input: unknown): Promise<CoreDeploymentAdmissionState> {
    const parsed = ChangeCoreDeploymentAdmissionSchema.parse(input);
    return this.execution.run({ actor, coreId: parsed.coreId, purpose: "change" }, async (store, lease) => {
      this.authorized(actor, lease);
      await this.deployment.requireRegistered(parsed.coreId);
      const fingerprint = createHash("sha256").update(JSON.stringify([actor.tenantId, actor.subjectId, actor.audience,
        parsed.coreId, parsed.state, parsed.expectedRevision, parsed.operationId])).digest("hex");
      // 先读取不可变旧操作；后续停新/重开不能把早先失应答变成新的同义操作。
      const original = await store.receipt(parsed.operationId);
      if (original) {
        this.original(original, actor, parsed.coreId, parsed.operationId);
        if (original.fingerprint !== fingerprint) throw new CoreAccessError("operation_conflict", "部署准入原操作键已用于不同输入");
        return original.result;
      }
      const current = await store.current();
      if ((current?.revision ?? 0) !== parsed.expectedRevision || parsed.expectedRevision >= CORE_DEPLOYMENT_ADMISSION_MAX_REVISION)
        throw new CoreAccessError("revision_conflict", "部署准入修订已变化或已达上限，请核对当前记录");
      const result = CoreDeploymentAdmissionStateSchema.parse({ coreId: parsed.coreId, state: parsed.state,
        operationId: parsed.operationId, revision: parsed.expectedRevision + 1 });
      await store.save({ actor, fingerprint, result });
      return result;
    });
  }

  readCurrent(actor: CorePrincipal, input: unknown): Promise<CoreDeploymentAdmissionObservation> {
    const parsed = CoreDeploymentAdmissionQuerySchema.parse(input);
    return this.execution.run({ actor, coreId: parsed.coreId, purpose: "read_current" }, async (store, lease) => {
      this.authorized(actor, lease);
      await this.deployment.requireRegistered(parsed.coreId);
      return await store.current() ?? { coreId: parsed.coreId, state: "unknown", reason: "尚未登记部署准入" };
    });
  }

  readOperation(actor: CorePrincipal, input: unknown): Promise<
    { status: "recorded"; admission: CoreDeploymentAdmissionState } | { status: "unavailable" }
  > {
    const parsed = CoreDeploymentAdmissionOperationQuerySchema.parse(input);
    return this.execution.run({ actor, coreId: parsed.coreId, purpose: "original_receipt" }, async (store, lease) => {
      this.authorized(actor, lease);
      const original = await store.receipt(parsed.operationId);
      if (!original) return { status: "unavailable" };
      this.original(original, actor, parsed.coreId, parsed.operationId);
      return { status: "recorded", admission: original.result };
    });
  }

  private authorized(actor: CorePrincipal, lease: CoreDeploymentAdmissionLease): void {
    if (actor.audience !== "operator" || !lease.canManage || lease.actor.tenantId !== actor.tenantId
      || lease.actor.subjectId !== actor.subjectId || lease.actor.audience !== actor.audience)
      throw new CoreAccessError("denied", "部署准入管理需要当前原 SaaS 管理主体");
  }
  private original(receipt: CoreDeploymentAdmissionReceipt, actor: CorePrincipal, coreId: string, operationId: string): void {
    if (receipt.actor.tenantId !== actor.tenantId || receipt.actor.subjectId !== actor.subjectId
      || receipt.actor.audience !== actor.audience || receipt.result.coreId !== coreId || receipt.result.operationId !== operationId)
      throw new CoreAccessError("operation_conflict", "部署准入原收据不属于当前主体、Core 或操作");
  }
}
