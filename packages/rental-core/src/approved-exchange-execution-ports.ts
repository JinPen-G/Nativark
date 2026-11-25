/** 批准换货应用的私有参加者，仅开放原检查、Core、企业政策和授信所需方法。
 * 宿主供给同一事务；企业回调可消费批准，但不能替代Core核验或制造价格/同意。 */
import type { ApplyRentalOrderChangeRequest, RentalOrderChange, RentalOrderChangePreview } from "./contracts";
import type { ApprovedExchangeAuthority } from "./mysql-approved-exchange";
import type { RentalExchangeIntent } from "./exchange-preview-ports";
import type { RentalExchangeInspectionTransaction } from "./exchange-inspection-ports";
import type { RentalExchangeInspectionPreparationService } from "./mysql-exchange-inspection-preparation";

export interface RentalApprovedExchangeExecutionStorage<TTransaction> {
  $transaction<TResult>(
    run: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: "ReadCommitted"; maxWait?: number; timeout?: number }
  ): PromiseLike<TResult>;
}

export interface RentalApprovedExchangeExecutionCore<TTransaction> {
  listOrderChanges(tenantId: string, orderId: string, transaction: TTransaction): PromiseLike<RentalOrderChange[]>;
  applyPostPickupExchange(
    tenantId: string, orderId: string, preview: RentalOrderChangePreview,
    input: ApplyRentalOrderChangeRequest & { type: "post_pickup_exchange" },
    key: string, operator: string, transaction: TTransaction, authority: ApprovedExchangeAuthority
  ): PromiseLike<{ change: RentalOrderChange }>;
}

export interface RentalApprovedExchangeExecutionPrices<TTransaction> {
  preview(tenantId: string, orderId: string, intent: RentalExchangeIntent, transaction: TTransaction):
    PromiseLike<{ preview: RentalOrderChangePreview }>;
}

export interface RentalApprovedExchangeExecutionBusiness<TTransaction> {
  refreshFromDatabase(): PromiseLike<unknown>;
  repriceCouponForOrder(tenantId: string, orderId: string, reduction: number, transaction: TTransaction): PromiseLike<unknown>;
}

export type RentalApprovedExchangeExecutionInspections<TTransaction extends RentalExchangeInspectionTransaction> =
  Pick<RentalExchangeInspectionPreparationService<TTransaction>, "mediaScope" | "mediaOrder" | "readForExecution">;

export interface RentalApprovedExchangeExecutionSettlement<TTransaction> {
  requiresCreditSettlement(tenantId: string, orderId: string, transaction: TTransaction): PromiseLike<boolean>;
  reserveOrderChangeCredit(
    tenantId: string, orderId: string, changeId: string, amount: number, transaction: TTransaction, operator: string
  ): PromiseLike<unknown>;
}
