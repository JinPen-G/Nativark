/** 线下收款的私有MySQL视图；原资金参加者共用本事务，不允许跨事务补造确认。 */
import type { RentalOfflinePaymentMethod } from "./contracts";
import type { RentalFundingTransaction } from "./funding-storage";

export type StaffOfflinePaymentTransaction = RentalFundingTransaction;
export interface StaffOfflinePaymentStorage<TTransaction extends StaffOfflinePaymentTransaction> extends StaffOfflinePaymentTransaction {
  $transaction<T>(run: (transaction: TTransaction) => Promise<T>): Promise<T>;
}
export interface StaffOfflinePaymentCore<TTransaction> {
  resolveOfflinePaymentMethod(tenantId: string, requested?: RentalOfflinePaymentMethod, transaction?: TTransaction): PromiseLike<RentalOfflinePaymentMethod>;
}
