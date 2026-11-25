/** Customer analysis reads the profile's already-authorized order predicate.
 * Counts exclude drafts; original Core payable facts are grouped by currency and never describe receipts.
 * UTC monthly buckets and current-month partial data are explicit in the public model. */
import type { CustomerProfileInsights } from "./contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

export async function readCustomerInsights(prisma: Pick<PrismaClient, "rentalOrder">, scope: Prisma.RentalOrderWhereInput,
  at = new Date(), readAmounts = true): Promise<CustomerProfileInsights> {
  const where: Prisma.RentalOrderWhereInput = { AND: [scope, { status: { not: "DRAFT" } }] };
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 11 + index, 1));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    return { month: from.toISOString().slice(0, 7), from, to };
  });
  const [groups, latest, monthly] = await Promise.all([
    prisma.rentalOrder.groupBy({ by: ["status", "currency"], where, _count: { _all: true },
      ...(readAmounts ? { _sum: { finalPayableAmount: true as const } } : {}) }),
    prisma.rentalOrder.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }),
    Promise.all(buckets.map(bucket => prisma.rentalOrder.groupBy({ by: ["status", "currency"],
      where: { AND: [where, { createdAt: { gte: bucket.from, lt: bucket.to } }] }, _count: { _all: true },
      ...(readAmounts ? { _sum: { finalPayableAmount: true as const } } : {}) })))
  ]);
  const amounts = (rows: typeof groups) => {
    // 与原订单明细使用相同金额权限；即便替身/存储额外返字段，也不能投影受限金额。
    if (!readAmounts) return [];
    const totals = new Map<string, { currency: string; payableAmount: Prisma.Decimal; orders: number }>();
    for (const row of rows) {
      const payableAmount = row._sum?.finalPayableAmount;
      if (["CANCELLED", "NO_SHOW"].includes(row.status) || !row.currency || payableAmount == null) continue;
      const total = totals.get(row.currency);
      if (total) { total.payableAmount = total.payableAmount.plus(payableAmount); total.orders += row._count._all; }
      else totals.set(row.currency, { currency: row.currency, payableAmount, orders: row._count._all });
    }
    return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency)).map(row => ({ ...row, payableAmount: Number(row.payableAmount) }));
  };
  const statuses = new Map<string, number>();
  for (const row of groups) statuses.set(row.status.toLowerCase(), (statuses.get(row.status.toLowerCase()) ?? 0) + row._count._all);
  return { asOf: at.toISOString(), timeZone: "UTC", totalOrders: groups.reduce((sum, row) => sum + row._count._all, 0),
    completedOrders: statuses.get("completed") ?? 0,
    activeOrders: ["reserved", "pickup_overdue", "ready_for_pickup", "renting", "return_inspection", "settling"].reduce((sum, status) => sum + (statuses.get(status) ?? 0), 0),
    lastOrderAt: latest?.createdAt.toISOString(), amounts: amounts(groups),
    statusBreakdown: [...statuses].map(([status, count]) => ({ status, count })),
    months: buckets.map((bucket, index) => ({ month: bucket.month, orders: monthly[index].reduce((sum, row) => sum + row._count._all, 0), amounts: amounts(monthly[index]) })) };
}
