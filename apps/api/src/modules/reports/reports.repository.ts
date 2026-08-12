import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BillingMode,
  DispatchStatus,
  OrderMainStatus,
  PaymentStatus
} from "@store-rental/shared";
import type {
  StoreRentalFinanceReport,
  StoreRentalFinanceReportRow,
  StoreRentalMetricCard,
  StoreRentalNamedMetric,
  StoreRentalOpsHealth,
  StoreRentalOpsLogRow,
  StoreRentalOrderReportRow,
  StoreRentalOrdersReport,
  StoreRentalReportDashboard,
  StoreRentalReportExportJob,
  StoreRentalReportExportRequest,
  StoreRentalReportPeriod,
  StoreRentalReportQuery,
  StoreRentalReportType,
  StoreRentalRiskReport,
  StoreRentalRiskReportRow,
  StoreRentalTimeSeriesPoint,
  StoreRentalVehicleReportRow,
  StoreRentalVehiclesReport,
  VehicleInstanceSummary
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestTenantId } from "../../common/request-identity";

type NormalizedReportQuery = Required<
  Pick<StoreRentalReportQuery, "tenantId" | "from" | "to" | "period">
> &
  Omit<StoreRentalReportQuery, "tenantId" | "from" | "to" | "period"> & {
    fromDate: Date;
    toDate: Date;
  };

type StoreRentalOrderRow = Prisma.StoreRentalOrderGetPayload<{
  include: {
    assignedVehicle: { include: { vehicleGroup: true; currentStation: true } };
    corporate: true;
    fees: true;
    transactions: true;
    vehicleGroup: true;
    pickupStation: true;
    returnStation: true;
  };
}>;

type VehicleRow = Prisma.VehicleGetPayload<{
  include: {
    vehicleGroup: true;
    currentStation: true;
    orders: true;
    maintenanceRecords: true;
    accidentRecords: true;
  };
}>;

type CsvCell = string | number | boolean | null | undefined;

interface CsvExportData {
  headers: string[];
  rows: CsvCell[][];
}

interface RiskContext {
  accidentsByVehicleId: Map<string, Array<{ vehicleId: string; [key: string]: unknown }>>;
  adjustmentsByOrderId: Map<string, Array<{ orderId: string | null; [key: string]: unknown }>>;
  blacklistedMemberIds: Set<string>;
  reassignsByOrderId: Map<string, Array<{ orderId: string | null; [key: string]: unknown }>>;
}

@Injectable()
export class ReportsRepository {
  private get defaultTenantId() {
    return getRequestTenantId();
  }
  private readonly exportDirectory = resolve(process.cwd(), "storage", "report-exports");

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: StoreRentalReportQuery = {}): Promise<StoreRentalReportDashboard> {
    const normalized = this.normalizeQuery(query);
    const [orders, vehicles] = await Promise.all([
      this.fetchOrders(normalized),
      this.fetchVehicles(normalized.tenantId)
    ]);
    const filteredOrders = this.filterOrders(orders, normalized);
    const filteredVehicles = this.filterVehicles(vehicles, normalized);
    const financeSummary = this.calculateFinanceSummary(filteredOrders);
    const totalOrders = filteredOrders.length;
    const totalVehicles = filteredVehicles.length;
    const activeVehicleCount = filteredVehicles.filter((vehicle) =>
      ["RESERVED", "RENTING"].includes(String(vehicle.operationStatus))
    ).length;
    const riskOrders = filteredOrders.filter((order) =>
      this.isRiskOrder(order)
    ).length;
    const monthlyOrders = filteredOrders.filter(
      (order) => this.toSharedBillingMode(String(order.billingMode)) === BillingMode.Monthly
    ).length;

    return {
      generatedAt: new Date().toISOString(),
      range: {
        from: normalized.from,
        to: normalized.to,
        period: normalized.period
      },
      metricCards: [
        this.metric("revenue", "本期总营收", financeSummary.settledAmount, "HKD", "success"),
        this.metric("orders", "本期订单量", totalOrders, "单", "normal"),
        this.metric(
          "utilization",
          "车队出租率",
          totalVehicles ? Math.round((activeVehicleCount / totalVehicles) * 1000) / 10 : 0,
          "%",
          "info"
        ),
        this.metric("vehicles", "车辆总数", totalVehicles, "台", "normal"),
        this.metric("monthly", "企业月结订单", monthlyOrders, "单", "warning"),
        this.metric("risk", "异常风险订单", riskOrders, "单", riskOrders > 0 ? "danger" : "success")
      ],
      orderFunnel: this.orderFunnel(filteredOrders),
      vehicleStatusDistribution: this.vehicleStatusDistribution(filteredVehicles),
      weeklyRevenue: this.weeklyRevenue(filteredOrders, normalized),
      topStores: this.topStores(filteredOrders),
      topVehicleGroups: this.topVehicleGroups(filteredOrders),
      riskTrend: this.riskTrend(filteredOrders),
      financeSummary
    };
  }

  async getOrdersReport(query: StoreRentalReportQuery = {}): Promise<StoreRentalOrdersReport> {
    const normalized = this.normalizeQuery(query);
    const filteredOrders = this.filterOrders(await this.fetchOrders(normalized), normalized);
    const rows = filteredOrders.map((order) => this.toOrderReportRow(order));

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalOrders: rows.length,
        pendingOrders: rows.filter((row) =>
          [
            OrderMainStatus.PendingPayment,
            OrderMainStatus.Reserved,
            OrderMainStatus.PickupOverdue
          ].includes(row.mainStatus)
        ).length,
        inProgressOrders: rows.filter((row) =>
          [
            OrderMainStatus.Inspecting,
            OrderMainStatus.Renting,
            OrderMainStatus.Renewing
          ].includes(row.mainStatus)
        ).length,
        settlementOrders: rows.filter((row) =>
          [
            OrderMainStatus.SettlementPending,
            OrderMainStatus.PaymentDue,
            OrderMainStatus.RefundPending
          ].includes(row.mainStatus)
        ).length,
        riskOrders: rows.filter((row) => row.riskFlags.length > 0).length,
        monthlyOrders: rows.filter((row) => row.billingMode === BillingMode.Monthly).length,
        completedOrders: rows.filter((row) => row.mainStatus === OrderMainStatus.Completed).length,
        cancelledOrders: rows.filter((row) => row.mainStatus === OrderMainStatus.Cancelled).length,
        totalSettledAmount: rows.reduce((sum, row) => sum + row.settledAmount, 0),
        totalPendingAmount: rows.reduce((sum, row) => sum + row.pendingAmount, 0),
        totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0)
      },
      byStore: this.groupOrdersByStore(filteredOrders),
      byVehicleGroup: this.groupOrdersByVehicleGroup(filteredOrders),
      byRoute: this.groupOrdersByPickupReturnRoute(filteredOrders),
      byStatus: this.groupOrdersByStatus(filteredOrders),
      byBillingMode: this.groupOrdersByBillingMode(filteredOrders),
      byStoreVehicleGroup: this.groupOrdersByStoreAndVehicleGroup(filteredOrders),
      rows
    };
  }

  async getVehiclesReport(query: StoreRentalReportQuery = {}): Promise<StoreRentalVehiclesReport> {
    const normalized = this.normalizeQuery(query);
    const [vehicles, orders] = await Promise.all([
      this.fetchVehicles(normalized.tenantId),
      this.fetchOrders(normalized)
    ]);
    const filteredVehicles = this.filterVehicles(vehicles, normalized);
    const filteredOrders = this.filterOrders(orders, normalized);
    const rows = filteredVehicles.map((vehicle) =>
      this.toVehicleReportRow(vehicle, filteredOrders)
    );
    const rentableVehicles = rows.filter((row) =>
      ["idle", "reserved", "renting", "controlled"].includes(row.operationStatus)
    ).length;
    const rentingVehicles = rows.filter((row) => row.operationStatus === "renting").length;
    const maintenanceVehicles = rows.filter((row) => row.operationStatus === "maintenance").length;
    const disabledVehicles = rows.filter((row) => row.operationStatus === "disabled").length;

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalVehicles: rows.length,
        rentableVehicles,
        rentingVehicles,
        maintenanceVehicles,
        disabledVehicles,
        utilizationPercent: rows.length
          ? Math.round(((rentingVehicles + rows.filter((row) => row.operationStatus === "reserved").length) / rows.length) * 1000) / 10
          : 0
      },
      rows
    };
  }

  async getFinanceReport(query: StoreRentalReportQuery = {}): Promise<StoreRentalFinanceReport> {
    const normalized = this.normalizeQuery(query);
    const orders = this.filterOrders(await this.fetchOrders(normalized), normalized);
    const rows = orders.map((order) => this.toFinanceReportRow(order));
    const monthlyBills = await this.fetchMonthlyBills(normalized);
    const orderSummary = this.calculateFinanceSummary(orders);
    const billAggregation = this.calculateMonthlyBillAggregation(monthlyBills);

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        ...orderSummary,
        ...billAggregation
      },
      rows,
      monthlyBills: monthlyBills.map((bill) => ({
        id: bill.id,
        billNo: bill.billNo,
        corporateId: bill.corporateId,
        corporateShortName: bill.corporate.shortName,
        period: bill.period,
        status: this.toMonthlyBillStatus(String(bill.status)),
        generatedAt: bill.createdAt.toISOString(),
        dueDate: bill.dueDate.toISOString(),
        orderCount: bill.orderCount,
        totalAmount: money(bill.totalAmount),
        paidAmount: money(bill.paidAmount),
        balanceAmount: money(bill.balanceAmount),
        lineItems: bill.lineItems.map((line) => ({
          id: line.id,
          orderId: line.orderId ?? "",
          orderNo: line.orderNo,
          occurredAt: line.createdAt.toISOString(),
          customerName: line.customerName,
          vehicleGroupName: line.vehicleGroupName,
          pickupStoreName: line.pickupStoreName,
          returnStoreName: line.returnStoreName,
          amount: money(line.amount),
          feeCodes: [],
          remark: line.remark ?? undefined
        }))
      })),
      reconciliation: this.buildReconciliation(orders, monthlyBills)
    };
  }

  async getRiskReport(query: StoreRentalReportQuery = {}): Promise<StoreRentalRiskReport> {
    const normalized = this.normalizeQuery(query);
    const [orders, accidentRecords, adjustments, blacklistedMembers, reassignEvents] =
      await Promise.all([
        this.fetchOrders(normalized),
        this.fetchAccidentRecords(normalized.tenantId),
        this.fetchFinanceAdjustments(normalized),
        this.fetchBlacklistedMembers(normalized.tenantId),
        this.fetchDispatchReassignEvents(normalized)
      ]);

    const filteredOrders = this.filterOrders(orders, normalized);
    const riskOrders = filteredOrders.filter((order) => this.isRiskOrder(order));

    // Build lookup maps for cross-reference enrichment
    const accidentsByVehicleId = new Map<string, typeof accidentRecords>();
    for (const record of accidentRecords) {
      const list = accidentsByVehicleId.get(record.vehicleId) ?? [];
      list.push(record);
      accidentsByVehicleId.set(record.vehicleId, list);
    }
    const adjustmentsByOrderId = new Map<string, typeof adjustments>();
    for (const adj of adjustments) {
      if (adj.orderId) {
        const list = adjustmentsByOrderId.get(adj.orderId) ?? [];
        list.push(adj);
        adjustmentsByOrderId.set(adj.orderId, list);
      }
    }
    const blacklistedMemberIds = new Set(blacklistedMembers.map((m) => m.id));
    const reassignsByOrderId = new Map<string, typeof reassignEvents>();
    for (const evt of reassignEvents) {
      if (evt.orderId) {
        const list = reassignsByOrderId.get(evt.orderId) ?? [];
        list.push(evt);
        reassignsByOrderId.set(evt.orderId, list);
      }
    }

    const riskCategoryFilter = query.riskCategory?.trim();

    const contextMap = {
      accidentsByVehicleId,
      adjustmentsByOrderId,
      blacklistedMemberIds,
      reassignsByOrderId
    };

    const categorizedRiskOrders = riskOrders.map((order) => ({
      order,
      riskCategories: this.classifyRiskCategories(order, contextMap),
      riskFlags: this.riskFlags(order, contextMap)
    }));

    const filteredByCategory = riskCategoryFilter
      ? categorizedRiskOrders.filter((entry) => entry.riskCategories.includes(riskCategoryFilter))
      : categorizedRiskOrders;

    const rows: StoreRentalRiskReportRow[] = filteredByCategory.map((entry) => {
      const order = entry.order;
      const finance = this.orderFinance(order);
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        corporateShortName: order.corporateShortName ?? order.corporate?.shortName ?? undefined,
        vehicleGroupName: this.vehicleGroupName(order.vehicleGroupSnapshot, order.vehicleGroup.name),
        plateNo: order.assignedVehicle?.plateNo ?? undefined,
        pickupStoreName: this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName),
        returnStoreName: this.storeName(order.returnStoreSnapshot, order.returnStation?.parentStoreName),
        pickupAt: order.pickupAt.toISOString(),
        returnAt: order.returnAt.toISOString(),
        mainStatus: this.toSharedMainStatus(String(order.mainStatus)),
        dispatchStatus: this.toSharedDispatchStatus(String(order.dispatchStatus)),
        billingMode: this.toSharedBillingMode(String(order.billingMode)),
        totalAmount: money(order.totalAmount),
        riskCategories: entry.riskCategories,
        riskFlags: entry.riskFlags
      };
    });

    const byCategoryEntries = categorizedRiskOrders.reduce<Record<string, number>>((map, entry) => {
      for (const category of entry.riskCategories) {
        map[category] = (map[category] ?? 0) + 1;
      }
      return map;
    }, {});
    const byCategory: StoreRentalNamedMetric[] = Object.entries(byCategoryEntries)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    const byStoreEntries = filteredByCategory.reduce<Record<string, number>>((map, entry) => {
      const storeName = this.storeName(entry.order.pickupStoreSnapshot, entry.order.pickupStation?.parentStoreName);
      map[storeName] = (map[storeName] ?? 0) + 1;
      return map;
    }, {});
    const byStore: StoreRentalNamedMetric[] = Object.entries(byStoreEntries)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    const byFlagEntries = categorizedRiskOrders.reduce<Record<string, number>>((map, entry) => {
      for (const flag of entry.riskFlags) {
        map[flag] = (map[flag] ?? 0) + 1;
      }
      return map;
    }, {});
    const byFlag: StoreRentalNamedMetric[] = Object.entries(byFlagEntries)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    // Aggregated byVehicle for cross-reference metrics
    const byVehicle = Object.entries(accidentsByVehicleId)
      .filter(([vehicleId]) =>
        filteredOrders.some((o) => o.assignedVehicleId === vehicleId)
      )
      .map(([vehicleId, records]) => {
        const vehicle = records[0].vehicle;
        return { name: vehicle.plateNo, value: records.length };
      })
      .sort((a, b) => b.value - a.value);

    return {
      generatedAt: new Date().toISOString(),
      range: {
        from: normalized.from,
        to: normalized.to,
        period: normalized.period
      },
      summary: {
        totalRiskOrders: rows.length,
        pickupOverdueCount: rows.filter((row) => row.riskCategories.includes("pickup_overdue")).length,
        overdueReturnCount: rows.filter((row) => row.riskCategories.includes("overdue_return")).length,
        accidentCount: rows.filter((row) => row.riskCategories.includes("accident")).length,
        manualDispatchCount: rows.filter((row) => row.riskCategories.includes("manual_dispatch")).length,
        blacklistCount: rows.filter((row) => row.riskCategories.includes("blacklist_member")).length,
        adjustmentCount: rows.filter((row) => row.riskCategories.includes("finance_adjustment")).length,
        reassignCount: rows.filter((row) => row.riskCategories.includes("dispatch_reassign")).length,
        noShowCount: rows.filter((row) => row.riskCategories.includes("no_show")).length,
        totalExposureAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0)
      },
      byCategory,
      byStore,
      byFlag,
      rows
    };
  }

  private classifyRiskCategories(order: StoreRentalOrderRow, ctx?: RiskContext): string[] {
    const categories: string[] = [];
    if (String(order.mainStatus) === "PICKUP_OVERDUE") {
      categories.push("pickup_overdue");
    }
    if (String(order.mainStatus) === "OVERDUE") {
      categories.push("overdue_return");
    }
    if (String(order.mainStatus) === "ACCIDENT_PROCESSING") {
      categories.push("accident");
    }
    if (String(order.dispatchStatus) === "MANUAL_REQUIRED") {
      categories.push("manual_dispatch");
    }
    if (String(order.mainStatus) === "NO_SHOW") {
      categories.push("no_show");
    }

    // Enrichment from cross-referenced data sources
    if (ctx) {
      // 黑名单：订单关联的客户处于黑名单状态
      if (order.memberId && ctx.blacklistedMemberIds.has(order.memberId)) {
        categories.push("blacklist_member");
      }
      // 调账：订单存在手工调账记录
      if (ctx.adjustmentsByOrderId.has(order.id)) {
        categories.push("finance_adjustment");
      }
      // 改派：订单存在人工改派事件
      if (ctx.reassignsByOrderId.has(order.id)) {
        categories.push("dispatch_reassign");
      }
      // 事故出险记录：车辆有事故记录
      if (order.assignedVehicleId && ctx.accidentsByVehicleId.has(order.assignedVehicleId)) {
        if (!categories.includes("accident")) {
          categories.push("accident");
        }
      }
    }

    const flags = arrayValue(order.riskFlags).filter(
      (item): item is string => typeof item === "string"
    );
    if (flags.length > 0 && categories.length === 0) {
      categories.push("general_risk");
    }
    return categories;
  }

  private buildReconciliation(orders: any[], monthlyBills: any[]) {
    let collectionsTotal = 0;
    let collectionsCount = 0;
    let refundsTotal = 0;
    let refundsCount = 0;
    let waiversTotal = 0;
    let waiversCount = 0;

    const byStore: Record<string, { collections: number; refunds: number; waivers: number; count: number }> = {};
    const byBillingMode: Record<string, { collections: number; refunds: number; waivers: number; count: number }> = {};

    for (const order of orders) {
      const finance = this.orderFinance(order);
      const storeName = this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName);
      const billingMode = this.toSharedBillingMode(String(order.billingMode));

      if (!byStore[storeName]) byStore[storeName] = { collections: 0, refunds: 0, waivers: 0, count: 0 };
      if (!byBillingMode[billingMode]) byBillingMode[billingMode] = { collections: 0, refunds: 0, waivers: 0, count: 0 };

      if (finance.settledAmount > 0) {
        collectionsTotal += finance.settledAmount;
        collectionsCount++;
        byStore[storeName].collections += finance.settledAmount;
        byBillingMode[billingMode].collections += finance.settledAmount;
      }
      if (finance.refundAmount > 0) {
        refundsTotal += finance.refundAmount;
        refundsCount++;
        byStore[storeName].refunds += finance.refundAmount;
        byBillingMode[billingMode].refunds += finance.refundAmount;
      }
      if (finance.waiverAmount > 0) {
        waiversTotal += finance.waiverAmount;
        waiversCount++;
        byStore[storeName].waivers += finance.waiverAmount;
        byBillingMode[billingMode].waivers += finance.waiverAmount;
      }
      byStore[storeName].count++;
      byBillingMode[billingMode].count++;
    }

    let monthlyTotal = 0;
    let monthlyCount = 0;
    let monthlyUnpaid = 0;
    for (const bill of monthlyBills) {
      monthlyTotal += money(bill.totalAmount);
      monthlyCount++;
      monthlyUnpaid += money(bill.balanceAmount);
    }

    const netAmount = collectionsTotal - refundsTotal - waiversTotal;

    return {
      collections: { totalAmount: collectionsTotal, count: collectionsCount },
      refunds: { totalAmount: refundsTotal, count: refundsCount },
      waivers: { totalAmount: waiversTotal, count: waiversCount },
      monthlyBills: { totalAmount: monthlyTotal, count: monthlyCount, unpaidAmount: monthlyUnpaid },
      netAmount,
      byStore,
      byBillingMode
    };
  }

  async createExportJob(
    request: StoreRentalReportExportRequest
  ): Promise<StoreRentalReportExportJob> {
    const normalized = this.normalizeQuery(request.filters);
    const fileName = `store-rental-${request.reportType}-${normalized.from}-${normalized.to}-${Date.now()}.csv`;
    const created = await this.prisma.reportExportJob.create({
      data: {
        tenantId: normalized.tenantId,
        reportType: request.reportType,
        fileName,
        status: "processing",
        filters: request.filters as Prisma.InputJsonValue,
        rowCount: 0,
        operator: request.operator || "营运端"
      }
    });

    try {
      const exportData = await this.buildExportData(request.reportType, normalized);
      await this.writeExportFile(fileName, toCsv(exportData));
      const completedAt = new Date();
      const row = await this.prisma.reportExportJob.update({
        where: { id: created.id },
        data: {
          status: "completed",
          rowCount: exportData.rows.length,
          downloadUrl: `/api/reports/exports/${fileName}`,
          completedAt
        }
      });

      await this.recordOpsLog(
        normalized.tenantId,
        "info",
        "report-export",
        `导出${request.reportType}报表`,
        {
          reportType: request.reportType,
          rowCount: exportData.rows.length,
          filters: request.filters,
          fileName,
          exportPath: "storage/report-exports"
        }
      );

      return this.toExportJob(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      await this.prisma.reportExportJob
        .update({
          where: { id: created.id },
          data: {
            status: "failed",
            completedAt: new Date()
          }
        })
        .catch(() => undefined);
      await this.recordOpsLog(
        normalized.tenantId,
        "error",
        "report-export",
        `导出${request.reportType}报表失败`,
        {
          reportType: request.reportType,
          filters: request.filters,
          fileName,
          error: message
        }
      ).catch(() => undefined);
      throw new InternalServerErrorException("导出任务生成失败，请查看运维日志");
    }
  }

  async getExportFile(fileName: string, tenantId = this.defaultTenantId): Promise<{ fileName: string; content: Buffer }> {
    const safeFileName = this.safeExportFileName(fileName);
    const job = await this.prisma.reportExportJob.findFirst({
      where: {
        fileName: safeFileName,
        tenantId,
        status: "completed"
      }
    });
    if (!job || !job.downloadUrl) {
      throw new NotFoundException("导出任务不存在或尚未完成");
    }
    try {
      const content = await readFile(this.exportFilePath(safeFileName));
      return { fileName: safeFileName, content };
    } catch {
      throw new NotFoundException("导出文件不存在或已被清理");
    }
  }

  async listExportJobs(query: StoreRentalReportQuery = {}) {
    const normalized = this.normalizeQuery(query);
    const rows = await this.prisma.reportExportJob.findMany({
      where: { tenantId: normalized.tenantId },
      orderBy: { createdAt: "desc" },
      take: 60
    });

    return rows.map((row) => this.toExportJob(row));
  }

  async getOpsHealth(query: StoreRentalReportQuery = {}): Promise<StoreRentalOpsHealth> {
    const normalized = this.normalizeQuery(query);
    let connected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      connected = false;
    }

    const [tenantCount, orderCount, vehicleCount, reportExportJobCount, recentLogs] =
      connected
        ? await Promise.all([
            this.prisma.tenant.count({ where: { id: normalized.tenantId } }),
            this.prisma.storeRentalOrder.count({ where: { tenantId: normalized.tenantId } }),
            this.prisma.vehicle.count({ where: { tenantId: normalized.tenantId } }),
            this.prisma.reportExportJob.count({ where: { tenantId: normalized.tenantId } }),
            this.listOpsLogs(normalized)
          ])
        : [0, 0, 0, 0, [] as StoreRentalOpsLogRow[]];

    return {
      generatedAt: new Date().toISOString(),
      dataSource: "mysql",
      database: {
        connected,
        provider: "mysql",
        checkedAt: new Date().toISOString()
      },
      seed: {
        tenantCount,
        orderCount,
        vehicleCount,
        reportExportJobCount
      },
      scripts: [
        {
          name: "setup-local-mysql.ps1",
          path: "scripts/setup-local-mysql.ps1",
          purpose: "启动本地 MySQL/Redis 并提示迁移、seed 和环境变量设置。"
        },
        {
          name: "backup-mysql.ps1",
          path: "scripts/backup-mysql.ps1",
          purpose: "使用 docker exec mysqldump 生成本地数据库备份。"
        },
        {
          name: "restore-mysql.ps1",
          path: "scripts/restore-mysql.ps1",
          purpose: "把备份 SQL 恢复到本地 store_rental 数据库。"
        },
        {
          name: "seed-report-demo.ts",
          path: "apps/api/prisma/seed-report-demo.ts",
          purpose: "补齐报表验收用订单、费用、资金、月结和运维日志演示数据。"
        }
      ],
      recentLogs
    };
  }

  async listOpsLogs(query: StoreRentalReportQuery = {}): Promise<StoreRentalOpsLogRow[]> {
    const normalized = this.normalizeQuery(query);
    const rows = await this.prisma.opsEventLog.findMany({
      where: { tenantId: normalized.tenantId },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    return rows.map((row) => ({
      id: row.id,
      level: this.toOpsLevel(row.level),
      category: row.category,
      message: row.message,
      traceId: row.traceId ?? undefined,
      payload: objectValue(row.payload),
      createdAt: row.createdAt.toISOString()
    }));
  }

  async recordOpsLog(
    tenantId: string,
    level: StoreRentalOpsLogRow["level"],
    category: string,
    message: string,
    payload?: Record<string, unknown>,
    traceId?: string
  ) {
    await this.prisma.opsEventLog.create({
      data: {
        tenantId,
        level,
        category,
        message,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        traceId
      }
    });
  }

  normalizeQuery(query: StoreRentalReportQuery = {}): NormalizedReportQuery {
    const period = query.period ?? (query.from || query.to ? "custom" : "30d");
    const now = new Date();
    const defaultFrom = new Date(now);
    if (period === "today") {
      defaultFrom.setHours(0, 0, 0, 0);
    } else if (period === "7d") {
      defaultFrom.setDate(defaultFrom.getDate() - 6);
      defaultFrom.setHours(0, 0, 0, 0);
    } else {
      defaultFrom.setDate(defaultFrom.getDate() - 29);
      defaultFrom.setHours(0, 0, 0, 0);
    }

    const fromDate = query.from ? new Date(query.from) : defaultFrom;
    const toDate = query.to ? new Date(query.to) : now;
    toDate.setHours(23, 59, 59, 999);

    return {
      ...query,
      tenantId: query.tenantId || this.defaultTenantId,
      from: dateKey(fromDate),
      to: dateKey(toDate),
      period,
      fromDate,
      toDate
    };
  }

  private fetchOrders(query: NormalizedReportQuery) {
    return this.prisma.storeRentalOrder.findMany({
      where: {
        tenantId: query.tenantId,
        createdAt: {
          gte: query.fromDate,
          lte: query.toDate
        }
      },
      include: {
        assignedVehicle: { include: { vehicleGroup: true, currentStation: true } },
        corporate: true,
        fees: true,
        transactions: true,
        vehicleGroup: true,
        pickupStation: true,
        returnStation: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  private fetchAccidentRecords(tenantId: string) {
    return this.prisma.vehicleAccidentRecord.findMany({
      where: { vehicle: { tenantId } },
      include: { vehicle: true },
      orderBy: { createdAt: "desc" }
    });
  }

  private fetchFinanceAdjustments(query: NormalizedReportQuery) {
    return this.prisma.financeManualAdjustment.findMany({
      where: {
        tenantId: query.tenantId,
        createdAt: {
          gte: query.fromDate,
          lte: query.toDate
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  private fetchBlacklistedMembers(tenantId: string) {
    return this.prisma.member.findMany({
      where: {
        tenantId,
        status: "BLACKLISTED"
      },
      select: { id: true, name: true, phone: true }
    });
  }

  private fetchDispatchReassignEvents(query: NormalizedReportQuery) {
    return this.prisma.dispatchEvent.findMany({
      where: {
        tenantId: query.tenantId,
        createdAt: {
          gte: query.fromDate,
          lte: query.toDate
        },
        eventType: { in: ["reassign", "manual_reassign", "upgrade", "manual_required"] }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  private fetchVehicles(tenantId: string) {
    return this.prisma.vehicle.findMany({
      where: { tenantId },
      include: {
        vehicleGroup: true,
        currentStation: true,
        orders: true,
        maintenanceRecords: true,
        accidentRecords: true
      },
      orderBy: { plateNo: "asc" }
    });
  }

  private fetchMonthlyBills(query: NormalizedReportQuery) {
    return this.prisma.corporateMonthlyBill.findMany({
      where: {
        tenantId: query.tenantId,
        createdAt: {
          gte: query.fromDate,
          lte: query.toDate
        }
      },
      include: {
        corporate: true,
        lineItems: true
      },
      orderBy: { createdAt: "desc" },
      take: 80
    });
  }

  private calculateMonthlyBillAggregation(
    bills: Awaited<ReturnType<ReportsRepository["fetchMonthlyBills"]>>
  ) {
    return bills.reduce(
      (agg, bill) => {
        agg.monthlyBillTotalAmount += money(bill.totalAmount);
        agg.monthlyBillPaidAmount += money(bill.paidAmount);
        agg.monthlyBillBalanceAmount += money(bill.balanceAmount);
        return agg;
      },
      { monthlyBillTotalAmount: 0, monthlyBillPaidAmount: 0, monthlyBillBalanceAmount: 0 }
    );
  }

  private filterOrders(rows: StoreRentalOrderRow[], query: NormalizedReportQuery) {
    return rows.filter((row) => {
      const pickupStoreName = this.storeName(row.pickupStoreSnapshot, row.pickupStation?.parentStoreName);
      const returnStoreName = this.storeName(row.returnStoreSnapshot, row.returnStation?.parentStoreName);
      const vehicleGroupName = this.vehicleGroupName(row.vehicleGroupSnapshot, row.vehicleGroup.name);
      const billingMode = this.toSharedBillingMode(String(row.billingMode));
      const mainStatus = this.toSharedMainStatus(String(row.mainStatus));

      return (
        (!query.storeName ||
          pickupStoreName === query.storeName ||
          returnStoreName === query.storeName) &&
        (!query.vehicleGroupName || vehicleGroupName === query.vehicleGroupName) &&
        (!query.billingMode || query.billingMode === "all" || billingMode === query.billingMode) &&
        (!query.mainStatuss || query.mainStatuss.length === 0 || query.mainStatuss.includes(mainStatus)) &&
        (!query.orderId || row.id === query.orderId || row.orderNo === query.orderId) &&
        (!query.memberId || row.memberId === query.memberId)
      );
    });
  }

  private filterVehicles(rows: VehicleRow[], query: NormalizedReportQuery) {
    return rows.filter((row) => {
      const storeName = row.currentStation?.parentStoreName ?? "";
      return (
        (!query.storeName || storeName === query.storeName) &&
        (!query.vehicleGroupName || row.vehicleGroup.name === query.vehicleGroupName)
      );
    });
  }

  private toOrderReportRow(order: StoreRentalOrderRow): StoreRentalOrderReportRow {
    const finance = this.orderFinance(order);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      corporateShortName: order.corporateShortName ?? order.corporate?.shortName ?? undefined,
      vehicleGroupName: this.vehicleGroupName(order.vehicleGroupSnapshot, order.vehicleGroup.name),
      plateNo: order.assignedVehicle?.plateNo ?? undefined,
      pickupStoreName: this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName),
      returnStoreName: this.storeName(order.returnStoreSnapshot, order.returnStation?.parentStoreName),
      pickupAt: order.pickupAt.toISOString(),
      returnAt: order.returnAt.toISOString(),
      mainStatus: this.toSharedMainStatus(String(order.mainStatus)),
      dispatchStatus: this.toSharedDispatchStatus(String(order.dispatchStatus)),
      paymentStatus: this.toSharedPaymentStatus(String(order.paymentStatus)),
      billingMode: this.toSharedBillingMode(String(order.billingMode)),
      totalAmount: money(order.totalAmount),
      settledAmount: finance.settledAmount,
      pendingAmount: finance.pendingAmount,
      riskFlags: this.riskFlags(order)
    };
  }

  private toVehicleReportRow(
    vehicle: VehicleRow,
    orders: StoreRentalOrderRow[]
  ): StoreRentalVehicleReportRow {
    const relatedOrders = orders.filter((order) => order.assignedVehicleId === vehicle.id);
    const revenueAmount = relatedOrders.reduce(
      (sum, order) => sum + money(order.totalAmount),
      0
    );
    const maintenanceCostAmount = vehicle.maintenanceRecords.reduce(
      (sum, record) => sum + money(record.costAmount),
      0
    );
    return {
      vehicleId: vehicle.id,
      plateNo: vehicle.plateNo,
      vehicleGroupName: vehicle.vehicleGroup.name,
      assetCompanyName: vehicle.assetCompanyName ?? "未设置车行",
      currentStoreName: vehicle.currentStation?.parentStoreName ?? "未设置门市",
      currentStationName: vehicle.currentStation?.name ?? "未设置据点",
      operationStatus: this.toSharedVehicleStatus(String(vehicle.operationStatus)),
      mileage: vehicle.mileage,
      orderCount: relatedOrders.length,
      revenueAmount,
      utilizationPercent: relatedOrders.length > 0 ? Math.min(100, relatedOrders.length * 18) : 0,
      maintenanceCostAmount,
      accidentCount: vehicle.accidentRecords.length
    };
  }

  private toFinanceReportRow(order: StoreRentalOrderRow): StoreRentalFinanceReportRow {
    const finance = this.orderFinance(order);
    return {
      orderNo: order.orderNo,
      customerName: order.customerName,
      corporateShortName: order.corporateShortName ?? order.corporate?.shortName ?? undefined,
      billingMode: this.toSharedBillingMode(String(order.billingMode)),
      receivableAmount: finance.receivableAmount,
      settledAmount: finance.settledAmount,
      pendingAmount: finance.pendingAmount,
      refundAmount: finance.refundAmount,
      waiverAmount: finance.waiverAmount,
      monthlyBillingAmount: finance.monthlyBillingAmount,
      paymentStatus: this.toSharedPaymentStatus(String(order.paymentStatus)),
      occurredAt: order.pickupAt.toISOString()
    };
  }

  private calculateFinanceSummary(orders: StoreRentalOrderRow[]) {
    return orders.reduce(
      (summary, order) => {
        const finance = this.orderFinance(order);
        summary.receivableAmount += finance.receivableAmount;
        summary.settledAmount += finance.settledAmount;
        summary.pendingAmount += finance.pendingAmount;
        summary.refundAmount += finance.refundAmount;
        summary.waiverAmount += finance.waiverAmount;
        summary.monthlyBillingAmount += finance.monthlyBillingAmount;
        return summary;
      },
      {
        receivableAmount: 0,
        settledAmount: 0,
        pendingAmount: 0,
        refundAmount: 0,
        waiverAmount: 0,
        monthlyBillingAmount: 0,
        monthlyBillTotalAmount: 0,
        monthlyBillPaidAmount: 0,
        monthlyBillBalanceAmount: 0
      }
    );
  }

  private orderFinance(order: StoreRentalOrderRow) {
    const chargeAmount = order.fees
      .filter((fee) => String(fee.direction) === "CHARGE")
      .reduce((sum, fee) => sum + money(fee.amount), 0);
    const refundFeeAmount = order.fees
      .filter((fee) => String(fee.direction) === "REFUND")
      .reduce((sum, fee) => sum + Math.abs(money(fee.amount)), 0);
    const waiverFeeAmount = order.fees
      .filter((fee) => String(fee.direction) === "WAIVER" || String(fee.status) === "WAIVED")
      .reduce((sum, fee) => sum + Math.abs(money(fee.amount)), 0);
    const pendingAmount = order.fees
      .filter((fee) => ["PENDING", "MONTHLY_BILLING"].includes(String(fee.status)))
      .reduce((sum, fee) => sum + Math.max(0, money(fee.pendingAmount || fee.amount)), 0);
    const settledAmount = order.transactions
      .filter((transaction) => String(transaction.status) === "success" || String(transaction.status) === "SUCCESS")
      .filter((transaction) =>
        ["payment", "pre_auth_capture", "monthly_bill"].includes(String(transaction.type))
      )
      .reduce((sum, transaction) => sum + money(transaction.amount), 0);
    const refundAmount = order.transactions
      .filter((transaction) => String(transaction.type) === "refund")
      .reduce((sum, transaction) => sum + Math.abs(money(transaction.amount)), 0);
    const waiverAmount = order.transactions
      .filter((transaction) => String(transaction.type) === "waiver")
      .reduce((sum, transaction) => sum + Math.abs(money(transaction.amount)), 0);
    const monthlyBillingAmount = order.transactions
      .filter((transaction) => String(transaction.type) === "monthly_bill")
      .reduce((sum, transaction) => sum + money(transaction.amount), 0);

    return {
      receivableAmount: chargeAmount - refundFeeAmount - waiverFeeAmount,
      settledAmount,
      pendingAmount,
      refundAmount,
      waiverAmount: waiverAmount + waiverFeeAmount,
      monthlyBillingAmount
    };
  }

  private orderFunnel(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    return [
      { name: "总预订量", value: orders.length },
      {
        name: "已取车",
        value: orders.filter((order) =>
          [
            "RENTING",
            "RENEWING",
            "OVERDUE",
            "ACCIDENT_PROCESSING",
            "SETTLEMENT_PENDING",
            "PAYMENT_DUE",
            "REFUND_PENDING",
            "COMPLETED"
          ].includes(String(order.mainStatus))
        ).length
      },
      {
        name: "租赁中",
        value: orders.filter((order) =>
          ["RENTING", "RENEWING", "OVERDUE", "ACCIDENT_PROCESSING"].includes(
            String(order.mainStatus)
          )
        ).length
      },
      {
        name: "正常完结",
        value: orders.filter((order) => String(order.mainStatus) === "COMPLETED").length
      },
      {
        name: "逾期/违约",
        value: orders.filter((order) =>
          ["PICKUP_OVERDUE", "OVERDUE", "NO_SHOW", "ACCIDENT_PROCESSING"].includes(
            String(order.mainStatus)
          )
        ).length
      }
    ];
  }

  private vehicleStatusDistribution(vehicles: VehicleRow[]): StoreRentalNamedMetric[] {
    const labels: Record<string, string> = {
      IDLE: "可租用",
      RESERVED: "已预订",
      RENTING: "在租中",
      CONTROLLED: "封控中",
      MAINTENANCE: "维保中",
      DISABLED: "已停用"
    };
    return Object.entries(
      vehicles.reduce<Record<string, number>>((result, vehicle) => {
        const key = String(vehicle.operationStatus);
        result[key] = (result[key] ?? 0) + 1;
        return result;
      }, {})
    ).map(([name, value]) => ({
      name: labels[name] ?? name,
      value,
      percent: vehicles.length ? Math.round((value / vehicles.length) * 1000) / 10 : 0
    }));
  }

  private weeklyRevenue(
    orders: StoreRentalOrderRow[],
    query: NormalizedReportQuery
  ): StoreRentalTimeSeriesPoint[] {
    const buckets = this.dateBuckets(query.fromDate, query.toDate, 7);
    return buckets.map((bucket) => {
      const bucketOrders = orders.filter((order) => dateKey(order.pickupAt) === bucket);
      const finance = this.calculateFinanceSummary(bucketOrders);
      return {
        label: bucket,
        orderCount: bucketOrders.length,
        revenueAmount: bucketOrders.reduce((sum, order) => sum + money(order.totalAmount), 0),
        settlementAmount: finance.settledAmount
      };
    });
  }

  private topStores(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    return topByName(
      orders.map((order) =>
        this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName)
      ),
      8
    );
  }

  private topVehicleGroups(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    return topByName(
      orders.map((order) => this.vehicleGroupName(order.vehicleGroupSnapshot, order.vehicleGroup.name)),
      8
    );
  }

  private groupOrdersByStore(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    const groups = new Map<string, { count: number; amount: number; settled: number; pending: number; risk: number; refund: number; waiver: number; completed: number; cancelled: number; monthly: number; statusMap: Record<string, number> }>();
    for (const order of orders) {
      const storeName = this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName);
      const existing = groups.get(storeName) ?? { count: 0, amount: 0, settled: 0, pending: 0, risk: 0, refund: 0, waiver: 0, completed: 0, cancelled: 0, monthly: 0, statusMap: {} };
      const finance = this.orderFinance(order);
      const mainStatus = String(order.mainStatus);
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      existing.settled += finance.settledAmount;
      existing.pending += finance.pendingAmount;
      existing.refund += finance.refundAmount;
      existing.waiver += finance.waiverAmount;
      if (mainStatus === "COMPLETED") existing.completed += 1;
      if (mainStatus === "CANCELLED") existing.cancelled += 1;
      if (this.toSharedBillingMode(String(order.billingMode)) === BillingMode.Monthly) existing.monthly += 1;
      if (this.isRiskOrder(order)) existing.risk += 1;
      existing.statusMap[mainStatus] = (existing.statusMap[mainStatus] ?? 0) + 1;
      groups.set(storeName, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({
        name,
        value: data.count,
        amount: data.amount,
        settledAmount: data.settled,
        pendingAmount: data.pending,
        riskCount: data.risk,
        refundAmount: data.refund,
        waiverAmount: data.waiver,
        completedCount: data.completed,
        cancelledCount: data.cancelled,
        monthlyCount: data.monthly,
        completionRate: data.count > 0 ? Math.round((data.completed / data.count) * 1000) / 10 : 0,
        avgOrderValue: data.count > 0 ? Math.round(data.amount / data.count) : 0,
        settlementRate: data.amount > 0 ? Math.round((data.settled / data.amount) * 1000) / 10 : 0,
        riskRate: data.count > 0 ? Math.round((data.risk / data.count) * 1000) / 10 : 0,
        statusBreakdown: data.statusMap
      }));
  }

  private groupOrdersByVehicleGroup(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    const groups = new Map<string, { count: number; amount: number; settled: number; pending: number; risk: number; refund: number; waiver: number; completed: number; cancelled: number; monthly: number; statusMap: Record<string, number> }>();
    for (const order of orders) {
      const groupName = this.vehicleGroupName(order.vehicleGroupSnapshot, order.vehicleGroup.name);
      const existing = groups.get(groupName) ?? { count: 0, amount: 0, settled: 0, pending: 0, risk: 0, refund: 0, waiver: 0, completed: 0, cancelled: 0, monthly: 0, statusMap: {} };
      const finance = this.orderFinance(order);
      const mainStatus = String(order.mainStatus);
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      existing.settled += finance.settledAmount;
      existing.pending += finance.pendingAmount;
      existing.refund += finance.refundAmount;
      existing.waiver += finance.waiverAmount;
      if (mainStatus === "COMPLETED") existing.completed += 1;
      if (mainStatus === "CANCELLED") existing.cancelled += 1;
      if (this.toSharedBillingMode(String(order.billingMode)) === BillingMode.Monthly) existing.monthly += 1;
      if (this.isRiskOrder(order)) existing.risk += 1;
      existing.statusMap[mainStatus] = (existing.statusMap[mainStatus] ?? 0) + 1;
      groups.set(groupName, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({
        name,
        value: data.count,
        amount: data.amount,
        settledAmount: data.settled,
        pendingAmount: data.pending,
        riskCount: data.risk,
        refundAmount: data.refund,
        waiverAmount: data.waiver,
        completedCount: data.completed,
        cancelledCount: data.cancelled,
        monthlyCount: data.monthly,
        completionRate: data.count > 0 ? Math.round((data.completed / data.count) * 1000) / 10 : 0,
        avgOrderValue: data.count > 0 ? Math.round(data.amount / data.count) : 0,
        settlementRate: data.amount > 0 ? Math.round((data.settled / data.amount) * 1000) / 10 : 0,
        riskRate: data.count > 0 ? Math.round((data.risk / data.count) * 1000) / 10 : 0,
        statusBreakdown: data.statusMap
      }));
  }

  private groupOrdersByStoreAndVehicleGroup(orders: StoreRentalOrderRow[]): Array<{
    storeName: string;
    vehicleGroupName: string;
    count: number;
    amount: number;
    settledAmount: number;
    pendingAmount: number;
    riskCount: number;
    completionRate: number;
  }> {
    const groups = new Map<string, { storeName: string; vehicleGroupName: string; count: number; amount: number; settled: number; pending: number; risk: number; completed: number }>();
    for (const order of orders) {
      const storeName = this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName);
      const groupName = this.vehicleGroupName(order.vehicleGroupSnapshot, order.vehicleGroup.name);
      const key = `${storeName}||${groupName}`;
      const existing = groups.get(key) ?? { storeName, vehicleGroupName: groupName, count: 0, amount: 0, settled: 0, pending: 0, risk: 0, completed: 0 };
      const finance = this.orderFinance(order);
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      existing.settled += finance.settledAmount;
      existing.pending += finance.pendingAmount;
      if (String(order.mainStatus) === "COMPLETED") existing.completed += 1;
      if (this.isRiskOrder(order)) existing.risk += 1;
      groups.set(key, existing);
    }
    return Array.from(groups.values())
      .sort((a, b) => b.count - a.count)
      .map((data) => ({
        storeName: data.storeName,
        vehicleGroupName: data.vehicleGroupName,
        count: data.count,
        amount: data.amount,
        settledAmount: data.settled,
        pendingAmount: data.pending,
        riskCount: data.risk,
        completionRate: data.count > 0 ? Math.round((data.completed / data.count) * 1000) / 10 : 0
      }));
  }

  private groupOrdersByStatus(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    const statusLabels: Record<string, string> = {
      PENDING_PAYMENT: "待付款",
      RESERVED: "已预约",
      PICKUP_OVERDUE: "逾期未取",
      INSPECTING: "验车中",
      RENTING: "租赁中",
      RENEWING: "续租中",
      OVERDUE: "逾期未还",
      ACCIDENT_PROCESSING: "事故处理中",
      SETTLEMENT_PENDING: "待结算",
      PAYMENT_DUE: "待补缴",
      REFUND_PENDING: "待退款",
      COMPLETED: "已完成",
      CANCELLED: "已取消",
      NO_SHOW: "未到店",
      REJECTED: "已驳回",
      CLOSED: "已关闭"
    };
    const groups = new Map<string, { count: number; amount: number }>();
    for (const order of orders) {
      const raw = String(order.mainStatus);
      const label = statusLabels[raw] ?? raw;
      const existing = groups.get(label) ?? { count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      groups.set(label, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({ name, value: data.count, amount: data.amount }));
  }

  private groupOrdersByBillingMode(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    const billingLabels: Record<string, string> = {
      CUSTOMER_PAY: "散客自付",
      MONTHLY: "企业月结"
    };
    const groups = new Map<string, { count: number; amount: number; settled: number; pending: number }>();
    for (const order of orders) {
      const raw = String(order.billingMode);
      const label = billingLabels[raw] ?? raw;
      const existing = groups.get(label) ?? { count: 0, amount: 0, settled: 0, pending: 0 };
      const finance = this.orderFinance(order);
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      existing.settled += finance.settledAmount;
      existing.pending += finance.pendingAmount;
      groups.set(label, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({
        name,
        value: data.count,
        amount: data.amount,
        settledAmount: data.settled,
        pendingAmount: data.pending
      }));
  }

  private groupOrdersByPickupReturnRoute(orders: StoreRentalOrderRow[]): StoreRentalNamedMetric[] {
    const groups = new Map<string, { count: number; amount: number; settled: number; pending: number; risk: number }>();
    for (const order of orders) {
      const pickup = this.storeName(order.pickupStoreSnapshot, order.pickupStation?.parentStoreName);
      const returnStore = this.storeName(order.returnStoreSnapshot, order.returnStation?.parentStoreName);
      const route = pickup === returnStore ? `${pickup} (同城)` : `${pickup} -> ${returnStore}`;
      const existing = groups.get(route) ?? { count: 0, amount: 0, settled: 0, pending: 0, risk: 0 };
      const finance = this.orderFinance(order);
      existing.count += 1;
      existing.amount += money(order.totalAmount);
      existing.settled += finance.settledAmount;
      existing.pending += finance.pendingAmount;
      if (this.isRiskOrder(order)) existing.risk += 1;
      groups.set(route, existing);
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({
        name,
        value: data.count,
        amount: data.amount,
        settledAmount: data.settled,
        pendingAmount: data.pending,
        riskCount: data.risk
      }));
  }

  private riskTrend(orders: StoreRentalOrderRow[]) {
    return [
      {
        name: "逾期未取",
        value: orders.filter((order) => String(order.mainStatus) === "PICKUP_OVERDUE").length
      },
      {
        name: "逾期未还",
        value: orders.filter((order) => String(order.mainStatus) === "OVERDUE").length
      },
      {
        name: "事故出险",
        value: orders.filter((order) => String(order.mainStatus) === "ACCIDENT_PROCESSING").length
      },
      {
        name: "调度人工处理",
        value: orders.filter((order) => String(order.dispatchStatus) === "MANUAL_REQUIRED").length
      }
    ];
  }

  private dateBuckets(fromDate: Date, toDate: Date, maxDays: number) {
    const buckets: string[] = [];
    const cursor = new Date(fromDate);
    const limit = new Date(toDate);
    while (cursor <= limit && buckets.length < maxDays) {
      buckets.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return buckets;
  }

  private async buildExportData(
    reportType: StoreRentalReportType,
    query: NormalizedReportQuery
  ): Promise<CsvExportData> {
    if (reportType === "orders") {
      const report = await this.getOrdersReport(query);
      return {
        headers: [
          "订单号",
          "客户",
          "企业客户",
          "车型组",
          "车牌",
          "取车门市",
          "还车门市",
          "预计取车时间",
          "预计还车时间",
          "订单状态",
          "派车状态",
          "支付状态",
          "结算方式",
          "订单金额",
          "已处理金额",
          "待处理金额",
          "风险标记"
        ],
        rows: report.rows.map((row) => [
          row.orderNo,
          row.customerName,
          row.corporateShortName ?? "",
          row.vehicleGroupName,
          row.plateNo ?? "",
          row.pickupStoreName,
          row.returnStoreName,
          row.pickupAt,
          row.returnAt,
          row.mainStatus,
          row.dispatchStatus,
          row.paymentStatus,
          row.billingMode,
          row.totalAmount,
          row.settledAmount,
          row.pendingAmount,
          row.riskFlags.join("|")
        ])
      };
    }
    if (reportType === "vehicles") {
      const report = await this.getVehiclesReport(query);
      return {
        headers: [
          "车牌",
          "车型组",
          "资产车行",
          "当前门市",
          "当前据点",
          "运营状态",
          "里程",
          "订单数",
          "营收金额",
          "出租率",
          "维保成本",
          "事故数"
        ],
        rows: report.rows.map((row) => [
          row.plateNo,
          row.vehicleGroupName,
          row.assetCompanyName,
          row.currentStoreName,
          row.currentStationName,
          row.operationStatus,
          row.mileage,
          row.orderCount,
          row.revenueAmount,
          row.utilizationPercent,
          row.maintenanceCostAmount,
          row.accidentCount
        ])
      };
    }
    if (reportType === "finance") {
      const report = await this.getFinanceReport(query);
      return {
        headers: [
          "订单号",
          "客户",
          "企业客户",
          "结算方式",
          "应收金额",
          "已处理金额",
          "待处理金额",
          "退款金额",
          "减免金额",
          "月结金额",
          "支付状态",
          "发生时间"
        ],
        rows: report.rows.map((row) => [
          row.orderNo,
          row.customerName,
          row.corporateShortName ?? "",
          row.billingMode,
          row.receivableAmount,
          row.settledAmount,
          row.pendingAmount,
          row.refundAmount,
          row.waiverAmount,
          row.monthlyBillingAmount,
          row.paymentStatus,
          row.occurredAt
        ])
      };
    }
    if (reportType === "risk") {
      const report = await this.getRiskReport(query);
      return {
        headers: [
          "订单号",
          "客户",
          "企业客户",
          "车型组",
          "车牌",
          "取车门市",
          "还车门市",
          "预计取车时间",
          "预计还车时间",
          "订单状态",
          "派车状态",
          "结算方式",
          "订单金额",
          "风控类别",
          "风险标记"
        ],
        rows: report.rows.map((row) => [
          row.orderNo,
          row.customerName,
          row.corporateShortName ?? "",
          row.vehicleGroupName,
          row.plateNo ?? "",
          row.pickupStoreName,
          row.returnStoreName,
          row.pickupAt,
          row.returnAt,
          row.mainStatus,
          row.dispatchStatus,
          row.billingMode,
          row.totalAmount,
          row.riskCategories.join("|"),
          row.riskFlags.join("|")
        ])
      };
    }
    if (reportType === "ops") {
      const rows = await this.listOpsLogs(query);
      return {
        headers: ["时间", "级别", "分类", "内容", "Trace ID", "载荷"],
        rows: rows.map((row) => [
          row.createdAt,
          row.level,
          row.category,
          row.message,
          row.traceId ?? "",
          row.payload ? JSON.stringify(row.payload) : ""
        ])
      };
    }

    const dashboard = await this.getDashboard(query);
    return {
      headers: ["板块", "指标", "数值", "单位", "说明"],
      rows: [
        ...dashboard.metricCards.map((card) => [
          "经营指标",
          card.label,
          card.value,
          card.unit,
          card.trendText
        ]),
        ...dashboard.orderFunnel.map((item) => [
          "订单漏斗",
          item.name,
          item.value,
          "",
          ""
        ]),
        ...dashboard.vehicleStatusDistribution.map((item) => [
          "车辆状态",
          item.name,
          item.value,
          "%",
          item.percent ?? ""
        ]),
        ...dashboard.topStores.map((item) => ["门市排行", item.name, item.value, "单", ""]),
        ...dashboard.topVehicleGroups.map((item) => [
          "车组排行",
          item.name,
          item.value,
          "单",
          ""
        ]),
        ...dashboard.riskTrend.map((item) => ["风险趋势", item.name, item.value, "单", ""])
      ]
    };
  }

  private async writeExportFile(fileName: string, content: string) {
    await mkdir(this.exportDirectory, { recursive: true });
    await writeFile(this.exportFilePath(fileName), content, "utf8");
  }

  private exportFilePath(fileName: string) {
    return join(this.exportDirectory, this.safeExportFileName(fileName));
  }

  private safeExportFileName(fileName: string) {
    if (fileName !== basename(fileName) || !fileName.endsWith(".csv")) {
      throw new BadRequestException("导出文件名不合法");
    }
    return fileName;
  }

  private metric(
    key: string,
    label: string,
    value: number,
    unit: string,
    severity: StoreRentalMetricCard["severity"]
  ): StoreRentalMetricCard {
    return {
      key,
      label,
      value,
      unit,
      displayValue: unit === "HKD" ? formatMoney(value) : `${formatNumber(value)}${unit}`,
      trendText: "按当前筛选统计",
      severity
    };
  }

  private isRiskOrder(order: StoreRentalOrderRow) {
    return (
      this.riskFlags(order).length > 0 ||
      ["PICKUP_OVERDUE", "OVERDUE", "ACCIDENT_PROCESSING"].includes(
        String(order.mainStatus)
      )
    );
  }

  private riskFlags(order: StoreRentalOrderRow, ctx?: RiskContext) {
    const flags = arrayValue(order.riskFlags).filter(
      (item): item is string => typeof item === "string"
    );
    if (String(order.mainStatus) === "ACCIDENT_PROCESSING" && !flags.includes("事故出险")) {
      flags.push("事故出险");
    }
    if (String(order.dispatchStatus) === "MANUAL_REQUIRED" && !flags.includes("人工调度")) {
      flags.push("人工调度");
    }
    if (ctx) {
      if (order.memberId && ctx.blacklistedMemberIds.has(order.memberId) && !flags.includes("黑名单客户")) {
        flags.push("黑名单客户");
      }
      if (ctx.adjustmentsByOrderId.has(order.id) && !flags.includes("存在调账")) {
        flags.push("存在调账");
      }
      if (ctx.reassignsByOrderId.has(order.id) && !flags.includes("人工改派")) {
        flags.push("人工改派");
      }
      if (order.assignedVehicleId && ctx.accidentsByVehicleId.has(order.assignedVehicleId) && !flags.includes("车辆事故")) {
        flags.push("车辆事故");
      }
    }
    return flags;
  }

  private storeName(snapshot: Prisma.JsonValue, fallback?: string | null) {
    const snapshotObject = objectValue(snapshot);
    return (
      stringValue(snapshotObject.name) ||
      stringValue(snapshotObject.storeName) ||
      stringValue(snapshotObject.parentStoreName) ||
      fallback ||
      "未设置门市"
    );
  }

  private vehicleGroupName(snapshot: Prisma.JsonValue, fallback: string) {
    const snapshotObject = objectValue(snapshot);
    return stringValue(snapshotObject.name) || stringValue(snapshotObject.vehicleGroupName) || fallback;
  }

  private toExportJob(row: {
    id: string;
    reportType: string;
    fileName: string;
    status: string;
    filters: Prisma.JsonValue;
    rowCount: number;
    downloadUrl: string | null;
    operator: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): StoreRentalReportExportJob {
    return {
      id: row.id,
      reportType: this.toReportType(row.reportType),
      fileName: row.fileName,
      status: this.toExportStatus(row.status),
      rowCount: row.rowCount,
      filters: objectValue(row.filters) as StoreRentalReportQuery,
      downloadUrl: row.downloadUrl ?? undefined,
      operator: row.operator ?? undefined,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString()
    };
  }

  private toReportType(value: string): StoreRentalReportType {
    if (["overview", "orders", "vehicles", "finance", "ops", "risk", "audit"].includes(value)) {
      return value as StoreRentalReportType;
    }
    return "overview";
  }

  private toExportStatus(value: string): StoreRentalReportExportJob["status"] {
    if (["queued", "processing", "completed", "failed"].includes(value)) {
      return value as StoreRentalReportExportJob["status"];
    }
    return "completed";
  }

  private toOpsLevel(value: string): StoreRentalOpsLogRow["level"] {
    if (["info", "warning", "error"].includes(value)) {
      return value as StoreRentalOpsLogRow["level"];
    }
    return "info";
  }

  private toSharedMainStatus(value: string): OrderMainStatus {
    const map: Record<string, OrderMainStatus> = {
      PENDING_PAYMENT: OrderMainStatus.PendingPayment,
      RESERVED: OrderMainStatus.Reserved,
      PICKUP_OVERDUE: OrderMainStatus.PickupOverdue,
      INSPECTING: OrderMainStatus.Inspecting,
      RENTING: OrderMainStatus.Renting,
      RENEWING: OrderMainStatus.Renewing,
      OVERDUE: OrderMainStatus.Overdue,
      ACCIDENT_PROCESSING: OrderMainStatus.AccidentProcessing,
      SETTLEMENT_PENDING: OrderMainStatus.SettlementPending,
      PAYMENT_DUE: OrderMainStatus.PaymentDue,
      REFUND_PENDING: OrderMainStatus.RefundPending,
      COMPLETED: OrderMainStatus.Completed,
      CANCELLED: OrderMainStatus.Cancelled,
      NO_SHOW: OrderMainStatus.NoShow,
      REJECTED: OrderMainStatus.Rejected,
      CLOSED: OrderMainStatus.Closed
    };
    return map[value] ?? OrderMainStatus.Reserved;
  }

  private toSharedDispatchStatus(value: string): DispatchStatus {
    const map: Record<string, DispatchStatus> = {
      PENDING: DispatchStatus.Pending,
      PRE_ASSIGNED: DispatchStatus.PreAssigned,
      LOCKED: DispatchStatus.Locked,
      MANUAL_REASSIGNED: DispatchStatus.ManualReassigned,
      UPGRADED: DispatchStatus.Upgraded,
      MANUAL_REQUIRED: DispatchStatus.ManualRequired
    };
    return map[value] ?? DispatchStatus.Pending;
  }

  private toSharedPaymentStatus(value: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      UNPAID: PaymentStatus.Unpaid,
      DEPOSIT_PAID: PaymentStatus.DepositPaid,
      MONTHLY_BILLING: PaymentStatus.MonthlyBilling,
      PARTIAL_PAID: PaymentStatus.PartialPaid,
      PAID: PaymentStatus.Paid,
      PAYMENT_DUE: PaymentStatus.PaymentDue,
      REFUND_PENDING: PaymentStatus.RefundPending,
      REFUNDED: PaymentStatus.Refunded
    };
    return map[value] ?? PaymentStatus.Unpaid;
  }

  private toSharedBillingMode(value: string): BillingMode {
    return value === "MONTHLY" ? BillingMode.Monthly : BillingMode.CustomerPay;
  }

  private toSharedVehicleStatus(value: string): VehicleInstanceSummary["operationStatus"] {
    const map: Record<string, VehicleInstanceSummary["operationStatus"]> = {
      IDLE: "idle",
      RESERVED: "reserved",
      RENTING: "renting",
      CONTROLLED: "controlled",
      MAINTENANCE: "maintenance",
      DISABLED: "disabled"
    };
    return map[value] ?? "idle";
  }

  private toMonthlyBillStatus(value: string) {
    const map: Record<string, StoreRentalFinanceReport["monthlyBills"][number]["status"]> = {
      DRAFT: "draft",
      POSTED: "posted",
      PARTIALLY_PAID: "partially_paid",
      PAID: "paid",
      VOID: "void"
    };
    return map[value] ?? "draft";
  }
}

function money(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

function toCsv(data: CsvExportData) {
  const rows = [data.headers, ...data.rows];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: CsvCell) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value).replace(/\r?\n/g, " ");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return `HK$${formatNumber(Math.round(value))}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 1
  }).format(value);
}

function topByName(values: string[], take: number): StoreRentalNamedMetric[] {
  const counts = values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, take)
    .map(([name, value]) => ({
      name,
      value
    }));
}

function objectValue(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: Prisma.JsonValue | unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
