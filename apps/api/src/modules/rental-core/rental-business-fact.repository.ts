import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
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
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";

export type RentalBusinessFactTx = Prisma.TransactionClient;

export interface RentalNotificationDeliveryRecord {
  log: RentalNotificationSendLogV1;
  /** 仅服务端重试使用的收件人密文，不进入 RentalNotificationSendLogV1。 */
  recipientEncrypted?: string;
  maxAttempts: number;
}

export interface RentalNotificationDeliveryPatch {
  status?: RentalNotificationSendLogV1["status"];
  provider?: string;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  /** 记录一次投递结果时置 true：attempts +1 并释放租约。认领本身不递增。 */
  countAttempt?: boolean;
  /** 显式释放租约（查询回执等不消耗尝试次数的路径）。 */
  releaseLease?: boolean;
}

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
  repriceOrderCoupon(tenantId: string, orderId: string, amount: number, tx: RentalBusinessFactTx): Promise<void>;
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
  insertNotificationLog(
    log: RentalNotificationSendLogV1,
    tx?: RentalBusinessFactTx,
    recipientEncrypted?: string,
    recipientFingerprint?: string
  ): Promise<"inserted" | "duplicate">;
  reserveSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: RentalBusinessFactTx
  ): Promise<{ allowed: boolean; retryAt: string }>;
  releaseSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: RentalBusinessFactTx
  ): Promise<void>;
  findNotificationDelivery(tenantId: string, id: string): Promise<RentalNotificationDeliveryRecord | undefined>;
  /** 到期待投递：queued/failed、nextAttemptAt 已到且租约不存在或已过期。 */
  listDueNotificationDeliveries(tenantId: string, at: string, limit: number): Promise<RentalNotificationDeliveryRecord[]>;
  /** 认领只写租约，不消耗 attempts；attempts 由 updateNotificationDelivery({ countAttempt: true }) 递增。 */
  claimNotificationDelivery(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<boolean>;
  updateNotificationDelivery(tenantId: string, id: string, patch: RentalNotificationDeliveryPatch): Promise<RentalNotificationSendLogV1 | undefined>;
  /** 已受理（sent）且带服务商回执号、尚未取得最终回执的短信，供回执轮询。 */
  listSentNotificationDeliveries(tenantId: string, workspaceId: string, take: number): Promise<RentalNotificationDeliveryRecord[]>;
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

function optionalDate(value: string | null | undefined): Date | null {
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
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    const result = await tx.rentalQuote.updateMany({
      where: { id: quoteId, tenantId, workspaceId, consumedAt: null, expiresAt: { gte: timestamp } },
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

  /** 调整原订单的用券金额，不重复核销次数；与续租生效/退款核减共用事务。 */
  async repriceOrderCoupon(tenantId: string, orderId: string, amount: number, tx: RentalBusinessFactTx): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND (lockedOrderId = ${orderId} OR redeemedOrderId = ${orderId}) FOR UPDATE`);
    const coupon = await tx.rentalCustomerCoupon.findFirst({ where: {
      tenantId, workspaceId, OR: [{ lockedOrderId: orderId }, { redeemedOrderId: orderId }]
    } });
    if (!coupon || !["locked", "redeemed"].includes(coupon.status)) throw new ConflictException("原订单优惠券账目缺失，不能自动续租核价");
    const delta = new Prisma.Decimal(amount).minus(coupon.lockedDiscountAmount ?? 0);
    if (delta.isZero()) return;
    const column = coupon.status === "locked" ? Prisma.raw("lockedBudget") : Prisma.raw("redeemedBudget");
    const updated = await tx.$executeRaw(Prisma.sql`UPDATE rental_coupon_templates
      SET ${column} = ${column} + ${delta}
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND ${column} + ${delta} >= 0
        AND (${delta} <= 0 OR totalBudget IS NULL OR totalBudget - lockedBudget - redeemedBudget >= ${delta})`);
    if (updated !== 1) throw new ConflictException("原优惠券预算不足或账目异常，请先处理后重新续租；未改变原租期");
    await tx.rentalCustomerCoupon.updateMany({ where: { id: coupon.id, tenantId, workspaceId, status: coupon.status }, data: { lockedDiscountAmount: amount } });
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
      membershipBenefitEvaluations: (quote.membershipBenefitEvaluations ?? null) as unknown as Prisma.InputJsonValue,
      chargeLines: quote.chargeLines as unknown as Prisma.InputJsonValue,
      rentalAmount: new Prisma.Decimal(quote.rentalAmount),
      discountAmount: new Prisma.Decimal(quote.discountAmount),
      couponAmount: new Prisma.Decimal(quote.couponAmount),
      serviceAmount: new Prisma.Decimal(quote.serviceAmount),
      fulfillmentAmount: new Prisma.Decimal(quote.fulfillmentAmount),
      rateSnapshot: quote.rateSnapshot as unknown as Prisma.InputJsonValue,
      calendarSnapshot: quote.calendarSnapshot as unknown as Prisma.InputJsonValue,
      pricingContext: quote.pricingContext ? quote.pricingContext as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      calendarWarnings: quote.calendarWarnings as unknown as Prisma.InputJsonValue,
      preAuthAmount: new Prisma.Decimal(quote.preAuthAmount),
      receivableAmount: new Prisma.Decimal(quote.receivableAmount),
      taxRate: new Prisma.Decimal(quote.taxRate ?? 0),
      taxAmount: new Prisma.Decimal(quote.taxAmount ?? 0),
      currency: quote.currency ?? "CNY",
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
    const existing = await this.prisma.rentalQuote.findUnique({
      where: { id: quote.id },
      select: { tenantId: true, workspaceId: true }
    });
    if (existing && (existing.tenantId !== quote.tenantId || existing.workspaceId !== workspaceId)) {
      throw new ConflictException("报价事实已属于其他租户或经营空间，拒绝覆盖");
    }
    if (existing) {
      await this.prisma.rentalQuote.update({ where: { id: quote.id }, data });
    } else {
      await this.prisma.rentalQuote.create({
        data: { workspaceId, id: quote.id, ...data, createdAt: date(quote.createdAt) }
      });
    }
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
    const client = tx ?? this.prisma;
    const existing = await client.rentalCustomerCoupon.findUnique({
      where: { id: coupon.id },
      select: { tenantId: true, workspaceId: true }
    });
    if (existing && (existing.tenantId !== coupon.tenantId || existing.workspaceId !== workspaceId)) {
      throw new ConflictException("优惠券事实已属于其他租户或经营空间，拒绝覆盖");
    }
    if (existing) {
      await client.rentalCustomerCoupon.update({ where: { id: coupon.id }, data });
    } else {
      await client.rentalCustomerCoupon.create({ data: { workspaceId, id: coupon.id, ...data } });
    }
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
    const existing = await client.rentalRewardLedgerEntry.findUnique({
      where: { id: entry.id },
      select: { tenantId: true, workspaceId: true }
    });
    if (existing && (existing.tenantId !== entry.tenantId || existing.workspaceId !== workspaceId)) {
      throw new ConflictException("奖励流水已属于其他租户或经营空间，拒绝覆盖");
    }
    if (existing) {
      await client.rentalRewardLedgerEntry.update({ where: { id: entry.id }, data });
    } else {
      await client.rentalRewardLedgerEntry.create({
        data: { workspaceId, id: entry.id, ...data, createdAt: date(entry.createdAt) }
      });
    }
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
  async insertNotificationLog(
    log: RentalNotificationSendLogV1,
    tx?: RentalBusinessFactTx,
    recipientEncrypted?: string,
    recipientFingerprint?: string
  ): Promise<"inserted" | "duplicate"> {
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
          recipientEncrypted: recipientEncrypted ?? null,
          recipientFingerprint: recipientFingerprint ?? null,
          renderedTitle: log.renderedTitle,
          renderedBody: log.renderedBody,
          variables: log.variables as Prisma.InputJsonValue,
          status: log.status,
          provider: log.provider,
          providerMessageId: log.providerMessageId ?? null,
          errorMessage: log.errorMessage ?? null,
          attempts: log.attempts,
          nextAttemptAt: optionalDate(log.nextAttemptAt),
          lastAttemptAt: optionalDate(log.lastAttemptAt),
          maxAttempts: log.maxAttempts ?? 3,
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

  /**
   * EXT-02：短信安全频率闸门。
   *
   * 用固定时间桶和条件递增，而不是先 count 再 insert，避免并发请求一起看到
   * 旧数量后同时放行。手机号只以 SecretBox 生成的 HMAC 指纹进入这里；租户总量
   * 和单收件人两道上限都在同一个事务里预留，租户上限失败时回滚收件人预留。
   */
  async reserveSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: RentalBusinessFactTx
  ): Promise<{ allowed: boolean; retryAt: string }> {
    const nowMs = new Date(at).getTime();
    if (!Number.isFinite(nowMs)) throw new Error("短信频率限制时间无效");
    const recipientBucketStart = new Date(Math.floor(nowMs / (10 * 60 * 1000)) * 10 * 60 * 1000);
    const workspaceBucketStart = new Date(Math.floor(nowMs / (60 * 1000)) * 60 * 1000);
    const recipientLimit = 3;
    const workspaceLimit = 120;
    const run = async (client: Prisma.TransactionClient | PrismaService) => {
      const scopedWorkspace = await client.businessWorkspace.findFirst({
        where: { tenantId, id: workspaceId.trim() },
        select: { id: true }
      });
      if (!scopedWorkspace) throw new ForbiddenException("短信限流空间不属于当前租户，拒绝访问");
      const scopedWorkspaceId = scopedWorkspace.id;
      const reserve = async (scopeKey: string, bucketStart: Date, limit: number) => {
        try {
          await client.rentalNotificationRateBucket.create({
            data: { tenantId, workspaceId: scopedWorkspaceId, scopeKey, bucketStart }
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        }
        const result = await client.rentalNotificationRateBucket.updateMany({
          where: { tenantId, workspaceId: scopedWorkspaceId, scopeKey, bucketStart, count: { lt: limit } },
          data: { count: { increment: 1 } }
        });
        return result.count === 1;
      };

      const recipientScope = `recipient:${recipientFingerprint}`;
      if (!await reserve(recipientScope, recipientBucketStart, recipientLimit)) {
        return { allowed: false, retryAt: new Date(recipientBucketStart.getTime() + 10 * 60 * 1000).toISOString() };
      }
      if (!await reserve("workspace", workspaceBucketStart, workspaceLimit)) {
        await client.rentalNotificationRateBucket.updateMany({
          where: { tenantId, workspaceId: scopedWorkspaceId, scopeKey: recipientScope, bucketStart: recipientBucketStart, count: { gt: 0 } },
          data: { count: { decrement: 1 } }
        });
        return { allowed: false, retryAt: new Date(workspaceBucketStart.getTime() + 60 * 1000).toISOString() };
      }
      return { allowed: true, retryAt: at };
    };
    return tx ? run(tx) : this.prisma.$transaction((client) => run(client));
  }

  async releaseSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: RentalBusinessFactTx
  ): Promise<void> {
    const nowMs = new Date(at).getTime();
    if (!Number.isFinite(nowMs)) throw new Error("短信频率限制时间无效");
    const recipientBucketStart = new Date(Math.floor(nowMs / (10 * 60 * 1000)) * 10 * 60 * 1000);
    const workspaceBucketStart = new Date(Math.floor(nowMs / (60 * 1000)) * 60 * 1000);
    const run = async (client: Prisma.TransactionClient | PrismaService) => {
      const scopedWorkspace = await client.businessWorkspace.findFirst({
        where: { tenantId, id: workspaceId.trim() },
        select: { id: true }
      });
      if (!scopedWorkspace) throw new ForbiddenException("短信限流空间不属于当前租户，拒绝访问");
      const scopedWorkspaceId = scopedWorkspace.id;
      await client.rentalNotificationRateBucket.updateMany({
        where: { tenantId, workspaceId: scopedWorkspaceId, scopeKey: `recipient:${recipientFingerprint}`, bucketStart: recipientBucketStart, count: { gt: 0 } },
        data: { count: { decrement: 1 } }
      });
      await client.rentalNotificationRateBucket.updateMany({
        where: { tenantId, workspaceId: scopedWorkspaceId, scopeKey: "workspace", bucketStart: workspaceBucketStart, count: { gt: 0 } },
        data: { count: { decrement: 1 } }
      });
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction((client) => run(client));
  }

  private notificationDelivery(row: Prisma.RentalNotificationLogGetPayload<object>): RentalNotificationDeliveryRecord {
    return {
      log: this.toNotificationLog(row),
      recipientEncrypted: row.recipientEncrypted ?? undefined,
      maxAttempts: row.maxAttempts
    };
  }

  async findNotificationDelivery(tenantId: string, id: string): Promise<RentalNotificationDeliveryRecord | undefined> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const row = await this.prisma.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
    return row ? this.notificationDelivery(row) : undefined;
  }

  async listDueNotificationDeliveries(tenantId: string, at: string, limit: number): Promise<RentalNotificationDeliveryRecord[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const now = date(at);
    const rows = await this.prisma.rentalNotificationLog.findMany({
      where: {
        tenantId,
        workspaceId,
        channel: "sms",
        status: { in: ["queued", "failed"] },
        nextAttemptAt: { lte: now },
        // 租约不存在或已过期才算到期：正在被别的实例投递的行不重复认领；崩溃留下的租约到期后自动回到队列。
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }]
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100))
    });
    return rows.filter((row) => row.attempts < row.maxAttempts).map((row) => this.notificationDelivery(row));
  }

  async claimNotificationDelivery(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<boolean> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const current = await this.prisma.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
    if (!current || current.channel !== "sms" || !["queued", "failed", "delivery_failed"].includes(current.status)) return false;
    if (current.attempts >= current.maxAttempts) return false;
    const atMs = new Date(at).getTime();
    if (!force && current.nextAttemptAt && current.nextAttemptAt.getTime() > atMs) return false;
    // 认领只占租约，不递增 attempts：崩溃在租约期内的进程不会吃掉一次重试机会。
    // 未到期的租约只有 force（人工重试）能覆盖。
    if (!force && current.leaseUntil && current.leaseUntil.getTime() > atMs) return false;
    const result = await this.prisma.rentalNotificationLog.updateMany({
      where: {
        id, tenantId, workspaceId,
        status: { in: ["queued", "failed", "delivery_failed"] },
        attempts: current.attempts,
        leaseUntil: current.leaseUntil
      },
      data: { lastAttemptAt: date(at), leaseUntil: date(leaseUntil) }
    });
    return result.count === 1;
  }

  async listSentNotificationDeliveries(tenantId: string, workspaceId: string, take: number): Promise<RentalNotificationDeliveryRecord[]> {
    const rows = await this.prisma.rentalNotificationLog.findMany({
      where: { tenantId, workspaceId, channel: "sms", status: { in: ["sent", "delivery_pending"] }, providerMessageId: { not: null }, recipientEncrypted: { not: null } },
      orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(take, 200))
    });
    return rows.map((row) => this.notificationDelivery(row));
  }

  async updateNotificationDelivery(tenantId: string, id: string, patch: RentalNotificationDeliveryPatch): Promise<RentalNotificationSendLogV1 | undefined> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const result = await this.prisma.rentalNotificationLog.updateMany({
      where: { id, tenantId, workspaceId },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.providerMessageId !== undefined ? { providerMessageId: patch.providerMessageId } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.sentAt !== undefined ? { sentAt: optionalDate(patch.sentAt) } : {}),
        ...(patch.nextAttemptAt !== undefined ? { nextAttemptAt: optionalDate(patch.nextAttemptAt) } : {}),
        ...(patch.lastAttemptAt !== undefined ? { lastAttemptAt: optionalDate(patch.lastAttemptAt) } : {}),
        ...(patch.countAttempt ? { attempts: { increment: 1 } } : {}),
        ...(patch.countAttempt || patch.releaseLease ? { leaseUntil: null } : {})
      }
    });
    if (result.count !== 1) return undefined;
    const row = await this.prisma.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
    return row ? this.toNotificationLog(row) : undefined;
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
      membershipBenefitEvaluations: (row.membershipBenefitEvaluations ?? undefined) as unknown as RentalQuoteSnapshotV1["membershipBenefitEvaluations"],
      chargeLines: (row.chargeLines ?? []) as unknown as RentalQuoteChargeLine[],
      rentalAmount: num(row.rentalAmount),
      discountAmount: num(row.discountAmount),
      couponAmount: num(row.couponAmount),
      serviceAmount: num(row.serviceAmount),
      fulfillmentAmount: num(row.fulfillmentAmount),
      rateSnapshot: (row.rateSnapshot ?? []) as unknown as RentalQuoteSnapshotV1["rateSnapshot"],
      calendarSnapshot: (row.calendarSnapshot ?? []) as unknown as RentalQuoteSnapshotV1["calendarSnapshot"],
      pricingContext: row.pricingContext ? row.pricingContext as unknown as RentalQuoteSnapshotV1["pricingContext"] : undefined,
      calendarWarnings: (row.calendarWarnings ?? []) as unknown as RentalQuoteSnapshotV1["calendarWarnings"],
      preAuthAmount: num(row.preAuthAmount),
      receivableAmount: num(row.receivableAmount),
      taxRate: num(row.taxRate),
      taxAmount: num(row.taxAmount),
      currency: row.currency as RentalQuoteSnapshotV1["currency"],
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
      nextAttemptAt: optionalIso(row.nextAttemptAt),
      lastAttemptAt: optionalIso(row.lastAttemptAt),
      maxAttempts: row.maxAttempts,
      businessObjectType: row.businessObjectType ?? undefined,
      businessObjectId: row.businessObjectId ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      createdAt: iso(row.createdAt),
      sentAt: optionalIso(row.sentAt)
    };
  }
}
