/** 历史快照回填的私有MySQL模型视图；表/原事务保持，当前品类绑定与唯一声明仍由Rental裁定。 */
import type { Prisma } from "@prisma/client";
import type { RentalCategoryWriteTransaction } from "./mysql-category-write";
export type { RentalSnapshotConfig } from "./state-storage";

export type RentalSnapshotBackfillTransaction = Pick<Prisma.TransactionClient,
  "$queryRaw" | "businessWorkspace" | "rentalAllocation" | "rentalAsset" | "rentalBenefitAccount" | "rentalBundleComponent" | "rentalBusinessCalendar" | "rentalBusinessStateSnapshot" | "rentalCoreStateSnapshot" | "rentalCouponTemplate" | "rentalCustomerCoupon" | "rentalDiscountPlan" | "rentalFulfillmentLocation" | "rentalFulfillmentOperator" | "rentalInspectionRecord" | "rentalInspectionTemplate" | "rentalItemGroup" | "rentalNotificationLog" | "rentalNotificationTemplate" | "rentalOrder" | "rentalOrderLine" | "rentalPricingPlan" | "rentalQuote" | "rentalReferral" | "rentalReservation" | "rentalRewardLedgerEntry" | "rentalRuleVersion" | "rentalStockBalance" | "rentalTenantBusinessSettings" | "rentalValueAddedService" | "rentalValueAddedServiceVersion" | "tenant" | "tenantRentalProfile"
> & RentalCategoryWriteTransaction;

export interface RentalSnapshotBackfillStorage<TTransaction extends RentalSnapshotBackfillTransaction> extends RentalSnapshotBackfillTransaction {
  $transaction<T>(run: (transaction: TTransaction) => Promise<T>, options: { isolationLevel: "ReadCommitted"; timeout: number }): Promise<T>;
}
