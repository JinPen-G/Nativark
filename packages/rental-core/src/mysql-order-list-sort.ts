/** Read-only, allowlisted global ORDER BY. Visibility stays in the repository WHERE. */
import { BadRequestException } from "@nestjs/common";
import { sqltag as sql, join, type Sql } from "@prisma/client/runtime/library";
import type { RentalOrderListQuery, RentalOrderSortField } from "./contracts";

const columns: Record<RentalOrderSortField, Sql> = {
  createdAt: sql`o.\`createdAt\``,
  orderNo: sql`o.\`orderNo\``,
  customerName: sql`COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.\`membershipSnapshot\`, '$.personalCustomerName')), 'null'), o.\`customerName\`)`,
  startAt: sql`o.\`startAt\``,
  endAt: sql`CASE WHEN o.\`fulfillmentMode\` = 'carrier_shipping' THEN COALESCE(o.\`carrierRentalDueAt\`, o.\`effectiveEndAt\`, o.\`endAt\`) ELSE COALESCE(o.\`effectiveEndAt\`, o.\`endAt\`) END`,
  payableAmount: sql`o.\`payableAmount\``,
  quoteNo: sql`o.\`quoteNo\``,
  status: sql`o.\`status\``,
};

export function rentalOrderListSort(query: Pick<RentalOrderListQuery, "sort">): Sql {
  if (query.sort === undefined || query.sort === "") return sql`o.\`createdAt\` DESC, o.\`id\` DESC`;
  if (typeof query.sort !== "string" || query.sort.length > 256) throw new BadRequestException("不支持的订单排序参数");
  const priorities = query.sort.split(",");
  if (priorities.length > 8) throw new BadRequestException("订单最多支持 8 个排序字段");
  const seen = new Set<string>();
  const terms = priorities.map(priority => {
    const match = /^([a-zA-Z][a-zA-Z0-9]*)[.](asc|desc)$/.exec(priority);
    if (!match || !Object.hasOwn(columns, match[1]) || seen.has(match[1])) throw new BadRequestException("不支持或重复的订单排序字段");
    seen.add(match[1]);
    const direction = match[2] === "asc" ? sql`ASC` : sql`DESC`;
    return sql`${columns[match[1] as RentalOrderSortField]} ${direction}`;
  });
  // Unique tie-breaker keeps equal dates/amounts stable across pages.
  return sql`${join(terms, ", ")}, o.\`id\` DESC`;
}
