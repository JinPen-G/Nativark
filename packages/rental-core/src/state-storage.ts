/** Rental MySQL恢复快照的私有存储视图，当前绑定锁和业务事件由原宿主提供。 */
import type { Sql, InputJsonValue } from "@prisma/client/runtime/library";

export interface RentalSnapshotTransaction {
  $queryRaw<T>(query: Sql): PromiseLike<T>;
  $executeRaw(query: Sql): PromiseLike<number>;
}

export interface RentalRecoverySnapshotRow {
  tenantId: string;
  workspaceId: string;
  state: unknown;
  updatedAt: Date;
}

export interface RentalSnapshotStore<TTransaction extends RentalSnapshotTransaction> {
  rentalCoreStateSnapshot: { findMany(): PromiseLike<RentalRecoverySnapshotRow[]> };
  rentalBusinessStateSnapshot: {
    findMany(): PromiseLike<RentalRecoverySnapshotRow[]>;
    upsert(input: {
      where: { workspaceId: string };
      update: { state: InputJsonValue };
      create: { workspaceId: string; tenantId: string; state: InputJsonValue };
    }): PromiseLike<unknown>;
  };
  tenantRentalProfile: {
    findMany(input: { select: { tenantId: true; categoryCode: true } }): PromiseLike<Array<{ tenantId: string; categoryCode: string }>>;
  };
  $transaction<T>(run: (transaction: TTransaction) => Promise<T>, options: { isolationLevel: "ReadCommitted" }): PromiseLike<T>;
}

export interface RentalSnapshotConfig {
  get<T>(name: string): T | undefined;
}

export interface RentalSnapshotContacts<TTransaction> {
  lockCategoryBinding(
    transaction: TTransaction,
    tenantId: string,
    workspaceId: string,
    expected?: { categoryVersionId: string; adoptionRevision: number }
  ): PromiseLike<{ binding: { categoryVersionId: string; adoptionRevision: number } }>;
  /** 等待原提交点的事件捕获完成；快照仓储不读取捕获结果。 */
  openingConfiguration?(
    transaction: TTransaction,
    context: { tenantId: string; workspaceId: string },
    reference: { kind: "core_snapshot"; id: string }
  ): PromiseLike<unknown>;
}
