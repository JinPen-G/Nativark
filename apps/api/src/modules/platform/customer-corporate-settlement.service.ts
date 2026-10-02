import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type {
  CustomerCorporateCreditAccountSummary,
  CustomerCorporateCreditLedgerEntry,
  RecordCustomerCorporateCreditPaymentRequest
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";

type CreditDb = Prisma.TransactionClient | PrismaService;

type CreditOrder = {
  id: string;
  tenantId: string;
  workspaceId: string;
  membershipSnapshot: unknown;
  finalPayableAmount: Prisma.Decimal;
};

type CreditState = {
  reservedAmount: Prisma.Decimal;
  receivableAmount: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal("0.005");

/**
 * CORP-SETTLE-01A：企业授信与账期事实链。
 *
 * 企业授信不是“企业客户自动免付款”：只有订单快照明确记录企业同时是签约与付款
 * 主体，且该企业配置了非按单账期，才会在确认时占用额度。所有占用、释放、结算、
 * 回款都追加流水；当前余额只由流水聚合，避免直接改主档留下对不上的账。
 */
@Injectable()
export class CustomerCorporateSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): CreditDb {
    return tx ?? this.prisma;
  }

  private decimal(value: number | Prisma.Decimal | string) {
    return new Prisma.Decimal(value).toDecimalPlaces(2);
  }

  private number(value: Prisma.Decimal) {
    return Number(value.toDecimalPlaces(2).toString());
  }

  private assertReason(reason: string) {
    if (!reason?.trim()) throw new BadRequestException("授信账务原因不能为空");
    return reason.trim();
  }

  private corporatePayer(order: Pick<CreditOrder, "membershipSnapshot">) {
    const snapshot = order.membershipSnapshot;
    if (!snapshot || typeof snapshot !== "object") return undefined;
    const value = snapshot as Record<string, unknown>;
    if (value.enterpriseContractAndPayer !== true) return undefined;
    return typeof value.corporateCustomerId === "string" && value.corporateCustomerId.trim()
      ? value.corporateCustomerId
      : undefined;
  }

  private async order(
    tenantId: string,
    orderId: string,
    tx?: Prisma.TransactionClient
  ): Promise<CreditOrder> {
    const row = await this.db(tx).rentalOrder.findFirst({
      where: { tenantId, id: orderId },
      select: { id: true, tenantId: true, workspaceId: true, membershipSnapshot: true, finalPayableAmount: true }
    });
    if (!row) throw new NotFoundException("订单不存在或不属于当前租户");
    return row;
  }

  /** 账期月结/半月结订单绕过现金租金收款门禁；按单结算仍走普通收款。 */
  async requiresCreditSettlement(tenantId: string, orderId: string, tx?: Prisma.TransactionClient) {
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return false;
    const credit = await this.db(tx).customerCorporateCredit.findFirst({
      where: { tenantId, customerId },
      select: { billingCycle: true }
    });
    // 没有授信记录也返回 true，让确认事务给出“未配置授信”而不是静默切换成现金。
    return credit?.billingCycle !== "per_order";
  }

  private async lockCredit(tx: Prisma.TransactionClient, tenantId: string, customerId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
        FROM customer_corporate_credits
       WHERE tenantId = ${tenantId} AND customerId = ${customerId}
       FOR UPDATE
    `);
    if (!locked[0]) throw new ConflictException("企业尚未配置有效授信，不能使用账期结算");
    const credit = await tx.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
    if (!credit) throw new ConflictException("企业尚未配置有效授信，不能使用账期结算");
    return credit;
  }

  private async state(db: CreditDb, tenantId: string, customerId: string, orderId?: string): Promise<CreditState> {
    const aggregate = await db.customerCorporateCreditLedger.aggregate({
      where: { tenantId, customerId, ...(orderId ? { orderId } : {}) },
      _sum: { reservedDelta: true, receivableDelta: true }
    });
    return {
      reservedAmount: this.decimal(aggregate._sum.reservedDelta ?? ZERO),
      receivableAmount: this.decimal(aggregate._sum.receivableDelta ?? ZERO)
    };
  }

  private toLedger(row: {
    id: string;
    tenantId: string;
    customerId: string;
    workspaceId: string | null;
    orderId: string | null;
    entryType: string;
    amount: Prisma.Decimal;
    reservedDelta: Prisma.Decimal;
    receivableDelta: Prisma.Decimal;
    reservedAfter: Prisma.Decimal;
    receivableAfter: Prisma.Decimal;
    currency: string;
    idempotencyKey: string;
    reason: string;
    operator: string | null;
    occurredAt: Date;
    createdAt: Date;
  }): CustomerCorporateCreditLedgerEntry {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      workspaceId: row.workspaceId ?? undefined,
      orderId: row.orderId ?? undefined,
      entryType: row.entryType as CustomerCorporateCreditLedgerEntry["entryType"],
      amount: this.number(row.amount),
      reservedDelta: this.number(row.reservedDelta),
      receivableDelta: this.number(row.receivableDelta),
      reservedAfter: this.number(row.reservedAfter),
      receivableAfter: this.number(row.receivableAfter),
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
      reason: row.reason,
      operator: row.operator ?? undefined,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }

  private async append(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      customerId: string;
      workspaceId?: string;
      orderId?: string;
      entryType: CustomerCorporateCreditLedgerEntry["entryType"];
      amount: Prisma.Decimal;
      reservedDelta: Prisma.Decimal;
      receivableDelta: Prisma.Decimal;
      currency?: string;
      idempotencyKey: string;
      reason: string;
      operator?: string;
    }
  ) {
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 191) throw new BadRequestException("授信账务幂等键必须为 1 至 191 个字符");
    const reason = this.assertReason(input.reason);
    const reservedDelta = this.decimal(input.reservedDelta);
    const receivableDelta = this.decimal(input.receivableDelta);
    const amount = this.decimal(input.amount);

    // 先锁主档，再查同一企业的流水。这样两个空间同时确认同一企业订单时，
    // 只有一个事务可以基于最新可用额度通过检查。
    const credit = await this.lockCredit(tx, input.tenantId, input.customerId);
    const existing = await tx.customerCorporateCreditLedger.findUnique({
      where: { tenantId_customerId_idempotencyKey: { tenantId: input.tenantId, customerId: input.customerId, idempotencyKey: key } }
    });
    if (existing) {
      if (
        existing.entryType !== input.entryType ||
        existing.orderId !== (input.orderId ?? null) ||
        !this.decimal(existing.amount).eq(amount) ||
        !this.decimal(existing.reservedDelta).eq(reservedDelta) ||
        !this.decimal(existing.receivableDelta).eq(receivableDelta)
      ) throw new ConflictException("相同授信账务幂等键已用于不同的业务事实");
      return this.toLedger(existing);
    }

    const current = await this.state(tx, input.tenantId, input.customerId);
    const reservedAfter = current.reservedAmount.plus(reservedDelta).toDecimalPlaces(2);
    const receivableAfter = current.receivableAmount.plus(receivableDelta).toDecimalPlaces(2);
    if (reservedAfter.lt(CENT.neg()) || receivableAfter.lt(CENT.neg())) {
      throw new ConflictException("授信账面不能出现负的占用或应收");
    }
    // 授信额度控制新的业务占用，不能拒绝记录已经产生的最终费用/债权。
    // 真实结算超额后 availableAmount 可以为负；下一笔 reserve 仍会被门禁拦截。
    const finalDebt = ["settle", "adjust"].includes(input.entryType) && reservedDelta.lte(ZERO);
    if (!finalDebt && reservedDelta.plus(receivableDelta).gt(CENT)
      && reservedAfter.plus(receivableAfter).gt(this.decimal(credit.creditLimit).plus(CENT))) {
      throw new ConflictException("企业可用授信额度不足");
    }

    const created = await tx.customerCorporateCreditLedger.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        customerId: input.customerId,
        workspaceId: input.workspaceId ?? null,
        orderId: input.orderId ?? null,
        entryType: input.entryType,
        amount,
        reservedDelta,
        receivableDelta,
        reservedAfter,
        receivableAfter,
        currency: input.currency ?? "CNY",
        idempotencyKey: key,
        reason,
        operator: input.operator ?? null
      }
    });
    return this.toLedger(created);
  }

  async reserveOrderCredit(
    tenantId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
    operator?: string
  ) {
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return undefined;
    const credit = await this.lockCredit(tx, tenantId, customerId);
    if (credit.status !== "active") throw new ConflictException("企业授信当前未启用，不能确认账期订单");
    if (credit.billingCycle === "per_order") throw new ConflictException("该企业授信配置为按单结算，不能走账期占用");
    const amount = this.decimal(Math.max(0, Number(order.finalPayableAmount)));
    if (amount.eq(ZERO)) return this.account(tenantId, customerId, tx);
    await this.append(tx, {
      tenantId,
      customerId,
      workspaceId: order.workspaceId,
      orderId,
      entryType: "reserve",
      amount,
      reservedDelta: amount,
      receivableDelta: ZERO,
      idempotencyKey: `order.credit.reserve:${orderId}`,
      reason: "订单确认占用企业授信额度",
      operator
    });
    return this.account(tenantId, customerId, tx);
  }

  async reserveExtensionCredit(
    tenantId: string,
    orderId: string,
    extensionId: string,
    amount: number,
    tx: Prisma.TransactionClient,
    operator?: string
  ) {
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return undefined;
    const credit = await this.lockCredit(tx, tenantId, customerId);
    if (credit.status !== "active" || credit.billingCycle === "per_order") {
      throw new ConflictException("企业授信当前不允许续租挂账");
    }
    const delta = this.decimal(amount);
    await this.append(tx, {
      tenantId,
      customerId,
      workspaceId: order.workspaceId,
      orderId,
      entryType: "reserve",
      amount: delta,
      reservedDelta: delta,
      receivableDelta: ZERO,
      idempotencyKey: `extension.credit.reserve:${extensionId}`,
      reason: "企业账期续租占用授信额度",
      operator
    });
    return this.account(tenantId, customerId, tx);
  }

  /** 取货后换货的正差额也必须先占用授信，否则归还结算时会出现账面应收大于已锁额度。 */
  async reserveOrderChangeCredit(
    tenantId: string,
    orderId: string,
    changeId: string,
    amount: number,
    tx: Prisma.TransactionClient,
    operator?: string
  ) {
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return undefined;
    const credit = await this.lockCredit(tx, tenantId, customerId);
    if (credit.status !== "active" || credit.billingCycle === "per_order") {
      throw new ConflictException("企业授信当前不允许挂账换货差额");
    }
    const delta = this.decimal(amount);
    await this.append(tx, {
      tenantId,
      customerId,
      workspaceId: order.workspaceId,
      orderId,
      entryType: "reserve",
      amount: delta,
      reservedDelta: delta,
      receivableDelta: ZERO,
      idempotencyKey: `order.change.credit.reserve:${changeId}`,
      reason: "取货后换货差额占用企业授信额度",
      operator
    });
    return this.account(tenantId, customerId, tx);
  }

  async assertReadyForPickup(tenantId: string, orderId: string, tx: Prisma.TransactionClient) {
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return;
    const state = await this.state(tx, tenantId, customerId, orderId);
    if (state.reservedAmount.lte(CENT.neg()) && state.receivableAmount.lte(CENT.neg())) {
      throw new ConflictException("账期订单尚未形成授信占用记录，不能领取");
    }
  }

  async releaseOrderCredit(tenantId: string, orderId: string, reason: string, tx: Prisma.TransactionClient, operator?: string) {
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return undefined;
    const orderState = await this.state(tx, tenantId, customerId, orderId);
    if (orderState.reservedAmount.lte(CENT.neg())) return this.account(tenantId, customerId, tx);
    await this.append(tx, {
      tenantId,
      customerId,
      workspaceId: order.workspaceId,
      orderId,
      entryType: "release",
      amount: orderState.reservedAmount,
      reservedDelta: orderState.reservedAmount.neg(),
      receivableDelta: ZERO,
      idempotencyKey: `order.credit.release:${orderId}`,
      reason,
      operator
    });
    return this.account(tenantId, customerId, tx);
  }

  /** 取消/爽约仍是一笔最终结算：取消费转应收，只有无债权的额度才能释放。 */
  async settleCancelledOrderCredit(tenantId: string, orderId: string, reason: string, tx: Prisma.TransactionClient, operator?: string) {
    if (await this.requiresCreditSettlement(tenantId, orderId, tx)) {
      return this.settleOrderCredit(tenantId, orderId, tx, operator);
    }
    return this.releaseOrderCredit(tenantId, orderId, reason, tx, operator);
  }

  async settleOrderCredit(tenantId: string, orderId: string, tx: Prisma.TransactionClient, operator?: string) {
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return undefined;
    await this.lockCredit(tx, tenantId, customerId);
    const rows = await tx.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId, orderId }, orderBy: { occurredAt: "asc" } });
    const reserved = this.decimal(rows.reduce((sum, row) => sum.plus(row.reservedDelta), ZERO));
    const receivable = this.decimal(rows.reduce((sum, row) => sum.plus(row.receivableDelta), ZERO));
    const payments = this.decimal(rows.filter((row) => ["payment", "payment_allocation"].includes(row.entryType)).reduce((sum, row) => sum.plus(row.receivableDelta.neg()), ZERO));
    const targetReceivable = this.decimal(Math.max(0, Number(order.finalPayableAmount) - this.number(payments)));
    if (receivable.gt(targetReceivable.plus(CENT))) {
      throw new ConflictException("订单最终应收低于已登记企业回款，请先处理退款或账务调整");
    }

    const alreadySettled = rows.some((row) => row.idempotencyKey === `order.credit.settle:${orderId}`);
    if (!alreadySettled) {
      const remainingTarget = targetReceivable.minus(receivable).toDecimalPlaces(2);
      const settleAmount = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(reserved, remainingTarget));
      const releaseAmount = reserved.minus(settleAmount).toDecimalPlaces(2);
      if (releaseAmount.gt(CENT)) {
        await this.append(tx, {
          tenantId,
          customerId,
          workspaceId: order.workspaceId,
          orderId,
          entryType: "release",
          amount: releaseAmount,
          reservedDelta: releaseAmount.neg(),
          receivableDelta: ZERO,
          idempotencyKey: `order.credit.settle.release:${orderId}`,
          reason: "订单结算时释放未形成应收的授信占用",
          operator
        });
      }
      if (settleAmount.gt(CENT)) {
        await this.append(tx, {
          tenantId,
          customerId,
          workspaceId: order.workspaceId,
          orderId,
          entryType: "settle",
          amount: settleAmount,
          reservedDelta: settleAmount.neg(),
          receivableDelta: settleAmount,
          idempotencyKey: `order.credit.settle:${orderId}`,
          reason: "订单结算转企业应收",
          operator
        });
      } else {
        // 零金额订单也要留一条幂等事实，避免结算重试反复重新计算。
        await this.append(tx, {
          tenantId,
          customerId,
          workspaceId: order.workspaceId,
          orderId,
          entryType: "settle",
          amount: ZERO,
          reservedDelta: ZERO,
          receivableDelta: ZERO,
          idempotencyKey: `order.credit.settle:${orderId}`,
          reason: "订单结算完成，无需形成企业应收",
          operator
        });
      }
      const afterSettle = await this.state(tx, tenantId, customerId, orderId);
      const adjustment = targetReceivable.minus(afterSettle.receivableAmount).toDecimalPlaces(2);
      if (adjustment.gt(CENT)) {
        await this.append(tx, {
          tenantId,
          customerId,
          workspaceId: order.workspaceId,
          orderId,
          entryType: "adjust",
          amount: adjustment,
          reservedDelta: ZERO,
          receivableDelta: adjustment,
          idempotencyKey: `order.credit.settle.adjust:${orderId}`,
          reason: "订单结算补记最终企业应收差额",
          operator
        });
      }
    }
    return this.account(tenantId, customerId, tx);
  }

  async account(tenantId: string, customerId: string, tx?: Prisma.TransactionClient): Promise<CustomerCorporateCreditAccountSummary> {
    const db = this.db(tx);
    const credit = await db.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
    if (!credit) throw new NotFoundException("企业尚未配置授信");
    const current = await this.state(db, tenantId, customerId);
    const creditLimit = this.decimal(credit.creditLimit);
    return {
      tenantId,
      customerId,
      creditLimit: this.number(creditLimit),
      reservedAmount: this.number(current.reservedAmount),
      receivableAmount: this.number(current.receivableAmount),
      availableAmount: this.number(creditLimit.minus(current.reservedAmount).minus(current.receivableAmount)),
      currency: "CNY",
      status: credit.status as CustomerCorporateCreditAccountSummary["status"],
      billingCycle: credit.billingCycle as CustomerCorporateCreditAccountSummary["billingCycle"],
      settlementTermDays: credit.settlementTermDays
    };
  }

  async listLedger(tenantId: string, customerId: string) {
    const rows = await this.prisma.customerCorporateCreditLedger.findMany({
      where: { tenantId, customerId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toLedger(row));
  }

  async recordPayment(
    tenantId: string,
    customerId: string,
    input: RecordCustomerCorporateCreditPaymentRequest,
    operator?: string
  ) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new BadRequestException("回款金额必须大于 0");
    if (input.currency && input.currency !== "CNY") throw new BadRequestException("企业授信首期只支持 CNY 回款");
    const result = await this.prisma.$transaction(async (tx) => {
      const credit = await this.lockCredit(tx, tenantId, customerId);
      const existing = await tx.customerCorporateCreditLedger.findUnique({
        where: {
          tenantId_customerId_idempotencyKey: {
            tenantId,
            customerId,
            idempotencyKey: input.idempotencyKey.trim()
          }
        }
      });
      if (existing) {
        if (existing.entryType !== "payment" || !this.decimal(existing.amount).eq(this.decimal(input.amount))
          || existing.reason !== input.reason.trim() || existing.currency !== (input.currency ?? "CNY")) {
          throw new ConflictException("相同授信回款幂等键已用于不同的业务事实");
        }
        return this.account(tenantId, customerId, tx);
      }
      const current = await this.state(tx, tenantId, customerId);
      const amount = this.decimal(input.amount);
      if (current.receivableAmount.lt(amount.minus(CENT))) throw new ConflictException("回款不能超过企业当前应收");
      // 一条总回款事实 + 多条逐单核销事实；总回款本身不再扣余额，防止重复记账。
      // 对已形成应收的订单按首次入账顺序核销，旧的无订单应收明确留为 legacy，
      // 不凭空归给当前经营空间或某一订单。
      const rows = await tx.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId }, orderBy: { occurredAt: "asc" } });
      const debts = new Map<string, { workspaceId: string | undefined; amount: Prisma.Decimal }>();
      for (const row of rows) {
        if (!row.orderId) continue;
        const debt = debts.get(row.orderId) ?? { workspaceId: row.workspaceId ?? undefined, amount: ZERO };
        debt.amount = debt.amount.plus(row.receivableDelta);
        debts.set(row.orderId, debt);
      }
      await this.append(tx, {
        tenantId,
        customerId,
        entryType: "payment",
        amount,
        reservedDelta: ZERO,
        receivableDelta: ZERO,
        currency: input.currency ?? "CNY",
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        operator
      });
      let remaining = amount;
      for (const [orderId, debt] of debts) {
        if (remaining.lte(CENT)) break;
        const applied = Prisma.Decimal.min(remaining, Prisma.Decimal.max(ZERO, debt.amount)).toDecimalPlaces(2);
        if (applied.lte(CENT)) continue;
        await this.append(tx, {
          tenantId, customerId, orderId, workspaceId: debt.workspaceId,
          entryType: "payment_allocation", amount: applied, reservedDelta: ZERO, receivableDelta: applied.neg(),
          currency: input.currency ?? "CNY",
          idempotencyKey: `payment.allocation:${createHash("sha256").update(`${input.idempotencyKey}:${orderId}`).digest("hex")}`,
          reason: `${input.reason.trim()}（逐单核销）`, operator
        });
        remaining = remaining.minus(applied);
      }
      if (remaining.gt(CENT)) {
        await this.append(tx, {
          tenantId, customerId, entryType: "payment_allocation", amount: remaining,
          reservedDelta: ZERO, receivableDelta: remaining.neg(), currency: input.currency ?? "CNY",
          idempotencyKey: `payment.legacy:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`,
          reason: `${input.reason.trim()}（核销未关联订单的历史应收）`, operator
        });
      }
      void credit;
      return this.account(tenantId, customerId, tx);
    });
    return result;
  }
}
