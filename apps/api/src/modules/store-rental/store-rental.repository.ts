import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BillingMode as PrismaBillingMode,
  ConfigStatus as PrismaConfigStatus,
  CorporateStatus as PrismaCorporateStatus,
  DispatchStatus as PrismaDispatchStatus,
  FeeDirection as PrismaFeeDirection,
  FeeStage as PrismaFeeStage,
  FeeStatus as PrismaFeeStatus,
  FinanceDocumentStatus as PrismaFinanceDocumentStatus,
  FinanceDocumentType as PrismaFinanceDocumentType,
  FinanceManualAdjustmentDirection as PrismaFinanceManualAdjustmentDirection,
  FinanceManualAdjustmentStatus as PrismaFinanceManualAdjustmentStatus,
  FinancePreAuthorizationChannel as PrismaFinancePreAuthorizationChannel,
  FinancePreAuthorizationStatus as PrismaFinancePreAuthorizationStatus,
  MemberReviewStatus as PrismaMemberReviewStatus,
  MemberStatus as PrismaMemberStatus,
  MonthlyBillStatus as PrismaMonthlyBillStatus,
  OrderMainStatus as PrismaOrderMainStatus,
  PaymentStatus as PrismaPaymentStatus,
  Prisma,
  SettlementMode as PrismaSettlementMode,
  StoreRentalMode as PrismaStoreRentalMode,
  VehicleOperationStatus as PrismaVehicleOperationStatus,
  VehicleServiceType as PrismaVehicleServiceType
} from "@prisma/client";
import {
  BillingMode,
  ConfigStatus,
  DispatchStatus,
  OperationLockStatus,
  OrderMainStatus,
  PaymentStatus,
  StoreRentalMode
} from "@store-rental/shared";
import type {
  CorporateDetail,
  CorporateListQuery,
  CorporateListResult,
  CorporateMonthlyBillSummary,
  CorporateSummary,
  FinanceDocumentRow,
  FinanceManualAdjustmentRow,
  FinanceOverviewMetrics,
  FinancePreAuthorizationRow,
  FinanceReconciliationRow,
  FinanceTransactionRow,
  MemberDetail,
  MemberListQuery,
  MemberListResult,
  MemberReviewTask,
  MembershipPlanSummary,
  MemberSummary,
  StoreRentalFeeCenter,
  StoreRentalFeeLedgerItem,
  StoreRentalDispatchEvent,
  StoreRentalDispatchEventQuery,
  StoreRentalOrderNotificationRecord,
  StoreRentalOrderOperationRecord,
  StoreRentalFinancialOverview,
  StoreRentalContractCenter,
  StoreRentalContractCenterQuery,
  StoreRentalContractCenterRow,
  StoreRentalContractMockSignRequest,
  StoreRentalContractMockSignResult,
  StoreRentalContractPrintRequest,
  StoreRentalContractPrintResult,
  StoreRentalContractRecord,
  StoreRentalEventSnapshotRecord,
  StoreRentalNotificationRecord,
  StoreRentalInspectionRecord,
  StoreRentalIdempotencyRecord,
  StoreRentalOperationLockRecord,
  StoreRentalOrderDetail,
  StoreRentalOrderFulfillmentRecords,
  StoreRentalOrderRemarkRecord,
  StoreRentalOrderSummary,
  StoreRentalOrderTimelineItem,
  StoreRentalRuleConfig,
  StoreRentalRuleVersionRecord,
  StoreRentalSettlementSummary,
  StoreRentalTransactionRecord,
  CreateStoreRentalContractRequest,
  CreateStoreRentalNotificationRequest,
  CreateStoreRentalOperationLockRequest,
  CreateStoreRentalRemarkRequest,
  CloseStoreRentalRemarkRequest,
  AdvanceVehicleTransferTaskRequest,
  BindTboxDeviceRequest,
  CreateVehicleTransferTaskRequest,
  ProcessFinanceManualAdjustmentRequest,
  ProcessMemberReviewRequest,
  ProcessMemberRiskRequest,
  RunTboxCommandRequest,
  SaveCorporateRequest,
  SaveFinanceDocumentRequest,
  SaveFinanceManualAdjustmentRequest,
  SaveFinancePreAuthorizationRequest,
  SaveMemberRequest,
  SaveMembershipPlanRequest,
  SaveStoreRentalRuleConfigRequest,
  SaveStationCalendarDayRequest,
  SaveVehicleAttachmentRequest,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  StationCalendarDay,
  StationCapacitySnapshot,
  StationCapacityRefreshResult,
  StoreStationListQuery,
  StoreStationListResult,
  StoreStationSummary,
  TboxCommandRecord,
  TboxCommandResult,
  TboxDeviceSummary,
  VehicleAccidentRecord,
  VehicleAttachmentRecord,
  VehicleConditionPhotoRecord,
  VehicleCredentialRecord,
  VehicleGroupMaster,
  VehicleInstanceSummary,
  VehicleListQuery,
  VehicleListResult,
  VehicleLocationEvent,
  VehicleMaintenanceRecord,
  VehicleOnboardItemRecord,
  VehicleStatusChangeRecord,
  VehicleStatusRecheckSummary,
  VehicleOperationLog,
  VehicleTransferTask,
  VehicleTransferTaskResult
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestTenantId } from "../../common/request-identity";

type Metadata = Record<string, unknown>;

interface OrderFilter {
  keyword?: string;
  status?: string;
}

interface SaveOrderInput {
  order: StoreRentalOrderSummary;
  vehicleGroupCode?: string;
  pickupStoreCode?: string;
  returnStoreCode?: string;
  pricingSnapshot: Prisma.InputJsonValue;
  marketingSnapshot?: Prisma.InputJsonValue;
  termsSnapshot: Prisma.InputJsonValue;
  vehicleGroupSnapshot?: Prisma.InputJsonValue;
  pickupStoreSnapshot?: Prisma.InputJsonValue;
  returnStoreSnapshot?: Prisma.InputJsonValue;
  settlementSummary?: StoreRentalSettlementSummary;
  feeLedgerItems?: StoreRentalFeeLedgerItem[];
  transactionRecords?: StoreRentalTransactionRecord[];
  timeline?: StoreRentalOrderTimelineItem[];
}

interface SaveExtensionSnapshotInput {
  id: string;
  snapshotRef: string;
  oldReturnAt: string;
  newReturnAt: string;
  extensionHours: number;
  billableDays: number;
  amount: number;
  settlementMode: string;
  ruleSnapshot: Prisma.InputJsonValue;
  pricingSnapshot?: Prisma.InputJsonValue;
  operator?: string;
}

interface SaveOrderEventSnapshotInput {
  id: string;
  snapshotRef: string;
  eventType: StoreRentalEventSnapshotRecord["eventType"];
  title: string;
  triggerReason?: string;
  settlementTarget?: string;
  amount?: number;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  amountBreakdown?: Prisma.InputJsonValue;
  payload?: Prisma.InputJsonValue;
  operator?: string;
  occurredAt: string;
}

@Injectable()
export class StoreRentalRepository {
  private get defaultTenantId() {
    return getRequestTenantId();
  }
  private readonly rentalRuleCode = "STORE_RENTAL_RULES";

  constructor(private readonly prisma: PrismaService) {}

  async getCurrentRentalRuleConfig(
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalRuleConfig | undefined> {
    const row = await this.prisma.rentalRuleSet.findFirst({
      where: { tenantId, code: this.rentalRuleCode },
      orderBy: [{ versionNo: "desc" }]
    });

    return row ? this.toRentalRuleVersionRecord(row).snapshot : undefined;
  }

  async listRentalRuleVersions(
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalRuleVersionRecord[]> {
    const rows = await this.prisma.rentalRuleSet.findMany({
      where: { tenantId, code: this.rentalRuleCode },
      orderBy: { versionNo: "desc" }
    });

    return rows.map((row) => this.toRentalRuleVersionRecord(row));
  }

  async getRentalRuleVersion(
    version: string,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalRuleVersionRecord> {
    const row = await this.prisma.rentalRuleSet.findFirst({
      where: { tenantId, code: this.rentalRuleCode, id: version }
    });
    if (!row) {
      throw new NotFoundException(`Rental rule version ${version} was not found`);
    }

    return this.toRentalRuleVersionRecord(row);
  }

  async saveRentalRuleConfig(
    input: SaveStoreRentalRuleConfigRequest,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalRuleConfig> {
    const now = new Date();
    const savedAt = now.toISOString();
    const latest = await this.prisma.rentalRuleSet.findFirst({
      where: { tenantId, code: this.rentalRuleCode },
      orderBy: { versionNo: "desc" }
    });
    const versionNo = (latest?.versionNo ?? 0) + 1;
    const version = this.nextRentalRuleVersionId(versionNo, savedAt);
    const snapshot: StoreRentalRuleConfig = {
      ...input,
      version,
      status: input.status || ConfigStatus.Effective,
      effectiveAt: input.effectiveAt || savedAt
    };
    const savedBy = input.operator?.trim() || "营运端";
    const changeReason = input.changeReason?.trim() || "保存门市租赁业务规则";

    if (snapshot.status === "effective") {
      await this.prisma.rentalRuleSet.updateMany({
        where: { tenantId, code: this.rentalRuleCode, status: "effective" },
        data: { status: "archived" }
      });
    }

    await this.prisma.rentalRuleSet.create({
      data: {
        id: version,
        tenantId,
        code: this.rentalRuleCode,
        name: "门市租赁业务规则",
        versionNo,
        status: snapshot.status,
        content: {
          snapshot,
          metadata: { savedBy, savedAt, changeReason }
        } as unknown as Prisma.InputJsonValue,
        effectiveAt: new Date(snapshot.effectiveAt)
      }
    });

    return snapshot;
  }

  async listStations(tenantId = this.defaultTenantId): Promise<StoreStationSummary[]> {
    const rows = await this.prisma.storeStation.findMany({
      where: { tenantId },
      orderBy: [{ parentStoreName: "asc" }, { name: "asc" }]
    });

    return rows.map((row) => this.toStationSummary(row));
  }

  async listStationPage(
    query: StoreStationListQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<StoreStationListResult> {
    const keyword = query.keyword?.trim();
    const status = this.normalizeStationStatusFilter(query.status);
    const where: Prisma.StoreStationWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { parentStoreName: { contains: keyword } },
              { address: { contains: keyword } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.storeStation.findMany({
      where,
      orderBy: [{ parentStoreName: "asc" }, { name: "asc" }]
    });

    return this.buildStationListResult(
      rows.map((row) => this.toStationSummary(row)),
      {
        ...query,
        keyword: undefined,
        status: undefined
      }
    );
  }

  private buildStationListResult(
    rows: StoreStationSummary[],
    query: StoreStationListQuery = {}
  ): StoreStationListResult {
    const serviceCapability = query.serviceCapability?.trim();
    const serviceStatus = this.normalizeStationServiceStatusFilter(query.serviceStatus);
    const scopeType = query.scopeType || "all";
    const scopeLabel = query.scopeLabel?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const filteredRows = rows.filter((row) => {
      const scopeMatched =
        scopeType === "all" ||
        !scopeLabel ||
        (scopeType === "company" && (row.companyName || "演示香港租户") === scopeLabel) ||
        (scopeType === "store" && row.parentStoreName === scopeLabel);
      const serviceMatched =
        !serviceCapability || row.serviceCapabilities.includes(serviceCapability);
      const rowServiceStatus =
        serviceCapability === "24小时自助"
          ? row.storeSelfServiceStatus
          : serviceCapability === "门市租车"
            ? row.storeRentalServiceStatus
            : row.serviceStatus;
      const serviceStatusMatched = !serviceStatus || rowServiceStatus === serviceStatus;
      return scopeMatched && serviceMatched && serviceStatusMatched;
    });
    const offset = (page - 1) * pageSize;

    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      stats: this.buildStationListStats(filteredRows)
    };
  }

  private buildStationListStats(rows: StoreStationSummary[]): StoreStationListResult["stats"] {
    return {
      total: rows.length,
      enabled: rows.filter((row) => row.status === "enabled").length,
      disabled: rows.filter((row) => row.status === "disabled").length,
      normal: rows.filter((row) => row.serviceStatus === "normal").length,
      paused: rows.filter((row) => row.serviceStatus === "paused").length,
      maintenance: rows.filter((row) => row.serviceStatus === "maintenance").length
    };
  }

  private normalizeStationStatusFilter(
    value: unknown
  ): StoreStationSummary["status"] | undefined {
    return ["enabled", "disabled"].includes(String(value))
      ? (value as StoreStationSummary["status"])
      : undefined;
  }

  private normalizeStationServiceStatusFilter(
    value: unknown
  ): StoreStationSummary["serviceStatus"] | undefined {
    return ["normal", "paused", "maintenance"].includes(String(value))
      ? (value as StoreStationSummary["serviceStatus"])
      : undefined;
  }

  async saveStation(
    input: StoreStationSummary,
    tenantId = this.defaultTenantId
  ): Promise<StoreStationSummary> {
    const code = input.stationCode?.trim() || input.storeCode?.trim() || input.id;
    const row = await this.prisma.storeStation.upsert({
      where: { id: input.id },
      update: {
        tenantId,
        code,
        name: input.name,
        parentStoreName: input.parentStoreName,
        type: input.stationType,
        status: input.status,
        serviceStatus: input.serviceStatus,
        address: input.address,
        serviceTypes: this.stationServiceTypes(input) as Prisma.InputJsonValue,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      },
      create: {
        id: input.id,
        tenantId,
        code,
        name: input.name,
        parentStoreName: input.parentStoreName,
        type: input.stationType,
        status: input.status,
        serviceStatus: input.serviceStatus,
        address: input.address,
        serviceTypes: this.stationServiceTypes(input) as Prisma.InputJsonValue,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      }
    });

    return this.toStationSummary(row);
  }

  async listVehicleGroups(
    tenantId = this.defaultTenantId
  ): Promise<VehicleGroupMaster[]> {
    const rows = await this.prisma.vehicleGroup.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { brand: "asc" }, { model: "asc" }]
    });

    return rows.map((row) => this.toVehicleGroupMaster(row));
  }

  async saveVehicleGroup(
    input: VehicleGroupMaster,
    tenantId = this.defaultTenantId
  ): Promise<VehicleGroupMaster> {
    const code = input.id;
    const row = await this.prisma.vehicleGroup.upsert({
      where: { id: input.id },
      update: {
        tenantId,
        code,
        name: this.vehicleGroupDisplayName(input),
        seats: Number(input.seats || 0),
        brand: input.brand,
        model: input.model,
        energyType: input.displacement,
        transmission: undefined,
        luggageCount: this.parseLuggageCount(input.trunkCapacity),
        status: input.status,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      },
      create: {
        id: input.id,
        tenantId,
        code,
        name: this.vehicleGroupDisplayName(input),
        seats: Number(input.seats || 0),
        brand: input.brand,
        model: input.model,
        energyType: input.displacement,
        transmission: undefined,
        luggageCount: this.parseLuggageCount(input.trunkCapacity),
        status: input.status,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      }
    });

    return this.toVehicleGroupMaster(row);
  }

  async deleteVehicleGroup(id: string) {
    const row = await this.prisma.vehicleGroup.findUnique({
      where: { id },
      include: { vehicles: true, orders: true }
    });

    if (!row) {
      throw new NotFoundException(`Vehicle group ${id} was not found`);
    }
    if (row.vehicles.length > 0 || row.orders.length > 0) {
      throw new BadRequestException(
        "该车型组已被车辆或订单引用，不能删除。请先下架相关车辆或保留历史版本。"
      );
    }

    await this.prisma.vehicleGroup.delete({ where: { id } });
    return {
      id,
      deleted: true,
      message: "车型组已删除"
    };
  }

  async listVehicles(tenantId = this.defaultTenantId): Promise<VehicleInstanceSummary[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { tenantId },
      include: this.vehicleInclude(),
      orderBy: [{ operationStatus: "asc" }, { plateNo: "asc" }]
    });

    return rows.map((row) => this.toVehicleSummary(row));
  }

  async listVehiclePage(
    query: VehicleListQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<VehicleListResult> {
    const keyword = query.keyword?.trim();
    const operationStatus = this.normalizeVehicleStatusFilter(query.operationStatus);
    const where: Prisma.VehicleWhereInput = {
      tenantId,
      ...(operationStatus
        ? { operationStatus: this.toPrismaOperationStatus(operationStatus) }
        : {}),
      ...(keyword
        ? {
            OR: [
              { plateNo: { contains: keyword } },
              { vin: { contains: keyword } },
              { cid: { contains: keyword } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.vehicle.findMany({
      where,
      include: this.vehicleInclude(),
      orderBy: [{ operationStatus: "asc" }, { plateNo: "asc" }]
    });

    return this.buildVehicleListResult(
      rows.map((row) => this.toVehicleSummary(row)),
      {
        ...query,
        keyword: undefined,
        operationStatus: undefined
      }
    );
  }

  private buildVehicleListResult(
    rows: VehicleInstanceSummary[],
    query: VehicleListQuery = {}
  ): VehicleListResult {
    const serviceType = this.normalizeVehicleServiceTypeFilter(query.serviceType);
    const storeName = query.storeName?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const availableStores = Array.from(
      new Set(rows.map((row) => row.currentStoreName.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const availableStations = Array.from(
      new Set(rows.map((row) => row.currentStationName.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const filteredRows = rows.filter((row) => {
      const serviceMatched = !serviceType || row.serviceTypes.includes(serviceType);
      const storeMatched = !storeName || row.currentStoreName === storeName;
      return serviceMatched && storeMatched;
    });
    const offset = (page - 1) * pageSize;

    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      availableStores,
      availableStations,
      stats: this.buildVehicleListStats(filteredRows)
    };
  }

  private buildVehicleListStats(rows: VehicleInstanceSummary[]): VehicleListResult["stats"] {
    return {
      total: rows.length,
      idle: rows.filter((row) => row.operationStatus === "idle").length,
      reserved: rows.filter((row) => row.operationStatus === "reserved").length,
      renting: rows.filter((row) => row.operationStatus === "renting").length,
      controlled: rows.filter((row) => row.operationStatus === "controlled").length,
      maintenance: rows.filter((row) => row.operationStatus === "maintenance").length,
      disabled: rows.filter((row) => row.operationStatus === "disabled").length
    };
  }

  private normalizeVehicleStatusFilter(
    value: unknown
  ): VehicleInstanceSummary["operationStatus"] | undefined {
    return ["idle", "reserved", "renting", "controlled", "maintenance", "disabled"].includes(
      String(value)
    )
      ? (value as VehicleInstanceSummary["operationStatus"])
      : undefined;
  }

  private normalizeVehicleServiceTypeFilter(
    value: unknown
  ): VehicleInstanceSummary["currentServiceType"] | undefined {
    return ["STORE_STANDARD", "STORE_24H"].includes(String(value))
      ? (value as VehicleInstanceSummary["currentServiceType"])
      : undefined;
  }

  async findVehicle(id: string): Promise<VehicleInstanceSummary> {
    const row = await this.prisma.vehicle.findUnique({
      where: { id },
      include: this.vehicleInclude()
    });
    if (!row) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }

    return this.toVehicleSummary(row);
  }

  async findVehicleByPlateNo(
    plateNo: string | undefined,
    tenantId = this.defaultTenantId
  ): Promise<VehicleInstanceSummary | undefined> {
    if (!plateNo || plateNo === "待人工派车") {
      return undefined;
    }

    const row = await this.prisma.vehicle.findFirst({
      where: { tenantId, plateNo },
      include: this.vehicleInclude()
    });

    return row ? this.toVehicleSummary(row) : undefined;
  }

  async saveVehicle(
    input: VehicleInstanceSummary,
    tenantId = this.defaultTenantId
  ): Promise<VehicleInstanceSummary> {
    const [vehicleGroup, station] = await Promise.all([
      this.findVehicleGroupForVehicle(input.vehicleGroupName, tenantId),
      this.findStationForVehicle(input.currentStationName, tenantId)
    ]);
    const store = await this.prisma.organizationUnit.findFirst({
      where: {
        tenantId,
        name: input.currentStoreName || station?.parentStoreName
      }
    });

    if (!vehicleGroup) {
      throw new BadRequestException("请选择已存在的车型组。");
    }

    const row = await this.prisma.vehicle.upsert({
      where: { id: input.id },
      update: {
        tenantId,
        storeId: store?.id,
        currentStationId: station?.id,
        vehicleGroupId: vehicleGroup.id,
        plateNo: input.licensePlate,
        vin: input.vin,
        assetCompanyName: input.assetCompanyName,
        color: input.color,
        cid: input.cid,
        isSpecial: input.isSpecial,
        enabled: input.enabled,
        operationStatus: this.toPrismaOperationStatus(input.operationStatus),
        currentServiceType: this.toPrismaServiceType(input.currentServiceType),
        serviceTypes: input.serviceTypes as Prisma.InputJsonValue,
        mileage: Math.round(input.mileage || 0),
        status: input.operationStatus,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      },
      create: {
        id: input.id,
        tenantId,
        storeId: store?.id,
        currentStationId: station?.id,
        vehicleGroupId: vehicleGroup.id,
        plateNo: input.licensePlate,
        vin: input.vin,
        assetCompanyName: input.assetCompanyName,
        color: input.color,
        cid: input.cid,
        isSpecial: input.isSpecial,
        enabled: input.enabled,
        operationStatus: this.toPrismaOperationStatus(input.operationStatus),
        currentServiceType: this.toPrismaServiceType(input.currentServiceType),
        serviceTypes: input.serviceTypes as Prisma.InputJsonValue,
        mileage: Math.round(input.mileage || 0),
        status: input.operationStatus,
        metadata: this.metadata(input) as Prisma.InputJsonValue
      },
      include: this.vehicleInclude()
    });

    return this.toVehicleSummary(row);
  }

  async listVehicleTransferTasks(
    tenantId = this.defaultTenantId
  ): Promise<VehicleTransferTask[]> {
    const rows = await this.prisma.vehicleTransferTask.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toVehicleTransferTask(row));
  }

  async createVehicleTransferTask(
    input: CreateVehicleTransferTaskRequest,
    tenantId = this.defaultTenantId
  ): Promise<{ task: VehicleTransferTask; vehicles: VehicleInstanceSummary[] }> {
    const station = await this.prisma.storeStation.findFirst({
      where: { tenantId, name: input.targetStationName }
    });
    if (!station || station.parentStoreName !== input.targetStoreName) {
      throw new BadRequestException("目标站点不存在或不属于目标门市。");
    }

    const rows = await this.prisma.vehicle.findMany({
      where: { tenantId, id: { in: input.vehicleIds } },
      include: this.vehicleInclude()
    });
    if (rows.length !== input.vehicleIds.length) {
      throw new BadRequestException("调拨车辆不存在或不属于当前租户。");
    }

    const blockingOrderNosByVehicle = await this.listActiveVehicleOrderNosByVehicle(
      rows.map((row) => row.id),
      tenantId
    );

    const sourceStoreName = rows[0]?.store?.name || rows[0]?.currentStation?.parentStoreName || "";
    const sourceStationName = rows[0]?.currentStation?.name || "";
    const taskNo = `TR${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}${cryptoRandomId().slice(0, 4).toUpperCase()}`;
    const operator = input.operator?.trim() || "营运端";
    const items = [];
    const savedVehicles: VehicleInstanceSummary[] = rows.map((row) => this.toVehicleSummary(row));

    for (const row of rows) {
      const vehicle = this.toVehicleSummary(row);
      if (vehicle.operationStatus !== "idle") {
        items.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          sourceStoreName: vehicle.currentStoreName,
          sourceStationName: vehicle.currentStationName,
          targetStoreName: input.targetStoreName,
          targetStationName: input.targetStationName,
          targetServiceType: input.targetServiceType,
          result: "failed" as const,
          message: "车辆非空闲状态，不能直接调拨。"
        });
        continue;
      }
      const blockingOrderNos = blockingOrderNosByVehicle.get(vehicle.id) ?? [];
      if (blockingOrderNos.length > 0) {
        items.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          sourceStoreName: vehicle.currentStoreName,
          sourceStationName: vehicle.currentStationName,
          targetStoreName: input.targetStoreName,
          targetStationName: input.targetStationName,
          targetServiceType: input.targetServiceType,
          result: "failed" as const,
          message: `车辆存在履约中订单占用（${blockingOrderNos.join("、")}），不能直接调拨。`
        });
        continue;
      }
      if (!vehicle.serviceTypes.includes(input.targetServiceType)) {
        items.push({
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          sourceStoreName: vehicle.currentStoreName,
          sourceStationName: vehicle.currentStationName,
          targetStoreName: input.targetStoreName,
          targetStationName: input.targetStationName,
          targetServiceType: input.targetServiceType,
          result: "failed" as const,
          message: "车辆未配置目标服务类型。"
        });
        continue;
      }

      items.push({
        vehicleId: vehicle.id,
        licensePlate: vehicle.licensePlate,
        sourceStoreName: vehicle.currentStoreName,
        sourceStationName: vehicle.currentStationName,
        targetStoreName: input.targetStoreName,
        targetStationName: input.targetStationName,
        targetServiceType: input.targetServiceType,
        result: "pending" as const,
        message: "调拨申请已创建，待确认。"
      });
    }

    const row = await this.prisma.vehicleTransferTask.create({
      data: {
        tenantId,
        taskNo,
        status: "pending",
        sourceStoreName,
        sourceStationName,
        targetStoreName: input.targetStoreName,
        targetStationName: input.targetStationName,
        targetServiceType: this.toPrismaServiceType(input.targetServiceType),
        vehicleCount: items.length,
        reason: input.reason,
        operator,
        items: items as Prisma.InputJsonValue
      }
    });

    return {
      task: this.toVehicleTransferTask(row),
      vehicles: savedVehicles
    };
  }

  async advanceVehicleTransferTask(
    id: string,
    input: AdvanceVehicleTransferTaskRequest,
    tenantId = this.defaultTenantId
  ): Promise<VehicleTransferTaskResult> {
    const task = await this.prisma.vehicleTransferTask.findFirst({
      where: { id, tenantId }
    });
    if (!task) {
      throw new NotFoundException(`Vehicle transfer task ${id} was not found`);
    }
    if (["completed", "cancelled"].includes(task.status)) {
      throw new BadRequestException("调拨任务已结束，不能继续推进。");
    }

    const operator = input.operator?.trim() || "营运端";
    const reason = input.reason?.trim() || task.reason || "车辆调拨流程推进";
    const items = this.transferTaskItems(task.items);
    const validItems = items.filter((item) => item.result !== "failed");
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, id: { in: validItems.map((item) => item.vehicleId) } },
      include: this.vehicleInclude()
    });
    const now = new Date();

    if (input.action === "approve") {
      const vehicleById = new Map(vehicles.map((row) => [row.id, row]));
      const blockingOrderNosByVehicle = await this.listActiveVehicleOrderNosByVehicle(
        validItems.map((item) => item.vehicleId),
        tenantId
      );
      const nextItems = [];
      for (const row of vehicles) {
        const before = this.toVehicleSummary(row);
        const blockingOrderNos = blockingOrderNosByVehicle.get(before.id) ?? [];
        if (before.operationStatus === "idle" && blockingOrderNos.length === 0) {
          const saved = await this.updateVehicleForTransferControl(row.id, {
            operator,
            reason,
            action: "调拨申请确认，车辆进入调拨管控"
          });
          await this.recordVehicleStatusChange(before, saved, {
            operator,
            reason,
            impactedOrderNos: []
          });
        }
      }
      for (const item of items) {
        if (item.result === "failed") {
          nextItems.push(item);
          continue;
        }
        const row = vehicleById.get(item.vehicleId);
        const vehicle = row ? this.toVehicleSummary(row) : undefined;
        const blockingOrderNos = blockingOrderNosByVehicle.get(item.vehicleId) ?? [];
        if (!vehicle || vehicle.operationStatus !== "idle") {
          nextItems.push({
            ...item,
            result: "failed" as const,
            message: "确认时车辆已被占用，调拨失败。"
          });
          continue;
        }
        if (blockingOrderNos.length > 0) {
          nextItems.push({
            ...item,
            result: "failed" as const,
            message: `确认时车辆存在履约中订单占用（${blockingOrderNos.join("、")}），调拨失败。`
          });
          continue;
        }
        nextItems.push({
          ...item,
          result: "pending" as const,
          message: "已确认，待出发。"
        });
      }
      const savedTask = await this.prisma.vehicleTransferTask.update({
        where: { id },
        data: {
          status: "approved",
          approvedAt: now,
          items: nextItems as unknown as Prisma.InputJsonValue
        }
      });
      return {
        task: this.toVehicleTransferTask(savedTask),
        vehicles: await this.listVehiclesByIds(items.map((item) => item.vehicleId), tenantId)
      };
    }

    if (input.action === "depart") {
      if (task.status !== "approved") {
        throw new BadRequestException("调拨任务需先确认后才能登记出发。");
      }
      const savedTask = await this.prisma.vehicleTransferTask.update({
        where: { id },
        data: {
          status: "departed",
          departedAt: now,
          items: validItems.map((item) => ({
            ...item,
            result: "pending",
            message: "车辆已出发，等待到达确认。"
          })) as Prisma.InputJsonValue
        }
      });
      for (const row of vehicles) {
        await this.appendVehicleOperationLog(this.toVehicleSummary(row), {
          operator,
          action: "车辆调拨出发",
          reason
        });
      }
      return {
        task: this.toVehicleTransferTask(savedTask),
        vehicles: await this.listVehiclesByIds(validItems.map((item) => item.vehicleId), tenantId)
      };
    }

    if (input.action === "arrive") {
      if (task.status !== "approved" && task.status !== "departed") {
        throw new BadRequestException("调拨任务需先确认后才能登记到达。");
      }
      const station = await this.prisma.storeStation.findFirst({
        where: { tenantId, name: task.targetStationName }
      });
      if (!station) {
        throw new BadRequestException("目标站点不存在。");
      }
      const savedVehicles: VehicleInstanceSummary[] = [];
      for (const row of vehicles) {
        const vehicle = this.toVehicleSummary(row);
        const store = await this.prisma.organizationUnit.findFirst({
          where: { tenantId, name: task.targetStoreName }
        });
        const metadata = {
          ...this.objectMetadata(row.metadata),
          currentStoreName: task.targetStoreName,
          currentStationName: task.targetStationName,
          lastOperationAt: now.toISOString(),
          lastOperationBy: operator,
          operationReason: reason,
          maintenanceReason: ""
        };
        const savedRow = await this.prisma.vehicle.update({
          where: { id: row.id },
          data: {
            storeId: store?.id,
            currentStationId: station.id,
            currentServiceType: task.targetServiceType,
            operationStatus: row.enabled
              ? this.toPrismaOperationStatus("idle")
              : this.toPrismaOperationStatus("disabled"),
            status: row.enabled ? "idle" : "disabled",
            metadata: this.orderSnapshot(metadata)
          },
          include: this.vehicleInclude()
        });
        const saved = this.toVehicleSummary(savedRow);
        await this.createVehicleLocationEvent(saved.id, {
          id: `loc_transfer_${cryptoRandomId()}`,
          at: now.toISOString(),
          type: "transfer",
          storeName: task.targetStoreName,
          stationName: task.targetStationName,
          mileage: saved.mileage,
          operator,
          source: "operation",
          note: reason
        });
        await this.appendVehicleOperationLog(saved, {
          operator,
          action: "车辆调拨到达",
          reason: `${vehicle.currentStoreName}/${vehicle.currentStationName} -> ${task.targetStoreName}/${task.targetStationName}`
        });
        savedVehicles.push(saved);
      }
      const savedTask = await this.prisma.vehicleTransferTask.update({
        where: { id },
        data: {
          status: "completed",
          completedAt: now,
          items: validItems.map((item) => ({
            ...item,
            result: "completed",
            message: "调拨完成"
          })) as Prisma.InputJsonValue
        }
      });
      await this.refreshStationCapacitySnapshots(undefined, tenantId);
      return {
        task: this.toVehicleTransferTask(savedTask),
        vehicles: savedVehicles
      };
    }

    const savedTask = await this.prisma.vehicleTransferTask.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelReason: reason,
        items: items.map((item) => ({
          ...item,
          result: item.result === "failed" ? "failed" : "pending",
          message: item.result === "failed" ? item.message : "调拨已取消"
        })) as Prisma.InputJsonValue
      }
    });
    for (const row of vehicles) {
      const before = this.toVehicleSummary(row);
      if (before.operationStatus === "controlled") {
        const saved = await this.restoreVehicleFromTransferControl(row.id, {
          operator,
          reason
        });
        await this.recordVehicleStatusChange(before, saved, {
          operator,
          reason,
          impactedOrderNos: []
        });
      }
    }
    await this.refreshStationCapacitySnapshots(undefined, tenantId);
    return {
      task: this.toVehicleTransferTask(savedTask),
      vehicles: await this.listVehiclesByIds(validItems.map((item) => item.vehicleId), tenantId)
    };
  }

  async listVehicleCredentials(vehicleId: string): Promise<VehicleCredentialRecord[]> {
    const rows = await this.prisma.vehicleCredentialRecord.findMany({
      where: { vehicleId },
      orderBy: [{ status: "asc" }, { expiresAt: "asc" }]
    });

    return rows.map((row) => this.toVehicleCredentialRecord(row));
  }

  async saveVehicleCredential(
    vehicleId: string,
    input: SaveVehicleCredentialRequest
  ): Promise<VehicleCredentialRecord> {
    await this.findVehicle(vehicleId);
    const id = input.id || `cred_${cryptoRandomId()}`;
    const status = input.status || this.resolveCredentialStatus(input.expiresAt);
    const row = await this.prisma.vehicleCredentialRecord.upsert({
      where: { id },
      update: {
        credentialType: input.credentialType,
        credentialName: input.credentialName,
        certNo: input.certNo,
        status,
        issueAt: input.issueAt ? new Date(input.issueAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        reminderDays: input.reminderDays ?? 30,
        attachments: (input.attachments ?? []) as Prisma.InputJsonValue,
        operator: input.operator || "营运端"
      },
      create: {
        id,
        vehicleId,
        credentialType: input.credentialType,
        credentialName: input.credentialName,
        certNo: input.certNo,
        status,
        issueAt: input.issueAt ? new Date(input.issueAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        reminderDays: input.reminderDays ?? 30,
        attachments: (input.attachments ?? []) as Prisma.InputJsonValue,
        operator: input.operator || "营运端"
      }
    });

    return this.toVehicleCredentialRecord(row);
  }

  async listVehicleOnboardItems(vehicleId: string): Promise<VehicleOnboardItemRecord[]> {
    const rows = await this.prisma.vehicleOnboardItem.findMany({
      where: { vehicleId },
      orderBy: [{ category: "asc" }, { itemName: "asc" }]
    });

    return rows.map((row) => this.toVehicleOnboardItemRecord(row));
  }

  async saveVehicleOnboardItem(
    vehicleId: string,
    input: SaveVehicleOnboardItemRequest
  ): Promise<VehicleOnboardItemRecord> {
    await this.findVehicle(vehicleId);
    const id = input.id || `item_${cryptoRandomId()}`;
    const row = await this.prisma.vehicleOnboardItem.upsert({
      where: { id },
      update: {
        category: input.category,
        itemName: input.itemName,
        standardQuantity: Math.max(0, input.standardQuantity),
        actualQuantity: Math.max(0, input.actualQuantity),
        status: input.status || "normal",
        priceAmount: input.priceAmount ?? 0,
        checkedAt: input.checkedAt ? new Date(input.checkedAt) : new Date(),
        operator: input.operator || "营运端",
        remark: input.remark
      },
      create: {
        id,
        vehicleId,
        category: input.category,
        itemName: input.itemName,
        standardQuantity: Math.max(0, input.standardQuantity),
        actualQuantity: Math.max(0, input.actualQuantity),
        status: input.status || "normal",
        priceAmount: input.priceAmount ?? 0,
        checkedAt: input.checkedAt ? new Date(input.checkedAt) : new Date(),
        operator: input.operator || "营运端",
        remark: input.remark
      }
    });

    return this.toVehicleOnboardItemRecord(row);
  }

  async listTboxDevices(tenantId = this.defaultTenantId): Promise<TboxDeviceSummary[]> {
    const rows = await this.prisma.tboxDevice.findMany({
      where: { tenantId },
      include: { boundVehicle: { include: this.vehicleInclude() } },
      orderBy: [{ status: "asc" }, { cid: "asc" }]
    });

    return rows.map((row) => this.toTboxDeviceSummary(row));
  }

  async bindTboxDevice(
    id: string,
    input: BindTboxDeviceRequest
  ): Promise<TboxDeviceSummary> {
    const device = await this.prisma.tboxDevice.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException(`TBox device ${id} was not found`);
    }

    if (input.vehicleId) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!vehicle) {
        throw new NotFoundException(`Vehicle ${input.vehicleId} was not found`);
      }
      await this.prisma.vehicle.update({
        where: { id: input.vehicleId },
        data: { cid: device.cid }
      });
    } else if (device.boundVehicleId) {
      await this.prisma.vehicle.update({
        where: { id: device.boundVehicleId },
        data: { cid: null }
      });
    }

    const row = await this.prisma.tboxDevice.update({
      where: { id },
      data: {
        boundVehicleId: input.vehicleId || null,
        lastHeartbeatAt: new Date(),
        onlineStatus: input.vehicleId ? "online" : "unknown"
      },
      include: { boundVehicle: { include: this.vehicleInclude() } }
    });

    return this.toTboxDeviceSummary(row);
  }

  async runTboxCommand(
    id: string,
    input: RunTboxCommandRequest
  ): Promise<TboxCommandResult> {
    const device = await this.prisma.tboxDevice.findUnique({
      where: { id },
      include: { boundVehicle: { include: this.vehicleInclude() } }
    });
    if (!device) {
      throw new NotFoundException(`TBox device ${id} was not found`);
    }

    const status = device.status === "active" && device.boundVehicleId ? "success" : "failed";
    const command = await this.prisma.tboxCommandRecord.create({
      data: {
        deviceId: id,
        command: input.command,
        status,
        vehiclePlateNo: device.boundVehicle?.plateNo,
        operator: input.operator || "营运端",
        requestPayload: { provider: "reserved", command: input.command },
        responsePayload: {
          mocked: true,
          message: status === "success" ? "预留接口模拟成功" : "设备未绑定或未启用"
        }
      }
    });
    const saved = await this.prisma.tboxDevice.update({
      where: { id },
      data: {
        onlineStatus: status === "success" ? "online" : device.onlineStatus,
        lastHeartbeatAt: new Date()
      },
      include: { boundVehicle: { include: this.vehicleInclude() } }
    });

    return {
      device: this.toTboxDeviceSummary(saved),
      command: this.toTboxCommandRecord(command, saved.cid),
      message: status === "success" ? "TBox 预留指令已模拟下发。" : "TBox 指令未执行，设备未绑定或未启用。"
    };
  }

  async listStationCalendar(stationId: string): Promise<StationCalendarDay[]> {
    const rows = await this.prisma.stationCalendarDay.findMany({
      where: { stationId },
      include: { station: true },
      orderBy: { date: "asc" },
      take: 90
    });

    return rows.map((row) => this.toStationCalendarDay(row));
  }

  async saveStationCalendarDay(
    stationId: string,
    input: SaveStationCalendarDayRequest
  ): Promise<StationCalendarDay> {
    const station = await this.prisma.storeStation.findUnique({ where: { id: stationId } });
    if (!station) {
      throw new NotFoundException(`Station ${stationId} was not found`);
    }
    const date = new Date(`${input.date.slice(0, 10)}T00:00:00.000Z`);
    const row = await this.prisma.stationCalendarDay.upsert({
      where: { stationId_date: { stationId, date } },
      update: {
        businessStatus: input.businessStatus,
        openTime: input.openTime || "09:00",
        closeTime: input.closeTime || "20:00",
        capacityLimit: input.capacityLimit,
        note: input.note,
        operator: input.operator || "营运端"
      },
      create: {
        stationId,
        date,
        businessStatus: input.businessStatus,
        openTime: input.openTime || "09:00",
        closeTime: input.closeTime || "20:00",
        capacityLimit: input.capacityLimit,
        note: input.note,
        operator: input.operator || "营运端"
      },
      include: { station: true }
    });

    return this.toStationCalendarDay(row);
  }

  async listStationCapacitySnapshots(
    stationId?: string,
    tenantId = this.defaultTenantId
  ): Promise<StationCapacitySnapshot[]> {
    const rows = await this.prisma.stationCapacitySnapshot.findMany({
      where: {
        stationId,
        station: { tenantId }
      },
      include: { station: true },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toStationCapacitySnapshot(row));
  }

  async refreshStationCapacitySnapshots(
    stationId?: string,
    tenantId = this.defaultTenantId
  ): Promise<StationCapacityRefreshResult> {
    const stations = await this.prisma.storeStation.findMany({
      where: {
        tenantId,
        ...(stationId ? { id: stationId } : {})
      }
    });
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const snapshots: StationCapacitySnapshot[] = [];

    for (const station of stations) {
      const metadata = this.objectMetadata(station.metadata);
      const calendar = await this.prisma.stationCalendarDay.findUnique({
        where: { stationId_date: { stationId: station.id, date: today } }
      });
      const vehicles = await this.prisma.vehicle.findMany({
        where: { tenantId, currentStationId: station.id }
      });
      const totalSpaces =
        calendar?.capacityLimit ??
        this.numberValue(metadata.parkingTotal) ??
        Math.max(vehicles.length, 0);
      const controlledVehicles = vehicles.filter(
        (vehicle) => this.toSharedOperationStatus(vehicle.operationStatus) === "controlled"
      ).length;
      const maintenanceVehicles = vehicles.filter(
        (vehicle) => this.toSharedOperationStatus(vehicle.operationStatus) === "maintenance"
      ).length;
      const disabledVehicles = vehicles.filter(
        (vehicle) =>
          !vehicle.enabled || this.toSharedOperationStatus(vehicle.operationStatus) === "disabled"
      ).length;
      const rentingVehicles = vehicles.filter(
        (vehicle) => this.toSharedOperationStatus(vehicle.operationStatus) === "renting"
      ).length;
      const occupiedVehicles = vehicles.length - rentingVehicles;
      const pendingPickupVehicles = await this.prisma.storeRentalOrder.count({
        where: {
          tenantId,
          pickupStationId: station.id,
          mainStatus: {
            in: [
              this.toPrismaOrderMainStatus(OrderMainStatus.Reserved),
              this.toPrismaOrderMainStatus(OrderMainStatus.PickupOverdue),
              this.toPrismaOrderMainStatus(OrderMainStatus.Inspecting)
            ]
          }
        }
      });
      const pendingReturnVehicles = await this.prisma.storeRentalOrder.count({
        where: {
          tenantId,
          returnStationId: station.id,
          mainStatus: {
            in: [
              this.toPrismaOrderMainStatus(OrderMainStatus.Renting),
              this.toPrismaOrderMainStatus(OrderMainStatus.Renewing),
              this.toPrismaOrderMainStatus(OrderMainStatus.Overdue),
              this.toPrismaOrderMainStatus(OrderMainStatus.AccidentProcessing)
            ]
          }
        }
      });
      const businessStatus = this.toStationBusinessStatus(calendar?.businessStatus ?? "open");
      const closedByCalendar = businessStatus !== "open";
      const availableSpaces = closedByCalendar
        ? 0
        : Math.max(0, totalSpaces - occupiedVehicles - pendingReturnVehicles);
      const queueMetrics = this.buildStationCapacityQueueMetrics({
        totalSpaces,
        availableSpaces,
        pickupQueueVehicles: pendingPickupVehicles,
        returnQueueVehicles: pendingReturnVehicles,
        controlledVehicles,
        maintenanceVehicles,
        disabledVehicles,
        closedByCalendar,
        turnoverBufferMinutes: 60
      });
      const row = await this.prisma.stationCapacitySnapshot.create({
        data: {
          stationId: station.id,
          date: today,
          totalSpaces,
          capacityLimit: calendar?.capacityLimit,
          availableSpaces,
          reservedSpaces: Math.max(0, pendingPickupVehicles + pendingReturnVehicles),
          occupiedVehicles,
          controlledVehicles,
          maintenanceVehicles,
          disabledVehicles,
          rentingVehicles,
          pendingPickupVehicles,
          pendingReturnVehicles,
          pickupQueueVehicles: queueMetrics.pickupQueueVehicles,
          returnQueueVehicles: queueMetrics.returnQueueVehicles,
          queueVehicles: queueMetrics.queueVehicles,
          turnoverBufferMinutes: queueMetrics.turnoverBufferMinutes,
          estimatedWaitMinutes: queueMetrics.estimatedWaitMinutes,
          pressureLevel: queueMetrics.pressureLevel,
          pressureReason: queueMetrics.pressureReason,
          businessStatus,
          closedByCalendar,
          source: "system",
          operator: "容量刷新"
        },
        include: { station: true }
      });
      snapshots.push(this.toStationCapacitySnapshot(row));
    }

    return {
      snapshots,
      message: stationId ? "站点容量快照已刷新" : "全部站点容量快照已刷新"
    };
  }

  async listVehicleStatusChangeRecords(
    vehicleId: string
  ): Promise<VehicleStatusChangeRecord[]> {
    const rows = await this.prisma.vehicleStatusChangeRecord.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toVehicleStatusChangeRecord(row));
  }

  async recordVehicleStatusChange(
    before: VehicleInstanceSummary,
    after: VehicleInstanceSummary,
    input: {
      operator?: string;
      reason?: string;
      impactedOrderNos?: string[];
    }
  ): Promise<VehicleStatusChangeRecord> {
    const row = await this.prisma.vehicleStatusChangeRecord.create({
      data: {
        vehicleId: after.id,
        fromEnabled: before.enabled,
        toEnabled: after.enabled,
        fromOperationStatus: before.operationStatus,
        toOperationStatus: after.operationStatus,
        reason: input.reason,
        operator: input.operator || "营运端",
        impactedOrderCount: input.impactedOrderNos?.length ?? 0,
        impactedOrderNos: (input.impactedOrderNos ?? []) as Prisma.InputJsonValue
      }
    });

    return this.toVehicleStatusChangeRecord(row);
  }

  async recheckVehicleUpcomingOrders(
    vehicle: VehicleInstanceSummary,
    input: { operator?: string; reason?: string }
  ): Promise<VehicleStatusRecheckSummary> {
    const unavailable =
      !vehicle.enabled ||
      ["controlled", "maintenance", "disabled"].includes(vehicle.operationStatus);
    const orders = await this.prisma.storeRentalOrder.findMany({
      where: {
        assignedVehicleId: vehicle.id,
        mainStatus: {
          in: [
            this.toPrismaOrderMainStatus(OrderMainStatus.Reserved),
            this.toPrismaOrderMainStatus(OrderMainStatus.PickupOverdue)
          ]
        },
        dispatchStatus: {
          in: [
            this.toPrismaDispatchStatus(DispatchStatus.Pending),
            this.toPrismaDispatchStatus(DispatchStatus.PreAssigned),
            this.toPrismaDispatchStatus(DispatchStatus.Locked),
            this.toPrismaDispatchStatus(DispatchStatus.ManualReassigned),
            this.toPrismaDispatchStatus(DispatchStatus.Upgraded)
          ]
        }
      }
    });
    if (!unavailable || orders.length === 0) {
      return {
        checkedOrderCount: orders.length,
        releasedOrderCount: 0,
        manualQueueOrderNos: [],
        reason: input.reason || "车辆仍可履约，无需释放后续订单。"
      };
    }

    const orderIds = orders.map((order) => order.id);
    await this.prisma.storeRentalOrder.updateMany({
      where: { id: { in: orderIds } },
      data: {
        assignedVehicleId: null,
        assignedVehicleSnapshot: Prisma.JsonNull,
        dispatchStatus: this.toPrismaDispatchStatus(DispatchStatus.ManualRequired)
      }
    });

    return {
      checkedOrderCount: orders.length,
      releasedOrderCount: orders.length,
      manualQueueOrderNos: orders.map((order) => order.orderNo),
      reason: input.reason || "车辆不可租，后续未开始履约订单已释放车辆并进入人工调度。"
    };
  }

  async listVehicleAttachmentRecords(
    vehicleId: string
  ): Promise<VehicleAttachmentRecord[]> {
    const rows = await this.prisma.vehicleAttachmentRecord.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toVehicleAttachmentRecord(row));
  }

  async saveVehicleAttachmentRecord(
    vehicleId: string,
    input: SaveVehicleAttachmentRequest
  ): Promise<VehicleAttachmentRecord> {
    await this.findVehicle(vehicleId);
    const id = input.id || `veh_file_${cryptoRandomId()}`;
    const row = await this.prisma.vehicleAttachmentRecord.upsert({
      where: { id },
      update: {
        category: input.category,
        name: input.name,
        url: input.url,
        source: input.source || "manual",
        operator: input.operator || "营运端",
        remark: input.remark
      },
      create: {
        id,
        vehicleId,
        category: input.category,
        name: input.name,
        url: input.url,
        source: input.source || "manual",
        operator: input.operator || "营运端",
        remark: input.remark
      }
    });

    return this.toVehicleAttachmentRecord(row);
  }

  async listMembers(
    query: MemberListQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<MemberListResult> {
    const keyword = query.keyword?.trim();
    const status = this.normalizeMemberStatusFilter(query.status);
    const reviewStatus = this.normalizeMemberReviewStatusFilter(query.reviewStatus);
    const where: Prisma.MemberWhereInput = {
      tenantId,
      ...(status ? { status: this.toPrismaMemberStatus(status) } : {}),
      ...(reviewStatus ? { reviewStatus: this.toPrismaMemberReviewStatus(reviewStatus) } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { phone: { contains: keyword } },
              { phoneMasked: { contains: keyword } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.member.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });

    return this.buildMemberListResult(
      rows.map((row) => this.toMemberSummary(row)),
      {
        ...query,
        keyword: undefined,
        status: undefined,
        reviewStatus: undefined
      }
    );
  }

  private buildMemberListResult(
    rows: MemberSummary[],
    query: MemberListQuery = {}
  ): MemberListResult {
    const tag = query.tag?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const availableTags = Array.from(
      new Set(rows.flatMap((row) => row.tags.map((item) => item.trim()).filter(Boolean)))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const filteredRows = tag ? rows.filter((row) => row.tags.includes(tag)) : rows;
    const offset = (page - 1) * pageSize;

    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      availableTags,
      stats: {
        total: filteredRows.length,
        active: filteredRows.filter((row) => row.status === "active").length,
        pendingReview: filteredRows.filter((row) => row.reviewStatus === "pending").length,
        blacklisted: filteredRows.filter((row) => row.status === "blacklisted").length
      }
    };
  }

  private normalizePositiveInteger(value: unknown, fallback: number) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }
    return Math.floor(numericValue);
  }

  private normalizeMemberStatusFilter(value: unknown): MemberSummary["status"] | undefined {
    return ["pending_review", "active", "suspended", "blacklisted"].includes(String(value))
      ? (value as MemberSummary["status"])
      : undefined;
  }

  private normalizeMemberReviewStatusFilter(
    value: unknown
  ): MemberSummary["reviewStatus"] | undefined {
    return ["pending", "approved", "rejected"].includes(String(value))
      ? (value as MemberSummary["reviewStatus"])
      : undefined;
  }

  async getMemberDetail(id: string, tenantId = this.defaultTenantId): Promise<MemberDetail> {
    const row = await this.prisma.member.findFirst({
      where: { id, tenantId },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 10 },
        timeline: { orderBy: { createdAt: "desc" }, take: 80 }
      }
    });
    if (!row) {
      throw new NotFoundException(`Member ${id} was not found`);
    }

    return this.toMemberDetail(row);
  }

  async saveMember(
    input: SaveMemberRequest,
    tenantId = this.defaultTenantId
  ): Promise<MemberDetail> {
    const duplicated = await this.prisma.member.findFirst({
      where: {
        tenantId,
        phone: input.phone,
        id: { not: input.id }
      }
    });
    if (duplicated) {
      throw new BadRequestException("手机号已存在。");
    }

    const current = input.id
      ? await this.prisma.member.findFirst({ where: { id: input.id, tenantId } })
      : undefined;
    if (input.referrerCustomerId && input.referrerCustomerId === current?.id) throw new BadRequestException("会员不能邀请自己。");
    if (input.referrerCustomerId) {
      const referrer = await this.prisma.member.findFirst({ where: { id: input.referrerCustomerId, tenantId } });
      if (!referrer) throw new BadRequestException("邀请人不存在或不属于当前租户。");
    }
    const memberId = current?.id ?? input.id ?? `member_${cryptoRandomId()}`;
    const reviewStatus =
      input.status === "pending_review"
        ? PrismaMemberReviewStatus.PENDING
        : current?.reviewStatus === PrismaMemberReviewStatus.REJECTED &&
            input.status === "active"
          ? PrismaMemberReviewStatus.APPROVED
          : current?.reviewStatus ?? PrismaMemberReviewStatus.APPROVED;

    await this.prisma.member.upsert({
      where: { id: memberId },
      update: {
        name: input.name,
        phone: input.phone,
        phoneMasked: maskPhone(input.phone),
        email: input.email,
        source: input.source,
        levelName: input.levelName,
        status: this.toPrismaMemberStatus(input.status),
        reviewStatus,
        tags: input.tags as Prisma.InputJsonValue,
        identityVerified: Boolean(input.identityVerified),
        driverLicenseVerified: Boolean(input.driverLicenseVerified),
        identityNoMasked: input.identityNoMasked,
        driverLicenseNoMasked: input.driverLicenseNoMasked,
        birthday: input.birthday ? new Date(input.birthday) : undefined,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        notes: input.notes,
        riskNote: input.riskNote
        ,referrerCustomerId: input.referrerCustomerId
      },
      create: {
        id: memberId,
        tenantId,
        name: input.name,
        phone: input.phone,
        phoneMasked: maskPhone(input.phone),
        email: input.email,
        source: input.source || "营运端录入",
        levelName: input.levelName || "白银会员",
        status: this.toPrismaMemberStatus(input.status),
        reviewStatus,
        tags: (input.tags ?? []) as Prisma.InputJsonValue,
        identityVerified: Boolean(input.identityVerified),
        driverLicenseVerified: Boolean(input.driverLicenseVerified),
        identityNoMasked: input.identityNoMasked,
        driverLicenseNoMasked: input.driverLicenseNoMasked,
        birthday: input.birthday ? new Date(input.birthday) : undefined,
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        notes: input.notes,
        riskNote: input.riskNote
        ,referrerCustomerId: input.referrerCustomerId
      }
    });

    await this.prisma.memberTimelineEvent.create({
      data: {
        memberId,
        type: current ? "profile_update" : "profile_create",
        title: current ? "更新会员资料" : "新增会员",
        detail: {
          operator: "营运端",
          remark: current ? "会员详情保存" : "创建会员档案"
        }
      }
    });

    return this.getMemberDetail(memberId);
  }

  async listMemberReviews(
    tenantId = this.defaultTenantId
  ): Promise<MemberReviewTask[]> {
    const rows = await this.prisma.member.findMany({
      where: {
        tenantId,
        reviewStatus: { in: [PrismaMemberReviewStatus.PENDING] }
      },
      orderBy: { createdAt: "desc" }
    });

    return rows.map((row) => ({
      id: `review_${row.id}`,
      memberId: row.id,
      memberName: row.name,
      phoneMasked: row.phoneMasked,
      submittedAt: row.createdAt.toISOString(),
      reviewStatus: this.toSharedMemberReviewStatus(row.reviewStatus),
      riskFlags: row.riskNote ? [row.riskNote] : [],
      documents: ["身份证", "驾驶证"],
      remark: row.notes ?? undefined
    }));
  }

  async processMemberReview(
    reviewId: string,
    input: ProcessMemberReviewRequest
  ) {
    const memberId = reviewId.replace(/^review_/, "");
    const member = await this.prisma.member.findFirst({ where: { id: memberId, tenantId: this.defaultTenantId } });
    if (!member) {
      throw new NotFoundException(`Member review ${reviewId} was not found`);
    }

    const reviewStatus =
      input.action === "approve"
        ? PrismaMemberReviewStatus.APPROVED
        : PrismaMemberReviewStatus.REJECTED;
    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        reviewStatus,
        status:
          input.action === "approve"
            ? PrismaMemberStatus.ACTIVE
            : PrismaMemberStatus.SUSPENDED,
        identityVerified: input.action === "approve" || member.identityVerified,
        driverLicenseVerified:
          input.action === "approve" || member.driverLicenseVerified
      }
    });
    await this.prisma.memberTimelineEvent.create({
      data: {
        memberId,
        type: "review",
        title: input.action === "approve" ? "审核通过" : "审核驳回",
        detail: {
          operator: input.operator || "营运端审核",
          remark: input.remark
        }
      }
    });

    const [review] = await this.listMemberReviews(member.tenantId);
    return {
      review:
        review?.memberId === memberId
          ? review
          : {
              id: reviewId,
              memberId,
              memberName: member.name,
              phoneMasked: member.phoneMasked,
              submittedAt: member.createdAt.toISOString(),
              reviewStatus:
                input.action === "approve" ? "approved" as const : "rejected" as const,
              riskFlags: member.riskNote ? [member.riskNote] : [],
              documents: ["身份证", "驾驶证"],
              remark: input.remark
            },
      member: await this.getMemberDetail(memberId)
    };
  }

  async processMemberRisk(id: string, input: ProcessMemberRiskRequest) {
    const member = await this.prisma.member.findFirst({ where: { id, tenantId: this.defaultTenantId } });
    if (!member) {
      throw new NotFoundException(`Member ${id} was not found`);
    }

    const tags = this.stringArray(member.tags);
    const extraTags = input.tags ?? [];
    const reason = input.reason.trim();
    let status = member.status;
    let nextTags = tags;
    let title = "恢复租车资格";

    if (input.action === "blacklist") {
      status = PrismaMemberStatus.BLACKLISTED;
      nextTags = uniqueStrings([...tags, "黑名单", "禁止租车", ...extraTags]);
      title = "加入黑名单";
    } else if (input.action === "suspend") {
      status = PrismaMemberStatus.SUSPENDED;
      nextTags = uniqueStrings([...tags, "人工限制", ...extraTags]);
      title = "暂停租车资格";
    } else {
      status =
        member.reviewStatus === PrismaMemberReviewStatus.PENDING
          ? PrismaMemberStatus.PENDING_REVIEW
          : PrismaMemberStatus.ACTIVE;
      nextTags = uniqueStrings([
        ...tags.filter((tag) => !["黑名单", "禁止租车"].includes(tag)),
        "风控已复核",
        ...extraTags
      ]);
    }

    await this.prisma.member.update({
      where: { id },
      data: {
        status,
        riskNote: reason,
        tags: nextTags as Prisma.InputJsonValue
      }
    });
    await this.prisma.memberRiskEvent.create({
      data: {
        memberId: id,
        action: input.action,
        reason,
        operator: input.operator?.trim() || "营运风控"
      }
    });
    await this.prisma.memberTimelineEvent.create({
      data: {
        memberId: id,
        type: "risk",
        title,
        detail: {
          operator: input.operator?.trim() || "营运风控",
          remark: reason
        }
      }
    });

    return this.getMemberDetail(id);
  }

  async recordMemberOrderCreated(id: string, orderNo: string) {
    const member = await this.prisma.member.findFirst({ where: { id, tenantId: this.defaultTenantId } });
    if (!member) {
      return;
    }

    await this.prisma.member.update({
      where: { id },
      data: {
        totalOrders: { increment: 1 },
        lastOrderAt: new Date()
      }
    });
    await this.prisma.memberTimelineEvent.create({
      data: {
        memberId: id,
        type: "order",
        title: "创建门市租赁订单",
        detail: {
          operator: "营运端下单",
          remark: orderNo
        }
      }
    });
  }

  async listMembershipPlans(
    tenantId = this.defaultTenantId
  ): Promise<MembershipPlanSummary[]> {
    const rows = await this.prisma.membershipPlan.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });

    return rows
      .map((row) => this.toMembershipPlanSummary(row))
      .sort((left, right) => left.tierRank - right.tierRank);
  }

  async saveMembershipPlan(
    input: SaveMembershipPlanRequest,
    tenantId = this.defaultTenantId
  ): Promise<MembershipPlanSummary> {
    const duplicated = await this.prisma.membershipPlan.findFirst({
      where: {
        tenantId,
        code: input.code,
        id: { not: input.id }
      }
    });
    if (duplicated) {
      throw new BadRequestException("等级编码已存在。");
    }

    const id = input.id ?? `member_plan_${cryptoRandomId()}`;
    const row = await this.prisma.membershipPlan.upsert({
      where: { id },
      update: {
        tenantId,
        code: input.code,
        name: input.name,
        status: this.toPrismaConfigStatus(input.status),
        levelRules: {
          tierRank: input.tierRank,
          upgradeCondition: input.upgradeCondition
        },
        benefits: {
          benefitSummary: input.benefitSummary,
          orderDiscountPercent: input.orderDiscountPercent,
          depositDiscountPercent: input.depositDiscountPercent,
          freeServiceCount: input.freeServiceCount
        }
      },
      create: {
        id,
        tenantId,
        code: input.code,
        name: input.name,
        status: this.toPrismaConfigStatus(input.status),
        levelRules: {
          tierRank: input.tierRank,
          upgradeCondition: input.upgradeCondition
        },
        benefits: {
          benefitSummary: input.benefitSummary,
          orderDiscountPercent: input.orderDiscountPercent,
          depositDiscountPercent: input.depositDiscountPercent,
          freeServiceCount: input.freeServiceCount
        }
      }
    });

    return this.toMembershipPlanSummary(row);
  }

  async listCorporates(
    tenantId = this.defaultTenantId
  ): Promise<CorporateSummary[]> {
    const rows = await this.prisma.corporate.findMany({
      where: { tenantId },
      include: {
        contracts: true,
        monthlyBills: true
      },
      orderBy: [{ status: "asc" }, { shortName: "asc" }]
    });

    return rows.map((row) => this.toCorporateSummary(row));
  }

  async listCorporatePage(
    query: CorporateListQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<CorporateListResult> {
    const keyword = query.keyword?.trim();
    const status = this.normalizeCorporateStatusFilter(query.status);
    const where: Prisma.CorporateWhereInput = {
      tenantId,
      ...(status ? { status: this.toPrismaCorporateStatus(status) } : {}),
      ...(keyword
        ? {
            OR: [
              { shortName: { contains: keyword } },
              { fullName: { contains: keyword } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.corporate.findMany({
      where,
      include: {
        contracts: true,
        monthlyBills: true
      },
      orderBy: [{ status: "asc" }, { shortName: "asc" }]
    });

    return this.buildCorporateListResult(rows.map((row) => this.toCorporateSummary(row)), {
      ...query,
      keyword: undefined,
      status: undefined
    });
  }

  private buildCorporateListResult(
    rows: CorporateSummary[],
    query: CorporateListQuery = {}
  ): CorporateListResult {
    const contractStatus = this.normalizeCorporateContractStatusFilter(query.contractStatus);
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const filteredRows = contractStatus
      ? rows.filter((row) => row.contractStatus === contractStatus)
      : rows;
    const start = (page - 1) * pageSize;
    return {
      rows: filteredRows.slice(start, start + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      stats: {
        total: filteredRows.length,
        active: filteredRows.filter((row) => row.status === "active").length,
        paused: filteredRows.filter((row) => row.status === "paused").length,
        disabled: filteredRows.filter((row) => row.status === "disabled").length,
        expiringContracts: filteredRows.filter((row) => row.contractStatus === "expiring")
          .length,
        expiredContracts: filteredRows.filter((row) => row.contractStatus === "expired").length
      }
    };
  }

  async getCorporateDetail(id: string): Promise<CorporateDetail> {
    const row = await this.prisma.corporate.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { createdAt: "asc" } },
        contracts: { orderBy: { createdAt: "desc" } },
        orders: { orderBy: { createdAt: "desc" }, take: 10 },
        monthlyBills: true
      }
    });
    if (!row) {
      throw new NotFoundException(`Corporate ${id} was not found`);
    }

    return this.toCorporateDetail(row);
  }

  async appendCorporateContractAttachment(
    corporateId: string,
    contractId: string,
    fileName: string,
    tenantId = this.defaultTenantId
  ): Promise<CorporateDetail> {
    const contract = await this.prisma.corporateContract.findFirst({
      where: {
        id: contractId,
        corporateId,
        corporate: { tenantId }
      }
    });
    if (!contract) {
      throw new NotFoundException(`Corporate contract ${contractId} was not found`);
    }

    const attachments = this.stringArray(contract.attachments);
    const nextAttachments = Array.from(
      new Set([...attachments, fileName].map((item) => item.trim()).filter(Boolean))
    );
    await this.prisma.corporateContract.update({
      where: { id: contract.id },
      data: {
        attachments: nextAttachments as Prisma.InputJsonValue
      }
    });

    return this.getCorporateDetail(corporateId);
  }

  async saveCorporate(
    input: SaveCorporateRequest,
    tenantId = this.defaultTenantId
  ): Promise<CorporateDetail> {
    const duplicated = await this.prisma.corporate.findFirst({
      where: {
        tenantId,
        shortName: input.shortName,
        id: { not: input.id }
      }
    });
    if (duplicated) {
      throw new BadRequestException("企业简称已存在。");
    }

    const current = input.id
      ? await this.prisma.corporate.findUnique({ where: { id: input.id } })
      : undefined;
    const corporateId = current?.id ?? input.id ?? `corp_${cryptoRandomId()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.corporate.upsert({
        where: { id: corporateId },
        update: {
          tenantId,
          shortName: input.shortName,
          fullName: input.fullName,
          status: this.toPrismaCorporateStatus(input.status),
          creditLimitAmount: input.creditLimitAmount,
          creditWarningAmount: input.creditWarningAmount ?? 0,
          accountPeriodDays: input.accountPeriodDays,
          billingCycleDay: input.billingCycleDay,
          settlementMode: this.toPrismaSettlementMode(input.settlementMode),
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          billingEmail: input.billingEmail,
          statementEmail: input.statementEmail,
          reconciliationContactName: input.reconciliationContactName,
          reconciliationContactPhone: input.reconciliationContactPhone,
          autoGenerateStatement: input.autoGenerateStatement,
          invoiceTitle: input.invoiceTitle,
          linkedStores: input.linkedStores as Prisma.InputJsonValue,
          notes: input.notes
        },
        create: {
          id: corporateId,
          tenantId,
          shortName: input.shortName,
          fullName: input.fullName,
          status: this.toPrismaCorporateStatus(input.status),
          creditLimitAmount: input.creditLimitAmount,
          creditWarningAmount: input.creditWarningAmount ?? 0,
          accountPeriodDays: input.accountPeriodDays,
          billingCycleDay: input.billingCycleDay,
          settlementMode: this.toPrismaSettlementMode(input.settlementMode),
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          billingEmail: input.billingEmail,
          statementEmail: input.statementEmail,
          reconciliationContactName: input.reconciliationContactName,
          reconciliationContactPhone: input.reconciliationContactPhone,
          autoGenerateStatement: input.autoGenerateStatement,
          invoiceTitle: input.invoiceTitle,
          linkedStores: input.linkedStores as Prisma.InputJsonValue,
          notes: input.notes
        }
      });

      await tx.corporateContact.deleteMany({ where: { corporateId } });
      if ((input.contacts ?? []).length > 0) {
        await tx.corporateContact.createMany({
          data: input.contacts.map((contact) => ({
            id: contact.id || `corp_contact_${cryptoRandomId()}`,
            corporateId,
            name: contact.name,
            title: contact.title,
            phone: contact.phone,
            email: contact.email
          }))
        });
      }

      await tx.corporateContract.deleteMany({ where: { corporateId } });
      if ((input.contracts ?? []).length > 0) {
        await tx.corporateContract.createMany({
          data: input.contracts.map((contract) => ({
            id: contract.id || `corp_contract_${cryptoRandomId()}`,
            corporateId,
            contractNo: contract.contractNo,
            contractName: contract.contractName,
            status: contract.status,
            startDate: contract.startDate ? new Date(contract.startDate) : undefined,
            endDate: contract.endDate ? new Date(contract.endDate) : undefined,
            amount: contract.amount,
            linkedStores: contract.linkedStores as Prisma.InputJsonValue,
            statementEmail: contract.statementEmail,
            attachments: contract.attachments as Prisma.InputJsonValue,
            remark: contract.remark
          }))
        });
      }
    });

    return this.getCorporateDetail(corporateId);
  }

  async recordCorporateOrderCreated(id: string) {
    const corporate = await this.prisma.corporate.findUnique({ where: { id } });
    if (!corporate) {
      return;
    }

    await this.prisma.corporate.update({
      where: { id },
      data: {
        activeOrderCount: { increment: 1 },
        lastOrderAt: new Date()
      }
    });
  }

  async occupyCorporateQuota(corporateId: string, amount: number) {
    if (amount <= 0) {
      return;
    }

    await this.prisma.corporate.update({
      where: { id: corporateId },
      data: {
        reservedQuotaAmount: { increment: amount }
      }
    });
  }

  async releaseCorporateQuota(corporateId: string, amount: number) {
    if (amount <= 0) {
      return;
    }

    const corporate = await this.prisma.corporate.findUnique({ where: { id: corporateId } });
    if (!corporate) {
      return;
    }

    const currentReserved = Number(corporate.reservedQuotaAmount);
    const decrementBy = Math.min(currentReserved, amount);

    await this.prisma.corporate.update({
      where: { id: corporateId },
      data: {
        reservedQuotaAmount: { decrement: decrementBy }
      }
    });
  }

  async listOrders(
    filter: OrderFilter,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalOrderSummary[]> {
    const keyword = filter.keyword?.trim();
    const rows = await this.prisma.storeRentalOrder.findMany({
      where: {
        tenantId,
        ...(filter.status
          ? { mainStatus: this.toPrismaOrderMainStatus(filter.status as StoreRentalOrderSummary["mainStatus"]) }
          : {}),
        ...(keyword
          ? {
              OR: [
                { orderNo: { contains: keyword } },
                { customerName: { contains: keyword } },
                { corporateShortName: { contains: keyword } },
                { vehicleGroup: { name: { contains: keyword } } }
              ]
            }
          : {})
      },
      include: this.orderInclude(),
      orderBy: [{ pickupAt: "desc" }, { createdAt: "desc" }]
    });

    return rows.map((row) => this.toOrderSummary(row));
  }

  async countOrders(
    filter: OrderFilter,
    tenantId = this.defaultTenantId
  ): Promise<number> {
    const keyword = filter.keyword?.trim();
    return this.prisma.storeRentalOrder.count({
      where: {
        tenantId,
        ...(filter.status
          ? { mainStatus: this.toPrismaOrderMainStatus(filter.status as StoreRentalOrderSummary["mainStatus"]) }
          : {}),
        ...(keyword
          ? {
              OR: [
                { orderNo: { contains: keyword } },
                { customerName: { contains: keyword } },
                { corporateShortName: { contains: keyword } },
                { vehicleGroup: { name: { contains: keyword } } }
              ]
            }
          : {})
      }
    });
  }

  async getOrderDetail(id: string): Promise<StoreRentalOrderDetail> {
    const row = await this.prisma.storeRentalOrder.findUnique({
      where: { id },
      include: this.orderDetailInclude()
    });
    if (!row) {
      throw new NotFoundException(`Store rental order ${id} was not found`);
    }

    const detail = this.toOrderDetail(row);
    const fulfillment = await this.getOrderFulfillmentRecords(id);

    return {
      ...detail,
      ...fulfillment
    };
  }

  async getOrderFeeCenter(id: string): Promise<StoreRentalFeeCenter> {
    const detail = await this.getOrderDetail(id);

    return {
      orderId: detail.id,
      orderNo: detail.orderNo,
      feeLedgerItems: detail.feeLedgerItems,
      transactionRecords: detail.transactionRecords,
      financialOverview: detail.financialOverview
    };
  }

  async getOrderFulfillmentRecords(
    orderId: string
  ): Promise<StoreRentalOrderFulfillmentRecords> {
    const [
      contracts,
      notifications,
      remarks,
      operationLocks,
      idempotencyRecords
    ] = await Promise.all([
      this.listOrderContractRecords(orderId),
      this.listStoreRentalNotificationRecords(orderId),
      this.listOrderRemarkRecords(orderId),
      this.listOrderOperationLockRecords(orderId),
      this.listOrderIdempotencyRecords(orderId)
    ]);

    return {
      contracts,
      notifications,
      remarks,
      operationLocks,
      idempotencyRecords
    };
  }

  async listOrderContractCenter(
    query: StoreRentalContractCenterQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalContractCenter> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        d.id, d.orderId, d.documentNo, d.type, d.title, d.status, d.signMethod,
        d.signerName, d.signedAt, d.fileUrl, d.payload, d.operator, d.createdAt,
        o.orderNo, o.customerName, o.customerPhoneMasked, o.corporateShortName,
        o.vehicleGroupSnapshot, o.assignedVehicleSnapshot, o.pickupStoreSnapshot,
        o.returnStoreSnapshot, o.pickupAt, o.returnAt, o.billingMode, o.mainStatus,
        o.paymentStatus
      FROM OrderContractDocument d
      INNER JOIN StoreRentalOrder o ON o.id = d.orderId
      WHERE o.tenantId = ${tenantId}
      ORDER BY d.createdAt DESC
    `;

    const keyword = query.keyword?.trim().toLowerCase();
    const filteredRows = rows
      .map((row) => this.toContractCenterRow(row))
      .filter((row) => {
        const matchedKeyword =
          !keyword ||
          [
            row.documentNo,
            row.title,
            row.orderNo,
            row.customerName,
            row.corporateShortName,
            row.vehicleGroupName,
            row.plateNo
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(keyword));
        const matchedType = !query.type || row.type === query.type;
        const matchedStatus = !query.status || row.status === query.status;
        const matchedOrderStatus =
          !query.orderStatus || row.mainStatus === query.orderStatus;

        return matchedKeyword && matchedType && matchedStatus && matchedOrderStatus;
      });

    return {
      rows: filteredRows,
      stats: this.contractCenterStats(filteredRows),
      templates: this.contractTemplates()
    };
  }

  async printOrderContractMock(
    contractId: string,
    input: StoreRentalContractPrintRequest
  ): Promise<StoreRentalContractPrintResult> {
    const current = await this.findOrderContractRecord(contractId);
    const now = new Date();
    const mode = input.mode ?? "print";
    const downloadUrl =
      current.downloadUrl ||
      current.fileUrl ||
      `/mock/store-rental/contracts/${current.documentNo}.pdf`;
    const nextRecord: StoreRentalContractRecord = {
      ...current,
      printStatus: mode === "download" ? "downloaded" : "printed",
      printCount: (current.printCount ?? 0) + 1,
      lastPrintedAt: now.toISOString(),
      downloadUrl,
      externalProvider: "reserved",
      operator: input.operator || current.operator
    };

    await this.updateOrderContractRecord(contractId, nextRecord);
    const record = await this.findOrderContractRecord(contractId);

    return {
      record,
      printJobId: `mock_print_${randomUUID()}`,
      downloadUrl,
      skippedExternalCall: true,
      message:
        mode === "download"
          ? "PDF 下载已生成 mock 地址，真实打印/文件服务已自动跳过。"
          : "打印任务已记录，真实打印服务已自动跳过。"
    };
  }

  async signOrderContractMock(
    contractId: string,
    input: StoreRentalContractMockSignRequest
  ): Promise<StoreRentalContractMockSignResult> {
    const current = await this.findOrderContractRecord(contractId);
    const now = new Date();
    const nextRecord: StoreRentalContractRecord = {
      ...current,
      status: "signed",
      signMethod: input.signMethod || current.signMethod || "counter",
      signerName:
        input.signerName ||
        current.signerName ||
        this.stringValue(current.snapshot.customerName),
      signedAt: now.toISOString(),
      fileUrl: input.fileUrl || current.fileUrl,
      externalProvider: "reserved",
      externalSignStatus: "skipped",
      operator: input.operator || current.operator
    };

    await this.updateOrderContractRecord(contractId, nextRecord);
    const record = await this.findOrderContractRecord(contractId);

    return {
      record,
      skippedExternalCall: true,
      message: "签署状态已更新为 mock 已签署，真实电子签平台已自动跳过。"
    };
  }

  async createOrderContractRecord(
    orderId: string,
    input: CreateStoreRentalContractRequest
  ): Promise<StoreRentalContractRecord> {
    const now = new Date();
    const record: StoreRentalContractRecord = {
      id: `contract_${randomUUID()}`,
      documentNo: `DOC-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(
        Math.random() * 9000 + 1000
      )}`,
      type: input.type,
      title: input.title || this.contractTypeLabel(input.type),
      status: input.status || "signed",
      signMethod: input.signMethod || "counter",
      signerName: input.signerName,
      signedAt: input.signedAt,
      fileUrl: input.fileUrl,
      operator: input.operator || "营运端",
      createdAt: now.toISOString(),
      templateCode: input.templateCode || input.type,
      printStatus: input.printStatus || "not_generated",
      printCount: 0,
      downloadUrl: input.downloadUrl,
      externalProvider: "reserved",
      externalSignStatus: input.status === "signed" ? "skipped" : "pending",
      snapshot: input.snapshot ?? {}
    };

    await this.prisma.$executeRaw`
      INSERT INTO OrderContractDocument (
        id, orderId, documentNo, type, title, status, signMethod, signerName,
        signedAt, fileUrl, payload, operator, createdAt, updatedAt
      ) VALUES (
        ${record.id},
        ${orderId},
        ${record.documentNo},
        ${record.type},
        ${record.title},
        ${record.status},
        ${record.signMethod},
        ${record.signerName ?? null},
        ${record.signedAt ? new Date(record.signedAt) : null},
        ${record.fileUrl ?? null},
        ${JSON.stringify(this.contractPayload(record))},
        ${record.operator},
        ${now},
        ${now}
      )
    `;

    return record;
  }

  async createStoreRentalNotificationRecord(
    orderId: string,
    input: CreateStoreRentalNotificationRequest
  ): Promise<StoreRentalNotificationRecord> {
    const now = new Date();
    const [orderRow] = await this.prisma.$queryRaw<Array<{ tenantId: string; orderNo: string }>>`
      SELECT tenantId, orderNo
      FROM StoreRentalOrder
      WHERE id = ${orderId}
      LIMIT 1
    `;
    if (!orderRow) {
      throw new NotFoundException(`Order ${orderId} was not found`);
    }
    const sentAt =
      input.status === "skipped" || input.status === "failed"
        ? undefined
        : now.toISOString();
    const record: StoreRentalNotificationRecord = {
      id: `notice_${randomUUID()}`,
      scene: input.scene,
      channel: input.channel,
      target: input.target,
      status: input.status || "sent",
      content: input.content,
      idempotencyKey: input.idempotencyKey,
      operator: input.operator || "营运端",
      sentAt,
      createdAt: now.toISOString(),
      payload: input.payload ?? {}
    };

    await this.prisma.$executeRaw`
      INSERT INTO OrderNotificationRecord (
        id, tenantId, orderId, orderNo, event, eventLabel, channel, targetMasked,
        status, templateCode, contentSummary, operator, relatedAction,
        idempotencyKey, failReason, payload, sentAt, createdAt, updatedAt
      ) VALUES (
        ${record.id},
        ${orderRow.tenantId},
        ${orderId},
        ${orderRow.orderNo},
        ${record.scene},
        ${this.notificationSceneText(record.scene)},
        ${record.channel},
        ${record.target},
        ${record.status},
        ${"manual_notice"},
        ${record.content},
        ${record.operator},
        ${null},
        ${record.idempotencyKey ?? null},
        ${null},
        ${JSON.stringify({ ...(record.payload ?? {}), manualNotification: record })},
        ${record.sentAt ? new Date(record.sentAt) : null},
        ${now},
        ${now}
      )
    `;

    return record;
  }

  async createOrderRemarkRecord(
    orderId: string,
    input: CreateStoreRentalRemarkRequest
  ): Promise<StoreRentalOrderRemarkRecord> {
    const now = new Date();
    const record: StoreRentalOrderRemarkRecord = {
      id: `remark_${randomUUID()}`,
      category: input.category || "general",
      content: input.content,
      visibility: input.visibility || "internal",
      operator: input.operator || "营运端",
      followUpAt: input.followUpAt,
      reminderAt: input.reminderAt,
      responsibleUserId: input.responsibleUserId,
      responsibleName: input.responsibleName || input.operator || "营运端",
      status: input.status || "open",
      closedAt: input.status === "closed" ? now.toISOString() : undefined,
      closedBy: input.status === "closed" ? input.operator || "营运端" : undefined,
      createdAt: now.toISOString()
    };

    await this.prisma.$executeRaw`
      INSERT INTO OrderRemarkRecord (
        id, orderId, category, content, visibility, operator, followUpAt,
        reminderAt, responsibleUserId, responsibleName, status, closedAt,
        closedBy, closeNote, createdAt, updatedAt
      ) VALUES (
        ${record.id},
        ${orderId},
        ${record.category},
        ${record.content},
        ${record.visibility},
        ${record.operator},
        ${record.followUpAt ? new Date(record.followUpAt) : null},
        ${record.reminderAt ? new Date(record.reminderAt) : null},
        ${record.responsibleUserId ?? null},
        ${record.responsibleName ?? null},
        ${record.status},
        ${record.closedAt ? new Date(record.closedAt) : null},
        ${record.closedBy ?? null},
        ${record.closeNote ?? null},
        ${now},
        ${now}
      )
    `;

    return record;
  }

  async closeOrderRemarkRecord(
    orderId: string,
    remarkId: string,
    input: CloseStoreRentalRemarkRequest
  ): Promise<StoreRentalOrderRemarkRecord | undefined> {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE OrderRemarkRecord
      SET
        status = 'closed',
        closedAt = COALESCE(closedAt, ${now}),
        closedBy = ${input.operator || "营运端"},
        closeNote = ${input.closeNote ?? null},
        updatedAt = ${now}
      WHERE id = ${remarkId} AND orderId = ${orderId}
    `;

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, category, content, visibility, operator, followUpAt, reminderAt,
        responsibleUserId, responsibleName, status, closedAt, closedBy,
        closeNote, createdAt
      FROM OrderRemarkRecord
      WHERE id = ${remarkId} AND orderId = ${orderId}
      LIMIT 1
    `;

    return rows[0] ? this.toRemarkRecord(rows[0]) : undefined;
  }

  async createOrderOperationLockRecord(
    orderId: string,
    input: CreateStoreRentalOperationLockRequest
  ): Promise<StoreRentalOperationLockRecord> {
    const now = new Date();
    const status = input.status || OperationLockStatus.Active;
    const record: StoreRentalOperationLockRecord = {
      id: `lock_${randomUUID()}`,
      stage: input.stage,
      status,
      operator: input.operator || "营运端",
      startedAt: now.toISOString(),
      expiresAt: input.expiresAt,
      releasedAt: input.releasedAt,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {}
    };

    await this.prisma.$executeRaw`
      INSERT INTO OrderOperationLock (
        id, orderId, stage, status, operator, startedAt, expiresAt, releasedAt,
        idempotencyKey, payload, createdAt, updatedAt
      ) VALUES (
        ${record.id},
        ${orderId},
        ${record.stage},
        ${record.status},
        ${record.operator},
        ${now},
        ${record.expiresAt ? new Date(record.expiresAt) : null},
        ${record.releasedAt ? new Date(record.releasedAt) : null},
        ${record.idempotencyKey ?? null},
        ${JSON.stringify(record.payload)},
        ${now},
        ${now}
      )
    `;

    return record;
  }

  async findOrderIdempotencyRecord(
    orderId: string,
    action: string,
    key: string
  ): Promise<StoreRentalIdempotencyRecord | undefined> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, action, \`key\`, status, requestHash, responseSnapshot, createdAt, updatedAt
      FROM OrderIdempotencyRecord
      WHERE orderId = ${orderId} AND action = ${action} AND \`key\` = ${key}
      LIMIT 1
    `;

    return rows[0] ? this.toIdempotencyRecord(rows[0]) : undefined;
  }

  async saveOrderIdempotencyRecord(
    orderId: string,
    record: StoreRentalIdempotencyRecord
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO OrderIdempotencyRecord (
        id, orderId, action, \`key\`, status, requestHash, responseSnapshot, createdAt, updatedAt
      ) VALUES (
        ${record.id},
        ${orderId},
        ${record.action},
        ${record.key},
        ${record.status},
        ${record.requestHash ?? null},
        ${record.responseSnapshot ? JSON.stringify(record.responseSnapshot) : null},
        ${new Date(record.createdAt)},
        ${new Date(record.updatedAt)}
      )
      ON DUPLICATE KEY UPDATE
        status = ${record.status},
        requestHash = ${record.requestHash ?? null},
        responseSnapshot = ${record.responseSnapshot ? JSON.stringify(record.responseSnapshot) : null},
        updatedAt = ${new Date(record.updatedAt)}
    `;
  }

  private async listOrderContractRecords(
    orderId: string
  ): Promise<StoreRentalContractRecord[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, documentNo, type, title, status, signMethod, signerName,
        signedAt, fileUrl, payload, operator, createdAt
      FROM OrderContractDocument
      WHERE orderId = ${orderId}
      ORDER BY createdAt DESC
    `;

    return rows.map((row) => this.toContractRecord(row));
  }

  private async findOrderContractRecord(
    contractId: string
  ): Promise<StoreRentalContractRecord> {
    const [row] = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, documentNo, type, title, status, signMethod, signerName,
        signedAt, fileUrl, payload, operator, createdAt
      FROM OrderContractDocument
      WHERE id = ${contractId}
      LIMIT 1
    `;
    if (!row) {
      throw new NotFoundException(`Order contract document ${contractId} was not found`);
    }

    return this.toContractRecord(row);
  }

  private async updateOrderContractRecord(
    contractId: string,
    record: StoreRentalContractRecord
  ) {
    await this.prisma.$executeRaw`
      UPDATE OrderContractDocument
      SET
        status = ${record.status},
        signMethod = ${record.signMethod ?? null},
        signerName = ${record.signerName ?? null},
        signedAt = ${record.signedAt ? new Date(record.signedAt) : null},
        fileUrl = ${record.fileUrl ?? record.downloadUrl ?? null},
        payload = ${JSON.stringify(this.contractPayload(record))},
        operator = ${record.operator},
        updatedAt = ${new Date()}
      WHERE id = ${contractId}
    `;
  }

  private async listStoreRentalNotificationRecords(
    orderId: string
  ): Promise<StoreRentalNotificationRecord[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        event AS scene,
        channel,
        targetMasked AS target,
        status,
        contentSummary AS content,
        idempotencyKey,
        payload,
        operator,
        sentAt,
        createdAt
      FROM OrderNotificationRecord
      WHERE orderId = ${orderId}
      ORDER BY createdAt DESC
    `;

    return rows.map((row) => this.toNotificationRecord(row));
  }

  private async listOrderRemarkRecords(
    orderId: string
  ): Promise<StoreRentalOrderRemarkRecord[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, category, content, visibility, operator, followUpAt, reminderAt,
        responsibleUserId, responsibleName, status, closedAt, closedBy,
        closeNote, createdAt
      FROM OrderRemarkRecord
      WHERE orderId = ${orderId}
      ORDER BY createdAt DESC
    `;

    return rows.map((row) => this.toRemarkRecord(row));
  }

  private async listOrderOperationLockRecords(
    orderId: string
  ): Promise<StoreRentalOperationLockRecord[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, stage, status, operator, startedAt, expiresAt, releasedAt,
        idempotencyKey, payload
      FROM OrderOperationLock
      WHERE orderId = ${orderId}
      ORDER BY startedAt DESC
    `;

    return rows.map((row) => this.toOperationLockRecord(row));
  }

  private async listOrderIdempotencyRecords(
    orderId: string
  ): Promise<StoreRentalIdempotencyRecord[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, action, \`key\`, status, requestHash, responseSnapshot, createdAt, updatedAt
      FROM OrderIdempotencyRecord
      WHERE orderId = ${orderId}
      ORDER BY updatedAt DESC
    `;

    return rows.map((row) => this.toIdempotencyRecord(row));
  }

  async createOrder(input: SaveOrderInput, tenantId = this.defaultTenantId) {
    const vehicleGroup = await this.findVehicleGroupForOrder(
      input.vehicleGroupCode,
      input.order.vehicleGroupName,
      tenantId
    );
    const pickupStation = await this.findStationForOrder(
      input.pickupStoreCode,
      input.order.pickupStoreName,
      tenantId
    );
    const returnStation = await this.findStationForOrder(
      input.returnStoreCode,
      input.order.returnStoreName,
      tenantId
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.storeRentalOrder.create({
        data: {
          id: input.order.id,
          tenantId,
          orderNo: input.order.orderNo,
          mode: this.toPrismaStoreRentalMode(input.order.mode),
          mainStatus: this.toPrismaOrderMainStatus(input.order.mainStatus),
          dispatchStatus: this.toPrismaDispatchStatus(input.order.dispatchStatus),
          paymentStatus: this.toPrismaPaymentStatus(input.order.paymentStatus),
          billingMode: this.toPrismaBillingMode(input.order.billingMode),
          memberId: input.order.memberId,
          corporateId: input.order.corporateId,
          customerName: input.order.customerName,
          customerPhoneMasked: input.order.customerPhoneMasked,
          corporateShortName: input.order.corporateShortName,
          vehicleGroupId: vehicleGroup.id,
          vehicleGroupSnapshot:
            input.vehicleGroupSnapshot ??
            this.orderSnapshot({
              id: vehicleGroup.id,
              code: vehicleGroup.code,
              name: input.order.vehicleGroupName
            }),
          pickupStationId: pickupStation?.id,
          returnStationId: returnStation?.id,
          pickupStoreSnapshot:
            input.pickupStoreSnapshot ??
            this.orderSnapshot({
              code: input.pickupStoreCode,
              name: input.order.pickupStoreName
            }),
          returnStoreSnapshot:
            input.returnStoreSnapshot ??
            this.orderSnapshot({
              code: input.returnStoreCode,
              name: input.order.returnStoreName
            }),
          pickupAt: new Date(input.order.pickupAt),
          returnAt: new Date(input.order.returnAt),
          totalAmount: input.order.totalAmount,
          riskFlags: input.order.riskFlags as Prisma.InputJsonValue,
          pricingSnapshot: input.pricingSnapshot,
          marketingSnapshot: input.marketingSnapshot,
          termsSnapshot: this.termsSnapshot(input.order, input.termsSnapshot),
          settlementSummary: input.settlementSummary
            ? this.orderSnapshot(input.settlementSummary)
            : undefined
        }
      });

      if ((input.feeLedgerItems ?? []).length > 0) {
        await tx.feeItem.createMany({
          data: input.feeLedgerItems!.map((fee) =>
            this.toFeeItemCreateInput(input.order.id, fee)
          ),
          skipDuplicates: true
        });
      }

      if ((input.transactionRecords ?? []).length > 0) {
        await tx.transactionRecord.createMany({
          data: input.transactionRecords!.map((record) =>
            this.toTransactionCreateInput(input.order.id, record)
          ),
          skipDuplicates: true
        });
      }

      if ((input.timeline ?? []).length > 0) {
        await tx.orderTimelineEvent.createMany({
          data: input.timeline!.map((item) =>
            this.toTimelineCreateInput(input.order.id, item)
          )
        });
      }
    });

    for (const transaction of input.transactionRecords ?? []) {
      if (transaction.type === "monthly_bill" && transaction.status === "success") {
        await this.upsertMonthlyBillLine(input.order.id, transaction.amount);
      }
    }

    return this.getOrderDetail(input.order.id);
  }

  async updateOrderState(
    order: StoreRentalOrderSummary,
    settlementSummary?: StoreRentalSettlementSummary
  ) {
    const assignedVehicle = order.plateNo
      ? await this.prisma.vehicle.findFirst({ where: { plateNo: order.plateNo } })
      : undefined;
    const vehicleGroupId = assignedVehicle?.vehicleGroupId;
    const returnStation = await this.findStationForOrder(
      undefined,
      order.returnStationName ?? order.returnStoreName,
      this.defaultTenantId
    );

    await this.prisma.storeRentalOrder.update({
      where: { id: order.id },
      data: {
        mainStatus: this.toPrismaOrderMainStatus(order.mainStatus),
        dispatchStatus: this.toPrismaDispatchStatus(order.dispatchStatus),
        paymentStatus: this.toPrismaPaymentStatus(order.paymentStatus),
        billingMode: this.toPrismaBillingMode(order.billingMode),
        ...(vehicleGroupId
          ? {
              vehicleGroupId,
              vehicleGroupSnapshot: this.orderSnapshot({
                id: vehicleGroupId,
                name: order.vehicleGroupName
              })
            }
          : {}),
        assignedVehicleId: order.plateNo ? assignedVehicle?.id ?? null : null,
        assignedVehicleSnapshot: assignedVehicle
          ? this.orderSnapshot({
              id: assignedVehicle.id,
              plateNo: assignedVehicle.plateNo,
              vin: assignedVehicle.vin
            })
          : Prisma.JsonNull,
        returnStationId: returnStation?.id ?? null,
        returnStoreSnapshot: this.orderSnapshot({
          name: order.returnStoreName,
          stationName: order.returnStationName
        }),
        pickupAt: new Date(order.pickupAt),
        returnAt: new Date(order.returnAt),
        totalAmount: order.totalAmount,
        riskFlags: order.riskFlags as Prisma.InputJsonValue,
        termsSnapshot: this.termsSnapshot(order),
        settlementSummary: settlementSummary
          ? this.orderSnapshot(settlementSummary)
          : undefined
      }
    });
  }

  async upsertOrderFeeItem(orderId: string, fee: StoreRentalFeeLedgerItem) {
    await this.prisma.feeItem.upsert({
      where: { id: fee.id },
      update: this.toFeeItemUpdateInput(fee),
      create: this.toFeeItemCreateInput(orderId, fee)
    });

    return this.getOrderFeeCenter(orderId);
  }

  async updateOrderFeeStatus(
    orderId: string,
    feeId: string,
    status: StoreRentalFeeLedgerItem["status"]
  ) {
    await this.prisma.feeItem.update({
      where: { id: feeId },
      data: {
        status: this.toPrismaFeeStatus(status)
      }
    });

    return this.getOrderFeeCenter(orderId);
  }

  async hasExpiredPreAuthorization(orderId: string): Promise<boolean> {
    const now = new Date();
    const count = await this.prisma.financePreAuthorization.count({
      where: {
        orderId,
        status: PrismaFinancePreAuthorizationStatus.FROZEN,
        expiresAt: { lt: now }
      }
    });
    return count > 0;
  }

  async createOrderTransaction(
    orderId: string,
    record: StoreRentalTransactionRecord
  ) {
    await this.prisma.transactionRecord.upsert({
      where: { id: record.id },
      update: this.toTransactionUpdateInput(record),
      create: this.toTransactionCreateInput(orderId, record)
    });

    if (record.type === "monthly_bill" && record.status === "success") {
      await this.upsertMonthlyBillLine(orderId, record.amount);
    }

    return this.getOrderFeeCenter(orderId);
  }

  async findVehicleScheduleConflict(
    orderId: string,
    plateNo: string | undefined,
    from: Date,
    to: Date,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalOrderSummary | undefined> {
    if (!plateNo || plateNo === "待人工派车") {
      return undefined;
    }

    const row = await this.prisma.storeRentalOrder.findFirst({
      where: {
        tenantId,
        id: { not: orderId },
        assignedVehicle: { plateNo },
        mainStatus: {
          in: [
            PrismaOrderMainStatus.RESERVED,
            PrismaOrderMainStatus.PICKUP_OVERDUE,
            PrismaOrderMainStatus.INSPECTING,
            PrismaOrderMainStatus.RENTING,
            PrismaOrderMainStatus.RENEWING,
            PrismaOrderMainStatus.OVERDUE,
            PrismaOrderMainStatus.ACCIDENT_PROCESSING
          ]
        },
        pickupAt: { lt: to },
        returnAt: { gt: from }
      },
      include: this.orderInclude(),
      orderBy: { pickupAt: "asc" }
    });

    return row ? this.toOrderSummary(row) : undefined;
  }

  async saveExtensionSnapshot(
    orderId: string,
    input: SaveExtensionSnapshotInput
  ) {
    await this.prisma.orderExtensionSnapshot.upsert({
      where: {
        orderId_snapshotRef: {
          orderId,
          snapshotRef: input.snapshotRef
        }
      },
      update: {
        oldReturnAt: new Date(input.oldReturnAt),
        newReturnAt: new Date(input.newReturnAt),
        extensionHours: input.extensionHours,
        billableDays: input.billableDays,
        amount: input.amount,
        settlementMode: input.settlementMode,
        ruleSnapshot: input.ruleSnapshot,
        pricingSnapshot: input.pricingSnapshot,
        operator: input.operator
      },
      create: {
        id: input.id,
        orderId,
        snapshotRef: input.snapshotRef,
        oldReturnAt: new Date(input.oldReturnAt),
        newReturnAt: new Date(input.newReturnAt),
        extensionHours: input.extensionHours,
        billableDays: input.billableDays,
        amount: input.amount,
        settlementMode: input.settlementMode,
        ruleSnapshot: input.ruleSnapshot,
        pricingSnapshot: input.pricingSnapshot,
        operator: input.operator
      }
    });
  }

  async saveOrderEventSnapshot(
    orderId: string,
    input: SaveOrderEventSnapshotInput
  ) {
    await this.prisma.orderEventSnapshot.upsert({
      where: {
        orderId_snapshotRef: {
          orderId,
          snapshotRef: input.snapshotRef
        }
      },
      update: {
        eventType: input.eventType,
        title: input.title,
        triggerReason: input.triggerReason,
        settlementTarget: input.settlementTarget,
        amount: input.amount,
        beforeJson: input.before,
        afterJson: input.after,
        amountJson: input.amountBreakdown,
        payload: input.payload,
        operator: input.operator,
        occurredAt: new Date(input.occurredAt)
      },
      create: {
        id: input.id,
        orderId,
        snapshotRef: input.snapshotRef,
        eventType: input.eventType,
        title: input.title,
        triggerReason: input.triggerReason,
        settlementTarget: input.settlementTarget,
        amount: input.amount,
        beforeJson: input.before,
        afterJson: input.after,
        amountJson: input.amountBreakdown,
        payload: input.payload,
        operator: input.operator,
        occurredAt: new Date(input.occurredAt)
      }
    });
  }

  async updateVehicleOperationStatusByPlate(
    plateNo: string | undefined,
    status: VehicleInstanceSummary["operationStatus"],
    input: { operator?: string; reason?: string; action?: string } = {}
  ) {
    if (!plateNo || plateNo === "待人工派车") {
      return;
    }

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { plateNo },
      include: this.vehicleInclude()
    });
    if (!vehicle) {
      return;
    }

    const metadata = {
      ...this.objectMetadata(vehicle.metadata),
      lastOperationAt: new Date().toISOString(),
      lastOperationBy: input.operator || "营运端",
      operationReason: input.reason
    };

    const row = await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        ...(status === "disabled" ? { enabled: false } : {}),
        operationStatus: this.toPrismaOperationStatus(status),
        status,
        metadata: this.orderSnapshot(metadata)
      },
      include: this.vehicleInclude()
    });

    await this.appendVehicleOperationLog(this.toVehicleSummary(row), {
      operator: input.operator || "营运端",
      action: input.action || "订单释放车辆资源",
      reason: input.reason
    });
  }

  async appendOrderTimeline(orderId: string, item: StoreRentalOrderTimelineItem) {
    await this.prisma.orderTimelineEvent.create({
      data: this.toTimelineCreateInput(orderId, item)
    });
  }

  async createDispatchEvent(
    event: StoreRentalDispatchEvent,
    tenantId = this.defaultTenantId
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO DispatchEvent (
        id,
        tenantId,
        orderId,
        eventType,
        source,
        title,
        orderNo,
        planId,
        beforeVehicle,
        targetVehicle,
        reasonCode,
        reasonText,
        riskLevel,
        operator,
        payload,
        createdAt
      ) VALUES (
        ${event.id},
        ${tenantId},
        ${event.orderId ?? null},
        ${event.eventType},
        ${event.source},
        ${event.title},
        ${event.orderNo ?? null},
        ${event.planId ?? null},
        ${event.beforeVehicle ?? null},
        ${event.targetVehicle ?? null},
        ${event.reasonCode ?? null},
        ${event.reasonText ?? null},
        ${event.riskLevel},
        ${event.operator ?? null},
        ${event.payload ? JSON.stringify(event.payload) : null},
        ${new Date(event.createdAt)}
      )
    `;
  }

  async listDispatchEvents(
    query: StoreRentalDispatchEventQuery = {},
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalDispatchEvent[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const conditions = [Prisma.sql`tenantId = ${tenantId}`];
    if (query.orderId) {
      conditions.push(Prisma.sql`orderId = ${query.orderId}`);
    }
    if (query.planId) {
      conditions.push(Prisma.sql`planId = ${query.planId}`);
    }
    if (query.eventType) {
      conditions.push(Prisma.sql`eventType = ${query.eventType}`);
    }
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        eventType: string;
        source: string;
        title: string;
        orderId: string | null;
        orderNo: string | null;
        planId: string | null;
        beforeVehicle: string | null;
        targetVehicle: string | null;
        reasonCode: string | null;
        reasonText: string | null;
        riskLevel: string;
        operator: string | null;
        payload: Prisma.JsonValue | null;
        createdAt: Date;
      }>
    >(
      Prisma.sql`
        SELECT
          id,
          eventType,
          source,
          title,
          orderId,
          orderNo,
          planId,
          beforeVehicle,
          targetVehicle,
          reasonCode,
          reasonText,
          riskLevel,
          operator,
          payload,
          createdAt
        FROM DispatchEvent
        WHERE ${Prisma.join(conditions, " AND ")}
        ORDER BY createdAt DESC
        LIMIT ${limit}
      `
    );

    return rows.map((row) => this.toDispatchEvent(row));
  }

  async createOrderOperationRecord(
    record: StoreRentalOrderOperationRecord,
    tenantId = this.defaultTenantId
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO OrderOperationRecord (
        id,
        tenantId,
        orderId,
        orderNo,
        action,
        actionLabel,
        status,
        idempotencyKey,
        requestHash,
        lockStatus,
        operator,
        message,
        payload,
        expiresAt,
        completedAt,
        createdAt
      ) VALUES (
        ${record.id},
        ${tenantId},
        ${record.orderId},
        ${record.orderNo},
        ${record.action},
        ${record.actionLabel},
        ${record.status},
        ${record.idempotencyKey ?? null},
        ${record.requestHash},
        ${record.lockStatus ?? null},
        ${record.operator ?? null},
        ${record.message ?? null},
        ${record.payload ? JSON.stringify(record.payload) : null},
        ${record.expiresAt ? new Date(record.expiresAt) : null},
        ${record.completedAt ? new Date(record.completedAt) : null},
        ${new Date(record.createdAt)}
      )
    `;
  }

  async updateOrderOperationRecord(
    record: StoreRentalOrderOperationRecord,
    tenantId = this.defaultTenantId
  ) {
    await this.prisma.$executeRaw`
      UPDATE OrderOperationRecord
      SET
        status = ${record.status},
        lockStatus = ${record.lockStatus ?? null},
        message = ${record.message ?? null},
        payload = ${record.payload ? JSON.stringify(record.payload) : null},
        expiresAt = ${record.expiresAt ? new Date(record.expiresAt) : null},
        completedAt = ${record.completedAt ? new Date(record.completedAt) : null}
      WHERE tenantId = ${tenantId} AND id = ${record.id}
    `;
  }

  async findCompletedOrderOperationRecord(
    input: {
      orderId: string;
      action: string;
      idempotencyKey?: string;
      requestHash?: string;
    },
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalOrderOperationRecord | undefined> {
    const conditions = [
      Prisma.sql`tenantId = ${tenantId}`,
      Prisma.sql`orderId = ${input.orderId}`,
      Prisma.sql`action = ${input.action}`,
      Prisma.sql`status = 'completed'`
    ];
    if (input.idempotencyKey) {
      conditions.push(Prisma.sql`idempotencyKey = ${input.idempotencyKey}`);
    } else if (input.requestHash) {
      conditions.push(Prisma.sql`requestHash = ${input.requestHash}`);
    } else {
      return undefined;
    }

    const rows = await this.prisma.$queryRaw<Array<any>>(
      Prisma.sql`
        SELECT
          id,
          orderId,
          orderNo,
          action,
          actionLabel,
          status,
          idempotencyKey,
          requestHash,
          lockStatus,
          operator,
          message,
          payload,
          expiresAt,
          completedAt,
          createdAt
        FROM OrderOperationRecord
        WHERE ${Prisma.join(conditions, " AND ")}
        ORDER BY createdAt DESC
        LIMIT 1
      `
    );

    return rows[0] ? this.toOrderOperationRecord(rows[0]) : undefined;
  }

  async listOrderOperationRecords(
    orderId: string,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalOrderOperationRecord[]> {
    const rows = await this.prisma.$queryRaw<Array<any>>`
      SELECT
        id,
        orderId,
        orderNo,
        action,
        actionLabel,
        status,
        idempotencyKey,
        requestHash,
        lockStatus,
        operator,
        message,
        payload,
        expiresAt,
        completedAt,
        createdAt
      FROM OrderOperationRecord
      WHERE tenantId = ${tenantId} AND orderId = ${orderId}
      ORDER BY createdAt DESC
      LIMIT 80
    `;

    return rows.map((row) => this.toOrderOperationRecord(row));
  }

  async createOrderNotificationRecord(
    record: StoreRentalOrderNotificationRecord,
    tenantId = this.defaultTenantId
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO OrderNotificationRecord (
        id,
        tenantId,
        orderId,
        orderNo,
        event,
        eventLabel,
        channel,
        targetMasked,
        status,
        templateCode,
        contentSummary,
        operator,
        relatedAction,
        idempotencyKey,
        failReason,
        payload,
        sentAt,
        createdAt
      ) VALUES (
        ${record.id},
        ${tenantId},
        ${record.orderId},
        ${record.orderNo},
        ${record.event},
        ${record.eventLabel},
        ${record.channel},
        ${record.targetMasked},
        ${record.status},
        ${record.templateCode},
        ${record.contentSummary},
        ${record.operator ?? null},
        ${record.relatedAction ?? null},
        ${record.idempotencyKey ?? null},
        ${record.failReason ?? null},
        ${record.payload ? JSON.stringify(record.payload) : null},
        ${record.sentAt ? new Date(record.sentAt) : null},
        ${new Date(record.createdAt)}
      )
    `;
  }

  async listOrderNotificationRecords(
    orderId: string,
    tenantId = this.defaultTenantId
  ): Promise<StoreRentalOrderNotificationRecord[]> {
    const rows = await this.prisma.$queryRaw<Array<any>>`
      SELECT
        id,
        orderId,
        orderNo,
        event,
        eventLabel,
        channel,
        targetMasked,
        status,
        templateCode,
        contentSummary,
        operator,
        relatedAction,
        idempotencyKey,
        failReason,
        payload,
        sentAt,
        createdAt
      FROM OrderNotificationRecord
      WHERE tenantId = ${tenantId} AND orderId = ${orderId}
      ORDER BY createdAt DESC
      LIMIT 80
    `;

    return rows.map((row) => this.toOrderNotificationRecord(row));
  }

  async appendInspectionRecord(orderId: string, record: StoreRentalInspectionRecord) {
    await this.prisma.orderInspectionRecord.create({
      data: {
        id: record.id,
        orderId,
        stage: record.stage,
        operator: record.operator,
        plateNo: record.plateNo,
        mileage: record.mileage,
        fuelLevelPercent: record.fuelLevelPercent,
        batteryLevelPercent: record.batteryLevelPercent,
        cleanliness: record.cleanliness,
        damageFound: record.damageFound,
        damageDescription: record.damageDescription,
        missingItems: record.missingItems,
        photoCount: record.photoCount,
        customerSigned: record.customerSigned,
        payload: this.orderSnapshot(record),
        createdAt: new Date(record.at)
      }
    });
  }

  async saveSettlementSummary(
    orderId: string,
    settlementSummary: StoreRentalSettlementSummary
  ) {
    await this.prisma.storeRentalOrder.update({
      where: { id: orderId },
      data: {
        settlementSummary: this.orderSnapshot(settlementSummary)
      }
    });
  }

  async listCorporateMonthlyBills(
    corporateId: string
  ): Promise<CorporateMonthlyBillSummary[]> {
    const rows = await this.prisma.corporateMonthlyBill.findMany({
      where: { corporateId },
      include: {
        corporate: true,
        lineItems: { orderBy: { createdAt: "asc" } },
        settlements: { orderBy: { createdAt: "asc" } }
      },
      orderBy: { period: "desc" }
    });

    return rows.map((row) => this.toCorporateMonthlyBillSummary(row));
  }

  async settleCorporateMonthlyBill(
    billId: string,
    amount: number,
    input: { channel?: string; operator?: string; note?: string }
  ) {
    const bill = await this.prisma.corporateMonthlyBill.findUnique({
      where: { id: billId }
    });
    if (!bill) {
      throw new NotFoundException(`Monthly bill ${billId} was not found`);
    }

    const paidAmount = Math.min(Number(bill.totalAmount), Number(bill.paidAmount) + amount);
    const balanceAmount = Math.max(0, Number(bill.totalAmount) - paidAmount);

    await this.prisma.$transaction([
      this.prisma.corporateMonthlyBillSettlement.create({
        data: {
          billId,
          amount,
          channel: input.channel || "offline",
          operator: input.operator || "营运财务",
          note: input.note
        }
      }),
      this.prisma.corporateMonthlyBill.update({
        where: { id: billId },
        data: {
          paidAmount,
          balanceAmount,
          status:
            balanceAmount <= 0
              ? PrismaMonthlyBillStatus.PAID
              : PrismaMonthlyBillStatus.PARTIALLY_PAID
        }
      })
    ]);

    const summary = (await this.listCorporateMonthlyBills(bill.corporateId)).find(
      (item) => item.id === billId
    );
    if (!summary) {
      throw new NotFoundException(`Monthly bill ${billId} was not found`);
    }
    return summary;
  }

  async getFinanceOverview(
    tenantId = this.defaultTenantId
  ): Promise<FinanceOverviewMetrics> {
    const [transactions, monthlyBills, documents, adjustments, preAuthorizations] = await Promise.all([
      this.prisma.transactionRecord.findMany({
        where: { order: { tenantId } }
      }),
      this.prisma.corporateMonthlyBill.findMany({ where: { tenantId } }),
      this.prisma.financeDocument.findMany({ where: { tenantId } }),
      this.prisma.financeManualAdjustment.findMany({ where: { tenantId } }),
      this.prisma.financePreAuthorization.findMany({ where: { tenantId } })
    ]);

    const successfulTransactions = transactions.filter(
      (item) => item.status === "success"
    );
    const customerReceivedAmount = successfulTransactions
      .filter((item) => item.type === "payment" || item.type === "pre_auth_capture")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const preAuthOrderIds = new Set(
      preAuthorizations
        .map((item) => item.orderId)
        .filter((orderId): orderId is string => Boolean(orderId))
    );
    const preAuthRows = [
      ...preAuthorizations.map((item) => this.toFinancePreAuthorizationRow(item)),
      ...this.buildFinancePreAuthorizationRowsFromTransactions(
        successfulTransactions.filter(
          (item) =>
            item.type === "pre_auth_freeze" ||
            item.type === "pre_auth_release" ||
            item.type === "pre_auth_capture"
        )
      ).filter((item) => !item.orderId || !preAuthOrderIds.has(item.orderId))
    ];
    const refundAmount = successfulTransactions
      .filter((item) => item.type === "refund")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return {
      customerReceivedAmount,
      preAuthFrozenAmount: preAuthRows
        .filter(
          (item) =>
            item.status === "frozen" ||
            item.status === "partially_captured" ||
            item.status === "pending"
        )
        .reduce((sum, item) => sum + item.remainingAmount, 0),
      refundAmount,
      monthlyBillingAmount: monthlyBills.reduce(
        (sum, item) => sum + Number(item.totalAmount),
        0
      ),
      monthlyUnpaidAmount: monthlyBills.reduce(
        (sum, item) => sum + Number(item.balanceAmount),
        0
      ),
      invoiceIssuedAmount: documents
        .filter(
          (item) =>
            item.type === PrismaFinanceDocumentType.INVOICE &&
            item.status !== PrismaFinanceDocumentStatus.VOIDED
        )
        .reduce((sum, item) => sum + Number(item.amount), 0),
      pendingAdjustmentAmount: adjustments
        .filter((item) => item.status === PrismaFinanceManualAdjustmentStatus.PENDING)
        .reduce((sum, item) => sum + Number(item.amount), 0),
      exceptionCount:
        transactions.filter((item) => item.status === "failed").length +
        monthlyBills.filter(
          (item) =>
            item.status !== PrismaMonthlyBillStatus.PAID &&
            item.dueDate.getTime() < Date.now()
        ).length +
        adjustments.filter(
          (item) => item.status === PrismaFinanceManualAdjustmentStatus.REJECTED
        ).length
    };
  }

  async listFinanceTransactions(
    tenantId = this.defaultTenantId
  ): Promise<FinanceTransactionRow[]> {
    const rows = await this.prisma.transactionRecord.findMany({
      where: { order: { tenantId } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    return rows.map((row) => this.toFinanceTransactionRow(row));
  }

  async listFinanceDocuments(
    tenantId = this.defaultTenantId
  ): Promise<FinanceDocumentRow[]> {
    const rows = await this.prisma.financeDocument.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "desc" }, { documentNo: "desc" }],
      take: 200
    });
    return rows.map((row) => this.toFinanceDocumentRow(row));
  }

  async saveFinanceDocument(
    input: SaveFinanceDocumentRequest,
    tenantId = this.defaultTenantId
  ): Promise<FinanceDocumentRow> {
    const amount = Number(input.amount || 0);
    if (amount <= 0) {
      throw new BadRequestException("单据金额必须大于 0。");
    }

    const order = input.orderId
      ? await this.prisma.storeRentalOrder.findUnique({ where: { id: input.orderId } })
      : input.orderNo
        ? await this.prisma.storeRentalOrder.findFirst({
            where: { tenantId, orderNo: input.orderNo }
          })
        : undefined;
    const documentNo =
      input.documentNo?.trim() ||
      `${input.type === "receipt" ? "RCT" : "INV"}${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "")}${cryptoRandomId().slice(0, 4).toUpperCase()}`;
    const id = input.id ?? `finance_doc_${cryptoRandomId()}`;
    const current = input.id
      ? await this.prisma.financeDocument.findUnique({ where: { id: input.id } })
      : undefined;
    const originalDocument = input.originalDocumentId
      ? await this.prisma.financeDocument.findUnique({
          where: { id: input.originalDocumentId }
        })
      : input.originalDocumentNo
        ? await this.prisma.financeDocument.findFirst({
            where: { tenantId, documentNo: input.originalDocumentNo }
          })
        : undefined;
    const now = new Date();
    const relatedFeeIds = Array.from(new Set(this.stringArray(input.relatedFeeIds)));
    const operator = input.createdBy || "营运财务";
    const voidReason =
      input.status === "voided"
        ? input.voidReason || input.remark
        : input.voidReason || undefined;
    const auditTrail = this.appendFinanceDocumentAuditTrail(
      current?.auditTrail ?? input.auditTrail,
      {
        at: now.toISOString(),
        operator,
        action: originalDocument
          ? "reissued"
          : input.status === "voided"
            ? "voided"
            : input.status === "sent"
              ? "sent"
              : input.status === "issued"
                ? "issued"
                : current
                  ? "updated"
                  : "created",
        remark:
          voidReason ||
          input.remark ||
          (originalDocument ? `重开自 ${originalDocument.documentNo}` : undefined),
        relatedDocumentNo: originalDocument?.documentNo ?? undefined,
        relatedFeeIds
      }
    );

    const row = await this.prisma.financeDocument.upsert({
      where: { id },
      update: {
        documentNo,
        type: this.toPrismaFinanceDocumentType(input.type),
        status: this.toPrismaFinanceDocumentStatus(input.status),
        orderId: input.orderId ?? order?.id,
        orderNo: input.orderNo ?? order?.orderNo,
        memberId: input.memberId ?? order?.memberId,
        corporateId: input.corporateId ?? order?.corporateId,
        corporateShortName:
          input.corporateShortName ?? order?.corporateShortName ?? undefined,
        monthlyBillId: input.monthlyBillId,
        customerName: input.customerName || order?.customerName || "",
        title: input.title,
        taxNo: input.taxNo,
        email: input.email,
        amount,
        issueSource: input.issueSource || "manual",
        relatedFeeIds: relatedFeeIds as Prisma.InputJsonValue,
        originalDocumentId: input.originalDocumentId ?? originalDocument?.id,
        originalDocumentNo: input.originalDocumentNo ?? originalDocument?.documentNo,
        replacementDocumentId: input.replacementDocumentId,
        replacementDocumentNo: input.replacementDocumentNo,
        issuedAt:
          input.status === "issued" || input.status === "sent"
            ? input.issuedAt
              ? new Date(input.issuedAt)
              : now
            : undefined,
        voidedAt: input.status === "voided" ? now : undefined,
        voidReason,
        voidedBy: input.status === "voided" ? input.voidedBy || operator : undefined,
        reissuedAt: originalDocument
          ? now
          : input.reissuedAt
            ? new Date(input.reissuedAt)
            : undefined,
        createdBy: operator,
        remark: input.remark,
        auditTrail: auditTrail as unknown as Prisma.InputJsonValue,
        metadata: this.metadata({
          rentalObjectType: "vehicle",
          source: input.issueSource || "manual",
          relatedFeeIds,
          originalDocumentNo: input.originalDocumentNo ?? originalDocument?.documentNo
        }) as Prisma.InputJsonValue
      },
      create: {
        id,
        tenantId,
        documentNo,
        type: this.toPrismaFinanceDocumentType(input.type),
        status: this.toPrismaFinanceDocumentStatus(input.status),
        orderId: input.orderId ?? order?.id,
        orderNo: input.orderNo ?? order?.orderNo,
        memberId: input.memberId ?? order?.memberId,
        corporateId: input.corporateId ?? order?.corporateId,
        corporateShortName:
          input.corporateShortName ?? order?.corporateShortName ?? undefined,
        monthlyBillId: input.monthlyBillId,
        customerName: input.customerName || order?.customerName || "",
        title: input.title,
        taxNo: input.taxNo,
        email: input.email,
        amount,
        issueSource: input.issueSource || "manual",
        relatedFeeIds: relatedFeeIds as Prisma.InputJsonValue,
        originalDocumentId: input.originalDocumentId ?? originalDocument?.id,
        originalDocumentNo: input.originalDocumentNo ?? originalDocument?.documentNo,
        replacementDocumentId: input.replacementDocumentId,
        replacementDocumentNo: input.replacementDocumentNo,
        issuedAt:
          input.status === "issued" || input.status === "sent"
            ? input.issuedAt
              ? new Date(input.issuedAt)
              : now
            : undefined,
        voidedAt: input.status === "voided" ? now : undefined,
        voidReason,
        voidedBy: input.status === "voided" ? input.voidedBy || operator : undefined,
        reissuedAt: originalDocument
          ? now
          : input.reissuedAt
            ? new Date(input.reissuedAt)
            : undefined,
        createdBy: operator,
        remark: input.remark,
        auditTrail: auditTrail as unknown as Prisma.InputJsonValue,
        metadata: this.metadata({
          rentalObjectType: "vehicle",
          source: input.issueSource || "manual",
          relatedFeeIds,
          originalDocumentNo: input.originalDocumentNo ?? originalDocument?.documentNo
        }) as Prisma.InputJsonValue
      }
    });

    if (originalDocument && originalDocument.id !== row.id) {
      const originalVoidReason =
        input.voidReason || input.remark || `重开为 ${row.documentNo}`;
      await this.prisma.financeDocument.update({
        where: { id: originalDocument.id },
        data: {
          status: PrismaFinanceDocumentStatus.VOIDED,
          voidedAt: originalDocument.voidedAt ?? now,
          voidReason: originalVoidReason,
          voidedBy: input.voidedBy || operator,
          replacementDocumentId: row.id,
          replacementDocumentNo: row.documentNo,
          reissuedAt: now,
          auditTrail: this.appendFinanceDocumentAuditTrail(
            originalDocument.auditTrail,
            {
              at: now.toISOString(),
              operator,
              action: "voided",
              remark: originalVoidReason,
              relatedDocumentNo: row.documentNo,
              relatedFeeIds: this.stringArray(originalDocument.relatedFeeIds)
            }
          ) as unknown as Prisma.InputJsonValue
        }
      });
    }

    // OR-17: 发票状态回写费用项
    if (relatedFeeIds.length > 0) {
      const invoicedStatus =
        input.status === "voided" ? "invoice_voided" : "invoiced";
      await this.prisma.feeItem.updateMany({
        where: { id: { in: relatedFeeIds }, orderId: order?.id ?? "" },
        data: { invoicedStatus }
      });
    }

    // OR-17: 发票审计日志
    await this.createOperationLog({
      targetType: "finance_document",
      targetId: row.id,
      action: row.type === "RECEIPT" ? "收据操作" : "发票操作",
      operator,
      detail: `${originalDocument ? "重开" : input.status === "voided" ? "作废" : input.status === "sent" ? "寄送" : input.status === "issued" ? "开具" : "保存"}${row.type === "RECEIPT" ? "收据" : "发票"} ${documentNo}，金额 ${amount}，关联订单 ${order?.orderNo ?? "无"}`,
      createdAt: now.toISOString()
    });

    return this.toFinanceDocumentRow(row);
  }

  async listFinancePreAuthorizations(
    tenantId = this.defaultTenantId
  ): Promise<FinancePreAuthorizationRow[]> {
    const [explicitRows, transactionRows] = await Promise.all([
      this.prisma.financePreAuthorization.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: "desc" }, { preAuthNo: "desc" }],
        take: 200
      }),
      this.prisma.transactionRecord.findMany({
        where: {
          order: { tenantId },
          type: { in: ["pre_auth_freeze", "pre_auth_release", "pre_auth_capture"] }
        },
        include: { order: true },
        orderBy: { createdAt: "desc" },
        take: 500
      })
    ]);

    const explicitRowsByOrderId = new Set(
      explicitRows
        .map((row) => row.orderId)
        .filter((orderId): orderId is string => Boolean(orderId))
    );
    const derivedRows = this.buildFinancePreAuthorizationRowsFromTransactions(
      transactionRows
    ).filter((row) => !row.orderId || !explicitRowsByOrderId.has(row.orderId));

    return [...explicitRows.map((row) => this.toFinancePreAuthorizationRow(row)), ...derivedRows]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 200);
  }

  async saveFinancePreAuthorization(
    input: SaveFinancePreAuthorizationRequest,
    tenantId = this.defaultTenantId
  ): Promise<FinancePreAuthorizationRow> {
    const authorizedAmount = Number(input.authorizedAmount || 0);
    const capturedAmount = Number(input.capturedAmount || 0);
    const releasedAmount = Number(input.releasedAmount || 0);
    if (authorizedAmount <= 0) {
      throw new BadRequestException("预授权金额必须大于 0。");
    }
    if (capturedAmount < 0 || releasedAmount < 0) {
      throw new BadRequestException("扣款和释放金额不能小于 0。");
    }
    if (capturedAmount + releasedAmount > authorizedAmount) {
      throw new BadRequestException("扣款和释放金额不能超过预授权金额。");
    }

    const order = input.orderId
      ? await this.prisma.storeRentalOrder.findUnique({ where: { id: input.orderId } })
      : input.orderNo
        ? await this.prisma.storeRentalOrder.findFirst({
            where: { tenantId, orderNo: input.orderNo }
          })
        : undefined;
    const id = input.id ?? `finance_preauth_${cryptoRandomId()}`;
    const preAuthNo =
      input.preAuthNo?.trim() ||
      `PA${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${cryptoRandomId()
        .slice(0, 4)
        .toUpperCase()}`;
    const status = this.toPrismaFinancePreAuthorizationStatus(input.status);
    const remainingAmount = Math.max(0, authorizedAmount - capturedAmount - releasedAmount);
    const now = new Date();
    const row = await this.prisma.financePreAuthorization.upsert({
      where: { id },
      update: {
        preAuthNo,
        orderId: input.orderId ?? order?.id,
        orderNo: input.orderNo ?? order?.orderNo,
        memberId: input.memberId ?? order?.memberId,
        corporateId: input.corporateId ?? order?.corporateId,
        corporateShortName:
          input.corporateShortName ?? order?.corporateShortName ?? undefined,
        customerName: input.customerName ?? order?.customerName,
        status,
        channel: this.toPrismaFinancePreAuthorizationChannel(input.channel),
        provider: input.provider?.trim() || "mock_payment",
        authorizedAmount,
        capturedAmount,
        releasedAmount,
        remainingAmount,
        currency: input.currency || "CNY",
        authCode: input.authCode,
        channelReferenceNo: input.channelReferenceNo,
        paymentMethod: input.paymentMethod,
        frozenAt:
          input.frozenAt
            ? new Date(input.frozenAt)
            : status !== PrismaFinancePreAuthorizationStatus.PENDING
              ? now
              : undefined,
        capturedAt:
          input.capturedAt
            ? new Date(input.capturedAt)
            : capturedAmount > 0
              ? now
              : undefined,
        releasedAt:
          input.releasedAt
            ? new Date(input.releasedAt)
            : releasedAmount > 0 || status === PrismaFinancePreAuthorizationStatus.RELEASED
              ? now
              : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        operator: input.operator,
        remark: input.remark,
        metadata: this.metadata({
          rentalObjectType: "vehicle",
          source: "finance_center"
        }) as Prisma.InputJsonValue
      },
      create: {
        id,
        tenantId,
        preAuthNo,
        orderId: input.orderId ?? order?.id,
        orderNo: input.orderNo ?? order?.orderNo,
        memberId: input.memberId ?? order?.memberId,
        corporateId: input.corporateId ?? order?.corporateId,
        corporateShortName:
          input.corporateShortName ?? order?.corporateShortName ?? undefined,
        customerName: input.customerName ?? order?.customerName,
        status,
        channel: this.toPrismaFinancePreAuthorizationChannel(input.channel),
        provider: input.provider?.trim() || "mock_payment",
        authorizedAmount,
        capturedAmount,
        releasedAmount,
        remainingAmount,
        currency: input.currency || "CNY",
        authCode: input.authCode,
        channelReferenceNo: input.channelReferenceNo,
        paymentMethod: input.paymentMethod,
        frozenAt:
          input.frozenAt
            ? new Date(input.frozenAt)
            : status !== PrismaFinancePreAuthorizationStatus.PENDING
              ? now
              : undefined,
        capturedAt:
          input.capturedAt
            ? new Date(input.capturedAt)
            : capturedAmount > 0
              ? now
              : undefined,
        releasedAt:
          input.releasedAt
            ? new Date(input.releasedAt)
            : releasedAmount > 0 || status === PrismaFinancePreAuthorizationStatus.RELEASED
              ? now
              : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        operator: input.operator,
        remark: input.remark,
        metadata: this.metadata({
          rentalObjectType: "vehicle",
          source: "finance_center"
        }) as Prisma.InputJsonValue
      }
    });

    return this.toFinancePreAuthorizationRow(row);
  }

  async listFinanceManualAdjustments(
    tenantId = this.defaultTenantId
  ): Promise<FinanceManualAdjustmentRow[]> {
    const rows = await this.prisma.financeManualAdjustment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return rows.map((row) => this.toFinanceManualAdjustmentRow(row));
  }

  async createFinanceManualAdjustment(
    input: SaveFinanceManualAdjustmentRequest,
    tenantId = this.defaultTenantId
  ): Promise<FinanceManualAdjustmentRow> {
    const amount = Number(input.amount || 0);
    if (amount <= 0) {
      throw new BadRequestException("调账金额必须大于 0。");
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException("调账原因不能为空。");
    }

    const order = input.orderId
      ? await this.prisma.storeRentalOrder.findUnique({
          where: { id: input.orderId },
          include: { corporate: true }
        })
      : input.orderNo
        ? await this.prisma.storeRentalOrder.findFirst({
            where: { tenantId, orderNo: input.orderNo },
            include: { corporate: true }
          })
        : undefined;
    const corporate =
      input.corporateId && !order?.corporateId
        ? await this.prisma.corporate.findUnique({ where: { id: input.corporateId } })
        : undefined;
    const id = `finance_adj_${cryptoRandomId()}`;
    const adjustmentNo = `ADJ${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}${cryptoRandomId().slice(0, 4).toUpperCase()}`;

    const row = await this.prisma.financeManualAdjustment.create({
      data: {
        id,
        tenantId,
        adjustmentNo,
        orderId: input.orderId ?? order?.id,
        orderNo: input.orderNo ?? order?.orderNo,
        memberId: input.memberId ?? order?.memberId,
        corporateId: input.corporateId ?? order?.corporateId,
        corporateShortName:
          input.corporateShortName ??
          order?.corporateShortName ??
          corporate?.shortName,
        customerName: input.customerName ?? order?.customerName,
        category: input.category,
        direction: this.toPrismaFinanceAdjustmentDirection(input.direction),
        targetBillingMode: this.toPrismaBillingMode(input.targetBillingMode),
        amount,
        reason: input.reason.trim(),
        operator: input.operator?.trim() || "营运财务"
      }
    });

    return this.toFinanceManualAdjustmentRow(row);
  }

  async processFinanceManualAdjustment(
    id: string,
    input: ProcessFinanceManualAdjustmentRequest
  ): Promise<FinanceManualAdjustmentRow> {
    const current = await this.prisma.financeManualAdjustment.findUnique({
      where: { id }
    });
    if (!current) {
      throw new NotFoundException(`Finance adjustment ${id} was not found`);
    }
    if (current.status === PrismaFinanceManualAdjustmentStatus.POSTED) {
      return this.toFinanceManualAdjustmentRow(current);
    }

    if (input.action === "reject") {
      const row = await this.prisma.financeManualAdjustment.update({
        where: { id },
        data: {
          status: PrismaFinanceManualAdjustmentStatus.REJECTED,
          approvedBy: input.operator || "营运财务",
          approvalRemark: input.remark
        }
      });
      return this.toFinanceManualAdjustmentRow(row);
    }

    const feeId = `fee_adj_${current.id}`;
    const transactionId = `txn_adj_${current.id}`;
    const isMonthly = current.targetBillingMode === PrismaBillingMode.MONTHLY;
    const direction = this.toSharedFinanceAdjustmentDirection(current.direction);
    const amount = Number(current.amount);
    const order = current.orderId
      ? await this.prisma.storeRentalOrder.findUnique({
          where: { id: current.orderId },
          include: { corporate: true, vehicleGroup: true, pickupStation: true, returnStation: true }
        })
      : undefined;

    if (current.orderId && !order) {
      throw new NotFoundException(`Order ${current.orderId} was not found`);
    }

    if (order) {
      await this.prisma.feeItem.upsert({
        where: { id: feeId },
        update: {
          amount,
          settledAmount:
            direction === "waiver" || isMonthly ? amount : 0,
          pendingAmount:
            direction === "waiver" || isMonthly ? 0 : amount,
          status:
            direction === "waiver"
              ? PrismaFeeStatus.WAIVED
              : isMonthly
                ? PrismaFeeStatus.MONTHLY_BILLING
                : PrismaFeeStatus.PENDING,
          description: current.reason
        },
        create: {
          id: feeId,
          orderId: order.id,
          code: `manual_${current.category}`,
          name: `手工调账-${current.category}`,
          stage: PrismaFeeStage.POST_CHARGE,
          direction:
            direction === "refund"
              ? PrismaFeeDirection.REFUND
              : direction === "waiver"
                ? PrismaFeeDirection.WAIVER
                : PrismaFeeDirection.CHARGE,
          status:
            direction === "waiver"
              ? PrismaFeeStatus.WAIVED
              : isMonthly
                ? PrismaFeeStatus.MONTHLY_BILLING
                : PrismaFeeStatus.PENDING,
          amount,
          settledAmount:
            direction === "waiver" || isMonthly ? amount : 0,
          pendingAmount:
            direction === "waiver" || isMonthly ? 0 : amount,
          source: "manual",
          description: current.reason,
          snapshotRef: current.adjustmentNo,
          ruleSnapshot: this.metadata({
            originalStage: "post_charge",
            adjustmentNo: current.adjustmentNo,
            rentalObjectType: "vehicle"
          }) as Prisma.InputJsonValue
        }
      });

      if (isMonthly || direction === "waiver") {
        await this.prisma.transactionRecord.upsert({
          where: { id: transactionId },
          update: {
            type: isMonthly ? "monthly_bill" : "waiver",
            status: "success",
            amount,
            channel: "internal",
            operator: input.operator || "营运财务",
            relatedFeeIds: [feeId] as Prisma.InputJsonValue,
            note: input.remark || current.reason
          },
          create: {
            id: transactionId,
            orderId: order.id,
            type: isMonthly ? "monthly_bill" : "waiver",
            status: "success",
            amount,
            channel: "internal",
            operator: input.operator || "营运财务",
            relatedFeeIds: [feeId] as Prisma.InputJsonValue,
            note: input.remark || current.reason
          }
        });
      }
    }

    if (isMonthly && (order?.corporateId || current.corporateId)) {
      await this.upsertCorporateMonthlyBillLine({
        tenantId: current.tenantId,
        corporateId: order?.corporateId ?? current.corporateId ?? "",
        lineId: `bill_line_${current.id}`,
        orderId: order?.id,
        orderNo: order?.orderNo ?? current.orderNo ?? current.adjustmentNo,
        customerName: order?.customerName ?? current.customerName ?? "手工调账",
        vehicleGroupName: order
          ? this.stringValue(this.objectMetadata(order.vehicleGroupSnapshot).name) ||
            order.vehicleGroup.name
          : "手工调账",
        pickupStoreName: order
          ? this.stringValue(this.objectMetadata(order.pickupStoreSnapshot).name) ||
            order.pickupStation?.parentStoreName ||
            ""
          : "-",
        returnStoreName: order
          ? this.stringValue(this.objectMetadata(order.returnStoreSnapshot).name) ||
            order.returnStation?.parentStoreName ||
            ""
          : "-",
        amount,
        remark: `手工调账：${current.reason}`
      });
    }

    const row = await this.prisma.financeManualAdjustment.update({
      where: { id },
      data: {
        status:
          order || isMonthly
            ? PrismaFinanceManualAdjustmentStatus.POSTED
            : PrismaFinanceManualAdjustmentStatus.APPROVED,
        approvedBy: input.operator || "营运财务",
        approvalRemark: input.remark,
        postedFeeId: order ? feeId : undefined,
        postedTransactionId: isMonthly || direction === "waiver" ? transactionId : undefined,
        postedAt: order || isMonthly ? new Date() : undefined
      }
    });

    return this.toFinanceManualAdjustmentRow(row);
  }

  async listFinanceReconciliationRows(
    tenantId = this.defaultTenantId
  ): Promise<FinanceReconciliationRow[]> {
    const [transactions, monthlyBills, adjustments] = await Promise.all([
      this.prisma.transactionRecord.findMany({
        where: { order: { tenantId } },
        include: { order: true },
        orderBy: { createdAt: "desc" },
        take: 120
      }),
      this.prisma.corporateMonthlyBill.findMany({
        where: { tenantId },
        include: { corporate: true },
        orderBy: { dueDate: "desc" },
        take: 80
      }),
      this.prisma.financeManualAdjustment.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 80
      })
    ]);

    return [
      ...transactions.map((row) => this.toFinanceReconciliationFromTransaction(row)),
      ...monthlyBills.map((row) => this.toFinanceReconciliationFromMonthlyBill(row)),
      ...adjustments.map((row) => this.toFinanceReconciliationFromAdjustment(row))
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async listVehicleLocationEvents(vehicleId: string): Promise<VehicleLocationEvent[]> {
    const rows = await this.prisma.vehicleLocationEvent.findMany({
      where: { vehicleId },
      orderBy: { occurredAt: "desc" },
      take: 120
    });

    return rows.map((row) => ({
      id: row.id,
      at: row.occurredAt.toISOString(),
      type: this.toLocationEventType(row.type),
      storeName: row.storeName,
      stationName: row.stationName,
      mileage: row.mileage,
      operator: row.operator ?? "营运端",
      source: this.toLocationEventSource(row.source),
      note: row.note ?? undefined
    }));
  }

  async createVehicleLocationEvent(
    vehicleId: string,
    record: VehicleLocationEvent
  ): Promise<VehicleLocationEvent> {
    const row = await this.prisma.vehicleLocationEvent.create({
      data: {
        id: record.id,
        vehicleId,
        type: record.type,
        occurredAt: new Date(record.at),
        storeName: record.storeName,
        stationName: record.stationName,
        mileage: record.mileage,
        source: record.source,
        operator: record.operator,
        note: record.note
      }
    });

    return {
      ...record,
      id: row.id,
      at: row.occurredAt.toISOString()
    };
  }

  async updateVehicleLocationEvent(
    vehicleId: string,
    record: VehicleLocationEvent
  ): Promise<VehicleLocationEvent> {
    const row = await this.prisma.vehicleLocationEvent.findFirst({
      where: { id: record.id, vehicleId }
    });
    if (!row) {
      throw new NotFoundException(`Vehicle location event ${record.id} was not found`);
    }

    const saved = await this.prisma.vehicleLocationEvent.update({
      where: { id: record.id },
      data: {
        type: record.type,
        occurredAt: new Date(record.at),
        storeName: record.storeName,
        stationName: record.stationName,
        mileage: record.mileage,
        source: record.source,
        operator: record.operator,
        note: record.note
      }
    });

    return {
      ...record,
      at: saved.occurredAt.toISOString()
    };
  }

  async listVehicleConditionPhotos(
    vehicleId: string
  ): Promise<VehicleConditionPhotoRecord[]> {
    const rows = await this.prisma.vehicleConditionPhotoRecord.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      scene: this.toConditionPhotoScene(row.scene),
      operator: row.operator ?? "营运端",
      remark: row.remark,
      photos: this.stringArray(row.photos)
    }));
  }

  async createVehicleConditionPhotoRecord(
    vehicleId: string,
    record: VehicleConditionPhotoRecord
  ): Promise<VehicleConditionPhotoRecord> {
    const row = await this.prisma.vehicleConditionPhotoRecord.create({
      data: {
        id: record.id,
        vehicleId,
        scene: record.scene,
        remark: record.remark,
        photos: record.photos as Prisma.InputJsonValue,
        operator: record.operator,
        createdAt: new Date(record.at)
      }
    });

    return {
      ...record,
      id: row.id,
      at: row.createdAt.toISOString()
    };
  }

  async listVehicleMaintenanceRecords(
    vehicleId: string
  ): Promise<VehicleMaintenanceRecord[]> {
    const rows = await this.prisma.vehicleMaintenanceRecord.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toVehicleMaintenanceRecord(row));
  }

  async createVehicleMaintenanceRecord(
    vehicleId: string,
    record: VehicleMaintenanceRecord,
    operator: string
  ): Promise<VehicleMaintenanceRecord> {
    const row = await this.prisma.vehicleMaintenanceRecord.create({
      data: {
        id: record.id,
        vehicleId,
        type: record.type,
        vendor: record.vendor,
        mileage: record.mileage,
        costAmount: record.costAmount,
        status: record.status,
        nextDueAt: record.nextDueAt ? new Date(`${record.nextDueAt}T00:00:00.000Z`) : undefined,
        nextDueMileage: record.nextDueMileage,
        attachments: (record.attachments ?? []) as Prisma.InputJsonValue,
        remark: record.remark,
        operator,
        createdAt: new Date(`${record.date}T00:00:00.000Z`)
      }
    });

    return this.toVehicleMaintenanceRecord(row);
  }

  async updateVehicleMaintenanceRecord(
    vehicleId: string,
    record: VehicleMaintenanceRecord,
    operator: string
  ): Promise<VehicleMaintenanceRecord> {
    const row = await this.prisma.vehicleMaintenanceRecord.findFirst({
      where: { id: record.id, vehicleId }
    });
    if (!row) {
      throw new NotFoundException(`Vehicle maintenance record ${record.id} was not found`);
    }

    const saved = await this.prisma.vehicleMaintenanceRecord.update({
      where: { id: record.id },
      data: {
        type: record.type,
        vendor: record.vendor,
        mileage: record.mileage,
        costAmount: record.costAmount,
        status: record.status,
        nextDueAt: record.nextDueAt ? new Date(`${record.nextDueAt}T00:00:00.000Z`) : undefined,
        nextDueMileage: record.nextDueMileage,
        attachments: (record.attachments ?? []) as Prisma.InputJsonValue,
        remark: record.remark,
        operator,
        createdAt: new Date(`${record.date}T00:00:00.000Z`)
      }
    });

    return this.toVehicleMaintenanceRecord(saved);
  }

  async listVehicleAccidentRecords(
    vehicleId: string
  ): Promise<VehicleAccidentRecord[]> {
    const rows = await this.prisma.vehicleAccidentRecord.findMany({
      where: { vehicleId },
      orderBy: { createdAt: "desc" },
      take: 80
    });

    return rows.map((row) => this.toVehicleAccidentRecord(row));
  }

  async createVehicleAccidentRecord(
    vehicleId: string,
    record: VehicleAccidentRecord,
    operator: string
  ): Promise<VehicleAccidentRecord> {
    const row = await this.prisma.vehicleAccidentRecord.create({
      data: {
        id: record.id,
        vehicleId,
        description: record.description,
        claimStatus: record.claimStatus,
        estimatedCostAmount: record.estimatedCostAmount,
        reportNo: record.reportNo,
        operator,
        createdAt: new Date(`${record.date}T00:00:00.000Z`)
      }
    });

    return this.toVehicleAccidentRecord(row);
  }

  async updateVehicleAccidentRecord(
    vehicleId: string,
    record: VehicleAccidentRecord,
    operator: string
  ): Promise<VehicleAccidentRecord> {
    const row = await this.prisma.vehicleAccidentRecord.findFirst({
      where: { id: record.id, vehicleId }
    });
    if (!row) {
      throw new NotFoundException(`Vehicle accident record ${record.id} was not found`);
    }

    const saved = await this.prisma.vehicleAccidentRecord.update({
      where: { id: record.id },
      data: {
        description: record.description,
        claimStatus: record.claimStatus,
        estimatedCostAmount: record.estimatedCostAmount,
        reportNo: record.reportNo,
        operator,
        createdAt: new Date(`${record.date}T00:00:00.000Z`)
      }
    });

    return this.toVehicleAccidentRecord(saved);
  }

  async appendVehicleOperationLog(
    vehicle: VehicleInstanceSummary,
    input: Omit<VehicleOperationLog, "id" | "at">
  ) {
    const row = await this.prisma.vehicle.findUnique({
      where: { id: vehicle.id },
      select: { tenantId: true }
    });
    if (!row) {
      throw new NotFoundException(`Vehicle ${vehicle.id} was not found`);
    }

    await this.prisma.operationLog.create({
      data: {
        tenantId: row.tenantId,
        action: input.action,
        detail: {
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          operator: input.operator,
          reason: input.reason
        }
      }
    });
  }

  async listVehicleOperationLogs(
    vehicle: VehicleInstanceSummary
  ): Promise<VehicleOperationLog[]> {
    const row = await this.prisma.vehicle.findUnique({
      where: { id: vehicle.id },
      select: { tenantId: true }
    });
    if (!row) {
      return [];
    }

    const logs = await this.prisma.operationLog.findMany({
      where: { tenantId: row.tenantId },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    const result: VehicleOperationLog[] = [];
    for (const log of logs) {
      const detail = this.objectMetadata(log.detail);
      if (this.stringValue(detail.vehicleId) !== vehicle.id) {
        continue;
      }
      result.push({
        id: log.id,
        at: log.createdAt.toISOString(),
        operator: this.stringValue(detail.operator) || "营运端",
        action: log.action,
        reason: this.stringValue(detail.reason)
      });
    }

    return result;
  }

  private vehicleInclude() {
    return {
      currentStation: true,
      store: true,
      vehicleGroup: true
    } as const;
  }

  private async findStationForVehicle(stationName: string, tenantId: string) {
    return this.prisma.storeStation.findFirst({
      where: {
        tenantId,
        name: stationName
      }
    });
  }

  private async findVehicleGroupForVehicle(vehicleGroupName: string, tenantId: string) {
    const groups = await this.prisma.vehicleGroup.findMany({ where: { tenantId } });

    return groups.find((group) => {
      const mapped = this.toVehicleGroupMaster(group);
      const displayName = this.vehicleGroupDisplayName(mapped);
      return (
        vehicleGroupName === group.name ||
        vehicleGroupName === displayName ||
        vehicleGroupName.includes(mapped.storeProductGroupName) ||
        vehicleGroupName.includes(mapped.brand) ||
        vehicleGroupName.includes(mapped.model)
      );
    });
  }

  private transferTaskItems(items: Prisma.JsonValue): VehicleTransferTask["items"] {
    return Array.isArray(items) ? (items as unknown as VehicleTransferTask["items"]) : [];
  }

  private async listActiveVehicleOrderNosByVehicle(
    vehicleIds: string[],
    tenantId = this.defaultTenantId
  ) {
    if (vehicleIds.length === 0) {
      return new Map<string, string[]>();
    }

    const rows = await this.prisma.storeRentalOrder.findMany({
      where: {
        tenantId,
        assignedVehicleId: { in: vehicleIds },
        mainStatus: {
          in: [
            PrismaOrderMainStatus.INSPECTING,
            PrismaOrderMainStatus.RENTING,
            PrismaOrderMainStatus.RENEWING,
            PrismaOrderMainStatus.OVERDUE,
            PrismaOrderMainStatus.ACCIDENT_PROCESSING,
            PrismaOrderMainStatus.SETTLEMENT_PENDING,
            PrismaOrderMainStatus.PAYMENT_DUE,
            PrismaOrderMainStatus.REFUND_PENDING
          ]
        }
      },
      select: {
        assignedVehicleId: true,
        orderNo: true
      }
    });

    const orderNosByVehicle = new Map<string, string[]>();
    rows.forEach((row) => {
      if (!row.assignedVehicleId) {
        return;
      }
      const orderNos = orderNosByVehicle.get(row.assignedVehicleId) ?? [];
      orderNos.push(row.orderNo);
      orderNosByVehicle.set(row.assignedVehicleId, orderNos);
    });
    return orderNosByVehicle;
  }

  private async listVehiclesByIds(
    ids: string[],
    tenantId = this.defaultTenantId
  ): Promise<VehicleInstanceSummary[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prisma.vehicle.findMany({
      where: { tenantId, id: { in: ids } },
      include: this.vehicleInclude()
    });

    return rows.map((row) => this.toVehicleSummary(row));
  }

  private async updateVehicleForTransferControl(
    id: string,
    input: { operator: string; reason: string; action: string }
  ): Promise<VehicleInstanceSummary> {
    const row = await this.prisma.vehicle.findUnique({
      where: { id },
      include: this.vehicleInclude()
    });
    if (!row) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }
    const metadata = {
      ...this.objectMetadata(row.metadata),
      lastOperationAt: new Date().toISOString(),
      lastOperationBy: input.operator,
      operationReason: input.reason,
      maintenanceReason: "车辆调拨管控"
    };
    const saved = await this.prisma.vehicle.update({
      where: { id },
      data: {
        operationStatus: this.toPrismaOperationStatus("controlled"),
        status: "controlled",
        metadata: this.orderSnapshot(metadata)
      },
      include: this.vehicleInclude()
    });
    const vehicle = this.toVehicleSummary(saved);
    await this.appendVehicleOperationLog(vehicle, {
      operator: input.operator,
      action: input.action,
      reason: input.reason
    });

    return vehicle;
  }

  private async restoreVehicleFromTransferControl(
    id: string,
    input: { operator: string; reason: string }
  ): Promise<VehicleInstanceSummary> {
    const row = await this.prisma.vehicle.findUnique({
      where: { id },
      include: this.vehicleInclude()
    });
    if (!row) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }
    const metadata = {
      ...this.objectMetadata(row.metadata),
      lastOperationAt: new Date().toISOString(),
      lastOperationBy: input.operator,
      operationReason: input.reason,
      maintenanceReason: ""
    };
    const saved = await this.prisma.vehicle.update({
      where: { id },
      data: {
        operationStatus: row.enabled
          ? this.toPrismaOperationStatus("idle")
          : this.toPrismaOperationStatus("disabled"),
        status: row.enabled ? "idle" : "disabled",
        metadata: this.orderSnapshot(metadata)
      },
      include: this.vehicleInclude()
    });
    const vehicle = this.toVehicleSummary(saved);
    await this.appendVehicleOperationLog(vehicle, {
      operator: input.operator,
      action: "取消调拨并恢复车辆状态",
      reason: input.reason
    });

    return vehicle;
  }

  private toVehicleTransferTask(row: any): VehicleTransferTask {
    return {
      id: row.id,
      taskNo: row.taskNo,
      status:
        row.status === "pending" ||
        row.status === "approved" ||
        row.status === "departed" ||
        row.status === "arrived" ||
        row.status === "cancelled"
          ? row.status
          : "completed",
      sourceStoreName: row.sourceStoreName,
      sourceStationName: row.sourceStationName,
      targetStoreName: row.targetStoreName,
      targetStationName: row.targetStationName,
      targetServiceType: this.toSharedServiceType(row.targetServiceType),
      vehicleCount: row.vehicleCount,
      reason: row.reason ?? undefined,
      operator: row.operator ?? "营运端",
      items: Array.isArray(row.items) ? row.items : [],
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString(),
      departedAt: row.departedAt?.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString(),
      cancelReason: row.cancelReason ?? undefined,
      completedAt: row.completedAt?.toISOString()
    };
  }

  private toVehicleStatusChangeRecord(row: any): VehicleStatusChangeRecord {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      at: row.createdAt.toISOString(),
      operator: row.operator ?? "营运端",
      fromEnabled: row.fromEnabled,
      toEnabled: row.toEnabled,
      fromOperationStatus: this.toSharedOperationStatus(row.fromOperationStatus),
      toOperationStatus: this.toSharedOperationStatus(row.toOperationStatus),
      reason: row.reason ?? undefined,
      impactedOrderCount: row.impactedOrderCount,
      impactedOrderNos: this.stringArray(row.impactedOrderNos)
    };
  }

  private toVehicleAttachmentRecord(row: any): VehicleAttachmentRecord {
    const category = ([
      "vehicle_photo",
      "license",
      "insurance",
      "inspection",
      "maintenance",
      "other"
    ].includes(row.category)
      ? row.category
      : "other") as VehicleAttachmentRecord["category"];

    return {
      id: row.id,
      vehicleId: row.vehicleId,
      category,
      name: row.name,
      url: row.url,
      source: row.source === "reserved_adapter" ? "reserved_adapter" : "manual",
      operator: row.operator ?? "营运端",
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toVehicleCredentialRecord(row: any): VehicleCredentialRecord {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      credentialType: this.toCredentialType(row.credentialType),
      credentialName: row.credentialName,
      certNo: row.certNo,
      status: this.toCredentialStatus(row.status),
      issueAt: row.issueAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      reminderDays: row.reminderDays,
      attachments: this.stringArray(row.attachments),
      operator: row.operator ?? "营运端",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toVehicleOnboardItemRecord(row: any): VehicleOnboardItemRecord {
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      category: this.toOnboardItemCategory(row.category),
      itemName: row.itemName,
      standardQuantity: row.standardQuantity,
      actualQuantity: row.actualQuantity,
      status: this.toOnboardItemStatus(row.status),
      priceAmount: Number(row.priceAmount),
      checkedAt: row.checkedAt.toISOString(),
      operator: row.operator ?? "营运端",
      remark: row.remark ?? undefined
    };
  }

  private toTboxDeviceSummary(row: any): TboxDeviceSummary {
    const boundVehicle = row.boundVehicle ? this.toVehicleSummary(row.boundVehicle) : undefined;
    return {
      id: row.id,
      cid: row.cid,
      provider: row.provider,
      modelNo: row.modelNo,
      status:
        row.status === "inactive" || row.status === "fault" ? row.status : "active",
      onlineStatus:
        row.onlineStatus === "online" || row.onlineStatus === "offline"
          ? row.onlineStatus
          : "unknown",
      boundVehicleId: boundVehicle?.id,
      boundPlateNo: boundVehicle?.licensePlate,
      boundVehicleGroupName: boundVehicle?.vehicleGroupName,
      currentStationName: boundVehicle?.currentStationName,
      batteryLevel: row.batteryLevel ?? undefined,
      signalStrength: row.signalStrength ?? undefined,
      lastHeartbeatAt: row.lastHeartbeatAt?.toISOString()
    };
  }

  private toTboxCommandRecord(row: any, cid: string): TboxCommandRecord {
    return {
      id: row.id,
      deviceId: row.deviceId,
      cid,
      vehiclePlateNo: row.vehiclePlateNo ?? undefined,
      command: this.toTboxCommand(row.command),
      status:
        row.status === "pending" || row.status === "failed" ? row.status : "success",
      operator: row.operator ?? "营运端",
      note: this.stringValue(this.objectMetadata(row.responsePayload).message),
      createdAt: row.createdAt.toISOString()
    };
  }

  private toStationCalendarDay(row: any): StationCalendarDay {
    return {
      id: row.id,
      stationId: row.stationId,
      stationName: row.station?.name ?? "",
      date: row.date.toISOString().slice(0, 10),
      businessStatus: this.toStationBusinessStatus(row.businessStatus),
      openTime: row.openTime,
      closeTime: row.closeTime,
      capacityLimit: row.capacityLimit ?? undefined,
      note: row.note ?? undefined,
      operator: row.operator ?? "营运端",
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toStationCapacitySnapshot(row: any): StationCapacitySnapshot {
    return {
      id: row.id,
      stationId: row.stationId,
      stationName: row.station?.name ?? "",
      date: row.date.toISOString().slice(0, 10),
      totalSpaces: row.totalSpaces,
      capacityLimit: row.capacityLimit ?? undefined,
      availableSpaces: row.availableSpaces,
      reservedSpaces: row.reservedSpaces,
      occupiedVehicles: row.occupiedVehicles,
      controlledVehicles: row.controlledVehicles ?? 0,
      maintenanceVehicles: row.maintenanceVehicles ?? 0,
      disabledVehicles: row.disabledVehicles ?? 0,
      rentingVehicles: row.rentingVehicles ?? 0,
      pendingPickupVehicles: row.pendingPickupVehicles,
      pendingReturnVehicles: row.pendingReturnVehicles,
      pickupQueueVehicles: row.pickupQueueVehicles ?? row.pendingPickupVehicles ?? 0,
      returnQueueVehicles: row.returnQueueVehicles ?? row.pendingReturnVehicles ?? 0,
      queueVehicles:
        row.queueVehicles ??
        (row.pickupQueueVehicles ?? row.pendingPickupVehicles ?? 0) +
          (row.returnQueueVehicles ?? row.pendingReturnVehicles ?? 0),
      turnoverBufferMinutes: row.turnoverBufferMinutes ?? 60,
      estimatedWaitMinutes: row.estimatedWaitMinutes ?? 0,
      pressureLevel: this.toStationCapacityPressureLevel(row.pressureLevel),
      pressureReason: row.pressureReason ?? undefined,
      businessStatus: this.toStationBusinessStatus(row.businessStatus ?? "open"),
      closedByCalendar: Boolean(row.closedByCalendar),
      source: row.source === "manual" ? "manual" : "system",
      createdAt: row.createdAt.toISOString()
    };
  }

  private buildStationCapacityQueueMetrics(input: {
    totalSpaces: number;
    availableSpaces: number;
    pickupQueueVehicles: number;
    returnQueueVehicles: number;
    controlledVehicles: number;
    maintenanceVehicles: number;
    disabledVehicles: number;
    closedByCalendar: boolean;
    turnoverBufferMinutes?: number;
  }): Pick<
    StationCapacitySnapshot,
    | "pickupQueueVehicles"
    | "returnQueueVehicles"
    | "queueVehicles"
    | "turnoverBufferMinutes"
    | "estimatedWaitMinutes"
    | "pressureLevel"
    | "pressureReason"
  > {
    const pickupQueueVehicles = Math.max(0, input.pickupQueueVehicles);
    const returnQueueVehicles = Math.max(0, input.returnQueueVehicles);
    const queueVehicles = pickupQueueVehicles + returnQueueVehicles;
    const totalSpaces = Math.max(0, input.totalSpaces);
    const turnoverBufferMinutes = Math.max(30, input.turnoverBufferMinutes ?? 60);
    const counterSlots = Math.max(1, Math.ceil(Math.max(totalSpaces, 1) / 12));
    const overloadQueue = Math.max(0, queueVehicles - counterSlots);
    const estimatedWaitMinutes = input.closedByCalendar
      ? 0
      : overloadQueue * Math.ceil(turnoverBufferMinutes / 2);
    const unavailableVehicles =
      input.controlledVehicles + input.maintenanceVehicles + input.disabledVehicles;
    const tightCapacity =
      totalSpaces > 0 && input.availableSpaces <= Math.max(1, Math.ceil(totalSpaces * 0.15));

    let pressureLevel: StationCapacitySnapshot["pressureLevel"] = "normal";
    let pressureReason = "容量正常";
    if (input.closedByCalendar) {
      pressureLevel = "closed";
      pressureReason = "营业日历关闭或暂停";
    } else if (input.availableSpaces <= 0 || queueVehicles >= counterSlots * 4) {
      pressureLevel = "overloaded";
      pressureReason =
        input.availableSpaces <= 0 ? "可用车位不足" : "取还车队列高于柜台处理能力";
    } else if (tightCapacity || queueVehicles >= counterSlots * 2 || unavailableVehicles > totalSpaces * 0.2) {
      pressureLevel = "busy";
      pressureReason = tightCapacity ? "可用车位接近预警线" : "高峰队列或异常车辆偏多";
    }

    return {
      pickupQueueVehicles,
      returnQueueVehicles,
      queueVehicles,
      turnoverBufferMinutes,
      estimatedWaitMinutes,
      pressureLevel,
      pressureReason
    };
  }

  private toStationCapacityPressureLevel(value: string): StationCapacitySnapshot["pressureLevel"] {
    if (["normal", "busy", "overloaded", "closed"].includes(value)) {
      return value as StationCapacitySnapshot["pressureLevel"];
    }
    return "normal";
  }

  private toStationSummary(row: {
    id: string;
    code: string;
    name: string;
    parentStoreName: string;
    type: string;
    status: string;
    serviceStatus: string;
    address: string | null;
    serviceTypes: Prisma.JsonValue;
    metadata: Prisma.JsonValue | null;
  }): StoreStationSummary {
    const metadata = this.objectMetadata(row.metadata);
    const serviceTypes = this.stringArray(row.serviceTypes);
    const storeRentalEnabled =
      this.booleanValue(metadata.storeRentalEnabled) ??
      serviceTypes.includes("STORE_STANDARD");
    const storeSelfServiceEnabled =
      this.booleanValue(metadata.storeSelfServiceEnabled) ??
      serviceTypes.includes("STORE_24H");
    const serviceCapabilities =
      this.stringArray(metadata.serviceCapabilities).length > 0
        ? this.stringArray(metadata.serviceCapabilities)
        : [
            ...(storeRentalEnabled ? ["门市租车"] : []),
            ...(storeSelfServiceEnabled ? ["24小时自助"] : [])
          ];

    return {
      id: row.id,
      name: row.name,
      companyName: this.stringValue(metadata.companyName) || "演示香港租户",
      storeCode: this.stringValue(metadata.storeCode),
      stationCode: this.stringValue(metadata.stationCode) || row.code,
      parentStoreName: row.parentStoreName,
      stationType: this.stringValue(metadata.stationType) || row.type,
      parkingLotType: this.stringValue(metadata.parkingLotType),
      parkingCompany: this.stringValue(metadata.parkingCompany),
      serviceCapabilities,
      parkingTotal: this.numberValue(metadata.parkingTotal) ?? 0,
      parkingAvailable: this.numberValue(metadata.parkingAvailable) ?? 0,
      status: row.status === "disabled" ? "disabled" : "enabled",
      serviceStatus: this.toStationServiceStatus(row.serviceStatus),
      address: row.address ?? "",
      longitude: this.numberValue(metadata.longitude),
      latitude: this.numberValue(metadata.latitude),
      contactName: this.stringValue(metadata.contactName) || "营运端",
      contactPhone: this.stringValue(metadata.contactPhone) || "",
      email: this.stringValue(metadata.email),
      fax: this.stringValue(metadata.fax),
      businessHours: this.stringValue(metadata.businessHours),
      counterServiceHours: this.stringValue(metadata.counterServiceHours),
      accessMethod: this.stringValue(metadata.accessMethod),
      fixedParkingSpaces: this.stringArray(metadata.fixedParkingSpaces),
      parkingFeeRule: this.stringValue(metadata.parkingFeeRule),
      description: this.stringValue(metadata.description),
      remark: this.stringValue(metadata.remark),
      storeRentalEnabled,
      storeRentalServiceStatus: this.toServiceAbilityStatus(
        this.stringValue(metadata.storeRentalServiceStatus) || row.serviceStatus
      ),
      storeRentalManualHandover:
        this.booleanValue(metadata.storeRentalManualHandover) ?? true,
      storeRentalManualInspection:
        this.booleanValue(metadata.storeRentalManualInspection) ?? true,
      storeSelfServiceEnabled,
      storeSelfServiceStatus: this.toServiceAbilityStatus(
        this.stringValue(metadata.storeSelfServiceStatus) || row.serviceStatus
      ),
      selfServiceAllowNightReturn:
        this.booleanValue(metadata.selfServiceAllowNightReturn) ?? false,
      selfServicePickupMethods: this.stringArray(metadata.selfServicePickupMethods)
    };
  }

  private toVehicleGroupMaster(row: {
    id: string;
    code: string;
    name: string;
    seats: number;
    brand: string | null;
    model: string | null;
    energyType: string | null;
    luggageCount: number | null;
    status: string;
    metadata: Prisma.JsonValue | null;
  }): VehicleGroupMaster {
    const metadata = this.objectMetadata(row.metadata);

    return {
      id: row.id,
      vehicleType: this.stringValue(metadata.vehicleType) || "汽车",
      brand: this.stringValue(metadata.brand) || row.brand || "",
      model: this.stringValue(metadata.model) || row.model || "",
      year: this.stringValue(metadata.year) || "",
      originType: this.stringValue(metadata.originType) || "自有",
      seats: this.numberValue(metadata.seats) ?? row.seats,
      displacement: this.stringValue(metadata.displacement) || row.energyType || "",
      trunkCapacity:
        this.stringValue(metadata.trunkCapacity) ||
        (row.luggageCount ? `${row.luggageCount}件行李` : ""),
      features: this.stringArray(metadata.features),
      storeProductGroupName:
        this.stringValue(metadata.storeProductGroupName) || row.name,
      dailyPrice: this.numberValue(metadata.dailyPrice) ?? this.defaultDailyPrice(row.code),
      freeKm: this.numberValue(metadata.freeKm) ?? 300,
      pricePerKm: this.numberValue(metadata.pricePerKm) ?? 1.5,
      status: row.status === "disabled" ? "disabled" : "enabled",
      priceVersionId:
        this.stringValue(metadata.priceVersionId) || `PV_${row.code}_SEED`,
      vehicleCount: this.numberValue(metadata.vehicleCount),
      reservedOrderCount: this.numberValue(metadata.reservedOrderCount),
      isSpecial: this.booleanValue(metadata.isSpecial) ?? false,
      minMemberLevel: this.stringValue(metadata.minMemberLevel),
      versionNote: this.stringValue(metadata.versionNote)
    };
  }

  private toVehicleSummary(row: Awaited<ReturnType<PrismaService["vehicle"]["findFirst"]>> & {
    currentStation?: { name: string; parentStoreName: string } | null;
    store?: { name: string } | null;
    vehicleGroup?: { name: string } | null;
  }): VehicleInstanceSummary {
    const metadata = this.objectMetadata(row.metadata);
    return {
      id: row.id,
      licensePlate: row.plateNo,
      vin: row.vin ?? "",
      vehicleGroupName:
        this.stringValue(metadata.vehicleGroupName) || row.vehicleGroup?.name || "",
      assetCompanyName: row.assetCompanyName ?? "演示香港租户",
      currentStoreName:
        this.stringValue(metadata.currentStoreName) ||
        row.store?.name ||
        row.currentStation?.parentStoreName ||
        "",
      currentStationName:
        this.stringValue(metadata.currentStationName) || row.currentStation?.name || "",
      operationStatus: this.toSharedOperationStatus(row.operationStatus),
      enabled: row.enabled,
      currentServiceType: this.toSharedServiceType(row.currentServiceType),
      serviceTypes: this.serviceTypeArray(row.serviceTypes),
      mileage: row.mileage,
      color: row.color ?? "",
      cid: row.cid ?? undefined,
      isSpecial: row.isSpecial,
      disabledReason: this.stringValue(metadata.disabledReason),
      maintenanceReason: this.stringValue(metadata.maintenanceReason),
      tags: this.stringArray(metadata.tags),
      lastOperationAt: this.stringValue(metadata.lastOperationAt),
      lastOperationBy: this.stringValue(metadata.lastOperationBy)
    };
  }

  private toMemberSummary(row: any): MemberSummary {
    return {
      id: row.id,
      name: row.name,
      phoneMasked: row.phoneMasked,
      source: row.source,
      levelName: row.levelName,
      pointsBalance: row.pointsBalance,
      status: this.toSharedMemberStatus(row.status),
      reviewStatus: this.toSharedMemberReviewStatus(row.reviewStatus),
      registerAt: row.createdAt.toISOString(),
      totalOrders: row.totalOrders,
      totalSpendAmount: Number(row.totalSpendAmount),
      tags: this.stringArray(row.tags),
      identityVerified: row.identityVerified,
      driverLicenseVerified: row.driverLicenseVerified
    };
  }

  private toMemberDetail(row: any): MemberDetail {
    return {
      ...this.toMemberSummary(row),
      phone: row.phone,
      email: row.email ?? undefined,
      identityNoMasked: row.identityNoMasked ?? undefined,
      driverLicenseNoMasked: row.driverLicenseNoMasked ?? undefined,
      birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : undefined,
      emergencyContactName: row.emergencyContactName ?? undefined,
      emergencyContactPhone: row.emergencyContactPhone ?? undefined,
      notes: row.notes ?? undefined,
      riskNote: row.riskNote ?? undefined,
      referrerCustomerId: row.referrerCustomerId ?? undefined,
      recentOrderNos: (row.orders ?? []).map((order: { orderNo: string }) => order.orderNo),
      timeline: (row.timeline ?? []).map((item: any) => {
        const detail = this.objectMetadata(item.detail);
        return {
          id: item.id,
          at: item.createdAt.toISOString(),
          operator: this.stringValue(detail.operator) || "营运端",
          action: item.title,
          remark: this.stringValue(detail.remark)
        };
      })
    };
  }

  private toMembershipPlanSummary(row: any): MembershipPlanSummary {
    const levelRules = this.objectMetadata(row.levelRules);
    const benefits = this.objectMetadata(row.benefits);

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      tierRank: this.numberValue(levelRules.tierRank) ?? 1,
      status: row.status === PrismaConfigStatus.EFFECTIVE ? "enabled" : "disabled",
      upgradeCondition: this.stringValue(levelRules.upgradeCondition) || "",
      benefitSummary: this.stringValue(benefits.benefitSummary) || "",
      orderDiscountPercent: this.numberValue(benefits.orderDiscountPercent) ?? 0,
      depositDiscountPercent: this.numberValue(benefits.depositDiscountPercent) ?? 0,
      freeServiceCount: this.numberValue(benefits.freeServiceCount) ?? 0
    };
  }

  private toCorporateSummary(row: any): CorporateSummary {
    return {
      id: row.id,
      shortName: row.shortName,
      fullName: row.fullName,
      status: this.toSharedCorporateStatus(row.status),
      creditLimitAmount: Number(row.creditLimitAmount),
      accountPeriodDays: row.accountPeriodDays,
      settlementMode: this.toSharedSettlementMode(row.settlementMode),
      contactName: row.contactName ?? "",
      contactPhone: row.contactPhone ?? "",
      activeOrderCount: row.activeOrderCount,
      unpaidAmount: (row.monthlyBills ?? []).reduce(
        (total: number, bill: { balanceAmount: Prisma.Decimal }) =>
          total + Number(bill.balanceAmount),
        0
      ) + Number(row.reservedQuotaAmount ?? 0),
      contractStatus: this.resolveCorporateContractStatus(row.contracts ?? [])
    };
  }

  private toCorporateDetail(row: any): CorporateDetail {
    return {
      ...this.toCorporateSummary(row),
      billingEmail: row.billingEmail ?? undefined,
      billingCycleDay: row.billingCycleDay,
      statementEmail: row.statementEmail ?? undefined,
      reconciliationContactName: row.reconciliationContactName ?? undefined,
      reconciliationContactPhone: row.reconciliationContactPhone ?? undefined,
      autoGenerateStatement: row.autoGenerateStatement,
      creditWarningAmount: Number(row.creditWarningAmount),
      invoiceTitle: row.invoiceTitle ?? undefined,
      linkedStores: this.stringArray(row.linkedStores),
      notes: row.notes ?? undefined,
      recentOrderNos: (row.orders ?? []).map((order: { orderNo: string }) => order.orderNo),
      contacts: (row.contacts ?? []).map((contact: any) => ({
        id: contact.id,
        name: contact.name,
        title: contact.title ?? "",
        phone: contact.phone ?? "",
        email: contact.email ?? undefined
      })),
      contracts: (row.contracts ?? []).map((contract: any) => ({
        id: contract.id,
        contractNo: contract.contractNo,
        contractName: contract.contractName,
        status: this.toCorporateContractStatus(contract.status),
        startDate: contract.startDate ? contract.startDate.toISOString().slice(0, 10) : "",
        endDate: contract.endDate ? contract.endDate.toISOString().slice(0, 10) : "",
        amount: Number(contract.amount),
        linkedStores: this.stringArray(contract.linkedStores),
        statementEmail: contract.statementEmail ?? undefined,
        attachments: this.stringArray(contract.attachments),
        remark: contract.remark ?? undefined
      }))
    };
  }

  private orderInclude() {
    return {
      vehicleGroup: true,
      assignedVehicle: true,
      pickupStation: true,
      returnStation: true
    } as const;
  }

  private orderDetailInclude() {
    return {
      ...this.orderInclude(),
      fees: { orderBy: { createdAt: "asc" } },
      transactions: { orderBy: { createdAt: "asc" } },
      inspectionRecords: { orderBy: { createdAt: "asc" } },
      timeline: { orderBy: { createdAt: "asc" } },
      eventSnapshots: { orderBy: { occurredAt: "asc" } }
    } as const;
  }

  private toRentalRuleVersionRecord(row: any): StoreRentalRuleVersionRecord {
    const content = this.objectMetadata(row.content);
    const rawSnapshot = this.objectMetadata(content.snapshot);
    const snapshotSource = rawSnapshot.version ? rawSnapshot : content;
    const metadata = this.objectMetadata(content.metadata);
    const savedAt = this.stringValue(metadata.savedAt) || row.createdAt.toISOString();
    const effectiveAt =
      row.effectiveAt?.toISOString() ||
      this.stringValue(snapshotSource.effectiveAt) ||
      savedAt;
    const status = this.toSharedConfigStatus(row.status);
    const snapshot = {
      ...(snapshotSource as unknown as StoreRentalRuleConfig),
      version: this.stringValue(snapshotSource.version) || row.id,
      status,
      effectiveAt
    };

    return {
      version: snapshot.version,
      versionNo: row.versionNo,
      status,
      savedBy: this.stringValue(metadata.savedBy) || "营运端",
      savedAt,
      effectiveAt,
      changeReason: this.stringValue(metadata.changeReason) || "保存门市租赁业务规则",
      snapshot
    };
  }

  private async findVehicleGroupForOrder(
    vehicleGroupCode: string | undefined,
    vehicleGroupName: string,
    tenantId: string
  ) {
    const byCode = vehicleGroupCode
      ? await this.prisma.vehicleGroup.findFirst({
          where: { tenantId, code: vehicleGroupCode }
        })
      : undefined;
    if (byCode) {
      return byCode;
    }

    const groups = await this.prisma.vehicleGroup.findMany({ where: { tenantId } });
    const matched = groups.find((group) => {
      const metadata = this.objectMetadata(group.metadata);
      return (
        group.name === vehicleGroupName ||
        group.code === vehicleGroupName ||
        vehicleGroupName.includes(group.name) ||
        vehicleGroupName.includes(this.stringValue(metadata.storeProductGroupName) || "") ||
        vehicleGroupName.includes(group.brand || "") ||
        vehicleGroupName.includes(group.model || "")
      );
    });
    if (matched) {
      return matched;
    }

    const [fallback] = groups;
    if (!fallback) {
      throw new BadRequestException("请先初始化门市租赁车型组后再创建订单。");
    }
    return fallback;
  }

  private async findStationForOrder(
    storeCode: string | undefined,
    storeName: string,
    tenantId: string
  ) {
    return this.prisma.storeStation.findFirst({
      where: {
        tenantId,
        OR: [
          ...(storeCode ? [{ code: storeCode }] : []),
          { parentStoreName: storeName },
          { name: storeName }
        ]
      }
    });
  }

  private toOrderSummary(row: any): StoreRentalOrderSummary {
    const termsSnapshot = this.objectMetadata(row.termsSnapshot);
    const operationLock = this.objectMetadata(termsSnapshot.operationLock);
    const vehicleSnapshot = this.objectMetadata(row.assignedVehicleSnapshot);

    return {
      id: row.id,
      orderNo: row.orderNo,
      mode: this.toSharedStoreRentalMode(row.mode),
      memberId: row.memberId ?? undefined,
      corporateId: row.corporateId ?? undefined,
      customerName: row.customerName,
      customerPhoneMasked: row.customerPhoneMasked,
      corporateShortName: row.corporateShortName ?? undefined,
      vehicleGroupName:
        this.stringValue(this.objectMetadata(row.vehicleGroupSnapshot).name) ||
        row.vehicleGroup?.name ||
        "",
      plateNo:
        this.stringValue(vehicleSnapshot.plateNo) ||
        row.assignedVehicle?.plateNo ||
        undefined,
      pickupStoreName:
        this.stringValue(this.objectMetadata(row.pickupStoreSnapshot).name) ||
        row.pickupStation?.parentStoreName ||
        "",
      returnStoreName:
        this.stringValue(this.objectMetadata(row.returnStoreSnapshot).name) ||
        row.returnStation?.parentStoreName ||
        "",
      pickupStationName:
        this.stringValue(this.objectMetadata(row.pickupStoreSnapshot).stationName) ||
        row.pickupStation?.name,
      returnStationName:
        this.stringValue(this.objectMetadata(row.returnStoreSnapshot).stationName) ||
        row.returnStation?.name,
      pickupAt: row.pickupAt.toISOString(),
      returnAt: row.returnAt.toISOString(),
      totalAmount: Number(row.totalAmount),
      billingMode: this.toSharedBillingMode(row.billingMode),
      mainStatus: this.toSharedOrderMainStatus(row.mainStatus),
      dispatchStatus: this.toSharedDispatchStatus(row.dispatchStatus),
      paymentStatus: this.toSharedPaymentStatus(row.paymentStatus),
      operationLockStatus: this.toOperationLockStatus(
        this.stringValue(operationLock.status)
      ),
      operationLockOperator: this.stringValue(operationLock.operator),
      operationLockExpiresAt: this.stringValue(operationLock.expiresAt),
      riskFlags: this.stringArray(row.riskFlags)
    };
  }

  private toOrderDetail(row: any): StoreRentalOrderDetail {
    const order = this.toOrderSummary(row);
    const feeLedgerItems: StoreRentalFeeLedgerItem[] = (row.fees ?? []).map(
      (fee: any) => this.toFeeLedgerItem(fee)
    );
    const transactionRecords = (row.transactions ?? []).map((record: any) =>
      this.toTransactionRecord(record)
    );
    const settlementSummary = this.toSettlementSummary(row, feeLedgerItems);
    const pricingSnapshot = this.objectMetadata(row.pricingSnapshot);
    const marketingSnapshot = this.objectMetadata(row.marketingSnapshot);
    const termsSnapshot = this.objectMetadata(row.termsSnapshot);

    return {
      ...order,
      timeline:
        (row.timeline ?? []).length > 0
          ? row.timeline.map((item: any) => this.toTimelineItem(item))
          : [
              {
                at: row.createdAt.toISOString(),
                actor: "系统",
                action: "创建订单并锁定价格快照"
              }
            ],
      feeItems: feeLedgerItems
        .filter((item) => item.direction === "charge")
        .map((item) => ({ name: item.name, amount: item.amount })),
      feeLedgerItems,
      transactionRecords,
      contracts: [],
      notifications: [],
      remarks: [],
      operationLocks: [],
      idempotencyRecords: [],
      financialOverview: this.toFinancialOverview(
        settlementSummary,
        feeLedgerItems,
        transactionRecords
      ),
      inspectionRecords: (row.inspectionRecords ?? []).map((record: any) =>
        this.toInspectionRecord(record)
      ),
      settlementSummary,
      snapshots: {
        vehicleGroup: order.vehicleGroupName,
        pickupStore: order.pickupStoreName,
        returnStore: order.returnStoreName,
        pricingVersion:
          this.stringValue(pricingSnapshot.pricingVersion) ||
          this.stringValue(pricingSnapshot.version) ||
          "store-rental-price-v2026.05.01",
        priceVersionId:
          this.stringValue(pricingSnapshot.priceVersionId) ||
          this.stringValue(pricingSnapshot.pricingVersion),
        marketingPlanVersionId:
          this.stringValue(marketingSnapshot.versionId) ||
          this.stringValue(pricingSnapshot.marketingPlanVersionId),
        marketingPlanName:
          this.stringValue(marketingSnapshot.name) ||
          this.stringValue(pricingSnapshot.marketingPlanName),
        termsVersion:
          this.stringValue(termsSnapshot.termsVersion) ||
          this.stringValue(termsSnapshot.ruleVersion) ||
          "store-rental-terms-v2026.04.28",
        events: (row.eventSnapshots ?? []).map((snapshot: any) =>
          this.toEventSnapshotRecord(snapshot)
        )
      },
      operationLockExpiredHint:
        order.operationLockStatus === OperationLockStatus.Expired
          ? "操作锁已过期，请重新发起取车操作。"
          : undefined,
      availableActions: this.buildAvailableActions(order)
    };
  }

  private buildAvailableActions(order: StoreRentalOrderSummary): string[] {
    const actionStatusMap: Record<string, OrderMainStatus[]> = {
      "payment-success": [OrderMainStatus.PendingPayment],
      "start-pickup": [OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue],
      "pickup-inspection": [OrderMainStatus.Inspecting],
      "extend-rental": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue
      ],
      "redirect-order": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "change-return-store": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "change-return-station": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "return-inspection": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "confirm-settlement": [
        OrderMainStatus.SettlementPending,
        OrderMainStatus.PaymentDue,
        OrderMainStatus.RefundPending
      ],
      "register-accident": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing,
        OrderMainStatus.SettlementPending,
        OrderMainStatus.PaymentDue,
        OrderMainStatus.RefundPending,
        OrderMainStatus.Completed
      ],
      "release-operation-lock": [OrderMainStatus.Inspecting],
      "mark-no-show": [OrderMainStatus.PickupOverdue],
      "reject-order": [OrderMainStatus.Inspecting],
      "close-order": [
        OrderMainStatus.PendingPayment,
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      cancel: [
        OrderMainStatus.PendingPayment,
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue
      ]
    };

    return Object.entries(actionStatusMap)
      .filter(([, statuses]) => statuses.includes(order.mainStatus))
      .map(([action]) => action);
  }

  private toContractRecord(row: any): StoreRentalContractRecord {
    const payload = this.objectMetadata(row.payload);
    return {
      id: row.id,
      documentNo: row.documentNo,
      type: this.toContractType(row.type),
      title: row.title,
      status: this.toContractStatus(row.status),
      signMethod: this.toContractSignMethod(row.signMethod),
      signerName: row.signerName ?? undefined,
      signedAt: row.signedAt ? row.signedAt.toISOString() : undefined,
      fileUrl: row.fileUrl ?? undefined,
      operator: row.operator ?? "营运端",
      createdAt: row.createdAt.toISOString(),
      templateCode: this.stringValue(payload.templateCode),
      printStatus: this.toContractPrintStatus(this.stringValue(payload.printStatus)),
      printCount: this.numberValue(payload.printCount) ?? 0,
      lastPrintedAt: this.stringValue(payload.lastPrintedAt),
      downloadUrl: this.stringValue(payload.downloadUrl),
      externalProvider:
        payload.externalProvider === "mock" || payload.externalProvider === "reserved"
          ? payload.externalProvider
          : undefined,
      externalSignStatus: this.toContractExternalSignStatus(
        this.stringValue(payload.externalSignStatus)
      ),
      snapshot: this.objectMetadata(payload.snapshot)
    };
  }

  private toContractCenterRow(row: any): StoreRentalContractCenterRow {
    const contract = this.toContractRecord(row);
    const vehicleGroupSnapshot = this.objectMetadata(row.vehicleGroupSnapshot);
    const assignedVehicleSnapshot = this.objectMetadata(row.assignedVehicleSnapshot);
    const pickupStoreSnapshot = this.objectMetadata(row.pickupStoreSnapshot);
    const returnStoreSnapshot = this.objectMetadata(row.returnStoreSnapshot);

    return {
      ...contract,
      orderId: row.orderId,
      orderNo: row.orderNo,
      customerName: row.customerName,
      customerPhoneMasked: row.customerPhoneMasked,
      corporateShortName: row.corporateShortName ?? undefined,
      vehicleGroupName: this.stringValue(vehicleGroupSnapshot.name) || "",
      plateNo: this.stringValue(assignedVehicleSnapshot.plateNo),
      pickupStoreName: this.stringValue(pickupStoreSnapshot.name) || "",
      returnStoreName: this.stringValue(returnStoreSnapshot.name) || "",
      pickupAt: row.pickupAt.toISOString(),
      returnAt: row.returnAt.toISOString(),
      billingMode: this.toSharedBillingMode(row.billingMode),
      mainStatus: this.toSharedOrderMainStatus(row.mainStatus),
      paymentStatus: this.toSharedPaymentStatus(row.paymentStatus)
    };
  }

  private contractPayload(record: StoreRentalContractRecord): Prisma.InputJsonValue {
    return {
      snapshot: record.snapshot,
      templateCode: record.templateCode,
      printStatus: record.printStatus,
      printCount: record.printCount ?? 0,
      lastPrintedAt: record.lastPrintedAt,
      downloadUrl: record.downloadUrl,
      externalProvider: record.externalProvider,
      externalSignStatus: record.externalSignStatus
    } as Prisma.InputJsonValue;
  }

  private contractCenterStats(
    rows: StoreRentalContractCenterRow[]
  ): StoreRentalContractCenter["stats"] {
    return {
      total: rows.length,
      pending: rows.filter((row) => row.status === "pending").length,
      signed: rows.filter((row) => row.status === "signed").length,
      fallbackUploaded: rows.filter((row) => row.status === "fallback_uploaded").length,
      voided: rows.filter((row) => row.status === "voided").length,
      printed: rows.filter((row) => ["printed", "downloaded"].includes(row.printStatus ?? "")).length,
      skippedExternalCalls: rows.filter(
        (row) => row.externalProvider === "reserved" || row.externalSignStatus === "skipped"
      ).length
    };
  }

  private contractTemplates(): StoreRentalContractCenter["templates"] {
    return [
      {
        code: "rental_contract",
        name: "门市租赁合约",
        description: "取车前签署，记录承租人、车辆、费用和租期快照。",
        defaultSignMethod: "app",
        autoGenerateScenes: ["pickup", "manual"],
        mockIntegration: {
          printProvider: "reserved",
          signProvider: "reserved",
          autoSkipExternalCall: true
        }
      },
      {
        code: "pickup_sheet",
        name: "取车交接单",
        description: "发车时生成，记录取车验车、油电/里程和交付信息。",
        defaultSignMethod: "counter",
        autoGenerateScenes: ["pickup", "manual"],
        mockIntegration: {
          printProvider: "reserved",
          signProvider: "reserved",
          autoSkipExternalCall: true
        }
      },
      {
        code: "return_sheet",
        name: "还车交接单",
        description: "还车验车后生成，记录还车车况、里程、照片和异常。",
        defaultSignMethod: "counter",
        autoGenerateScenes: ["return", "manual"],
        mockIntegration: {
          printProvider: "reserved",
          signProvider: "reserved",
          autoSkipExternalCall: true
        }
      },
      {
        code: "settlement_sheet",
        name: "还车结算单",
        description: "结算确认时生成，记录费用、收退款和月结入账摘要。",
        defaultSignMethod: "system",
        autoGenerateScenes: ["settlement", "manual"],
        mockIntegration: {
          printProvider: "reserved",
          signProvider: "reserved",
          autoSkipExternalCall: true
        }
      }
    ];
  }

  private toEventSnapshotRecord(row: any): StoreRentalEventSnapshotRecord {
    return {
      id: row.id,
      snapshotRef: row.snapshotRef,
      eventType: this.toEventSnapshotType(row.eventType),
      title: row.title,
      triggerReason: row.triggerReason ?? undefined,
      settlementTarget: row.settlementTarget ?? undefined,
      amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
      before: this.objectMetadata(row.beforeJson),
      after: this.objectMetadata(row.afterJson),
      amountBreakdown: this.objectMetadata(row.amountJson),
      payload: this.objectMetadata(row.payload),
      operator: row.operator ?? "营运端",
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private toNotificationRecord(row: any): StoreRentalNotificationRecord {
    return {
      id: row.id,
      scene: this.toNotificationScene(row.scene),
      channel: this.toNotificationChannel(row.channel),
      target: row.target,
      status: this.toNotificationStatus(row.status),
      content: row.content,
      idempotencyKey: row.idempotencyKey ?? undefined,
      operator: row.operator ?? "营运端",
      sentAt: row.sentAt ? row.sentAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      payload: this.objectMetadata(row.payload)
    };
  }

  private toRemarkRecord(row: any): StoreRentalOrderRemarkRecord {
    return {
      id: row.id,
      category: this.toRemarkCategory(row.category),
      content: row.content,
      visibility: row.visibility === "customer_visible" ? "customer_visible" : "internal",
      operator: row.operator ?? "营运端",
      followUpAt: row.followUpAt ? row.followUpAt.toISOString() : undefined,
      reminderAt: row.reminderAt ? row.reminderAt.toISOString() : undefined,
      responsibleUserId: row.responsibleUserId ?? undefined,
      responsibleName: row.responsibleName ?? undefined,
      status: row.status === "closed" ? "closed" : "open",
      closedAt: row.closedAt ? row.closedAt.toISOString() : undefined,
      closedBy: row.closedBy ?? undefined,
      closeNote: row.closeNote ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toOperationLockRecord(row: any): StoreRentalOperationLockRecord {
    return {
      id: row.id,
      stage: this.toOperationLockStage(row.stage),
      status: this.toOperationLockStatus(row.status) ?? OperationLockStatus.Active,
      operator: row.operator ?? "营运端",
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : undefined,
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      payload: this.objectMetadata(row.payload)
    };
  }

  private toIdempotencyRecord(row: any): StoreRentalIdempotencyRecord {
    return {
      id: row.id,
      action: row.action,
      key: row.key,
      status: this.toIdempotencyStatus(row.status),
      requestHash: row.requestHash ?? undefined,
      responseSnapshot: this.objectMetadata(row.responseSnapshot),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toFeeLedgerItem(row: any): StoreRentalFeeLedgerItem {
    const ruleSnapshot = this.objectMetadata(row.ruleSnapshot);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      stage:
        this.toSharedFeeStage(this.stringValue(ruleSnapshot.originalStage) || row.stage),
      source: row.source === "manual" ? "manual" : "system",
      direction: this.toSharedFeeDirection(row.direction),
      status: this.toSharedFeeStatus(row.status),
      invoicedStatus: this.toSharedFeeInvoicedStatus(row.invoicedStatus),
      amount: Number(row.amount),
      settledAmount: Number(row.settledAmount),
      pendingAmount: Number(row.pendingAmount),
      description: row.description ?? "",
      snapshotRef: row.snapshotRef ?? "",
      createdAt: row.createdAt.toISOString()
    };
  }

  private toTransactionRecord(row: any): StoreRentalTransactionRecord {
    return {
      id: row.id,
      type: this.toTransactionType(row.type),
      channel: this.toTransactionChannel(row.channel),
      amount: Number(row.amount),
      status: this.toTransactionStatus(row.status),
      at: row.createdAt.toISOString(),
      operator: row.operator ?? "营运端",
      relatedFeeIds: this.stringArray(row.relatedFeeIds),
      note: row.note ?? ""
    };
  }

  private toInspectionRecord(row: any): StoreRentalInspectionRecord {
    const payload = this.objectMetadata(row.payload);
    return {
      id: row.id,
      stage: row.stage === "return" ? "return" : "pickup",
      at: row.createdAt.toISOString(),
      operator: row.operator,
      plateNo: row.plateNo ?? undefined,
      mileage: row.mileage ?? undefined,
      fuelLevelPercent: row.fuelLevelPercent ?? undefined,
      batteryLevelPercent: row.batteryLevelPercent ?? undefined,
      cleanliness: this.cleanlinessValue(row.cleanliness),
      damageFound: row.damageFound,
      damageDescription: row.damageDescription ?? undefined,
      missingItems: row.missingItems ?? undefined,
      photoCount: row.photoCount,
      customerSigned: row.customerSigned,
      memo: this.stringValue(payload.memo)
    };
  }

  private toTimelineItem(row: any): StoreRentalOrderTimelineItem {
    const detail = this.objectMetadata(row.detail);
    return {
      at: row.createdAt.toISOString(),
      actor: row.operator ?? this.stringValue(detail.actor) ?? "系统",
      action: row.title
    };
  }

  private toSettlementSummary(
    row: any,
    feeLedgerItems: StoreRentalFeeLedgerItem[]
  ): StoreRentalSettlementSummary {
    const stored = this.objectMetadata(row.settlementSummary);
    const rentalAmount =
      this.numberValue(stored.rentalAmount) ??
      feeLedgerItems.find((item) => item.code === "RENTAL")?.amount ??
      Number(row.totalAmount);
    const serviceFeeAmount =
      this.numberValue(stored.serviceFeeAmount) ??
      feeLedgerItems.find((item) => item.code === "SERVICE")?.amount ??
      0;
    const overtimeFeeAmount = this.numberValue(stored.overtimeFeeAmount) ?? 0;
    const extraMileageFeeAmount = this.numberValue(stored.extraMileageFeeAmount) ?? 0;
    const damageFeeAmount = this.numberValue(stored.damageFeeAmount) ?? 0;
    const cleaningFeeAmount = this.numberValue(stored.cleaningFeeAmount) ?? 0;
    const discountAmount = this.numberValue(stored.discountAmount) ?? 0;
    const finalReceivableAmount =
      this.numberValue(stored.finalReceivableAmount) ??
      rentalAmount +
        serviceFeeAmount +
        overtimeFeeAmount +
        extraMileageFeeAmount +
        damageFeeAmount +
        cleaningFeeAmount -
        discountAmount;
    const returnFeeTotal =
      this.numberValue(stored.returnFeeTotal) ??
      overtimeFeeAmount + extraMileageFeeAmount + damageFeeAmount + cleaningFeeAmount - discountAmount;
    const returnTransactionTotal =
      this.numberValue(stored.returnTransactionTotal) ?? 0;
    const balanceDue =
      this.numberValue(stored.balanceDue) ?? returnFeeTotal - returnTransactionTotal;
    const billingMode = this.toSharedBillingMode(row.billingMode);

    return {
      rentalAmount,
      serviceFeeAmount,
      overtimeFeeAmount,
      extraMileageFeeAmount,
      damageFeeAmount,
      cleaningFeeAmount,
      discountAmount,
      finalReceivableAmount,
      returnFeeTotal,
      returnTransactionTotal,
      balanceDue,
      customerPayableAmount: Math.max(0, balanceDue),
      customerRefundAmount: Math.max(0, -balanceDue),
      monthlyBillAmount:
        this.numberValue(stored.monthlyBillAmount) ??
        (billingMode === BillingMode.Monthly
          ? feeLedgerItems
              .filter((item) => item.status === "monthly_billing")
              .reduce((total, item) => total + item.amount, 0)
          : 0),
      monthlyBillingPosted: this.booleanValue(stored.monthlyBillingPosted) ?? false
    };
  }

  private toFinancialOverview(
    settlement: StoreRentalSettlementSummary,
    feeLedgerItems: StoreRentalFeeLedgerItem[],
    transactionRecords: StoreRentalTransactionRecord[]
  ): StoreRentalFinancialOverview {
    return {
      totalReceivableAmount: feeLedgerItems.reduce((total, item) => {
        if (item.status === "voided") {
          return total;
        }
        return item.direction === "charge" ? total + item.amount : total - item.amount;
      }, 0),
      customerReceivedAmount: transactionRecords
        .filter(
          (item) =>
            item.status === "success" &&
            (item.type === "payment" || item.type === "pre_auth_capture")
        )
        .reduce((total, item) => total + item.amount, 0),
      monthlyBillingAmount: transactionRecords
        .filter((item) => item.type === "monthly_bill" && item.status !== "failed")
        .reduce((total, item) => total + item.amount, 0),
      pendingAmount: feeLedgerItems
        .filter((item) => item.status === "pending" && item.direction === "charge")
        .reduce((total, item) => total + item.pendingAmount, 0),
      refundAmount:
        settlement.customerRefundAmount +
        feeLedgerItems
          .filter((item) => item.status === "pending" && item.direction === "refund")
          .reduce((total, item) => total + item.pendingAmount, 0),
      postChargeAmount: feeLedgerItems
        .filter((item) => item.stage === "post_charge" && item.status === "pending")
        .reduce((total, item) => total + item.pendingAmount, 0)
    };
  }

  private toFeeItemCreateInput(orderId: string, fee: StoreRentalFeeLedgerItem) {
    return {
      id: fee.id,
      orderId,
      code: fee.code,
      name: fee.name,
      stage: this.toPrismaFeeStage(fee.stage),
      direction: this.toPrismaFeeDirection(fee.direction),
      status: this.toPrismaFeeStatus(fee.status),
      invoicedStatus: fee.invoicedStatus ?? "none",
      amount: fee.amount,
      settledAmount: fee.settledAmount,
      pendingAmount: fee.pendingAmount,
      source: fee.source,
      description: fee.description,
      snapshotRef: fee.snapshotRef,
      ruleSnapshot: {
        originalStage: fee.stage,
        source: fee.source
      },
      createdAt: new Date(fee.createdAt)
    };
  }

  private toFeeItemUpdateInput(fee: StoreRentalFeeLedgerItem) {
    return {
      code: fee.code,
      name: fee.name,
      stage: this.toPrismaFeeStage(fee.stage),
      direction: this.toPrismaFeeDirection(fee.direction),
      status: this.toPrismaFeeStatus(fee.status),
      invoicedStatus: fee.invoicedStatus ?? "none",
      amount: fee.amount,
      settledAmount: fee.settledAmount,
      pendingAmount: fee.pendingAmount,
      source: fee.source,
      description: fee.description,
      snapshotRef: fee.snapshotRef,
      ruleSnapshot: {
        originalStage: fee.stage,
        source: fee.source
      }
    };
  }

  private toTransactionCreateInput(
    orderId: string,
    record: StoreRentalTransactionRecord
  ) {
    return {
      id: record.id,
      orderId,
      type: record.type,
      status: record.status,
      amount: record.amount,
      channel: record.channel,
      operator: record.operator,
      relatedFeeIds: record.relatedFeeIds as Prisma.InputJsonValue,
      note: record.note,
      createdAt: new Date(record.at)
    };
  }

  private toTransactionUpdateInput(record: StoreRentalTransactionRecord) {
    return {
      type: record.type,
      status: record.status,
      amount: record.amount,
      channel: record.channel,
      operator: record.operator,
      relatedFeeIds: record.relatedFeeIds as Prisma.InputJsonValue,
      note: record.note
    };
  }

  private toTimelineCreateInput(
    orderId: string,
    item: StoreRentalOrderTimelineItem
  ) {
    return {
      orderId,
      type: "order",
      title: item.action,
      operator: item.actor,
      detail: {
        actor: item.actor
      },
      createdAt: new Date(item.at)
    };
  }

  private toDispatchEvent(row: {
    id: string;
    eventType: string;
    source: string;
    title: string;
    orderId: string | null;
    orderNo: string | null;
    planId: string | null;
    beforeVehicle: string | null;
    targetVehicle: string | null;
    reasonCode: string | null;
    reasonText: string | null;
    riskLevel: string;
    operator: string | null;
    payload: Prisma.JsonValue | null;
    createdAt: Date;
  }): StoreRentalDispatchEvent {
    return {
      id: row.id,
      eventType: row.eventType as StoreRentalDispatchEvent["eventType"],
      source: row.source as StoreRentalDispatchEvent["source"],
      title: row.title,
      orderId: row.orderId ?? undefined,
      orderNo: row.orderNo ?? undefined,
      planId: row.planId ?? undefined,
      beforeVehicle: row.beforeVehicle ?? undefined,
      targetVehicle: row.targetVehicle ?? undefined,
      reasonCode: row.reasonCode as StoreRentalDispatchEvent["reasonCode"],
      reasonText: row.reasonText ?? undefined,
      riskLevel: row.riskLevel as StoreRentalDispatchEvent["riskLevel"],
      operator: row.operator ?? undefined,
      payload: row.payload ? this.objectMetadata(row.payload) : undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private contractTypeLabel(type: StoreRentalContractRecord["type"]) {
    const labels: Record<StoreRentalContractRecord["type"], string> = {
      rental_contract: "租赁合约",
      pickup_sheet: "取车交接单",
      return_sheet: "还车交接单",
      settlement_sheet: "结算单"
    };

    return labels[type];
  }

  private toContractType(value: string): StoreRentalContractRecord["type"] {
    return ["pickup_sheet", "return_sheet", "settlement_sheet"].includes(value)
      ? (value as StoreRentalContractRecord["type"])
      : "rental_contract";
  }

  private toContractStatus(value: string): StoreRentalContractRecord["status"] {
    return ["pending", "signed", "fallback_uploaded", "voided"].includes(value)
      ? (value as StoreRentalContractRecord["status"])
      : "pending";
  }

  private toContractPrintStatus(
    value: string | undefined
  ): StoreRentalContractRecord["printStatus"] {
    return value &&
      ["not_generated", "generated", "printed", "downloaded"].includes(value)
      ? (value as StoreRentalContractRecord["printStatus"])
      : "not_generated";
  }

  private toContractExternalSignStatus(
    value: string | undefined
  ): StoreRentalContractRecord["externalSignStatus"] {
    return value && ["skipped", "pending", "signed", "failed"].includes(value)
      ? (value as StoreRentalContractRecord["externalSignStatus"])
      : undefined;
  }

  private toContractSignMethod(value: string | null): StoreRentalContractRecord["signMethod"] {
    return value && ["app", "counter", "offline_paper", "system"].includes(value)
      ? (value as StoreRentalContractRecord["signMethod"])
      : "counter";
  }

  private toEventSnapshotType(value: string): StoreRentalEventSnapshotRecord["eventType"] {
    const allowed: StoreRentalEventSnapshotRecord["eventType"][] = [
      "pickup_qualification",
      "pickup_fund",
      "pickup_delivery",
      "return_inspection",
      "return_settlement",
      "settlement_confirmation",
      "operation_lock_release",
      "manual_adjust",
      "extension",
      "redirection",
      "return_location_change",
      "accident_registration",
      "no_show",
      "order_rejection",
      "order_close",
      "order_cancellation"
    ];
    return allowed.includes(value as StoreRentalEventSnapshotRecord["eventType"])
      ? (value as StoreRentalEventSnapshotRecord["eventType"])
      : "manual_adjust";
  }

  private toNotificationScene(value: string): StoreRentalNotificationRecord["scene"] {
    return [
      "order_created",
      "pickup_completed",
      "return_completed",
      "payment_due",
      "post_charge",
      "order_terminal",
      "manual"
    ].includes(value)
      ? (value as StoreRentalNotificationRecord["scene"])
      : "manual";
  }

  private notificationSceneText(scene: StoreRentalNotificationRecord["scene"]) {
    const labels: Record<StoreRentalNotificationRecord["scene"], string> = {
      order_created: "订单创建",
      pickup_completed: "取车完成",
      return_completed: "还车完成",
      payment_due: "待支付提醒",
      post_charge: "后补费用",
      order_terminal: "订单终止",
      manual: "手工通知"
    };
    return labels[scene] ?? "手工通知";
  }

  private toNotificationChannel(value: string): StoreRentalNotificationRecord["channel"] {
    return ["sms", "app", "email", "manual"].includes(value)
      ? (value as StoreRentalNotificationRecord["channel"])
      : "manual";
  }

  private toNotificationStatus(value: string): StoreRentalNotificationRecord["status"] {
    return ["pending", "sent", "failed", "skipped"].includes(value)
      ? (value as StoreRentalNotificationRecord["status"])
      : "pending";
  }

  private toRemarkCategory(value: string): StoreRentalOrderRemarkRecord["category"] {
    return [
      "general",
      "internal_note",
      "customer_note",
      "return_visit",
      "fulfillment_followup",
      "pickup",
      "return",
      "finance",
      "risk",
      "customer_followup"
    ].includes(value)
      ? (value as StoreRentalOrderRemarkRecord["category"])
      : "general";
  }

  private toOperationLockStage(value: string): StoreRentalOperationLockRecord["stage"] {
    return ["pickup", "return", "settlement", "fee"].includes(value)
      ? (value as StoreRentalOperationLockRecord["stage"])
      : "pickup";
  }

  private toIdempotencyStatus(value: string): StoreRentalIdempotencyRecord["status"] {
    return ["processing", "success", "failed"].includes(value)
      ? (value as StoreRentalIdempotencyRecord["status"])
      : "processing";
  }

  private toOrderOperationRecord(row: {
    id: string;
    orderId: string;
    orderNo: string;
    action: string;
    actionLabel: string;
    status: string;
    idempotencyKey: string | null;
    requestHash: string;
    lockStatus: string | null;
    operator: string | null;
    message: string | null;
    payload: Prisma.JsonValue | null;
    expiresAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }): StoreRentalOrderOperationRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNo: row.orderNo,
      action: row.action,
      actionLabel: row.actionLabel,
      status: row.status as StoreRentalOrderOperationRecord["status"],
      idempotencyKey: row.idempotencyKey ?? undefined,
      requestHash: row.requestHash,
      lockStatus: row.lockStatus as StoreRentalOrderOperationRecord["lockStatus"],
      operator: row.operator ?? undefined,
      message: row.message ?? undefined,
      payload: row.payload ? this.objectMetadata(row.payload) : undefined,
      expiresAt: row.expiresAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private toOrderNotificationRecord(row: {
    id: string;
    orderId: string;
    orderNo: string;
    event: string;
    eventLabel: string;
    channel: string;
    targetMasked: string;
    status: string;
    templateCode: string;
    contentSummary: string;
    operator: string | null;
    relatedAction: string | null;
    idempotencyKey: string | null;
    failReason: string | null;
    payload: Prisma.JsonValue | null;
    sentAt: Date | null;
    createdAt: Date;
  }): StoreRentalOrderNotificationRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNo: row.orderNo,
      event: row.event,
      eventLabel: row.eventLabel,
      channel: row.channel as StoreRentalOrderNotificationRecord["channel"],
      targetMasked: row.targetMasked,
      status: row.status as StoreRentalOrderNotificationRecord["status"],
      templateCode: row.templateCode,
      contentSummary: row.contentSummary,
      operator: row.operator ?? undefined,
      relatedAction: row.relatedAction ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      failReason: row.failReason ?? undefined,
      payload: row.payload ? this.objectMetadata(row.payload) : undefined,
      sentAt: row.sentAt?.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private orderSnapshot(value: unknown): Prisma.InputJsonValue {
    return this.metadata(value) as Prisma.InputJsonValue;
  }

  private termsSnapshot(
    order: StoreRentalOrderSummary,
    base: Prisma.InputJsonValue = {}
  ): Prisma.InputJsonValue {
    return {
      ...this.objectMetadata(base),
      operationLock: {
        status: order.operationLockStatus,
        operator: order.operationLockOperator,
        expiresAt: order.operationLockExpiresAt
      }
    };
  }

  private async upsertMonthlyBillLine(orderId: string, amount: number) {
    const order = await this.prisma.storeRentalOrder.findUnique({
      where: { id: orderId },
      include: { corporate: true, vehicleGroup: true, pickupStation: true, returnStation: true }
    });
    if (!order?.corporateId || amount <= 0) {
      return;
    }

    await this.upsertCorporateMonthlyBillLine({
      tenantId: order.tenantId,
      corporateId: order.corporateId,
      lineId: `bill_line_${orderId}`,
      orderId,
      orderNo: order.orderNo,
      customerName: order.customerName,
      vehicleGroupName:
        this.stringValue(this.objectMetadata(order.vehicleGroupSnapshot).name) ||
        order.vehicleGroup.name,
      pickupStoreName:
        this.stringValue(this.objectMetadata(order.pickupStoreSnapshot).name) ||
        order.pickupStation?.parentStoreName ||
        "",
      returnStoreName:
        this.stringValue(this.objectMetadata(order.returnStoreSnapshot).name) ||
        order.returnStation?.parentStoreName ||
        "",
      amount,
      remark: "企业月结订单费用挂账"
    });
  }

  private async upsertCorporateMonthlyBillLine(input: {
    tenantId: string;
    corporateId: string;
    lineId: string;
    orderId?: string;
    orderNo: string;
    customerName: string;
    vehicleGroupName: string;
    pickupStoreName: string;
    returnStoreName: string;
    amount: number;
    remark: string;
  }) {
    if (!input.corporateId || input.amount <= 0) {
      return;
    }

    const corporate = await this.prisma.corporate.findUnique({
      where: { id: input.corporateId }
    });
    if (!corporate) {
      return;
    }

    const period = new Date().toISOString().slice(0, 7);
    const billNo = `MB${period.replace("-", "")}${input.corporateId.slice(-3).toUpperCase()}`;
    const dueDate = new Date(`${period}-01T00:00:00.000Z`);
    dueDate.setUTCDate(Math.min(28, corporate.billingCycleDay || 25));
    dueDate.setUTCDate(dueDate.getUTCDate() + Math.max(0, corporate.accountPeriodDays || 0));

    const bill = await this.prisma.corporateMonthlyBill.upsert({
      where: {
        tenantId_billNo: {
          tenantId: input.tenantId,
          billNo
        }
      },
      update: {},
      create: {
        id: `bill_${input.corporateId}_${period.replace("-", "")}`,
        tenantId: input.tenantId,
        corporateId: input.corporateId,
        billNo,
        period,
        status: PrismaMonthlyBillStatus.POSTED,
        dueDate
      }
    });

    await this.prisma.corporateMonthlyBillLine.upsert({
      where: { id: input.lineId },
      update: {
        amount: input.amount,
        remark: input.remark
      },
      create: {
        id: input.lineId,
        billId: bill.id,
        orderId: input.orderId,
        orderNo: input.orderNo,
        customerName: input.customerName,
        vehicleGroupName: input.vehicleGroupName,
        pickupStoreName: input.pickupStoreName,
        returnStoreName: input.returnStoreName,
        amount: input.amount,
        remark: input.remark
      }
    });

    const aggregate = await this.prisma.corporateMonthlyBillLine.aggregate({
      where: { billId: bill.id },
      _sum: { amount: true },
      _count: true
    });
    const totalAmount = Number(aggregate._sum.amount ?? 0);
    const current = await this.prisma.corporateMonthlyBill.findUnique({
      where: { id: bill.id }
    });
    const paidAmount = Number(current?.paidAmount ?? 0);

    await this.prisma.corporateMonthlyBill.update({
      where: { id: bill.id },
      data: {
        orderCount: aggregate._count,
        totalAmount,
        balanceAmount: Math.max(0, totalAmount - paidAmount),
        status:
          paidAmount <= 0
            ? PrismaMonthlyBillStatus.POSTED
            : totalAmount - paidAmount > 0
              ? PrismaMonthlyBillStatus.PARTIALLY_PAID
              : PrismaMonthlyBillStatus.PAID
      }
    });
  }

  private toFinanceTransactionRow(row: any): FinanceTransactionRow {
    const record = this.toTransactionRecord(row);
    const order = row.order;
    return {
      ...record,
      orderId: order?.id,
      orderNo: order?.orderNo,
      corporateId: order?.corporateId,
      corporateShortName: order?.corporateShortName ?? undefined,
      customerName: order?.customerName ?? undefined,
      billingMode: order?.billingMode
        ? this.toSharedBillingMode(order.billingMode)
        : undefined
    };
  }

  private toFinanceDocumentRow(row: any): FinanceDocumentRow {
    const metadata = this.objectMetadata(row.metadata);
    return {
      id: row.id,
      documentNo: row.documentNo,
      type: row.type === PrismaFinanceDocumentType.RECEIPT ? "receipt" : "invoice",
      status: this.toSharedFinanceDocumentStatus(row.status),
      orderId: row.orderId ?? undefined,
      orderNo: row.orderNo ?? undefined,
      memberId: row.memberId ?? undefined,
      corporateId: row.corporateId ?? undefined,
      corporateShortName: row.corporateShortName ?? undefined,
      monthlyBillId: row.monthlyBillId ?? undefined,
      customerName: row.customerName,
      title: row.title,
      taxNo: row.taxNo ?? undefined,
      email: row.email ?? undefined,
      amount: Number(row.amount),
      issueSource: row.issueSource,
      relatedFeeIds: this.stringArray(row.relatedFeeIds ?? metadata.relatedFeeIds),
      originalDocumentId:
        row.originalDocumentId ?? this.stringValue(metadata.originalDocumentId),
      originalDocumentNo:
        row.originalDocumentNo ?? this.stringValue(metadata.originalDocumentNo),
      replacementDocumentId:
        row.replacementDocumentId ?? this.stringValue(metadata.replacementDocumentId),
      replacementDocumentNo:
        row.replacementDocumentNo ?? this.stringValue(metadata.replacementDocumentNo),
      issuedAt: row.issuedAt?.toISOString(),
      voidedAt: row.voidedAt?.toISOString(),
      voidReason: row.voidReason ?? this.stringValue(metadata.voidReason),
      voidedBy: row.voidedBy ?? this.stringValue(metadata.voidedBy),
      reissuedAt: row.reissuedAt?.toISOString(),
      createdBy: row.createdBy ?? undefined,
      remark: row.remark ?? undefined,
      auditTrail: this.financeDocumentAuditTrail(
        row.auditTrail ?? metadata.auditTrail
      ),
      createdAt: row.createdAt.toISOString()
    };
  }

  private toFinanceManualAdjustmentRow(row: any): FinanceManualAdjustmentRow {
    return {
      id: row.id,
      adjustmentNo: row.adjustmentNo,
      orderId: row.orderId ?? undefined,
      orderNo: row.orderNo ?? undefined,
      memberId: row.memberId ?? undefined,
      corporateId: row.corporateId ?? undefined,
      corporateShortName: row.corporateShortName ?? undefined,
      customerName: row.customerName ?? undefined,
      category: row.category,
      direction: this.toSharedFinanceAdjustmentDirection(row.direction),
      targetBillingMode: this.toSharedBillingMode(row.targetBillingMode),
      amount: Number(row.amount),
      status: this.toSharedFinanceAdjustmentStatus(row.status),
      reason: row.reason,
      operator: row.operator,
      approvedBy: row.approvedBy ?? undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      postedFeeId: row.postedFeeId ?? undefined,
      postedTransactionId: row.postedTransactionId ?? undefined,
      postedAt: row.postedAt?.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private toFinancePreAuthorizationRow(row: any): FinancePreAuthorizationRow {
    return {
      id: row.id,
      preAuthNo: row.preAuthNo,
      orderId: row.orderId ?? undefined,
      orderNo: row.orderNo ?? undefined,
      memberId: row.memberId ?? undefined,
      corporateId: row.corporateId ?? undefined,
      corporateShortName: row.corporateShortName ?? undefined,
      customerName: row.customerName ?? undefined,
      status: this.toSharedFinancePreAuthorizationStatus(row.status),
      channel: this.toSharedFinancePreAuthorizationChannel(row.channel),
      provider: row.provider,
      authorizedAmount: Number(row.authorizedAmount),
      capturedAmount: Number(row.capturedAmount),
      releasedAmount: Number(row.releasedAmount),
      remainingAmount: Number(row.remainingAmount),
      currency: row.currency,
      authCode: row.authCode ?? undefined,
      channelReferenceNo: row.channelReferenceNo ?? undefined,
      paymentMethod: row.paymentMethod ?? undefined,
      frozenAt: row.frozenAt?.toISOString(),
      capturedAt: row.capturedAt?.toISOString(),
      releasedAt: row.releasedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      operator: row.operator ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private buildFinancePreAuthorizationRowsFromTransactions(
    rows: any[]
  ): FinancePreAuthorizationRow[] {
    type FinancePreAuthorizationTransactionGroup = {
      orderId?: string;
      orderNo?: string;
      memberId?: string;
      corporateId?: string;
      corporateShortName?: string;
      customerName?: string;
      frozenAmount: number;
      capturedAmount: number;
      releasedAmount: number;
      firstAt?: Date;
      lastAt?: Date;
      operator?: string;
      note?: string;
    };
    const grouped = new Map<
      string,
      FinancePreAuthorizationTransactionGroup
    >();

    for (const row of rows) {
      const key = row.orderId || row.order?.orderNo || row.id;
      const current: FinancePreAuthorizationTransactionGroup =
        grouped.get(key) ??
        {
          orderId: row.orderId ?? row.order?.id,
          orderNo: row.order?.orderNo,
          memberId: row.order?.memberId,
          corporateId: row.order?.corporateId,
          corporateShortName: row.order?.corporateShortName,
          customerName: row.order?.customerName,
          frozenAmount: 0,
          capturedAmount: 0,
          releasedAmount: 0
        };
      const amount = Number(row.amount);
      if (row.type === "pre_auth_freeze") {
        current.frozenAmount += amount;
      }
      if (row.type === "pre_auth_capture") {
        current.capturedAmount += amount;
      }
      if (row.type === "pre_auth_release") {
        current.releasedAmount += amount;
      }
      current.firstAt =
        !current.firstAt || row.createdAt < current.firstAt ? row.createdAt : current.firstAt;
      current.lastAt =
        !current.lastAt || row.createdAt > current.lastAt ? row.createdAt : current.lastAt;
      current.operator = row.operator ?? current.operator;
      current.note = row.note ?? current.note;
      grouped.set(key, current);
    }

    return [...grouped.entries()]
      .filter(([, item]) => item.frozenAmount > 0)
      .map(([key, item]) => {
        const remainingAmount = Math.max(
          0,
          item.frozenAmount - item.capturedAmount - item.releasedAmount
        );
        const status: FinancePreAuthorizationRow["status"] =
          remainingAmount <= 0
            ? item.capturedAmount > 0 && item.releasedAmount <= 0
              ? "captured"
              : "released"
            : item.capturedAmount > 0
              ? "partially_captured"
              : "frozen";
        return {
          id: `finance_preauth_derived_${key}`,
          preAuthNo: `PA-${item.orderNo ?? key}`,
          orderId: item.orderId,
          orderNo: item.orderNo,
          memberId: item.memberId,
          corporateId: item.corporateId,
          corporateShortName: item.corporateShortName,
          customerName: item.customerName,
          status,
          channel: "online",
          provider: "mock_payment",
          authorizedAmount: item.frozenAmount,
          capturedAmount: item.capturedAmount,
          releasedAmount: item.releasedAmount,
          remainingAmount,
          currency: "CNY",
          paymentMethod: "线上预授权",
          frozenAt: item.firstAt?.toISOString(),
          capturedAt: item.capturedAmount > 0 ? item.lastAt?.toISOString() : undefined,
          releasedAt: item.releasedAmount > 0 ? item.lastAt?.toISOString() : undefined,
          operator: item.operator,
          remark: item.note || "由订单预授权资金流水派生",
          createdAt: item.firstAt?.toISOString() ?? new Date().toISOString()
        };
      });
  }

  private toFinanceReconciliationFromTransaction(row: any): FinanceReconciliationRow {
    const status = this.toTransactionStatus(row.status);
    return {
      id: `txn_${row.id}`,
      sourceType: "transaction",
      sourceNo: row.id,
      occurredAt: row.createdAt.toISOString(),
      counterparty:
        row.order?.corporateShortName ?? row.order?.customerName ?? "客户自付订单",
      amount: Number(row.amount),
      status:
        status === "failed" ? "exception" : status === "pending" ? "pending" : "matched",
      issue:
        status === "failed"
          ? "资金记录失败，需核对支付/预授权渠道返回"
          : status === "pending"
            ? "资金记录待处理"
            : undefined,
      suggestedAction:
        status === "failed"
          ? "核对渠道流水后重新登记或作废"
          : status === "pending"
            ? "等待渠道回调或人工确认"
            : undefined
    };
  }

  private toFinanceReconciliationFromMonthlyBill(row: any): FinanceReconciliationRow {
    const balanceAmount = Number(row.balanceAmount);
    const overdue = row.dueDate.getTime() < Date.now() && balanceAmount > 0;
    return {
      id: `bill_${row.id}`,
      sourceType: "monthly_bill",
      sourceNo: row.billNo,
      occurredAt: row.updatedAt.toISOString(),
      counterparty: row.corporate?.shortName ?? "企业客户",
      amount: balanceAmount,
      status:
        balanceAmount <= 0 ? "matched" : overdue ? "exception" : "pending",
      issue: overdue ? "企业月结账单已逾期未回款" : balanceAmount > 0 ? "企业账单待回款" : undefined,
      suggestedAction: overdue
        ? "联系企业财务并评估暂停新单配额"
        : balanceAmount > 0
          ? "等待回款或登记线下回款"
          : undefined
    };
  }

  private toFinanceReconciliationFromAdjustment(row: any): FinanceReconciliationRow {
    const status = this.toSharedFinanceAdjustmentStatus(row.status);
    return {
      id: `adj_${row.id}`,
      sourceType: "manual_adjustment",
      sourceNo: row.adjustmentNo,
      occurredAt: row.createdAt.toISOString(),
      counterparty: row.corporateShortName ?? row.customerName ?? "手工调账",
      amount: Number(row.amount),
      status:
        status === "rejected"
          ? "exception"
          : status === "posted" || status === "approved"
            ? "matched"
            : "pending",
      issue:
        status === "pending"
          ? "手工调账待审核"
          : status === "rejected"
            ? "手工调账已驳回"
            : undefined,
      suggestedAction:
        status === "pending"
          ? "由具备财务调账权限的人员审核"
          : status === "rejected"
            ? "补充原因后重新提交"
            : undefined
    };
  }

  private toCorporateMonthlyBillSummary(row: any): CorporateMonthlyBillSummary {
    return {
      id: row.id,
      billNo: row.billNo,
      corporateId: row.corporateId,
      corporateShortName: row.corporate?.shortName ?? "",
      period: row.period,
      status: this.toSharedMonthlyBillStatus(row.status),
      generatedAt: row.createdAt.toISOString(),
      dueDate: row.dueDate.toISOString(),
      orderCount: row.orderCount,
      totalAmount: Number(row.totalAmount),
      paidAmount: Number(row.paidAmount),
      balanceAmount: Number(row.balanceAmount),
      lineItems: (row.lineItems ?? []).map((line: any) => ({
        id: line.id,
        orderId: line.orderId ?? "",
        orderNo: line.orderNo,
        occurredAt: line.createdAt.toISOString(),
        customerName: line.customerName,
        vehicleGroupName: line.vehicleGroupName,
        pickupStoreName: line.pickupStoreName,
        returnStoreName: line.returnStoreName,
        amount: Number(line.amount),
        feeCodes: [],
        remark: line.remark ?? undefined
      }))
    };
  }

  private toVehicleMaintenanceRecord(row: {
    id: string;
    createdAt: Date;
    type: string;
    vendor: string;
    mileage: number;
    costAmount: Prisma.Decimal;
    status: string;
    nextDueAt?: Date | null;
    nextDueMileage?: number | null;
    attachments?: Prisma.JsonValue | null;
    operator?: string | null;
    remark: string | null;
  }): VehicleMaintenanceRecord {
    return {
      id: row.id,
      date: row.createdAt.toISOString().slice(0, 10),
      type: row.type,
      vendor: row.vendor,
      mileage: row.mileage,
      costAmount: Number(row.costAmount),
      status: this.toMaintenanceStatus(row.status),
      nextDueAt: row.nextDueAt?.toISOString().slice(0, 10),
      nextDueMileage: row.nextDueMileage ?? undefined,
      attachments: this.stringArray(row.attachments),
      operator: row.operator ?? "营运端",
      remark: row.remark ?? undefined
    };
  }

  private toVehicleAccidentRecord(row: {
    id: string;
    createdAt: Date;
    description: string;
    claimStatus: string;
    estimatedCostAmount: Prisma.Decimal;
    reportNo: string | null;
  }): VehicleAccidentRecord {
    return {
      id: row.id,
      date: row.createdAt.toISOString().slice(0, 10),
      description: row.description,
      claimStatus: this.toAccidentClaimStatus(row.claimStatus),
      estimatedCostAmount: Number(row.estimatedCostAmount),
      reportNo: row.reportNo ?? ""
    };
  }

  private vehicleGroupDisplayName(group: VehicleGroupMaster) {
    return `${group.brand} ${group.model} / ${group.storeProductGroupName}`;
  }

  private stationServiceTypes(input: StoreStationSummary) {
    return [
      ...(input.storeRentalEnabled ? ["STORE_STANDARD"] : []),
      ...(input.storeSelfServiceEnabled ? ["STORE_24H"] : [])
    ];
  }

  private metadata(input: unknown): Metadata {
    return JSON.parse(JSON.stringify(input ?? {})) as Metadata;
  }

  private objectMetadata(value: unknown): Metadata {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Metadata)
      : {};
  }

  private stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
  }

  private numberValue(value: unknown) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private booleanValue(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
  }

  private financeDocumentAuditTrail(
    value: unknown
  ): FinanceDocumentRow["auditTrail"] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((record): record is NonNullable<FinanceDocumentRow["auditTrail"]>[number] => {
        if (!record || typeof record !== "object") {
          return false;
        }
        const candidate = record as Record<string, unknown>;
        return Boolean(this.stringValue(candidate.at));
      })
      .map((record) => ({
        at: record.at,
        operator: record.operator,
        action: record.action,
        remark: record.remark,
        relatedDocumentNo: record.relatedDocumentNo,
        relatedFeeIds: this.stringArray(record.relatedFeeIds)
      }));
  }

  private appendFinanceDocumentAuditTrail(
    value: unknown,
    item: NonNullable<FinanceDocumentRow["auditTrail"]>[number]
  ): FinanceDocumentRow["auditTrail"] {
    return [...this.financeDocumentAuditTrail(value), item].slice(-20);
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private toPrismaStoreRentalMode(
    mode: StoreRentalOrderSummary["mode"]
  ): PrismaStoreRentalMode {
    return mode === StoreRentalMode.SelfService24h
      ? PrismaStoreRentalMode.SELF_SERVICE_24H
      : PrismaStoreRentalMode.STORE_RENTAL;
  }

  private toSharedStoreRentalMode(
    mode: PrismaStoreRentalMode
  ): StoreRentalOrderSummary["mode"] {
    return mode === PrismaStoreRentalMode.SELF_SERVICE_24H
      ? StoreRentalMode.SelfService24h
      : StoreRentalMode.Store;
  }

  private toPrismaOrderMainStatus(
    status: StoreRentalOrderSummary["mainStatus"]
  ): PrismaOrderMainStatus {
    const map: Record<StoreRentalOrderSummary["mainStatus"], PrismaOrderMainStatus> = {
      pending_payment: PrismaOrderMainStatus.PENDING_PAYMENT,
      reserved: PrismaOrderMainStatus.RESERVED,
      pickup_overdue: PrismaOrderMainStatus.PICKUP_OVERDUE,
      inspecting: PrismaOrderMainStatus.INSPECTING,
      renting: PrismaOrderMainStatus.RENTING,
      renewing: PrismaOrderMainStatus.RENEWING,
      overdue: PrismaOrderMainStatus.OVERDUE,
      accident_processing: PrismaOrderMainStatus.ACCIDENT_PROCESSING,
      settlement_pending: PrismaOrderMainStatus.SETTLEMENT_PENDING,
      payment_due: PrismaOrderMainStatus.PAYMENT_DUE,
      refund_pending: PrismaOrderMainStatus.REFUND_PENDING,
      completed: PrismaOrderMainStatus.COMPLETED,
      cancelled: PrismaOrderMainStatus.CANCELLED,
      no_show: PrismaOrderMainStatus.NO_SHOW,
      rejected: PrismaOrderMainStatus.REJECTED,
      closed: PrismaOrderMainStatus.CLOSED
    };
    return map[status] ?? PrismaOrderMainStatus.RESERVED;
  }

  private toSharedOrderMainStatus(
    status: PrismaOrderMainStatus
  ): StoreRentalOrderSummary["mainStatus"] {
    const map: Record<PrismaOrderMainStatus, StoreRentalOrderSummary["mainStatus"]> = {
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
    return map[status] ?? OrderMainStatus.Reserved;
  }

  private toPrismaDispatchStatus(
    status: StoreRentalOrderSummary["dispatchStatus"]
  ): PrismaDispatchStatus {
    const map: Record<StoreRentalOrderSummary["dispatchStatus"], PrismaDispatchStatus> = {
      pending: PrismaDispatchStatus.PENDING,
      pre_assigned: PrismaDispatchStatus.PRE_ASSIGNED,
      locked: PrismaDispatchStatus.LOCKED,
      manual_reassigned: PrismaDispatchStatus.MANUAL_REASSIGNED,
      upgraded: PrismaDispatchStatus.UPGRADED,
      dispatch_manual_required: PrismaDispatchStatus.MANUAL_REQUIRED
    };
    return map[status] ?? PrismaDispatchStatus.PENDING;
  }

  private toSharedDispatchStatus(
    status: PrismaDispatchStatus
  ): StoreRentalOrderSummary["dispatchStatus"] {
    const map: Record<PrismaDispatchStatus, StoreRentalOrderSummary["dispatchStatus"]> = {
      PENDING: DispatchStatus.Pending,
      PRE_ASSIGNED: DispatchStatus.PreAssigned,
      LOCKED: DispatchStatus.Locked,
      MANUAL_REASSIGNED: DispatchStatus.ManualReassigned,
      UPGRADED: DispatchStatus.Upgraded,
      MANUAL_REQUIRED: DispatchStatus.ManualRequired
    };
    return map[status] ?? DispatchStatus.Pending;
  }

  private toPrismaPaymentStatus(
    status: StoreRentalOrderSummary["paymentStatus"]
  ): PrismaPaymentStatus {
    const map: Record<StoreRentalOrderSummary["paymentStatus"], PrismaPaymentStatus> = {
      unpaid: PrismaPaymentStatus.UNPAID,
      deposit_paid: PrismaPaymentStatus.DEPOSIT_PAID,
      monthly_billing: PrismaPaymentStatus.MONTHLY_BILLING,
      partial_paid: PrismaPaymentStatus.PARTIAL_PAID,
      paid: PrismaPaymentStatus.PAID,
      payment_due: PrismaPaymentStatus.PAYMENT_DUE,
      refund_pending: PrismaPaymentStatus.REFUND_PENDING,
      refunded: PrismaPaymentStatus.REFUNDED
    };
    return map[status] ?? PrismaPaymentStatus.UNPAID;
  }

  private toSharedPaymentStatus(
    status: PrismaPaymentStatus
  ): StoreRentalOrderSummary["paymentStatus"] {
    const map: Record<PrismaPaymentStatus, StoreRentalOrderSummary["paymentStatus"]> = {
      UNPAID: PaymentStatus.Unpaid,
      DEPOSIT_PAID: PaymentStatus.DepositPaid,
      MONTHLY_BILLING: PaymentStatus.MonthlyBilling,
      PARTIAL_PAID: PaymentStatus.PartialPaid,
      PAID: PaymentStatus.Paid,
      PAYMENT_DUE: PaymentStatus.PaymentDue,
      REFUND_PENDING: PaymentStatus.RefundPending,
      REFUNDED: PaymentStatus.Refunded
    };
    return map[status] ?? PaymentStatus.Unpaid;
  }

  private toPrismaBillingMode(
    mode: StoreRentalOrderSummary["billingMode"]
  ): PrismaBillingMode {
    return mode === BillingMode.Monthly ? PrismaBillingMode.MONTHLY : PrismaBillingMode.CUSTOMER_PAY;
  }

  private toSharedBillingMode(mode: PrismaBillingMode): StoreRentalOrderSummary["billingMode"] {
    return mode === PrismaBillingMode.MONTHLY ? BillingMode.Monthly : BillingMode.CustomerPay;
  }

  private toPrismaFeeStage(stage: StoreRentalFeeLedgerItem["stage"]): PrismaFeeStage {
    const map: Partial<Record<StoreRentalFeeLedgerItem["stage"], PrismaFeeStage>> = {
      rental: PrismaFeeStage.RENTAL,
      booking: PrismaFeeStage.RENTAL,
      pickup: PrismaFeeStage.PICKUP,
      return_settlement: PrismaFeeStage.RETURN_SETTLEMENT,
      cancellation: PrismaFeeStage.CANCELLATION,
      post_charge: PrismaFeeStage.POST_CHARGE
    };
    return map[stage] ?? PrismaFeeStage.RENTAL;
  }

  private toSharedFeeStage(value: string): StoreRentalFeeLedgerItem["stage"] {
    if (
      value === "booking" ||
      value === "rental" ||
      value === "pickup" ||
      value === "return_settlement" ||
      value === "cancellation" ||
      value === "post_charge"
    ) {
      return value;
    }
    return "rental";
  }

  private toPrismaFeeDirection(
    direction: StoreRentalFeeLedgerItem["direction"]
  ): PrismaFeeDirection {
    const map: Record<StoreRentalFeeLedgerItem["direction"], PrismaFeeDirection> = {
      charge: PrismaFeeDirection.CHARGE,
      refund: PrismaFeeDirection.REFUND,
      waiver: PrismaFeeDirection.WAIVER
    };
    return map[direction] ?? PrismaFeeDirection.CHARGE;
  }

  private toSharedFeeDirection(
    direction: PrismaFeeDirection
  ): StoreRentalFeeLedgerItem["direction"] {
    const map: Record<PrismaFeeDirection, StoreRentalFeeLedgerItem["direction"]> = {
      CHARGE: "charge",
      REFUND: "refund",
      WAIVER: "waiver"
    };
    return map[direction] ?? "charge";
  }

  private toPrismaFeeStatus(status: StoreRentalFeeLedgerItem["status"]): PrismaFeeStatus {
    const map: Record<StoreRentalFeeLedgerItem["status"], PrismaFeeStatus> = {
      pending: PrismaFeeStatus.PENDING,
      settled: PrismaFeeStatus.SETTLED,
      waived: PrismaFeeStatus.WAIVED,
      monthly_billing: PrismaFeeStatus.MONTHLY_BILLING,
      voided: PrismaFeeStatus.VOIDED
    };
    return map[status] ?? PrismaFeeStatus.PENDING;
  }

  private toSharedFeeStatus(status: PrismaFeeStatus): StoreRentalFeeLedgerItem["status"] {
    const map: Record<PrismaFeeStatus, StoreRentalFeeLedgerItem["status"]> = {
      PENDING: "pending",
      SETTLED: "settled",
      WAIVED: "waived",
      MONTHLY_BILLING: "monthly_billing",
      VOIDED: "voided"
    };
    return map[status] ?? "pending";
  }

  private toSharedFeeInvoicedStatus(raw: string | null | undefined): "none" | "invoiced" | "invoice_voided" {
    if (raw === "invoiced") return "invoiced";
    if (raw === "invoice_voided") return "invoice_voided";
    return "none";
  }

  private toPrismaFinanceDocumentType(
    type: SaveFinanceDocumentRequest["type"]
  ): PrismaFinanceDocumentType {
    return type === "receipt"
      ? PrismaFinanceDocumentType.RECEIPT
      : PrismaFinanceDocumentType.INVOICE;
  }

  private toPrismaFinanceDocumentStatus(
    status: SaveFinanceDocumentRequest["status"]
  ): PrismaFinanceDocumentStatus {
    const map: Record<
      SaveFinanceDocumentRequest["status"],
      PrismaFinanceDocumentStatus
    > = {
      draft: PrismaFinanceDocumentStatus.DRAFT,
      issued: PrismaFinanceDocumentStatus.ISSUED,
      sent: PrismaFinanceDocumentStatus.SENT,
      voided: PrismaFinanceDocumentStatus.VOIDED
    };
    return map[status] ?? PrismaFinanceDocumentStatus.DRAFT;
  }

  private toSharedFinanceDocumentStatus(
    status: PrismaFinanceDocumentStatus
  ): FinanceDocumentRow["status"] {
    const map: Record<PrismaFinanceDocumentStatus, FinanceDocumentRow["status"]> = {
      DRAFT: "draft",
      ISSUED: "issued",
      SENT: "sent",
      VOIDED: "voided"
    };
    return map[status] ?? "draft";
  }

  private toPrismaFinanceAdjustmentDirection(
    direction: SaveFinanceManualAdjustmentRequest["direction"]
  ): PrismaFinanceManualAdjustmentDirection {
    const map: Record<
      SaveFinanceManualAdjustmentRequest["direction"],
      PrismaFinanceManualAdjustmentDirection
    > = {
      charge: PrismaFinanceManualAdjustmentDirection.CHARGE,
      refund: PrismaFinanceManualAdjustmentDirection.REFUND,
      waiver: PrismaFinanceManualAdjustmentDirection.WAIVER
    };
    return map[direction] ?? PrismaFinanceManualAdjustmentDirection.CHARGE;
  }

  private toSharedFinanceAdjustmentDirection(
    direction: PrismaFinanceManualAdjustmentDirection
  ): FinanceManualAdjustmentRow["direction"] {
    const map: Record<
      PrismaFinanceManualAdjustmentDirection,
      FinanceManualAdjustmentRow["direction"]
    > = {
      CHARGE: "charge",
      REFUND: "refund",
      WAIVER: "waiver"
    };
    return map[direction] ?? "charge";
  }

  private toSharedFinanceAdjustmentStatus(
    status: PrismaFinanceManualAdjustmentStatus
  ): FinanceManualAdjustmentRow["status"] {
    const map: Record<
      PrismaFinanceManualAdjustmentStatus,
      FinanceManualAdjustmentRow["status"]
    > = {
      PENDING: "pending",
      APPROVED: "approved",
      REJECTED: "rejected",
      POSTED: "posted"
    };
    return map[status] ?? "pending";
  }

  private toPrismaFinancePreAuthorizationStatus(
    status: SaveFinancePreAuthorizationRequest["status"]
  ): PrismaFinancePreAuthorizationStatus {
    const map: Record<
      SaveFinancePreAuthorizationRequest["status"],
      PrismaFinancePreAuthorizationStatus
    > = {
      pending: PrismaFinancePreAuthorizationStatus.PENDING,
      frozen: PrismaFinancePreAuthorizationStatus.FROZEN,
      partially_captured: PrismaFinancePreAuthorizationStatus.PARTIALLY_CAPTURED,
      captured: PrismaFinancePreAuthorizationStatus.CAPTURED,
      released: PrismaFinancePreAuthorizationStatus.RELEASED,
      expired: PrismaFinancePreAuthorizationStatus.EXPIRED,
      failed: PrismaFinancePreAuthorizationStatus.FAILED
    };
    return map[status] ?? PrismaFinancePreAuthorizationStatus.PENDING;
  }

  private toSharedFinancePreAuthorizationStatus(
    status: PrismaFinancePreAuthorizationStatus
  ): FinancePreAuthorizationRow["status"] {
    const map: Record<
      PrismaFinancePreAuthorizationStatus,
      FinancePreAuthorizationRow["status"]
    > = {
      PENDING: "pending",
      FROZEN: "frozen",
      PARTIALLY_CAPTURED: "partially_captured",
      CAPTURED: "captured",
      RELEASED: "released",
      EXPIRED: "expired",
      FAILED: "failed"
    };
    return map[status] ?? "pending";
  }

  private toPrismaFinancePreAuthorizationChannel(
    channel: SaveFinancePreAuthorizationRequest["channel"]
  ): PrismaFinancePreAuthorizationChannel {
    const map: Record<
      SaveFinancePreAuthorizationRequest["channel"],
      PrismaFinancePreAuthorizationChannel
    > = {
      online: PrismaFinancePreAuthorizationChannel.ONLINE,
      offline: PrismaFinancePreAuthorizationChannel.OFFLINE,
      internal: PrismaFinancePreAuthorizationChannel.INTERNAL
    };
    return map[channel] ?? PrismaFinancePreAuthorizationChannel.ONLINE;
  }

  private toSharedFinancePreAuthorizationChannel(
    channel: PrismaFinancePreAuthorizationChannel
  ): FinancePreAuthorizationRow["channel"] {
    const map: Record<
      PrismaFinancePreAuthorizationChannel,
      FinancePreAuthorizationRow["channel"]
    > = {
      ONLINE: "online",
      OFFLINE: "offline",
      INTERNAL: "internal"
    };
    return map[channel] ?? "online";
  }

  private toOperationLockStatus(
    value: string | undefined
  ): StoreRentalOrderSummary["operationLockStatus"] {
    if (value === "active") {
      return OperationLockStatus.Active;
    }
    if (value === "interrupted") {
      return OperationLockStatus.Interrupted;
    }
    if (value === "expired") {
      return OperationLockStatus.Expired;
    }
    if (value === "released") {
      return OperationLockStatus.Released;
    }
    return undefined;
  }

  private toTransactionType(value: string): StoreRentalTransactionRecord["type"] {
    if (
      value === "pre_auth_freeze" ||
      value === "pre_auth_release" ||
      value === "pre_auth_capture" ||
      value === "payment" ||
      value === "refund" ||
      value === "waiver" ||
      value === "monthly_bill"
    ) {
      return value;
    }
    return "payment";
  }

  private toTransactionChannel(
    value: string | null
  ): StoreRentalTransactionRecord["channel"] {
    if (value === "online" || value === "offline" || value === "internal") {
      return value;
    }
    return "internal";
  }

  private toTransactionStatus(value: string): StoreRentalTransactionRecord["status"] {
    if (value === "pending" || value === "success" || value === "failed") {
      return value;
    }
    return "success";
  }

  private cleanlinessValue(value: string | null): StoreRentalInspectionRecord["cleanliness"] {
    return value === "clean" || value === "dirty" ? value : "normal";
  }

  private toSharedMonthlyBillStatus(
    status: PrismaMonthlyBillStatus
  ): CorporateMonthlyBillSummary["status"] {
    const map: Record<PrismaMonthlyBillStatus, CorporateMonthlyBillSummary["status"]> = {
      DRAFT: "draft",
      POSTED: "posted",
      PARTIALLY_PAID: "partially_paid",
      PAID: "paid",
      VOID: "void"
    };
    return map[status] ?? "posted";
  }

  private toPrismaConfigStatus(
    status: MembershipPlanSummary["status"]
  ): PrismaConfigStatus {
    return status === "enabled"
      ? PrismaConfigStatus.EFFECTIVE
      : PrismaConfigStatus.ARCHIVED;
  }

  private toSharedConfigStatus(status: string): StoreRentalRuleConfig["status"] {
    if (status === "draft" || status === "archived") {
      return status === "draft" ? ConfigStatus.Draft : ConfigStatus.Archived;
    }
    return ConfigStatus.Effective;
  }

  private toPrismaMemberStatus(
    status: MemberSummary["status"]
  ): PrismaMemberStatus {
    const map: Record<MemberSummary["status"], PrismaMemberStatus> = {
      pending_review: PrismaMemberStatus.PENDING_REVIEW,
      active: PrismaMemberStatus.ACTIVE,
      suspended: PrismaMemberStatus.SUSPENDED,
      blacklisted: PrismaMemberStatus.BLACKLISTED
    };
    return map[status] ?? PrismaMemberStatus.PENDING_REVIEW;
  }

  private toPrismaMemberReviewStatus(
    status: MemberSummary["reviewStatus"]
  ): PrismaMemberReviewStatus {
    const map: Record<MemberSummary["reviewStatus"], PrismaMemberReviewStatus> = {
      pending: PrismaMemberReviewStatus.PENDING,
      approved: PrismaMemberReviewStatus.APPROVED,
      rejected: PrismaMemberReviewStatus.REJECTED
    };
    return map[status] ?? PrismaMemberReviewStatus.PENDING;
  }

  private toSharedMemberStatus(
    status: PrismaMemberStatus
  ): MemberSummary["status"] {
    const map: Record<PrismaMemberStatus, MemberSummary["status"]> = {
      PENDING_REVIEW: "pending_review",
      ACTIVE: "active",
      SUSPENDED: "suspended",
      BLACKLISTED: "blacklisted"
    };
    return map[status] ?? "pending_review";
  }

  private toSharedMemberReviewStatus(
    status: PrismaMemberReviewStatus
  ): MemberSummary["reviewStatus"] {
    const map: Record<PrismaMemberReviewStatus, MemberSummary["reviewStatus"]> = {
      PENDING: "pending",
      APPROVED: "approved",
      REJECTED: "rejected"
    };
    return map[status] ?? "pending";
  }

  private toPrismaCorporateStatus(
    status: CorporateSummary["status"]
  ): PrismaCorporateStatus {
    const map: Record<CorporateSummary["status"], PrismaCorporateStatus> = {
      active: PrismaCorporateStatus.ACTIVE,
      paused: PrismaCorporateStatus.PAUSED,
      disabled: PrismaCorporateStatus.DISABLED
    };
    return map[status] ?? PrismaCorporateStatus.ACTIVE;
  }

  private normalizeCorporateStatusFilter(value: unknown): CorporateSummary["status"] | undefined {
    return ["active", "paused", "disabled"].includes(String(value))
      ? (value as CorporateSummary["status"])
      : undefined;
  }

  private normalizeCorporateContractStatusFilter(
    value: unknown
  ): CorporateSummary["contractStatus"] | undefined {
    return ["active", "expiring", "expired"].includes(String(value))
      ? (value as CorporateSummary["contractStatus"])
      : undefined;
  }

  private toSharedCorporateStatus(
    status: PrismaCorporateStatus
  ): CorporateSummary["status"] {
    const map: Record<PrismaCorporateStatus, CorporateSummary["status"]> = {
      ACTIVE: "active",
      PAUSED: "paused",
      DISABLED: "disabled"
    };
    return map[status] ?? "active";
  }

  private toPrismaSettlementMode(
    mode: CorporateSummary["settlementMode"]
  ): PrismaSettlementMode {
    return mode === "prepaid"
      ? PrismaSettlementMode.PREPAID
      : PrismaSettlementMode.MONTHLY;
  }

  private toSharedSettlementMode(
    mode: PrismaSettlementMode
  ): CorporateSummary["settlementMode"] {
    return mode === PrismaSettlementMode.PREPAID ? "prepaid" : "monthly";
  }

  private toCorporateContractStatus(
    value: string
  ): CorporateDetail["contracts"][number]["status"] {
    if (
      value === "draft" ||
      value === "active" ||
      value === "expiring" ||
      value === "expired" ||
      value === "terminated"
    ) {
      return value;
    }
    return "draft";
  }

  private resolveCorporateContractStatus(
    contracts: Array<{ status: string; endDate?: Date | null }>
  ): CorporateSummary["contractStatus"] {
    const today = new Date();
    const hasActive = contracts.some((contract) => contract.status === "active");
    const hasExpiring = contracts.some((contract) => {
      if (contract.status === "expiring") {
        return true;
      }
      if (!contract.endDate || contract.status !== "active") {
        return false;
      }
      const daysToEnd =
        (contract.endDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
      return daysToEnd >= 0 && daysToEnd <= 30;
    });
    if (hasExpiring) {
      return "expiring";
    }
    if (hasActive) {
      return "active";
    }
    return "expired";
  }

  private toLocationEventType(value: string): VehicleLocationEvent["type"] {
    if (
      value === "pickup" ||
      value === "return" ||
      value === "transfer" ||
      value === "manual_adjust" ||
      value === "iot_sync"
    ) {
      return value;
    }
    return "manual_adjust";
  }

  private toLocationEventSource(value: string): VehicleLocationEvent["source"] {
    if (value === "order" || value === "operation" || value === "iot") {
      return value;
    }
    return "operation";
  }

  private toConditionPhotoScene(value: string): VehicleConditionPhotoRecord["scene"] {
    if (
      value === "pickup" ||
      value === "return" ||
      value === "maintenance" ||
      value === "manual"
    ) {
      return value;
    }
    return "manual";
  }

  private toMaintenanceStatus(value: string): VehicleMaintenanceRecord["status"] {
    if (value === "pending" || value === "processing" || value === "completed") {
      return value;
    }
    return "processing";
  }

  private toAccidentClaimStatus(value: string): VehicleAccidentRecord["claimStatus"] {
    if (value === "pending" || value === "processing" || value === "closed") {
      return value;
    }
    return "processing";
  }

  private toCredentialType(value: string): VehicleCredentialRecord["credentialType"] {
    if (
      value === "license" ||
      value === "insurance" ||
      value === "inspection" ||
      value === "permit" ||
      value === "other"
    ) {
      return value;
    }
    return "other";
  }

  private toCredentialStatus(value: string): VehicleCredentialRecord["status"] {
    if (
      value === "valid" ||
      value === "expiring" ||
      value === "expired" ||
      value === "missing"
    ) {
      return value;
    }
    return "missing";
  }

  private resolveCredentialStatus(expiresAt: string | undefined): VehicleCredentialRecord["status"] {
    if (!expiresAt) {
      return "missing";
    }
    const expires = new Date(expiresAt).getTime();
    if (!Number.isFinite(expires)) {
      return "missing";
    }
    const days = Math.ceil((expires - Date.now()) / 86_400_000);
    if (days < 0) {
      return "expired";
    }
    if (days <= 30) {
      return "expiring";
    }
    return "valid";
  }

  private toOnboardItemCategory(value: string): VehicleOnboardItemRecord["category"] {
    if (
      value === "key" ||
      value === "document" ||
      value === "equipment" ||
      value === "cleaning" ||
      value === "other"
    ) {
      return value;
    }
    return "other";
  }

  private toOnboardItemStatus(value: string): VehicleOnboardItemRecord["status"] {
    if (value === "missing" || value === "damaged") {
      return value;
    }
    return "normal";
  }

  private toTboxCommand(value: string): TboxCommandRecord["command"] {
    if (
      value === "LOCK_DOOR" ||
      value === "UNLOCK_DOOR" ||
      value === "FIND_CAR" ||
      value === "SYNC_STATUS"
    ) {
      return value;
    }
    return "SYNC_STATUS";
  }

  private toStationBusinessStatus(value: string): StationCalendarDay["businessStatus"] {
    if (value === "closed" || value === "paused") {
      return value;
    }
    return "open";
  }

  private serviceTypeArray(
    value: Prisma.JsonValue
  ): VehicleInstanceSummary["serviceTypes"] {
    const values = this.stringArray(value).filter(
      (item): item is VehicleInstanceSummary["serviceTypes"][number] =>
        item === "STORE_STANDARD" || item === "STORE_24H"
    );
    return values.length > 0 ? values : ["STORE_STANDARD"];
  }

  private toStationServiceStatus(value: string): StoreStationSummary["serviceStatus"] {
    if (value === "paused" || value === "maintenance") {
      return value;
    }
    return "normal";
  }

  private toServiceAbilityStatus(value: string): "normal" | "paused" {
    return value === "paused" ? "paused" : "normal";
  }

  private parseLuggageCount(value: string | undefined) {
    const matched = value?.match(/\d+/)?.[0];
    return matched ? Number(matched) : undefined;
  }

  private defaultDailyPrice(code: string) {
    const prices: Record<string, number> = {
      VG_ECONOMY: 620,
      VG_SEVEN: 980,
      VG_EV: 1080
    };
    return prices[code] ?? 0;
  }

  private toPrismaOperationStatus(status: VehicleInstanceSummary["operationStatus"]) {
    const map: Record<
      VehicleInstanceSummary["operationStatus"],
      PrismaVehicleOperationStatus
    > = {
      idle: PrismaVehicleOperationStatus.IDLE,
      reserved: PrismaVehicleOperationStatus.RESERVED,
      renting: PrismaVehicleOperationStatus.RENTING,
      controlled: PrismaVehicleOperationStatus.CONTROLLED,
      maintenance: PrismaVehicleOperationStatus.MAINTENANCE,
      disabled: PrismaVehicleOperationStatus.DISABLED
    };
    return map[status] ?? PrismaVehicleOperationStatus.IDLE;
  }

  private toSharedOperationStatus(
    status: PrismaVehicleOperationStatus
  ): VehicleInstanceSummary["operationStatus"] {
    const map: Record<PrismaVehicleOperationStatus, VehicleInstanceSummary["operationStatus"]> = {
      IDLE: "idle",
      RESERVED: "reserved",
      RENTING: "renting",
      CONTROLLED: "controlled",
      MAINTENANCE: "maintenance",
      DISABLED: "disabled"
    };
    return map[status] ?? "idle";
  }

  private toPrismaServiceType(
    type: VehicleInstanceSummary["currentServiceType"]
  ): PrismaVehicleServiceType {
    return type === "STORE_24H"
      ? PrismaVehicleServiceType.STORE_24H
      : PrismaVehicleServiceType.STORE_STANDARD;
  }

  private toSharedServiceType(
    type: PrismaVehicleServiceType
  ): VehicleInstanceSummary["currentServiceType"] {
    return type === PrismaVehicleServiceType.STORE_24H
      ? "STORE_24H"
      : "STORE_STANDARD";
  }

  private nextRentalRuleVersionId(versionNo: number, savedAt: string) {
    const date = savedAt.slice(0, 10).replace(/-/g, "");
    return `RULE-STORE-${date}-${String(versionNo).padStart(3, "0")}`;
  }

  async createOperationLog(input: {
    targetType: string;
    targetId: string;
    action: string;
    operator: string;
    detail: string;
    createdAt: string;
  }) {
    await this.prisma.operationLog.create({
      data: {
        tenantId: this.defaultTenantId,
        action: input.action,
        detail: {
          targetType: input.targetType,
          targetId: input.targetId,
          operator: input.operator,
          description: input.detail
        },
        createdAt: new Date(input.createdAt)
      }
    });
  }
}

function cryptoRandomId() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function maskPhone(phone: string) {
  const trimmed = phone.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
