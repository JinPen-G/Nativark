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

export interface RentalReferralRecord {
  inviteeCustomerId: string;
  referrerCustomerId: string;
  registeredAt: string;
}

/** 单个租户的业务事实，用于启动装载。 */
export interface TenantBusinessFactSnapshot {
  tenantId: string;
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
  upsertQuote(quote: RentalQuoteSnapshotV1): Promise<void>;
  upsertCustomerCoupon(coupon: RentalCustomerCoupon): Promise<void>;
  upsertRewardEntry(entry: RentalRewardLedgerEntry): Promise<void>;
  upsertBenefitAccount(account: RentalCustomerBenefitAccount): Promise<void>;
  upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void>;
  insertNotificationLog(log: RentalNotificationSendLogV1): Promise<void>;
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
    const [quotes, coupons, rewards, accounts, referrals, logs] = await Promise.all([
      this.prisma.rentalQuote.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalCustomerCoupon.findMany({ orderBy: { claimedAt: "desc" } }),
      this.prisma.rentalRewardLedgerEntry.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalBenefitAccount.findMany(),
      this.prisma.rentalReferral.findMany({ orderBy: { registeredAt: "desc" } }),
      this.prisma.rentalNotificationLog.findMany({ orderBy: { createdAt: "desc" } })
    ]);

    const tenantIds = new Set<string>([
      ...quotes.map((row) => row.tenantId),
      ...coupons.map((row) => row.tenantId),
      ...rewards.map((row) => row.tenantId),
      ...accounts.map((row) => row.tenantId),
      ...referrals.map((row) => row.tenantId),
      ...logs.map((row) => row.tenantId)
    ]);

    return [...tenantIds].map((tenantId) => ({
      tenantId,
      quotes: quotes.filter((row) => row.tenantId === tenantId).map((row) => this.toQuote(row)),
      customerCoupons: coupons.filter((row) => row.tenantId === tenantId).map((row) => this.toCoupon(row)),
      rewardLedger: rewards.filter((row) => row.tenantId === tenantId).map((row) => this.toRewardEntry(row)),
      benefitAccounts: accounts.filter((row) => row.tenantId === tenantId).map((row) => this.toBenefitAccount(row)),
      referrals: referrals.filter((row) => row.tenantId === tenantId).map((row) => ({
        inviteeCustomerId: row.inviteeCustomerId,
        referrerCustomerId: row.referrerCustomerId,
        registeredAt: iso(row.registeredAt)
      })),
      notificationLogs: logs.filter((row) => row.tenantId === tenantId).map((row) => this.toNotificationLog(row))
    }));
  }

  async upsertQuote(quote: RentalQuoteSnapshotV1): Promise<void> {
    const data = {
      tenantId: quote.tenantId,
      quoteNo: quote.quoteNo,
      categoryCode: upper<$Enums.RentalCategoryCode>(quote.categoryCode),
      request: quote.request as unknown as Prisma.InputJsonValue,
      chargeLines: quote.chargeLines as unknown as Prisma.InputJsonValue,
      rentalAmount: new Prisma.Decimal(quote.rentalAmount),
      discountAmount: new Prisma.Decimal(quote.discountAmount),
      couponAmount: new Prisma.Decimal(quote.couponAmount),
      serviceAmount: new Prisma.Decimal(quote.serviceAmount),
      depositAmount: new Prisma.Decimal(quote.depositAmount),
      payableAmount: new Prisma.Decimal(quote.payableAmount),
      pricingPlanVersion: quote.pricingPlanVersion,
      ruleVersion: quote.ruleVersion,
      ruleSnapshot: quote.ruleSnapshot as unknown as Prisma.InputJsonValue,
      calendarVersion: quote.calendarVersion ?? null,
      appliedDiscountPlanIds: quote.appliedDiscountPlanIds as unknown as Prisma.InputJsonValue,
      customerCouponId: quote.customerCouponId ?? null,
      expiresAt: date(quote.expiresAt),
      consumedAt: optionalDate(quote.consumedAt),
      consumedOrderId: quote.consumedOrderId ?? null
    };
    await this.prisma.rentalQuote.upsert({
      where: { id: quote.id },
      create: { id: quote.id, ...data, createdAt: date(quote.createdAt) },
      update: data
    });
  }

  async upsertCustomerCoupon(coupon: RentalCustomerCoupon): Promise<void> {
    const data = {
      tenantId: coupon.tenantId,
      customerId: coupon.customerId,
      templateId: coupon.templateId,
      templateCode: coupon.templateCode,
      templateName: coupon.templateName,
      status: coupon.status,
      claimedAt: date(coupon.claimedAt),
      effectiveFrom: date(coupon.effectiveFrom),
      effectiveTo: date(coupon.effectiveTo),
      lockedOrderId: coupon.lockedOrderId ?? null,
      lockedAt: optionalDate(coupon.lockedAt),
      redeemedOrderId: coupon.redeemedOrderId ?? null,
      redeemedAt: optionalDate(coupon.redeemedAt),
      releasedAt: optionalDate(coupon.releasedAt)
    };
    await this.prisma.rentalCustomerCoupon.upsert({
      where: { id: coupon.id },
      create: { id: coupon.id, ...data },
      update: data
    });
  }

  async upsertRewardEntry(entry: RentalRewardLedgerEntry): Promise<void> {
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
    await this.prisma.rentalRewardLedgerEntry.upsert({
      where: { id: entry.id },
      create: { id: entry.id, ...data, createdAt: date(entry.createdAt) },
      update: data
    });
  }

  async upsertBenefitAccount(account: RentalCustomerBenefitAccount): Promise<void> {
    const data = {
      pointsBalance: new Prisma.Decimal(account.pointsBalance),
      marketingBalance: new Prisma.Decimal(account.marketingBalance),
      availableRewardCouponCount: account.availableRewardCouponCount
    };
    await this.prisma.rentalBenefitAccount.upsert({
      where: { tenantId_customerId: { tenantId: account.tenantId, customerId: account.customerId } },
      create: { tenantId: account.tenantId, customerId: account.customerId, ...data },
      update: data
    });
  }

  async upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void> {
    await this.prisma.rentalReferral.upsert({
      where: { tenantId_inviteeCustomerId: { tenantId, inviteeCustomerId: referral.inviteeCustomerId } },
      create: {
        tenantId,
        inviteeCustomerId: referral.inviteeCustomerId,
        referrerCustomerId: referral.referrerCustomerId,
        registeredAt: date(referral.registeredAt)
      },
      update: { referrerCustomerId: referral.referrerCustomerId }
    });
  }

  /** 发送记录是追加式流水，用 create 而非 upsert：同一条记录不应被改写。 */
  async insertNotificationLog(log: RentalNotificationSendLogV1): Promise<void> {
    await this.prisma.rentalNotificationLog.create({
      data: {
        id: log.id,
        tenantId: log.tenantId,
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
        sentAt: optionalDate(log.sentAt),
        createdAt: date(log.createdAt)
      }
    });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toQuote(row: Prisma.RentalQuoteGetPayload<object>): RentalQuoteSnapshotV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      quoteNo: row.quoteNo,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      request: row.request as unknown as RentalQuoteRequest,
      chargeLines: (row.chargeLines ?? []) as unknown as RentalQuoteChargeLine[],
      rentalAmount: num(row.rentalAmount),
      discountAmount: num(row.discountAmount),
      couponAmount: num(row.couponAmount),
      serviceAmount: num(row.serviceAmount),
      depositAmount: num(row.depositAmount),
      payableAmount: num(row.payableAmount),
      pricingPlanVersion: row.pricingPlanVersion,
      ruleVersion: row.ruleVersion,
      ruleSnapshot: row.ruleSnapshot as unknown as RentalRuleConfig,
      calendarVersion: row.calendarVersion ?? undefined,
      appliedDiscountPlanIds: (row.appliedDiscountPlanIds ?? []) as string[],
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
      status: row.status as RentalCustomerCouponStatus,
      claimedAt: iso(row.claimedAt),
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: iso(row.effectiveTo),
      lockedOrderId: row.lockedOrderId ?? undefined,
      lockedAt: optionalIso(row.lockedAt),
      redeemedOrderId: row.redeemedOrderId ?? undefined,
      redeemedAt: optionalIso(row.redeemedAt),
      releasedAt: optionalIso(row.releasedAt)
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
      createdAt: iso(row.createdAt),
      sentAt: optionalIso(row.sentAt)
    };
  }
}
