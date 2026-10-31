import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { RentalFundingEvent } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { rentalPaymentBalance } from "./rental-funding-events";
import { confirmedCorporateSettlement } from "./rental-corporate-settlement-basis";

/** Bridges original cash events and corporate allocation receipts, not a second
 * money ledger or payment dispatcher. Cash remains cash; an allocation settles
 * receivables only once and must reconcile to its original aggregate payment. */
@Injectable()
export class RentalOrderReceivableRepository {
  constructor(private readonly prisma: PrismaService) {}

  private payer(order: { membershipSnapshot?: unknown; payerSubjectCustomerId?: string | null; contractSubjectCustomerId?: string | null; currency?: string }) {
    const snapshot = order.membershipSnapshot as Record<string, unknown> | null | undefined;
    if (snapshot?.enterpriseContractAndPayer !== true) return undefined;
    const payer = snapshot.corporateCustomerId;
    if (typeof payer !== "string" || !payer.trim() || order.payerSubjectCustomerId && order.payerSubjectCustomerId !== payer
      || order.contractSubjectCustomerId && order.contractSubjectCustomerId !== payer) {
      throw new ConflictException("企业付款主体不可核实");
    }
    return payer;
  }

  private async ledgerRows(tenantId: string, customerId: string, tx?: Prisma.TransactionClient) {
    const rows = tx
      ? await tx.$queryRaw<Prisma.CustomerCorporateCreditLedgerGetPayload<object>[]>(Prisma.sql`
          SELECT * FROM customer_corporate_credit_ledger WHERE tenantId = ${tenantId} AND customerId = ${customerId}
          ORDER BY id LIMIT 501 LOCK IN SHARE MODE`)
      : await this.prisma.customerCorporateCreditLedger.findMany({ where: { tenantId, customerId }, orderBy: { id: "asc" }, take: 501 });
    if (rows.length > 500 || rows.some(row => row.tenantId !== tenantId || row.customerId !== customerId)
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException("企业原回款核对超过安全窗口或来源不一致，须财务核对");
    return rows;
  }

  async corporatePaid(tenantId: string, workspaceId: string, orderId: string,
    order: { membershipSnapshot?: unknown; payerSubjectCustomerId?: string | null; contractSubjectCustomerId?: string | null; currency?: string }, tx?: Prisma.TransactionClient) {
    const customerId = this.payer(order);
    if (!customerId) return 0;
    const settlement = confirmedCorporateSettlement(order);
    const credit = tx
      ? (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM customer_corporate_credits
          WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE`))[0]
      : await this.prisma.customerCorporateCredit.findFirst({ where: { tenantId, customerId }, select: { id: true } });
    const rows = await this.ledgerRows(tenantId, customerId, tx);
    if (rows.some(row => row.orderId === orderId) && !credit) throw new ConflictException("企业原授信账户缺失，须财务核对原账");
    const paid = this.paidFromRows(workspaceId, orderId, order.currency, rows);
    if (settlement?.mode === "per_order" && rows.some(row => row.orderId === orderId)) {
      throw new ConflictException("原按单订单与企业债权冲突，须财务核对");
    }
    return paid;
  }

  private paidFromRows(workspaceId: string, orderId: string, currency: string | undefined,
    rows: Prisma.CustomerCorporateCreditLedgerGetPayload<object>[]) {
    const paidRows = rows.filter(row => row.orderId === orderId && ["payment", "payment_allocation"].includes(row.entryType));
    let paid = new Prisma.Decimal(0);
    for (const allocation of paidRows) {
      if (allocation.entryType !== "payment_allocation" || allocation.workspaceId !== workspaceId
        || allocation.currency !== currency || allocation.amount.lte(0) || !allocation.reservedDelta.eq(0)
        || !allocation.receivableDelta.eq(allocation.amount.neg())) throw new ConflictException("企业逐单核销来源不一致，须财务核对原回款");
      const parents = rows.filter(row => row.entryType === "payment" && row.orderId === null &&
        allocation.idempotencyKey === `payment.allocation:${createHash("sha256").update(`${row.idempotencyKey}:${orderId}`).digest("hex")}`);
      if (parents.length !== 1) throw new ConflictException("企业核销缺少唯一原回款，不能当作订单已付");
      const parent = parents[0];
      const legs = rows.filter(row => row.entryType === "payment_allocation" && row.idempotencyKey === (row.orderId
        ? `payment.allocation:${createHash("sha256").update(`${parent.idempotencyKey}:${row.orderId}`).digest("hex")}`
        : `payment.legacy:${createHash("sha256").update(parent.idempotencyKey).digest("hex")}`));
      if (parent.workspaceId !== null || parent.currency !== currency || parent.amount.lte(0)
        || !parent.reservedDelta.eq(0) || !parent.receivableDelta.eq(0)
        || legs.some(row => row.currency !== parent.currency || row.orderId && !row.workspaceId
          || row.amount.lte(0) || !row.reservedDelta.eq(0) || !row.receivableDelta.eq(row.amount.neg()))
        || !legs.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).eq(parent.amount)) {
        throw new ConflictException("企业原回款与全部核销金额不一致，不能重复计入订单实收");
      }
      paid = paid.plus(allocation.amount);
    }
    return Number(paid.toFixed(2));
  }

  /** Called only after a new cash event is persisted in the SAME order-locked
   * transaction. No scanning/repair of old cash or rewriting old debt receipts. */
  async reconcileCash(tenantId: string, workspaceId: string, orderId: string, event: RentalFundingEvent,
    events: readonly RentalFundingEvent[], tx: Prisma.TransactionClient) {
    const order = (await tx.$queryRaw<Array<{ membershipSnapshot: unknown; payerSubjectCustomerId: string | null;
      contractSubjectCustomerId: string | null; currency: string; finalPayableAmount: Prisma.Decimal }>>(Prisma.sql`
        SELECT membershipSnapshot, payerSubjectCustomerId, contractSubjectCustomerId, currency, finalPayableAmount
        FROM rental_orders WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND id = ${orderId} FOR UPDATE`))[0];
    if (!order) throw new ConflictException("资金核销缺少原订单");
    const customerId = this.payer(order);
    if (!customerId) return;
    const settlement = confirmedCorporateSettlement(order);
    const credit = (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM customer_corporate_credits
      WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE`))[0];
    const allRows = await this.ledgerRows(tenantId, customerId, tx);
    const rows = allRows.filter(row => row.orderId === orderId);
    if (!rows.length) {
      if (!settlement || settlement.mode === "per_order") return;
      if (settlement.mode !== "credit") throw new ConflictException("原订单结算方式缺失，不能猜测企业债权");
    }
    if (settlement?.mode === "per_order" && rows.some(row => row.reservedDelta.gt(0) || row.receivableDelta.gt(0))) {
      throw new ConflictException("原按单订单与企业债权冲突，须财务核对");
    }
    if (order.currency !== "CNY" || rows.some(row => row.workspaceId !== workspaceId || row.currency !== order.currency)) {
      throw new ConflictException("企业原订单债权空间或币种不一致");
    }
    if (event.tenantId !== tenantId || event.workspaceId !== workspaceId || event.orderId !== orderId || event.provider === "mock"
      || !(event.instrument === "rental" && ["initiate", "append", "refund"].includes(event.action)
        || event.instrument !== "rental" && event.action === "capture")) throw new ConflictException("企业核销必须来自本单真实资金变动");
    if (!credit) throw new ConflictException("企业原授信账户缺失，原资金保持待入账核对");
    const key = `order.cash.reconcile:${createHash("sha256").update(`${orderId}:${event.id}`).digest("hex")}`;
    const existing = await tx.customerCorporateCreditLedger.findUnique({ where: {
      tenantId_customerId_idempotencyKey: { tenantId, customerId, idempotencyKey: key } } });
    if (existing) throw new ConflictException("新的资金事件已关联核销收据，拒绝重复写入");
    const corporatePaid = new Prisma.Decimal(this.paidFromRows(workspaceId, orderId, order.currency, allRows));
    if (events.filter(row => row.id === event.id).length !== 1
      || events.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.orderId !== orderId || row.provider === "mock")) {
      throw new ConflictException("企业资金核销缺少完整的本单实款来源");
    }
    const cash = new Prisma.Decimal(-rentalPaymentBalance(0, events).balance);
    const previousCash = new Prisma.Decimal(-rentalPaymentBalance(0, events.filter(row => row.id !== event.id)).balance);
    const receivable = rows.reduce((sum, row) => sum.plus(row.receivableDelta), new Prisma.Decimal(0));
    if (receivable.lt(0)) throw new ConflictException("企业原订单债权已为负，须财务核对");
    const settlementRows = rows.filter(row => row.idempotencyKey === `order.credit.settle:${orderId}`);
    if (settlementRows.length > 1 || !settlementRows.length && rows.some(row => row.entryType === "settle" || !row.receivableDelta.eq(0))
      || settlementRows.some(row => row.entryType !== "settle" || row.amount.lt(0)
        || !row.receivableDelta.eq(row.amount) || !row.reservedDelta.eq(row.amount.neg()))) {
      throw new ConflictException("企业原结算收据不一致，不能以资金到账修补历史账");
    }
    // Only this new cash movement changes debt. A pre-existing discrepancy must
    // not be silently repaired, and a refund never creates pre-settlement debt.
    const beforeTarget = Prisma.Decimal.max(0, order.finalPayableAmount.minus(previousCash).minus(corporatePaid)).toDecimalPlaces(2);
    const target = Prisma.Decimal.max(0, order.finalPayableAmount.minus(cash).minus(corporatePaid)).toDecimalPlaces(2);
    if (settlementRows.length && !receivable.eq(beforeTarget)) {
      throw new ConflictException("企业原债权与到账前实收不一致，原资金保持待核对");
    }
    const delta = settlementRows.length ? target.minus(beforeTarget).toDecimalPlaces(2) : new Prisma.Decimal(0);
    if (allRows.some(row => row.currency !== order.currency)) throw new ConflictException("企业原账存在其他币种，不能合计核销");
    const reservedAfter = allRows.reduce((sum, row) => sum.plus(row.reservedDelta), new Prisma.Decimal(0));
    const receivableAfter = allRows.reduce((sum, row) => sum.plus(row.receivableDelta), new Prisma.Decimal(0)).plus(delta);
    if (reservedAfter.lt(0) || receivableAfter.lt(0)) throw new ConflictException("企业核销不能形成负债权或负占用");
    await tx.customerCorporateCreditLedger.create({ data: { id: randomUUID(), tenantId, customerId, workspaceId, orderId,
      entryType: "adjust", amount: delta.abs(), reservedDelta: new Prisma.Decimal(0), receivableDelta: delta,
      reservedAfter, receivableAfter, currency: order.currency, idempotencyKey: key,
      reason: `原资金事件 ${event.id} 对账期债权的同事务核销`, operator: event.operator ?? null } });
  }
}
