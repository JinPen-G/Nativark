import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { usageDelta } from "./rental-usage-reading";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type $Enums } from "@prisma/client";
import {
  RentalAssetStatus,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  RentalReservationStatus,
  type RentalAllocation,
  type RentalAsset,
  type RentalAssetStatusHistory,
  type RentalAssetStatusHistorySource,
  type RentalCategoryCode,
  type RentalFulfillmentLocationSnapshot,
  type RentalFulfillmentMode,
  type RentalInspectionRecord,
  type CorrectRentalInspectionUsageRequest,
  type RentalOrder,
  type RentalOrderListQuery,
  type RentalOrderChange,
  type RentalOrderExtension,
  type RentalOrderLine,
  type RentalQuoteChargeLine,
  type RentalReservation,
  type RentalRuleConfig,
  type RentalStockBalance,
  type RentalStockLedgerEntry,
  type RentalStockLedgerOperationType,
  type RentalStockOperationRequest,
  type RentalStockOperationType,
  type RentalStockDisposition,
  type RentalWorkOrder,
  type RentalWorkOrderAssignee,
  type RentalWorkOrderHistoryEntry,
  type RentalWorkOrderStatus
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from '../ai-native/business-events/prisma-business-failure-outbox';
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { validateActiveCategoryWrite, type CategoryWriteBinding } from "./category-active-write";
import { bufferedRentalPeriod, peakReservedQuantity } from "./rental-occupancy";
import { rentalOrderDueAt } from "./rental-carrier-shipment";
import { rentalOrderListSort } from "./rental-order-list-sort";
import { allocateRentalOrderNumber } from "./rental-order-number";
import { effectiveUnpaidHoldRule } from "./rental-rule-defaults";
import { enabledOrganizationSubtreeIds } from "../../common/organization-location-scope";
import {
  assigneeCanAccessLocation,
  assigneeScopesOverlap,
  resolveAssigneeLocationIds,
  resolveWorkspaceMemberDataScope
} from "./work-order-assignee-scope";
import {
  getRequestDataScope,
  getRequestLocationIds,
  getRequestStaffLocationIds,
  getRequestUserId,
  getRequestWorkspaceId
} from "../../common/request-identity";

/** 参与可用量计算的预占。表上直接带 startAt/endAt，因此不必回连订单。 */
export interface ActiveReservationRow {
  orderId?: string;
  assetIds?: string[];
  itemGroupId: string;
  locationId: string;
  quantity: number;
  startAt: string;
  endAt: string;
}

/** 资产状态变更随订单聚合一起提交，避免出现"订单已推进、资产状态没跟上"的中间态。 */
export interface AssetStatusChange {
  assetId: string;
  status: RentalAssetStatus;
  /** 归还实收地点；换地点时与状态推进同事务更新。 */
  locationId?: string;
  reason?: string;
  operator?: string;
}

interface AssetStatusHistoryInput {
  tenantId: string;
  workspaceId: string;
  assetId: string;
  assetNo: string;
  fromStatus?: string | null;
  toStatus: RentalAssetStatus;
  source: RentalAssetStatusHistorySource;
  sourceId?: string;
  reason: string;
  operator?: string;
  recordUnchanged?: boolean;
}

/**
 * 数量库存的隔离变更，同样随订单聚合一起提交。
 *
 * 数量库存没有"单件状态"可以像序列化资产那样转成 maintenance：它只有
 * 在库/已占用/维修三个数量。异常归还时若只释放预占，那批货会直接回到可用池，
 * 下一单就能把坏的租出去。因此必须把数量记进 `maintenanceQuantity` 隔离。
 */
export interface StockQuarantineChange {
  itemGroupId: string;
  locationId: string;
  /** 转入维修隔离的数量，正数。 */
  quantity: number;
  idempotencyKey: string;
  sourceOrderId: string;
  sourceOrderNo: string;
  sourceInspectionId?: string;
  sourceDispositionId?: string;
  batchNo: string;
  reason: string;
  operator: string;
}

/** 租赁归还跨地点时，在订单释放预占的同一事务中转移数量库存。 */
export interface StockReturnTransfer {
  itemGroupId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  idempotencyKey: string;
  sourceOrderId: string;
  sourceOrderNo: string;
  sourceInspectionId?: string;
  batchNo: string;
  reason: string;
  operator: string;
}

/**
 * 盘点写入的入参。`maintenanceQuantity` 省略表示"本次不动维修量"，不是 0。
 *
 * `id` 只在余额行还不存在时用得上；已存在时沿用库里的 id，避免同一个
 * (商品, 网点) 因为调用方每次生成新 id 而 upsert 出第二行。
 */
export interface StockCountInput {
  id: string;
  tenantId: string;
  itemGroupId: string;
  locationId: string;
  onHandQuantity: number;
  maintenanceQuantity?: number;
}

export interface StockOperationInput extends RentalStockOperationRequest {
  tenantId: string;
  operator: string;
}

export interface AppliedStockOperation {
  operationId: string;
  operationType: RentalStockOperationType;
  idempotent: boolean;
  entries: RentalStockLedgerEntry[];
}

/** 领取时一次性消耗的库存。必须与订单写入放在同一事务中。 */
export interface ConsumableStockConsumption {
  itemGroupId: string;
  locationId: string;
  quantity: number;
}

export type RentalFactTx = Prisma.TransactionClient;

/** Internal bounded read port; not a replacement for the existing manual list. */
export interface RentalInspectionPageQuery { limit: number; cursor?: string; }
export interface RentalInspectionPage {
  items: RentalInspectionRecord[]; nextCursor: string | null; coverage: 'page_not_total';
}
export function parseRentalInspectionPageQuery(value: RentalInspectionPageQuery): RentalInspectionPageQuery {
  const input = structuredClone(value);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['limit', 'cursor'].includes(key))
    || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50
    || (input.cursor !== undefined && (typeof input.cursor !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(input.cursor)))) {
    throw new BadRequestException('检查记录分页参数无效');
  }
  return input;
}

export interface InventoryLockTarget {
  itemGroupId: string;
  inventoryMode: RentalInventoryMode;
}

export interface RentalUniqueAttributeClaim {
  fieldCode: string;
  label: string;
  normalizedValue: string;
}

export interface AssetStatusHistoryMetadata {
  reason?: string;
  operator?: string;
}

/**
 * 服务层只依赖这个接口。与配置仓储同理：不连库的单元测试注入吸收式 stub，
 * 而租户隔离、外键、过期预占过滤这类持久化语义只在 MySQL E2E 里验证。
 */
export interface RentalCoreFactStore {
  listOrders(tenantId: string): Promise<RentalOrder[]>;
  /** 读取订单承运里程碑类型；取消、改配等资源释放动作在同一事务内复核它。 */
  listCarrierShipmentEventTypes(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<string[]>;
  /**
   * ORDER-LIST-01：按筛选条件在数据库里分页查订单。`take` 缺省表示不分页（只筛选）。
   * 租户与空间范围与 `listOrders` 完全一致。
   */
  queryOrders(tenantId: string, query: RentalOrderListQuery & { skip?: number; take?: number }): Promise<{ items: RentalOrder[]; total: number }>;
  /** 找出当前空间中仍处于待确认、且至少一条软预占已过期的订单候选。 */
  listExpiredDraftOrderIds(tenantId: string, expiredBefore: string, take?: number): Promise<string[]>;
  findOrder(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrder | undefined>;
  /**
   * 对订单行加排他锁，供状态推进动作在读取聚合前调用。
   * 不加锁时确认、配货、取消会各读一份聚合副本、各跑状态机、各整体写回，
   * 后提交者把先提交者的状态覆盖掉（丢失更新），两个动作都返回成功。
   */
  lockOrder(tenantId: string, orderId: string, tx: RentalFactTx): Promise<void>;
  countOrders(tenantId: string): Promise<number>;
  allocateOrderNumber(tenantId: string, createdAt: string, timeZone: string | undefined, tx: RentalFactTx): Promise<string>;
  saveOrderAggregate(order: RentalOrder, assetChanges?: AssetStatusChange[], tx?: RentalFactTx, stockQuarantines?: StockQuarantineChange[], stockTransfers?: StockReturnTransfer[]): Promise<void>;
  lockInventoryTargets(tenantId: string, locationId: string, targets: InventoryLockTarget[], tx: RentalFactTx): Promise<void>;
  activeReservations(tenantId: string, tx?: RentalFactTx): Promise<ActiveReservationRow[]>;
  /**
   * 对该地点下某商品组的资产行加排他锁，供配货使用。
   *
   * 与 lockInventoryTargets 同理：拿到锁后再读资产与既有分配，才能让同一资源的
   * 并发配货串行。缺这一步时两张订单锁的是各自的订单行、互不争锁，
   * 双方都读到"资产可用且无占用分配"，各自挑中同一台资产并提交。
   */
  lockAssetsForAllocation(tenantId: string, itemGroupId: string, locationId: string, tx: RentalFactTx): Promise<void>;
  /**
   * 已被有效分配占住的资产 id。
   *
   * 必须支持 tx：配货在事务内挑资产，若这里走独立连接的 autocommit 读，
   * 就看不到并发事务已提交但本连接快照之外的分配。
   */
  allocatedAssetIds(tenantId: string, tx?: RentalFactTx, excludeOrderId?: string): Promise<Set<string>>;
  listAssets(tenantId: string, tx?: RentalFactTx): Promise<RentalAsset[]>;
  listAssetStatusHistory(tenantId: string, assetId: string, tx?: RentalFactTx): Promise<RentalAssetStatusHistory[]>;
  upsertAsset(asset: RentalAsset, uniqueAttributes?: RentalUniqueAttributeClaim[], statusChange?: AssetStatusHistoryMetadata, expectedBinding?: CategoryWriteBinding): Promise<void>;
  listStockBalances(tenantId: string, tx?: RentalFactTx): Promise<RentalStockBalance[]>;
  upsertStockBalance(balance: RentalStockBalance): Promise<void>;
  /**
   * 盘点写入。与 `upsertStockBalance`（只用于建样例数据）分开，因为它必须锁行：
   * `maintenanceQuantity` 现在有第二个写者，见 `saveOrderAggregate` 的异常隔离。
   */
  applyStockCount(input: StockCountInput): Promise<{ id: string; onHandQuantity: number; maintenanceQuantity: number }>;
  listStockLedger(tenantId: string, filters?: { itemGroupId?: string; locationId?: string; limit?: number }, tx?: RentalFactTx): Promise<RentalStockLedgerEntry[]>;
  applyStockOperation(input: StockOperationInput): Promise<AppliedStockOperation>;
  /** 锁余额、扣在手、追加 consume 流水；调用方随后在同一事务内保存订单领取事实。 */
  consumeStockForOrder(tenantId: string, orderId: string, lines: ConsumableStockConsumption[], operator: string, tx: RentalFactTx): Promise<void>;
  listStockDispositions(tenantId: string, orderId?: string, tx?: RentalFactTx): Promise<RentalStockDisposition[]>;
  upsertStockDisposition(disposition: RentalStockDisposition, tx?: RentalFactTx): Promise<RentalStockDisposition>;
  restoreStockDisposition(tenantId: string, dispositionId: string, operator: string, tx?: RentalFactTx): Promise<RentalStockDisposition>;
  writeOffStockDisposition(tenantId: string, dispositionId: string, reason: string, operator: string, tx?: RentalFactTx): Promise<RentalStockDisposition>;
  listWorkOrders(tenantId: string, status?: RentalWorkOrderStatus, tx?: RentalFactTx): Promise<RentalWorkOrder[]>;
  listWorkOrderAssignees(tenantId: string, locationId?: string, tx?: RentalFactTx): Promise<RentalWorkOrderAssignee[]>;
  listWorkOrderHistory(tenantId: string, workOrderId: string, tx?: RentalFactTx): Promise<RentalWorkOrderHistoryEntry[]>;
  upsertWorkOrder(workOrder: RentalWorkOrder, tx?: RentalFactTx): Promise<RentalWorkOrder>;
  assignWorkOrder(tenantId: string, workOrderId: string, assigneeId?: string, assigneeName?: string, tx?: RentalFactTx): Promise<RentalWorkOrder>;
  transitionWorkOrder(tenantId: string, workOrderId: string, action: "start" | "submit" | "review" | "cancel", operator: string, input?: { result?: string; attachments?: string[]; decision?: "approved" | "rejected"; reason?: string }, tx?: RentalFactTx): Promise<RentalWorkOrder>;
  listInspections(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalInspectionRecord[]>;
  listInspectionsPage?(tenantId: string, orderId: string, query: RentalInspectionPageQuery, tx?: RentalFactTx): Promise<RentalInspectionPage>;
  insertInspection(record: RentalInspectionRecord, tx?: RentalFactTx): Promise<void>;
  correctInspectionUsage(
    tenantId: string,
    orderId: string,
    inspectionId: string,
    input: CorrectRentalInspectionUsageRequest,
    operator: string,
    tx?: RentalFactTx
  ): Promise<RentalInspectionRecord>;
  /** 续租记录（需求 4.6.9）。只追加与改状态，不改金额——金额是申请时固化的事实。 */
  listExtensions(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrderExtension[]>;
  listOrderChanges(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrderChange[]>;
  insertExtension(extension: RentalOrderExtension, tx?: RentalFactTx): Promise<void>;
  insertOrderChange(change: RentalOrderChange, tx?: RentalFactTx): Promise<void>;
  markExtensionEffective(
    tenantId: string,
    extensionId: string,
    at: string,
    paidAt: string | undefined,
    tx?: RentalFactTx
  ): Promise<void>;
  cancelExtensions(tenantId: string, extensionIds: string[], tx?: RentalFactTx): Promise<void>;
  updateExtensionPricingSnapshot(tenantId: string, orderId: string, extensionId: string, snapshot: NonNullable<RentalOrderExtension["pricingSnapshot"]>, tx: RentalFactTx): Promise<void>;
}

const ACTIVE_RESERVATION_STATES: $Enums.RentalReservationState[] = ["SOFT", "CONFIRMED", "FULFILLED"];
const IN_USE_ALLOCATION_STATES = ["pre_assigned", "locked", "allocated", "picked_up"];

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function num(value: Prisma.Decimal): number {
  return Number(value);
}

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function upper<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

/** Raw SQL returns mapped database enum values; a generic type cannot decode them. */
function assetStateFromSql(value: string): $Enums.RentalAssetState {
  if (!Object.values(RentalAssetStatus).some(status => status === value)) {
    throw new ConflictException("资产数据库状态无效，不能猜测可租限制");
  }
  return upper<$Enums.RentalAssetState>(value);
}

async function appendAssetStatusHistory(client: RentalFactTx, input: AssetStatusHistoryInput) {
  const fromStatus = input.fromStatus ? upper<$Enums.RentalAssetState>(input.fromStatus) : null;
  const toStatus = upper<$Enums.RentalAssetState>(input.toStatus);
  if (fromStatus === toStatus && !input.recordUnchanged) return;
  await client.rentalAssetStatusHistory.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      assetNo: input.assetNo,
      fromStatus,
      toStatus,
      source: input.source,
      sourceId: input.sourceId ?? null,
      reason: input.reason.trim().slice(0, 500),
      operator: (input.operator ?? "系统").trim().slice(0, 191) || "系统"
    }
  });
}

function toAssetStatusHistory(row: any): RentalAssetStatusHistory {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    assetId: row.assetId,
    assetNo: row.assetNo,
    fromStatus: row.fromStatus ? lower<RentalAssetStatus>(row.fromStatus) : undefined,
    toStatus: lower<RentalAssetStatus>(row.toStatus),
    source: row.source as RentalAssetStatusHistorySource,
    sourceId: row.sourceId ?? undefined,
    reason: row.reason,
    operator: row.operator,
    createdAt: row.createdAt.toISOString()
  };
}

function toStockDisposition(row: any): RentalStockDisposition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    orderId: row.orderId,
    inspectionId: row.inspectionId ?? undefined,
    returnBatchKey: row.returnBatchKey,
    dedupeKey: row.dedupeKey,
    itemGroupId: row.itemGroupId,
    locationId: row.locationId,
    assetId: row.assetId ?? undefined,
    quantity: row.quantity,
    receivedAt: row.receivedAt.toISOString(),
    bufferUntil: row.bufferUntil.toISOString(),
    status: row.status,
    blockReason: row.blockReason ?? undefined,
    restoredQuantity: row.restoredQuantity,
    restoredAt: row.restoredAt?.toISOString(),
    restoredBy: row.restoredBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toStockLedgerEntry(row: any): RentalStockLedgerEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    operationId: row.operationId,
    entryKind: row.entryKind,
    operationType: row.operationType,
    itemGroupId: row.itemGroupId,
    itemGroupCode: row.itemGroup?.code ?? "",
    itemGroupName: row.itemGroup?.name ?? "",
    locationId: row.locationId,
    locationName: row.location?.name ?? "",
    quantityDelta: row.quantityDelta,
    onHandBefore: row.onHandBefore,
    onHandAfter: row.onHandAfter,
    maintenanceDelta: row.maintenanceDelta ?? 0,
    reservedQuantity: row.reservedQuantity,
    maintenanceQuantity: row.maintenanceQuantity,
    reason: row.reason,
    batchNo: row.batchNo ?? undefined,
    sourceDocumentNo: row.sourceDocumentNo ?? undefined,
    sourceOrderId: row.sourceOrderId ?? undefined,
    sourceInspectionId: row.sourceInspectionId ?? undefined,
    sourceDispositionId: row.sourceDispositionId ?? undefined,
    idempotencyKey: row.idempotencyKey,
    operator: row.operator,
    createdAt: row.createdAt.toISOString()
  };
}

function toWorkOrder(row: any): RentalWorkOrder {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    workNo: row.workNo,
    type: row.type,
    status: row.status,
    dispositionId: row.dispositionId ?? undefined,
    orderId: row.orderId ?? undefined,
    inspectionId: row.inspectionId ?? undefined,
    itemGroupId: row.itemGroupId,
    locationId: row.locationId,
    assetId: row.assetId ?? undefined,
    quantity: row.quantity,
    assigneeId: row.assigneeId ?? undefined,
    assigneeName: row.assigneeName ?? undefined,
    reason: row.reason,
    result: row.result ?? undefined,
    attachments: (row.attachments ?? []) as string[],
    startedAt: row.startedAt?.toISOString(),
    submittedAt: row.submittedAt?.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewedBy: row.reviewedBy ?? undefined,
    reviewReason: row.reviewReason ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * RC-01 阶段 2：Rental Core 核心事实的唯一读写入口。
 *
 * 设计要点——聚合加载：订单及其行、预占、分配从表装载为领域对象 `RentalOrder`，
 * 服务层的状态机逻辑在该对象上原样运行，随后由 `saveOrderAggregate` 在**单个事务**里写回。
 * 这样既让 MySQL 成为事实源，又不必把状态机逻辑改写成逐条 SQL（回归面小），
 * 并且天然给每个订单动作带来原子性。
 *
 * 租户隔离：每个查询和写入都带 tenantId 条件；订单行与分配表没有 tenantId 列，
 * 通过 orderId 关联到已按租户过滤的订单，写入前必须先确认订单归属。
 */
@Injectable()
export class RentalCoreFactRepository implements RentalCoreFactStore {
  constructor(private readonly prisma: PrismaService,
    @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) private readonly failureEvents?: BusinessFailureOutboxParticipant) {}

  /* ---------- 订单聚合 ---------- */

  private orderInclude = {
    lines: { orderBy: { createdAt: "asc" } },
    reservations: { orderBy: { createdAt: "asc" } },
    allocations: { orderBy: { createdAt: "asc" } }
  } as const;

  /** 订单、明细与导出共用的会话可见范围；过滤必须在数据库层完成。 */
  private requestOrderVisibilityWhere(): Prisma.RentalOrderWhereInput {
    const clauses: Prisma.RentalOrderWhereInput[] = [];
    const locationIds = getRequestLocationIds();
    if (locationIds !== undefined) {
      const safeIds = locationIds.length ? locationIds : ["__no_authorized_location__"];
      clauses.push({ OR: [
        { fulfillmentLocationId: { in: safeIds } },
        { returnLocationId: { in: safeIds } }
      ] });
    }
    if (getRequestDataScope() === "own") {
      const userId = getRequestUserId();
      clauses.push(userId ? { OR: [
        { createdBy: userId },
        { workOrders: { some: { OR: [{ createdBy: userId }, { assigneeId: userId }] } } }
      ] } : { id: "__no_current_user__" });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  /** 文件读取与订单详情共用原范围；凭证额外限定实际取/还阶段地点。 */
  async assertFileOrderReadAccess(tenantId: string, orderId: string, stage?: "pickup" | "return") {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const locationIds = getRequestLocationIds();
    const stageWhere = stage && locationIds !== undefined
      ? stage === "pickup" ? { fulfillmentLocationId: { in: locationIds } }
        : { OR: [{ returnLocationId: { in: locationIds } }, { returnLocationId: null, fulfillmentLocationId: { in: locationIds } }] }
      : {};
    const row = await this.prisma.rentalOrder.findFirst({ where: { id: orderId, tenantId, workspaceId,
      AND: [this.requestOrderVisibilityWhere(), stageWhere] }, select: { id: true } });
    if (!row) throw new NotFoundException("文件关联订单不在当前业务范围内");
  }

  async assertFileWorkOrderReadAccess(tenantId: string, workOrderId: string) {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const row = await this.prisma.rentalWorkOrder.findFirst({ where: { id: workOrderId, tenantId, workspaceId,
      ...this.workOrderVisibilityWhere() }, select: { id: true } });
    if (!row) throw new NotFoundException("文件关联工单不在当前业务范围内");
  }

  async assertFileAssetReadAccess(tenantId: string, assetId: string) {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const row = await this.prisma.rentalAsset.findFirst({ where: { id: assetId, tenantId, workspaceId,
      AND: [await this.assetVisibilityWhere(this.prisma, tenantId, workspaceId)] }, select: { id: true } });
    if (!row) throw new NotFoundException("文件关联资产不在当前业务范围内");
  }

  async listOrders(tenantId: string): Promise<RentalOrder[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalOrder.findMany({
      where: { tenantId, workspaceId, ...this.requestOrderVisibilityWhere() },
      include: this.orderInclude,
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toDomainOrder(row));
  }

  /**
   * ORDER-LIST-01：筛选 + 计数 + 分页全部在 MySQL 里做。
   *
   * 用一条参数化 SQL 取「命中的订单 id 页」与总数，再用 Prisma 按 id 取聚合：
   * 关键词要查会员快照里的企业名、待审费用要查 JSON 数组、分配进度要按
   * 预占与分配数量求和比较——这些 Prisma 的 where 表达不了（或在 MySQL 上语义不确定），
   * 而在内存里过滤整张表正是这条改动要去掉的东西。
   * 分配进度的判据必须与共享契约的 `rentalAllocationProgress` 逐字对应，改一处必须改另一处。
   */
  async queryOrders(tenantId: string, query: RentalOrderListQuery & { skip?: number; take?: number }): Promise<{ items: RentalOrder[]; total: number }> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const conditions: Prisma.Sql[] = [Prisma.sql`o.\`tenantId\` = ${tenantId}`, Prisma.sql`o.\`workspaceId\` = ${workspaceId}`];
    const locationIds = getRequestLocationIds();
    if (locationIds !== undefined) {
      if (!locationIds.length) conditions.push(Prisma.sql`1 = 0`);
      else conditions.push(Prisma.sql`(o.\`fulfillmentLocationId\` IN (${Prisma.join(locationIds)}) OR o.\`returnLocationId\` IN (${Prisma.join(locationIds)}))`);
    }
    if (getRequestDataScope() === "own") {
      const userId = getRequestUserId();
      if (!userId) conditions.push(Prisma.sql`1 = 0`);
      else conditions.push(Prisma.sql`(
        o.\`createdBy\` = ${userId}
        OR EXISTS (
          SELECT 1 FROM \`rental_work_orders\` wo
          WHERE wo.\`tenantId\` = ${tenantId} AND wo.\`workspaceId\` = ${workspaceId}
            AND wo.\`orderId\` = o.\`id\` AND (wo.\`createdBy\` = ${userId} OR wo.\`assigneeId\` = ${userId})
        )
      )`);
    }
    if (query.status) conditions.push(Prisma.sql`o.\`status\` = ${query.status}`);
    const keyword = query.keyword?.trim();
    if (keyword) {
      const pattern = `%${keyword.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(Prisma.sql`(
        o.\`orderNo\` LIKE ${pattern}
        OR o.\`customerName\` LIKE ${pattern}
        OR o.\`payerSubjectCustomerId\` LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(o.\`membershipSnapshot\`, '$.corporateCustomerName')) LIKE ${pattern}
      )`);
    }
    // 区间按**当前**归还时间：续租过的订单实际占用到 effectiveEndAt。
    if (query.from) conditions.push(Prisma.sql`COALESCE(o.\`effectiveEndAt\`, o.\`endAt\`) > ${new Date(query.from)}`);
    if (query.to) conditions.push(Prisma.sql`o.\`startAt\` < ${new Date(query.to)}`);
    if (query.pendingFeeOnly) conditions.push(Prisma.sql`JSON_CONTAINS(o.\`feeReviews\`, '[{"status":"pending"}]') = 1`);

    let joins = Prisma.empty;
    if (query.assignment === "issue") {
      conditions.push(Prisma.sql`JSON_EXTRACT(o.\`assignment\`, '$.issue') IS NOT NULL`);
    } else if (query.assignment) {
      // 派生表先按本租户/本空间收窄再聚合，否则 MySQL 会先对全平台的预占/分配做 GROUP BY 再来 JOIN。
      // 预占表自带 tenantId + workspaceId；分配表没有，只能经订单表收窄。
      const scopedOrderIds = Prisma.sql`SELECT \`id\` FROM \`rental_orders\`
          WHERE \`tenantId\` = ${tenantId} AND \`workspaceId\` = ${workspaceId} AND \`status\` IN ('reserved', 'ready_for_pickup')`;
      joins = Prisma.sql`
        LEFT JOIN (
          SELECT \`orderId\`, SUM(GREATEST(\`quantity\` - \`releasedQuantity\`, 0)) AS required_qty
          FROM \`rental_reservations\`
          WHERE \`tenantId\` = ${tenantId} AND \`workspaceId\` = ${workspaceId}
            AND \`status\` NOT IN ('released', 'expired', 'cancelled')
          GROUP BY \`orderId\`
        ) r ON r.\`orderId\` = o.\`id\`
        LEFT JOIN (
          SELECT \`orderId\`,
            SUM(\`quantity\`) AS assigned_qty,
            SUM(CASE WHEN \`status\` <> 'pre_assigned' THEN \`quantity\` ELSE 0 END) AS locked_qty
          FROM \`rental_allocations\`
          WHERE \`orderId\` IN (${scopedOrderIds})
            AND \`status\` IN ('pre_assigned', 'locked', 'allocated', 'picked_up')
          GROUP BY \`orderId\`
        ) a ON a.\`orderId\` = o.\`id\``;
      conditions.push(Prisma.sql`o.\`status\` IN ('reserved', 'ready_for_pickup')`);
      const required = Prisma.sql`COALESCE(r.required_qty, 0)`;
      const assigned = Prisma.sql`COALESCE(a.assigned_qty, 0)`;
      const locked = Prisma.sql`COALESCE(a.locked_qty, 0)`;
      if (query.assignment === "pending") conditions.push(Prisma.sql`${assigned} = 0`);
      else if (query.assignment === "partial") conditions.push(Prisma.sql`${assigned} > 0 AND ${assigned} < ${required}`);
      else if (query.assignment === "unlocked") conditions.push(Prisma.sql`${assigned} > 0 AND ${assigned} >= ${required} AND ${locked} < ${required}`);
      else if (query.assignment === "locked") conditions.push(Prisma.sql`${assigned} > 0 AND ${assigned} >= ${required} AND ${locked} >= ${required}`);
    }

    const where = Prisma.join(conditions, " AND ");
    const paging = query.take !== undefined ? Prisma.sql`LIMIT ${query.take} OFFSET ${query.skip ?? 0}` : Prisma.empty;
    const orderBy = rentalOrderListSort(query);
    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`SELECT COUNT(*) AS total FROM \`rental_orders\` o ${joins} WHERE ${where}`),
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT o.\`id\` FROM \`rental_orders\` o ${joins} WHERE ${where} ORDER BY ${orderBy} ${paging}`)
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const ids = idRows.map((row) => row.id);
    if (!ids.length) return { items: [], total };
    const rows = await this.prisma.rentalOrder.findMany({
      where: { id: { in: ids }, tenantId, workspaceId, ...this.requestOrderVisibilityWhere() },
      include: this.orderInclude
    });
    const position = new Map(ids.map((id, index) => [id, index]));
    rows.sort((left, right) => (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0));
    return { items: rows.map((row) => this.toDomainOrder(row)), total };
  }

  async listExpiredDraftOrderIds(tenantId: string, expiredBefore: string, take = 50): Promise<string[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const cutoff = new Date(expiredBefore);
    const cap = Math.min(Math.max(1, take), 200);
    // 1) 有软预占的草稿单：全部软预占都已过期。
    const withSoftExpired = await this.prisma.rentalOrder.findMany({
      where: {
        tenantId,
        workspaceId,
        status: "DRAFT",
        ...this.requestOrderVisibilityWhere(),
        reservations: {
          some: { status: "SOFT", expiresAt: { lt: cutoff } }
        }
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: cap
    });
    // 2) 无任何预占的草稿单（例如纯增值服务单）：没有软预占可判到期，改按
    //    createdAt + 待支付保留时长（读订单快照的 unpaidHoldMinutes，缺省 = 现行行为）判定。
    //    保留时长是逐单快照值，无法在 SQL 里表达，因此先取候选再在内存过滤。
    const withoutReservations = await this.prisma.rentalOrder.findMany({
      where: {
        tenantId,
        workspaceId,
        status: "DRAFT",
        ...this.requestOrderVisibilityWhere(),
        reservations: { none: {} }
      },
      select: { id: true, createdAt: true, ruleSnapshot: true },
      orderBy: { createdAt: "asc" },
      take: cap
    });
    const cutoffMs = cutoff.getTime();
    const holdExpired = withoutReservations.filter((row) => {
      const minutes = effectiveUnpaidHoldRule(row.ruleSnapshot as unknown as RentalRuleConfig).unpaidHoldMinutes;
      return row.createdAt.getTime() + minutes * 60_000 <= cutoffMs;
    });
    // 合并、去重，按 createdAt 升序，截到 cap。
    const merged = new Map<string, Date>();
    for (const row of [...withSoftExpired, ...holdExpired]) merged.set(row.id, row.createdAt);
    return [...merged.entries()]
      .sort(([, a], [, b]) => a.getTime() - b.getTime())
      .slice(0, cap)
      .map(([id]) => id);
  }

  async findOrder(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrder | undefined> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalOrder.findFirst({
      where: { id: orderId, tenantId, workspaceId, ...this.requestOrderVisibilityWhere() },
      include: this.orderInclude
    });
    return row ? this.toDomainOrder(row) : undefined;
  }

  async listCarrierShipmentEventTypes(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<string[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalCarrierShipmentEvent.findMany({
      where: { tenantId, workspaceId, orderId },
      select: { type: true }
    });
    return rows.map((row) => row.type);
  }

  /**
   * 锁只加在订单行上，子表（行、预占、分配）随聚合一起由同一事务写回，
   * 拿到订单锁即可串行同一订单的状态推进，不同订单仍并行。
   */
  async lockOrder(tenantId: string, orderId: string, tx: RentalFactTx): Promise<void> {
    /**
     * 必须让这条 FOR UPDATE 成为事务内的第一条读。
     *
     * MySQL 默认是 REPEATABLE READ；如果先调用 resolveScopeWorkspaceId，
     * 它的普通 SELECT 会建立旧快照。之后即使 FOR UPDATE 等到了续租事务并
     * 拿到最新行锁，findOrder 的普通查询仍可能读到快照中的旧 effectiveEndAt，
     * 归还就会按旧租期计算逾时费。这里直接把会话空间放进锁查询条件，并从
     * 锁定结果取得空间；没有会话的 seed/恢复路径则先锁订单，再确认它属于
     * 目标租户的默认空间，不提前做任何普通查询。
     */
    const sessionWorkspaceId = getRequestWorkspaceId();
    const rows = sessionWorkspaceId
      ? await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>(Prisma.sql`
          SELECT \`id\`, \`workspaceId\` FROM \`rental_orders\`
          WHERE \`tenantId\` = ${tenantId}
            AND \`workspaceId\` = ${sessionWorkspaceId}
            AND \`id\` = ${orderId}
          FOR UPDATE
        `)
      : await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>(Prisma.sql`
          SELECT \`id\`, \`workspaceId\` FROM \`rental_orders\`
          WHERE \`tenantId\` = ${tenantId}
            AND \`id\` = ${orderId}
          FOR UPDATE
        `);

    if (!sessionWorkspaceId && rows[0]) {
      const defaultWorkspace = await tx.businessWorkspace.findFirst({
        where: { id: rows[0].workspaceId, tenantId, defaultMarker: "default" },
        select: { id: true }
      });
      if (!defaultWorkspace) {
        throw new ConflictException("订单不属于租户默认经营空间，拒绝在无会话路径锁定");
      }
    }
    if (rows[0]) {
      // 历史换货分配仍有资产外键：在任何处置/工单写入前也锁这些资产，
      // 否则返库晚写历史分配会与另一事务的资产→处置当前读形成锁环。
      const references = await tx.$queryRaw<Array<{ assetId: string }>>(Prisma.sql`
        SELECT assetId FROM rental_allocations WHERE orderId = ${orderId} AND assetId IS NOT NULL
        ORDER BY assetId FOR UPDATE`);
      await this.lockAssetRows(tx, tenantId, rows[0].workspaceId, references.map(row => row.assetId));
    }
  }

  private async lockAssetRows(client: RentalFactTx, tenantId: string, workspaceId: string, assetIds: string[]) {
    const assets = new Map<string, { id: string; assetNo: string; status: $Enums.RentalAssetState; locationId: string }>();
    // Point locks use the primary key, so a later sort cannot disguise an earlier
    // range scan's lock order. Every writer takes referenced assets before holds.
    for (const assetId of [...new Set(assetIds)].sort()) {
      const row = (await client.$queryRaw<Array<{ id: string; assetNo: string; status: string; locationId: string }>>(Prisma.sql`
        SELECT id, assetNo, status, locationId FROM rental_assets
        WHERE id = ${assetId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`))[0];
      if (!row) throw new ConflictException("关联资产不存在或已不属于当前经营空间");
      assets.set(assetId, { ...row, status: assetStateFromSql(row.status) });
    }
    return assets;
  }

  async countOrders(tenantId: string): Promise<number> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.prisma.rentalOrder.count({ where: { tenantId, workspaceId } });
  }

  async allocateOrderNumber(tenantId: string, createdAt: string, timeZone: string | undefined, tx: RentalFactTx): Promise<string> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    return allocateRentalOrderNumber(tx, tenantId, workspaceId, createdAt, timeZone);
  }

  /**
   * 写回订单聚合。行与预占按 id upsert，分配整表替换（配货会重算整组分配），
   * 资产状态变更一并进入同一事务。
   */
  async saveOrderAggregate(
    order: RentalOrder,
    assetChanges: AssetStatusChange[] = [],
    tx?: RentalFactTx,
    stockQuarantines: StockQuarantineChange[] = [],
    stockTransfers: StockReturnTransfer[] = []
  ): Promise<void> {
    const orderData = {
      tenantId: order.tenantId,
      orderNo: order.orderNo,
      assignment: order.assignment ? order.assignment as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
      categoryCode: upper<$Enums.RentalCategoryCode>(order.categoryCode),
      categoryVersionId: order.categoryVersionId ?? null,
      inspectionTemplateSnapshots: order.inspectionTemplateSnapshots === undefined ? Prisma.DbNull : order.inspectionTemplateSnapshots as unknown as Prisma.InputJsonValue,
      status: upper<$Enums.RentalOrderV1Status>(order.status),
      customerType: order.customerType,
      customerId: order.customerId ?? null,
      customerName: order.customerName,
      contactPhone: order.contactPhone ?? null,
      membershipSnapshot: (order.membershipSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      membershipBenefitEvaluations: (order.membershipBenefitEvaluations ?? null) as unknown as Prisma.InputJsonValue,
      fulfillmentMode: order.fulfillmentMode,
      fulfillmentLocationId: order.fulfillmentLocationId,
      fulfillmentLocationName: order.fulfillmentLocationName,
      fulfillmentLocationSnapshot: order.fulfillmentLocationSnapshot as unknown as Prisma.InputJsonValue,
      returnLocationId: order.returnLocationId ?? null,
      returnLocationName: order.returnLocationName ?? null,
      returnLocationSnapshot: order.returnLocationSnapshot as unknown as Prisma.InputJsonValue,
      deliveryAddressSnapshot: (order.deliveryAddressSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      startAt: new Date(order.startAt),
      actualRentalStartAt: order.actualRentalStartAt ? new Date(order.actualRentalStartAt) : null,
      endAt: new Date(order.endAt),
      // 续租只推进 effectiveEndAt，endAt 保持原始约定（需求 4.6.9）。
      effectiveEndAt: order.effectiveEndAt ? new Date(order.effectiveEndAt) : null,
      carrierRentalDueAt: order.carrierRentalDueAt ? new Date(order.carrierRentalDueAt) : null,
      quoteId: order.quoteId,
      quoteNo: order.quoteNo,
      pricingPlanVersion: order.pricingPlanVersion,
      priceVersionId: order.priceVersionId ?? null,
      priceVersion: order.priceVersion ?? null,
      ruleVersion: order.ruleVersion,
      ruleSnapshot: order.ruleSnapshot as unknown as Prisma.InputJsonValue,
      calendarVersion: order.calendarVersion ?? null,
      calendarSnapshot: (order.calendarSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      // CORE-EXT-02D：能力版本快照随订单固化，在途环节的 Hook 判定都用它。
      capabilitySnapshot: (order.capabilitySnapshot ?? null) as unknown as Prisma.InputJsonValue,
      capabilityDecisions: (order.capabilityDecisions ?? null) as unknown as Prisma.InputJsonValue,
      capabilityExceptions: (order.capabilityExceptions ?? null) as unknown as Prisma.InputJsonValue,
      serviceSnapshots: (order.serviceSnapshots ?? null) as unknown as Prisma.InputJsonValue,
      // CUSTOMER-01C：订单四类主体。id 列可反查，快照固化下单当时的名称与授权范围。
      // 全部可空：存量订单与未指定主体的订单保持原语义（读取侧回落到 customerId）。
      contractSubjectCustomerId: order.contractSubjectCustomerId ?? null,
      payerSubjectCustomerId: order.payerSubjectCustomerId ?? null,
      userSubjectCustomerId: order.userSubjectCustomerId ?? null,
      agentId: order.agentId ?? null,
      subjectSnapshot: (order.subjectSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      chargeLines: order.chargeLines as unknown as Prisma.InputJsonValue,
      // 待人工裁定的费用审核单。空数组也写 null，避免历史订单与「审完清空」两种状态混淆。
      feeReviews: (order.feeReviews?.length ? order.feeReviews : null) as unknown as Prisma.InputJsonValue,
      rentalAmount: new Prisma.Decimal(order.rentalAmount),
      discountAmount: new Prisma.Decimal(order.discountAmount),
      couponAmount: new Prisma.Decimal(order.couponAmount),
      serviceAmount: new Prisma.Decimal(order.serviceAmount),
      fulfillmentAmount: new Prisma.Decimal(order.fulfillmentAmount),
      depositAmount: new Prisma.Decimal(order.depositAmount),
      preAuthAmount: new Prisma.Decimal(order.preAuthAmount),
      payableAmount: new Prisma.Decimal(order.payableAmount),
      adjustmentAmount: new Prisma.Decimal(order.adjustmentAmount),
      finalPayableAmount: new Prisma.Decimal(order.finalPayableAmount),
      taxRate: new Prisma.Decimal(order.taxRate ?? 0),
      taxAmount: new Prisma.Decimal(order.taxAmount ?? 0),
      currency: order.currency ?? "CNY",
      totalAmount: new Prisma.Decimal(order.totalAmount),
      cancellationReason: order.cancellationReason ?? null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
      pickupOverdueAt: order.pickupOverdueAt ? new Date(order.pickupOverdueAt) : null,
      noShowNoticeAt: order.noShowNoticeAt ? new Date(order.noShowNoticeAt) : null,
      noShowAt: order.noShowAt ? new Date(order.noShowAt) : null,
      noShowReason: order.noShowReason ?? null,
      completedAt: order.completedAt ? new Date(order.completedAt) : null,
      createdBy: order.createdBy
    };

    const write = async (client: RentalFactTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, order.tenantId);
      const existingOrder = await client.rentalOrder.findUnique({
        where: { id: order.id },
        select: { tenantId: true, workspaceId: true, categoryVersionId: true, inspectionTemplateSnapshots: true }
      });
      if (existingOrder && (existingOrder.tenantId !== order.tenantId || existingOrder.workspaceId !== workspaceId)) {
        throw new ConflictException("订单事实已属于其他租户或经营空间，拒绝覆盖");
      }
      if (existingOrder && (existingOrder.categoryVersionId ?? null) !== (order.categoryVersionId ?? null)) {
        throw new ConflictException("已有订单的品类版本依据不可改写");
      }
      if (existingOrder && !isDeepStrictEqual(existingOrder.inspectionTemplateSnapshots ?? null, order.inspectionTemplateSnapshots ?? null)) {
        throw new ConflictException("已有订单的检查模板快照不可改写");
      }
      if (existingOrder) await this.lockOrder(order.tenantId, order.id, client);
      const currentAssetStatus = await this.lockAssetRows(client, order.tenantId, workspaceId,
        [...assetChanges.map(change => change.assetId), ...order.allocations.flatMap(allocation => allocation.assetId ? [allocation.assetId] : [])]);
      if (existingOrder) {
        await client.rentalOrder.update({ where: { id: order.id }, data: orderData });
      } else {
        await client.rentalOrder.create({
          data: { workspaceId, id: order.id, ...orderData, createdAt: new Date(order.createdAt) }
        });
      }

      for (const line of order.lines) {
        const lineData = {
          orderId: order.id,
          pricingGroupId: line.pricingGroupId ?? null,
          pricingGroupCode: line.pricingGroupCode ?? null,
          pricingGroupName: line.pricingGroupName ?? null,
          reservationPrecision: line.reservationPrecision ?? "group",
          pricingGroupMemberItemGroupIds: (line.pricingGroupMemberItemGroupIds ?? null) as Prisma.InputJsonValue,
          itemGroupId: line.itemGroupId,
          itemGroupCode: line.itemGroupCode,
          itemGroupName: line.itemGroupName,
          inventoryMode: upper<$Enums.RentalInventoryMode>(line.inventoryMode),
          quantity: line.quantity,
          cancelledQuantity: line.cancelledQuantity ?? 0,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          amount: new Prisma.Decimal(line.amount),
          note: line.note ?? null
        };
        const existingLine = await client.rentalOrderLine.findUnique({ where: { id: line.id }, select: { orderId: true } });
        if (existingLine && existingLine.orderId !== order.id) {
          throw new ConflictException("订单明细已属于其他订单，拒绝覆盖");
        }
        if (existingLine) {
          await client.rentalOrderLine.update({ where: { id: line.id }, data: lineData });
        } else {
          await client.rentalOrderLine.create({ data: { id: line.id, ...lineData } });
        }
      }

      for (const reservation of order.reservations) {
        const reservationData = {
          tenantId: order.tenantId,
          orderId: order.id,
          orderLineId: reservation.orderLineId,
          itemGroupId: reservation.itemGroupId,
          locationId: reservation.locationId,
          quantity: reservation.quantity,
          releasedQuantity: reservation.releasedQuantity,
          // 预占自带期间，使可用量查询不必回连订单表。
          // 结束端用 effectiveEndAt：续租后占用必须跟着延长，否则同一资产在延长出来的
          // 那段时间里对可用量查询是"空闲"的，会被另一张订单同时占走。
          startAt: new Date(order.allocations.some(allocation => allocation.metadata?.reservationId === reservation.id && allocation.metadata.exchangeId)
            ? reservation.createdAt
            : order.fulfillmentMode === "carrier_shipping" ? (order.actualRentalStartAt ?? order.startAt) : order.startAt),
          endAt: new Date(rentalOrderDueAt(order)),
          status: upper<$Enums.RentalReservationState>(reservation.status),
          expiresAt: reservation.expiresAt ? new Date(reservation.expiresAt) : null
        };
        const existingReservation = await client.rentalReservation.findUnique({
          where: { id: reservation.id },
          select: { tenantId: true, workspaceId: true, orderId: true }
        });
        if (existingReservation && (
          existingReservation.tenantId !== order.tenantId ||
          existingReservation.workspaceId !== workspaceId ||
          existingReservation.orderId !== order.id
        )) {
          throw new ConflictException("订单预占已属于其他租户、经营空间或订单，拒绝覆盖");
        }
        if (existingReservation) {
          await client.rentalReservation.update({ where: { id: reservation.id }, data: reservationData });
        } else {
          await client.rentalReservation.create({
            data: { workspaceId, id: reservation.id, ...reservationData, createdAt: new Date(reservation.createdAt) }
          });
        }
      }

      // 配货会重算整组分配，整表替换比逐条对齐更不容易留下孤立行。
      await client.rentalAllocation.deleteMany({ where: { orderId: order.id } });
      for (const allocation of order.allocations) {
        const existingAllocation = await client.rentalAllocation.findUnique({ where: { id: allocation.id }, select: { orderId: true } });
        if (existingAllocation && existingAllocation.orderId !== order.id) {
          throw new ConflictException("订单分配已属于其他订单，拒绝覆盖");
        }
        await client.rentalAllocation.create({
          data: {
            id: allocation.id,
            orderId: order.id,
            orderLineId: allocation.orderLineId,
            itemGroupId: allocation.itemGroupId ?? null,
            assetId: allocation.assetId ?? null,
            assetNo: allocation.assetNo ?? null,
            quantity: allocation.quantity,
            status: allocation.status,
            metadata: (allocation.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue
          }
        });
      }

      for (const change of assetChanges) {
        let targetStatus = upper<$Enums.RentalAssetState>(change.status);
        const before = currentAssetStatus.get(change.assetId);
        if (!before) throw new ConflictException("订单关联资产不存在或已不属于当前经营空间");
        // A return changes physical custody, not an independent availability hold.
        // Order writes cannot release maintenance or manual inspection; preserve
        // their original history even when this order asks to quarantine it again.
        if (["DISABLED", "MAINTENANCE", "INSPECTION"].includes(before.status)) {
          if (!["AVAILABLE", "MAINTENANCE", "INSPECTION", "DISABLED"].includes(targetStatus)) {
            throw new ConflictException("资产仍有独立停用或维护限制，不能推进新分配/领取");
          }
          if (targetStatus !== "DISABLED") targetStatus = before.status;
        }
        if (targetStatus === "AVAILABLE") {
          const [dispositions, workOrders] = await Promise.all([
            client.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_stock_dispositions
              FORCE INDEX (rental_stock_dispositions_asset_status_idx)
              WHERE workspaceId = ${workspaceId} AND assetId = ${change.assetId} AND tenantId = ${order.tenantId}
                AND status IN ('blocked', 'buffered') FOR UPDATE`),
            client.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_work_orders
              FORCE INDEX (rental_work_orders_asset_status_idx)
              WHERE workspaceId = ${workspaceId} AND assetId = ${change.assetId} AND tenantId = ${order.tenantId}
                AND status IN ('pending', 'in_progress', 'pending_review') FOR UPDATE`)
          ]);
          if (dispositions.length || workOrders.length) targetStatus = "MAINTENANCE";
        }
        const updated = await client.rentalAsset.updateMany({
          where: { id: change.assetId, tenantId: order.tenantId, workspaceId, status: before.status },
          data: { status: targetStatus, ...(change.locationId ? { locationId: change.locationId } : {}) }
        });
        if (updated.count !== 1) throw new ConflictException("订单关联资产状态已变化，不能覆盖原可租限制");
        if (updated.count === 1 && before && before.status !== targetStatus) {
          await appendAssetStatusHistory(client, {
            tenantId: order.tenantId,
            workspaceId,
            assetId: change.assetId,
            assetNo: before.assetNo,
            fromStatus: before.status,
            toStatus: lower<RentalAssetStatus>(targetStatus),
            source: "order",
            sourceId: order.id,
            reason: change.reason ?? `订单 ${order.orderNo} 状态推进`,
            operator: change.operator ?? order.createdBy
          });
        }
        if (updated.count === 1 && before) currentAssetStatus.set(change.assetId, { ...before, status: targetStatus });
      }

      // 先把异地归还的数量库存从预占地点转到实收地点，再进行隔离；两者与订单、预占同事务。
      for (const transfer of stockTransfers) {
        if (transfer.quantity <= 0 || transfer.fromLocationId === transfer.toLocationId) continue;
        await this.applyReturnStockTransfer(client, order, workspaceId, transfer);
      }

      // 数量库存的异常隔离：以维修量流水代替无来源的直接增减。
      // 与订单、预占及资产状态变更同一事务，任一写入失败时整批回滚。
      for (const quarantine of stockQuarantines) {
        if (quarantine.quantity <= 0) continue;
        await this.applyStockMaintenanceDelta(client, order.tenantId, workspaceId, quarantine, quarantine.quantity, "maintenance_quarantine");
      }
    };

    if (tx) {
      await write(tx);
      return;
    }
    await this.prisma.$transaction(write);
  }

  private async applyReturnStockTransfer(client: RentalFactTx, order: RentalOrder, workspaceId: string, transfer: StockReturnTransfer) {
    if (!Number.isInteger(transfer.quantity) || transfer.quantity <= 0) throw new BadRequestException("归还调拨数量必须是正整数");
    const fingerprint = createHash("sha256").update(JSON.stringify({
      type: "return_transfer", itemGroupId: transfer.itemGroupId, fromLocationId: transfer.fromLocationId,
      toLocationId: transfer.toLocationId, quantity: transfer.quantity, sourceOrderId: transfer.sourceOrderId,
      sourceInspectionId: transfer.sourceInspectionId ?? null, batchNo: transfer.batchNo, reason: transfer.reason
    })).digest("hex");
    const existing = await client.rentalStockLedgerEntry.findMany({
      where: { tenantId: order.tenantId, workspaceId, idempotencyKey: transfer.idempotencyKey },
      select: { entryKind: true, requestFingerprint: true }
    });
    if (existing.length) {
      if (existing.length === 2 && existing.every((entry) => entry.requestFingerprint === fingerprint)
        && new Set(existing.map((entry) => entry.entryKind)).size === 2
        && existing.some((entry) => entry.entryKind === "out") && existing.some((entry) => entry.entryKind === "in")) return;
      throw new ConflictException("归还调拨流水不完整或幂等键冲突，请先核对库存台账");
    }

    const [group, locations] = await Promise.all([
      client.rentalItemGroup.findFirst({ where: { id: transfer.itemGroupId, tenantId: order.tenantId, workspaceId }, select: { inventoryMode: true } }),
      client.rentalFulfillmentLocation.findMany({
        where: { id: { in: [transfer.fromLocationId, transfer.toLocationId] }, tenantId: order.tenantId, workspaceId },
        select: { id: true }
      })
    ]);
    if (!group || !["QUANTITY", "BUNDLE"].includes(group.inventoryMode)) throw new ConflictException("只有数量库存或套装库存允许进行归还地点调拨");
    if (locations.length !== 2) throw new ConflictException("归还调拨地点不存在或不属于当前租户经营空间");

    // 目的地点可能尚无余额行，先以 0 建立；来源行必须已存在，否则不能凭空制造入库。
    await client.rentalStockBalance.upsert({
      where: { workspaceId_itemGroupId_locationId: { workspaceId, itemGroupId: transfer.itemGroupId, locationId: transfer.toLocationId } },
      create: { id: randomUUID(), tenantId: order.tenantId, workspaceId, itemGroupId: transfer.itemGroupId, locationId: transfer.toLocationId, onHandQuantity: 0, reservedQuantity: 0, maintenanceQuantity: 0 },
      update: {}
    });
    const locationIds = [transfer.fromLocationId, transfer.toLocationId].sort();
    const locked = await client.$queryRaw<Array<{ id: string; locationId: string; onHandQuantity: number; maintenanceQuantity: number }>>(Prisma.sql`
      SELECT \`id\`, \`locationId\`, \`onHandQuantity\`, \`maintenanceQuantity\`
      FROM \`rental_stock_balances\`
      WHERE \`tenantId\` = ${order.tenantId} AND \`workspaceId\` = ${workspaceId}
        AND \`itemGroupId\` = ${transfer.itemGroupId} AND \`locationId\` IN (${Prisma.join(locationIds)})
      ORDER BY \`locationId\` FOR UPDATE
    `);
    const byLocation = new Map(locked.map((row) => [row.locationId, row]));
    const source = byLocation.get(transfer.fromLocationId);
    const destination = byLocation.get(transfer.toLocationId);
    if (!source || !destination) throw new ConflictException("归还调拨库存台账不完整，不能确认实物转移");
    const reservations = await this.activeReservations(order.tenantId, client);
    const reservedAtSource = peakReservedQuantity(reservations
      .filter(row => row.itemGroupId === transfer.itemGroupId && row.locationId === transfer.fromLocationId),
      new Date().toISOString(), "9999-12-31T00:00:00.000Z");
    const sourceAfter = source.onHandQuantity - transfer.quantity;
    const destinationAfter = destination.onHandQuantity + transfer.quantity;
    // 实际返还转移不因未来预约不足而拒记；未来承诺由分配异常核对，不能把它当现在的实物。
    if (sourceAfter < source.maintenanceQuantity) {
      throw new ConflictException("来源地点实物库存不足，不能完成异地归还调拨；请先核对在途和库存账");
    }
    const sourceUpdated = await client.rentalStockBalance.updateMany({
      where: { id: source.id, tenantId: order.tenantId, workspaceId, onHandQuantity: source.onHandQuantity },
      data: { onHandQuantity: sourceAfter }
    });
    if (sourceUpdated.count !== 1) throw new ConflictException("来源地点库存已变化，请刷新后重试");
    const destinationUpdated = await client.rentalStockBalance.updateMany({
      where: { id: destination.id, tenantId: order.tenantId, workspaceId, onHandQuantity: destination.onHandQuantity },
      data: { onHandQuantity: destinationAfter }
    });
    if (destinationUpdated.count !== 1) throw new ConflictException("实收地点库存已变化，请刷新后重试");

    const operationId = `return_${fingerprint.slice(0, 32)}`;
    const rows = [
      { kind: "out" as const, locationId: transfer.fromLocationId, before: source.onHandQuantity, after: sourceAfter, reserved: reservedAtSource },
      { kind: "in" as const, locationId: transfer.toLocationId, before: destination.onHandQuantity, after: destinationAfter,
        reserved: peakReservedQuantity(reservations.filter(row => row.itemGroupId === transfer.itemGroupId && row.locationId === transfer.toLocationId),
          new Date().toISOString(), "9999-12-31T00:00:00.000Z") }
    ];
    for (const entry of rows) {
      await client.rentalStockLedgerEntry.create({ data: {
        id: randomUUID(), tenantId: order.tenantId, workspaceId, operationId, entryKind: entry.kind,
        operationType: "return_transfer", itemGroupId: transfer.itemGroupId, locationId: entry.locationId,
        quantityDelta: entry.kind === "out" ? -transfer.quantity : transfer.quantity,
        onHandBefore: entry.before, onHandAfter: entry.after, maintenanceDelta: 0,
        reservedQuantity: entry.reserved, maintenanceQuantity: entry.kind === "out" ? source.maintenanceQuantity : destination.maintenanceQuantity,
        reason: transfer.reason, batchNo: transfer.batchNo, sourceDocumentNo: order.orderNo,
        sourceOrderId: transfer.sourceOrderId, sourceInspectionId: transfer.sourceInspectionId ?? null,
        idempotencyKey: transfer.idempotencyKey, requestFingerprint: fingerprint, operator: transfer.operator
      } });
    }
  }

  private async applyStockMaintenanceDelta(
    client: RentalFactTx,
    tenantId: string,
    workspaceId: string,
    change: StockQuarantineChange,
    delta: number,
    operationType: "maintenance_quarantine" | "maintenance_release"
  ) {
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestException("维修隔离量变更必须是非零整数");
    const fingerprint = createHash("sha256").update(JSON.stringify({
    operationType, itemGroupId: change.itemGroupId, locationId: change.locationId, delta,
    sourceOrderId: change.sourceOrderId, sourceInspectionId: change.sourceInspectionId ?? null,
    sourceDispositionId: change.sourceDispositionId ?? null,
    batchNo: change.batchNo, reason: change.reason
    })).digest("hex");
    const existing = await client.rentalStockLedgerEntry.findFirst({
      where: { tenantId, workspaceId, idempotencyKey: change.idempotencyKey, entryKind: "single" },
      select: { requestFingerprint: true }
    });
    if (existing) {
      if (existing.requestFingerprint === fingerprint) return;
      throw new ConflictException("维修隔离流水幂等键冲突，请核对处置记录");
    }
    const rows = await client.$queryRaw<Array<{ id: string; onHandQuantity: number; maintenanceQuantity: number }>>(Prisma.sql`
      SELECT \`id\`, \`onHandQuantity\`, \`maintenanceQuantity\` FROM \`rental_stock_balances\`
      WHERE \`tenantId\` = ${tenantId} AND \`workspaceId\` = ${workspaceId}
        AND \`itemGroupId\` = ${change.itemGroupId} AND \`locationId\` = ${change.locationId}
      FOR UPDATE
    `);
    const balance = rows[0];
    if (!balance) throw new ConflictException(`商品 ${change.itemGroupId} 在网点 ${change.locationId} 没有库存台账，无法记录维修隔离变更`);
    const reservations = await this.activeReservations(tenantId, client);
    const reservedQuantity = peakReservedQuantity(reservations
      .filter(row => row.itemGroupId === change.itemGroupId && row.locationId === change.locationId),
      new Date().toISOString(), "9999-12-31T00:00:00.000Z");
    const nextMaintenance = balance.maintenanceQuantity + delta;
    if (nextMaintenance < 0) throw new ConflictException("库存维修隔离量不足，不能恢复可租数量");
    // 坏货已实际归还，未来预占冲突不能使本次检查/隔离回滚为仍在租。
    if (nextMaintenance > balance.onHandQuantity) throw new ConflictException("维修隔离量不能超过实际在手库存");
    const updated = await client.rentalStockBalance.updateMany({
      where: { id: balance.id, tenantId, workspaceId, maintenanceQuantity: balance.maintenanceQuantity },
      data: { maintenanceQuantity: nextMaintenance }
    });
    if (updated.count !== 1) throw new ConflictException("库存维修隔离量已变化，请刷新后重试");
    await client.rentalStockLedgerEntry.create({ data: {
      id: randomUUID(), tenantId, workspaceId, operationId: `maintenance_${fingerprint.slice(0, 32)}`,
      entryKind: "single", operationType, itemGroupId: change.itemGroupId, locationId: change.locationId,
      quantityDelta: 0, onHandBefore: balance.onHandQuantity, onHandAfter: balance.onHandQuantity,
      maintenanceDelta: delta, reservedQuantity, maintenanceQuantity: nextMaintenance,
      reason: change.reason, batchNo: change.batchNo, sourceDocumentNo: change.sourceOrderNo,
      sourceOrderId: change.sourceOrderId, sourceInspectionId: change.sourceInspectionId ?? null,
      sourceDispositionId: change.sourceDispositionId ?? null,
      idempotencyKey: change.idempotencyKey, requestFingerprint: fingerprint, operator: change.operator
    } });
  }

  /* ---------- 可用量与分配 ---------- */

  /**
   * 对本次下单实际依赖的基础库存行加排他锁。调用方必须先展开套装并按稳定顺序传入：
   * 序列化库存锁定地点下的资产行，数量库存锁定唯一余额行。拿到锁后再查预占，
   * 可确保同一资源的并发下单串行重算，而不同地点仍可并行。
   */
  async lockInventoryTargets(tenantId: string, locationId: string, targets: InventoryLockTarget[], tx: RentalFactTx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const ordered = [...targets].sort((left, right) =>
      `${left.itemGroupId}:${left.inventoryMode}`.localeCompare(`${right.itemGroupId}:${right.inventoryMode}`)
    );
    for (const target of ordered) {
      if (target.inventoryMode === RentalInventoryMode.Serialized) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\` FROM \`rental_assets\`
          WHERE \`tenantId\` = ${tenantId}
            AND \`workspaceId\` = ${workspaceId}
            AND \`itemGroupId\` = ${target.itemGroupId}
            AND \`locationId\` = ${locationId}
          ORDER BY \`id\` FOR UPDATE
        `);
      } else if ([RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(target.inventoryMode)) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\` FROM \`rental_stock_balances\`
          WHERE \`tenantId\` = ${tenantId}
            AND \`workspaceId\` = ${workspaceId}
            AND \`itemGroupId\` = ${target.itemGroupId}
            AND \`locationId\` = ${locationId}
          ORDER BY \`id\` FOR UPDATE
        `);
      }
    }
  }

  /**
   * 参与占用的预占。软预占过期的行不计入，与内存实现的判定保持一致。
   */
  async activeReservations(tenantId: string, tx?: RentalFactTx): Promise<ActiveReservationRow[]> {
    const now = new Date();
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalReservation.findMany({
      where: {
        tenantId,
        workspaceId,
        status: { in: ACTIVE_RESERVATION_STATES },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }]
      },
      select: {
        orderId: true, orderLineId: true, itemGroupId: true, locationId: true,
        quantity: true, releasedQuantity: true, startAt: true, endAt: true, status: true,
        order: { select: {
          ruleSnapshot: true,
          allocations: { where: { status: { in: IN_USE_ALLOCATION_STATES } }, select: { orderLineId: true, itemGroupId: true, assetId: true } }
        } }
      }
    });
    return rows.map((row) => ({
      orderId: row.orderId,
      assetIds: row.order.allocations
        .filter((allocation) => allocation.orderLineId === row.orderLineId && (!allocation.itemGroupId || allocation.itemGroupId === row.itemGroupId))
        .map((allocation) => allocation.assetId).filter((assetId): assetId is string => Boolean(assetId)),
      itemGroupId: row.itemGroupId,
      locationId: row.locationId,
      quantity: Math.max(0, row.quantity - row.releasedQuantity),
      ...bufferedRentalPeriod(iso(row.startAt), row.status === "FULFILLED" && row.endAt <= now ? "9999-12-30T00:00:00.000Z" : iso(row.endAt), row.order.ruleSnapshot as unknown as RentalRuleConfig)
    }));
  }

  /** 已被有效分配占住的资产 id，用于配货时排除。 */
  /**
   * 配货前对候选资产行加排他锁。
   *
   * 锁的粒度是「租户 + 商品组 + 地点」下的全部资产行，与 lockInventoryTargets
   * 的序列化分支一致：同一资源的并发配货因此串行，不同地点或不同商品组仍可并行。
   * 按 id 排序取锁，避免与其他按同序取锁的路径互相死锁。
   */
  async lockAssetsForAllocation(
    tenantId: string,
    itemGroupId: string,
    locationId: string,
    tx: RentalFactTx
  ): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`rental_assets\`
      WHERE \`tenantId\` = ${tenantId}
        AND \`workspaceId\` = ${workspaceId}
        AND \`itemGroupId\` = ${itemGroupId}
        AND \`locationId\` = ${locationId}
      ORDER BY \`id\` FOR UPDATE
    `);
  }

  async allocatedAssetIds(tenantId: string, tx?: RentalFactTx, excludeOrderId?: string): Promise<Set<string>> {
    const client = tx ?? this.prisma;
    // 分配表没有 workspaceId（它是订单子表），通过父订单的空间条件过滤。
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalAllocation.findMany({
      where: {
        status: { in: IN_USE_ALLOCATION_STATES },
        assetId: { not: null },
        order: { tenantId, workspaceId, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) }
      },
      select: { assetId: true }
    });
    return new Set(rows.map((row) => row.assetId).filter((value): value is string => Boolean(value)));
  }

  /* ---------- 资产 ---------- */

  private async assetVisibilityWhere(client: Prisma.TransactionClient, tenantId: string, workspaceId: string): Promise<Prisma.RentalAssetWhereInput> {
    const ownScope = getRequestDataScope() === "own";
    const userId = getRequestUserId();
    const ownAssetIds = ownScope && userId
      ? (await client.rentalWorkOrder.findMany({
          where: { tenantId, workspaceId, assetId: { not: null }, OR: [{ createdBy: userId }, { assigneeId: userId }] },
          select: { assetId: true },
          distinct: ["assetId"]
        })).map((row) => row.assetId).filter((id): id is string => Boolean(id))
      : undefined;
    return { ...this.staffLocationWhere(),
      ...(ownScope ? { id: { in: ownAssetIds?.length ? ownAssetIds : ["__no_owned_asset__"] } } : {}) };
  }

  async listAssets(tenantId: string, tx?: RentalFactTx): Promise<RentalAsset[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalAsset.findMany({
      where: { tenantId, workspaceId, ...await this.assetVisibilityWhere(client, tenantId, workspaceId) },
      include: { itemGroup: { select: { code: true, name: true } }, location: { select: { name: true } } },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      itemGroupId: row.itemGroupId,
      itemGroupCode: row.itemGroup.code,
      itemGroupName: row.itemGroup.name,
      assetNo: row.assetNo,
      serialNo: row.serialNo ?? undefined,
      locationId: row.locationId,
      locationName: row.location.name,
      status: lower<RentalAssetStatus>(row.status),
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    }));
  }

  async listAssetStatusHistory(tenantId: string, assetId: string, tx?: RentalFactTx): Promise<RentalAssetStatusHistory[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const asset = (await this.listAssets(tenantId, tx)).find((row) => row.id === assetId);
    if (!asset) throw new NotFoundException("资产不存在或不属于当前经营空间");
    const rows = await client.rentalAssetStatusHistory.findMany({
      where: { tenantId, workspaceId, assetId },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return rows.map(toAssetStatusHistory);
  }

  async findAssetByNo(tenantId: string, assetNo: string): Promise<{ id: string } | null> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.prisma.rentalAsset.findFirst({ where: { tenantId, workspaceId, assetNo }, select: { id: true } });
  }

  async upsertAsset(
    asset: RentalAsset,
    uniqueAttributes: RentalUniqueAttributeClaim[] = [],
    statusChange?: AssetStatusHistoryMetadata,
    expectedBinding?: CategoryWriteBinding
  ): Promise<void> {
    const data = {
      tenantId: asset.tenantId,
      itemGroupId: asset.itemGroupId,
      assetNo: asset.assetNo,
      serialNo: asset.serialNo ?? null,
      locationId: asset.locationId,
      status: upper<$Enums.RentalAssetState>(asset.status),
      attributes: asset.attributes as Prisma.InputJsonValue
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const workspaceId = await resolveScopeWorkspaceId(tx, asset.tenantId);
        const activeWrite = await validateActiveCategoryWrite(tx, asset.tenantId, workspaceId, {
          id: asset.id, scope: "asset", attributes: asset.attributes, serialNo: asset.serialNo
        }, expectedBinding);
        await tx.rentalAttributeUniqueValue.deleteMany({
          where: { tenantId: asset.tenantId, workspaceId, entityType: "asset", entityId: asset.id }
        });
        for (const claim of activeWrite.claims) {
          try {
            await tx.rentalAttributeUniqueValue.create({
              data: {
                id: `attruniq_${createHash("sha256").update(`${workspaceId}|asset|${claim.fieldCode}|${claim.normalizedValue}`).digest("hex")}`,
                tenantId: asset.tenantId,
                workspaceId,
                entityType: "asset",
                fieldCode: claim.fieldCode,
                normalizedHash: createHash("sha256").update(claim.normalizedValue).digest("hex"),
                normalizedValue: claim.normalizedValue,
                entityId: asset.id
              }
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              throw new ConflictException(`${claim.label}已存在`);
            }
            throw error;
          }
        }
        const existing = await tx.rentalAsset.findUnique({
          where: { id: asset.id },
          select: { tenantId: true, workspaceId: true, status: true, assetNo: true }
        });
        if (existing && (existing.tenantId !== asset.tenantId || existing.workspaceId !== workspaceId)) {
          throw new ConflictException("资产事实已属于其他租户或经营空间，拒绝覆盖");
        }
        if (existing) {
          const current = (await this.lockAssetRows(tx, asset.tenantId, workspaceId, [asset.id])).get(asset.id)!;
          existing.status = current.status;
          if (data.status === "AVAILABLE") {
            const dispositions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_stock_dispositions
              FORCE INDEX (rental_stock_dispositions_asset_status_idx)
              WHERE workspaceId = ${workspaceId} AND assetId = ${asset.id} AND tenantId = ${asset.tenantId}
                AND status IN ('blocked', 'buffered') FOR UPDATE`);
            const workOrders = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_work_orders
              FORCE INDEX (rental_work_orders_asset_status_idx)
              WHERE workspaceId = ${workspaceId} AND assetId = ${asset.id} AND tenantId = ${asset.tenantId}
                AND status IN ('pending', 'in_progress', 'pending_review') FOR UPDATE`);
            if (dispositions.length || workOrders.length) throw new ConflictException("资产仍有未完成的归还处置或养护工单，不能通过资料维护恢复可租");
          }
          await tx.rentalAsset.update({ where: { id: asset.id }, data: { ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue, serialNo: activeWrite.serialNo ?? null } });
        } else {
          await tx.rentalAsset.create({
            data: { workspaceId, id: asset.id, ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue, serialNo: activeWrite.serialNo ?? null, createdAt: new Date(asset.createdAt) }
          });
        }
        await appendAssetStatusHistory(tx, {
          tenantId: asset.tenantId,
          workspaceId,
          assetId: asset.id,
          assetNo: asset.assetNo,
          fromStatus: existing?.status,
          toStatus: asset.status,
          source: existing ? "manual" : "onboarding",
          reason: statusChange?.reason ?? (existing ? "资产资料维护" : "资产登记"),
          operator: statusChange?.operator,
          recordUnchanged: Boolean(existing && ["MAINTENANCE", "DISABLED", "INSPECTION"].includes(data.status))
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      // MySQL 在多个请求同时争抢同一唯一键时可能以死锁/写冲突结束事务，
      // Prisma 映射为 P2034。唯一约束已经保证不会双写，这里只把技术性 500
      // 转成稳定的业务冲突；不自动重试写请求，避免调用方误判副作用次数。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException(`${uniqueAttributes[0]?.label ?? "唯一字段"}已存在`);
      }
      throw error;
    }
  }

  /* ---------- 数量库存 ---------- */

  /** 返回在手/维护量原值；预占与可用量由服务层结合 activeReservations 计算。 */
  async listStockBalances(tenantId: string, tx?: RentalFactTx): Promise<RentalStockBalance[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalStockBalance.findMany({
      where: { tenantId, workspaceId, ...this.staffLocationWhere() },
      include: { itemGroup: { select: { code: true, name: true } }, location: { select: { name: true } } },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      itemGroupId: row.itemGroupId,
      itemGroupCode: row.itemGroup.code,
      itemGroupName: row.itemGroup.name,
      locationId: row.locationId,
      locationName: row.location.name,
      onHandQuantity: row.onHandQuantity,
      reservedQuantity: row.reservedQuantity,
      maintenanceQuantity: row.maintenanceQuantity,
      availableQuantity: Math.max(0, row.onHandQuantity - row.maintenanceQuantity - row.reservedQuantity),
      updatedAt: iso(row.updatedAt)
    }));
  }

  /**
   * 盘点只维护在手量；维修隔离量只能由归还处置的隔离、恢复或核销流水改变。
   * 省略 maintenanceQuantity 表示沿用现值；显式提交不同值必须拒绝，避免绕过来源流水。
   */
  async applyStockCount(input: StockCountInput): Promise<{ id: string; onHandQuantity: number; maintenanceQuantity: number }> {
    return this.prisma.$transaction(async (tx) => {
      const workspaceId = await resolveScopeWorkspaceId(tx, input.tenantId);
      await this.lockInventoryTargets(
        input.tenantId,
        input.locationId,
        [{ itemGroupId: input.itemGroupId, inventoryMode: RentalInventoryMode.Quantity }],
        tx
      );
      const existing = await tx.rentalStockBalance.findFirst({
        where: { tenantId: input.tenantId, workspaceId, itemGroupId: input.itemGroupId, locationId: input.locationId },
        select: { id: true, maintenanceQuantity: true }
      });
      const maintenanceQuantity = existing?.maintenanceQuantity ?? 0;
      if (input.maintenanceQuantity !== undefined && input.maintenanceQuantity !== maintenanceQuantity) {
        throw new ConflictException("维修隔离量不能通过盘点直接修改，请在归还处置中完成恢复或核销");
      }
      // 在手数量兜不住维修量时明确拒绝，而不是把维修量截断——截断会静默释放隔离。
      if (maintenanceQuantity > input.onHandQuantity) {
        throw new ConflictException(
          `维修隔离数量 ${maintenanceQuantity} 超过在手数量 ${input.onHandQuantity}，请先处理隔离中的商品再下调库存`
        );
      }
      const id = existing?.id ?? input.id;
      const data = {
        tenantId: input.tenantId,
        itemGroupId: input.itemGroupId,
        locationId: input.locationId,
        onHandQuantity: input.onHandQuantity,
        maintenanceQuantity
      };
      const existingById = await tx.rentalStockBalance.findUnique({
        where: { id },
        select: { tenantId: true, workspaceId: true }
      });
      if (existingById && (existingById.tenantId !== input.tenantId || existingById.workspaceId !== workspaceId)) {
        throw new ConflictException("库存台账已属于其他租户或经营空间，拒绝覆盖");
      }
      if (existingById) {
        await tx.rentalStockBalance.update({ where: { id }, data });
      } else {
        await tx.rentalStockBalance.create({ data: { workspaceId, id, ...data } });
      }
      return { id, onHandQuantity: input.onHandQuantity, maintenanceQuantity };
    });
  }

  async listStockLedger(
    tenantId: string,
    filters: { itemGroupId?: string; locationId?: string; batchNo?: string; sourceDocumentNo?: string; limit?: number } = {},
    tx?: RentalFactTx
  ): Promise<RentalStockLedgerEntry[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const take = Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 200);
    const rows = await client.rentalStockLedgerEntry.findMany({
      where: {
        tenantId,
        workspaceId,
        ...this.staffLocationWhere(),
        ...(filters.itemGroupId ? { itemGroupId: filters.itemGroupId } : {}),
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(filters.batchNo ? { batchNo: filters.batchNo } : {}),
        ...(filters.sourceDocumentNo ? { sourceDocumentNo: filters.sourceDocumentNo } : {})
      },
      include: { itemGroup: { select: { code: true, name: true } }, location: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take
    });
    return rows.map(toStockLedgerEntry);
  }

  /**
   * 通过单事务写入数量与一次性耗材库存作业和追加流水。
   *
   * 先确保目标余额行存在，再按地点排序锁行；所有减少库存的动作都必须留下
   * `reserved + maintenance`，因此盘点/报损/退出不能把正在租赁或隔离中的数量
   * 直接抹掉。相同幂等键只回放第一次结果，业务参数变化则明确冲突。
   */
  async applyStockOperation(input: StockOperationInput): Promise<AppliedStockOperation> {
    const batchNo = input.batchNo?.trim() || undefined;
    const sourceDocumentNo = input.sourceDocumentNo?.trim() || undefined;
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      type: input.type,
      itemGroupId: input.itemGroupId,
      locationId: input.locationId ?? null,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      quantity: input.quantity ?? null,
      actualOnHandQuantity: input.actualOnHandQuantity ?? null,
      reason: input.reason,
      batchNo: batchNo ?? null,
      sourceDocumentNo: sourceDocumentNo ?? null
    })).digest("hex");

    return this.prisma.$transaction(async (tx) => {
      const workspaceId = await resolveScopeWorkspaceId(tx, input.tenantId);
      const existing = await tx.rentalStockLedgerEntry.findMany({
        where: { tenantId: input.tenantId, workspaceId, idempotencyKey: input.idempotencyKey },
        include: { itemGroup: { select: { code: true, name: true } }, location: { select: { name: true } } },
        orderBy: { createdAt: "asc" }
      });
      if (existing.length) {
        if (existing.some((row) => row.requestFingerprint !== requestFingerprint)) {
          throw new ConflictException("同一幂等键已用于另一笔库存作业，请更换幂等键");
        }
        return {
          operationId: existing[0].operationId,
          operationType: existing[0].operationType as RentalStockOperationType,
          idempotent: true,
          entries: existing.map(toStockLedgerEntry)
        };
      }

      const isTransfer = input.type === "transfer";
      const targetLocationIds = isTransfer
        ? [input.fromLocationId, input.toLocationId]
        : [input.locationId];
      const locationIds = [...new Set(targetLocationIds.filter((value): value is string => Boolean(value)))].sort();
      if (isTransfer && (locationIds.length !== 2 || input.fromLocationId === input.toLocationId)) {
        throw new BadRequestException("调拨必须选择两个不同的履约地点");
      }
      if (!isTransfer && locationIds.length !== 1) {
        throw new BadRequestException("该库存作业必须选择履约地点");
      }

      for (const locationId of locationIds) {
        await tx.rentalStockBalance.upsert({
          where: { workspaceId_itemGroupId_locationId: { workspaceId, itemGroupId: input.itemGroupId, locationId } },
          create: {
            id: randomUUID(), tenantId: input.tenantId, workspaceId, itemGroupId: input.itemGroupId, locationId,
            onHandQuantity: 0, reservedQuantity: 0, maintenanceQuantity: 0
          },
          update: {}
        });
      }

      const lockedRows = await tx.$queryRaw<Array<{
        id: string;
        locationId: string;
        onHandQuantity: number;
        maintenanceQuantity: number;
      }>>(Prisma.sql`
        SELECT \`id\`, \`locationId\`, \`onHandQuantity\`, \`maintenanceQuantity\`
        FROM \`rental_stock_balances\`
        WHERE \`tenantId\` = ${input.tenantId}
          AND \`workspaceId\` = ${workspaceId}
          AND \`itemGroupId\` = ${input.itemGroupId}
          AND \`locationId\` IN (${Prisma.join(locationIds)})
        ORDER BY \`locationId\` FOR UPDATE
      `);
      if (lockedRows.length !== locationIds.length) throw new ConflictException("库存余额行未能完整锁定，请刷新后重试");

      const reservations = await this.activeReservations(input.tenantId, tx);
      const reservedByLocation = new Map<string, number>();
      for (const reservation of reservations) {
        if (reservation.itemGroupId !== input.itemGroupId || !locationIds.includes(reservation.locationId)) continue;
        reservedByLocation.set(reservation.locationId, (reservedByLocation.get(reservation.locationId) ?? 0) + reservation.quantity);
      }
      const rowsByLocation = new Map(lockedRows.map((row) => [row.locationId, row]));
      const operationId = randomUUID();
      const entries: RentalStockLedgerEntry[] = [];
      const deltas = new Map<string, { delta: number; entryKind: "single" | "out" | "in" }>();
      const quantity = input.quantity ?? 0;

      if (input.type === "count_adjustment") {
        const actualOnHandQuantity = input.actualOnHandQuantity;
        if (typeof actualOnHandQuantity !== "number" || !Number.isInteger(actualOnHandQuantity) || actualOnHandQuantity < 0) throw new BadRequestException("盘点实数必须是非负整数");
        const row = rowsByLocation.get(input.locationId!);
        if (!row) throw new ConflictException("盘点库存余额不存在");
        deltas.set(input.locationId!, { delta: actualOnHandQuantity - row.onHandQuantity, entryKind: "single" });
      } else {
        if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException("库存作业数量必须是正整数");
        if (input.type === "transfer") {
          deltas.set(input.fromLocationId!, { delta: -quantity, entryKind: "out" });
          deltas.set(input.toLocationId!, { delta: quantity, entryKind: "in" });
        } else {
          deltas.set(input.locationId!, {
            delta: input.type === "receive" ? quantity : -quantity,
            entryKind: input.type === "consume" ? "out" : "single"
          });
        }
      }

      for (const [locationId, change] of deltas) {
        const row = rowsByLocation.get(locationId)!;
        const reservedQuantity = reservedByLocation.get(locationId) ?? 0;
        const nextOnHand = row.onHandQuantity + change.delta;
        if (nextOnHand < reservedQuantity + row.maintenanceQuantity) {
          throw new ConflictException(`${locationId === input.fromLocationId ? "调出" : "调整"}数量会低于已预占或维护隔离数量，当前可操作在手数量为 ${Math.max(0, row.onHandQuantity - reservedQuantity - row.maintenanceQuantity)}`);
        }
        const updated = await tx.rentalStockBalance.updateMany({
          where: { id: row.id, tenantId: input.tenantId, workspaceId, onHandQuantity: row.onHandQuantity },
          data: { onHandQuantity: nextOnHand }
        });
        if (updated.count !== 1) throw new ConflictException("库存余额已被其他操作修改，请刷新后重试");
        const ledgerRow = await tx.rentalStockLedgerEntry.create({
          data: {
            id: randomUUID(), tenantId: input.tenantId, workspaceId, operationId,
            entryKind: change.entryKind, operationType: input.type, itemGroupId: input.itemGroupId, locationId,
            quantityDelta: change.delta, onHandBefore: row.onHandQuantity, onHandAfter: nextOnHand,
            reservedQuantity, maintenanceQuantity: row.maintenanceQuantity, reason: input.reason.trim(),
            batchNo, sourceDocumentNo,
            idempotencyKey: input.idempotencyKey, requestFingerprint, operator: input.operator
          },
          include: { itemGroup: { select: { code: true, name: true } }, location: { select: { name: true } } }
        });
        entries.push(toStockLedgerEntry(ledgerRow));
      }
      return { operationId, operationType: input.type, idempotent: false, entries };
    });
  }

  /**
   * 领取时消耗一次性库存。
   *
   * 耗材不能沿用“归还后释放预占”的数量库存语义：领取成功即减少在手，
   * 后续归还不能把它重新放回可用池。这里排除当前订单的预占后再检查其它
   * 订单，避免把本单已经锁住的数量重复算进库存不足判断；订单聚合与本方法
   * 必须共用同一事务，保证不能出现“订单已领取但库存未扣”或反过来的半事实。
   */
  async consumeStockForOrder(
    tenantId: string,
    orderId: string,
    lines: ConsumableStockConsumption[],
    operator: string,
    tx: RentalFactTx
  ): Promise<void> {
    if (!lines.length) return;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const grouped = new Map<string, ConsumableStockConsumption>();
    for (const line of lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new BadRequestException("耗材领取数量必须是正整数");
      }
      const key = `${line.itemGroupId}:${line.locationId}`;
      const current = grouped.get(key);
      if (current) current.quantity += line.quantity;
      else grouped.set(key, { ...line });
    }

    for (const line of [...grouped.values()].sort((a, b) => `${a.locationId}:${a.itemGroupId}`.localeCompare(`${b.locationId}:${b.itemGroupId}`))) {
      const group = await tx.rentalItemGroup.findFirst({
        where: { id: line.itemGroupId, tenantId, workspaceId },
        select: { inventoryMode: true }
      });
      if (!group) throw new NotFoundException("耗材商品不存在或不属于当前经营空间");
      if (group.inventoryMode !== "CONSUMABLE") throw new ConflictException("只有一次性耗材可以在领取时消耗库存");

      const idempotencyKey = `consume:${orderId}:${line.itemGroupId}:${line.locationId}`;
      const operationId = `consume:${orderId}`;
      const requestFingerprint = createHash("sha256").update(JSON.stringify({
        operationId,
        itemGroupId: line.itemGroupId,
        locationId: line.locationId,
        quantity: line.quantity
      })).digest("hex");
      const existing = await tx.rentalStockLedgerEntry.findFirst({
        where: { tenantId, workspaceId, idempotencyKey, entryKind: "out" },
        select: { id: true, requestFingerprint: true }
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ConflictException("同一耗材领取幂等键已用于另一笔消耗，请刷新后重试");
        }
        continue;
      }

      const rows = await tx.$queryRaw<Array<{
        id: string;
        onHandQuantity: number;
        maintenanceQuantity: number;
      }>>(Prisma.sql`
        SELECT \`id\`, \`onHandQuantity\`, \`maintenanceQuantity\`
        FROM \`rental_stock_balances\`
        WHERE \`tenantId\` = ${tenantId}
          AND \`workspaceId\` = ${workspaceId}
          AND \`itemGroupId\` = ${line.itemGroupId}
          AND \`locationId\` = ${line.locationId}
        FOR UPDATE
      `);
      const balance = rows[0];
      if (!balance) throw new ConflictException("耗材没有库存台账，不能领取");

      const now = new Date();
      const otherReservations = await tx.rentalReservation.findMany({
        where: {
          tenantId,
          workspaceId,
          orderId: { not: orderId },
          itemGroupId: line.itemGroupId,
          locationId: line.locationId,
          status: { in: ACTIVE_RESERVATION_STATES },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }]
        },
        select: { quantity: true, releasedQuantity: true }
      });
      const reservedByOthers = otherReservations.reduce(
        (sum, reservation) => sum + Math.max(0, reservation.quantity - reservation.releasedQuantity),
        0
      );
      const available = balance.onHandQuantity - balance.maintenanceQuantity - reservedByOthers;
      if (available < line.quantity) {
        throw new ConflictException(`耗材库存不足，当前可领取 ${Math.max(0, available)}，需要 ${line.quantity}`);
      }

      const updated = await tx.rentalStockBalance.updateMany({
        where: { id: balance.id, tenantId, workspaceId, onHandQuantity: balance.onHandQuantity },
        data: { onHandQuantity: { decrement: line.quantity } }
      });
      if (updated.count !== 1) throw new ConflictException("耗材库存已被其他操作修改，请刷新后重试");

      await tx.rentalStockLedgerEntry.create({
        data: {
          id: randomUUID(),
          tenantId,
          workspaceId,
          operationId,
          entryKind: "out",
          operationType: "consume",
          itemGroupId: line.itemGroupId,
          locationId: line.locationId,
          quantityDelta: -line.quantity,
          onHandBefore: balance.onHandQuantity,
          onHandAfter: balance.onHandQuantity - line.quantity,
          reservedQuantity: reservedByOthers,
          maintenanceQuantity: balance.maintenanceQuantity,
          reason: `订单 ${orderId} 领取消耗`,
          idempotencyKey,
          requestFingerprint,
          operator: operator || "系统"
        }
      });
    }
  }

  async findStockBalance(tenantId: string, itemGroupId: string, locationId: string) {
    return this.prisma.rentalStockBalance.findFirst({
      where: { tenantId, workspaceId: await resolveScopeWorkspaceId(this.prisma, tenantId), itemGroupId, locationId },
      select: { id: true }
    });
  }

  async upsertStockBalance(balance: RentalStockBalance): Promise<void> {
    const data = {
      tenantId: balance.tenantId,
      itemGroupId: balance.itemGroupId,
      locationId: balance.locationId,
      onHandQuantity: balance.onHandQuantity,
      maintenanceQuantity: balance.maintenanceQuantity
    };
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, balance.tenantId);
    const existing = await this.prisma.rentalStockBalance.findUnique({
      where: { id: balance.id },
      select: { tenantId: true, workspaceId: true }
    });
    if (existing && (existing.tenantId !== balance.tenantId || existing.workspaceId !== workspaceId)) {
      throw new ConflictException("库存台账已属于其他租户或经营空间，拒绝覆盖");
    }
    if (existing) {
      await this.prisma.rentalStockBalance.update({ where: { id: balance.id }, data });
    } else {
      await this.prisma.rentalStockBalance.create({ data: { workspaceId, id: balance.id, ...data } });
    }
  }

  async listStockDispositions(tenantId: string, orderId?: string, tx?: RentalFactTx): Promise<RentalStockDisposition[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalStockDisposition.findMany({
      where: {
        tenantId, workspaceId, ...(orderId ? { orderId } : {}),
        ...this.stockDispositionVisibilityWhere()
      }, orderBy: { createdAt: "asc" }
    });
    return rows.map(toStockDisposition);
  }

  async upsertStockDisposition(disposition: RentalStockDisposition, tx?: RentalFactTx): Promise<RentalStockDisposition> {
    if (!tx) return this.prisma.$transaction(client => this.upsertStockDisposition(disposition, client));
    const client = tx;
    await this.lockOrder(disposition.tenantId, disposition.orderId, client);
    const workspaceId = await resolveScopeWorkspaceId(client, disposition.tenantId);
    if (disposition.assetId) await this.lockAssetRows(client, disposition.tenantId, workspaceId, [disposition.assetId]);
    const existing = (await client.$queryRaw<Prisma.RentalStockDispositionGetPayload<{}>[]>(Prisma.sql`
      SELECT * FROM rental_stock_dispositions
      WHERE workspaceId = ${workspaceId} AND dedupeKey = ${disposition.dedupeKey} FOR UPDATE`))[0];
    if (existing && (existing.tenantId !== disposition.tenantId || existing.orderId !== disposition.orderId
      || (existing.assetId ?? undefined) !== disposition.assetId || existing.itemGroupId !== disposition.itemGroupId
      || existing.locationId !== disposition.locationId)) throw new ConflictException("库存处置幂等来源与原记录不一致");
    if (existing?.status === "restored" || existing?.status === "written_off") return toStockDisposition(existing);
    const row = await client.rentalStockDisposition.upsert({
      where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: disposition.dedupeKey } },
      create: {
        id: disposition.id,
        tenantId: disposition.tenantId,
        workspaceId,
        orderId: disposition.orderId,
        inspectionId: disposition.inspectionId ?? null,
        returnBatchKey: disposition.returnBatchKey,
        dedupeKey: disposition.dedupeKey,
        itemGroupId: disposition.itemGroupId,
        locationId: disposition.locationId,
        assetId: disposition.assetId ?? null,
        quantity: disposition.quantity,
        receivedAt: new Date(disposition.receivedAt),
        bufferUntil: new Date(disposition.bufferUntil),
        status: disposition.status,
        blockReason: disposition.blockReason ?? null,
        restoredQuantity: disposition.restoredQuantity,
        restoredAt: disposition.restoredAt ? new Date(disposition.restoredAt) : null,
        restoredBy: disposition.restoredBy ?? null,
        createdAt: new Date(disposition.createdAt),
        updatedAt: new Date(disposition.updatedAt)
      },
      update: {
        orderId: disposition.orderId,
        inspectionId: disposition.inspectionId ?? null,
        returnBatchKey: disposition.returnBatchKey,
        itemGroupId: disposition.itemGroupId,
        locationId: disposition.locationId,
        assetId: disposition.assetId ?? null,
        quantity: disposition.quantity,
        receivedAt: new Date(disposition.receivedAt),
        bufferUntil: new Date(disposition.bufferUntil),
        status: disposition.status,
        blockReason: disposition.blockReason ?? null,
        restoredQuantity: disposition.restoredQuantity,
        restoredAt: disposition.restoredAt ? new Date(disposition.restoredAt) : null,
        restoredBy: disposition.restoredBy ?? null
      }
    });
    return toStockDisposition(row);
  }

  async restoreStockDisposition(tenantId: string, dispositionId: string, operator: string, tx?: RentalFactTx): Promise<RentalStockDisposition> {
    const run = (client: RentalFactTx) => this.restoreStockDispositionInClient(client, tenantId, dispositionId, operator);
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async writeOffStockDisposition(
    tenantId: string,
    dispositionId: string,
    reason: string,
    operator: string,
    tx?: RentalFactTx
  ): Promise<RentalStockDisposition> {
    const run = async (client: RentalFactTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
      const normalizedReason = reason.trim();
      if (!normalizedReason) throw new BadRequestException("核销必须填写原因");
      if (normalizedReason.length > 500) throw new BadRequestException("核销原因不能超过 500 个字符");
      const row = await client.rentalStockDisposition.findFirst({
        where: { id: dispositionId, tenantId, workspaceId, ...this.stockDispositionVisibilityWhere() }
      });
      if (!row) throw new NotFoundException("库存处置不存在或不属于当前经营空间");
      if (row.status === "written_off") {
        const fingerprint = this.stockDispositionWriteOffFingerprint(row, normalizedReason);
        const existing = await client.rentalStockLedgerEntry.findFirst({
          where: { tenantId, workspaceId, idempotencyKey: `disposition:${row.id}:maintenance-write-off`, entryKind: "single" },
          select: { requestFingerprint: true }
        });
        if (existing?.requestFingerprint === fingerprint) return toStockDisposition(row);
        throw new ConflictException("该归还处置已核销，不能再次改变核销记录");
      }
      if (row.status === "restored") throw new ConflictException("已恢复可用的归还处置不能再核销");
      if (row.status !== "blocked") throw new ConflictException("仅异常隔离中的数量库存可以核销");
      if (row.assetId) throw new ConflictException("序列化资产请在资产管理中办理报废，不能按数量库存核销");
      const remaining = row.quantity - row.restoredQuantity;
      if (remaining <= 0) throw new ConflictException("该归还处置没有可核销的剩余数量");
      const activeWorkOrders = await client.rentalWorkOrder.count({
        where: { tenantId, workspaceId, dispositionId: row.id, status: { in: ["pending", "in_progress", "pending_review"] } }
      });
      if (activeWorkOrders > 0) throw new ConflictException("关联养护工单尚未完成处理，不能核销");
      const sourceOrder = await client.rentalOrder.findFirst({ where: { id: row.orderId, tenantId, workspaceId }, select: { orderNo: true } });
      if (!sourceOrder) throw new ConflictException("归还处置关联订单不存在，无法记录库存核销流水");

      await this.applyStockDispositionWriteOff(client, tenantId, workspaceId, row, sourceOrder.orderNo, normalizedReason, operator);
      const updated = await client.rentalStockDisposition.updateMany({
        where: { id: row.id, tenantId, workspaceId, status: row.status, restoredQuantity: row.restoredQuantity },
        data: { status: "written_off" }
      });
      if (updated.count !== 1) throw new ConflictException("归还处置已被其他操作修改，请刷新后重试");
      const refreshed = await client.rentalStockDisposition.findFirst({ where: { id: row.id, tenantId, workspaceId } });
      if (!refreshed) throw new NotFoundException("库存核销后无法读取归还处置");
      return toStockDisposition(refreshed);
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private stockDispositionWriteOffFingerprint(row: {
    id: string; itemGroupId: string; locationId: string; quantity: number; restoredQuantity: number;
    orderId: string; inspectionId: string | null; returnBatchKey: string;
  }, reason: string) {
    return createHash("sha256").update(JSON.stringify({
      operationType: "maintenance_write_off", dispositionId: row.id, itemGroupId: row.itemGroupId,
      locationId: row.locationId, quantity: row.quantity - row.restoredQuantity, sourceOrderId: row.orderId,
      sourceInspectionId: row.inspectionId, batchNo: row.returnBatchKey, reason
    })).digest("hex");
  }

  private async applyStockDispositionWriteOff(
    client: RentalFactTx,
    tenantId: string,
    workspaceId: string,
    row: {
      id: string; itemGroupId: string; locationId: string; quantity: number; restoredQuantity: number;
      orderId: string; inspectionId: string | null; returnBatchKey: string;
    },
    orderNo: string,
    reason: string,
    operator: string
  ) {
    const quantity = row.quantity - row.restoredQuantity;
    const requestFingerprint = this.stockDispositionWriteOffFingerprint(row, reason);
    const idempotencyKey = `disposition:${row.id}:maintenance-write-off`;
    const existing = await client.rentalStockLedgerEntry.findFirst({
      where: { tenantId, workspaceId, idempotencyKey, entryKind: "single" },
      select: { requestFingerprint: true }
    });
    if (existing) {
      if (existing.requestFingerprint === requestFingerprint) return;
      throw new ConflictException("库存核销流水幂等键冲突，请核对归还处置");
    }
    const rows = await client.$queryRaw<Array<{ id: string; onHandQuantity: number; maintenanceQuantity: number }>>(Prisma.sql`
      SELECT \`id\`, \`onHandQuantity\`, \`maintenanceQuantity\` FROM \`rental_stock_balances\`
      WHERE \`tenantId\` = ${tenantId} AND \`workspaceId\` = ${workspaceId}
        AND \`itemGroupId\` = ${row.itemGroupId} AND \`locationId\` = ${row.locationId}
      FOR UPDATE
    `);
    const balance = rows[0];
    if (!balance || balance.maintenanceQuantity < quantity || balance.onHandQuantity < quantity) {
      throw new ConflictException("维修隔离量或在手量不足，无法安全核销；请先核对库存台账");
    }
    const reservations = await this.activeReservations(tenantId, client);
    const reservedQuantity = reservations
      .filter((item) => item.itemGroupId === row.itemGroupId && item.locationId === row.locationId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const onHandAfter = balance.onHandQuantity - quantity;
    const maintenanceAfter = balance.maintenanceQuantity - quantity;
    const updated = await client.rentalStockBalance.updateMany({
      where: { id: balance.id, tenantId, workspaceId, onHandQuantity: balance.onHandQuantity, maintenanceQuantity: balance.maintenanceQuantity },
      data: { onHandQuantity: onHandAfter, maintenanceQuantity: maintenanceAfter }
    });
    if (updated.count !== 1) throw new ConflictException("库存余额已变化，请刷新后重试");
    await client.rentalStockLedgerEntry.create({ data: {
      id: randomUUID(), tenantId, workspaceId, operationId: `maintenance_write_off_${requestFingerprint.slice(0, 24)}`,
      entryKind: "single", operationType: "maintenance_write_off", itemGroupId: row.itemGroupId, locationId: row.locationId,
      quantityDelta: -quantity, onHandBefore: balance.onHandQuantity, onHandAfter,
      maintenanceDelta: -quantity, reservedQuantity, maintenanceQuantity: maintenanceAfter,
      reason, batchNo: row.returnBatchKey, sourceDocumentNo: orderNo, sourceOrderId: row.orderId,
      sourceInspectionId: row.inspectionId, sourceDispositionId: row.id,
      idempotencyKey, requestFingerprint, operator
    } });
  }

  private async restoreStockDispositionInClient(client: RentalFactTx, tenantId: string, dispositionId: string, operator: string) {
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const visible = await client.rentalStockDisposition.findFirst({
      where: { id: dispositionId, tenantId, workspaceId, ...this.stockDispositionVisibilityWhere() }
    });
    if (!visible) throw new NotFoundException("库存处置不存在或不属于当前经营空间");
    await this.lockOrder(tenantId, visible.orderId, client);
    const assets = await this.lockAssetRows(client, tenantId, workspaceId, visible.assetId ? [visible.assetId] : []);
    const row = (await client.$queryRaw<Prisma.RentalStockDispositionGetPayload<{}>[]>(Prisma.sql`
      SELECT * FROM rental_stock_dispositions
      WHERE id = ${dispositionId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`))[0];
    if (!row || row.orderId !== visible.orderId || row.assetId !== visible.assetId
      || row.locationId !== visible.locationId || row.itemGroupId !== visible.itemGroupId) {
      throw new ConflictException("库存处置来源已变化，请重新读取后处理");
    }
    if (row.status === "written_off") throw new ConflictException("已核销的归还处置不能恢复可用");
    if (row.status === "blocked") throw new ConflictException("该处置仍有异常阻断，须先完成关联工单验收");
    if (new Date() < row.bufferUntil) throw new ConflictException("归还后周转缓冲尚未结束，暂不能恢复可租");
    const remaining = row.quantity - row.restoredQuantity;
    if (remaining <= 0) throw new ConflictException("该处置已经恢复，不能重复恢复");
    const activeWorkOrders = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM rental_work_orders FORCE INDEX (rental_work_orders_disp_type_key)
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND dispositionId = ${row.id} AND status IN ('pending', 'in_progress', 'pending_review') FOR UPDATE`);
    if (activeWorkOrders.length > 0) throw new ConflictException("关联养护工单尚未完成验收，不能恢复可用");
    if (!row.assetId) {
      const sourceOrder = await client.rentalOrder.findFirst({ where: { id: row.orderId, tenantId, workspaceId }, select: { orderNo: true } });
      if (!sourceOrder) throw new ConflictException("归还处置关联订单不存在，无法记录维修恢复流水");
      await this.applyStockMaintenanceDelta(client, tenantId, workspaceId, {
        itemGroupId: row.itemGroupId,
        locationId: row.locationId,
        quantity: remaining,
        idempotencyKey: `disposition:${row.id}:maintenance-release`,
        sourceOrderId: row.orderId,
        sourceOrderNo: sourceOrder.orderNo,
        sourceInspectionId: row.inspectionId ?? undefined,
        sourceDispositionId: row.id,
        batchNo: row.returnBatchKey,
        reason: `归还处置 ${row.id} 完成养护，恢复可租数量`,
        operator
      }, -remaining, "maintenance_release");
    }
    const assetBefore = row.assetId ? assets.get(row.assetId) : undefined;
    const restoredAt = new Date();
    let remainingBlocks: Array<{ id: string }> = [];
    if (row.assetId) {
      // Current reads after the asset mutex: an earlier RR snapshot must not
      // hide another hold committed while this restoration waited for the asset.
      const [blocks, independentWork] = await Promise.all([
        client.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_stock_dispositions
          FORCE INDEX (rental_stock_dispositions_asset_status_idx)
          WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND assetId = ${row.assetId}
            AND id <> ${row.id} AND status IN ('buffered', 'blocked') FOR UPDATE`),
        client.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_work_orders
          FORCE INDEX (rental_work_orders_asset_status_idx)
          WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND assetId = ${row.assetId}
            AND status IN ('pending', 'in_progress', 'pending_review') FOR UPDATE`)
      ]);
      if (independentWork.length) throw new ConflictException("该资产仍有独立养护工单，不能结束最后恢复入口");
      remainingBlocks = blocks;
    }
    const updatedCount = await client.rentalStockDisposition.updateMany({
      where: { id: row.id, tenantId, workspaceId, restoredQuantity: { lt: row.quantity }, status: "buffered" },
      data: { status: "restored", restoredQuantity: row.quantity, restoredAt, restoredBy: operator }
    });
    if (updatedCount.count === 0) throw new ConflictException("库存处置已被其他操作恢复，请刷新后重试");
    if (row.assetId && remainingBlocks.length === 0) {
      const latestStatus = (await client.$queryRaw<Array<{ source: string; sourceId: string | null; toStatus: string }>>(Prisma.sql`
        SELECT source, sourceId, toStatus FROM rental_asset_status_history WHERE tenantId = ${tenantId}
          AND workspaceId = ${workspaceId} AND assetId = ${row.assetId}
        ORDER BY createdAt DESC, id DESC LIMIT 1 FOR UPDATE`))[0];
      // The final disposition may belong to a later order. The unchanged
      // maintenance source must still identify an already-restored disposition
      // of this asset; never adopt a manual hold or an unrelated order's history.
      const sourceClosed = latestStatus?.source === "order" && latestStatus.sourceId && latestStatus.sourceId !== row.orderId
        ? (await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM rental_stock_dispositions
          FORCE INDEX (rental_stock_dispositions_asset_status_idx)
          WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND assetId = ${row.assetId}
            AND orderId = ${latestStatus.sourceId} AND status = 'restored' LIMIT 1 FOR UPDATE`)).length > 0
        : latestStatus?.sourceId === row.orderId;
      const ownHold = assetBefore?.status === "MAINTENANCE" && latestStatus?.source === "order"
        && sourceClosed && assetStateFromSql(latestStatus.toStatus) === "MAINTENANCE";
      const updatedAsset = ownHold ? await client.rentalAsset.updateMany({
        where: { id: row.assetId, tenantId, workspaceId, status: "MAINTENANCE" }, data: { status: "AVAILABLE" }
      }) : { count: 0 };
      if (updatedAsset.count === 1 && assetBefore && assetBefore.status !== "AVAILABLE") {
        await appendAssetStatusHistory(client, {
          tenantId,
          workspaceId,
          assetId: row.assetId,
          assetNo: assetBefore.assetNo,
          fromStatus: assetBefore.status,
          toStatus: RentalAssetStatus.Available,
          source: "disposition",
          sourceId: row.id,
          reason: "归还处置与养护工单已完成，恢复可用",
          operator
        });
      }
    }
    // 返回锁内当前事实及本次提交值，不再次普通读到恢复前的RR快照。
    return toStockDisposition({ ...row, status: "restored", restoredQuantity: row.quantity, restoredAt, restoredBy: operator, updatedAt: restoredAt });
  }

  async listWorkOrders(tenantId: string, status?: RentalWorkOrderStatus, tx?: RentalFactTx): Promise<RentalWorkOrder[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalWorkOrder.findMany({
      where: { tenantId, workspaceId, ...(status ? { status } : {}), ...this.workOrderVisibilityWhere() },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toWorkOrder);
  }

  private workOrderVisibilityWhere(): Prisma.RentalWorkOrderWhereInput {
    const userId = getRequestUserId();
    return { ...this.staffLocationWhere(),
      ...(getRequestDataScope() === "own" ? { OR: userId ? [{ createdBy: userId }, { assigneeId: userId }] : [{ id: "__no_current_user__" }] } : {}) };
  }

  private staffLocationWhere() {
    const ids = getRequestLocationIds();
    return ids === undefined ? {} : { locationId: { in: ids.length ? ids : ["__no_authorized_location__"] } };
  }

  private stockDispositionVisibilityWhere(): Prisma.RentalStockDispositionWhereInput {
    const clauses: Prisma.RentalStockDispositionWhereInput[] = [];
    const locationIds = getRequestLocationIds();
    if (locationIds !== undefined) {
      clauses.push({ locationId: { in: locationIds.length ? locationIds : ["__no_authorized_location__"] } });
    }
    if (getRequestDataScope() === "own") {
      const userId = getRequestUserId();
      clauses.push({ order: { is: { OR: userId ? [
        { createdBy: userId },
        { workOrders: { some: { OR: [{ createdBy: userId }, { assigneeId: userId }] } } }
      ] : [{ id: "__no_current_user__" }] } } });
    }
    return clauses.length ? { AND: clauses } : {};
  }

  async listWorkOrderAssignees(tenantId: string, locationId?: string, tx?: RentalFactTx): Promise<RentalWorkOrderAssignee[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const ownScope = getRequestDataScope() === "own";
    const userId = getRequestUserId();
    const rows = await client.workspaceMember.findMany({
      where: {
        tenantId,
        workspaceId,
        isActive: true,
        user: { isActive: true, isSaasAdmin: false, ...(ownScope ? { id: userId ?? "__no_current_user__" } : {}) }
      },
      include: {
        role: { select: { isActive: true, fixedAllPermissions: true, dataScope: true } },
        user: { select: {
          id: true,
          account: true,
          displayName: true,
          organizationId: true,
          isPlatformAdmin: true,
          role: { select: { isActive: true, fixedAllPermissions: true, dataScope: true } },
          roleAssignments: { select: { role: { select: { isActive: true, fixedAllPermissions: true, dataScope: true } } } }
        } }
      },
      orderBy: { createdAt: "asc" }
    });
    const scopedRows = rows.flatMap((row) => {
      const dataScope = resolveWorkspaceMemberDataScope({
        isPlatformAdmin: row.user.isPlatformAdmin,
        memberDataScope: row.dataScope,
        memberRoleId: row.roleId,
        memberRole: row.role,
        userRole: row.user.role,
        userRoleAssignments: row.user.roleAssignments.map((assignment) => assignment.role)
      });
      return dataScope ? [{ row, dataScope }] : [];
    });

    const organizationIds = new Set<string>();
    let organizations: Array<{ id: string; parentId: string | null; status: string }> = [];
    if (scopedRows.some((item) => item.dataScope === "organization")) {
      organizations = await client.organizationUnit.findMany({
        where: { tenantId },
        select: { id: true, parentId: true, status: true }
      });
      for (const { row, dataScope } of scopedRows) {
        if (dataScope !== "organization" || !row.user.organizationId) continue;
        for (const id of enabledOrganizationSubtreeIds(organizations, row.user.organizationId)) organizationIds.add(id);
      }
    }
    const locationsByOrganization = new Map<string, string[]>();
    if (organizationIds.size) {
      const locations = await client.rentalFulfillmentLocation.findMany({
        where: { tenantId, workspaceId, organizationId: { in: [...organizationIds] } },
        select: { id: true, organizationId: true }
      });
      for (const location of locations) {
        if (!location.organizationId) continue;
        const ids = locationsByOrganization.get(location.organizationId) ?? [];
        ids.push(location.id);
        locationsByOrganization.set(location.organizationId, ids);
      }
    }

    if (locationId) {
      const location = await client.rentalFulfillmentLocation.findFirst({
        where: { tenantId, workspaceId, id: locationId },
        select: { id: true }
      });
      if (!location) return [];
    }
    const callerLocationIds = getRequestLocationIds();
    return scopedRows.flatMap(({ row, dataScope }) => {
      const organizationLocationIds = dataScope === "organization" && row.user.organizationId
        ? enabledOrganizationSubtreeIds(
            organizations,
            row.user.organizationId
          ).flatMap((id) => locationsByOrganization.get(id) ?? [])
        : [];
      const locationIds = resolveAssigneeLocationIds(
        dataScope,
        row.locationScope,
        organizationLocationIds
      );
      const eligible = locationId
        ? assigneeCanAccessLocation(locationIds, locationId)
        : callerLocationIds === undefined
          ? locationIds === undefined || locationIds.length > 0
          : assigneeScopesOverlap(locationIds, callerLocationIds);
      return eligible ? [{ id: row.user.id, account: row.user.account, displayName: row.user.displayName }] : [];
    });
  }

  async listWorkOrderHistory(tenantId: string, workOrderId: string, tx?: RentalFactTx): Promise<RentalWorkOrderHistoryEntry[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.operationLog.findMany({
      where: { tenantId, workspaceId, action: { startsWith: "rental.work_order." } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return rows
      .filter((row) => String((row.detail as { workOrderId?: unknown })?.workOrderId ?? "") === workOrderId)
      .map((row) => {
        const detail = row.detail as { operator?: unknown; reason?: unknown };
        return {
          id: row.id,
          action: row.action,
          operator: String(detail.operator ?? "系统"),
          detail: String(detail.reason ?? ""),
          createdAt: iso(row.createdAt)
        };
      });
  }

  async upsertWorkOrder(workOrder: RentalWorkOrder, tx?: RentalFactTx): Promise<RentalWorkOrder> {
    if (!tx) return this.prisma.$transaction(client => this.upsertWorkOrder(workOrder, client));
    const client = tx;
    if (workOrder.orderId) await this.lockOrder(workOrder.tenantId, workOrder.orderId, client);
    const workspaceId = await resolveScopeWorkspaceId(client, workOrder.tenantId);
    const assets = await this.lockAssetRows(client, workOrder.tenantId, workspaceId, workOrder.assetId ? [workOrder.assetId] : []);
    if (workOrder.dispositionId) {
      const disposition = (await client.$queryRaw<Array<{ orderId: string; assetId: string | null; itemGroupId: string; locationId: string; status: string }>>(Prisma.sql`
        SELECT orderId, assetId, itemGroupId, locationId, status FROM rental_stock_dispositions
        WHERE id = ${workOrder.dispositionId} AND tenantId = ${workOrder.tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`))[0];
      if (!disposition || disposition.orderId !== workOrder.orderId || (disposition.assetId ?? undefined) !== workOrder.assetId
        || disposition.itemGroupId !== workOrder.itemGroupId || disposition.locationId !== workOrder.locationId) {
        throw new ConflictException("养护工单来源与原库存处置不一致");
      }
      if (!["blocked", "buffered"].includes(disposition.status)) throw new ConflictException("已结束的库存处置不能再建养护工单");
    }
    const existing = workOrder.dispositionId
      ? (await client.$queryRaw<Prisma.RentalWorkOrderGetPayload<{}>[]>(Prisma.sql`
          SELECT * FROM rental_work_orders WHERE workspaceId = ${workspaceId}
            AND dispositionId = ${workOrder.dispositionId} AND type = ${workOrder.type} FOR UPDATE`))[0]
      : undefined;
    if (existing && (existing.tenantId !== workOrder.tenantId || existing.orderId !== (workOrder.orderId ?? null)
      || existing.assetId !== (workOrder.assetId ?? null))) throw new ConflictException("养护工单幂等来源与原记录不一致");
    if (existing) return toWorkOrder(existing);
    const row = await client.rentalWorkOrder.create({
      data: {
        id: workOrder.id,
        tenantId: workOrder.tenantId,
        workspaceId,
        workNo: workOrder.workNo,
        type: workOrder.type,
        status: workOrder.status,
        dispositionId: workOrder.dispositionId ?? null,
        orderId: workOrder.orderId ?? null,
        inspectionId: workOrder.inspectionId ?? null,
        itemGroupId: workOrder.itemGroupId,
        locationId: workOrder.locationId,
        assetId: workOrder.assetId ?? null,
        quantity: workOrder.quantity,
        assigneeId: workOrder.assigneeId ?? null,
        assigneeName: workOrder.assigneeName ?? null,
        reason: workOrder.reason,
        result: workOrder.result ?? null,
        attachments: workOrder.attachments as unknown as Prisma.InputJsonValue,
        startedAt: workOrder.startedAt ? new Date(workOrder.startedAt) : null,
        submittedAt: workOrder.submittedAt ? new Date(workOrder.submittedAt) : null,
        reviewedAt: workOrder.reviewedAt ? new Date(workOrder.reviewedAt) : null,
        reviewedBy: workOrder.reviewedBy ?? null,
        reviewReason: workOrder.reviewReason ?? null,
        createdBy: workOrder.createdBy,
        createdAt: new Date(workOrder.createdAt),
        updatedAt: new Date(workOrder.updatedAt)
      }
    });
    const asset = workOrder.assetId ? assets.get(workOrder.assetId) : undefined;
    if (asset && !["DISABLED", "MAINTENANCE", "INSPECTION"].includes(asset.status)
      && ["pending", "in_progress", "pending_review"].includes(workOrder.status)) {
      const updated = await client.rentalAsset.updateMany({ where: { id: asset.id, tenantId: workOrder.tenantId,
        workspaceId, status: asset.status }, data: { status: "MAINTENANCE" } });
      if (updated.count !== 1) throw new ConflictException("养护资产状态已变化，不能提交失去可租限制的工单");
      await appendAssetStatusHistory(client, { tenantId: workOrder.tenantId, workspaceId, assetId: asset.id,
        assetNo: asset.assetNo, fromStatus: asset.status, toStatus: RentalAssetStatus.Maintenance,
        source: workOrder.orderId ? "order" : "manual", sourceId: workOrder.orderId,
        reason: workOrder.reason, operator: workOrder.createdBy });
    }
    return toWorkOrder(row);
  }

  async assignWorkOrder(tenantId: string, workOrderId: string, assigneeId?: string, assigneeName?: string, tx?: RentalFactTx): Promise<RentalWorkOrder> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalWorkOrder.findFirst({ where: { id: workOrderId, tenantId, workspaceId } });
    if (!row) throw new NotFoundException("养护工单不存在或不属于当前经营空间");
    const updated = await client.rentalWorkOrder.updateMany({
      where: { id: row.id, tenantId, workspaceId },
      data: { assigneeId: assigneeId ?? null, assigneeName: assigneeName?.trim() || null }
    });
    if (updated.count !== 1) throw new ConflictException("养护工单已被其他人修改，请刷新后重试");
    const refreshed = await client.rentalWorkOrder.findFirst({ where: { id: row.id, tenantId, workspaceId } });
    if (!refreshed) throw new NotFoundException("养护工单更新后无法读取");
    return toWorkOrder(refreshed);
  }

  async transitionWorkOrder(
    tenantId: string,
    workOrderId: string,
    action: "start" | "submit" | "review" | "cancel",
    operator: string,
    input: { result?: string; attachments?: string[]; decision?: "approved" | "rejected"; reason?: string } = {},
    tx?: RentalFactTx
  ): Promise<RentalWorkOrder> {
    const run = async (client: RentalFactTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
      const visible = await client.rentalWorkOrder.findFirst({ where: { id: workOrderId, tenantId, workspaceId } });
      if (!visible) throw new NotFoundException("养护工单不存在或不属于当前经营空间");
      if (visible.orderId) await this.lockOrder(tenantId, visible.orderId, client);
      await this.lockAssetRows(client, tenantId, workspaceId, visible.assetId ? [visible.assetId] : []);
      if (visible.dispositionId) {
        const disposition = (await client.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
          SELECT id, status FROM rental_stock_dispositions
          WHERE id = ${visible.dispositionId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`))[0];
        if (!disposition || !["blocked", "buffered"].includes(disposition.status)) {
          throw new ConflictException("原库存处置已结束或不可处理，不能继续推进工单");
        }
      }
      const row = (await client.$queryRaw<Prisma.RentalWorkOrderGetPayload<{}>[]>(Prisma.sql`
        SELECT * FROM rental_work_orders
        WHERE id = ${workOrderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`))[0];
      if (!row || row.orderId !== visible.orderId || row.dispositionId !== visible.dispositionId || row.assetId !== visible.assetId) {
        throw new ConflictException("养护工单来源已变化，请重新读取后处理");
      }
      const now = new Date();
      let from = row.status;
      let to: string;
      const data: Record<string, unknown> = {};
      if (action === "start") {
        if (row.status !== "pending") throw new ConflictException("只有待处理工单可以开始");
        to = "in_progress";
        data.startedAt = now;
      } else if (action === "submit") {
        if (row.status !== "in_progress") throw new ConflictException("只有处理中工单可以提交验收");
        if (!input.result?.trim()) throw new ConflictException("提交验收必须填写处理结果");
        to = "pending_review";
        data.result = input.result.trim();
        data.attachments = (input.attachments ?? []) as unknown as Prisma.InputJsonValue;
        data.submittedAt = now;
      } else if (action === "review") {
        if (row.status !== "pending_review") throw new ConflictException("只有待验收工单可以审核");
        if (!input.decision || !input.reason?.trim()) throw new ConflictException("工单审核必须提供结论和原因");
        to = input.decision === "approved" ? "completed" : "in_progress";
        data.reviewedAt = now;
        data.reviewedBy = operator;
        data.reviewReason = input.reason.trim();
        if (input.decision === "approved" && row.dispositionId) {
          await client.rentalStockDisposition.updateMany({
            where: { id: row.dispositionId, tenantId, workspaceId, status: "blocked" },
            data: { status: "buffered", blockReason: null }
          });
        } else if (input.decision === "rejected" && row.dispositionId) {
          await client.rentalStockDisposition.updateMany({
            where: { id: row.dispositionId, tenantId, workspaceId },
            data: { status: "blocked", blockReason: input.reason.trim() }
          });
        }
      } else {
        if (!["pending", "in_progress", "pending_review"].includes(row.status)) throw new ConflictException("当前工单状态不能取消");
        if (!input.reason?.trim()) throw new ConflictException("取消工单必须填写原因");
        to = "cancelled";
        data.reviewedAt = now;
        data.reviewedBy = operator;
        data.reviewReason = input.reason.trim();
        if (row.dispositionId) {
          await client.rentalStockDisposition.updateMany({
            where: { id: row.dispositionId, tenantId, workspaceId },
            data: { status: "blocked", blockReason: `工单已取消：${input.reason.trim()}` }
          });
        }
      }
      const updatedCount = await client.rentalWorkOrder.updateMany({ where: { id: row.id, tenantId, workspaceId, status: from }, data: { ...data, status: to } });
      if (updatedCount.count === 0) throw new ConflictException("工单已被其他人推进，请刷新后重试");
      await client.operationLog.create({
        data: {
          tenantId,
          workspaceId,
          action: `rental.work_order.${action}`,
          detail: { workOrderId: row.id, workNo: row.workNo, from, to, operator, reason: input.reason ?? input.result ?? null } as Prisma.InputJsonValue
        }
      });
      return toWorkOrder({ ...row, ...data, status: to, updatedAt: now });
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /* ---------- 检查记录 ---------- */
  private toInspectionRecord(row: any): RentalInspectionRecord {
    const results = structuredClone((row.results ?? {}) as Record<string, unknown>);
    const meta = results.__r1InspectionMeta as
      | Pick<RentalInspectionRecord, "exchangeId" | "baselineInspectionId" | "comparisons" | "usageReadings" | "usageCorrections" | "returnedItems">
      | undefined;
    delete results.__r1InspectionMeta;
    return {
      id: row.id,
      tenantId: row.tenantId,
      orderId: row.orderId,
      stage: row.stage as "pickup" | "return",
      templateId: row.templateId,
      templateCode: row.templateCode,
      templateVersion: row.templateVersion,
      exchangeId: meta?.exchangeId,
      results,
      baselineInspectionId: meta?.baselineInspectionId,
      comparisons: meta?.comparisons,
      usageReadings: meta?.usageReadings,
      usageCorrections: meta?.usageCorrections,
      returnedItems: meta?.returnedItems,
      exceptions: (row.exceptions ?? []) as RentalInspectionRecord["exceptions"],
      attachments: (row.attachments ?? []) as string[],
      operator: row.operator,
      createdAt: iso(row.createdAt)
    };
  }

  async listInspections(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalInspectionRecord[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalInspectionRecord.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toInspectionRecord(row));
  }

  async listInspectionsPage(tenantId: string, orderId: string, value: RentalInspectionPageQuery, tx?: RentalFactTx): Promise<RentalInspectionPage> {
    const query = parseRentalInspectionPageQuery(value), client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const where = { tenantId, workspaceId, orderId };
    if (query.cursor) {
      const cursor = await client.rentalInspectionRecord.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
      if (!cursor || cursor.id !== query.cursor) throw new BadRequestException('检查记录分页游标不属于当前订单');
    }
    const rows = await client.rentalInspectionRecord.findMany({ where: { ...where,
      ...(query.cursor ? { id: { gt: query.cursor } } : {}) }, orderBy: { id: 'asc' }, take: query.limit + 1 });
    if (rows.length > query.limit + 1 || rows.some(row => row.tenantId !== tenantId
      || row.workspaceId !== workspaceId || row.orderId !== orderId)
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException('检查记录分页来源不一致');
    const items = rows.slice(0, query.limit).map(row => this.toInspectionRecord(row));
    return { items, nextCursor: rows.length > query.limit ? items[items.length - 1].id : null, coverage: 'page_not_total' };
  }

  async insertInspection(record: RentalInspectionRecord, tx?: RentalFactTx): Promise<void> {
    if (!tx) return this.prisma.$transaction(client => this.insertInspection(record, client));
    const workspaceId = await resolveScopeWorkspaceId(tx, record.tenantId);
    await (tx ?? this.prisma).rentalInspectionRecord.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        workspaceId,
        orderId: record.orderId,
        stage: record.stage,
        templateId: record.templateId,
        templateCode: record.templateCode,
        templateVersion: record.templateVersion,
        results: {
          ...record.results,
          __r1InspectionMeta: {
            exchangeId: record.exchangeId,
            baselineInspectionId: record.baselineInspectionId,
            comparisons: record.comparisons ?? [],
            usageReadings: record.usageReadings ?? [],
            usageCorrections: record.usageCorrections ?? [],
            returnedItems: record.returnedItems ?? []
          }
        } as Prisma.InputJsonValue,
        exceptions: record.exceptions as unknown as Prisma.InputJsonValue,
        attachments: record.attachments as unknown as Prisma.InputJsonValue,
        operator: record.operator,
        createdAt: new Date(record.createdAt)
      }
    });
    await this.failureEvents?.inspection?.(tx, { tenantId: record.tenantId, workspaceId }, record.id);
  }

  async correctInspectionUsage(
    tenantId: string,
    orderId: string,
    inspectionId: string,
    input: CorrectRentalInspectionUsageRequest,
    operator: string,
    tx?: RentalFactTx
  ): Promise<RentalInspectionRecord> {
    if (!tx) return this.prisma.$transaction(client => this.correctInspectionUsage(tenantId, orderId, inspectionId, input, operator, client));
    const client = tx;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId } });
    if (!row) throw new NotFoundException("检查记录不存在或不属于当前订单");
    const results = structuredClone((row.results ?? {}) as Record<string, unknown>);
    const meta = (results.__r1InspectionMeta ?? {}) as {
      baselineInspectionId?: string;
      comparisons?: RentalInspectionRecord["comparisons"];
      usageReadings?: RentalInspectionRecord["usageReadings"];
      usageCorrections?: RentalInspectionRecord["usageCorrections"];
      returnedItems?: RentalInspectionRecord["returnedItems"];
    };
    const usageReadings = [...(meta.usageReadings ?? [])];
    const index = usageReadings.findIndex((reading) => reading.fieldCode === input.fieldCode);
    if (index < 0) throw new NotFoundException("检查记录中没有这个使用量读数");
    if (!Number.isFinite(input.correctedCurrent) || input.correctedCurrent < 0) throw new BadRequestException("修正后的读数必须是非负数字");
    if (!input.reason.trim()) throw new BadRequestException("使用量修正必须填写原因");
    const previous = usageReadings[index];
    if (previous.current === input.correctedCurrent) throw new ConflictException("修正后的读数与当前有效读数相同");
    const correctedDelta = usageDelta(input.correctedCurrent, previous.baseline);
    if (row.stage === "pickup") {
      const returns = await client.rentalInspectionRecord.findMany({ where: { tenantId, workspaceId, orderId, stage: "return" } });
      const hasDependent = returns.some((record) => {
        const stored = record.results as Record<string, unknown> | null;
        const dependency = stored?.__r1InspectionMeta as { baselineInspectionId?: string } | undefined;
        return dependency?.baselineInspectionId === inspectionId;
      });
      if (hasDependent) throw new ConflictException("该领取基线已有归还记录引用，不能单独修正；须同步复核关联读数与费用");
    }
    usageReadings[index] = {
      ...previous,
      current: input.correctedCurrent,
      delta: correctedDelta
    };
    const correction = {
      id: randomUUID(),
      fieldCode: input.fieldCode,
      from: previous.current,
      to: input.correctedCurrent,
      reason: input.reason.trim(),
      evidenceAttachments: input.evidenceAttachments ?? [],
      operator,
      correctedAt: new Date().toISOString()
    };
    results.__r1InspectionMeta = {
      ...meta,
      usageReadings,
      usageCorrections: [...(meta.usageCorrections ?? []), correction]
    };
    const updated = await client.rentalInspectionRecord.update({
      where: { id: inspectionId, tenantId, workspaceId, orderId, revision: row.revision },
      data: { results: results as Prisma.InputJsonValue, revision: { increment: 1 } }
    });
    await this.failureEvents?.inspection?.(client, { tenantId, workspaceId }, inspectionId);
    return this.toInspectionRecord(updated);
  }

  /* ---------- 续租记录（需求 4.6.9） ---------- */

  async listExtensions(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrderExtension[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalOrderExtension.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { sequence: "asc" }
    });
    return rows.map((row) => this.toDomainExtension(row));
  }

  async insertExtension(extension: RentalOrderExtension, tx?: RentalFactTx): Promise<void> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, extension.tenantId);
    await client.rentalOrderExtension.create({
      data: {
        id: extension.id,
        tenantId: extension.tenantId,
        workspaceId,
        orderId: extension.orderId,
        sequence: extension.sequence,
        status: extension.status,
        originalEndAt: new Date(extension.originalEndAt),
        newEndAt: new Date(extension.newEndAt),
        billableUnits: new Prisma.Decimal(extension.billableUnits),
        rentalAmount: new Prisma.Decimal(extension.rentalAmount),
        serviceAmount: new Prisma.Decimal(extension.serviceAmount),
        depositDelta: new Prisma.Decimal(extension.depositDelta),
        preAuthDelta: new Prisma.Decimal(extension.preAuthDelta),
        payableAmount: new Prisma.Decimal(extension.payableAmount),
        currency: extension.currency,
        priceVersionId: extension.priceVersionId ?? null,
        priceVersion: extension.priceVersion ?? null,
        ruleVersion: extension.ruleVersion,
        executionBasis: extension.executionBasis ? extension.executionBasis as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        rateSnapshot: extension.rateSnapshot as unknown as Prisma.InputJsonValue,
        ruleSnapshot: extension.ruleSnapshot as unknown as Prisma.InputJsonValue,
        calendarSnapshot: extension.calendarSnapshot as unknown as Prisma.InputJsonValue,
        serviceSnapshots: extension.serviceSnapshots?.length ? extension.serviceSnapshots as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        pricingSnapshot: extension.pricingSnapshot ? extension.pricingSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        settlementMode: extension.settlementMode,
        idempotencyKey: extension.idempotencyKey,
        memo: extension.memo ?? null,
        paidAt: extension.paidAt ? new Date(extension.paidAt) : null,
        effectiveAt: extension.effectiveAt ? new Date(extension.effectiveAt) : null,
        createdBy: extension.createdBy,
        createdAt: new Date(extension.createdAt)
      }
    });
  }

  /* ---------- 订单变更（ORDER-CHANGE-01A） ---------- */

  async listOrderChanges(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrderChange[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalOrderChange.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { sequence: "asc" }
    });
    return rows.map((row) => this.toDomainOrderChange(row));
  }

  async insertOrderChange(change: RentalOrderChange, tx?: RentalFactTx): Promise<void> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, change.tenantId);
    if (change.workspaceId !== workspaceId) {
      throw new ConflictException("订单变更不属于当前经营空间，拒绝写入");
    }
    await client.rentalOrderChange.create({
      data: {
        id: change.id,
        tenantId: change.tenantId,
        workspaceId,
        orderId: change.orderId,
        sequence: change.sequence,
        type: change.type,
        status: change.status,
        request: change.request as unknown as Prisma.InputJsonValue,
        beforeSnapshot: change.beforeSnapshot as unknown as Prisma.InputJsonValue,
        afterSnapshot: change.afterSnapshot as unknown as Prisma.InputJsonValue,
        diff: change.diff as unknown as Prisma.InputJsonValue,
        refundAmount: new Prisma.Decimal(change.refundAmount),
        additionalAmount: new Prisma.Decimal(change.additionalAmount),
        depositDelta: new Prisma.Decimal(change.depositDelta),
        preAuthDelta: new Prisma.Decimal(change.preAuthDelta),
        idempotencyKey: change.idempotencyKey,
        requestedBy: change.requestedBy,
        appliedBy: change.appliedBy ?? null,
        requestedAt: new Date(change.requestedAt),
        appliedAt: change.appliedAt ? new Date(change.appliedAt) : null,
        createdAt: new Date(change.createdAt)
      }
    });
  }

  /**
   * 只推进状态与两个时间戳，金额一律不动——金额是申请时固化的事实，
   * 生效时再改一次就等于事后改账。
   */
  async markExtensionEffective(
    tenantId: string,
    extensionId: string,
    at: string,
    paidAt: string | undefined,
    tx?: RentalFactTx
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const updated = await client.rentalOrderExtension.updateMany({
      where: { id: extensionId, tenantId, workspaceId },
      data: {
        status: "effective",
        effectiveAt: new Date(at),
        ...(paidAt ? { paidAt: new Date(paidAt) } : {})
      }
    });
    if (updated.count !== 1) throw new NotFoundException("续租记录不存在或不属于当前经营空间");
  }

  /**
   * 把一批待补款的续租作废。
   *
   * 存在的理由：`pending_payment` 没有任何自然终态，不作废就会永远停在"可补款"上——
   * 客户改了主意重新申请之后，旧那条仍然挂在订单上，界面也仍然给出补款按钮。
   * 只推状态，金额与时间戳不动：作废的是意向，不是已经固化的报价事实。
   * 作废时刻由 `updatedAt` 记录，不再单开一列——`status` 已经说明了发生过什么。
   */
  async cancelExtensions(tenantId: string, extensionIds: string[], tx?: RentalFactTx): Promise<void> {
    if (!extensionIds.length) return;
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    await client.rentalOrderExtension.updateMany({
      where: { id: { in: extensionIds }, tenantId, workspaceId, status: "pending_payment" },
      data: { status: "cancelled" }
    });
  }

  private toDomainExtension(row: Prisma.RentalOrderExtensionGetPayload<object>): RentalOrderExtension {
    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      orderId: row.orderId,
      sequence: row.sequence,
      status: row.status as RentalOrderExtension["status"],
      originalEndAt: iso(row.originalEndAt),
      newEndAt: iso(row.newEndAt),
      billableUnits: num(row.billableUnits),
      rentalAmount: num(row.rentalAmount),
      serviceAmount: num(row.serviceAmount),
      depositDelta: num(row.depositDelta),
      preAuthDelta: num(row.preAuthDelta),
      payableAmount: num(row.payableAmount),
      currency: row.currency,
      priceVersionId: row.priceVersionId ?? undefined,
      priceVersion: row.priceVersion ?? undefined,
      ruleVersion: row.ruleVersion,
      rateSnapshot: row.rateSnapshot as unknown as RentalOrderExtension["rateSnapshot"],
      executionBasis: row.executionBasis ? row.executionBasis as unknown as RentalOrderExtension["executionBasis"] : undefined,
      ruleSnapshot: row.ruleSnapshot as unknown as RentalOrderExtension["ruleSnapshot"],
      calendarSnapshot: row.calendarSnapshot as unknown as RentalOrderExtension["calendarSnapshot"],
      serviceSnapshots: row.serviceSnapshots ? row.serviceSnapshots as unknown as RentalOrderExtension["serviceSnapshots"] : undefined,
      pricingSnapshot: row.pricingSnapshot ? row.pricingSnapshot as unknown as RentalOrderExtension["pricingSnapshot"] : undefined,
      settlementMode: row.settlementMode as RentalOrderExtension["settlementMode"],
      memo: row.memo ?? undefined,
      paidAt: optionalIso(row.paidAt),
      effectiveAt: optionalIso(row.effectiveAt),
      idempotencyKey: row.idempotencyKey,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt)
    };
  }

  async updateExtensionPricingSnapshot(tenantId: string, orderId: string, extensionId: string, snapshot: NonNullable<RentalOrderExtension["pricingSnapshot"]>, tx: RentalFactTx) {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.rentalOrderExtension.updateMany({ where: { id: extensionId, orderId, tenantId, workspaceId }, data: {
      pricingSnapshot: snapshot as unknown as Prisma.InputJsonValue
    } });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toDomainOrder(row: Prisma.RentalOrderGetPayload<{
    include: { lines: true; reservations: true; allocations: true };
  }>): RentalOrder {
    const lines: RentalOrderLine[] = row.lines.map((line) => ({
      id: line.id,
      pricingGroupId: line.pricingGroupId ?? undefined,
      pricingGroupCode: line.pricingGroupCode ?? undefined,
      pricingGroupName: line.pricingGroupName ?? undefined,
      reservationPrecision: line.reservationPrecision === "exact_model" ? "exact_model" : "group",
      pricingGroupMemberItemGroupIds: (line.pricingGroupMemberItemGroupIds ?? undefined) as string[] | undefined,
      itemGroupId: line.itemGroupId,
      itemGroupCode: line.itemGroupCode,
      itemGroupName: line.itemGroupName,
      inventoryMode: lower<RentalInventoryMode>(line.inventoryMode),
      quantity: line.quantity,
      cancelledQuantity: line.cancelledQuantity || undefined,
      unitPrice: num(line.unitPrice),
      amount: num(line.amount),
      note: line.note ?? undefined
    }));
    const reservations: RentalReservation[] = row.reservations.map((reservation) => ({
      id: reservation.id,
      orderId: reservation.orderId,
      orderLineId: reservation.orderLineId,
      itemGroupId: reservation.itemGroupId,
      locationId: reservation.locationId,
      quantity: reservation.quantity,
      releasedQuantity: reservation.releasedQuantity,
      status: lower<RentalReservationStatus>(reservation.status),
      expiresAt: optionalIso(reservation.expiresAt),
      createdAt: iso(reservation.createdAt)
    }));
    const allocations: RentalAllocation[] = row.allocations.map((allocation) => ({
      id: allocation.id,
      orderId: allocation.orderId,
      orderLineId: allocation.orderLineId,
      itemGroupId: allocation.itemGroupId ?? undefined,
      assetId: allocation.assetId ?? undefined,
      assetNo: allocation.assetNo ?? undefined,
      quantity: allocation.quantity,
      status: allocation.status as RentalAllocation["status"],
      metadata: allocation.metadata ? allocation.metadata as unknown as RentalAllocation["metadata"] : undefined
    }));
    return {
      id: row.id,
      tenantId: row.tenantId,
      orderNo: row.orderNo,
      assignment: row.assignment ? row.assignment as unknown as RentalOrder["assignment"] : undefined,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      categoryVersionId: row.categoryVersionId ?? undefined,
      inspectionTemplateSnapshots: row.inspectionTemplateSnapshots === null ? undefined : row.inspectionTemplateSnapshots as unknown as RentalOrder["inspectionTemplateSnapshots"],
      status: lower<RentalCoreOrderStatus>(row.status),
      customerType: row.customerType as RentalOrder["customerType"],
      customerId: row.customerId ?? undefined,
      customerName: row.customerName,
      contactPhone: row.contactPhone ?? undefined,
      membershipSnapshot: (row.membershipSnapshot ?? undefined) as RentalOrder["membershipSnapshot"],
      membershipBenefitEvaluations: (row.membershipBenefitEvaluations ?? undefined) as RentalOrder["membershipBenefitEvaluations"],
      fulfillmentMode: row.fulfillmentMode as RentalFulfillmentMode,
      fulfillmentLocationId: row.fulfillmentLocationId,
      fulfillmentLocationName: row.fulfillmentLocationName,
      fulfillmentLocationSnapshot: (row.fulfillmentLocationSnapshot ?? {
        id: row.fulfillmentLocationId, code: "", name: row.fulfillmentLocationName, type: "store", capabilities: [],
        operator: { id: "", code: "", name: "", type: "self_operated" }
      }) as unknown as RentalFulfillmentLocationSnapshot,
      returnLocationId: row.returnLocationId ?? undefined,
      returnLocationName: row.returnLocationName ?? undefined,
      returnLocationSnapshot: (row.returnLocationSnapshot ?? row.fulfillmentLocationSnapshot ?? {
        id: row.returnLocationId ?? row.fulfillmentLocationId, code: "", name: row.returnLocationName ?? row.fulfillmentLocationName,
        type: "store", capabilities: [], operator: { id: "", code: "", name: "", type: "self_operated" }
      }) as unknown as RentalFulfillmentLocationSnapshot,
      deliveryAddressSnapshot: (row.deliveryAddressSnapshot ?? undefined) as RentalOrder["deliveryAddressSnapshot"],
      startAt: iso(row.startAt),
      actualRentalStartAt: optionalIso(row.actualRentalStartAt),
      endAt: iso(row.endAt),
      effectiveEndAt: optionalIso(row.effectiveEndAt),
      carrierRentalDueAt: optionalIso(row.carrierRentalDueAt),
      quoteId: row.quoteId,
      quoteNo: row.quoteNo,
      pricingPlanVersion: row.pricingPlanVersion,
      priceVersionId: row.priceVersionId ?? undefined,
      priceVersion: row.priceVersion ?? undefined,
      ruleVersion: row.ruleVersion,
      ruleSnapshot: row.ruleSnapshot as unknown as RentalRuleConfig,
      calendarVersion: row.calendarVersion ?? undefined,
      calendarSnapshot: (row.calendarSnapshot ?? undefined) as unknown as RentalOrder["calendarSnapshot"],
      capabilitySnapshot: (row.capabilitySnapshot ?? undefined) as unknown as RentalOrder["capabilitySnapshot"],
      capabilityDecisions: (row.capabilityDecisions ?? undefined) as unknown as RentalOrder["capabilityDecisions"],
      capabilityExceptions: (row.capabilityExceptions ?? undefined) as unknown as RentalOrder["capabilityExceptions"],
      serviceSnapshots: (row.serviceSnapshots ?? undefined) as unknown as RentalOrder["serviceSnapshots"],
      // CUSTOMER-01C：主体 id 与快照。存量订单为空，读取侧据此回落到 customerId。
      contractSubjectCustomerId: row.contractSubjectCustomerId ?? undefined,
      payerSubjectCustomerId: row.payerSubjectCustomerId ?? undefined,
      userSubjectCustomerId: row.userSubjectCustomerId ?? undefined,
      agentId: row.agentId ?? undefined,
      subjectSnapshot: (row.subjectSnapshot ?? undefined) as unknown as RentalOrder["subjectSnapshot"],
      // Review P1-10：NULL 快照明确解释为 legacy empty，不回退到当前已启用能力。
      capabilityPolicy: row.capabilitySnapshot ? "snapshot" : "legacy_empty",
      chargeLines: (row.chargeLines ?? []) as unknown as RentalQuoteChargeLine[],
      feeReviews: (row.feeReviews ?? undefined) as unknown as RentalOrder["feeReviews"],
      rentalAmount: num(row.rentalAmount),
      discountAmount: num(row.discountAmount),
      couponAmount: num(row.couponAmount),
      serviceAmount: num(row.serviceAmount),
      fulfillmentAmount: num(row.fulfillmentAmount),
      depositAmount: num(row.depositAmount),
      preAuthAmount: num(row.preAuthAmount),
      payableAmount: num(row.payableAmount),
      adjustmentAmount: num(row.adjustmentAmount),
      finalPayableAmount: num(row.finalPayableAmount),
      taxRate: num(row.taxRate),
      taxAmount: num(row.taxAmount),
      currency: row.currency as RentalOrder["currency"],
      totalAmount: num(row.totalAmount),
      cancellationReason: row.cancellationReason ?? undefined,
      cancelledAt: optionalIso(row.cancelledAt),
      pickupOverdueAt: optionalIso(row.pickupOverdueAt),
      noShowNoticeAt: optionalIso(row.noShowNoticeAt),
      noShowAt: optionalIso(row.noShowAt),
      noShowReason: row.noShowReason ?? undefined,
      completedAt: optionalIso(row.completedAt),
      lines,
      reservations,
      allocations,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toDomainOrderChange(row: Prisma.RentalOrderChangeGetPayload<object>): RentalOrderChange {
    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      orderId: row.orderId,
      sequence: row.sequence,
      type: row.type as RentalOrderChange["type"],
      status: row.status as RentalOrderChange["status"],
      request: row.request as unknown as RentalOrderChange["request"],
      beforeSnapshot: row.beforeSnapshot as unknown as Record<string, unknown>,
      afterSnapshot: row.afterSnapshot as unknown as Record<string, unknown>,
      diff: row.diff as unknown as Record<string, unknown>,
      refundAmount: Number(row.refundAmount),
      additionalAmount: Number(row.additionalAmount),
      depositDelta: Number(row.depositDelta),
      preAuthDelta: Number(row.preAuthDelta),
      idempotencyKey: row.idempotencyKey,
      requestedBy: row.requestedBy,
      appliedBy: row.appliedBy ?? undefined,
      requestedAt: row.requestedAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }
}
