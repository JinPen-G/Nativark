import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  RentalOrder,
  RentalQuoteServiceSnapshot,
  RentalServiceCapacity,
  SaveRentalServiceCapacityRequest
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { serviceReservationKey } from "./rental-service-occurrence";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { lockActiveCategoryBinding } from "./category-active-write";

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
      // Same space mutex as category adoption and service/location configuration.
      // Serializes overlapping-window creation, including when no row exists yet.
      const { definition } = await lockActiveCategoryBinding(tx, tenantId, workspaceId);
      if (input.id) {
        // Reservation counters may change without the space mutex. Lock the row
        // before reading them so a waiting editor never lowers capacity below
        // a concurrently committed reservation. Scope prevents foreign row locks.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_service_capacities
          WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND id = ${input.id} FOR UPDATE`);
      }
      const [service, location, existingById] = await Promise.all([
        tx.rentalValueAddedService.findFirst({ where: { id: input.serviceId, tenantId, workspaceId } }),
        tx.rentalFulfillmentLocation.findFirst({ where: { id: input.locationId, tenantId, workspaceId } }),
        input.id ? tx.rentalServiceCapacity.findUnique({ where: { id: input.id } }) : undefined
      ]);
      const existing = existingById && existingById.tenantId === tenantId && existingById.workspaceId === workspaceId
        ? existingById
        : undefined;
      if (!service) throw new NotFoundException("增值服务不存在");
      if (!service.requiresCapacity) throw new ConflictException("该服务未声明需要容量，不能维护容量窗口");
      if (!location) throw new NotFoundException("服务地点不存在");
      if (input.status === "enabled" && end.getTime() > Date.now() &&
          !definition.businessModel.locationTypes.includes(location.type as typeof definition.businessModel.locationTypes[number])) {
        throw new ConflictException("当前品类不支持该服务容量的地点类型，请调整地点或停用容量窗口");
      }
      if (existingById && !existing) throw new ConflictException("服务容量窗口已属于其他租户或经营空间，拒绝覆盖");
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
      const existing = await tx.rentalServiceReservation.findFirst({ where: { tenantId, workspaceId, idempotencyKey } });
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
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    for (const row of rows.filter((item) => item.status === "reserved")) {
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, workspaceId, reservedQuantity: { gte: row.quantity } },
        data: { reservedQuantity: { decrement: row.quantity }, usedQuantity: { increment: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝确认订单");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, workspaceId, status: "reserved" },
        data: { status: "confirmed", confirmedAt: new Date(confirmedAt), expiresAt: null }
      });
    }
  }

  /** 取消释放未使用容量；已完成服务是历史事实，不在取消路径反向冲销。 */
  async releaseForOrder(tenantId: string, orderId: string, reason: string, releasedAt: string, tx: Tx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    for (const row of rows.filter((item) => item.status === "reserved" || item.status === "confirmed")) {
      const data = row.status === "reserved"
        ? { reservedQuantity: { decrement: row.quantity } }
        : { usedQuantity: { decrement: row.quantity } };
      const guard = row.status === "reserved"
        ? { reservedQuantity: { gte: row.quantity } }
        : { usedQuantity: { gte: row.quantity } };
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, workspaceId, ...guard },
        data
      });
      if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝释放");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, workspaceId, status: row.status },
        data: { status: "released", releasedAt: new Date(releasedAt), releaseReason: reason, expiresAt: null }
      });
    }
  }

  /** 整单履约完成后把已确认流水标记已使用；计数不再移动，避免重复增减。 */
  async markUsedForOrder(tenantId: string, orderId: string, usedAt: string, tx: Tx): Promise<void> {
    await this.lockOrderReservations(tenantId, orderId, tx);
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.rentalServiceReservation.updateMany({
      where: { tenantId, workspaceId, orderId, status: "confirmed" },
      data: { status: "used", usedAt: new Date(usedAt), expiresAt: null }
    });
  }

  /**
   * MKT-02D：只把一条服务发生项对应的容量预留转为已使用。
   *
   * 不能复用 `markUsedForOrder`：同一订单可能有多次同服务发生，整单转换会把尚未执行
   * 的那一次也伪造成已履约。状态与容量计数仍由同一事务更新。
   */
  async markUsedForOccurrence(
    tenantId: string,
    orderId: string,
    reservationKey: string | undefined,
    usedAt: string,
    tx: Tx
  ): Promise<void> {
    if (!reservationKey) return;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    const row = rows.find((item) => item.idempotencyKey === reservationKey);
    if (!row) throw new ConflictException("服务发生项没有找到对应的容量预留");
    if (row.status === "used") return;
    if (row.status !== "confirmed") throw new ConflictException("服务容量预留当前状态不能转为已使用");
    const updated = await tx.rentalServiceReservation.updateMany({
      where: { id: row.id, tenantId, workspaceId, status: "confirmed" },
      data: { status: "used", usedAt: new Date(usedAt), expiresAt: null }
    });
    if (updated.count !== 1) throw new ConflictException("服务容量预留状态已变化，请刷新后重试");
  }

  /** 部分履约后终止：已执行份数留作 used，未执行份数释放，并保留两条可追溯流水。 */
  async markPartiallyUsedForOccurrence(
    tenantId: string,
    orderId: string,
    reservationKey: string | undefined,
    executedQuantity: number,
    reason: string,
    at: string,
    tx: Tx
  ): Promise<void> {
    if (!reservationKey) return;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    const row = rows.find((item) => item.idempotencyKey === reservationKey);
    if (!row || row.status !== "confirmed") throw new ConflictException("服务容量预留当前状态不能部分结算");
    if (!Number.isInteger(executedQuantity) || executedQuantity < 1 || executedQuantity >= row.quantity) {
      throw new BadRequestException("已执行份数必须小于预留份数且大于零");
    }
    const releasedQuantity = row.quantity - executedQuantity;
    const moved = await tx.rentalServiceCapacity.updateMany({
      where: { id: row.capacityId, tenantId, workspaceId, usedQuantity: { gte: releasedQuantity } },
      data: { usedQuantity: { decrement: releasedQuantity } }
    });
    if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝部分结算");
    const updated = await tx.rentalServiceReservation.updateMany({
      where: { id: row.id, tenantId, workspaceId, status: "confirmed", quantity: row.quantity },
      data: { quantity: executedQuantity, status: "used", usedAt: new Date(at), expiresAt: null }
    });
    if (updated.count !== 1) throw new ConflictException("服务容量预留状态已变化，请刷新后重试");
    await tx.rentalServiceReservation.create({
      data: {
        id: randomUUID(), tenantId, workspaceId, capacityId: row.capacityId, serviceId: row.serviceId,
        orderId, quantity: releasedQuantity, status: "released", idempotencyKey: `partial-release:${row.id}`,
        reservedAt: row.reservedAt, confirmedAt: row.confirmedAt, releasedAt: new Date(at),
        releaseReason: reason
      }
    });
  }

  /** MKT-02D：取消/未到场/未开始失败时只释放这一条发生项的容量。 */
  async releaseForOccurrence(
    tenantId: string,
    orderId: string,
    reservationKey: string | undefined,
    reason: string,
    releasedAt: string,
    tx: Tx
  ): Promise<void> {
    if (!reservationKey) return;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    const row = rows.find((item) => item.idempotencyKey === reservationKey);
    if (!row || row.status === "released" || row.status === "expired") return;
    const data = row.status === "reserved"
      ? { reservedQuantity: { decrement: row.quantity } }
      : row.status === "confirmed"
        ? { usedQuantity: { decrement: row.quantity } }
        : undefined;
    const guard = row.status === "reserved"
      ? { reservedQuantity: { gte: row.quantity } }
      : row.status === "confirmed"
        ? { usedQuantity: { gte: row.quantity } }
        : undefined;
    if (!data || !guard) throw new ConflictException("服务容量预留当前状态不能释放");
    const moved = await tx.rentalServiceCapacity.updateMany({
      where: { id: row.capacityId, tenantId, workspaceId, ...guard },
      data
    });
    if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝释放发生项");
    const updated = await tx.rentalServiceReservation.updateMany({
      where: { id: row.id, tenantId, workspaceId, status: row.status },
      data: { status: "released", releasedAt: new Date(releasedAt), releaseReason: reason, expiresAt: null }
    });
    if (updated.count !== 1) throw new ConflictException("服务容量预留状态已变化，请刷新后重试");
  }

  /**
   * ORDER-CHANGE-01D：取货前只释放一项服务发生的部分数量。
   * 原预留行缩减为剩余数量，另写一条 released 流水保留本次释放事实；
   * reserved/confirmed 分别回冲对应容量桶，不能把部分释放当成整项释放。
   */
  async releaseQuantityForOccurrence(
    tenantId: string,
    orderId: string,
    reservationKey: string | undefined,
    quantity: number,
    reason: string,
    releasedAt: string,
    tx: Tx
  ): Promise<void> {
    if (!reservationKey) return;
    if (!Number.isInteger(quantity) || quantity < 1) throw new BadRequestException("服务容量释放数量必须是正整数");
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const rows = await this.lockOrderReservations(tenantId, orderId, tx);
    const row = rows.find((item) => item.idempotencyKey === reservationKey);
    if (!row || row.status === "released" || row.status === "expired") throw new ConflictException("服务容量预留当前状态不能部分释放");
    if (quantity >= row.quantity) throw new ConflictException("部分释放数量必须小于当前容量预留数量");
    const data = row.status === "reserved"
      ? { reservedQuantity: { decrement: quantity } }
      : row.status === "confirmed"
        ? { usedQuantity: { decrement: quantity } }
        : undefined;
    const guard = row.status === "reserved"
      ? { reservedQuantity: { gte: quantity } }
      : row.status === "confirmed"
        ? { usedQuantity: { gte: quantity } }
        : undefined;
    if (!data || !guard) throw new ConflictException("服务容量预留当前状态不能部分释放");
    const moved = await tx.rentalServiceCapacity.updateMany({
      where: { id: row.capacityId, tenantId, workspaceId, ...guard },
      data
    });
    if (moved.count !== 1) throw new ConflictException("服务容量账不平，拒绝部分释放");
    const updated = await tx.rentalServiceReservation.updateMany({
      where: { id: row.id, tenantId, workspaceId, status: row.status, quantity: row.quantity },
      data: { quantity: row.quantity - quantity }
    });
    if (updated.count !== 1) throw new ConflictException("服务容量预留状态已变化，请刷新后重试");
    await tx.rentalServiceReservation.create({
      data: {
        id: randomUUID(), tenantId, workspaceId, capacityId: row.capacityId, serviceId: row.serviceId,
        orderId, quantity, status: "released", idempotencyKey: `partial-release:${row.id}:${randomUUID()}`,
        reservedAt: row.reservedAt, confirmedAt: row.confirmedAt, releasedAt: new Date(releasedAt), releaseReason: reason
      }
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
    // MKT-02C：按**容量依据**配对，而不是按 serviceId。同一服务可能有原订单一次、续租
    // 又一次两条预留，各自时段不同；按 serviceId 建索引只会留下一条，另一条会被拿别人的
    // 时段判「是否已开始」——已经做过的服务被当成没做，容量就被错误放回可用池。
    const occurrences = order.serviceSnapshots ?? [];
    // MKT-02D：只要订单已经进入整单归还，所有新格式服务发生项都必须先有明确终态。
    // 不能因为服务不需要容量，或服务计划时间尚未到，就让归还动作绕过履约记录。
    // 存量订单没有 executionStatus，继续走下面的兼容分支，不改变历史口径。
    const pendingExecution = occurrences.filter((row) => {
      if (!("executionStatus" in row) || !row.executionStatus) return false;
      return !["completed", "cancelled", "failed", "no_show"].includes(row.executionStatus);
    });
    if (pendingExecution.length) {
      throw new ConflictException(`还有 ${pendingExecution.length} 项增值服务未记录实际结果，请先完成、取消或记录失败`);
    }
    const byReservationKey = new Map(
      occurrences.filter((row) => row.reservationKey).map((row) => [row.reservationKey as string, row])
    );
    // 存量订单的快照没有容量依据，只能回落到 serviceId；这类订单本来也只有一次发生。
    // 只收需要容量的：不需要容量的新发生项同样没有 reservationKey，把它收进来会让
    // 它抢走同 serviceId 那条存量快照的位置。
    const legacyByServiceId = new Map(
      occurrences.filter((row) => !row.reservationKey && row.requiresCapacity).map((row) => [row.serviceId, row])
    );
    const rows = await this.lockOrderReservations(tenantId, order.id, tx);
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const usedServiceIds: string[] = [];
    const releasedServiceIds: string[] = [];
    for (const row of rows.filter((item) => item.status === "confirmed")) {
      const snapshot = byReservationKey.get(row.idempotencyKey) ?? legacyByServiceId.get(row.serviceId);
      const executionStatus = snapshot && "executionStatus" in snapshot ? snapshot.executionStatus : undefined;
      // MKT-02D：新订单的显式履约状态优先。计划时点不能证明服务已经完成；在归还前
      // 已明确开始但尚未结束的服务必须先由运营记录完成/失败，不能靠归还动作代办。
      if (executionStatus === "in_progress") {
        throw new ConflictException(`服务「${snapshot?.serviceName ?? row.serviceId}」仍在执行，请先记录完成或失败`);
      }
      if (executionStatus === "not_started" && Date.parse(snapshot?.scheduledStartAt ?? "") <= returnedAtMs) {
        throw new ConflictException(`服务「${snapshot?.serviceName ?? row.serviceId}」尚未记录实际结果，不能按计划时间自动结算`);
      }
      // 存量订单缺少服务快照/履约状态时保守沿用旧口径；新订单不会走这个分支。
      const started = executionStatus
        ? executionStatus === "completed" || executionStatus === "failed"
        : !snapshot || Date.parse(snapshot.scheduledStartAt) <= returnedAtMs;
      if (started) {
        await tx.rentalServiceReservation.updateMany({
          where: { id: row.id, tenantId, workspaceId, status: "confirmed" },
          data: { status: "used", usedAt: new Date(returnedAt), expiresAt: null }
        });
        usedServiceIds.push(row.serviceId);
        continue;
      }
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, workspaceId, usedQuantity: { gte: row.quantity } },
        data: { usedQuantity: { decrement: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("未开始服务的容量账不平，拒绝归还结算");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, workspaceId, status: "confirmed" },
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
    const rows = await tx.rentalServiceReservation.findMany({
      where: { id: { in: ids.map((row) => row.id) }, tenantId, workspaceId }
    });
    for (const row of rows) {
      const moved = await tx.rentalServiceCapacity.updateMany({
        where: { id: row.capacityId, tenantId, workspaceId, reservedQuantity: { gte: row.quantity } },
        data: { reservedQuantity: { decrement: row.quantity } }
      });
      if (moved.count !== 1) throw new ConflictException("过期服务容量账不平，拒绝自动释放");
      await tx.rentalServiceReservation.updateMany({
        where: { id: row.id, tenantId, workspaceId, status: "reserved" },
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

  /**
   * 委托给共用纯函数：订单聚合要用同一个键把服务发生项和它自己那条预留配对，
   * 两处各写一遍哈希就会分叉。见 rental-service-occurrence.ts。
   */
  private reservationKey(requestKey: string, snapshot: RentalQuoteServiceSnapshot) {
    return serviceReservationKey(requestKey, snapshot);
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
