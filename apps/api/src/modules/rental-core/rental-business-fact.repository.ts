import { Injectable } from "@nestjs/common";
import { Prisma, type $Enums } from "@prisma/client";
import type {
  RentalCategoryCode,
  RentalCustomerBenefitAccount,
  RentalCustomerCoupon,
  RentalCustomerCouponStatus,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalQuoteChargeLine,
  RentalQuoteRequest,
  RentalQuoteSnapshotV1,
  RentalRewardLedgerEntry,
  RentalRuleConfig
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";

export type RentalBusinessFactTx = Prisma.TransactionClient;

export interface RentalReferralRecord {
  inviteeCustomerId: string;
  referrerCustomerId: string;
  registeredAt: string;
}

/** SPACE-03：单个**经营空间**的业务事实，用于启动装载。 */
export interface TenantBusinessFactSnapshot {
  tenantId: string;
  workspaceId: string;
  quotes: RentalQuoteSnapshotV1[];
  customerCoupons: RentalCustomerCoupon[];
  rewardLedger: RentalRewardLedgerEntry[];
  benefitAccounts: RentalCustomerBenefitAccount[];
  referrals: RentalReferralRecord[];
  notificationLogs: RentalNotificationSendLogV1[];
}

/**
 * 业务事实的库侧接口。
 *
 * 与前三个仓储同构：服务层只依赖接口，不连库的单元测试注入吸收式 stub，
 * 而租户隔离、唯一约束（奖励幂等键）、外键（通知记录→通知模板）这类持久化语义
 * 只在 MySQL E2E 里验证，不靠在 stub 上重写查询逻辑来"覆盖"。
 */
export interface RentalBusinessFactStore {
  loadAll(): Promise<TenantBusinessFactSnapshot[]>;
  findQuote(tenantId: string, quoteId: string, tx?: RentalBusinessFactTx): Promise<RentalQuoteSnapshotV1 | undefined>;
  consumeQuoteIfAvailable(tenantId: string, quoteId: string, orderId: string, consumedAt: string, tx: RentalBusinessFactTx): Promise<boolean>;
  lockCouponIfAvailable(tenantId: string, couponId: string, customerId: string | undefined, orderId: string, lockedAt: string, validAt: string, discountAmount: number, tx: RentalBusinessFactTx): Promise<boolean>;
  redeemCouponForOrder(tenantId: string, orderId: string, redeemedAt: string, tx: RentalBusinessFactTx): Promise<"none" | "redeemed" | "already_redeemed" | "invalid">;
  releaseCouponForOrder(tenantId: string, orderId: string, releasedAt: string, tx: RentalBusinessFactTx): Promise<void>;
  expireClaimedCoupons(tenantId: string, expiredAt: string): Promise<number>;
  voidClaimedCoupon(tenantId: string, couponId: string, reason: string, voidedAt: string, tx: RentalBusinessFactTx): Promise<boolean>;
  upsertQuote(quote: RentalQuoteSnapshotV1): Promise<void>;
  /**
   * 传入 tx 时必须使用它。领券由幂等执行器包在事务里，若这里另起连接独立提交，
   * 事务回滚撤不回这张券，会留下"幂等表已回滚、客户券已存在"的孤儿。
   */
  upsertCustomerCoupon(coupon: RentalCustomerCoupon, tx?: RentalBusinessFactTx): Promise<void>;
  countCustomerCoupons(tenantId: string, templateId: string, customerId: string, tx: RentalBusinessFactTx): Promise<number>;
  /**
   * 按幂等键查既有奖励流水，用于以库为准判重。
   * 必须按前缀匹配：grantReward 会派生 `<key>:referrer` / `<key>:invitee` 子键，
   * 只按精确键查会漏掉双边邀请奖励，导致重复入账。
   */
  findRewardsByIdempotencyKey(tenantId: string, key: string, tx?: RentalBusinessFactTx): Promise<RentalRewardLedgerEntry[]>;
  upsertRewardEntry(entry: RentalRewardLedgerEntry, tx?: RentalBusinessFactTx): Promise<void>;
  upsertBenefitAccount(account: RentalCustomerBenefitAccount, tx?: RentalBusinessFactTx): Promise<void>;
  incrementBenefitAccount(tenantId: string, customerId: string, delta: { points: number; marketing: number; rewardCoupons: number }, tx: RentalBusinessFactTx): Promise<void>;
  upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void>;
  insertNotificationLog(log: RentalNotificationSendLogV1, tx?: RentalBusinessFactTx): Promise<"inserted" | "duplicate">;
}

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

function date(value: string): Date {
  return new Date(value);
}

function optionalDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** RC-01 阶段 4b：Rental Core 业务事实的库侧实现。 */
@Injectable()
export class RentalBusinessFactRepository implements RentalBusinessFactStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<TenantBusinessFactSnapshot[]> {
    const [workspaces, quotes, coupons, rewards, accounts, referrals, logs] = await Promise.all([
      this.prisma.businessWorkspace.findMany({ select: { id: true, tenantId: true } }),
      this.prisma.rentalQuote.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalCustomerCoupon.findMany({ orderBy: { claimedAt: "desc" } }),
      this.prisma.rentalRewardLedgerEntry.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalBenefitAccount.findMany(),
      this.prisma.rentalReferral.findMany({ orderBy: { registeredAt: "desc" } }),
      this.prisma.rentalNotificationLog.findMany({ orderBy: { createdAt: "desc" } })
    ]);

    // 以经营空间为单位装载：同租户两个空间各有独立的报价、券、奖励与通知记录。
    return workspaces.map((workspace) => {
      const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspace.id);
      return {
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        quotes: mine(quotes).map((row) => this.toQuote(row)),
        customerCoupons: mine(coupons).map((row) => this.toCoupon(row)),
        rewardLedger: mine(rewards).map((row) => this.toRewardEntry(row)),
        benefitAccounts: mine(accounts).map((row) => this.toBenefitAccount(row)),
        referrals: mine(referrals).map((row) => ({
          inviteeCustomerId: row.inviteeCustomerId,
          referrerCustomerId: row.referrerCustomerId,
          registeredAt: iso(row.registeredAt)
        })),
        notificationLogs: mine(logs).map((row) => this.toNotificationLog(row))
      };
    });
  }

  async findQuote(tenantId: string, quoteId: string, tx?: RentalBusinessFactTx): Promise<RentalQuoteSnapshotV1 | undefined> {
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalQuote.findFirst({ where: { id: quoteId, tenantId, workspaceId } });
    return row ? this.toQuote(row) : undefined;
  }

  async consumeQuoteIfAvailable(
    tenantId: string,
    quoteId: string,
    orderId: string,
    consumedAt: string,
    tx: RentalBusinessFactTx
  ): Promise<boolean> {
    const timestamp = date(consumedAt);
    const result = await tx.rentalQuote.updateMany({
      where: { id: quoteId, tenantId, consumedAt: null, expiresAt: { gte: timestamp } },
      data: { consumedAt: timestamp, consumedOrderId: orderId }
    });
    return result.count === 1;
  }

  async lockCouponIfAvailable(
    tenantId: string,
    couponId: string,
    customerId: string | undefined,
    orderId: string,
    lockedAt: string,
    validAt: string,
    discountAmount: number,
    tx: RentalBusinessFactTx
  ): Promise<boolean> {
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) return false;
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const timestamp = date(lockedAt);
    const validityTimestamp = date(validAt);
    // 券行和模板行都在外层「下单」事务中加锁。不同券并发消耗同一模板预算时，
    // 模板锁把预算判断串行化；同一张券并发时，券锁保证只有一个订单能占用。
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_customer_coupons
      WHERE id = ${couponId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const coupon = await tx.rentalCustomerCoupon.findFirst({
      where: { id: couponId, tenantId, workspaceId },
      select: { customerId: true, templateId: true, status: true, effectiveFrom: true, effectiveTo: true }
    });
    if (!coupon || (customerId && coupon.customerId !== customerId) || coupon.status !== "claimed"
      || coupon.effectiveFrom > validityTimestamp || coupon.effectiveTo < validityTimestamp) return false;

    const templates = await tx.$queryRaw<Array<{ perCustomerUseLimit: number }>>(Prisma.sql`
      SELECT perCustomerUseLimit FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const template = templates[0];
    if (!template) return false;
    const used = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND templateId = ${coupon.templateId} AND customerId = ${coupon.customerId}
        AND status IN ('locked', 'redeemed')
      FOR UPDATE
    `);
    if (used.length >= template.perCustomerUseLimit) return false;
    const amount = new Prisma.Decimal(discountAmount.toFixed(2));
    const budgetUpdated = await tx.$executeRaw(Prisma.sql`
      UPDATE rental_coupon_templates
      SET lockedBudget = lockedBudget + ${amount}
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND (totalBudget IS NULL OR lockedBudget + redeemedBudget + ${amount} <= totalBudget)
    `);
    if (budgetUpdated !== 1) return false;
    const result = await tx.rentalCustomerCoupon.updateMany({
      where: {
        id: couponId,
        tenantId,
        workspaceId,
        ...(customerId ? { customerId } : {}),
        status: "claimed",
        effectiveFrom: { lte: timestamp },
        effectiveTo: { gte: timestamp }
      },
      data: {
        status: "locked",
        lockedOrderId: orderId,
        lockedAt: timestamp,
        lockedDiscountAmount: amount,
        releasedAt: null,
        releaseReason: null,
        expiredAt: null
      }
    });
    if (result.count !== 1) throw new Error("优惠券状态并发变化，拒绝锁定");
    return true;
  }

  async redeemCouponForOrder(tenantId: string, orderId: string, redeemedAt: string, tx: RentalBusinessFactTx): Promise<"none" | "redeemed" | "already_redeemed" | "invalid"> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const timestamp = date(redeemedAt);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND (lockedOrderId = ${orderId} OR redeemedOrderId = ${orderId})
      FOR UPDATE
    `);
    const coupon = await tx.rentalCustomerCoupon.findFirst({
      where: { tenantId, workspaceId, OR: [{ lockedOrderId: orderId }, { redeemedOrderId: orderId }] },
      select: { id: true, templateId: true, status: true, redeemedOrderId: true, lockedDiscountAmount: true }
    });
    if (!coupon) return "none";
    if (coupon.status === "redeemed" && coupon.redeemedOrderId === orderId) return "already_redeemed";
    if (coupon.status !== "locked" || !coupon.lockedDiscountAmount) return "invalid";
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const budgetUpdated = await tx.$executeRaw(Prisma.sql`
      UPDATE rental_coupon_templates
      SET lockedBudget = lockedBudget - ${coupon.lockedDiscountAmount},
          redeemedBudget = redeemedBudget + ${coupon.lockedDiscountAmount}
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND lockedBudget >= ${coupon.lockedDiscountAmount}
    `);
    if (budgetUpdated !== 1) return "invalid";
    // 条件更新同时防住读取后到更新前的状态竞争；0 行必须由上层拒绝订单确认。
    const result = await tx.rentalCustomerCoupon.updateMany({
      where: { id: coupon.id, tenantId, workspaceId, lockedOrderId: orderId, status: "locked" },
      data: { status: "redeemed", redeemedOrderId: orderId, redeemedAt: timestamp }
    });
    if (result.count !== 1) throw new Error("优惠券状态并发变化，拒绝核销");
    return "redeemed";
  }

  async releaseCouponForOrder(tenantId: string, orderId: string, releasedAt: string, tx: RentalBusinessFactTx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const timestamp = date(releasedAt);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND (lockedOrderId = ${orderId} OR redeemedOrderId = ${orderId})
      FOR UPDATE
    `);
    const coupon = await tx.rentalCustomerCoupon.findFirst({
      where: { tenantId, workspaceId, OR: [{ lockedOrderId: orderId }, { redeemedOrderId: orderId }] },
      select: { id: true, templateId: true, status: true, effectiveTo: true, lockedDiscountAmount: true }
    });
    if (!coupon || !["locked", "redeemed"].includes(coupon.status) || !coupon.lockedDiscountAmount) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const budgetUpdated = coupon.status === "locked"
      ? await tx.$executeRaw(Prisma.sql`
          UPDATE rental_coupon_templates SET lockedBudget = lockedBudget - ${coupon.lockedDiscountAmount}
          WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
            AND lockedBudget >= ${coupon.lockedDiscountAmount}
        `)
      : await tx.$executeRaw(Prisma.sql`
          UPDATE rental_coupon_templates SET redeemedBudget = redeemedBudget - ${coupon.lockedDiscountAmount}
          WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
            AND redeemedBudget >= ${coupon.lockedDiscountAmount}
        `);
    if (budgetUpdated !== 1) throw new Error("优惠券预算账不平，拒绝释放");
    const expired = coupon.effectiveTo < timestamp;
    const result = await tx.rentalCustomerCoupon.updateMany({
      where: { id: coupon.id, tenantId, workspaceId, status: coupon.status },
      data: {
        status: expired ? "expired" : "claimed",
        lockedOrderId: null,
        lockedAt: null,
        redeemedOrderId: null,
        redeemedAt: null,
        releasedAt: timestamp,
        releaseReason: "order_cancelled",
        expiredAt: expired ? timestamp : null
      }
    });
    if (result.count !== 1) throw new Error("优惠券状态并发变化，拒绝释放");
  }

  async expireClaimedCoupons(tenantId: string, expiredAt: string): Promise<number> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const timestamp = date(expiredAt);
    const result = await this.prisma.rentalCustomerCoupon.updateMany({
      where: { tenantId, workspaceId, status: "claimed", effectiveTo: { lt: timestamp } },
      data: { status: "expired", expiredAt: timestamp }
    });
    return result.count;
  }

  async voidClaimedCoupon(
    tenantId: string,
    couponId: string,
    reason: string,
    voidedAt: string,
    tx: RentalBusinessFactTx
  ): Promise<boolean> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM rental_customer_coupons
      WHERE id = ${couponId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const coupon = await tx.rentalCustomerCoupon.findFirst({
      where: { id: couponId, tenantId, workspaceId },
      select: { status: true }
    });
    if (!coupon) return false;
    if (coupon.status === "void") return true;
    // 已锁定券关联着一张按该优惠金额创建的订单。单独作废会让订单金额与券预算分离，
    // 所以必须先走订单取消（它会在同一事务释放券与预算），再作废可用券。
    if (coupon.status !== "claimed") return false;
    const result = await tx.rentalCustomerCoupon.updateMany({
      where: { id: couponId, tenantId, workspaceId, status: "claimed" },
      data: { status: "void", voidedAt: date(voidedAt), voidReason: reason }
    });
    return result.count === 1;
  }

  async upsertQuote(quote: RentalQuoteSnapshotV1): Promise<void> {
    const data = {
      tenantId: quote.tenantId,
      quoteNo: quote.quoteNo,
      categoryCode: upper<$Enums.RentalCategoryCode>(quote.categoryCode),
      request: quote.request as unknown as Prisma.InputJsonValue,
      membershipSnapshot: (quote.membershipSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      chargeLines: quote.chargeLines as unknown as Prisma.InputJsonValue,
      rentalAmount: new Prisma.Decimal(quote.rentalAmount),
      discountAmount: new Prisma.Decimal(quote.discountAmount),
      couponAmount: new Prisma.Decimal(quote.couponAmount),
      serviceAmount: new Prisma.Decimal(quote.serviceAmount),
      fulfillmentAmount: new Prisma.Decimal(quote.fulfillmentAmount),
      rateSnapshot: quote.rateSnapshot as unknown as Prisma.InputJsonValue,
      calendarSnapshot: quote.calendarSnapshot as unknown as Prisma.InputJsonValue,
      calendarWarnings: quote.calendarWarnings as unknown as Prisma.InputJsonValue,
      preAuthAmount: new Prisma.Decimal(quote.preAuthAmount),
      receivableAmount: new Prisma.Decimal(quote.receivableAmount),
      depositAmount: new Prisma.Decimal(quote.depositAmount),
      payableAmount: new Prisma.Decimal(quote.payableAmount),
      pricingPlanVersion: quote.pricingPlanVersion,
      priceVersionId: quote.priceVersionId ?? null,
      priceVersion: quote.priceVersion ?? null,
      ruleVersion: quote.ruleVersion,
      ruleSnapshot: quote.ruleSnapshot as unknown as Prisma.InputJsonValue,
      calendarVersion: quote.calendarVersion ?? null,
      appliedDiscountPlanIds: quote.appliedDiscountPlanIds as unknown as Prisma.InputJsonValue,
      // MKT-01A：逐方案评估随报价固化。方案后续改配置不得改变这张报价的解释。
      discountEvaluations: (quote.discountEvaluations ?? []) as unknown as Prisma.InputJsonValue,
      // MKT-02A：服务快照随报价固化，服务改价改条款不得改变已发出的报价与订单。
      serviceSnapshots: (quote.serviceSnapshots ?? []) as unknown as Prisma.InputJsonValue,
      couponEvaluation: (quote.couponEvaluation ?? null) as unknown as Prisma.InputJsonValue,
      // CORE-EXT-02D：固化报价生成时已启用能力的版本快照，下单时拷进订单。
      capabilitySnapshot: (quote.capabilitySnapshot ?? null) as unknown as Prisma.InputJsonValue,
      capabilityDecisions: (quote.capabilityDecisions ?? null) as unknown as Prisma.InputJsonValue,
      customerCouponId: quote.customerCouponId ?? null,
      expiresAt: date(quote.expiresAt),
      consumedAt: optionalDate(quote.consumedAt),
      consumedOrderId: quote.consumedOrderId ?? null
    };
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, quote.tenantId);
    await this.prisma.rentalQuote.upsert({
      where: { id: quote.id },
      create: { workspaceId, id: quote.id, ...data, createdAt: date(quote.createdAt) },
      update: data
    });
  }

  async upsertCustomerCoupon(coupon: RentalCustomerCoupon, tx?: RentalBusinessFactTx): Promise<void> {
    const data = {
      tenantId: coupon.tenantId,
      customerId: coupon.customerId,
      templateId: coupon.templateId,
      templateCode: coupon.templateCode,
      templateName: coupon.templateName,
      templateVersion: coupon.templateVersion,
      discountType: coupon.discountType,
      discountValue: new Prisma.Decimal(coupon.discountValue),
      minimumSpend: new Prisma.Decimal(coupon.minimumSpend),
      maximumDiscount: coupon.maximumDiscount === undefined ? null : new Prisma.Decimal(coupon.maximumDiscount),
      appliesTo: coupon.appliesTo,
      stackableWithDiscountPlans: coupon.stackableWithDiscountPlans,
      applicableItemGroupIds: coupon.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      grantReason: coupon.grantReason,
      status: coupon.status,
      claimedAt: date(coupon.claimedAt),
      effectiveFrom: date(coupon.effectiveFrom),
      effectiveTo: date(coupon.effectiveTo),
      lockedOrderId: coupon.lockedOrderId ?? null,
      lockedAt: optionalDate(coupon.lockedAt),
      lockedDiscountAmount: coupon.lockedDiscountAmount === undefined ? null : new Prisma.Decimal(coupon.lockedDiscountAmount),
      redeemedOrderId: coupon.redeemedOrderId ?? null,
      redeemedAt: optionalDate(coupon.redeemedAt),
      releasedAt: optionalDate(coupon.releasedAt),
      releaseReason: coupon.releaseReason ?? null,
      expiredAt: optionalDate(coupon.expiredAt),
      voidedAt: optionalDate(coupon.voidedAt),
      voidReason: coupon.voidReason ?? null
    };
    const workspaceId = await resolveScopeWorkspaceId(tx ?? this.prisma, coupon.tenantId);
    await (tx ?? this.prisma).rentalCustomerCoupon.upsert({
      where: { id: coupon.id },
      create: { workspaceId, id: coupon.id, ...data },
      update: data
    });
  }

  async findRewardsByIdempotencyKey(
    tenantId: string,
    key: string,
    tx?: RentalBusinessFactTx
  ): Promise<RentalRewardLedgerEntry[]> {
    const client = tx ?? this.prisma;
    // 奖励幂等键的唯一约束已是 (workspaceId, idempotencyKey)，判重也必须按空间，
    // 否则一个空间的发奖会被另一个空间的同键记录误判为重复。
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const rows = await client.rentalRewardLedgerEntry.findMany({
      where: { tenantId, workspaceId, OR: [{ idempotencyKey: key }, { idempotencyKey: { startsWith: `${key}:` } }] },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toRewardEntry(row));
  }

  async upsertRewardEntry(entry: RentalRewardLedgerEntry, tx?: RentalBusinessFactTx): Promise<void> {
    const data = {
      tenantId: entry.tenantId,
      customerId: entry.customerId,
      rewardType: entry.rewardType,
      amount: new Prisma.Decimal(entry.amount),
      triggerType: entry.triggerType,
      idempotencyKey: entry.idempotencyKey,
      relatedCustomerId: entry.relatedCustomerId ?? null,
      status: entry.status,
      reason: entry.reason,
      benefitReferenceIds: entry.benefitReferenceIds
        ? (entry.benefitReferenceIds as unknown as Prisma.InputJsonValue)
        : undefined,
      appliedAt: optionalDate(entry.appliedAt),
      reversedAt: optionalDate(entry.reversedAt)
    };
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, entry.tenantId);
    await client.rentalRewardLedgerEntry.upsert({
      where: { id: entry.id },
      create: { workspaceId, id: entry.id, ...data, createdAt: date(entry.createdAt) },
      update: data
    });
  }

  async upsertBenefitAccount(account: RentalCustomerBenefitAccount, tx?: RentalBusinessFactTx): Promise<void> {
    const data = {
      pointsBalance: new Prisma.Decimal(account.pointsBalance),
      marketingBalance: new Prisma.Decimal(account.marketingBalance),
      availableRewardCouponCount: account.availableRewardCouponCount
    };
    const client = tx ?? this.prisma;
    const workspaceId = await resolveScopeWorkspaceId(client, account.tenantId);
    await client.rentalBenefitAccount.upsert({
      // SPACE-04：按 (workspaceId, customerId) 键控。
      //
      // 原先键 (tenantId, customerId)，而积分与营销余额按需求是**空间级**的：
      // 同一客户在摄影空间和露营空间各有独立余额。用租户级键 upsert 时，
      // 第二个空间的写入会 update 掉第一个空间那行，余额互相覆盖而不是各记一行。
      where: { workspaceId_customerId: { workspaceId, customerId: account.customerId } },
      create: { workspaceId, tenantId: account.tenantId, customerId: account.customerId, ...data },
      update: data
    });
  }

  async incrementBenefitAccount(tenantId: string, customerId: string, delta: { points: number; marketing: number; rewardCoupons: number }, tx: RentalBusinessFactTx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO \`rental_benefit_accounts\` (\`tenantId\`, \`workspaceId\`, \`customerId\`, \`pointsBalance\`, \`marketingBalance\`, \`availableRewardCouponCount\`, \`updatedAt\`)
      VALUES (${tenantId}, ${workspaceId}, ${customerId}, ${delta.points}, ${delta.marketing}, ${delta.rewardCoupons}, NOW(3))
      ON DUPLICATE KEY UPDATE
        \`pointsBalance\` = \`pointsBalance\` + VALUES(\`pointsBalance\`),
        \`marketingBalance\` = \`marketingBalance\` + VALUES(\`marketingBalance\`),
        \`availableRewardCouponCount\` = \`availableRewardCouponCount\` + VALUES(\`availableRewardCouponCount\`),
        \`updatedAt\` = NOW(3)
    `);
  }

  async countCustomerCoupons(
    tenantId: string,
    templateId: string,
    customerId: string,
    tx: RentalBusinessFactTx
  ): Promise<number> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    return tx.rentalCustomerCoupon.count({
      where: { tenantId, workspaceId, templateId, customerId, status: { not: "void" } }
    });
  }

  async upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    await this.prisma.rentalReferral.upsert({
      where: { workspaceId_inviteeCustomerId: { workspaceId, inviteeCustomerId: referral.inviteeCustomerId } },
      create: {
        tenantId,
        workspaceId,
        inviteeCustomerId: referral.inviteeCustomerId,
        referrerCustomerId: referral.referrerCustomerId,
        registeredAt: date(referral.registeredAt)
      },
      update: { referrerCustomerId: referral.referrerCustomerId }
    });
  }

  /** 发送记录是追加式流水，用 create 而非 upsert：同一条记录不应被改写。 */
  async insertNotificationLog(log: RentalNotificationSendLogV1, tx?: RentalBusinessFactTx): Promise<"inserted" | "duplicate"> {
    const workspaceId = await resolveScopeWorkspaceId(tx ?? this.prisma, log.tenantId);
    try {
      await (tx ?? this.prisma).rentalNotificationLog.create({
        data: {
          id: log.id,
          tenantId: log.tenantId,
          workspaceId,
          templateId: log.templateId,
          templateVersion: log.templateVersion,
          eventCode: log.eventCode,
          channel: log.channel,
          recipient: log.recipient,
          renderedTitle: log.renderedTitle,
          renderedBody: log.renderedBody,
          variables: log.variables as Prisma.InputJsonValue,
          status: log.status,
          provider: log.provider,
          providerMessageId: log.providerMessageId ?? null,
          errorMessage: log.errorMessage ?? null,
          attempts: log.attempts,
          businessObjectType: log.businessObjectType ?? null,
          businessObjectId: log.businessObjectId ?? null,
          idempotencyKey: log.idempotencyKey ?? null,
          sentAt: optionalDate(log.sentAt),
          createdAt: date(log.createdAt)
        }
      });
      return "inserted";
    } catch (error) {
      // 空间级幂等键撞了：同一业务事件已发过。返回 duplicate 让服务层静默跳过，
      // 而不是把「不重复通知」当成错误抛出。仅对该唯一键的 P2002 生效，其余照抛。
      // MySQL 的重复键错误只回滚当前语句、不中止外层事务，因此 tx 路径也安全。
      if (
        log.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return "duplicate";
      }
      throw error;
    }
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toQuote(row: Prisma.RentalQuoteGetPayload<object>): RentalQuoteSnapshotV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      quoteNo: row.quoteNo,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      request: row.request as unknown as RentalQuoteRequest,
      membershipSnapshot: (row.membershipSnapshot ?? undefined) as unknown as RentalQuoteSnapshotV1["membershipSnapshot"],
      chargeLines: (row.chargeLines ?? []) as unknown as RentalQuoteChargeLine[],
      rentalAmount: num(row.rentalAmount),
      discountAmount: num(row.discountAmount),
      couponAmount: num(row.couponAmount),
      serviceAmount: num(row.serviceAmount),
      fulfillmentAmount: num(row.fulfillmentAmount),
      rateSnapshot: (row.rateSnapshot ?? []) as unknown as RentalQuoteSnapshotV1["rateSnapshot"],
      calendarSnapshot: (row.calendarSnapshot ?? []) as unknown as RentalQuoteSnapshotV1["calendarSnapshot"],
      calendarWarnings: (row.calendarWarnings ?? []) as unknown as RentalQuoteSnapshotV1["calendarWarnings"],
      preAuthAmount: num(row.preAuthAmount),
      receivableAmount: num(row.receivableAmount),
      depositAmount: num(row.depositAmount),
      payableAmount: num(row.payableAmount),
      pricingPlanVersion: row.pricingPlanVersion,
      priceVersionId: row.priceVersionId ?? undefined,
      priceVersion: row.priceVersion ?? undefined,
      ruleVersion: row.ruleVersion,
      ruleSnapshot: row.ruleSnapshot as unknown as RentalRuleConfig,
      calendarVersion: row.calendarVersion ?? undefined,
      appliedDiscountPlanIds: (row.appliedDiscountPlanIds ?? []) as string[],
      discountEvaluations: (row.discountEvaluations ?? []) as unknown as RentalQuoteSnapshotV1["discountEvaluations"],
      serviceSnapshots: (row.serviceSnapshots ?? []) as unknown as RentalQuoteSnapshotV1["serviceSnapshots"],
      couponEvaluation: (row.couponEvaluation ?? undefined) as unknown as RentalQuoteSnapshotV1["couponEvaluation"],
      capabilitySnapshot: (row.capabilitySnapshot ?? undefined) as unknown as RentalQuoteSnapshotV1["capabilitySnapshot"],
      capabilityDecisions: (row.capabilityDecisions ?? undefined) as unknown as RentalQuoteSnapshotV1["capabilityDecisions"],
      customerCouponId: row.customerCouponId ?? undefined,
      expiresAt: iso(row.expiresAt),
      createdAt: iso(row.createdAt),
      consumedAt: optionalIso(row.consumedAt),
      consumedOrderId: row.consumedOrderId ?? undefined
    };
  }

  private toCoupon(row: Prisma.RentalCustomerCouponGetPayload<object>): RentalCustomerCoupon {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      templateId: row.templateId,
      templateCode: row.templateCode,
      templateName: row.templateName,
      templateVersion: row.templateVersion,
      discountType: row.discountType as RentalCustomerCoupon["discountType"],
      discountValue: num(row.discountValue),
      minimumSpend: num(row.minimumSpend),
      maximumDiscount: row.maximumDiscount === null ? undefined : num(row.maximumDiscount),
      appliesTo: row.appliesTo as RentalCustomerCoupon["appliesTo"],
      stackableWithDiscountPlans: row.stackableWithDiscountPlans,
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      grantReason: row.grantReason,
      status: row.status as RentalCustomerCouponStatus,
      claimedAt: iso(row.claimedAt),
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: iso(row.effectiveTo),
      lockedOrderId: row.lockedOrderId ?? undefined,
      lockedAt: optionalIso(row.lockedAt),
      lockedDiscountAmount: row.lockedDiscountAmount === null ? undefined : num(row.lockedDiscountAmount),
      redeemedOrderId: row.redeemedOrderId ?? undefined,
      redeemedAt: optionalIso(row.redeemedAt),
      releasedAt: optionalIso(row.releasedAt),
      releaseReason: row.releaseReason ?? undefined,
      expiredAt: optionalIso(row.expiredAt),
      voidedAt: optionalIso(row.voidedAt),
      voidReason: row.voidReason ?? undefined
    };
  }

  private toRewardEntry(row: Prisma.RentalRewardLedgerEntryGetPayload<object>): RentalRewardLedgerEntry {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      rewardType: row.rewardType as RentalRewardLedgerEntry["rewardType"],
      amount: num(row.amount),
      triggerType: row.triggerType as RentalRewardLedgerEntry["triggerType"],
      idempotencyKey: row.idempotencyKey,
      relatedCustomerId: row.relatedCustomerId ?? undefined,
      status: row.status as RentalRewardLedgerEntry["status"],
      reason: row.reason,
      benefitReferenceIds: (row.benefitReferenceIds ?? undefined) as string[] | undefined,
      appliedAt: optionalIso(row.appliedAt),
      createdAt: iso(row.createdAt),
      reversedAt: optionalIso(row.reversedAt)
    };
  }

  private toBenefitAccount(row: Prisma.RentalBenefitAccountGetPayload<object>): RentalCustomerBenefitAccount {
    return {
      tenantId: row.tenantId,
      customerId: row.customerId,
      pointsBalance: num(row.pointsBalance),
      marketingBalance: num(row.marketingBalance),
      availableRewardCouponCount: row.availableRewardCouponCount,
      updatedAt: iso(row.updatedAt)
    };
  }

  private toNotificationLog(row: Prisma.RentalNotificationLogGetPayload<object>): RentalNotificationSendLogV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      templateId: row.templateId,
      templateVersion: row.templateVersion,
      eventCode: row.eventCode,
      channel: row.channel as RentalNotificationTemplateV1["channel"],
      recipient: row.recipient,
      renderedTitle: row.renderedTitle,
      renderedBody: row.renderedBody,
      variables: (row.variables ?? {}) as Record<string, unknown>,
      status: row.status as RentalNotificationSendLogV1["status"],
      provider: row.provider,
      providerMessageId: row.providerMessageId ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      attempts: row.attempts,
      businessObjectType: row.businessObjectType ?? undefined,
      businessObjectId: row.businessObjectId ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      createdAt: iso(row.createdAt),
      sentAt: optionalIso(row.sentAt)
    };
  }
}
