import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { lockRentalBusinessTenant } from "./rental-business-fence";
import { randomUUID } from "node:crypto";
import type {
  RentalFundingAction,
  RentalFundingBalance,
  RentalFundingEvent,
  RentalFundingInstrument,
  RentalOfflinePaymentMethod
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { aggregatePendingExtensionFunding, assertActionApplies, deriveFundingLedgers, isRealFundingEvent, nextBalanceAfter, rentalPaymentBalance, resolveOfflineFundingEvents } from "./rental-funding-events";
import { roundMoney } from "./rental-money";
import { pendingExtensionCountsAsDue } from "./rental-extension-lifecycle";

type FundingOrder = { depositAmount: number; preAuthAmount: number; payable: number; status: string; ruleSnapshot: { payment?: { timing?: string } } };

/**
 * 订单资金事实与门禁；不派发支付、不改写订单状态，线上入账仍由原支付运行器核验。
 * 模拟只在明确开发空间且该订单没有真实资金操作时参与演练，不能抵消实款。
 * 线下收款沿原登记确认事务入账；历史 mock 只按持久确认关系归一化，不改旧流水。
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
    const events = rows.map((row) => this.toEvent(row));
    if (!events.some(event => event.provider === "mock")) return events;
    const registrations = await db.rentalOfflinePaymentRegistration.findMany({
      where: { tenantId, workspaceId, orderId, status: "confirmed", fundingEventId: { not: null } }
    });
    return resolveOfflineFundingEvents(events, registrations);
  }

  private async loadBalanceContext(
    db: Prisma.TransactionClient | PrismaService, tenantId: string, workspaceId: string, orderId: string,
    realOnly = false
  ) {
    const events = await this.loadEvents(db, tenantId, workspaceId, orderId);
    let simulationAllowed = false;
    if (!realOnly && process.env.NODE_ENV !== "production" && events.every(event => event.provider === "mock")) {
      // 执行门内锁住空间模式，不能在演练门检查后并发切为生产；读取页面不持锁。
      const workspace = db === this.prisma
        ? await db.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId }, select: { runMode: true } })
        : (await db.$queryRaw<Array<{ runMode: string }>>(Prisma.sql`
            SELECT runMode FROM business_workspaces WHERE id = ${workspaceId} AND tenantId = ${tenantId} LOCK IN SHARE MODE
          `))[0];
      if (workspace?.runMode === "development") {
        // 已发起但未到账的真实支付/线下登记也不能靠模拟补齐；旧关闭记录不重开模拟口。
        const [payment, offline] = db === this.prisma ? await Promise.all([
          db.rentalPaymentIntent.findFirst({ where: { tenantId, workspaceId, orderId }, select: { id: true } }),
          db.rentalOfflinePaymentRegistration.findFirst({ where: { tenantId, workspaceId, orderId }, select: { id: true } })
        ]) : await Promise.all([
          db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM rental_payment_intents WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND orderId = ${orderId} LIMIT 1 LOCK IN SHARE MODE
          `).then(rows => rows[0]),
          db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM rental_offline_payment_registrations WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND orderId = ${orderId} LIMIT 1 LOCK IN SHARE MODE
          `).then(rows => rows[0])
        ]);
        // 外层事务可能已经建立旧快照，执行门必须用 current read 看见刚提交的真实操作。
        simulationAllowed = !payment && !offline;
      }
    }
    const balanceBasis = simulationAllowed ? "simulated" as const : "real" as const;
    return {
      events, balanceBasis, simulationAllowed,
      accountingEvents: events.filter(event => simulationAllowed ? event.provider === "mock" : isRealFundingEvent(event))
    };
  }

  async listEvents(tenantId: string, workspaceId: string, orderId: string, tx?: Prisma.TransactionClient, options: { realOnly?: boolean } = {}): Promise<RentalFundingBalance> {
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
    const { events, accountingEvents, balanceBasis, simulationAllowed } = await this.loadBalanceContext(db, tenantId, workspaceId, orderId, options.realOnly);
    const ledgers = deriveFundingLedgers(accountingEvents);
    const rentalBase = rentalPaymentBalance(Number(order.finalPayableAmount), accountingEvents);
    const depositRequired = Number(order.depositAmount) + effective.depositAmount + pending.depositAmount;
    return {
      orderId, balanceBasis, simulationAllowed,
      rental: { ...rentalBase, pendingExtensionAmount: pending.payableAmount, due: roundMoney(Math.max(0, rentalBase.balance + pending.payableAmount)) },
      deposit: {
        collected: ledgers.deposit.collected,
        captured: ledgers.deposit.captured,
        refunded: ledgers.deposit.refunded,
        balance: ledgers.deposit.balance,
        requiredAmount: depositRequired,
        pendingExtensionAmount: pending.depositAmount,
        due: roundMoney(Math.max(0, depositRequired - ledgers.deposit.collected))
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
    await lockRentalBusinessTenant(tx, tenantId);
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
    const ledgers = deriveFundingLedgers((await this.loadBalanceContext(tx, tenantId, workspaceId, orderId)).accountingEvents);
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
    const balance = rentalPaymentBalance(payable ?? order.payable, (await this.loadBalanceContext(tx, tenantId, workspaceId, orderId)).accountingEvents);
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
    const { accountingEvents: events } = await this.loadBalanceContext(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(events);
    if (ledgers.deposit.balance < order.depositAmount + Number(extension.depositDelta) || ledgers.preauthorization.balance < order.preAuthAmount + Number(extension.preAuthDelta)) throw new ConflictException("续租保证金不足，请先追加押金或预授权");
    await this.assertPaid(tenantId, workspaceId, orderId, tx, order.payable + Number(extension.payableAmount));
  }

  /** 关闭前按同一证据口径检查资金已结清。 */
  async assertReadyToClose(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    options: { skipRentalPayment?: boolean } = {}
  ): Promise<void> {
    const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers((await this.loadBalanceContext(tx, tenantId, workspaceId, orderId)).accountingEvents);
    if (order.depositAmount > 0 && ledgers.deposit.collected < order.depositAmount) throw new ConflictException("订单押金尚未足额收取，不能关闭");
    if (order.preAuthAmount > 0 && ledgers.preauthorization.frozen < order.preAuthAmount) throw new ConflictException("订单预授权尚未足额冻结，不能关闭");
    if (ledgers.deposit.balance > 0) throw new ConflictException("仍有押金余额，请先抵扣或退款");
    if (ledgers.preauthorization.balance > 0) throw new ConflictException("仍有预授权冻结额度，请先转扣或释放");
    if (!options.skipRentalPayment) {
      const balance = rentalPaymentBalance(order.payable, (await this.loadBalanceContext(tx, tenantId, workspaceId, orderId)).accountingEvents).balance;
      if (Math.abs(balance) > 0.005) throw new ConflictException(balance > 0 ? `尚有费用 ${balance.toFixed(2)} 未收取` : `尚有退款 ${(-balance).toFixed(2)} 未完成`);
    }
  }

  /**
   * 取消 / 确认爽约后仍被订单持有、需要退还或释放的同口径资金。
   *
   * 三项分别是：押金余额、预授权冻结余额，以及多收的租金（取消核减后 `rental.balance`
   * 为负即多收）。`refund_due` 费用审核单据此挂出——这张单**不动账**，实际退款/释放仍由
   * 资金区按权限单独办理，本方法只回答"还有多少钱扣在客户身上"。
   *
   * `payableOverride` 必须传取消核减**之后**的最终应付：核减把 `finalPayableAmount`
   * 冲回 0，而库里此刻仍是核减前的旧值；直接读库会把已经不再应收的租金当成待收，
   * 于是多收判不出来。核减发生在内存订单上、`saveOrderAggregate` 之前，因此由调用方传值。
   */
  async computeHeldFunds(
    tenantId: string,
    workspaceId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    payableOverride?: number
  ): Promise<{ depositBalance: number; preauthBalance: number; rentalOverpaid: number }> {
    const { accountingEvents: events } = await this.loadBalanceContext(tx, tenantId, workspaceId, orderId);
    const ledgers = deriveFundingLedgers(events);
    let payable = payableOverride;
    if (payable === undefined) {
      const order = await tx.rentalOrder.findFirst({
        where: { id: orderId, tenantId, workspaceId },
        select: { finalPayableAmount: true }
      });
      payable = order ? Number(order.finalPayableAmount) : 0;
    }
    const rental = rentalPaymentBalance(payable, events);
    return {
      depositBalance: ledgers.deposit.balance,
      preauthBalance: ledgers.preauthorization.balance,
      // 负值表示多收：与 rentalPaymentBalance 的口径一致，由调用方按 < -0.005 判定。
      rentalOverpaid: rental.balance
    };
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
      /** 仅由员工待确认登记服务在结算权限确认后启用，允许首次实收为部分金额。 */
      allowPartialInitiate?: boolean;
      /** 仅供已验签并核对原支付/退款单的 Provider 入账调用；不对 HTTP DTO 开放。 */
      verifiedExternalReceipt?: boolean;
      /** 原员工确认服务传入，必须与本次事件在同一事务内确认；不对 HTTP DTO 开放。 */
      offlineRegistrationId?: string;
    },
    operator?: string,
    tx?: Prisma.TransactionClient
  ): Promise<RentalFundingEvent> {
    const reason = input.reason?.trim();
    if (!reason) throw new ConflictException("资金事件原因不能为空");
    const key = input.idempotencyKey?.trim();
    if (!key) throw new ConflictException("资金事件必须带幂等键");
    if (input.provider === "offline" && !tx) throw new ConflictException("线下确认必须与原登记在同一事务内提交");
    const run = async (tx: Prisma.TransactionClient) => {
      // 资金余额是事件流推导值。必须先锁住订单行，把同一订单的不同幂等键动作也串行化；
      // 否则两笔并发抵扣都可能读到同一个旧余额并同时成功。
      const order = await this.lockedOrderScope(tx, tenantId, workspaceId, orderId);
      assertActionApplies(input.instrument, input.action);
      const provider = input.provider ?? "mock";
      const externalReceipt = input.verifiedExternalReceipt === true;
      if (externalReceipt && (input.instrument !== "rental" || !["initiate", "refund"].includes(input.action)
        || !["alipay", "wechat_pay", "stripe"].includes(provider))) {
        throw new ConflictException("真实到账只能由已核验的支付平台登记原收退款");
      }
      if (provider === "offline") {
        const registration = input.offlineRegistrationId && await tx.rentalOfflinePaymentRegistration.findFirst({
          where: { id: input.offlineRegistrationId, tenantId, workspaceId, orderId, status: "pending" }
        });
        if (!registration || registration.instrument !== input.instrument || Number(registration.amount) !== input.amount
          || registration.paymentMethod !== input.paymentMethod || key !== `staff-offline:${registration.id}`
          || !["rental", "deposit"].includes(input.instrument) || !["initiate", "append"].includes(input.action)) {
          throw new ConflictException("线下实收必须沿原登记确认事务入账");
        }
      } else if (provider !== "mock" && !externalReceipt) {
        throw new ConflictException("真实资金必须提供原核验收据");
      }
      if (input.allowPartialInitiate && provider !== "offline") throw new ConflictException("部分线下收款必须来自原确认登记");
      const context = await this.loadBalanceContext(tx, tenantId, workspaceId, orderId, provider !== "mock");
      if (provider === "mock" && !context.simulationAllowed) {
        throw new ConflictException("模拟资金仅限纯演练订单，不能用于生产空间或抵消真实资金，请走原收退款流程");
      }
      const events = context.accountingEvents;

      // 命中既有同键事件即回放（重试/恢复）。来源不能跨模拟与实款借键。
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
        if (existing.provider !== provider || (existing.paymentMethod ?? undefined) !== input.paymentMethod) {
          throw new ConflictException("相同幂等键已用于不同来源的资金事件");
        }
        // 回调首次入账与幂等回放都必须核对真实金额；不能让同一键的不同金额
        // 命中已有 initiate 事件后直接当作成功。
        const explicitAmount = input.action !== "fail" && input.amount !== undefined;
        if (explicitAmount && Number(existing.amount) !== input.amount) {
          throw new ConflictException("相同幂等键已用于不同金额的资金事件");
        }
        return this.toEvent(existing);
      }

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
        effectiveAmount = externalReceipt || input.allowPartialInitiate
          ? Number(input.amount)
          : input.instrument === "rental"
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
        }
        if (!externalReceipt && !input.allowPartialInitiate && input.instrument === "rental" && input.amount !== undefined && Math.abs(Number(input.amount) - effectiveAmount) > 0.005) {
          throw new ConflictException("支付回调金额与当前订单待收金额不一致，请重新发起支付");
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
        // 已核验收退款按原操作如实入账；当前应收变化形成待退或待收，
        // 不能否定外部已发生事实。新申请仍由原支付退款入口核准额度。
        if (!externalReceipt && ["initiate", "append"].includes(input.action) && effectiveAmount > Math.max(0, due)) throw new ConflictException("收款不能超过订单及待补款续租应收");
        if (!externalReceipt && input.action === "refund" && effectiveAmount > Math.max(0, -payment.balance)) throw new ConflictException("退款不能超过已核准的待退金额，请先完成应收核减");
        balanceAfter = roundMoney(payment.collected - payment.refunded + (input.action === "refund" ? -effectiveAmount : input.action === "fail" ? 0 : effectiveAmount));
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
          provider,
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
