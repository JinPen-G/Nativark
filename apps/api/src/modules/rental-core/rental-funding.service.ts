import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  RentalFundingAction,
  RentalFundingBalance,
  RentalFundingEvent,
  RentalFundingInstrument,
  RentalOfflinePaymentMethod
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { aggregatePendingExtensionFunding, assertActionApplies, deriveFundingLedgers, nextBalanceAfter, rentalPaymentBalance } from "./rental-funding-events";
import { pendingExtensionCountsAsDue } from "./rental-extension-lifecycle";

type FundingOrder = { depositAmount: number; preAuthAmount: number; payable: number; status: string; ruleSnapshot: { payment?: { timing?: string } } };

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
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    workspaceId: string,
    orderId: string
  ): Promise<{ workspaceId: string; depositAmount: number; preAuthAmount: number }> {
    const order = await db.rentalOrder.findFirst({
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
      provider: row.provider as RentalFundingEvent["provider"],
      // 预授权转扣/释放和第三方回调不是线下收退款，不应伪装成现金。
      // 旧流水允许为空，读回时保持为空；只有外部人工收退款才会带 paymentMethod。
      paymentMethod: row.paymentMethod ? (row.paymentMethod as RentalOfflinePaymentMethod) : undefined,
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

  async listEvents(tenantId: string, workspaceId: string, orderId: string, tx?: Prisma.TransactionClient): Promise<RentalFundingBalance> {
    const db = tx ?? this.prisma;
    await this.loadOrderScope(db, tenantId, workspaceId, orderId);
    const order = await db.rentalOrder.findFirstOrThrow({ where: { id: orderId, tenantId, workspaceId } });
    const extensions = await db.rentalOrderExtension.findMany({
      where: { tenantId, workspaceId, orderId, status: { in: ["pending_payment", "effective"] } }
    });
    const effective = aggregatePendingExtensionFunding(extensions.filter((row) => row.status === "effective").map((row) => ({
      payableAmount: Number(row.payableAmount),
      depositDelta: Number(row.depositDelta),
      preAuthDelta: Number(row.preAuthDelta)
    })));
    const pending = aggregatePendingExtensionFunding((pendingExtensionCountsAsDue(order.status) ? extensions.filter((row) => row.status === "pending_payment") : []).map((row) => ({
      payableAmount: Number(row.payableAmount),
      depositDelta: Number(row.depositDelta),
      preAuthDelta: Number(row.preAuthDelta)
    })));
    const events = await this.loadEvents(db, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(events);
    return {
      orderId,
      rental: { ...rentalPaymentBalance(Number(order.finalPayableAmount), events), pendingExtensionAmount: pending.payableAmount },
      deposit: {
        collected: ledgers.deposit.collected,
        captured: ledgers.deposit.captured,
        refunded: ledgers.deposit.refunded,
        balance: ledgers.deposit.balance,
        requiredAmount: Number(order.depositAmount) + effective.depositAmount + pending.depositAmount,
        pendingExtensionAmount: pending.depositAmount
      },
      preauthorization: {
        frozen: ledgers.preauthorization.frozen,
        captured: ledgers.preauthorization.captured,
        released: ledgers.preauthorization.released,
        balance: ledgers.preauthorization.balance,
        requiredAmount: Number(order.preAuthAmount) + effective.preauthorizationAmount + pending.preauthorizationAmount,
        pendingExtensionAmount: pending.preauthorizationAmount
      },
      events
    };
  }

  private async lockedOrderScope(
    tx: Prisma.TransactionClient,
    tenantId: string,
    workspaceId: string,
    orderId: string
  ): Promise<FundingOrder> {
    const rows = await tx.$queryRaw<Array<{ depositAmount: Prisma.Decimal; preAuthAmount: Prisma.Decimal; finalPayableAmount: Prisma.Decimal; status: string; ruleSnapshot: FundingOrder["ruleSnapshot"] }>>(Prisma.sql`
      SELECT depositAmount, preAuthAmount, finalPayableAmount, status, ruleSnapshot
        FROM rental_orders
       WHERE id = ${orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
       FOR UPDATE
    `);
    const order = rows[0];
    if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");
    const extensions = await tx.rentalOrderExtension.findMany({ where: { tenantId, workspaceId, orderId, status: "effective" } });
    const effective = aggregatePendingExtensionFunding(extensions.map((row) => ({
      payableAmount: Number(row.payableAmount),
      depositDelta: Number(row.depositDelta),
      preAuthDelta: Number(row.preAuthDelta)
    })));
    return { depositAmount: Number(order.depositAmount) + effective.depositAmount, preAuthAmount: Number(order.preAuthAmount) + effective.preauthorizationAmount, payable: Number(order.finalPayableAmount), status: order.status.toLowerCase(), ruleSnapshot: order.ruleSnapshot };
  }

  /** 领取前必须已经按订单快照足额收取押金、冻结预授权。 */
  async assertReadyForPickup(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    options: { skipRentalPayment?: boolean } = {}
  ): Promise<void> {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(await this.loadEvents(tx, tenantId, workspaceId, orderId));
    if (order.depositAmount > 0 && ledgers.deposit.balance < order.depositAmount) {
      throw new ConflictException(`领取前须足额收取押金 ¥${order.depositAmount.toFixed(2)}`);
    }
    if (order.preAuthAmount > 0 && ledgers.preauthorization.balance < order.preAuthAmount) {
      throw new ConflictException(`领取前须足额冻结预授权 ¥${order.preAuthAmount.toFixed(2)}`);
    }
    if (!options.skipRentalPayment) await this.assertPaid(tenantId, workspaceId, orderId, tx, order.payable);
  }

  async assertPaid(tenantId: string, workspaceId: string, orderId: string, tx: Prisma.TransactionClient, payable?: number) {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const balance = rentalPaymentBalance(payable ?? order.payable, await this.loadEvents(tx, tenantId, workspaceId, orderId));
    if (balance.balance > 0.005) throw new ConflictException(`租金及费用尚需收款 ${balance.balance.toFixed(2)}，请先登记收款`);
  }

  async assertReadyForConfirmation(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    options: { skipRentalPayment?: boolean } = {}
  ) {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    if (!options.skipRentalPayment && ["order", "confirmation"].includes(order.ruleSnapshot.payment?.timing ?? "pickup")) {
      await this.assertPaid(tenantId, workspaceId, orderId, tx, order.payable);
    }
  }

  async assertExtensionPaid(tenantId: string, workspaceId: string, orderId: string, extensionId: string, tx: Prisma.TransactionClient) {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const extension = await tx.rentalOrderExtension.findFirst({ where: { id: extensionId, orderId, tenantId, workspaceId } });
    if (!extension) throw new NotFoundException("续租记录不存在");
    if (extension.status === "effective") return;
    const events = await this.loadEvents(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(events);
    if (ledgers.deposit.balance < order.depositAmount + Number(extension.depositDelta) || ledgers.preauthorization.balance < order.preAuthAmount + Number(extension.preAuthDelta)) throw new ConflictException("续租保证金不足，请先追加押金或预授权");
    await this.assertPaid(tenantId, workspaceId, orderId, tx, order.payable + Number(extension.payableAmount));
  }

  /** 关闭前两条模拟资金账都必须已经走完事件链并归零。 */
  async assertReadyToClose(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    options: { skipRentalPayment?: boolean } = {}
  ): Promise<void> {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(await this.loadEvents(tx, tenantId, workspaceId, orderId));
    if (order.depositAmount > 0 && ledgers.deposit.collected < order.depositAmount) throw new ConflictException("订单押金尚未足额收取，不能关闭");
    if (order.preAuthAmount > 0 && ledgers.preauthorization.frozen < order.preAuthAmount) throw new ConflictException("订单预授权尚未足额冻结，不能关闭");
    if (ledgers.deposit.balance > 0) throw new ConflictException("仍有押金余额，请先抵扣或退款");
    if (ledgers.preauthorization.balance > 0) throw new ConflictException("仍有预授权冻结额度，请先转扣或释放");
    if (!options.skipRentalPayment) {
      const balance = rentalPaymentBalance(order.payable, await this.loadEvents(tx, tenantId, workspaceId, orderId)).balance;
      if (Math.abs(balance) > 0.005) throw new ConflictException(balance > 0 ? `尚有费用 ${balance.toFixed(2)} 未收取` : `尚有退款 ${(-balance).toFixed(2)} 未完成`);
    }
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
      provider?: RentalFundingEvent["provider"];
      paymentMethod?: RentalOfflinePaymentMethod;
    },
    operator?: string,
    tx?: Prisma.TransactionClient
  ): Promise<RentalFundingEvent> {
    const reason = input.reason?.trim();
    if (!reason) throw new ConflictException("资金事件原因不能为空");
    const key = input.idempotencyKey?.trim();
    if (!key) throw new ConflictException("资金事件必须带幂等键");
    const run = async (tx: Prisma.TransactionClient) => {
      // 资金余额是事件流推导值。必须先锁住订单行，把同一订单的不同幂等键动作也串行化；
      // 否则两笔并发抵扣都可能读到同一个旧余额并同时成功。
      const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
      assertActionApplies(input.instrument, input.action);

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
      const payment = rentalPaymentBalance(order.payable, events);
      // 订单已终结时，遗留的待补款续租不再计入待收：订单都关了还为它收款，
      // 等于给一笔永远不可能生效的续租继续收钱（payOrderExtension 会因订单状态拒绝生效）。
      // 这类遗留申请由订单终态统一作废，见 rental-core.service 的 voidPendingExtensions。
      // 大小写不敏感比较：Prisma 客户端返回的是枚举成员名（大写），库里存的是 @map 小写值。
      const stillCollectable = pendingExtensionCountsAsDue(order.status);
      const pending = !stillCollectable
        ? []
        : await tx.rentalOrderExtension.findMany({ where: { tenantId, workspaceId, orderId, status: "pending_payment" } });
      const pendingFunding = aggregatePendingExtensionFunding(pending.map((row) => ({
        payableAmount: Number(row.payableAmount),
        depositDelta: Number(row.depositDelta),
        preAuthDelta: Number(row.preAuthDelta)
      })));
      const due = payment.balance + pendingFunding.payableAmount;
      let effectiveAmount: number;
      if (input.action === "initiate") {
        // 首次应收/应冻结额是订单快照事实，客户端不得自行填写金额。
        effectiveAmount = input.instrument === "rental"
          ? due
          : Number(input.instrument === "deposit" ? order.depositAmount + pendingFunding.depositAmount : order.preAuthAmount + pendingFunding.preauthorizationAmount);
        if (effectiveAmount <= 0) {
          throw new ConflictException(
            input.instrument === "rental"
              ? "当前没有待收的租金或费用"
              : input.instrument === "deposit"
                ? "该订单没有应收押金"
                : "该订单没有应冻结的预授权额度"
          );
        if (input.instrument === "rental" && input.amount !== undefined && Math.abs(Number(input.amount) - effectiveAmount) > 0.005) {
          throw new ConflictException("支付回调金额与当前订单待收金额不一致，请重新发起支付");
        }
        }
      } else if (input.action === "release" && input.amount === undefined) {
        effectiveAmount = ledgers.preauthorization.balance;
        if (effectiveAmount <= 0) throw new ConflictException("当前没有可释放的预授权冻结额度");
      } else {
        effectiveAmount = input.action === "fail" ? 0 : Number(input.amount);
      }

      if (input.action !== "fail" && (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0)) throw new ConflictException("金额必须为正数");
      if (["completed", "cancelled"].includes(order.status) && ["initiate", "append"].includes(input.action) && input.instrument !== "rental") throw new ConflictException("终态订单不能新增保证金");
      if (input.action === "capture" && effectiveAmount > Math.max(0, payment.balance)) throw new ConflictException("保证金抵扣不能超过尚未支付的应收费用");
      let balanceAfter: number;
      if (input.instrument === "rental") {
        if (["initiate", "append"].includes(input.action) && effectiveAmount > Math.max(0, due)) throw new ConflictException("收款不能超过订单及待补款续租应收");
        if (input.action === "refund" && effectiveAmount > Math.max(0, -payment.balance)) throw new ConflictException("退款不能超过已核准的待退金额，请先完成应收核减");
        balanceAfter = Math.round((payment.collected - payment.refunded + (input.action === "refund" ? -effectiveAmount : input.action === "fail" ? 0 : effectiveAmount)) * 100) / 100;
      } else balanceAfter = nextBalanceAfter(input.instrument, input.action, effectiveAmount, ledgers);
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
          provider: input.provider ?? "mock",
          // 内部资金动作以及真实 Provider 回调不属于线下收退款，保持 NULL。
          paymentMethod: input.paymentMethod ?? null,
          idempotencyKey: key,
          reason,
          operator: operator ?? null,
          failureCode: input.action === "fail" ? (input.failureCode ?? "unspecified") : null,
          at: new Date()
        }
      });
      return this.toEvent(created);
    };
    // 服务退款等复合动作需要把资金事件与订单服务快照放进同一事务；
    // 原有单一资金接口不传 tx 时仍保持自己的事务边界。
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
