/** Rental配货与自动扫描使用的私有MySQL视图。沿用原事实/配置声明，公共Core合同不携带生成模型。
 * 失败事件只参加调用方的原事务，不决定库存、不调用模型、不授权自动重试。 */
import type { Prisma } from "@prisma/client";
import type { RentalCoreRuntimeTransaction } from "./core-runtime-ports";

export type RentalAllocationTransaction = RentalCoreRuntimeTransaction & {
  rentalAllocation: Pick<Prisma.TransactionClient["rentalAllocation"], "count">;
};
export type RentalAllocationStorage<TTransaction extends RentalAllocationTransaction> = TTransaction & {
  $transaction<TResult>(run: (transaction: TTransaction) => Promise<TResult>,
    options?: { isolationLevel: "ReadCommitted" }): Promise<TResult>;
};
export interface RentalAllocationFailureEvents<TTransaction> {
  fulfillment?(transaction: TTransaction, scope: { tenantId: string; workspaceId: string },
    orderId: string): PromiseLike<unknown>;
}

/** 标准宿主的自动作业准入；它不代替人工作业的原 Guard。
 * 事务参数存在时须在同一业务事务内复核当前 Core、空间和该作业的许可。 */
export interface RentalAllocationWorkerAuthority<TTransaction> {
  assertCurrent(scope: { tenantId: string; workspaceId: string }, transaction?: TTransaction): Promise<void>;
}
