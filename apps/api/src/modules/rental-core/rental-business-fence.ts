/** Shared parent fence for business transactions, before aggregate/stock/credit
 * locks. Enterprise policy writers hold the exclusive parent fence; never upgrade. */
import { Prisma } from "@prisma/client";
import { ForbiddenException } from "@nestjs/common";
export async function lockRentalBusinessTenant(tx: Prisma.TransactionClient, tenantId: string) {
  // Synchronization only: existing lifecycle/Guard checks still decide whether
  // this tenant may perform new business or historical fulfillment.
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
  if (!rows.length) throw new ForbiddenException("商户不存在，不能锁定租赁事务");
}
