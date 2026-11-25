/** Rental 空间能力的持久化接点，当前范围、事务与实例审计由原仓储供给。 */
import type {
  BusinessWorkspaceRunMode,
  RentalCapability,
  RentalCategoryCode,
  WorkspaceCapabilityAuditEvent,
  WorkspaceCapabilityInstance
} from "./contracts";

export interface WorkspaceCapabilityBinding {
  categoryVersionId: string;
  adoptionRevision: number;
}

export interface WorkspaceCapabilityScope {
  categoryCode: RentalCategoryCode;
  declaredCodes: RentalCapability[];
  requiredCodes?: RentalCapability[];
  binding?: WorkspaceCapabilityBinding;
}

/** 事务作为调用方持有的上下文转交，能力服务只消费明确的仓储方法。 */
export interface WorkspaceCapabilityRepositoryPort<TTransaction = unknown> {
  currentWorkspaceId(tenantId: string): PromiseLike<string>;
  workspaceScope(tenantId: string, workspaceId: string, transaction?: TTransaction): PromiseLike<WorkspaceCapabilityScope>;
  workspaceRunMode(tenantId: string, workspaceId: string): PromiseLike<BusinessWorkspaceRunMode>;
  listInstances(tenantId: string, workspaceId: string): PromiseLike<WorkspaceCapabilityInstance[]>;
  listInstancesInTx(tenantId: string, workspaceId: string, transaction: TTransaction): PromiseLike<WorkspaceCapabilityInstance[]>;
  findInstance(tenantId: string, workspaceId: string, code: RentalCapability): PromiseLike<WorkspaceCapabilityInstance | undefined>;
  listAudits(tenantId: string, workspaceId: string, code?: RentalCapability): PromiseLike<WorkspaceCapabilityAuditEvent[]>;
  initializeInstances(
    instances: WorkspaceCapabilityInstance[],
    audits: WorkspaceCapabilityAuditEvent[],
    transaction: TTransaction
  ): PromiseLike<RentalCapability[]>;
  saveInstance(
    instance: WorkspaceCapabilityInstance,
    audit: WorkspaceCapabilityAuditEvent,
    expectedRevision?: number,
    expectedBinding?: WorkspaceCapabilityBinding
  ): PromiseLike<WorkspaceCapabilityInstance>;
  runInTransaction<T>(run: (transaction: TTransaction) => Promise<T>): PromiseLike<T>;
}
