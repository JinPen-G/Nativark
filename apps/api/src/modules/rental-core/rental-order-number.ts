/** Human order numbers are allocated under the workspace row lock, in the same
 * transaction as creation. Existing numbers and order IDs are never rewritten. */
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { businessDateKey, DEFAULT_BUSINESS_TIME_ZONE } from "./rental-business-day";

export async function allocateRentalOrderNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  createdAt: string,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): Promise<string> {
  const date = businessDateKey(createdAt, timeZone);
  const prefix = `RC${date.slice(2).replace(/-/g, "")}`;
  // Lock an existing parent, including on the first order of a day. A count or
  // an unlocked MAX would let two API instances hand out the same number.
  const scope = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT \`id\` FROM \`business_workspaces\`
    WHERE \`id\` = ${workspaceId} AND \`tenantId\` = ${tenantId} FOR UPDATE
  `);
  if (!scope.length) throw new ConflictException("经营空间不存在，无法分配订单号");
  // A locking current read also works if an earlier query established a
  // repeatable-read snapshot. Ignore the legacy timestamp-based numbers.
  const rows = await tx.$queryRaw<Array<{ orderNo: string }>>(Prisma.sql`
    SELECT \`orderNo\` FROM \`rental_orders\`
    WHERE \`tenantId\` = ${tenantId} AND \`workspaceId\` = ${workspaceId}
      AND \`orderNo\` >= ${`${prefix}0001`} AND \`orderNo\` <= ${`${prefix}9999`}
      AND \`orderNo\` REGEXP ${`^${prefix}[0-9]{4}$`}
    ORDER BY \`orderNo\` DESC LIMIT 1 FOR UPDATE
  `);
  const sequence = rows.length ? Number(rows[0].orderNo.slice(-4)) + 1 : 1;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new ConflictException("当前经营空间当日订单编号已达上限，请联系管理员");
  }
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}
