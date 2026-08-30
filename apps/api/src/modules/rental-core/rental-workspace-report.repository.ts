import { Injectable } from "@nestjs/common";
import { Prisma, RentalOrderV1Status } from "@prisma/client";
import type {
  RentalCategoryCode,
  RentalExceptionChargeType,
  RentalWorkspaceOperationReport
} from "@store-rental/shared";
import { RENTAL_EXCEPTION_CHARGE_TYPES, RentalCoreOrderStatus } from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

/**
 * REPORT-01A：当前经营空间经营报表的库侧唯一入口。
 *
 * 三条口径在这一层就固定，不留给调用方选择：
 *
 * 1. **每一条查询都带 `tenantId` + `workspaceId`**。空间是数据边界；少带一个条件
 *    就会把别的空间的订单算进来，而那种错误在页面上看起来只是「数字偏大」。
 * 2. **只读 `rental_orders`**，且只读四个品类都有的列（金额、状态、费用行）。
 *    车牌、门店、计费模式这类字段在非车辆品类里根本不存在，一旦进公式，
 *    报表就只对一个品类成立。
 * 3. **草稿不算经营事实**。`orderCount` 与所有金额都排除 `draft`，
 *    否则一张没提交的草稿会同时虚增订单量与应收。
 */
@Injectable()
export class RentalWorkspaceReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 金额列在库里是 Decimal；统一转 number 并保留两位，避免 0.30000000000000004 进页面。 */
  private money(value: Prisma.Decimal | null | undefined): number {
    return Math.round(Number(value ?? 0) * 100) / 100;
  }

  async getOperationReport(
    tenantId: string,
    workspaceId: string,
    categoryCode: RentalCategoryCode,
    range: { from?: string; to?: string } = {}
  ): Promise<RentalWorkspaceOperationReport> {
    // 区间按**起租时间**归入：经营口径关心「这段时间的租赁业务」，
    // 而不是「这段时间录入了哪些单」。缺省两端即不限。
    const startAt =
      range.from || range.to
        ? {
            ...(range.from ? { gte: new Date(range.from) } : {}),
            ...(range.to ? { lte: new Date(range.to) } : {})
          }
        : undefined;
    const where: Prisma.RentalOrderWhereInput = {
      tenantId,
      workspaceId,
      // Prisma 客户端枚举成员名是大写（`DRAFT`），库里存的是 `@map` 后的小写值。
      // 过滤条件必须用客户端枚举，出参再转回共享契约的小写值。
      status: { not: RentalOrderV1Status.DRAFT },
      ...(startAt ? { startAt } : {})
    };

    // 计数与求和交给数据库；只有异常费用需要读费用行（JSON 列无法在 SQL 里可移植地聚合）。
    const [grouped, sums, chargeRows] = await Promise.all([
      this.prisma.rentalOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.rentalOrder.aggregate({
        where,
        _sum: { rentalAmount: true, discountAmount: true, couponAmount: true, finalPayableAmount: true }
      }),
      this.prisma.rentalOrder.findMany({ where, select: { id: true, chargeLines: true } })
    ]);

    const exceptionTypes = new Set<string>(RENTAL_EXCEPTION_CHARGE_TYPES);
    const perType = new Map<RentalExceptionChargeType, { amount: number; orders: Set<string> }>();
    for (const type of RENTAL_EXCEPTION_CHARGE_TYPES) {
      perType.set(type, { amount: 0, orders: new Set() });
    }
    for (const row of chargeRows) {
      // 费用行是历史快照，形状可能早于某次契约调整；逐行做防御性判定，
      // 遇到不认识的行跳过而不是让整张报表 500。
      const lines = Array.isArray(row.chargeLines) ? row.chargeLines : [];
      for (const line of lines as Array<{ type?: unknown; amount?: unknown }>) {
        const type = typeof line?.type === "string" ? line.type : undefined;
        if (!type || !exceptionTypes.has(type)) continue;
        const amount = Number(line?.amount ?? 0);
        if (!Number.isFinite(amount)) continue;
        const bucket = perType.get(type as RentalExceptionChargeType)!;
        bucket.amount += amount;
        bucket.orders.add(row.id);
      }
    }
    const exceptionFeeBreakdown = RENTAL_EXCEPTION_CHARGE_TYPES.map((type) => {
      const bucket = perType.get(type)!;
      return {
        type,
        amount: Math.round(bucket.amount * 100) / 100,
        orderCount: bucket.orders.size
      };
    });
    // 异常订单按**去重后的订单**计：一张单同时逾期又损坏仍然只是一张异常单。
    const exceptionOrders = new Set<string>();
    for (const bucket of perType.values()) for (const id of bucket.orders) exceptionOrders.add(id);

    const orderCount = grouped.reduce((total, row) => total + row._count._all, 0);
    return {
      tenantId,
      workspaceId,
      categoryCode,
      range: { from: range.from, to: range.to },
      orderCount,
      statusBreakdown: grouped
        // `READY_FOR_PICKUP` → `ready_for_pickup`：客户端枚举名转共享契约值。
        // 两套命名恰好只差大小写，因此不另维护一张映射表（会多一处需要同步的事实）。
        .map((row) => ({
          status: String(row.status).toLowerCase() as RentalCoreOrderStatus,
          count: row._count._all
        }))
        .sort((a, b) => String(a.status).localeCompare(String(b.status))),
      rentalRevenue: this.money(sums._sum.rentalAmount),
      discountTotal:
        Math.round((Number(sums._sum.discountAmount ?? 0) + Number(sums._sum.couponAmount ?? 0)) * 100) / 100,
      receivableTotal: this.money(sums._sum.finalPayableAmount),
      exceptionFeeTotal:
        Math.round(exceptionFeeBreakdown.reduce((total, row) => total + row.amount, 0) * 100) / 100,
      exceptionOrderCount: exceptionOrders.size,
      exceptionFeeBreakdown,
      generatedAt: new Date().toISOString()
    };
  }
}
