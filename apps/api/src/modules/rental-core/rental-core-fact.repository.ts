import { ConflictException, Injectable } from "@nestjs/common";
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
  type RentalFulfillmentMode,
  type RentalInspectionRecord,
  type RentalOrder,
  type RentalOrderLine,
  type RentalQuoteChargeLine,
  type RentalReservation,
  type RentalRuleConfig,
  type RentalStockBalance
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";

/** 参与可用量计算的预占。表上直接带 startAt/endAt，因此不必回连订单。 */
export interface ActiveReservationRow {
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
  saveOrderAggregate(order: RentalOrder, assetChanges?: AssetStatusChange[], tx?: RentalFactTx): Promise<void>;
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
  listInspections(tenantId: string, orderId: string): Promise<RentalInspectionRecord[]>;
  insertInspection(record: RentalInspectionRecord, tx?: RentalFactTx): Promise<void>;
}

const ACTIVE_RESERVATION_STATES: $Enums.RentalReservationState[] = ["SOFT", "CONFIRMED", "FULFILLED"];
const IN_USE_ALLOCATION_STATES = ["allocated", "picked_up"];

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
  async saveOrderAggregate(order: RentalOrder, assetChanges: AssetStatusChange[] = [], tx?: RentalFactTx): Promise<void> {
    const orderData = {
      tenantId: order.tenantId,
      orderNo: order.orderNo,
      categoryCode: upper<$Enums.RentalCategoryCode>(order.categoryCode),
      status: upper<$Enums.RentalOrderV1Status>(order.status),
      customerType: order.customerType,
      customerId: order.customerId ?? null,
      customerName: order.customerName,
      contactPhone: order.contactPhone ?? null,
      fulfillmentMode: order.fulfillmentMode,
      fulfillmentLocationId: order.fulfillmentLocationId,
      fulfillmentLocationName: order.fulfillmentLocationName,
      returnLocationId: order.returnLocationId ?? null,
      returnLocationName: order.returnLocationName ?? null,
      startAt: new Date(order.startAt),
      endAt: new Date(order.endAt),
      quoteId: order.quoteId,
      quoteNo: order.quoteNo,
      pricingPlanVersion: order.pricingPlanVersion,
      ruleVersion: order.ruleVersion,
      ruleSnapshot: order.ruleSnapshot as unknown as Prisma.InputJsonValue,
      calendarVersion: order.calendarVersion ?? null,
      chargeLines: order.chargeLines as unknown as Prisma.InputJsonValue,
      rentalAmount: new Prisma.Decimal(order.rentalAmount),
      discountAmount: new Prisma.Decimal(order.discountAmount),
      couponAmount: new Prisma.Decimal(order.couponAmount),
      serviceAmount: new Prisma.Decimal(order.serviceAmount),
      depositAmount: new Prisma.Decimal(order.depositAmount),
      payableAmount: new Prisma.Decimal(order.payableAmount),
      adjustmentAmount: new Prisma.Decimal(order.adjustmentAmount),
      finalPayableAmount: new Prisma.Decimal(order.finalPayableAmount),
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
          // 预占自带期间，使可用量查询不必回连订单表。
          startAt: new Date(order.startAt),
          endAt: new Date(order.endAt),
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
            assetId: allocation.assetId ?? null,
            assetNo: allocation.assetNo ?? null,
            quantity: allocation.quantity,
            status: allocation.status
          }
        });
      }

      for (const change of assetChanges) {
        await client.rentalAsset.updateMany({
          where: { id: change.assetId, tenantId: order.tenantId },
          data: { status: upper<$Enums.RentalAssetState>(change.status) }
        });
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
      select: { itemGroupId: true, locationId: true, quantity: true, startAt: true, endAt: true }
    });
    return rows.map((row) => ({
      itemGroupId: row.itemGroupId,
      locationId: row.locationId,
      quantity: row.quantity,
      startAt: iso(row.startAt),
      endAt: iso(row.endAt)
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
      update: data
    });
  }

  /* ---------- 检查记录 ---------- */

  async listInspections(tenantId: string, orderId: string): Promise<RentalInspectionRecord[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalInspectionRecord.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      orderId: row.orderId,
      stage: row.stage as "pickup" | "return",
      templateId: row.templateId,
      templateCode: row.templateCode,
      templateVersion: row.templateVersion,
      results: (row.results ?? {}) as Record<string, unknown>,
      exceptions: (row.exceptions ?? []) as RentalInspectionRecord["exceptions"],
      attachments: (row.attachments ?? []) as string[],
      operator: row.operator,
      createdAt: iso(row.createdAt)
    }));
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
        results: record.results as Prisma.InputJsonValue,
        exceptions: record.exceptions as unknown as Prisma.InputJsonValue,
        attachments: record.attachments as unknown as Prisma.InputJsonValue,
        operator: record.operator,
        createdAt: new Date(record.createdAt)
      }
    });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toDomainOrder(row: Prisma.RentalOrderGetPayload<{
    include: { lines: true; reservations: true; allocations: true };
  }>): RentalOrder {
    const lines: RentalOrderLine[] = row.lines.map((line) => ({
      id: line.id,
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
      status: lower<RentalReservationStatus>(reservation.status),
      expiresAt: optionalIso(reservation.expiresAt),
      createdAt: iso(reservation.createdAt)
    }));
    const allocations: RentalAllocation[] = row.allocations.map((allocation) => ({
      id: allocation.id,
      orderId: allocation.orderId,
      orderLineId: allocation.orderLineId,
      assetId: allocation.assetId ?? undefined,
      assetNo: allocation.assetNo ?? undefined,
      quantity: allocation.quantity,
      status: allocation.status as RentalAllocation["status"]
    }));
    return {
      id: row.id,
      tenantId: row.tenantId,
      orderNo: row.orderNo,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      status: lower<RentalCoreOrderStatus>(row.status),
      customerType: row.customerType as RentalOrder["customerType"],
      customerId: row.customerId ?? undefined,
      customerName: row.customerName,
      contactPhone: row.contactPhone ?? undefined,
      fulfillmentMode: row.fulfillmentMode as RentalFulfillmentMode,
      fulfillmentLocationId: row.fulfillmentLocationId,
      fulfillmentLocationName: row.fulfillmentLocationName,
      returnLocationId: row.returnLocationId ?? undefined,
      returnLocationName: row.returnLocationName ?? undefined,
      startAt: iso(row.startAt),
      endAt: iso(row.endAt),
      quoteId: row.quoteId,
      quoteNo: row.quoteNo,
      pricingPlanVersion: row.pricingPlanVersion,
      ruleVersion: row.ruleVersion,
      ruleSnapshot: row.ruleSnapshot as unknown as RentalRuleConfig,
      calendarVersion: row.calendarVersion ?? undefined,
      chargeLines: (row.chargeLines ?? []) as unknown as RentalQuoteChargeLine[],
      rentalAmount: num(row.rentalAmount),
      discountAmount: num(row.discountAmount),
      couponAmount: num(row.couponAmount),
      serviceAmount: num(row.serviceAmount),
      depositAmount: num(row.depositAmount),
      payableAmount: num(row.payableAmount),
      adjustmentAmount: num(row.adjustmentAmount),
      finalPayableAmount: num(row.finalPayableAmount),
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
