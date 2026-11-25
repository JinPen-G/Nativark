/** 在原授信互斥锁内分页读完整企业账；页大小不是账户上限，不改资金事实或授权。 */
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { sqltag as sql, empty } from '@prisma/client/runtime/library';
import type { RentalCorporateLedgerStorage, RentalCorporateLedgerTransaction } from "./corporate-receivable-storage";
export type { RentalCorporateLedgerStorage, RentalCorporateLedgerTransaction } from "./corporate-receivable-storage";

type CreditLedgerRow = Prisma.CustomerCorporateCreditLedgerGetPayload<object>;

/** Complete original ledger, read in bounded pages under the credit writer's
 * mutex. A page limit is not an account limit; no amounts are silently omitted.
 * Does not repair or mutate money facts or grant operational ledger access. */
export async function readCorporateCreditLedger<TTransaction extends RentalCorporateLedgerTransaction>(
  prisma: RentalCorporateLedgerStorage<TTransaction>, tenantId: string, customerId: string, tx?: TTransaction
): Promise<CreditLedgerRow[]> {
  if (!tx) return prisma.$transaction(transaction => readCorporateCreditLedger(prisma, tenantId, customerId, transaction),
    { isolationLevel: "ReadCommitted" });
  await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM customer_corporate_credits
    WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE`);
  const rows: CreditLedgerRow[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await tx.$queryRaw<CreditLedgerRow[]>(sql`SELECT * FROM customer_corporate_credit_ledger
      WHERE tenantId = ${tenantId} AND customerId = ${customerId}
      ${cursor ? sql`AND id > ${cursor}` : empty}
      ORDER BY id LIMIT 500 LOCK IN SHARE MODE`);
    if (page.length > 500 || page.some(row => row.tenantId !== tenantId || row.customerId !== customerId
      || typeof row.id !== 'string' || !row.id || seen.has(row.id))
      || new Set(page.map(row => row.id)).size !== page.length) {
      throw new ConflictException('企业原账分页来源不一致，须财务核对');
    }
    rows.push(...page); page.forEach(row => seen.add(row.id));
    // ORDER BY/id > share the database's collation, not JavaScript's UTF-16
    // ordering. Historical IDs need not be newly generated lowercase UUIDs.
    if (page.length < 500) return rows;
    cursor = page.at(-1)!.id;
  }
}
