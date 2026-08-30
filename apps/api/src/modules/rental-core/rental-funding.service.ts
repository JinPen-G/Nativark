import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  RentalFundingAction,
  RentalFundingBalance,
  RentalFundingEvent,
  RentalFundingInstrument
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { deriveFundingLedgers, nextBalanceAfter } from "./rental-funding-events";

/**
 * RULE-01B：押金与预授权的模拟资金事件服务（需求 4.4.7 line 527、4.6.3）。
 *
 * 职责边界（RULE-01B 明确不做）：只记录资金事实，**不**改写订单状态、不进入取消/爽约/逾期
 * 或通用订单状态机；只使用明确标记的 mock provider，不接真实支付 Provider。
 *
 * 幂等且可恢复：每个动作带 idempotencyKey，落库唯一键为
 * (workspaceId, orderId, instrument, action, idempotencyKey)。重复提交（重试/崩溃恢复）
 * 命中既有事件即回放，绝不重复扣款或重复冻结。余额与合法性判定全部委托纯函数，可脱库回放。
 */
@Injectable()
export class RentalFundingService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrderScope(
    tenantId: string,
    workspaceId: string,
    orderId: string
  ): Promise<{ workspaceId: string; depositAmount: number; preAuthAmount: number }> {
    const order = await this.prisma.rentalOrder.findFirst({
      where: { id: orderId, tenantId, workspaceId },
      select: { workspaceId: true, depositAmount: true, preAuthAmount: true }
    });
    if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");
    return {
      workspaceId: order.workspaceId,
      depositAmount: Number(order.depositAmount),
      preAuthAmount: Number(order.preAuthAmount)
    };
  }

  private toEvent(row: Prisma.RentalFundingEventGetPayload<object>): RentalFundingEvent {
    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      orderId: row.orderId,
      instrument: row.instrument as RentalFundingInstrument,
      action: row.action as RentalFundingAction,
      amount: Number(row.amount),
      balanceAfter: Number(row.balanceAfter),
      provider: "mock",
      idempotencyKey: row.idempotencyKey,
      reason: row.reason,
      operator: row.operator ?? undefined,
      failureCode: row.failureCode ?? undefined,
      at: row.at.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private async loadEvents(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    workspaceId: string,
    orderId: string
  ): Promise<RentalFundingEvent[]> {
    const rows = await db.rentalFundingEvent.findMany({
      where: { tenantId, workspaceId, orderId },
      orderBy: { at: "asc" }
    });
    return rows.map((row) => this.toEvent(row));
  }

  async listEvents(tenantId: string, workspaceId: string, orderId: string): Promise<RentalFundingBalance> {
    await this.loadOrderScope(tenantId, workspaceId, orderId);
    const events = await this.loadEvents(this.prisma, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(events);
    return {
      orderId,
      deposit: {
        collected: ledgers.deposit.collected,
        captured: ledgers.deposit.captured,
        refunded: ledgers.deposit.refunded,
        balance: ledgers.deposit.balance
      },
      preauthorization: {
        frozen: ledgers.preauthorization.frozen,
        captured: ledgers.preauthorization.captured,
        released: ledgers.preauthorization.released,
        balance: ledgers.preauthorization.balance
      },
      events
    };
  }

  private async lockedOrderScope(
    tx: Prisma.TransactionClient,
    tenantId: string,
    workspaceId: string,
    orderId: string
  ): Promise<{ depositAmount: number; preAuthAmount: number }> {
    const rows = await tx.$queryRaw<Array<{ depositAmount: Prisma.Decimal; preAuthAmount: Prisma.Decimal }>>(Prisma.sql`
      SELECT depositAmount, preAuthAmount
        FROM rental_orders
       WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
       FOR UPDATE
    `);
    const order = rows[0];
    if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");
    return { depositAmount: Number(order.depositAmount), preAuthAmount: Number(order.preAuthAmount) };
  }

  /** 领取前必须已经按订单快照足额收取押金、冻结预授权。 */
  async assertReadyForPickup(tenantId: string, workspaceId: string, orderId: string, tx: Prisma.TransactionClient): Promise<void> {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(await this.loadEvents(tx, tenantId, workspaceId, orderId));
    if (order.depositAmount > 0 && ledgers.deposit.collected < order.depositAmount) {
      throw new ConflictException(`领取前须足额收取押金 ¥${order.depositAmount.toFixed(2)}`);
    }
    if (order.preAuthAmount > 0 && ledgers.preauthorization.frozen < order.preAuthAmount) {
      throw new ConflictException(`领取前须足额冻结预授权 ¥${order.preAuthAmount.toFixed(2)}`);
    }
  }

  /** 关闭前两条模拟资金账都必须已经走完事件链并归零。 */
  async assertReadyToClose(tenantId: string, workspaceId: string, orderId: string, tx: Prisma.TransactionClient): Promise<void> {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(await this.loadEvents(tx, tenantId, workspaceId, orderId));
    if (order.depositAmount > 0 && ledgers.deposit.collected < order.depositAmount) throw new ConflictException("订单押金尚未足额收取，不能关闭");
    if (order.preAuthAmount > 0 && ledgers.preauthorization.frozen < order.preAuthAmount) throw new ConflictException("订单预授权尚未足额冻结，不能关闭");
    if (ledgers.deposit.balance > 0) throw new ConflictException("仍有押金余额，请先抵扣或退款");
    if (ledgers.preauthorization.balance > 0) throw new ConflictException("仍有预授权冻结额度，请先转扣或释放");
  }

  /**
   * 记录一次资金事件。amount 对 fail 以外的动作必须为正。failureCode 只在 fail 时有意义。
   * 幂等：命中既有同键事件时校验请求一致后回放；并发下靠唯一键兜底（P2002 → 回读回放）。
   */
  async recordEvent(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    input: {
      instrument: RentalFundingInstrument;
      action: RentalFundingAction;
      amount?: number;
      idempotencyKey: string;
      reason: string;
      failureCode?: string;
    },
    operator?: string
  ): Promise<RentalFundingEvent> {
    const reason = input.reason?.trim();
    if (!reason) throw new ConflictException("资金事件原因不能为空");
    const key = input.idempotencyKey?.trim();
    if (!key) throw new ConflictException("资金事件必须带幂等键");
    return this.prisma.$transaction(async (tx) => {
      // 资金余额是事件流推导值。必须先锁住订单行，把同一订单的不同幂等键动作也串行化；
      // 否则两笔并发抵扣都可能读到同一个旧余额并同时成功。
      const orders = await tx.$queryRaw<
        Array<{ workspaceId: string; depositAmount: Prisma.Decimal; preAuthAmount: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT workspaceId, depositAmount, preAuthAmount
          FROM rental_orders
         WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
         FOR UPDATE
      `);
      const order = orders[0];
      if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");

      // 命中既有同键事件即回放（重试/恢复）。锁内查询同时兜住并发重试。
      const existing = await tx.rentalFundingEvent.findUnique({
        where: {
          workspaceId_orderId_instrument_action_idempotencyKey: {
            workspaceId,
            orderId,
            instrument: input.instrument,
            action: input.action,
            idempotencyKey: key
          }
        }
      });
      if (existing) {
        const explicitAmount = input.action !== "initiate" && input.action !== "fail" && input.amount !== undefined;
        if (explicitAmount && Number(existing.amount) !== input.amount) {
          throw new ConflictException("相同幂等键已用于不同金额的资金事件");
        }
        return this.toEvent(existing);
      }

      const events = await this.loadEvents(tx, tenantId, workspaceId, orderId);
      const ledgers = deriveFundingLedgers(events);
      let effectiveAmount: number;
      if (input.action === "initiate") {
        // 首次应收/应冻结额是订单快照事实，客户端不得自行填写金额。
        effectiveAmount = Number(input.instrument === "deposit" ? order.depositAmount : order.preAuthAmount);
        if (effectiveAmount <= 0) {
          throw new ConflictException(input.instrument === "deposit" ? "该订单没有应收押金" : "该订单没有应冻结的预授权额度");
        }
      } else if (input.action === "release" && input.amount === undefined) {
        effectiveAmount = ledgers.preauthorization.balance;
        if (effectiveAmount <= 0) throw new ConflictException("当前没有可释放的预授权冻结额度");
      } else {
        effectiveAmount = input.action === "fail" ? 0 : Number(input.amount);
      }

      const balanceAfter = nextBalanceAfter(input.instrument, input.action, effectiveAmount, ledgers);
      const created = await tx.rentalFundingEvent.create({
        data: {
          id: randomUUID(),
          tenantId,
          workspaceId,
          orderId,
          instrument: input.instrument,
          action: input.action,
          amount: new Prisma.Decimal(effectiveAmount),
          balanceAfter: new Prisma.Decimal(balanceAfter),
          provider: "mock",
          idempotencyKey: key,
          reason,
          operator: operator ?? null,
          failureCode: input.action === "fail" ? (input.failureCode ?? "unspecified") : null,
          at: new Date()
        }
      });
      return this.toEvent(created);
    });
  }
}
