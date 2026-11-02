import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { lockRentalBusinessTenant } from "../rental-core/rental-business-fence";
import type {
  CustomerCorporateCreditAccountSummary,
  CustomerCorporateCreditLedgerEntry,
  CustomerCorporateCreditMaturityReceipt,
  RentalMembershipSnapshot,
  RecordCustomerCorporateCreditMaturityRequest,
  RecordCustomerCorporateCreditPaymentRequest
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";

type CreditDb = Prisma.TransactionClient | PrismaService;

type CreditOrder = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: string;
  currency: string;
  contractSubjectCustomerId: string | null;
  payerSubjectCustomerId: string | null;
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
 * 企业授信不是“企业客户自动免付款”：确认事务冻结订单结算方式与企业付款主体，
 * 当前主档只决定新占用准入，不能转换旧单。缺快照旧单仅沿原账核对；原实收从可信
 * 资金口径扣除。所有占用、释放、结算、回款都追加流水，不重建支付或资金账本。
 */
@Injectable()
export class CustomerCorporateSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly funding?: RentalFundingService
  ) {}

  private readonly maturityAction = "corporate.credit.maturity";

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
      select: { id: true, tenantId: true, workspaceId: true, status: true, currency: true,
        contractSubjectCustomerId: true, payerSubjectCustomerId: true, membershipSnapshot: true, finalPayableAmount: true }
    });
    if (!row) throw new NotFoundException("订单不存在或不属于当前租户");
    return row;
  }

  private confirmedSettlement(order: CreditOrder): RentalMembershipSnapshot["settlement"] {
    const membership = order.membershipSnapshot as Record<string, unknown> | null;
    const value = membership?.settlement;
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("订单结算依据无效，须核对原确认记录");
    const settlement = value as NonNullable<RentalMembershipSnapshot["settlement"]>;
    const customerId = this.corporatePayer(order);
    if (!customerId || settlement.payerCustomerId !== customerId || settlement.currency !== order.currency
      || (order.payerSubjectCustomerId && order.payerSubjectCustomerId !== customerId)
      || (order.contractSubjectCustomerId && order.contractSubjectCustomerId !== customerId)
      || !["per_order", "credit"].includes(settlement.mode)
      || !["per_order", "monthly", "semi_monthly"].includes(settlement.billingCycle)
      || (settlement.mode === "per_order") !== (settlement.billingCycle === "per_order")
      || !Number.isFinite(Date.parse(settlement.confirmedAt))
      || (settlement.mode === "credit" && (!settlement.creditId || !Number.isInteger(settlement.creditRevision) || settlement.creditRevision! < 1))) {
      throw new ConflictException("订单结算方式、付款主体或币种与原确认依据不匹配");
    }
    return settlement;
  }

  /** 由持有订单行锁的确认事务调用；不能在领取或结算时用当前主档补造旧单。 */
  async freezeOrderSettlement(tenantId: string, orderId: string, tx: Prisma.TransactionClient) {
    await lockRentalBusinessTenant(tx, tenantId);
    const order = await this.order(tenantId, orderId, tx);
    const customerId = this.corporatePayer(order);
    if (!customerId) return false;
    const existing = this.confirmedSettlement(order);
    if (existing) {
      if (existing.mode === "credit") this.assertCreditCurrency(order.currency);
      return existing.mode === "credit";
    }
    if (order.status.toLowerCase() !== "draft") throw new ConflictException("旧订单缺少结算快照，须核对原账，不能重新选择结算方式");
    // 预付企业无需虚构授信；这里只为新的草稿确认读取并冻结当前选择。
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM customer_corporate_credits WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE
    `);
    const credit = await tx.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
    const billingCycle = credit?.billingCycle ?? "per_order";
    if (!["per_order", "monthly", "semi_monthly"].includes(billingCycle)) throw new ConflictException("企业账期配置无效");
    const mode = billingCycle === "per_order" ? "per_order" as const : "credit" as const;
    if (mode === "credit") {
      this.assertCreditCurrency(order.currency);
      if (credit?.status !== "active") throw new ConflictException("企业授信当前未启用，不能确认账期订单");
    }
    const settlement: NonNullable<RentalMembershipSnapshot["settlement"]> = {
      mode, payerCustomerId: customerId, currency: order.currency,
      billingCycle: billingCycle as NonNullable<RentalMembershipSnapshot["settlement"]>["billingCycle"],
      ...(credit ? { creditId: credit.id, creditRevision: credit.revision } : {}), confirmedAt: new Date().toISOString()
    };
    this.confirmedSettlement({ ...order, membershipSnapshot: { ...(order.membershipSnapshot as Prisma.InputJsonObject), settlement } });
    const updated = await tx.rentalOrder.updateMany({
      where: { id: orderId, tenantId, workspaceId: order.workspaceId, status: "DRAFT",
        membershipSnapshot: { equals: order.membershipSnapshot as Prisma.InputJsonValue } },
      data: { membershipSnapshot: { ...(order.membershipSnapshot as Prisma.InputJsonObject), settlement } }
    });
    if (updated.count !== 1) throw new ConflictException("订单确认依据已变化，请核对原订单");
    return mode === "credit";
  }

  private async cashPaid(order: CreditOrder, tx?: Prisma.TransactionClient) {
    if (!this.funding) throw new ConflictException("无法核对订单原实收，不能判断企业付款责任");
    const balance = await this.funding.listEvents(order.tenantId, order.workspaceId, order.id, tx, { realOnly: true });
    return this.decimal(balance.rental.collected - balance.rental.refunded + balance.rental.securityCaptured);
  }

  private async usesOrderCredit(order: CreditOrder, tx?: Prisma.TransactionClient): Promise<boolean> {
    const customerId = this.corporatePayer(order);
    if (!customerId) return false;
    const settlement = this.confirmedSettlement(order);
    if (settlement) return settlement.mode === "credit";
    // 旧单仅从原占用/债权识别账期；当前主档或不存在的流水都不能授权跳过现金门。
    const rows = await this.db(tx).customerCorporateCreditLedger.findMany({
      where: { tenantId: order.tenantId, customerId, orderId: order.id, workspaceId: order.workspaceId }
    });
    if (rows.some(row => ["reserve", "settle", "adjust"].includes(row.entryType))) return true;
    if (order.finalPayableAmount.lte(ZERO) || (await this.cashPaid(order, tx)).gte(order.finalPayableAmount.minus(CENT))) return false;
    throw new ConflictException("旧企业订单缺少结算快照及有效占用/付款依据，须核对原账");
  }

  /** 只消费本单确认依据/原账，主档账期调整不转换历史订单。 */
  async requiresCreditSettlement(tenantId: string, orderId: string, tx?: Prisma.TransactionClient) {
    return this.usesOrderCredit(await this.order(tenantId, orderId, tx), tx);
  }

  async allowsExtensionCredit(tenantId: string, orderId: string, tx?: Prisma.TransactionClient) {
    const order = await this.order(tenantId, orderId, tx);
    if (!await this.usesOrderCredit(order, tx)) return false;
    this.assertCreditCurrency(order.currency);
    const credit = await this.db(tx).customerCorporateCredit.findFirst({ where: { tenantId, customerId: this.corporatePayer(order)! } });
    if (!credit || credit.status !== "active" || credit.billingCycle === "per_order") {
      throw new ConflictException("企业授信当前不允许新增挂账，原订单结算方式保持不变");
    }
    await this.assertMaturityReady(this.db(tx), tenantId, this.corporatePayer(order)!);
    return true;
  }

  private assertCreditCurrency(currency: string) {
    if (currency !== "CNY") throw new ConflictException("企业授信首期只支持 CNY，不能将其他币种改标人民币挂账");
  }

  /** 报价仅检查新账期候选；确认仍在原订单事务内复核，不将报价当授信占用。 */
  async assertQuoteCreditCurrency(tenantId: string, membership: RentalMembershipSnapshot, currency: string) {
    const customerId = this.corporatePayer({ membershipSnapshot: membership });
    if (!customerId) return;
    const credit = await this.prisma.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
    if (credit && credit.billingCycle !== "per_order") {
      this.assertCreditCurrency(currency);
      await this.assertMaturityReady(this.prisma, tenantId, customerId);
    }
  }

  private async lockCredit(tx: Prisma.TransactionClient, tenantId: string, customerId: string) {
    await lockRentalBusinessTenant(tx, tenantId);
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
    const currencies = await db.customerCorporateCreditLedger.findMany({
      where: { tenantId, customerId, ...(orderId ? { orderId } : {}), currency: { not: "CNY" } },
      select: { currency: true }, take: 1
    });
    if (currencies.length) throw new ConflictException("企业原账包含非 CNY 币种，须按原币种核对，不能合计为人民币");
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
      currency: string;
      idempotencyKey: string;
      reason: string;
      operator?: string;
    }
  ) {
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 191) throw new BadRequestException("授信账务幂等键必须为 1 至 191 个字符");
    const reason = this.assertReason(input.reason);
    if (!input.currency?.trim()) throw new BadRequestException("授信账务必须携带原币种");
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
        existing.currency !== input.currency ||
        !this.decimal(existing.amount).eq(amount) ||
        !this.decimal(existing.reservedDelta).eq(reservedDelta) ||
        !this.decimal(existing.receivableDelta).eq(receivableDelta)
      ) throw new ConflictException("相同授信账务幂等键已用于不同的业务事实");
      return this.toLedger(existing);
    }

    this.assertCreditCurrency(input.currency);
    if (input.entryType === "reserve" && reservedDelta.gt(ZERO)) await this.assertMaturityReady(tx, input.tenantId, input.customerId);
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
        currency: input.currency,
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
    if (!customerId || !await this.usesOrderCredit(order, tx)) return undefined;
    this.assertCreditCurrency(order.currency);
    const credit = await this.lockCredit(tx, tenantId, customerId);
    if (credit.status !== "active") throw new ConflictException("企业授信当前未启用，不能确认账期订单");
    if (credit.billingCycle === "per_order") throw new ConflictException("该企业授信配置为按单结算，不能走账期占用");
    const amount = Prisma.Decimal.max(ZERO, order.finalPayableAmount.minus(await this.cashPaid(order, tx))).toDecimalPlaces(2);
    if (amount.eq(ZERO)) return this.account(tenantId, customerId, tx);
    await this.append(tx, {
      tenantId,
      customerId,
      workspaceId: order.workspaceId,
      orderId,
      currency: order.currency,
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
    if (!customerId || !await this.usesOrderCredit(order, tx)) return undefined;
    this.assertCreditCurrency(order.currency);
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
      currency: order.currency,
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
    if (!customerId || !await this.usesOrderCredit(order, tx)) return undefined;
    this.assertCreditCurrency(order.currency);
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
      currency: order.currency,
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
    if (!customerId || !await this.usesOrderCredit(order, tx)) return;
    const state = await this.state(tx, tenantId, customerId, orderId);
    const rows = await tx.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId, orderId } });
    const payments = rows.filter(row => ["payment", "payment_allocation"].includes(row.entryType))
      .reduce((sum, row) => sum.minus(row.receivableDelta), ZERO);
    const required = Prisma.Decimal.max(ZERO, order.finalPayableAmount.minus(await this.cashPaid(order, tx)).minus(payments));
    if (required.gt(ZERO) && state.reservedAmount.plus(state.receivableAmount).lt(required.minus(CENT))) {
      throw new ConflictException("账期订单尚未形成足额有效授信占用或付款记录，不能领取");
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
      currency: order.currency,
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
    if (!customerId || !await this.usesOrderCredit(order, tx)) return undefined;
    await this.lockCredit(tx, tenantId, customerId);
    const rows = await tx.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId, orderId }, orderBy: { occurredAt: "asc" } });
    const reserved = this.decimal(rows.reduce((sum, row) => sum.plus(row.reservedDelta), ZERO));
    const receivable = this.decimal(rows.reduce((sum, row) => sum.plus(row.receivableDelta), ZERO));
    const payments = this.decimal(rows.filter((row) => ["payment", "payment_allocation"].includes(row.entryType)).reduce((sum, row) => sum.plus(row.receivableDelta.neg()), ZERO));
    const targetReceivable = Prisma.Decimal.max(ZERO, order.finalPayableAmount.minus(payments).minus(await this.cashPaid(order, tx))).toDecimalPlaces(2);
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
          currency: order.currency,
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
          currency: order.currency,
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
          currency: order.currency,
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
          currency: order.currency,
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

  private maturityId(tenantId: string, customerId: string, ledgerId: string) {
    return createHash("sha256").update(JSON.stringify([this.maturityAction, tenantId, customerId, ledgerId])).digest("hex");
  }

  private maturityReceipt(log: { tenantId: string; workspaceId: string | null; rentalOrderId: string | null; action: string; detail: unknown },
    ledger: { id: string; tenantId: string; customerId: string; workspaceId: string | null; orderId: string | null; currency: string; receivableDelta: Prisma.Decimal }): CustomerCorporateCreditMaturityReceipt {
    const detail = log.detail as Record<string, unknown> | null;
    if (log.action !== this.maturityAction || log.tenantId !== ledger.tenantId || log.workspaceId !== ledger.workspaceId
      || log.rentalOrderId !== ledger.orderId || detail?.ledgerId !== ledger.id || detail.customerId !== ledger.customerId
      || detail.currency !== ledger.currency || detail.amount !== ledger.receivableDelta.toFixed(2)
      || typeof detail.dueAt !== "string" || !Number.isFinite(Date.parse(detail.dueAt))
      || typeof detail.basisRef !== "string" || !detail.basisRef || typeof detail.reason !== "string" || !detail.reason
      || typeof detail.idempotencyKey !== "string" || !detail.idempotencyKey
      || typeof detail.recordedBy !== "string" || !detail.recordedBy || typeof detail.recordedAt !== "string"
      || !Number.isFinite(Date.parse(detail.recordedAt)) || !ledger.orderId) {
      throw new ConflictException("债权到期依据与原账不匹配，须财务核对");
    }
    return { ledgerId: ledger.id, orderId: ledger.orderId, currency: ledger.currency, dueAt: detail.dueAt,
      basisRef: detail.basisRef, reason: detail.reason, idempotencyKey: detail.idempotencyKey,
      recordedBy: detail.recordedBy, recordedAt: detail.recordedAt };
  }

  /** Explicit financial decision, stored in the original audit table under the credit row lock.
   * One immutable receipt per positive debt entry; a different date/key cannot silently extend it. */
  async recordMaturity(tenantId: string, customerId: string, input: RecordCustomerCorporateCreditMaturityRequest,
    actorId: string, workspaceId: string): Promise<CustomerCorporateCreditMaturityReceipt> {
    input = structuredClone(input);
    const dueAt = new Date(input.dueAt);
    if (!actorId || !workspaceId || !Number.isFinite(dueAt.getTime()) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(input.dueAt)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(input.ledgerId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(input.basisRef)
      || !input.idempotencyKey?.trim() || input.idempotencyKey.length > 191 || !input.reason?.trim() || input.reason.length > 500) {
      throw new BadRequestException("债权到期登记须提供原流水、带时区的到期日、合同/账单引用、原因与原操作键");
    }
    return this.prisma.$transaction(async tx => {
      await this.lockCredit(tx, tenantId, customerId);
      const ledger = await tx.customerCorporateCreditLedger.findFirst({ where: { id: input.ledgerId, tenantId, customerId, workspaceId } });
      if (!ledger || !ledger.orderId || !["settle", "adjust"].includes(ledger.entryType) || !ledger.receivableDelta.gt(ZERO)) {
        throw new ConflictException("只能登记当前企业与空间的原正金额债权到期日");
      }
      this.assertCreditCurrency(ledger.currency);
      const id = this.maturityId(tenantId, customerId, ledger.id);
      const original = await tx.operationLog.findUnique({ where: { id } });
      if (original) {
        const receipt = this.maturityReceipt(original, ledger);
        if (receipt.dueAt !== dueAt.toISOString() || receipt.basisRef !== input.basisRef
          || receipt.reason !== input.reason.trim() || receipt.idempotencyKey !== input.idempotencyKey.trim()
          || receipt.recordedBy !== actorId) throw new ConflictException("原债权到期日已核定，不能用另一操作覆盖");
        return receipt;
      }
      const reused = await tx.operationLog.findFirst({ where: { tenantId, action: this.maturityAction,
        AND: [{ detail: { path: "$.customerId", equals: customerId } },
          { detail: { path: "$.idempotencyKey", equals: input.idempotencyKey.trim() } }] }, select: { id: true } });
      if (reused) throw new ConflictException("到期登记原操作键已用于另一笔债权");
      const receipt: CustomerCorporateCreditMaturityReceipt = { ledgerId: ledger.id, orderId: ledger.orderId,
        currency: ledger.currency, dueAt: dueAt.toISOString(), basisRef: input.basisRef, reason: input.reason.trim(),
        idempotencyKey: input.idempotencyKey.trim(), recordedBy: actorId, recordedAt: new Date().toISOString() };
      await tx.operationLog.create({ data: { id, tenantId, workspaceId, rentalOrderId: ledger.orderId, userId: actorId,
        action: this.maturityAction, detail: { ...receipt, customerId, amount: ledger.receivableDelta.toFixed(2) } } });
      return receipt;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async readMaturity(tenantId: string, customerId: string, ledgerId: string, workspaceId: string) {
    const ledger = await this.prisma.customerCorporateCreditLedger.findFirst({ where: { id: ledgerId, tenantId, customerId, workspaceId } });
    if (!ledger) throw new NotFoundException("原债权不存在或不属于当前企业与空间");
    const log = await this.prisma.operationLog.findUnique({ where: { id: this.maturityId(tenantId, customerId, ledgerId) } });
    return log ? this.maturityReceipt(log, ledger) : null;
  }

  /** New credit only. Debt settlement/payment never uses this gate. */
  private async assertMaturityReady(db: CreditDb, tenantId: string, customerId: string) {
    const rows = await db.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 501 });
    if (rows.length > 500) throw new ConflictException("企业债权核对超过本次安全窗口，须财务核对后再新增挂账");
    const debts = new Map<string | null, { entries: Array<{ row: typeof rows[number]; remaining: Prisma.Decimal }>; paid: Prisma.Decimal }>();
    for (const row of rows) {
      this.assertCreditCurrency(row.currency);
      const bucket = debts.get(row.orderId) ?? { entries: [], paid: ZERO };
      if (row.receivableDelta.gt(ZERO)) bucket.entries.push({ row, remaining: row.receivableDelta });
      else if (row.receivableDelta.lt(ZERO)) bucket.paid = bucket.paid.minus(row.receivableDelta);
      debts.set(row.orderId, bucket);
    }
    // Original per-order allocations extinguish oldest debt first. Aggregate
    // reductions before applying them so equal timestamps cannot invert a payment and debt.
    for (const bucket of debts.values()) {
      for (const debt of bucket.entries) {
        const applied = Prisma.Decimal.min(debt.remaining, bucket.paid);
        debt.remaining = debt.remaining.minus(applied); bucket.paid = bucket.paid.minus(applied);
      }
      if (bucket.paid.gt(CENT)) throw new ConflictException("企业原核销与债权不匹配，须财务核对");
    }
    const now = Date.now();
    for (const bucket of debts.values()) for (const debt of bucket.entries) {
      if (debt.remaining.lte(CENT)) continue;
      const log = await db.operationLog.findUnique({ where: { id: this.maturityId(tenantId, customerId, debt.row.id) } });
      if (!log) throw new ConflictException("企业尚有未核定到期日的债权，不能新增挂账");
      const receipt = this.maturityReceipt(log, debt.row);
      if (Date.parse(receipt.dueAt) <= now) throw new ConflictException("企业存在已到期未偿债权，不能新增挂账");
    }
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
