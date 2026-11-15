/** 原租赁动作的私有事务端口，仅协调ReadCommitted；业务可写能力由原调用方拥有。 */
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";

export interface RentalActionTransactionStore<TTransaction extends RentalBusinessTenantTransaction> {
  $transaction<T>(
    run: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }
  ): PromiseLike<T>;
}
