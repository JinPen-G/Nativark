import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type $Enums } from "@prisma/client";
import {
  RentalAssetStatus,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  RentalReservationStatus,
  type RentalAllocation,
  type RentalAsset,
  type RentalCategoryCode,
  type RentalFulfillmentLocationSnapshot,
  type RentalFulfillmentMode,
  type RentalInspectionRecord,
  type RentalOrder,
  type RentalOrderExtension,
  type RentalOrderLine,
  type RentalQuoteChargeLine,
  type RentalReservation,
  type RentalRuleConfig,
  type RentalStockBalance
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { bufferedRentalPeriod } from "./rental-occupancy";

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

export interface RentalStockDisposition {
  id: string;
  tenantId: string;
  workspaceId: string;
  orderId: string;
  inspectionId?: string;
  returnBatchKey: string;
  dedupeKey: string;
  itemGroupId: string;
  locationId: string;
  assetId?: string;
  quantity: number;
  receivedAt: string;
  bufferUntil: string;
  status: string;
  blockReason?: string;
  restoredQuantity: number;
  restoredAt?: string;
  restoredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type RentalFactTx = Prisma.TransactionClient;

export interface InventoryLockTarget {
  itemGroupId: string;
  inventoryMode: RentalInventoryMode;
}

export interface RentalUniqueAttributeClaim {
  fieldCode: string;
  label: string;
  normalizedValue: string;
}

/**
 * 服务层只依赖这个接口。与配置仓储同理：不连库的单元测试注入吸收式 stub，
 * 而租户隔离、外键、过期预占过滤这类持久化语义只在 MySQL E2E 里验证。
 */
export interface RentalCoreFactStore {
  listOrders(tenantId: string): Promise<RentalOrder[]>;
  findOrder(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrder | undefined>;
  /**
   * 对订单行加排他锁，供状态推进动作在读取聚合前调用。
   * 不加锁时确认、配货、取消会各读一份聚合副本、各跑状态机、各整体写回，
   * 后提交者把先提交者的状态覆盖掉（丢失更新），两个动作都返回成功。
   */
  lockOrder(tenantId: string, orderId: string, tx: RentalFactTx): Promise<void>;
  countOrders(tenantId: string): Promise<number>;
  saveOrderAggregate(order: RentalOrder, assetChanges?: AssetStatusChange[], tx?: RentalFactTx, stockQuarantines?: StockQuarantineChange[]): Promise<void>;
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
  allocatedAssetIds(tenantId: string, tx?: RentalFactTx): Promise<Set<string>>;
  listAssets(tenantId: string, tx?: RentalFactTx): Promise<RentalAsset[]>;
  upsertAsset(asset: RentalAsset, uniqueAttributes?: RentalUniqueAttributeClaim[]): Promise<void>;
  listStockBalances(tenantId: string, tx?: RentalFactTx): Promise<RentalStockBalance[]>;
  upsertStockBalance(balance: RentalStockBalance): Promise<void>;
  /**
   * 盘点写入。与 `upsertStockBalance`（只用于建样例数据）分开，因为它必须锁行：
   * `maintenanceQuantity` 现在有第二个写者，见 `saveOrderAggregate` 的异常隔离。
   */
  applyStockCount(input: StockCountInput): Promise<{ id: string; onHandQuantity: number; maintenanceQuantity: number }>;
  listStockDispositions(tenantId: string, orderId?: string, tx?: RentalFactTx): Promise<RentalStockDisposition[]>;
  upsertStockDisposition(disposition: RentalStockDisposition, tx?: RentalFactTx): Promise<void>;
  restoreStockDisposition(tenantId: string, dispositionId: string, operator: string, tx?: RentalFactTx): Promise<RentalStockDisposition>;
  listInspections(tenantId: string, orderId: string): Promise<RentalInspectionRecord[]>;
  insertInspection(record: RentalInspectionRecord, tx?: RentalFactTx): Promise<void>;
  /** 续租记录（需求 4.6.9）。只追加与改状态，不改金额——金额是申请时固化的事实。 */
  listExtensions(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrderExtension[]>;
  insertExtension(extension: RentalOrderExtension, tx?: RentalFactTx): Promise<void>;
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
  constructor(private readonly prisma: PrismaService) {}

  /* ---------- 订单聚合 ---------- */

  private orderInclude = {
    lines: { orderBy: { createdAt: "asc" } },
    reservations: { orderBy: { createdAt: "asc" } },
    allocations: { orderBy: { createdAt: "asc" } }
  } as const;

  async listOrders(tenantId: string): Promise<RentalOrder[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalOrder.findMany({
      where: { tenantId, workspaceId },
      include: this.orderInclude,
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toDomainOrder(row));
  }

  async findOrder(tenantId: string, orderId: string, tx?: RentalFactTx): Promise<RentalOrder | undefined> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalOrder.findFirst({
      where: { id: orderId, tenantId, workspaceId },
      include: this.orderInclude
    });
    return row ? this.toDomainOrder(row) : undefined;
  }

  /**
   * 锁只加在订单行上，子表（行、预占、分配）随聚合一起由同一事务写回，
   * 拿到订单锁即可串行同一订单的状态推进，不同订单仍并行。
   */
  async lockOrder(tenantId: string, orderId: string, tx: RentalFactTx): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`rental_orders\`
      WHERE \`tenantId\` = ${tenantId} AND \`id\` = ${orderId}
      FOR UPDATE
    `);
  }

  async countOrders(tenantId: string): Promise<number> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.prisma.rentalOrder.count({ where: { tenantId, workspaceId } });
  }

  /**
   * 写回订单聚合。行与预占按 id upsert，分配整表替换（配货会重算整组分配），
   * 资产状态变更一并进入同一事务。
   */
  async saveOrderAggregate(order: RentalOrder, assetChanges: AssetStatusChange[] = [], tx?: RentalFactTx, stockQuarantines: StockQuarantineChange[] = []): Promise<void> {
    const orderData = {
      tenantId: order.tenantId,
      orderNo: order.orderNo,
      assignment: order.assignment ? order.assignment as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
      categoryCode: upper<$Enums.RentalCategoryCode>(order.categoryCode),
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
      startAt: new Date(order.startAt),
      endAt: new Date(order.endAt),
      // 续租只推进 effectiveEndAt，endAt 保持原始约定（需求 4.6.9）。
      effectiveEndAt: order.effectiveEndAt ? new Date(order.effectiveEndAt) : null,
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
      completedAt: order.completedAt ? new Date(order.completedAt) : null,
      createdBy: order.createdBy
    };

    const write = async (client: RentalFactTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, order.tenantId);
      await client.rentalOrder.upsert({
        where: { id: order.id },
        create: { workspaceId, id: order.id, ...orderData, createdAt: new Date(order.createdAt) },
        update: orderData
      });

      for (const line of order.lines) {
        const lineData = {
          orderId: order.id,
          pricingGroupId: line.pricingGroupId ?? null,
          pricingGroupCode: line.pricingGroupCode ?? null,
          pricingGroupName: line.pricingGroupName ?? null,
          pricingGroupMemberItemGroupIds: (line.pricingGroupMemberItemGroupIds ?? null) as Prisma.InputJsonValue,
          itemGroupId: line.itemGroupId,
          itemGroupCode: line.itemGroupCode,
          itemGroupName: line.itemGroupName,
          inventoryMode: upper<$Enums.RentalInventoryMode>(line.inventoryMode),
          quantity: line.quantity,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          amount: new Prisma.Decimal(line.amount),
          note: line.note ?? null
        };
        await client.rentalOrderLine.upsert({
          where: { id: line.id },
          create: { id: line.id, ...lineData },
          update: lineData
        });
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
          startAt: new Date(order.startAt),
          endAt: new Date(order.effectiveEndAt ?? order.endAt),
          status: upper<$Enums.RentalReservationState>(reservation.status),
          expiresAt: reservation.expiresAt ? new Date(reservation.expiresAt) : null
        };
        const workspaceId = await resolveScopeWorkspaceId(client, order.tenantId);
        await client.rentalReservation.upsert({
          where: { id: reservation.id },
          create: { workspaceId, id: reservation.id, ...reservationData, createdAt: new Date(reservation.createdAt) },
          update: reservationData
        });
      }

      // 配货会重算整组分配，整表替换比逐条对齐更不容易留下孤立行。
      await client.rentalAllocation.deleteMany({ where: { orderId: order.id } });
      for (const allocation of order.allocations) {
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
        await client.rentalAsset.updateMany({
          where: { id: change.assetId, tenantId: order.tenantId },
          data: { status: upper<$Enums.RentalAssetState>(change.status) }
        });
      }

      // 数量库存的异常隔离：加进维修量，使它不再回到可用池。
      // 与资产状态变更同一事务——分两次写会留下「订单已归还、坏货已可租」的中间态。
      for (const quarantine of stockQuarantines) {
        if (quarantine.quantity <= 0) continue;
        const isolated = await client.rentalStockBalance.updateMany({
          where: {
            tenantId: order.tenantId,
            workspaceId,
            itemGroupId: quarantine.itemGroupId,
            locationId: quarantine.locationId
          },
          data: { maintenanceQuantity: { increment: quarantine.quantity } }
        });
        // 匹配不到余额行时 updateMany 只会返回 count: 0 而不报错，隔离就被静默丢弃了。
        // 维修量是这条路径上唯一阻止坏货回到可用池的手段，宁可让整单归还失败。
        if (isolated.count === 0) {
          throw new ConflictException(
            `商品 ${quarantine.itemGroupId} 在网点 ${quarantine.locationId} 没有库存台账，无法隔离异常归还的数量`
          );
        }
      }
    };

    if (tx) {
      await write(tx);
      return;
    }
    await this.prisma.$transaction(write);
  }

  /* ---------- 可用量与分配 ---------- */

  /**
   * 对本次下单实际依赖的基础库存行加排他锁。调用方必须先展开套装并按稳定顺序传入：
   * 序列化库存锁定地点下的资产行，数量库存锁定唯一余额行。拿到锁后再查预占，
   * 可确保同一资源的并发下单串行重算，而不同地点仍可并行。
   */
  async lockInventoryTargets(tenantId: string, locationId: string, targets: InventoryLockTarget[], tx: RentalFactTx): Promise<void> {
    const ordered = [...targets].sort((left, right) =>
      `${left.itemGroupId}:${left.inventoryMode}`.localeCompare(`${right.itemGroupId}:${right.inventoryMode}`)
    );
    for (const target of ordered) {
      if (target.inventoryMode === RentalInventoryMode.Serialized) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\` FROM \`rental_assets\`
          WHERE \`tenantId\` = ${tenantId}
            AND \`itemGroupId\` = ${target.itemGroupId}
            AND \`locationId\` = ${locationId}
          ORDER BY \`id\` FOR UPDATE
        `);
      } else if (target.inventoryMode === RentalInventoryMode.Quantity) {
        await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\` FROM \`rental_stock_balances\`
          WHERE \`tenantId\` = ${tenantId}
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
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`rental_assets\`
      WHERE \`tenantId\` = ${tenantId}
        AND \`itemGroupId\` = ${itemGroupId}
        AND \`locationId\` = ${locationId}
      ORDER BY \`id\` FOR UPDATE
    `);
  }

  async allocatedAssetIds(tenantId: string, tx?: RentalFactTx): Promise<Set<string>> {
    const client = tx ?? this.prisma;
    // 分配表没有 workspaceId（它是订单子表），通过父订单的空间条件过滤。
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalAllocation.findMany({
      where: {
        status: { in: IN_USE_ALLOCATION_STATES },
        assetId: { not: null },
        order: { tenantId, workspaceId }
      },
      select: { assetId: true }
    });
    return new Set(rows.map((row) => row.assetId).filter((value): value is string => Boolean(value)));
  }

  /* ---------- 资产 ---------- */

  async listAssets(tenantId: string, tx?: RentalFactTx): Promise<RentalAsset[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalAsset.findMany({
      where: { tenantId, workspaceId },
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

  async findAssetByNo(tenantId: string, assetNo: string): Promise<{ id: string } | null> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.prisma.rentalAsset.findFirst({ where: { tenantId, workspaceId, assetNo }, select: { id: true } });
  }

  async upsertAsset(asset: RentalAsset, uniqueAttributes: RentalUniqueAttributeClaim[] = []): Promise<void> {
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
        await tx.rentalAttributeUniqueValue.deleteMany({
          where: { tenantId: asset.tenantId, workspaceId, entityType: "asset", entityId: asset.id }
        });
        for (const claim of uniqueAttributes) {
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
        await tx.rentalAsset.upsert({
          where: { id: asset.id },
          create: { workspaceId, id: asset.id, ...data, createdAt: new Date(asset.createdAt) },
          update: data
        });
      });
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
      where: { tenantId, workspaceId },
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
   * 盘点写入：锁行 → 读现值 → 合并 → 落库，全程同一事务。
   *
   * 为什么必须锁：`maintenanceQuantity` 从"只有盘点一个写者"变成了两个——异常归还的
   * 隔离增量也写它（见 `saveOrderAggregate`）。无锁的读-改-写会把并发的隔离整行覆盖掉，
   * 等于把刚隔离的坏货又放回可用池，正是隔离要防的事。
   *
   * `maintenanceQuantity` 省略时**保留库里现值**：盘点表单常常只报在手数量，
   * 默认清零会让一次例行盘点顺手解除隔离。要下调维修量必须显式给值。
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
      const maintenanceQuantity = input.maintenanceQuantity ?? existing?.maintenanceQuantity ?? 0;
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
      await tx.rentalStockBalance.upsert({
        where: { id },
        create: { workspaceId, id, ...data },
        update: data
      });
      return { id, onHandQuantity: input.onHandQuantity, maintenanceQuantity };
    });
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
    await this.prisma.rentalStockBalance.upsert({
      where: { id: balance.id },
      create: { workspaceId, id: balance.id, ...data },
      update: data    });
  }

  async listStockDispositions(tenantId: string, orderId?: string, tx?: RentalFactTx): Promise<RentalStockDisposition[]> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalStockDisposition.findMany({
      where: { tenantId, workspaceId, ...(orderId ? { orderId } : {}) }, orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => ({ ...row, inspectionId: row.inspectionId ?? undefined, assetId: row.assetId ?? undefined, blockReason: row.blockReason ?? undefined, restoredBy: row.restoredBy ?? undefined, receivedAt: row.receivedAt.toISOString(), bufferUntil: row.bufferUntil.toISOString(), restoredAt: row.restoredAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }

  async upsertStockDisposition(disposition: RentalStockDisposition, tx?: RentalFactTx): Promise<void> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, disposition.tenantId);
    await client.rentalStockDisposition.upsert({
      where: { id: disposition.id },
      create: { ...disposition, workspaceId, receivedAt: new Date(disposition.receivedAt), bufferUntil: new Date(disposition.bufferUntil), restoredAt: disposition.restoredAt ? new Date(disposition.restoredAt) : null, createdAt: new Date(disposition.createdAt), updatedAt: new Date(disposition.updatedAt) },
      update: { orderId: disposition.orderId, inspectionId: disposition.inspectionId ?? null, returnBatchKey: disposition.returnBatchKey, dedupeKey: disposition.dedupeKey, itemGroupId: disposition.itemGroupId, locationId: disposition.locationId, assetId: disposition.assetId ?? null, quantity: disposition.quantity, receivedAt: new Date(disposition.receivedAt), bufferUntil: new Date(disposition.bufferUntil), status: disposition.status, blockReason: disposition.blockReason ?? null, restoredQuantity: disposition.restoredQuantity, restoredAt: disposition.restoredAt ? new Date(disposition.restoredAt) : null, restoredBy: disposition.restoredBy ?? null }
    });
  }

  async restoreStockDisposition(tenantId: string, dispositionId: string, operator: string, tx?: RentalFactTx): Promise<RentalStockDisposition> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalStockDisposition.findFirst({ where: { id: dispositionId, tenantId, workspaceId }, select: { id: true, quantity: true, restoredQuantity: true, status: true, bufferUntil: true, tenantId: true, workspaceId: true, orderId: true, inspectionId: true, returnBatchKey: true, dedupeKey: true, itemGroupId: true, locationId: true, assetId: true, receivedAt: true, blockReason: true, restoredAt: true, restoredBy: true, createdAt: true, updatedAt: true } });
    if (!row) throw new NotFoundException("库存处置不存在或不属于当前经营空间");
    if (row.status === "blocked") throw new ConflictException("该处置仍有异常阻断，须先完成关联工单验收");
    if (new Date() < row.bufferUntil) throw new ConflictException("归还后周转缓冲尚未结束，暂不能恢复可租");
    if (row.restoredQuantity >= row.quantity) throw new ConflictException("该处置已经恢复，不能重复恢复");
    const restoredAt = new Date();
    const updated = await client.rentalStockDisposition.update({ where: { id: row.id }, data: { status: "restored", restoredQuantity: row.quantity, restoredAt, restoredBy: operator } });
    if (row.assetId) {
      await client.rentalAsset.updateMany({ where: { id: row.assetId, tenantId, workspaceId }, data: { status: "AVAILABLE" } });
    }
    return { ...updated, inspectionId: updated.inspectionId ?? undefined, assetId: updated.assetId ?? undefined, blockReason: updated.blockReason ?? undefined, restoredBy: updated.restoredBy ?? undefined, receivedAt: updated.receivedAt.toISOString(), bufferUntil: updated.bufferUntil.toISOString(), restoredAt: updated.restoredAt?.toISOString(), createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() };
  }

  /* ---------- 检查记录 ---------- */
  async listInspections(tenantId: string, orderId: string): Promise<RentalInspectionRecord[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalInspectionRecord.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => {
      const results = structuredClone((row.results ?? {}) as Record<string, unknown>);
      const meta = results.__r1InspectionMeta as
        | Pick<RentalInspectionRecord, "baselineInspectionId" | "comparisons" | "usageReadings" | "returnedItems">
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
        results,
        baselineInspectionId: meta?.baselineInspectionId,
        comparisons: meta?.comparisons,
        usageReadings: meta?.usageReadings,
        returnedItems: meta?.returnedItems,
        exceptions: (row.exceptions ?? []) as RentalInspectionRecord["exceptions"],
        attachments: (row.attachments ?? []) as string[],
        operator: row.operator,
        createdAt: iso(row.createdAt)
      };
    });
  }

  async insertInspection(record: RentalInspectionRecord, tx?: RentalFactTx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx ?? this.prisma, record.tenantId);
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
            baselineInspectionId: record.baselineInspectionId,
            comparisons: record.comparisons ?? [],
            usageReadings: record.usageReadings ?? [],
            returnedItems: record.returnedItems ?? []
          }
        } as Prisma.InputJsonValue,
        exceptions: record.exceptions as unknown as Prisma.InputJsonValue,
        attachments: record.attachments as unknown as Prisma.InputJsonValue,
        operator: record.operator,
        createdAt: new Date(record.createdAt)
      }
    });
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
    await client.rentalOrderExtension.update({
      where: { id: extensionId },
      data: {
        status: "effective",
        effectiveAt: new Date(at),
        ...(paidAt ? { paidAt: new Date(paidAt) } : {})
      }
    });
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
    await client.rentalOrderExtension.updateMany({
      where: { id: { in: extensionIds }, tenantId, status: "pending_payment" },
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
      pricingGroupMemberItemGroupIds: (line.pricingGroupMemberItemGroupIds ?? undefined) as string[] | undefined,
      itemGroupId: line.itemGroupId,
      itemGroupCode: line.itemGroupCode,
      itemGroupName: line.itemGroupName,
      inventoryMode: lower<RentalInventoryMode>(line.inventoryMode),
      quantity: line.quantity,
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
      startAt: iso(row.startAt),
      endAt: iso(row.endAt),
      effectiveEndAt: optionalIso(row.effectiveEndAt),
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
      completedAt: optionalIso(row.completedAt),
      lines,
      reservations,
      allocations,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }
}
