/** Read-only, allowlisted global ORDER BY. Visibility stays in the repository WHERE. */
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RentalOrderListQuery, RentalOrderSortField } from "@rental-os/shared";

const columns: Record<RentalOrderSortField, Prisma.Sql> = {
  createdAt: Prisma.sql`o.\`createdAt\``,
  orderNo: Prisma.sql`o.\`orderNo\``,
  customerName: Prisma.sql`COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`membershipSnapshot\`, '$.personalCustomerName')), 'null'), o.\`customerName\`)`,
  startAt: Prisma.sql`o.\`startAt\``,
  endAt: Prisma.sql`CASE WHEN o.\`fulfillmentMode\` = 'carrier_shipping' THEN COALESCE(o.\`carrierRentalDueAt\`, o.\`effectiveEndAt\`, o.\`endAt\`) ELSE COALESCE(o.\`effectiveEndAt\`, o.\`endAt\`) END`,
  payableAmount: Prisma.sql`o.\`payableAmount\``,
  quoteNo: Prisma.sql`o.\`quoteNo\``,
  status: Prisma.sql`o.\`status\``,
};

export function rentalOrderListSort(query: Pick<RentalOrderListQuery, "sort">): Prisma.Sql {
  if (query.sort === undefined || query.sort === "") return Prisma.sql`o.\`createdAt\` DESC, o.\`id\` DESC`;
  if (typeof query.sort !== "string" || query.sort.length > 256) throw new BadRequestException("不支持的订单排序参数");
  const priorities = query.sort.split(",");
  if (priorities.length > 8) throw new BadRequestException("订单最多支持 8 个排序字段");
  const seen = new Set<string>();
  const terms = priorities.map(priority => {
    const match = /^([a-zA-Z][a-zA-Z0-9]*)[.](asc|desc)$/.exec(priority);
    if (!match || !Object.hasOwn(columns, match[1]) || seen.has(match[1])) throw new BadRequestException("不支持或重复的订单排序字段");
    seen.add(match[1]);
    const direction = match[2] === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    return Prisma.sql`${columns[match[1] as RentalOrderSortField]} ${direction}`;
  });
  // Unique tie-breaker keeps equal dates/amounts stable across pages.
  return Prisma.sql`${Prisma.join(terms, ", ")}, o.\`id\` DESC`;
}
