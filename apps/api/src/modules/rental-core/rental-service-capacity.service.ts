import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type {
  RentalOrder,
  RentalQuoteServiceSnapshot,
  RentalServiceCapacity,
  SaveRentalServiceCapacityRequest
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";

type Tx = Prisma.TransactionClient;

const iso = (value: Date) => value.toISOString();

/**
 * MKT-02B：通用服务容量。
 *
 * 这里只管理“服务 × 地点 × 时段”的数量事实，不创建人员排班、物流任务或 Provider。
 * 报价仅检查；订单创建、确认、取消和履约转换由调用方放进自己的事务。
 */
@Injectable()
export class RentalServiceCapacityService {
  constructor(private readonly prisma: PrismaService) {}

  async listCapacities(tenantId: string, serviceId?: string): Promise<RentalServiceCapacity[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    await this.releaseExpired(tenantId);
    const rows = await this.prisma.rentalServiceCapacity.findMany({
      where: { tenantId, workspaceId, ...(serviceId ? { serviceId } : {}) },
      orderBy: [{ windowStart: "asc" }, { serviceId: "asc" }, { locationId: "asc" }]
    });
    return rows.map((row) => this.toCapacity(row));
  }

  async saveCapacity(tenantId: string, input: SaveRentalServiceCapacityRequest): Promise<RentalServiceCapacity> {
    const start = new Date(input.windowStart);
    const end = new Date(input.windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new BadRequestException("服务容量的结束时间必须晚于开始时间");
    }
    if (!Number.isInteger(input.totalCapacity) || input.totalCapacity < 1) {
      throw new BadRequestException("服务容量必须是大于 0 的整数");
    }
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.prisma.$transaction(async (tx) => {
      const [service, location, existing] = await Promise.all([
        tx.rentalValueAddedService.findFirst({ where: { id: input.serviceId, tenantId, workspaceId } }),
        tx.rentalFulfillmentLocation.findFirst({ where: { id: input.locationId, tenantId, workspaceId } }),
        input.id ? tx.rentalServiceCapacity.findFirst({ where: { id: input.id, tenantId, workspaceId } }) : undefined
      ]);
      if (!service) throw new NotFoundException("增值服务不存在");
      if (!service.requiresCapacity) throw new ConflictException("该服务未声明需要容量，不能维护容量窗口");
      if (!location) throw new NotFoundException("服务地点不存在");
      if (input.id && !existing) throw new NotFoundException("服务容量窗口不存在");
      if (existing && input.totalCapacity < existing.reservedQuantity + existing.usedQuantity) {
        throw new ConflictException("总容量不能小于已预留与已确认数量之和");
      }
      if (existing) {
        const identityChanged = existing.serviceId !== input.serviceId
          || existing.locationId !== input.locationId
          || existing.windowStart.getTime() !== start.getTime()
          || existing.windowEnd.getTime() !== end.getTime();
        if (identityChanged) {
          const reservationExists = await tx.rentalServiceReservation.findFirst({
            where: { tenantId, workspaceId, capacityId: existing.id },
            select: { id: true }
          });
          if (reservationExists) {
            throw new ConflictException("已有预留历史的容量窗口不能改写服务、地点或时段；请新建容量窗口");
          }
        }
      }
      const overlap = await tx.rentalServiceCapacity.findFirst({
        where: {
          tenantId,
          workspaceId,
          serviceId: input.serviceId,
          locationId: input.locationId,
          ...(input.id ? { id: { not: input.id } } : {}),
          windowStart: { lt: end },
          windowEnd: { gt: start }
        }
      });
      if (overlap) throw new ConflictException("同一服务与地点的容量时段不能重叠");
      const capacityId = input.id ?? randomUUID();
      const row = await tx.rentalServiceCapacity.upsert({
        where: { id: capacityId },
        create: {
          id: capacityId,
          tenantId,
          workspaceId,
          serviceId: input.serviceId,
          locationId: input.locationId,
          windowStart: start,
          windowEnd: end,
          totalCapacity: input.totalCapacity,
          status: input.status
        },
        update: {
          serviceId: input.serviceId,
          locationId: input.locationId,
          windowStart: start,
          windowEnd: end,
          totalCapacity: input.totalCapacity,
          status: input.status
        }
      });
      return this.toCapacity(row);
    });
  }

  /** 报价只校验，不增量写容量。过期软预留先惰性释放，避免假性不足。 */
  async assertAvailableForQuote(tenantId: string, snapshots: RentalQuoteServiceSnapshot[]): Promise<void> {
    const required = snapshots.filter((row) => row.requiresCapacity);
    if (!required.length) return;
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await this.releaseExpired(tenantId, tx);
      for (const snapshot of required) {
        const capacity = await this.findCapacity(tenantId, workspaceId, snapshot, tx);
        if (!capacity || capacity.totalCapacity - capacity.reservedQuantity - capacity.usedQuantity < snapshot.capacityQuantity) {
          throw new ConflictException(`服务「${snapshot.serviceName}」在所选地点和时段容量不足`);
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** 下单事务内预留；失败时由外层事务整体回滚。 */
  async reserveForOrder(tenantId: string, order: Pick<RentalOrder, "id" | "serviceSnapshots" | "reservations">, requestKey: string, tx: Tx): Promise<void> {
    const required = (order.serviceSnapshots ?? [])
      .filter((row) => row.requiresCapacity)
      .sort((left, right) => [left.serviceId, left.serviceLocationId, left.scheduledStartAt, left.scheduledEndAt]
        .join("|")
        .localeCompare([right.serviceId, right.serviceLocationId, right.scheduledStartAt, right.scheduledEndAt].join("|")));
    if (!required.length) return;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await this.releaseExpired(tenantId, tx);
    const expiresAt = order.reservations.map((row) => row.expiresAt).filter(Boolean).sort()[0];
    for (const snapshot of required) {
      const idempotencyKey = this.reservationKey(requestKey, snapshot);
      const existing = await tx.rentalServiceReservation.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) {
        if (existing.orderId !== order.id || existing.serviceId !== snapshot.serviceId || existing.quantity !== snapshot.capacityQuantity) {
          throw new ConflictException("服务容量幂等键已被不同订单内容使用");
        }
        continue;
      }
      const capacity = await this.findCapacity(tenantId, workspaceId, snapshot, tx);
      if (!capacity) throw new ConflictException(`服务「${snapshot.serviceName}」没有覆盖所选地点和时段的可用容量`);
      const updated = await tx.rentalServiceCapacity.updateMany({
        where: {
          id: capacity.id,
          tenantId,
          workspaceId,
          status: "enabled",
          totalCapacity: { gte: capacity.reservedQuantity + capacity.usedQuantity + snapshot.capacityQuantity },
          reservedQuantity: capacity.reservedQuantity,
          usedQuantity: capacity.usedQuantity
        },
        data: { reservedQuantity: { increment: snapshot.capacityQuantity } }
      });
      if (updated.count !== 1) throw new ConflictException(`服务「${snapshot.serviceName}」容量已被其他订单占用`);
      await tx.rentalServiceReservation.create({
        data: {
          tenantId,
          workspaceId,
          capacityId: capacity.id,
          serviceId: snapshot.serviceId,
          orderId: order.id,
          quantity: snapshot.capacityQuantity,
          status: "reserved",
          idempotencyKey,
          expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 15 * 60_000)
        }
      });
    }
  }

  /** 订单确认：软预留转已确认，占用量继续计入 available 公式并停止超时。 */
  async confirmForOrder(tenantId: string, orderId: string, confirmedAt: string, tx: Tx): Promise<void> {
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    for (const row of rows.filter((item) => item.status === "reserved")) {
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, reservedQuantity: { gte: row.quantity } },
        data: { reservedQuantity: { decrement: row.quantity }, usedQuantity: { increment: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝确认订单");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, status: "reserved" },
        data: { status: "confirmed", confirmedAt: new Date(confirmedAt), expiresAt: null }
      });
    }
  }

  /** 取消释放未使用容量；已完成服务是历史事实，不在取消路径反向冲销。 */
  async releaseForOrder(tenantId: string, orderId: string, reason: string, releasedAt: string, tx: Tx): Promise<void> {
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    for (const row of rows.filter((item) => item.status === "reserved" || item.status === "confirmed")) {
      const data = row.status === "reserved"
        ? { reservedQuantity: { decrement: row.quantity } }
        : { usedQuantity: { decrement: row.quantity } };
      const guard = row.status === "reserved"
        ? { reservedQuantity: { gte: row.quantity } }
        : { usedQuantity: { gte: row.quantity } };
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, ...guard },
        data
      });
      if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝释放");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, status: row.status },
        data: { status: "released", releasedAt: new Date(releasedAt), releaseReason: reason, expiresAt: null }
      });
    }
  }

  /** 整单履约完成后把已确认流水标记已使用；计数不再移动，避免重复增减。 */
  async markUsedForOrder(tenantId: string, orderId: string, usedAt: string, tx: Tx): Promise<void> {
    await this.lockOrderReservations(tenantId, orderId, tx);
    await tx.rentalServiceReservation.updateMany({
      where: { tenantId, orderId, status: "confirmed" },
      data: { status: "used", usedAt: new Date(usedAt), expiresAt: null }
    });
  }

  /**
   * 归还时按服务自己的计划开始时点结算容量：已经开始的服务成为已使用历史；
   * 尚未开始的服务释放容量，不能因为订单最终归还就被伪造为“已履约”。
   *
   * 服务价款是否可退由订单冻结的早退规则决定；容量释放只是资源事实，二者不能混为一谈。
   */
  async settleReturnForOrder(
    tenantId: string,
    order: Pick<RentalOrder, "id" | "serviceSnapshots">,
    returnedAt: string,
    tx: Tx
  ): Promise<{ usedServiceIds: string[]; releasedServiceIds: string[] }> {
    const returnedAtMs = Date.parse(returnedAt);
    if (!Number.isFinite(returnedAtMs)) throw new BadRequestException("归还时间无效");
    const snapshotByServiceId = new Map((order.serviceSnapshots ?? []).map((snapshot) => [snapshot.serviceId, snapshot]));
    const rows = await this.lockOrderReservations(tenantId, order.id, tx);
    const usedServiceIds: string[] = [];
    const releasedServiceIds: string[] = [];
    for (const row of rows.filter((item) => item.status === "confirmed")) {
      const snapshot = snapshotByServiceId.get(row.serviceId);
      // 存量订单缺少服务快照时无法证明服务未开始：保守保留为已使用，避免错放容量。
      const started = !snapshot || Date.parse(snapshot.scheduledStartAt) <= returnedAtMs;
      if (started) {
        await tx.rentalServiceReservation.updateMany({
          where: { id: row.id, tenantId, status: "confirmed" },
          data: { status: "used", usedAt: new Date(returnedAt), expiresAt: null }
        });
        usedServiceIds.push(row.serviceId);
        continue;
      }
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, usedQuantity: { gte: row.quantity } },
        data: { usedQuantity: { decrement: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("未开始服务的容量账不平，拒绝归还结算");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, status: "confirmed" },
        data: { status: "released", releasedAt: new Date(returnedAt), releaseReason: "not_started_at_return", expiresAt: null }
      });
      releasedServiceIds.push(row.serviceId);
    }
    return { usedServiceIds, releasedServiceIds };
  }

  async releaseExpired(tenantId: string, tx?: Tx): Promise<number> {
    if (!tx) {
      return this.prisma.$transaction((inner) => this.releaseExpired(tenantId, inner), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
      });
    }
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const now = new Date();
    const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM rental_service_reservations
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND status = 'reserved' AND expiresAt IS NOT NULL AND expiresAt < ${now}
      FOR UPDATE
    `);
    if (!ids.length) return 0;
    const rows = await tx.rentalServiceReservation.findMany({ where: { id: { in: ids.map((row) => row.id) } } });
    for (const row of rows) {
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, workspaceId, reservedQuantity: { gte: row.quantity } },
        data: { reservedQuantity: { decrement: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("过期服务容量账不平，拒绝自动释放");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, status: "reserved" },
        data: { status: "expired", releasedAt: now, releaseReason: "reservation_timeout", expiresAt: null }
      });
    }
    return rows.length;
  }

  private async findCapacity(tenantId: string, workspaceId: string, snapshot: RentalQuoteServiceSnapshot, tx: Tx) {
    return tx.rentalServiceCapacity.findFirst({
      where: {
        tenantId,
        workspaceId,
        serviceId: snapshot.serviceId,
        locationId: snapshot.serviceLocationId,
        status: "enabled",
        windowStart: { lte: new Date(snapshot.scheduledStartAt) },
        windowEnd: { gte: new Date(snapshot.scheduledEndAt) }
      },
      orderBy: [{ windowEnd: "asc" }, { id: "asc" }]
    });
  }

  private async lockOrderReservations(tenantId: string, orderId: string, tx: Tx) {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_service_reservations
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND orderId = ${orderId}
      FOR UPDATE
    `);
    return tx.rentalServiceReservation.findMany({ where: { tenantId, workspaceId, orderId } });
  }

  private reservationKey(requestKey: string, snapshot: RentalQuoteServiceSnapshot) {
    const digest = createHash("sha256")
      .update([requestKey, snapshot.serviceId, snapshot.serviceLocationId, snapshot.scheduledStartAt, snapshot.scheduledEndAt].join("|"))
      .digest("hex");
    return `service-capacity:${digest}`;
  }

  private toCapacity(row: {
    id: string; tenantId: string; workspaceId: string; serviceId: string; locationId: string;
    windowStart: Date; windowEnd: Date; totalCapacity: number; reservedQuantity: number;
    usedQuantity: number; status: string; createdAt: Date; updatedAt: Date;
  }): RentalServiceCapacity {
    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      serviceId: row.serviceId,
      locationId: row.locationId,
      windowStart: iso(row.windowStart),
      windowEnd: iso(row.windowEnd),
      totalCapacity: row.totalCapacity,
      reservedQuantity: row.reservedQuantity,
      usedQuantity: row.usedQuantity,
      status: row.status as RentalServiceCapacity["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }
}
