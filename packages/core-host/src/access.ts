/**
 * 平台持有租户Core授权和成员分配，业务范围/事实仍归各Core；两种开通分别记录。
 * 原身份/角色所有者必须供给当前管理权限和同事务审计，不能以安装清单代替授权。
 */
import { createHash } from "node:crypto";
import {
  ChangeMemberCoreAssignmentSchema, ChangeTenantCoreGrantSchema,
  CoreMemberAssignmentOperationQuerySchema, CoreTenantGrantOperationQuerySchema,
  MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  type CorePrincipal, type MemberCoreAssignment, type TenantCoreGrant
} from "@rental-os/core-contracts";

export class CoreAccessError extends Error {
  constructor(readonly code: "denied" | "revision_conflict" | "operation_conflict" | "core_unavailable", message: string) {
    super(message); this.name = "CoreAccessError";
  }
}
export type CoreAccessReceipt =
  | { kind: "tenant_grant"; actor: CorePrincipal; fingerprint: string; result: TenantCoreGrant }
  | { kind: "member_assignment"; actor: CorePrincipal; fingerprint: string; result: MemberCoreAssignment };
export interface CoreAccessRepository {
  grant(): Promise<TenantCoreGrant | undefined>;
  assignment(userId: string): Promise<MemberCoreAssignment | undefined>;
  saveGrant(value: TenantCoreGrant): Promise<void>;
  saveAssignment(value: MemberCoreAssignment): Promise<void>;
  receipt(operationId: string): Promise<CoreAccessReceipt | undefined>;
  saveReceipt(value: CoreAccessReceipt): Promise<void>;
}
export interface CoreManagementRequest {
  actor: CorePrincipal;
  tenantId: string;
  coreId: string;
  kind: "tenant_grant" | "member_assignment";
  targetMemberId?: string;
  /** 关闭/撤回允许在部署停用或租户到期时办理，不要求先恢复业务。 */
  enabling: boolean;
  /** 原收据读取不创建锁行、不写事实或审计；缺收据不能证明旧操作未提交。 */
  purpose?: "change" | "original_receipt";
}
export interface CoreManagementLease {
  actor: CorePrincipal;
  tenantId: string;
  canGrant: boolean;
  canAssign: boolean;
  targetMemberId?: string;
  /** 对同一原主体/租约复核自然流逝的期限，不能临时换身份继续提交。 */
  revalidate(): Promise<void>;
}
export interface CoreManagementExecution {
  /** 人员/当前管理角色/租户锁在Core锁之前；本回调的事实、原回执、审计一起提交。 */
  run<T>(request: CoreManagementRequest,
    work: (repository: CoreAccessRepository, lease: CoreManagementLease) => Promise<T>): Promise<T>;
}
export interface CoreDeploymentAvailability {
  /** 注册事实存在即可；已停用的实现仍可办理撤回，不要求重新开放业务。 */
  requireRegistered(coreId: string): Promise<void>;
  /** 核当前受控部署/实际数据版本/所需能力，不从源码清单假定已部署。 */
  requireAvailable(coreId: string, tenantId: string): Promise<void>;
}

export class CoreAccessService {
  constructor(private readonly execution: CoreManagementExecution, private readonly deployment: CoreDeploymentAvailability) {}

  changeTenantGrant(actor: CorePrincipal, input: unknown): Promise<TenantCoreGrant> {
    this.operator(actor);
    const parsed = ChangeTenantCoreGrantSchema.parse(input), kind = "tenant_grant" as const;
    return this.execution.run({ actor, tenantId: parsed.tenantId, coreId: parsed.coreId, kind, enabling: parsed.state === "enabled" }, async (store, lease) => {
      this.authorized(lease, actor, parsed.tenantId);
      if (!lease.canGrant) throw new CoreAccessError("denied", "只有当前获权SaaS管理员可办理租户Core授权");
      await this.deployment.requireRegistered(parsed.coreId);
      const fingerprint = this.fingerprint(actor, kind, parsed), previous = await store.receipt(parsed.operationId);
      if (previous) {
        this.sameOperation(previous, actor, kind, fingerprint);
        if (previous.kind !== kind) throw new CoreAccessError("operation_conflict", "原操作类型不一致");
        return previous.result;
      }
      const current = await store.grant();
      this.expected(current?.revision, parsed.expectedRevision);
      if (parsed.state === "enabled") await this.deployment.requireAvailable(parsed.coreId, parsed.tenantId);
      const result = TenantCoreGrantSchema.parse({ tenantId: parsed.tenantId, coreId: parsed.coreId, state: parsed.state,
        revision: parsed.expectedRevision + 1, operationId: parsed.operationId });
      await store.saveGrant(result);
      await store.saveReceipt({ kind, actor, fingerprint, result });
      return result;
    });
  }

  changeMemberAssignment(actor: CorePrincipal, input: unknown): Promise<MemberCoreAssignment> {
    this.operator(actor);
    const parsed = ChangeMemberCoreAssignmentSchema.parse(input), kind = "member_assignment" as const;
    return this.execution.run({ actor, tenantId: actor.tenantId, coreId: parsed.coreId, kind,
      targetMemberId: parsed.userId, enabling: parsed.state === "assigned" }, async (store, lease) => {
      this.authorized(lease, actor, actor.tenantId);
      if (!lease.canAssign || lease.targetMemberId !== parsed.userId)
        throw new CoreAccessError("denied", "当前租户管理员不能为该成员分配Core");
      await this.deployment.requireRegistered(parsed.coreId);
      const fingerprint = this.fingerprint(actor, kind, parsed), previous = await store.receipt(parsed.operationId);
      if (previous) {
        this.sameOperation(previous, actor, kind, fingerprint);
        if (previous.kind !== kind) throw new CoreAccessError("operation_conflict", "原操作类型不一致");
        return previous.result;
      }
      if (parsed.state === "assigned") {
        const grant = await store.grant();
        if (grant?.state !== "enabled") throw new CoreAccessError("denied", "租户尚未获授权使用该Core");
        await this.deployment.requireAvailable(parsed.coreId, actor.tenantId);
      }
      const current = await store.assignment(parsed.userId);
      this.expected(current?.revision, parsed.expectedRevision);
      const result = MemberCoreAssignmentSchema.parse({ tenantId: actor.tenantId, coreId: parsed.coreId, userId: parsed.userId,
        state: parsed.state, revision: parsed.expectedRevision + 1, operationId: parsed.operationId });
      await store.saveAssignment(result);
      await store.saveReceipt({ kind, actor, fingerprint, result });
      return result;
    });
  }

  readTenantGrantOperation(actor: CorePrincipal, input: unknown): Promise<
    { status: "recorded"; grant: TenantCoreGrant } | { status: "unavailable" }
  > {
    this.operator(actor);
    const parsed = CoreTenantGrantOperationQuerySchema.parse(input);
    return this.execution.run({ actor, tenantId: parsed.tenantId, coreId: parsed.coreId, kind: "tenant_grant",
      enabling: false, purpose: "original_receipt" }, async (store, lease) => {
      this.authorized(lease, actor, parsed.tenantId);
      if (!lease.canGrant) throw new CoreAccessError("denied", "当前主体不能读取原租户Core授权操作");
      const original = await store.receipt(parsed.operationId);
      if (!original) return { status: "unavailable" as const };
      this.originalActor(original, actor);
      if (original.kind !== "tenant_grant" || original.result.tenantId !== parsed.tenantId
        || original.result.coreId !== parsed.coreId || original.result.operationId !== parsed.operationId)
        throw new CoreAccessError("operation_conflict", "原操作不属于所选租户Core授权");
      return { status: "recorded" as const, grant: original.result };
    });
  }

  readMemberAssignmentOperation(actor: CorePrincipal, input: unknown): Promise<
    { status: "recorded"; assignment: MemberCoreAssignment } | { status: "unavailable" }
  > {
    this.operator(actor);
    const parsed = CoreMemberAssignmentOperationQuerySchema.parse(input);
    return this.execution.run({ actor, tenantId: actor.tenantId, coreId: parsed.coreId, kind: "member_assignment",
      targetMemberId: parsed.userId, enabling: false, purpose: "original_receipt" }, async (store, lease) => {
      this.authorized(lease, actor, actor.tenantId);
      if (!lease.canAssign || lease.targetMemberId !== parsed.userId)
        throw new CoreAccessError("denied", "当前主体不能读取该成员的原Core分配操作");
      const original = await store.receipt(parsed.operationId);
      if (!original) return { status: "unavailable" as const };
      this.originalActor(original, actor);
      if (original.kind !== "member_assignment" || original.result.userId !== parsed.userId
        || original.result.tenantId !== actor.tenantId || original.result.coreId !== parsed.coreId
        || original.result.operationId !== parsed.operationId)
        throw new CoreAccessError("operation_conflict", "原操作不属于所选成员Core分配");
      return { status: "recorded" as const, assignment: original.result };
    });
  }

  private authorized(lease: CoreManagementLease, actor: CorePrincipal, tenantId: string): void {
    if (actor.audience !== "operator" || lease.actor.tenantId !== actor.tenantId || lease.actor.subjectId !== actor.subjectId
      || lease.actor.audience !== actor.audience || lease.tenantId !== tenantId)
      throw new CoreAccessError("denied", "Core管理事务与原主体或目标租户不一致");
  }
  private operator(actor: CorePrincipal): void {
    if (actor.audience !== "operator") throw new CoreAccessError("denied", "Core管理仅对原租户/平台管理会话开放");
  }
  private expected(current: number | undefined, expected: number): void {
    if ((current ?? 0) !== expected || expected >= Number.MAX_SAFE_INTEGER)
      throw new CoreAccessError("revision_conflict", "Core授权已变化，请读取当前记录后办理");
  }
  private fingerprint(actor: CorePrincipal, kind: CoreAccessReceipt["kind"], input: unknown): string {
    return createHash("sha256").update(JSON.stringify([actor.tenantId, actor.subjectId, actor.audience, kind, input])).digest("hex");
  }
  private sameOperation(receipt: CoreAccessReceipt, actor: CorePrincipal, kind: CoreAccessReceipt["kind"], fingerprint: string): void {
    this.originalActor(receipt, actor);
    if (receipt.kind !== kind || receipt.fingerprint !== fingerprint)
      throw new CoreAccessError("operation_conflict", "原操作键已用于其他Core授权请求");
  }
  private originalActor(receipt: CoreAccessReceipt, actor: CorePrincipal): void {
    if (receipt.actor.tenantId !== actor.tenantId
      || receipt.actor.subjectId !== actor.subjectId || receipt.actor.audience !== actor.audience)
      throw new CoreAccessError("operation_conflict", "原Core授权操作不属于当前主体");
  }
}
