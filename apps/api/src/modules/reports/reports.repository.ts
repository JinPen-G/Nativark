import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BillingMode,
  DispatchStatus,
  OrderMainStatus,
  PaymentStatus
} from "@rimo/shared";
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
  StoreRentalTimeSeriesPoint,
  StoreRentalVehicleReportRow,
  StoreRentalVehiclesReport,
  VehicleInstanceSummary
} from "@rimo/shared";
import { PrismaService } from "../database/prisma.service";

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

@Injectable()
export class ReportsRepository {
  private readonly defaultTenantId = "tenant_001";

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
    const rows = this.filterOrders(await this.fetchOrders(normalized), normalized).map((order) =>
      this.toOrderReportRow(order)
    );

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
        monthlyOrders: rows.filter((row) => row.billingMode === BillingMode.Monthly).length
      },
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
    const monthlyBills = await this.prisma.corporateMonthlyBill.findMany({
      where: {
        tenantId: normalized.tenantId,
        createdAt: {
          gte: normalized.fromDate,
          lte: normalized.toDate
        }
      },
      include: {
        corporate: true,
        lineItems: true
      },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return {
      generatedAt: new Date().toISOString(),
      summary: this.calculateFinanceSummary(orders),
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
      }))
    };
  }

  async createExportJob(
    request: StoreRentalReportExportRequest
  ): Promise<StoreRentalReportExportJob> {
    const normalized = this.normalizeQuery(request.filters);
    const rowCount = await this.countExportRows(request.reportType, normalized);
    const fileName = `rimo-${request.reportType}-${normalized.from}-${normalized.to}.csv`;
    const completedAt = new Date();
    const row = await this.prisma.reportExportJob.create({
      data: {
        tenantId: normalized.tenantId,
        reportType: request.reportType,
        fileName,
        status: "completed",
        filters: request.filters as Prisma.InputJsonValue,
        rowCount,
        downloadUrl: `/api/reports/exports/${fileName}`,
        operator: request.operator || "营运端",
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
        rowCount,
        filters: request.filters,
        fileName
      }
    );

    return this.toExportJob(row);
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
            this.prisma.tenant.count(),
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
          purpose: "把备份 SQL 恢复到本地 rimo_store_rental 数据库。"
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
        pickupAt: {
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
      orderBy: { pickupAt: "desc" }
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

  private filterOrders(rows: StoreRentalOrderRow[], query: NormalizedReportQuery) {
    return rows.filter((row) => {
      const pickupStoreName = this.storeName(row.pickupStoreSnapshot, row.pickupStation?.parentStoreName);
      const returnStoreName = this.storeName(row.returnStoreSnapshot, row.returnStation?.parentStoreName);
      const vehicleGroupName = this.vehicleGroupName(row.vehicleGroupSnapshot, row.vehicleGroup.name);
      const billingMode = this.toSharedBillingMode(String(row.billingMode));

      return (
        (!query.storeName ||
          pickupStoreName === query.storeName ||
          returnStoreName === query.storeName) &&
        (!query.vehicleGroupName || vehicleGroupName === query.vehicleGroupName) &&
        (!query.billingMode || query.billingMode === "all" || billingMode === query.billingMode)
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
        monthlyBillingAmount: 0
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

  private async countExportRows(reportType: StoreRentalReportType, query: NormalizedReportQuery) {
    if (reportType === "orders") {
      return (await this.getOrdersReport(query)).rows.length;
    }
    if (reportType === "vehicles") {
      return (await this.getVehiclesReport(query)).rows.length;
    }
    if (reportType === "finance") {
      return (await this.getFinanceReport(query)).rows.length;
    }
    if (reportType === "ops") {
      return (await this.listOpsLogs(query)).length;
    }
    return (await this.getDashboard(query)).metricCards.length;
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

  private riskFlags(order: StoreRentalOrderRow) {
    const flags = arrayValue(order.riskFlags).filter(
      (item): item is string => typeof item === "string"
    );
    if (String(order.mainStatus) === "ACCIDENT_PROCESSING" && !flags.includes("事故出险")) {
      flags.push("事故出险");
    }
    if (String(order.dispatchStatus) === "MANUAL_REQUIRED" && !flags.includes("人工调度")) {
      flags.push("人工调度");
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
    if (["overview", "orders", "vehicles", "finance", "ops"].includes(value)) {
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
