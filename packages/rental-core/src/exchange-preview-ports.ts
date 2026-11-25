/** 换货试算的私有事务与服务视图。只委托原Core事实、价格和资源候选，
 * 宿主供给原事务；这里没有授权、提交换货、付款或跨Core数据库能力。 */
import type { RentalCoreRuntimeTransaction } from "./core-runtime-ports";
import type { RentalBusinessRuntimeTransaction } from "./business-runtime-ports";
import type { RentalAllocationTransaction } from "./allocation-storage";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalAllocationService } from "./mysql-allocation";
import type { RentalServiceCapacityService } from "./mysql-service-capacity";
import type { ApplyRentalOrderChangeRequest } from "./contracts";

export type RentalExchangeIntent = Pick<ApplyRentalOrderChangeRequest, "orderLineId" | "allocationId" | "replacementItemGroupId" | "replacementAssetId" | "replacementPricingGroupId" | "priceBasis" | "originalDisposition" | "exchangeLocationId" | "inspectionSnapshot" | "cancelServiceOccurrenceIds" | "services">;
export type RentalExchangePreviewTransaction = RentalCoreRuntimeTransaction & RentalBusinessRuntimeTransaction & RentalAllocationTransaction;
export type RentalExchangePreviewCore<TTransaction extends RentalExchangePreviewTransaction> = Pick<RentalCoreService<TTransaction>,
  "readBusinessContext" | "listItemGroups" | "listPricingGroups" | "lockOrderForUpdate" | "listOrderExtensions" | "listOrderChanges">;
export type RentalExchangePreviewBusiness<TTransaction extends RentalExchangePreviewTransaction> = Pick<RentalBusinessService<TTransaction>,
  "refreshWorkspaceContext" | "quotePostPickupExchange" | "captureExchangeExecutionBasis">;
export type RentalExchangePreviewAllocation<TTransaction extends RentalExchangePreviewTransaction> = Pick<RentalAllocationService<TTransaction>, "exchangeAssetCandidates">;
export type RentalExchangePreviewCapacity<TTransaction extends RentalExchangePreviewTransaction> = Pick<RentalServiceCapacityService<TTransaction>, "assertAvailableForExchange">;
export interface RentalExchangePreviewStorage<TTransaction> {
  $transaction<TResult>(run: (transaction: TTransaction) => Promise<TResult>): Promise<TResult>;
}
