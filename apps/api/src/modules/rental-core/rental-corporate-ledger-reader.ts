import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

type CreditLedgerRow = Prisma.CustomerCorporateCreditLedgerGetPayload<object>;

/** Complete original ledger, read in bounded pages under the credit writer's
 * mutex. A page limit is not an account limit; no amounts are silently omitted.
 * Does not repair or mutate money facts or grant operational ledger access. */
export async function readCorporateCreditLedger(
  prisma: PrismaService, tenantId: string, customerId: string, tx?: Prisma.TransactionClient
): Promise<CreditLedgerRow[]> {
  if (!tx) return prisma.$transaction(transaction => readCorporateCreditLedger(prisma, tenantId, customerId, transaction),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM customer_corporate_credits
    WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE`);
  const rows: CreditLedgerRow[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await tx.$queryRaw<CreditLedgerRow[]>(Prisma.sql`SELECT * FROM customer_corporate_credit_ledger
      WHERE tenantId = ${tenantId} AND customerId = ${customerId}
      ${cursor ? Prisma.sql`AND id > ${cursor}` : Prisma.empty}
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
