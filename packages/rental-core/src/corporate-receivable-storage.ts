/** Rental企业原账的私有MySQL能力；账目归原企业业务，公共Core合同不暴露生成模型。 */
import type { Prisma } from "@prisma/client";

export type RentalCorporateLedgerTransaction = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface RentalCorporateLedgerStorage<TTransaction extends RentalCorporateLedgerTransaction> {
  $transaction<T>(
    run: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }
  ): PromiseLike<T>;
}

export interface RentalOrderReceivableTransaction extends RentalCorporateLedgerTransaction {
  customerCorporateCreditLedger: Pick<Prisma.TransactionClient["customerCorporateCreditLedger"],
    "findUnique" | "create">;
}

export interface RentalOrderReceivableStorage<TTransaction extends RentalOrderReceivableTransaction>
  extends RentalOrderReceivableTransaction, RentalCorporateLedgerStorage<TTransaction> {
  customerCorporateCredit: Pick<Prisma.TransactionClient["customerCorporateCredit"], "findFirst">;
}
