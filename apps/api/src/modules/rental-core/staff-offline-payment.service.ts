import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalFundingService } from "./rental-funding.service";
import type { CreateStaffOfflinePaymentDto } from "./staff-offline-payment.dto";

type LocationScope = { mode: "all" | "selected"; locationIds: string[] };
const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

@Injectable()
export class StaffOfflinePaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funding: RentalFundingService,
    private readonly rentalCore: RentalCoreService
  ) {}

  async list(tenantId: string, workspaceId: string, orderId: string, scope: LocationScope) {
    await this.assertOrder(tenantId, workspaceId, orderId, scope);
    const rows = await this.prisma.rentalOfflinePaymentRegistration.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { registeredAt: "desc" },
      take: 50
    });
    return rows.map((row) => this.toResponse(row));
  }

  async register(tenantId: string, workspaceId: string, userId: string, userName: string, input: CreateStaffOfflinePaymentDto, scope: LocationScope) {
    const orderId = input.orderId.trim();
    const key = input.idempotencyKey.trim();
    const reason = input.reason.trim();
    const amount = roundMoney(Number(input.amount));
    if (!orderId || !key || !reason || key.length > 191 || !Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("订单、金额、用途、方式和幂等键均须有效");
    }
    const paymentMethod = this.rentalCore.resolveOfflinePaymentMethod(tenantId, input.paymentMethod);
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, tenantId, workspaceId, orderId);
      const order = await this.assertOrder(tenantId, workspaceId, orderId, scope, tx);
      if (["completed", "cancelled"].includes(String(order.status).toLowerCase())) throw new ConflictException("已完成或已取消订单不能登记收款");
      const existing = await tx.rentalOfflinePaymentRegistration.findFirst({ where: { tenantId, workspaceId, orderId, idempotencyKey: key } });
      if (existing) {
        if (existing.instrument !== input.instrument || Number(existing.amount) !== amount || existing.paymentMethod !== paymentMethod || existing.reason !== reason || existing.evidenceFileAssetId !== (input.evidenceFileAssetId ?? null)) {
          throw new ConflictException("相同幂等键已用于不同的线下收款登记");
        }
        return this.toResponse(existing);
      }
      await this.assertEvidence(tx, tenantId, orderId, input.evidenceFileAssetId);
      const balance = await this.funding.listEvents(tenantId, workspaceId, orderId, tx);
      const pending = await tx.rentalOfflinePaymentRegistration.findMany({ where: { tenantId, workspaceId, orderId, instrument: input.instrument, status: "pending" }, select: { amount: true } });
      const outstanding = input.instrument === "rental"
        ? roundMoney(Math.max(0, balance.rental.balance + balance.rental.pendingExtensionAmount))
        : roundMoney(Math.max(0, balance.deposit.requiredAmount - balance.deposit.collected));
      const reserved = roundMoney(pending.reduce((sum, row) => sum + Number(row.amount), 0));
      if (amount > roundMoney(outstanding - reserved) + 0.005) throw new ConflictException("登记金额超过当前可收金额（含其他待确认登记）");
      return this.toResponse(await tx.rentalOfflinePaymentRegistration.create({
        data: {
          id: randomUUID(), tenantId, workspaceId, orderId,
          instrument: input.instrument,
          amount,
          paymentMethod,
          reason,
          evidenceFileAssetId: input.evidenceFileAssetId ?? null,
          idempotencyKey: key,
          registeredBy: `${userName} (${userId})`
        }
      }));
    });
  }

  async confirm(tenantId: string, workspaceId: string, userId: string, userName: string, registrationId: string, scope: LocationScope) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rental_offline_payment_registrations WHERE id = ${registrationId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`;
      const registration = await tx.rentalOfflinePaymentRegistration.findFirst({ where: { id: registrationId, tenantId, workspaceId } });
      if (!registration) throw new NotFoundException("待确认收款登记不存在");
      await this.lockOrder(tx, tenantId, workspaceId, registration.orderId);
      const order = await this.assertOrder(tenantId, workspaceId, registration.orderId, scope, tx);
      if (["completed", "cancelled"].includes(String(order.status).toLowerCase())) throw new ConflictException("已完成或已取消订单不能确认新增收款");
      if (registration.status !== "pending") throw new ConflictException("该收款登记已处理");
      const balance = await this.funding.listEvents(tenantId, workspaceId, registration.orderId, tx);
      const amount = Number(registration.amount);
      const originated = registration.instrument === "rental" ? balance.rental.collected > 0 : balance.deposit.collected > 0;
      const outstanding = registration.instrument === "rental"
        ? roundMoney(Math.max(0, balance.rental.balance + balance.rental.pendingExtensionAmount))
        : roundMoney(Math.max(0, balance.deposit.requiredAmount - balance.deposit.collected));
      if (amount > outstanding + 0.005) throw new ConflictException("当前待收金额已变化，登记金额超过剩余应收，请先核对订单");
      const event = await this.funding.recordEvent(tenantId, workspaceId, registration.orderId, {
        instrument: registration.instrument as "rental" | "deposit",
        action: originated ? "append" : "initiate",
        amount,
        allowPartialInitiate: !originated,
        idempotencyKey: `staff-offline:${registration.id}`,
        reason: `线下收款确认：${registration.reason}`,
        paymentMethod: registration.paymentMethod as "offline_cash" | "offline_transfer"
      }, `${userName} (${userId})`, tx);
      const updated = await tx.rentalOfflinePaymentRegistration.updateMany({
        where: { id: registration.id, tenantId, workspaceId, status: "pending" },
        data: { status: "confirmed", confirmedBy: `${userName} (${userId})`, confirmedAt: new Date(), fundingEventId: event.id }
      });
      if (updated.count !== 1) throw new ConflictException("该收款登记已被其他人处理，请刷新");
      const refreshed = await tx.rentalOfflinePaymentRegistration.findFirstOrThrow({ where: { id: registration.id, tenantId, workspaceId } });
      return { registration: this.toResponse(refreshed), fundingEvent: event };
    });
  }

  private async assertOrder(tenantId: string, workspaceId: string, orderId: string, scope: LocationScope, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const ids = scope.mode === "selected" ? scope.locationIds : undefined;
    if (scope.mode === "selected" && !ids?.length) throw new ForbiddenException("员工地点范围未就绪，已拒绝访问");
    const order = await db.rentalOrder.findFirst({
      where: { id: orderId, tenantId, workspaceId, ...(ids ? { OR: [{ fulfillmentLocationId: { in: ids } }, { returnLocationId: { in: ids } }] } : {}) },
      select: { id: true, status: true }
    });
    if (!order) throw new NotFoundException("订单不存在或不在当前员工授权地点范围内");
    return order;
  }

  private async assertEvidence(db: Prisma.TransactionClient | PrismaService, tenantId: string, orderId: string, evidenceId?: string) {
    if (!evidenceId) return;
    const asset = await db.fileAsset.findFirst({ where: { id: evidenceId, tenantId, businessType: "rental_order", businessId: orderId, uploadScene: "offline-payment-proof", status: "active" }, select: { id: true } });
    if (!asset) throw new BadRequestException("收款凭证不存在、未完成上传或未绑定当前订单");
  }

  private async lockOrder(tx: Prisma.TransactionClient, tenantId: string, workspaceId: string, orderId: string) {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM rental_orders WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`;
  }

  private toResponse(row: {
    id: string; tenantId: string; workspaceId: string; orderId: string; instrument: string; amount: unknown;
    paymentMethod: string; reason: string; evidenceFileAssetId: string | null; status: string; idempotencyKey: string;
    registeredBy: string | null; registeredAt: Date; confirmedBy: string | null; confirmedAt: Date | null; fundingEventId: string | null;
  }) {
    return {
      id: row.id, orderId: row.orderId, instrument: row.instrument as "rental" | "deposit", amount: Number(row.amount),
      paymentMethod: row.paymentMethod as "offline_cash" | "offline_transfer", reason: row.reason,
      evidenceFileAssetId: row.evidenceFileAssetId ?? undefined, status: row.status as "pending" | "confirmed",
      registeredBy: row.registeredBy ?? undefined, registeredAt: row.registeredAt.toISOString(),
      confirmedBy: row.confirmedBy ?? undefined, confirmedAt: row.confirmedAt?.toISOString(), fundingEventId: row.fundingEventId ?? undefined
    };
  }
}
