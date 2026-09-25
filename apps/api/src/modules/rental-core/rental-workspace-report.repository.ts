import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, RentalOrderV1Status } from "@prisma/client";
import type {
  RentalCategoryCode,
  RentalCurrency,
  RentalExceptionChargeType,
  RentalWorkspaceCustomerBreakdownRow,
  RentalWorkspaceLocationBreakdownRow,
  RentalWorkspaceOperationReport,
  RentalWorkspaceReportFilter,
  RentalWorkspaceUtilization
} from "@rental-os/shared";
import { RENTAL_EXCEPTION_CHARGE_TYPES, RentalAssetStatus, RentalCoreOrderStatus } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { roundMoney, roundRatio } from "./rental-money";
import { getRequestDataScope, getRequestLocationIds, getRequestUserId } from "../../common/request-identity";

/** 一次分页读取的订单数。内存上限与总订单量解耦，不随经营空间变大而变大。 */
const SCAN_PAGE_SIZE = 500;

/**
 * REPORT-01B：当前事实无法还原的口径，逐条登记。
 *
 * 这不是「以后再做」的清单，而是**必须随报表一起交付给使用者**的说明：
 * 库里只有资产与库存的当前值，没有状态变更历史，因此区间利用率在数据上不存在。
 * 把它放进出参，页面就必须显示；只写在文档里，运营照样会把快照当区间利用率用。
 */
const HISTORICAL_CALIBER_GAPS = [
  "序列化资产只有当前状态（rental_assets.status），没有状态变更历史表，"
    + "因此无法还原任一区间内的可出租时长；本报表的资产口径是读取瞬间的快照。",
  "数量库存只有当前在库/占用/维修三个数量列（rental_stock_balances），同样没有历史，"
    + "库存口径也是快照。",
  "区间口径只提供订单占用时长（分子），不提供利用率比率：分母「可出租时长」需要历史可用状态，"
    + "用当前状态乘区间长度会被读成历史利用率，那是伪造而不是估算。"
];

/**
 * REPORT-01A/01B：当前经营空间经营报表的库侧唯一入口。
 *
 * 四条口径在这一层就固定，不留给调用方选择：
 *
 * 1. **每一条查询都带 `tenantId` + `workspaceId`**。空间是数据边界；少带一个条件
 *    就会把别的空间的订单算进来，而那种错误在页面上看起来只是「数字偏大」。
 * 2. **只读 Rental Core 规范化事实**，且只读四个品类都有的列。车牌、门店、计费模式
 *    这类字段在非车辆品类里根本不存在，一旦进公式，报表就只对一个品类成立。
 * 3. **草稿不算经营事实**。`orderCount` 与所有金额都排除 `draft`。
 * 4. **大区间靠数据库聚合或分页**。计数与求和交给 `groupBy`/`aggregate`；
 *    只有费用行 JSON 无法在 SQL 里可移植地聚合，因此按主键分页扫描，
 *    并在同一趟里顺带累计租期时长与各维度异常费用——不为每个维度再扫一遍。
 */
@Injectable()
export class RentalWorkspaceReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private rangeInstant(value: string | undefined, label: string): Date | undefined {
    if (value === undefined) return undefined;
    if (!value.trim()) throw new BadRequestException(`${label}不能为空`);
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new BadRequestException(`${label}不是有效日期时间`);
    return instant;
  }

  /** 金额列在库里是 Decimal；统一转 number 并保留两位，避免 0.30000000000000004 进页面。 */
  private money(value: Prisma.Decimal | null | undefined): number {
    return roundMoney(Number(value ?? 0));
  }

  private round2(value: number): number {
    return roundMoney(value);
  }

  /** 比率一律在分母为 0 时返回 0：报表里出现 NaN 会让整页数字失去可信度。 */
  private ratio(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return roundRatio(numerator / denominator);
  }

  /**
   * 组装订单侧查询条件。
   *
   * 空间与租户是**并列**的必要条件，写在最前面；筛选项一律可缺省，
   * 缺省即不限。区间按**起租时间**归入：经营口径关心「这段时间的租赁业务」，
   * 而不是「这段时间录入了哪些单」。
   */
  private buildOrderWhere(
    tenantId: string,
    workspaceId: string,
    filter: RentalWorkspaceReportFilter
  ): Prisma.RentalOrderWhereInput {
    const from = this.rangeInstant(filter.from, "统计开始时间");
    const to = this.rangeInstant(filter.to, "统计结束时间");
    if (from && to && from > to) throw new BadRequestException("统计开始时间不能晚于结束时间");
    const startAt =
      from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
    if (filter.customerType && !["personal", "corporate"].includes(filter.customerType)) {
      throw new BadRequestException("客户类型只能是 personal 或 corporate");
    }
    const clauses: Prisma.RentalOrderWhereInput[] = [];
    const allowedLocations = getRequestLocationIds();
    if (allowedLocations !== undefined) {
      const safeIds = allowedLocations.length ? allowedLocations : ["__no_authorized_location__"];
      // 报表按履约地点归属，避免一张订单因归还地点可见而泄露另一个地点的经营额。
      clauses.push({ fulfillmentLocationId: { in: safeIds } });
    }
    if (getRequestDataScope() === "own") {
      const userId = getRequestUserId();
      clauses.push(userId ? { OR: [
        { createdBy: userId },
        { workOrders: { some: { OR: [{ createdBy: userId }, { assigneeId: userId }] } } }
      ] } : { id: "__no_current_user__" });
    }
    return {
      tenantId,
      workspaceId,
      // Prisma 客户端枚举成员名是大写（`DRAFT`），库里存的是 `@map` 后的小写值。
      // 过滤条件必须用客户端枚举，出参再转回共享契约的小写值。
      status: { not: RentalOrderV1Status.DRAFT },
      ...(startAt ? { startAt } : {}),
      ...(filter.locationId ? { fulfillmentLocationId: filter.locationId } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.customerType ? { customerType: filter.customerType } : {}),
      ...(clauses.length ? { AND: clauses } : {})
    };
  }
  /**
   * 一趟分页扫描同时产出三件事：异常费用（按类型/地点/客户）、异常订单集合、租期时长。
   *
   * 为什么合成一趟：这三件都需要逐行读订单，其中费用行是 JSON、租期时长是两列相减，
   * 都无法在 SQL 里可移植地聚合。分成三趟会把同一批行读三遍；一趟里累计
   * 内存上限仍只由 `SCAN_PAGE_SIZE` 和维度基数决定，与总订单量无关。
   */
  private async scanOrderDetails(where: Prisma.RentalOrderWhereInput) {
    const exceptionTypes = new Set<string>(RENTAL_EXCEPTION_CHARGE_TYPES);
    const perType = new Map<RentalExceptionChargeType, { amount: number; orders: Set<string> }>();
    for (const type of RENTAL_EXCEPTION_CHARGE_TYPES) perType.set(type, { amount: 0, orders: new Set() });
    const exceptionByLocation = new Map<string, number>();
    const exceptionByCustomer = new Map<string, number>();
    let occupancyHours = 0;
    let scannedOrders = 0;

    let cursor: string | undefined;
    do {
      const rows = await this.prisma.rentalOrder.findMany({
        where,
        select: {
          id: true,
          chargeLines: true,
          startAt: true,
          endAt: true,
          effectiveEndAt: true,
          fulfillmentLocationId: true,
          customerId: true,
          customerName: true
        },
        orderBy: { id: "asc" },
        take: SCAN_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
      for (const row of rows) {
        scannedOrders += 1;
        // 占用时长算到**当前**归还时间：续租延长出来的那几天同样占着资产，
        // 读原 `endAt` 会让续租过的订单在报表里显示成没占用过那段时间。
        const occupiedUntil = row.effectiveEndAt ?? row.endAt;
        const hours = (occupiedUntil.getTime() - row.startAt.getTime()) / 3_600_000;
        // 负时长只可能来自坏数据；计入会让平均租期变短并掩盖问题，因此按 0 计。
        if (Number.isFinite(hours) && hours > 0) occupancyHours += hours;
        // 费用行是历史快照，形状可能早于某次契约调整；逐行做防御性判定，
        // 遇到不认识的行跳过而不是让整张报表 500。
        const lines = Array.isArray(row.chargeLines) ? row.chargeLines : [];
        let orderExceptionAmount = 0;
        for (const line of lines as Array<{ type?: unknown; amount?: unknown }>) {
          const type = typeof line?.type === "string" ? line.type : undefined;
          if (!type || !exceptionTypes.has(type)) continue;
          const amount = Number(line?.amount ?? 0);
          if (!Number.isFinite(amount)) continue;
          const bucket = perType.get(type as RentalExceptionChargeType)!;
          bucket.amount += amount;
          bucket.orders.add(row.id);
          orderExceptionAmount += amount;
        }
        if (orderExceptionAmount) {
          const locationKey = row.fulfillmentLocationId;
          exceptionByLocation.set(locationKey, (exceptionByLocation.get(locationKey) ?? 0) + orderExceptionAmount);
          const customerKey = this.customerKey(row.customerId, row.customerName);
          exceptionByCustomer.set(customerKey, (exceptionByCustomer.get(customerKey) ?? 0) + orderExceptionAmount);
        }
      }
      cursor = rows.length === SCAN_PAGE_SIZE ? rows.at(-1)?.id : undefined;
    } while (cursor);

    return { perType, exceptionByLocation, exceptionByCustomer, occupancyHours, scannedOrders };
  }

  /**
   * 客户归并键。
   *
   * 存量订单可能没有客户主档 id（`customerId` 可空），此时只能按订单上的客户名归并。
   * 用 `name:` 前缀区分两类键，避免一个恰好等于某个 uuid 的客户名把两组数据合到一起。
   */
  private customerKey(customerId: string | null | undefined, customerName: string): string {
    return customerId ? `id:${customerId}` : `name:${customerName}`;
  }
  /**
   * 库存与资产口径。**当前快照**，与统计区间无关。
   *
   * 地点筛选会作用于本指标（资产与库存都归属地点），但区间与客户筛选不会：
   * 区间对快照没有意义，客户与资产之间没有归属关系。这一点写在返回值的
   * `snapshotAt` 与共享契约注释里，页面据此标注。
   */
  private async loadUtilization(
    tenantId: string,
    workspaceId: string,
    filter: RentalWorkspaceReportFilter,
    occupancy: { orderCount: number; hours: number }
  ): Promise<RentalWorkspaceUtilization> {
    const allowedLocations = getRequestLocationIds();
    const utilizationLocations = filter.locationId
      ? (allowedLocations === undefined || allowedLocations.includes(filter.locationId) ? [filter.locationId] : ["__no_authorized_location__"])
      : allowedLocations;
    const scope = {
      tenantId,
      workspaceId,
      ...(utilizationLocations === undefined
        ? {}
        : { locationId: { in: utilizationLocations.length ? utilizationLocations : ["__no_authorized_location__"] } })
    };
    const [assetGroups, stockSums] = await Promise.all([
      this.prisma.rentalAsset.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      this.prisma.rentalStockBalance.aggregate({
        where: scope,
        _sum: { onHandQuantity: true, reservedQuantity: true, maintenanceQuantity: true }
      })
    ]);
    const snapshotAt = new Date().toISOString();

    const statusBreakdown = assetGroups
      .map((row) => ({
        status: String(row.status).toLowerCase() as RentalAssetStatus,
        count: row._count._all
      }))
      .sort((a, b) => String(a.status).localeCompare(String(b.status)));
    const totalCount = statusBreakdown.reduce((total, row) => total + row.count, 0);
    const countOf = (status: RentalAssetStatus) =>
      statusBreakdown.find((row) => row.status === status)?.count ?? 0;
    // 分母排除 `disabled`：已停用的资产不参与经营，把它算进分母会让利用率
    // 随着报废资产越攒越多而越来越低，看上去像经营变差。
    const operableCount = totalCount - countOf(RentalAssetStatus.Disabled);
    const rentedCount = countOf(RentalAssetStatus.Rented);

    const onHandTotal = Number(stockSums._sum.onHandQuantity ?? 0);
    const reservedTotal = Number(stockSums._sum.reservedQuantity ?? 0);
    const maintenanceTotal = Number(stockSums._sum.maintenanceQuantity ?? 0);

    return {
      serializedAssets: {
        snapshotAt,
        totalCount,
        operableCount,
        rentedCount,
        rentedRatio: this.ratio(rentedCount, operableCount),
        statusBreakdown
      },
      quantityStock: {
        snapshotAt,
        onHandTotal,
        reservedTotal,
        maintenanceTotal,
        // 数据异常时不返回负库存：负数只会让人以为报表算错，而真正的问题在库里。
        availableTotal: Math.max(0, onHandTotal - reservedTotal - maintenanceTotal),
        reservedRatio: this.ratio(reservedTotal, onHandTotal)
      },
      orderOccupancy: {
        orderCount: occupancy.orderCount,
        totalHours: this.round2(occupancy.hours),
        averageHours: occupancy.orderCount ? this.round2(occupancy.hours / occupancy.orderCount) : 0
      }
    };
  }
  /**
   * 地点维度汇总。计数与金额由数据库 `groupBy` 聚合，异常费用来自那趟分页扫描。
   *
   * 按 id + 名称一起分组，再按 id 合并：名称是**下单时快照**，地点改名后同一个 id
   * 会有两个名字。合并时取订单数最多的那个名字（同数按名称排序定序），
   * 这样一行对一个地点，而不是让页面出现两行同一个地点。
   */
  private async loadLocationBreakdown(
    where: Prisma.RentalOrderWhereInput,
    exceptionByLocation: Map<string, number>
  ): Promise<RentalWorkspaceLocationBreakdownRow[]> {
    const groups = await this.prisma.rentalOrder.groupBy({
      by: ["fulfillmentLocationId", "fulfillmentLocationName"],
      where,
      _count: { _all: true },
      _sum: { rentalAmount: true, discountAmount: true, couponAmount: true, finalPayableAmount: true }
    });
    const merged = new Map<string, RentalWorkspaceLocationBreakdownRow & { nameVotes: Map<string, number> }>();
    for (const row of groups) {
      const id = row.fulfillmentLocationId;
      const existing = merged.get(id) ?? {
        locationId: id,
        locationName: row.fulfillmentLocationName,
        orderCount: 0,
        rentalRevenue: 0,
        discountTotal: 0,
        receivableTotal: 0,
        exceptionFeeTotal: this.round2(exceptionByLocation.get(id) ?? 0),
        nameVotes: new Map<string, number>()
      };
      existing.orderCount += row._count._all;
      existing.rentalRevenue += Number(row._sum.rentalAmount ?? 0);
      existing.discountTotal += Number(row._sum.discountAmount ?? 0) + Number(row._sum.couponAmount ?? 0);
      existing.receivableTotal += Number(row._sum.finalPayableAmount ?? 0);
      existing.nameVotes.set(
        row.fulfillmentLocationName,
        (existing.nameVotes.get(row.fulfillmentLocationName) ?? 0) + row._count._all
      );
      merged.set(id, existing);
    }
    return [...merged.values()]
      .map(({ nameVotes, ...row }) => ({
        ...row,
        locationName: [...nameVotes.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
        rentalRevenue: this.round2(row.rentalRevenue),
        discountTotal: this.round2(row.discountTotal),
        receivableTotal: this.round2(row.receivableTotal)
      }))
      .sort((a, b) => b.receivableTotal - a.receivableTotal || a.locationId.localeCompare(b.locationId));
  }
  /**
   * 客户维度汇总。同样由数据库聚合。
   *
   * 只带客户名与类型：手机号、证件号一概不进报表——报表是给经营看趋势的，
   * 不是客户资料的第二个出口。存量订单没有 `customerId` 时按客户名归并。
   */
  private async loadCustomerBreakdown(
    where: Prisma.RentalOrderWhereInput,
    exceptionByCustomer: Map<string, number>
  ): Promise<RentalWorkspaceCustomerBreakdownRow[]> {
    const groups = await this.prisma.rentalOrder.groupBy({
      by: ["customerId", "customerName", "customerType"],
      where,
      _count: { _all: true },
      _sum: { rentalAmount: true, discountAmount: true, couponAmount: true, finalPayableAmount: true }
    });
    const merged = new Map<string, RentalWorkspaceCustomerBreakdownRow>();
    for (const row of groups) {
      const key = this.customerKey(row.customerId, row.customerName);
      const existing = merged.get(key) ?? {
        customerId: row.customerId ?? undefined,
        customerName: row.customerName,
        customerType: row.customerType,
        orderCount: 0,
        rentalRevenue: 0,
        discountTotal: 0,
        receivableTotal: 0,
        exceptionFeeTotal: this.round2(exceptionByCustomer.get(key) ?? 0)
      };
      existing.orderCount += row._count._all;
      existing.rentalRevenue += Number(row._sum.rentalAmount ?? 0);
      existing.discountTotal += Number(row._sum.discountAmount ?? 0) + Number(row._sum.couponAmount ?? 0);
      existing.receivableTotal += Number(row._sum.finalPayableAmount ?? 0);
      merged.set(key, existing);
    }
    return [...merged.values()]
      .map((row) => ({
        ...row,
        rentalRevenue: this.round2(row.rentalRevenue),
        discountTotal: this.round2(row.discountTotal),
        receivableTotal: this.round2(row.receivableTotal)
      }))
      .sort((a, b) => b.receivableTotal - a.receivableTotal || a.customerName.localeCompare(b.customerName));
  }
  async getOperationReport(
    tenantId: string,
    workspaceId: string,
    categoryCode: RentalCategoryCode,
    filter: RentalWorkspaceReportFilter = {},
    /**
     * 本空间的结算币种（需求 §948）。由调用方从经营空间的业务设置传入——
     * 报表仓储不读配置，否则同一个事实会有两个来源。缺省 CNY 与存量数据一致。
     */
    currency: RentalCurrency = "CNY"
  ): Promise<RentalWorkspaceOperationReport> {
    // “仅本人”可按订单/工单归属筛订单，但库存与资产利用率是空间级快照，
    // 没有可证明的本人归属。混合返回订单小计与全空间库存会泄露总量，故整份报表拒绝。
    if (getRequestDataScope() === "own") {
      throw new ForbiddenException("仅本人数据范围无法查看包含空间级库存与资产快照的经营报表");
    }
    const where = this.buildOrderWhere(tenantId, workspaceId, filter);

    // 计数与求和交给数据库；逐行事实（费用行 JSON、租期时长）走一趟分页扫描。
    const [grouped, sums, scanned] = await Promise.all([
      this.prisma.rentalOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.rentalOrder.aggregate({
        where,
        _sum: { rentalAmount: true, discountAmount: true, couponAmount: true, finalPayableAmount: true, taxAmount: true }
      }),
      this.scanOrderDetails(where)
    ]);

    const exceptionFeeBreakdown = RENTAL_EXCEPTION_CHARGE_TYPES.map((type) => {
      const bucket = scanned.perType.get(type)!;
      return { type, amount: this.round2(bucket.amount), orderCount: bucket.orders.size };
    });
    // 异常订单按**去重后的订单**计：一张单同时逾期又损坏仍然只是一张异常单。
    const exceptionOrders = new Set<string>();
    for (const bucket of scanned.perType.values()) for (const id of bucket.orders) exceptionOrders.add(id);

    const orderCount = grouped.reduce((total, row) => total + row._count._all, 0);
    const [utilization, locationBreakdown, customerBreakdown] = await Promise.all([
      this.loadUtilization(tenantId, workspaceId, filter, {
        orderCount,
        hours: scanned.occupancyHours
      }),
      this.loadLocationBreakdown(where, scanned.exceptionByLocation),
      this.loadCustomerBreakdown(where, scanned.exceptionByCustomer)
    ]);

    return {
      tenantId,
      workspaceId,
      categoryCode,
      range: { from: filter.from, to: filter.to },
      filter: {
        from: filter.from,
        to: filter.to,
        locationId: filter.locationId,
        customerId: filter.customerId,
        customerType: filter.customerType
      },
      orderCount,
      currency,
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
        this.round2(Number(sums._sum.discountAmount ?? 0) + Number(sums._sum.couponAmount ?? 0)),
      receivableTotal: this.money(sums._sum.finalPayableAmount),
      // 价内税：税额已经含在 receivableTotal 里，netOfTax 是拆出来的不含税口径，
      // 两者不能再相加。规则未配税的空间两个数分别是 0 与 receivableTotal。
      taxTotal: this.money(sums._sum.taxAmount),
      netOfTaxTotal: this.round2(
        Number(sums._sum.finalPayableAmount ?? 0) - Number(sums._sum.taxAmount ?? 0)
      ),
      exceptionFeeTotal: this.round2(exceptionFeeBreakdown.reduce((total, row) => total + row.amount, 0)),
      exceptionOrderCount: exceptionOrders.size,
      exceptionFeeBreakdown,
      utilization,
      locationBreakdown,
      customerBreakdown,
      historicalCaliberGaps: [...HISTORICAL_CALIBER_GAPS],
      generatedAt: new Date().toISOString()
    };
  }
}
