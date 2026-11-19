/** Rental报价、券、奖励/权益与通知的MySQL事实仓储；宿主供给当前空间/可见范围和原事件。
 * 保存历史快照及原操作依据，复用调用方事务和金额精度；外部短信执行与批准由原服务负责。 */
import { matchesRentalCategoryCode, rentalCategoryStorageCode } from "./category-identity";
import { validateNewQuoteCapabilitySnapshot, validateQuotedCapabilityRequirements } from "./mysql-quote-capabilities";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma, $Enums } from "@prisma/client";
import { Decimal, sqltag as sql, raw, objectEnumValues, PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { isDeepStrictEqual } from "node:util";
import type {
  RentalCategoryCode,
  RentalCustomerBenefitAccount,
  RentalCustomerCoupon,
  RentalCustomerCouponStatus,
  RentalCouponTemplate,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalQuoteChargeLine,
  RentalQuoteRequest,
  RentalQuoteSnapshotV1,
  RentalRewardLedgerEntry,
  RentalRuleConfig
} from "./contracts";
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { readRentalFulfillmentAdmission } from './mysql-fulfillment-admission';
import { lockRentalBusinessTenant } from './mysql-business-fence';
import { assertRentalInventoryBasis } from './quote-inventory-basis';
import type { RentalBusinessFactTransaction, RentalBusinessFactStorage, RentalBusinessFactContacts } from "./business-fact-storage";
export type { RentalBusinessFactTransaction, RentalBusinessFactStorage, RentalBusinessFactContacts } from "./business-fact-storage";

// 所选客户端将同一runtime单例导出为带私有类型标记的DbNull；这里仅对齐该标记，不加载生成Client。
const DbNull = objectEnumValues.instances.DbNull as unknown as typeof Prisma.DbNull;

export type RentalBusinessFactTx = RentalBusinessFactTransaction;
/** Server-derived opaque hashes, never authorization or a client DTO. The key
 * must bind current actor/scope and the immutable originating operation. */
export type RentalQuoteOriginalOperation = Readonly<{ key: string; inputHash: string }>;
function quoteOriginalOperation(value: RentalQuoteOriginalOperation): RentalQuoteOriginalOperation {
  if (!value || !/^[a-f0-9]{64}$/u.test(value.key) || !/^[a-f0-9]{64}$/u.test(value.inputHash))
    throw new ConflictException('报价原操作绑定无效');
  return Object.freeze({ key: value.key, inputHash: value.inputHash });
}

/** 原仓储读取/认领得到的版本依据，只用于同条通知结果 CAS，不授予发送或查询权限。 */
export interface RentalNotificationDeliveryObservation {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly id: string;
  readonly revision: number;
}

export interface RentalNotificationDeliveryRecord {
  log: RentalNotificationSendLogV1;
  /** 仅服务端重试使用的收件人密文，不进入 RentalNotificationSendLogV1。 */
  recipientEncrypted?: string;
  maxAttempts: number;
  observation: RentalNotificationDeliveryObservation;
}

export interface RentalNotificationDeliveryPatch {
  /** 已派发结果沿原观察版本落库，撤权/请求结束不另开新准入，也不能覆盖后续认领或回执。 */
  observation?: RentalNotificationDeliveryObservation;
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

/** 单个经营空间的业务事实，用于启动装载，不能混入同租户其他空间。 */
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

/** 原全额奖励撤销的锁定事实。模板只投影需原子调整的计数，不重写当前模板配置。 */
export interface RentalRewardReversalFacts {
  entry: RentalRewardLedgerEntry;
  account?: RentalCustomerBenefitAccount;
  coupons: RentalCustomerCoupon[];
  couponTemplates: Array<Pick<RentalCouponTemplate, "id" | "claimedQuantity" | "updatedAt">>;
}

/** 发奖原事务已经持有相关写锁；只读取本次触达事实，不做全空间刷新或另开准入。 */
export interface RentalRewardGrantFacts {
  entries: RentalRewardLedgerEntry[];
  accounts: RentalCustomerBenefitAccount[];
  coupons: RentalCustomerCoupon[];
  couponTemplates: RentalRewardReversalFacts["couponTemplates"];
}

/** 领域服务的业务事实端口；原事务由调用方提供，库侧约束/隔离仍需真实持久化验证。 */
export interface RentalBusinessFactStore<TTransaction extends RentalBusinessFactTransaction = RentalBusinessFactTransaction> {
  loadAll(): Promise<TenantBusinessFactSnapshot[]>;
  findQuote(tenantId: string, quoteId: string, tx?: TTransaction): Promise<RentalQuoteSnapshotV1 | undefined>;
  /** Minimal immutable quote projection, reachable only by its visible original order. */
  readOrderLinkedQuoteFacts?(tenantId: string, workspaceId: string, orderId: string, quoteId: string): Promise<unknown | undefined>;
  consumeQuoteIfAvailable(tenantId: string, quoteId: string, orderId: string, consumedAt: string, tx: TTransaction): Promise<boolean>;
  lockCouponIfAvailable(tenantId: string, couponId: string, customerId: string | undefined, orderId: string, lockedAt: string, rentalStartAt: string, discountAmount: number, tx: TTransaction): Promise<boolean>;
  redeemCouponForOrder(tenantId: string, orderId: string, redeemedAt: string, tx: TTransaction): Promise<"none" | "redeemed" | "already_redeemed" | "invalid">;
  repriceOrderCoupon(tenantId: string, orderId: string, amount: number, tx: TTransaction): Promise<void>;
  releaseCouponForOrder(tenantId: string, orderId: string, releasedAt: string, tx: TTransaction): Promise<void>;
  expireClaimedCoupons(tenantId: string, expiredAt: string): Promise<number>;
  voidClaimedCoupon(tenantId: string, couponId: string, reason: string, voidedAt: string, tx: TTransaction): Promise<boolean>;
  upsertQuote(quote: RentalQuoteSnapshotV1, expectedBinding?: { categoryVersionId: string; adoptionRevision: number }): Promise<void>;
  saveQuoteForOriginalOperation?(quote: RentalQuoteSnapshotV1, original: RentalQuoteOriginalOperation,
    expectedBinding?: { categoryVersionId: string; adoptionRevision: number },
    beforePersist?: (native: TTransaction) => Promise<void>): Promise<RentalQuoteSnapshotV1>;
  findQuoteForOriginalOperation?(tenantId: string, original: RentalQuoteOriginalOperation): Promise<RentalQuoteSnapshotV1 | undefined>;
  findQuoteForOriginalReference?(tenantId: string, key: string): Promise<RentalQuoteSnapshotV1 | undefined>;
  /**
   * 传入 tx 时必须使用它。领券由幂等执行器包在事务里，若这里另起连接独立提交，
   * 事务回滚撤不回这张券，会留下"幂等表已回滚、客户券已存在"的孤儿。
   */
  upsertCustomerCoupon(coupon: RentalCustomerCoupon, tx?: TTransaction): Promise<void>;
  countCustomerCoupons(tenantId: string, templateId: string, customerId: string, tx: TTransaction): Promise<number>;
  /**
   * 按幂等键查既有奖励流水，用于以库为准判重。
   * 必须按前缀匹配：grantReward 会派生 `<key>:referrer` / `<key>:invitee` 子键，
   * 只按精确键查会漏掉双边邀请奖励，导致重复入账。
   */
  findRewardsByIdempotencyKey(tenantId: string, key: string, tx?: TTransaction): Promise<RentalRewardLedgerEntry[]>;
  upsertRewardEntry(entry: RentalRewardLedgerEntry, tx?: TTransaction): Promise<void>;
  readRewardGrantFacts(tenantId: string, entries: readonly RentalRewardLedgerEntry[], tx: TTransaction): Promise<RentalRewardGrantFacts>;
  reverseRewardAtomically(tenantId: string, id: string, apply: (facts: RentalRewardReversalFacts) => void): Promise<RentalRewardReversalFacts>;
  upsertBenefitAccount(account: RentalCustomerBenefitAccount, tx?: TTransaction): Promise<void>;
  incrementBenefitAccount(tenantId: string, customerId: string, delta: { points: number; marketing: number; rewardCoupons: number }, tx: TTransaction): Promise<void>;
  upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void>;
  insertNotificationLog(
    log: RentalNotificationSendLogV1,
    tx?: TTransaction,
    recipientEncrypted?: string,
    recipientFingerprint?: string
  ): Promise<"inserted" | "duplicate">;
  reserveSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: TTransaction
  ): Promise<{ allowed: boolean; retryAt: string }>;
  releaseSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: TTransaction
  ): Promise<void>;
  findNotificationDelivery(tenantId: string, id: string): Promise<RentalNotificationDeliveryRecord | undefined>;
  /** 到期待投递：queued/failed、nextAttemptAt 已到且租约不存在或已过期。 */
  listDueNotificationDeliveries(tenantId: string, at: string, limit: number): Promise<RentalNotificationDeliveryRecord[]>;
  /** 认领只写租约，不消耗 attempts；attempts 由 updateNotificationDelivery({ countAttempt: true }) 递增。 */
  claimNotificationDelivery(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<boolean>;
  /** 同原认领算法返回提交后的原版本，供发送结果 CAS；旧 boolean 接口仍保留。 */
  claimNotificationDeliveryForDispatch(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<RentalNotificationDeliveryRecord | undefined>;
  /** 运输紧前的短事务复核；不把数据库事务跨越第三方调用。 */
  assertNotificationDeliveryCurrent(tenantId: string, id: string, observation: RentalNotificationDeliveryObservation): Promise<void>;
  /** 原记录在运输前持久化为不可重发的 unknown；返回新版本供结果 CAS。提交未知时不得调用供应商。 */
  beginNotificationDispatch(tenantId: string, id: string, observation: RentalNotificationDeliveryObservation): Promise<RentalNotificationDeliveryRecord>;
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

function num(value: Decimal): number {
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

/** 数据库持有原事实、快照和投递状态；当前身份/范围及事件参与者通过宿主接点供给。 */
export class RentalBusinessFactRepository<TTransaction extends RentalBusinessFactTransaction = RentalBusinessFactTransaction>
  implements RentalBusinessFactStore<TTransaction> {
  constructor(private readonly store: RentalBusinessFactStorage<TTransaction>,
    private readonly contacts: RentalBusinessFactContacts<TTransaction>) {}

  async loadAll(): Promise<TenantBusinessFactSnapshot[]> {
    const [workspaces, quotes, coupons, rewards, accounts, referrals, logs] = await Promise.all([
      this.store.businessWorkspace.findMany({ select: { id: true, tenantId: true } }),
      this.store.rentalQuote.findMany({ orderBy: { createdAt: "desc" } }),
      this.store.rentalCustomerCoupon.findMany({ orderBy: { claimedAt: "desc" } }),
      this.store.rentalRewardLedgerEntry.findMany({ orderBy: { createdAt: "desc" } }),
      this.store.rentalBenefitAccount.findMany(),
      this.store.rentalReferral.findMany({ orderBy: { registeredAt: "desc" } }),
      this.store.rentalNotificationLog.findMany({ orderBy: { createdAt: "desc" } })
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

  async findQuote(tenantId: string, quoteId: string, tx?: TTransaction): Promise<RentalQuoteSnapshotV1 | undefined> {
    const client = tx ?? this.store;
    const workspaceId = await this.contacts.resolveWorkspaceId(client, tenantId);
    const row = await client.rentalQuote.findFirst({ where: { id: quoteId, tenantId, workspaceId } });
    return row ? this.toQuote(row) : undefined;
  }

  /** Never initializes business state or locates historical rates through current
   * configuration. Restrict the original parent before/after the bounded JOIN. */
  async readOrderLinkedQuoteFacts(tenantId: string, workspaceId: string, orderId: string, quoteId: string): Promise<unknown | undefined> {
    if (await this.contacts.resolveWorkspaceId(this.store, tenantId) !== workspaceId) throw new ForbiddenException('历史报价空间变化');
    const where = () => ({ id: orderId, tenantId, workspaceId, quoteId, ...this.contacts.orderVisibilityWhere() });
    const parent = await this.store.rentalOrder.findFirst({ where: where(), select: { id: true, updatedAt: true } });
    if (!parent) throw new ForbiddenException('历史报价原订单不可读或关联变化');
    const rows = await this.store.$queryRaw<Array<{ id: string; tenantId: string; workspaceId: string;
      createdAt: Date; currency: string; ruleVersion: string; pricingPlanVersion: string;
      priceVersionId: string | null; priceVersion: string | null; calendarVersion: string | null;
      ratesType: string | null; rateCount: bigint | number | null; rates: unknown;
      contextType: string | null; context: unknown }>>(sql`
      SELECT q.id, q.tenantId, q.workspaceId, q.createdAt, q.currency, q.ruleVersion, q.pricingPlanVersion,
        q.priceVersionId, q.priceVersion, q.calendarVersion, JSON_TYPE(q.rateSnapshot) AS ratesType,
        JSON_LENGTH(q.rateSnapshot) AS rateCount,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CASE WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].id'))) = 'STRING' THEN j.rateId ELSE NULL END,
          'itemGroupId', CASE WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].itemGroupId'))) = 'STRING' THEN j.itemGroupId ELSE NULL END,
          'pricingGroupId', CASE WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].pricingGroupId'))) = 'STRING' THEN j.pricingGroupId
            WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].pricingGroupId'))) IS NULL THEN NULL ELSE '!' END,
          'unit', CASE WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].unit'))) = 'STRING' THEN j.rateUnit ELSE NULL END,
          'baseAmount', CASE WHEN JSON_TYPE(JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].baseAmount'))) IN ('INTEGER', 'DOUBLE')
            THEN JSON_EXTRACT(q.rateSnapshot, CONCAT('$[', j.ordinality - 1, '].baseAmount')) ELSE NULL END))
          FROM JSON_TABLE(CASE WHEN JSON_TYPE(q.rateSnapshot) = 'ARRAY' AND JSON_LENGTH(q.rateSnapshot) <= 100
            THEN q.rateSnapshot ELSE JSON_ARRAY() END, '$[*]' COLUMNS(ordinality FOR ORDINALITY,
              rateId VARCHAR(192) PATH '$.id', itemGroupId VARCHAR(192) PATH '$.itemGroupId',
              pricingGroupId VARCHAR(192) PATH '$.pricingGroupId', rateUnit VARCHAR(32) PATH '$.unit')) AS j) AS rates,
        JSON_TYPE(q.pricingContext) AS contextType,
        CASE WHEN JSON_TYPE(q.pricingContext) = 'OBJECT' THEN JSON_OBJECT('timeZone',
          CASE WHEN JSON_TYPE(JSON_EXTRACT(q.pricingContext, '$.timeZone')) = 'STRING'
            THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(q.pricingContext, '$.timeZone')), 101) ELSE NULL END) ELSE NULL END AS context
      FROM rental_orders AS o JOIN rental_quotes AS q ON q.id = o.quoteId
        AND q.tenantId = o.tenantId AND q.workspaceId = o.workspaceId
      WHERE o.id = ${orderId} AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId}
        AND o.quoteId = ${quoteId} AND o.updatedAt = ${parent.updatedAt} LIMIT 1`);
    const after = await this.store.rentalOrder.findFirst({ where: where(), select: { id: true, updatedAt: true } });
    if (!after || after.updatedAt.getTime() !== parent.updatedAt.getTime()
      || await this.contacts.resolveWorkspaceId(this.store, tenantId) !== workspaceId) throw new ConflictException('历史报价读取期间订单或范围变化');
    if (!rows.length) return undefined;
    if (rows.length !== 1) throw new ConflictException('历史报价投影不唯一');
    const row = rows[0], absent = (type: string | null) => type === null || type === 'NULL';
    if (row.id !== quoteId || row.tenantId !== tenantId || row.workspaceId !== workspaceId) throw new ConflictException('历史报价来源绑定无效');
    if (!absent(row.ratesType) && row.ratesType !== 'ARRAY') throw new ConflictException('历史报价价格快照格式无效');
    if (!absent(row.contextType) && row.contextType !== 'OBJECT') throw new ConflictException('历史报价上下文格式无效');
    const count = row.ratesType === 'ARRAY' ? Number(row.rateCount) : 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 100) throw new ConflictException('历史报价价格快照超过只读上限');
    const rates = row.ratesType === 'ARRAY' ? (count === 0 ? [] : row.rates) : undefined;
    if (rates !== undefined && (!Array.isArray(rates) || rates.length !== count)) throw new ConflictException('历史报价价格投影不完整');
    // Optional target is absent, not null, in the original shared rate contract.
    const rateSnapshot = Array.isArray(rates) ? rates.map(value => {
      const rate = value as Record<string, unknown>;
      return { ...rate, pricingGroupId: rate.pricingGroupId === null ? undefined : rate.pricingGroupId };
    }) : undefined;
    return { id: row.id, tenantId: row.tenantId, createdAt: iso(row.createdAt), currency: row.currency,
      ruleVersion: row.ruleVersion, pricingPlanVersion: row.pricingPlanVersion, priceVersionId: row.priceVersionId ?? undefined,
      priceVersion: row.priceVersion ?? undefined, calendarVersion: row.calendarVersion ?? undefined,
      rateSnapshot, pricingContext: absent(row.contextType) ? undefined : row.context };
  }

  async findQuoteForOriginalOperation(tenantId: string, value: RentalQuoteOriginalOperation): Promise<RentalQuoteSnapshotV1 | undefined> {
    const original = quoteOriginalOperation(value);
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, tenantId);
    const row = await this.store.rentalQuote.findFirst({ where: { tenantId, workspaceId, originalOperationKey: original.key } });
    if (!row) return undefined; // Absence is not proof that an in-flight write failed.
    if (row.originalInputHash !== original.inputHash || row.originalOperationKey !== original.key
      || row.tenantId !== tenantId || row.workspaceId !== workspaceId
      || requestFingerprint(row.request) !== original.inputHash) throw new ConflictException('报价原操作输入冲突');
    return this.toQuote(row);
  }

  /** Historical observation: the input binding comes from the immutable row,
   * not a request re-normalized using today's configuration. Server-only key. */
  async findQuoteForOriginalReference(tenantId: string, key: string): Promise<RentalQuoteSnapshotV1 | undefined> {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) throw new ConflictException('报价原操作引用无效');
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, tenantId);
    const row = await this.store.rentalQuote.findFirst({ where: { tenantId, workspaceId, originalOperationKey: key } });
    if (!row) return undefined;
    const quote = this.toQuote(row);
    if (row.originalOperationKey !== key || row.tenantId !== tenantId || row.workspaceId !== workspaceId
      || row.originalInputHash !== requestFingerprint(quote.request)) throw new ConflictException('报价原操作持久依据无效');
    return quote;
  }

  async consumeQuoteIfAvailable(
    tenantId: string,
    quoteId: string,
    orderId: string,
    consumedAt: string,
    tx: TTransaction
  ): Promise<boolean> {
    const timestamp = date(consumedAt);
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
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
    rentalStartAt: string,
    discountAmount: number,
    tx: TTransaction
  ): Promise<boolean> {
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) return false;
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    const timestamp = date(lockedAt);
    const rentalTimestamp = date(rentalStartAt);
    // 券行和模板行都在外层「下单」事务中加锁。不同券并发消耗同一模板预算时，
    // 模板锁把预算判断串行化；同一张券并发时，券锁保证只有一个订单能占用。
    await tx.$queryRaw(sql`
      SELECT id FROM rental_customer_coupons
      WHERE id = ${couponId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const coupon = await tx.rentalCustomerCoupon.findFirst({
      where: { id: couponId, tenantId, workspaceId },
      select: { customerId: true, templateId: true, status: true, effectiveFrom: true, effectiveTo: true, applicableRentalFrom: true, applicableRentalTo: true }
    });
    if (!coupon || (customerId && coupon.customerId !== customerId) || coupon.status !== "claimed"
      || coupon.effectiveFrom > timestamp || coupon.effectiveTo < timestamp
      || (coupon.applicableRentalFrom && coupon.applicableRentalFrom > rentalTimestamp)
      || (coupon.applicableRentalTo && coupon.applicableRentalTo < rentalTimestamp)) return false;

    const templates = await tx.$queryRaw<Array<{ perCustomerUseLimit: number }>>(sql`
      SELECT perCustomerUseLimit FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const template = templates[0];
    if (!template) return false;
    const used = await tx.$queryRaw<Array<{ id: string }>>(sql`
      SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND templateId = ${coupon.templateId} AND customerId = ${coupon.customerId}
        AND status IN ('locked', 'redeemed')
      FOR UPDATE
    `);
    if (used.length >= template.perCustomerUseLimit) return false;
    const amount = new Decimal(discountAmount.toFixed(2));
    const budgetUpdated = await tx.$executeRaw(sql`
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
        effectiveTo: { gte: timestamp },
        AND: [
          { OR: [{ applicableRentalFrom: null }, { applicableRentalFrom: { lte: rentalTimestamp } }] },
          { OR: [{ applicableRentalTo: null }, { applicableRentalTo: { gte: rentalTimestamp } }] }
        ]
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

  async redeemCouponForOrder(tenantId: string, orderId: string, redeemedAt: string, tx: TTransaction): Promise<"none" | "redeemed" | "already_redeemed" | "invalid"> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    const timestamp = date(redeemedAt);
    await tx.$queryRaw(sql`
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
    await tx.$queryRaw(sql`
      SELECT id FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const budgetUpdated = await tx.$executeRaw(sql`
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
  async repriceOrderCoupon(tenantId: string, orderId: string, amount: number, tx: TTransaction): Promise<void> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    await tx.$queryRaw(sql`SELECT id FROM rental_customer_coupons
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND (lockedOrderId = ${orderId} OR redeemedOrderId = ${orderId}) FOR UPDATE`);
    const coupon = await tx.rentalCustomerCoupon.findFirst({ where: {
      tenantId, workspaceId, OR: [{ lockedOrderId: orderId }, { redeemedOrderId: orderId }]
    } });
    if (!coupon || !["locked", "redeemed"].includes(coupon.status)) throw new ConflictException("原订单优惠券账目缺失，不能自动续租核价");
    const delta = new Decimal(amount).minus(coupon.lockedDiscountAmount ?? 0);
    if (delta.isZero()) return;
    const column = coupon.status === "locked" ? raw("lockedBudget") : raw("redeemedBudget");
    const updated = await tx.$executeRaw(sql`UPDATE rental_coupon_templates
      SET ${column} = ${column} + ${delta}
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND ${column} + ${delta} >= 0
        AND (${delta} <= 0 OR totalBudget IS NULL OR totalBudget - lockedBudget - redeemedBudget >= ${delta})`);
    if (updated !== 1) throw new ConflictException("原优惠券预算不足或账目异常，请先处理后重新续租；未改变原租期");
    await tx.rentalCustomerCoupon.updateMany({ where: { id: coupon.id, tenantId, workspaceId, status: coupon.status }, data: { lockedDiscountAmount: amount } });
  }

  async releaseCouponForOrder(tenantId: string, orderId: string, releasedAt: string, tx: TTransaction): Promise<void> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    const timestamp = date(releasedAt);
    await tx.$queryRaw(sql`
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
    await tx.$queryRaw(sql`
      SELECT id FROM rental_coupon_templates
      WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
      FOR UPDATE
    `);
    const budgetUpdated = coupon.status === "locked"
      ? await tx.$executeRaw(sql`
          UPDATE rental_coupon_templates SET lockedBudget = lockedBudget - ${coupon.lockedDiscountAmount}
          WHERE id = ${coupon.templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
            AND lockedBudget >= ${coupon.lockedDiscountAmount}
        `)
      : await tx.$executeRaw(sql`
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
    const timestamp = date(expiredAt);
    return this.store.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
      const result = await tx.rentalCustomerCoupon.updateMany({
        where: { tenantId, workspaceId, status: "claimed", effectiveTo: { lt: timestamp } },
        data: { status: "expired", expiredAt: timestamp }
      });
      return result.count;
    }, { isolationLevel: "ReadCommitted" });
  }

  async voidClaimedCoupon(
    tenantId: string,
    couponId: string,
    reason: string,
    voidedAt: string,
    tx: TTransaction
  ): Promise<boolean> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    await tx.$queryRaw(sql`
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

  async upsertQuote(quote: RentalQuoteSnapshotV1, expectedBinding?: { categoryVersionId: string; adoptionRevision: number }): Promise<void> {
    await this.persistQuote(structuredClone(quote), expectedBinding && { ...expectedBinding });
  }

  async saveQuoteForOriginalOperation(quote: RentalQuoteSnapshotV1, value: RentalQuoteOriginalOperation,
    expectedBinding?: { categoryVersionId: string; adoptionRevision: number },
    beforePersist?: (native: TTransaction) => Promise<void>): Promise<RentalQuoteSnapshotV1> {
    const snapshot = structuredClone(quote), original = quoteOriginalOperation(value);
    if (requestFingerprint(snapshot.request) !== original.inputHash) throw new ConflictException('报价原操作输入冲突');
    return this.persistQuote(snapshot, expectedBinding && { ...expectedBinding }, original, beforePersist);
  }

  private async persistQuote(quote: RentalQuoteSnapshotV1, expectedBinding?: { categoryVersionId: string; adoptionRevision: number },
    original?: RentalQuoteOriginalOperation, beforePersist?: (native: TTransaction) => Promise<void>): Promise<RentalQuoteSnapshotV1> {
    const data = {
      tenantId: quote.tenantId,
      quoteNo: quote.quoteNo,
      sourceSnapshot: quote.sourceSnapshot === undefined ? DbNull : quote.sourceSnapshot as unknown as Prisma.InputJsonValue,
      inventoryBasis: quote.inventoryBasis === undefined ? DbNull : quote.inventoryBasis as unknown as Prisma.InputJsonValue,
      deliveryAddressSnapshot: quote.deliveryAddressSnapshot === undefined ? DbNull : quote.deliveryAddressSnapshot as unknown as Prisma.InputJsonValue,
      rentalLineAmounts: quote.rentalLineAmounts === undefined ? DbNull : quote.rentalLineAmounts as unknown as Prisma.InputJsonValue,
      categoryCode: rentalCategoryStorageCode(quote.categoryCode),
      categoryVersionId: quote.categoryVersionId ?? null,
      inspectionTemplateSnapshots: quote.inspectionTemplateSnapshots === undefined ? DbNull : quote.inspectionTemplateSnapshots as unknown as Prisma.InputJsonValue,
      request: quote.request as unknown as Prisma.InputJsonValue,
      membershipSnapshot: (quote.membershipSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      membershipBenefitEvaluations: (quote.membershipBenefitEvaluations ?? null) as unknown as Prisma.InputJsonValue,
      chargeLines: quote.chargeLines as unknown as Prisma.InputJsonValue,
      rentalAmount: new Decimal(quote.rentalAmount),
      discountAmount: new Decimal(quote.discountAmount),
      couponAmount: new Decimal(quote.couponAmount),
      serviceAmount: new Decimal(quote.serviceAmount),
      fulfillmentAmount: new Decimal(quote.fulfillmentAmount),
      rateSnapshot: quote.rateSnapshot as unknown as Prisma.InputJsonValue,
      calendarSnapshot: quote.calendarSnapshot as unknown as Prisma.InputJsonValue,
      pricingContext: quote.pricingContext ? quote.pricingContext as unknown as Prisma.InputJsonValue : DbNull,
      calendarWarnings: quote.calendarWarnings as unknown as Prisma.InputJsonValue,
      preAuthAmount: new Decimal(quote.preAuthAmount),
      receivableAmount: new Decimal(quote.receivableAmount),
      taxRate: new Decimal(quote.taxRate ?? 0),
      taxAmount: new Decimal(quote.taxAmount ?? 0),
      currency: quote.currency ?? "CNY",
      depositAmount: new Decimal(quote.depositAmount),
      payableAmount: new Decimal(quote.payableAmount),
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
      capabilityRequirementsSnapshot: (quote.capabilityRequirementsSnapshot ?? null) as unknown as Prisma.InputJsonValue,
      capabilityDecisions: (quote.capabilityDecisions ?? null) as unknown as Prisma.InputJsonValue,
      customerCouponId: quote.customerCouponId ?? null,
      expiresAt: date(quote.expiresAt),
      consumedAt: optionalDate(quote.consumedAt),
      consumedOrderId: quote.consumedOrderId ?? null
    };
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, quote.tenantId);
    const persist = async (client: TTransaction) => {
      if (original) {
        const recorded = await client.rentalQuote.findFirst({ where: { tenantId: quote.tenantId, workspaceId, originalOperationKey: original.key } });
        if (recorded) {
          if (recorded.originalInputHash !== original.inputHash || !isDeepStrictEqual(recorded.request, quote.request))
            throw new ConflictException('报价原操作输入冲突');
          return this.toQuote(recorded);
        }
      }
      const existing = await client.rentalQuote.findUnique({
        where: { id: quote.id }
      });
      if (existing && (existing.tenantId !== quote.tenantId || existing.workspaceId !== workspaceId)) {
        throw new ConflictException("报价事实已属于其他租户或经营空间，拒绝覆盖");
      }
      if (existing && ['sourceSnapshot', 'inventoryBasis', 'deliveryAddressSnapshot', 'rentalLineAmounts'].some(field =>
        !isDeepStrictEqual(existing[field as keyof typeof existing] ?? null, quote[field as keyof typeof quote] ?? null))) {
        throw new ConflictException('已有报价的创建来源、地址及租金分摊不可改写或补造');
      }
      if (quote.sourceSnapshot && (quote.sourceSnapshot.tenantId !== quote.tenantId || quote.sourceSnapshot.workspaceId !== workspaceId)) {
        throw new ConflictException('报价创建来源与持久空间不一致');
      }
      if (existing && (existing.categoryVersionId ?? null) !== (quote.categoryVersionId ?? null)) {
        throw new ConflictException("已有报价的品类版本依据不可改写");
      }
      if (existing && !isDeepStrictEqual(existing.inspectionTemplateSnapshots ?? null, quote.inspectionTemplateSnapshots ?? null)) {
        throw new ConflictException("已有报价的检查模板快照不可改写");
      }
      if (existing && ["capabilityRequirementsSnapshot", "capabilitySnapshot"].some(field =>
        !isDeepStrictEqual(existing[field as keyof typeof existing] ?? null, quote[field as keyof typeof quote] ?? null))) {
        throw new ConflictException("已有报价的能力适用及执行快照不可改写");
      }
      if (existing) {
        if (original) throw new ConflictException('报价ID已存在，不能补造原操作依据');
        // Every saved quote freezes its business basis, including quotes which
        // predate operation keys. The decoder's legacy NULL-to-empty-array
        // projection is accepted for comparison only; no history is backfilled.
        const legacyEmptyLists = ['chargeLines', 'rateSnapshot', 'calendarSnapshot', 'calendarWarnings',
          'appliedDiscountPlanIds', 'discountEvaluations', 'serviceSnapshots'];
        for (const [field, value] of Object.entries(data)) {
          if (field === 'consumedAt' || field === 'consumedOrderId') continue;
          const saved = existing[field as keyof typeof existing];
          const same = field === 'categoryCode' ? matchesRentalCategoryCode(saved, quote.categoryCode)
            : value instanceof Decimal ? saved instanceof Decimal && value.equals(saved)
            : isDeepStrictEqual(value === DbNull ? null : value, saved)
              || saved === null && legacyEmptyLists.includes(field) && Array.isArray(value) && value.length === 0;
          if (!same) throw new ConflictException(existing.originalOperationKey ? '原操作报价依据不可改写' : '已有报价的业务依据不可改写');
        }
        if (existing.createdAt.getTime() !== date(quote.createdAt).getTime()) {
          throw new ConflictException('已有报价的创建时点不可改写');
        }
        const sameConsumption = optionalDate(quote.consumedAt)?.getTime() === existing.consumedAt?.getTime()
          && data.consumedOrderId === existing.consumedOrderId;
        // The original workspace mutex serializes this transition with quote
        // consumption. A delayed stale copy cannot erase or replace its winner.
        if (existing.consumedAt || existing.consumedOrderId) {
          if (!sameConsumption) throw new ConflictException('已有报价的消费依据不可清除或替换');
        } else if (data.consumedAt || data.consumedOrderId) {
          if (!data.consumedAt || !Number.isFinite(data.consumedAt.getTime()) || !data.consumedOrderId?.trim()) {
            throw new ConflictException('报价消费需要完整的原时点和订单依据');
          }
          await client.rentalQuote.update({ where: { id: quote.id }, data: {
            consumedAt: data.consumedAt, consumedOrderId: data.consumedOrderId } });
        }
      } else {
        // New quotes share the configuration writers' space lock. Replaying or
        // consuming an existing quote above never re-authorizes new business.
        await readRentalFulfillmentAdmission(client, quote.tenantId, workspaceId, [
          { locationId: quote.request.fulfillmentLocationId,
            capability: ["delivery", "onsite_delivery"].includes(quote.request.fulfillmentMode) ? "delivery" : "pickup",
            partner: quote.request.fulfillmentMode === "partner_pickup_return" },
          { locationId: quote.request.returnLocationId ?? quote.request.fulfillmentLocationId, capability: "return" }
        ]);
        if (expectedBinding) {
          const rows = await client.$queryRaw<Array<{ categoryVersionId: string | null; categoryAdoptionRevision: number }>>(sql`
            SELECT categoryVersionId, categoryAdoptionRevision FROM business_workspaces
            WHERE id = ${workspaceId} AND tenantId = ${quote.tenantId} FOR UPDATE
          `);
          const binding = rows[0];
          if (!binding || binding.categoryVersionId !== expectedBinding.categoryVersionId ||
              binding.categoryAdoptionRevision !== expectedBinding.adoptionRevision || quote.categoryVersionId !== expectedBinding.categoryVersionId) {
            throw new ConflictException("品类版本在报价期间已变化，请重新报价");
          }
        }
        await validateNewQuoteCapabilitySnapshot(client, workspaceId, quote);
        await validateQuotedCapabilityRequirements(client, workspaceId, quote);
        await assertRentalInventoryBasis(this.contacts.quoteConfiguration, quote.tenantId, workspaceId,
          quote.request.lines, quote.inventoryBasis, client);
        // 原宿主在Core准备和锁等待后，仅对新报价关闭自己的当前权限及材料期限。
        if (original) await beforePersist?.(client);
        await client.rentalQuote.create({
          data: { workspaceId, id: quote.id, ...data, createdAt: date(quote.createdAt),
            ...(original ? { originalOperationKey: original.key, originalInputHash: original.inputHash } : {}) }
        });
      }
      return quote;
    };
    return this.store.$transaction(async (tx) => {
      // Keep the current application fence before the original workspace mutex.
      // Saved receipts below do not reapply today's quote configuration rules.
      await lockRentalBusinessTenant(tx, quote.tenantId);
      await tx.$queryRaw(sql`SELECT id FROM business_workspaces
        WHERE id = ${workspaceId} AND tenantId = ${quote.tenantId} FOR UPDATE`);
      return persist(tx);
    }, { isolationLevel: "ReadCommitted" });
  }

  async upsertCustomerCoupon(coupon: RentalCustomerCoupon, tx?: TTransaction): Promise<void> {
    const data = {
      tenantId: coupon.tenantId,
      customerId: coupon.customerId,
      templateId: coupon.templateId,
      templateCode: coupon.templateCode,
      templateName: coupon.templateName,
      templateVersion: coupon.templateVersion,
      discountType: coupon.discountType,
      discountValue: new Decimal(coupon.discountValue),
      minimumSpend: new Decimal(coupon.minimumSpend),
      maximumDiscount: coupon.maximumDiscount === undefined ? null : new Decimal(coupon.maximumDiscount),
      appliesTo: coupon.appliesTo,
      stackableWithDiscountPlans: coupon.stackableWithDiscountPlans,
      applicableItemGroupIds: coupon.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      grantReason: coupon.grantReason,
      status: coupon.status,
      claimedAt: date(coupon.claimedAt),
      applicableRentalFrom: optionalDate(coupon.applicableRentalFrom),
      applicableRentalTo: optionalDate(coupon.applicableRentalTo),
      effectiveFrom: date(coupon.effectiveFrom),
      effectiveTo: date(coupon.effectiveTo),
      lockedOrderId: coupon.lockedOrderId ?? null,
      lockedAt: optionalDate(coupon.lockedAt),
      lockedDiscountAmount: coupon.lockedDiscountAmount === undefined ? null : new Decimal(coupon.lockedDiscountAmount),
      redeemedOrderId: coupon.redeemedOrderId ?? null,
      redeemedAt: optionalDate(coupon.redeemedAt),
      releasedAt: optionalDate(coupon.releasedAt),
      releaseReason: coupon.releaseReason ?? null,
      expiredAt: optionalDate(coupon.expiredAt),
      voidedAt: optionalDate(coupon.voidedAt),
      voidReason: coupon.voidReason ?? null
    };
    const workspaceId = await this.contacts.resolveWorkspaceId(tx ?? this.store, coupon.tenantId);
    const client = tx ?? this.store;
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
    tx?: TTransaction
  ): Promise<RentalRewardLedgerEntry[]> {
    const client = tx ?? this.store;
    // 奖励幂等键的唯一约束已是 (workspaceId, idempotencyKey)，判重也必须按空间，
    // 否则一个空间的发奖会被另一个空间的同键记录误判为重复。
    const workspaceId = await this.contacts.resolveWorkspaceId(client, tenantId);
    const rows = await client.rentalRewardLedgerEntry.findMany({
      where: { tenantId, workspaceId, OR: [{ idempotencyKey: key }, { idempotencyKey: { startsWith: `${key}:` } }] },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toRewardEntry(row));
  }

  async readRewardGrantFacts(tenantId: string, entries: readonly RentalRewardLedgerEntry[], tx: TTransaction): Promise<RentalRewardGrantFacts> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    const ids = entries.map(entry => entry.id);
    if (!ids.length || new Set(ids).size !== ids.length || entries.some(entry => entry.tenantId !== tenantId)) {
      throw new ConflictException("奖励提交结果的原流水范围无效");
    }
    const stored = await tx.rentalRewardLedgerEntry.findMany({ where: { tenantId, workspaceId, id: { in: ids } } });
    if (stored.length !== entries.length) throw new ConflictException("奖励提交结果缺少原流水");
    const rewards = entries.map(entry => {
      const row = stored.find(current => current.id === entry.id);
      if (!row) throw new ConflictException("奖励提交结果缺少原流水");
      return this.toRewardEntry(row);
    });
    const customerIds = [...new Set(rewards.map(row => row.customerId))];
    const accounts = await tx.rentalBenefitAccount.findMany({ where: { tenantId, workspaceId, customerId: { in: customerIds } } });
    if (accounts.length !== customerIds.length || customerIds.some(id => !accounts.some(row => row.customerId === id))) {
      throw new ConflictException("奖励提交结果缺少原权益账户");
    }
    const couponIds = [...new Set(rewards.filter(row => row.rewardType === "coupon").flatMap(row => row.benefitReferenceIds ?? []))];
    const coupons = couponIds.length ? await tx.rentalCustomerCoupon.findMany({ where: { tenantId, workspaceId, id: { in: couponIds } } }) : [];
    if (coupons.length !== couponIds.length || couponIds.some(id => !coupons.some(row => row.id === id))) {
      throw new ConflictException("奖励提交结果缺少原奖励券");
    }
    const couponTemplates: RentalRewardGrantFacts["couponTemplates"] = [];
    for (const templateId of [...new Set(coupons.map(row => row.templateId))].sort()) {
      // 原发奖已按稳定顺序锁模板并写入配额，再写账户；这里不能反向新增模板锁。
      const templates = await tx.$queryRaw<Array<{ id: string; claimedQuantity: number; updatedAt: Date }>>(sql`
        SELECT id, claimedQuantity, updatedAt FROM rental_coupon_templates
        WHERE id = ${templateId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}`);
      if (templates.length !== 1) throw new ConflictException("奖励提交结果缺少原券模板");
      couponTemplates.push({ ...templates[0], updatedAt: iso(templates[0].updatedAt) });
    }
    return { entries: rewards,
      accounts: accounts.map(row => this.toBenefitAccount(row)), coupons: coupons.map(row => this.toCoupon(row)), couponTemplates };
  }

  async reverseRewardAtomically(tenantId: string, id: string, apply: (facts: RentalRewardReversalFacts) => void): Promise<RentalRewardReversalFacts> {
    return this.store.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(sql`
        SELECT id FROM rental_reward_ledger_entries
        WHERE id = ${id} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException("奖励流水不存在");
      const stored = await tx.rentalRewardLedgerEntry.findUnique({ where: { id } });
      if (!stored || stored.tenantId !== tenantId || stored.workspaceId !== workspaceId) throw new NotFoundException("奖励流水不存在");
      const facts: RentalRewardReversalFacts = { entry: this.toRewardEntry(stored), coupons: [], couponTemplates: [] };
      if (stored.status === "reversed") return facts;
      if (stored.status !== "granted" || !Number.isFinite(facts.entry.amount) || facts.entry.amount <= 0 ||
        !["points", "balance", "coupon"].includes(facts.entry.rewardType)) throw new ConflictException("奖励原始依据不可用于全额撤销");

      if (facts.entry.rewardType === "coupon") {
        const references = facts.entry.benefitReferenceIds;
        if (!Array.isArray(references) || references.length !== facts.entry.amount ||
          references.some(reference => typeof reference !== "string" || !reference.trim()) || new Set(references).size !== references.length) {
          throw new ConflictException("奖励券原始关联不完整，不能撤销");
        }
        // 既有券与订单占用/核销/释放保持 coupon→template；grant/claim 的
        // template→coupon 只创建本次新 UUID 券，原奖励键在其模板锁之前即回放。
        // 本路径不另锁订单/空间，也不将计数调整升级成整份模板配置写入。
        for (const couponId of [...references].sort()) {
          await tx.$queryRaw(sql`SELECT id FROM rental_customer_coupons
            WHERE id = ${couponId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`);
          const coupon = await tx.rentalCustomerCoupon.findFirst({ where: { id: couponId, tenantId, workspaceId } });
          if (!coupon || coupon.customerId !== facts.entry.customerId || coupon.status !== "claimed") {
            throw new ConflictException("奖励券已锁定、核销或不存在，不能撤销");
          }
          facts.coupons.push(this.toCoupon(coupon));
        }
        const templateIds = [...new Set(facts.coupons.map(coupon => coupon.templateId))];
        if (templateIds.length !== 1) throw new ConflictException("奖励券模板关联不一致，不能撤销");
        const templates = await tx.$queryRaw<Array<{ id: string; claimedQuantity: number; updatedAt: Date }>>(sql`
          SELECT id, claimedQuantity, updatedAt FROM rental_coupon_templates
          WHERE id = ${templateIds[0]} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE
        `);
        if (templates.length !== 1) throw new ConflictException("奖励券原模板不存在，不能撤销配额");
        // 停用不抹去旧奖励的模板依据；只回收原配额，不把当前状态/价格覆盖为缓存值。
        facts.couponTemplates = templates.map(template => ({ ...template, updatedAt: iso(template.updatedAt) }));
      }

      await tx.$queryRaw(sql`SELECT customerId FROM rental_benefit_accounts
        WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND customerId = ${facts.entry.customerId} FOR UPDATE`);
      const accounts = await tx.rentalBenefitAccount.findMany({ where: { tenantId, workspaceId, customerId: facts.entry.customerId } });
      if (accounts.length !== 1) throw new ConflictException("客户权益账户不存在，不能撤销奖励");
      facts.account = this.toBenefitAccount(accounts[0]);
      apply(facts);
      const { account, entry } = facts;
      const reversedAt = entry.reversedAt;
      if (!account || entry.status !== "reversed" || !reversedAt || !Number.isFinite(Date.parse(reversedAt))) {
        throw new ConflictException("奖励撤销结果不完整，不能提交");
      }
      for (const coupon of facts.coupons) {
        if (!await this.voidClaimedCoupon(tenantId, coupon.id, entry.reason, reversedAt, tx)) {
          throw new ConflictException("奖励券状态变化，撤销未提交");
        }
      }
      for (const template of facts.couponTemplates) {
        await tx.$executeRaw(sql`UPDATE rental_coupon_templates
          SET claimedQuantity = ${template.claimedQuantity}, updatedAt = ${date(template.updatedAt)}
          WHERE id = ${template.id} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}`);
      }
      await this.upsertBenefitAccount(account, tx);
      await this.upsertRewardEntry(entry, tx);
      return facts;
    }, { isolationLevel: "ReadCommitted" });
  }

  async upsertRewardEntry(entry: RentalRewardLedgerEntry, tx?: TTransaction): Promise<void> {
    const data = {
      tenantId: entry.tenantId,
      customerId: entry.customerId,
      rewardType: entry.rewardType,
      amount: new Decimal(entry.amount),
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
    const client = tx ?? this.store;
    const workspaceId = await this.contacts.resolveWorkspaceId(client, entry.tenantId);
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

  async upsertBenefitAccount(account: RentalCustomerBenefitAccount, tx?: TTransaction): Promise<void> {
    const data = {
      pointsBalance: new Decimal(account.pointsBalance),
      marketingBalance: new Decimal(account.marketingBalance),
      availableRewardCouponCount: account.availableRewardCouponCount
    };
    const client = tx ?? this.store;
    const workspaceId = await this.contacts.resolveWorkspaceId(client, account.tenantId);
    await client.rentalBenefitAccount.upsert({
      // 按 (workspaceId, customerId) 键控。
      //
      // 原先键 (tenantId, customerId)，而积分与营销余额按需求是**空间级**的：
      // 同一客户在摄影空间和露营空间各有独立余额。用租户级键 upsert 时，
      // 第二个空间的写入会 update 掉第一个空间那行，余额互相覆盖而不是各记一行。
      where: { workspaceId_customerId: { workspaceId, customerId: account.customerId } },
      create: { workspaceId, tenantId: account.tenantId, customerId: account.customerId, ...data },
      update: data
    });
  }

  async incrementBenefitAccount(tenantId: string, customerId: string, delta: { points: number; marketing: number; rewardCoupons: number }, tx: TTransaction): Promise<void> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    await tx.$executeRaw(sql`
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
    tx: TTransaction
  ): Promise<number> {
    const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
    return tx.rentalCustomerCoupon.count({
      where: { tenantId, workspaceId, templateId, customerId, status: { not: "void" } }
    });
  }

  async upsertReferral(tenantId: string, referral: RentalReferralRecord): Promise<void> {
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, tenantId);
    await this.store.rentalReferral.upsert({
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
    tx?: TTransaction,
    recipientEncrypted?: string,
    recipientFingerprint?: string
  ): Promise<"inserted" | "duplicate"> {
    const run = async (client: TTransaction): Promise<"inserted" | "duplicate"> => {
      await lockRentalBusinessTenant(client, log.tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(client, log.tenantId);
      try {
        await client.rentalNotificationLog.create({
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
      } catch (error) {
        // 携带原业务幂等键的P2002沿既有重复通知路径返回duplicate，不覆盖原流水。
        // 其他错误继续抛给调用方，不能把存储失败当作已成功通知。
        // MySQL 的重复键错误只回滚当前语句、不中止外层事务，因此 tx 路径也安全。
        if (
          log.idempotencyKey &&
          error instanceof PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return "duplicate";
        }
        throw error;
      }
      await this.contacts.events?.notification(client, { tenantId: log.tenantId, workspaceId }, log.id);
      return "inserted";
    };
    return tx ? run(tx) : this.store.$transaction(run, { isolationLevel: "ReadCommitted" });
  }

  /**
   * 短信安全频率闸门。
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
    tx?: TTransaction
  ): Promise<{ allowed: boolean; retryAt: string }> {
    const nowMs = new Date(at).getTime();
    if (!Number.isFinite(nowMs)) throw new Error("短信频率限制时间无效");
    const recipientBucketStart = new Date(Math.floor(nowMs / (10 * 60 * 1000)) * 10 * 60 * 1000);
    const workspaceBucketStart = new Date(Math.floor(nowMs / (60 * 1000)) * 60 * 1000);
    const recipientLimit = 3;
    const workspaceLimit = 120;
    const run = async (client: RentalBusinessFactTransaction) => {
      await lockRentalBusinessTenant(client, tenantId);
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
          if (!(error instanceof PrismaClientKnownRequestError && error.code === "P2002")) throw error;
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
    return tx ? run(tx) : this.store.$transaction((client) => run(client), { isolationLevel: "ReadCommitted" });
  }

  async releaseSmsRate(
    tenantId: string,
    workspaceId: string,
    recipientFingerprint: string,
    at: string,
    tx?: TTransaction
  ): Promise<void> {
    const nowMs = new Date(at).getTime();
    if (!Number.isFinite(nowMs)) throw new Error("短信频率限制时间无效");
    const recipientBucketStart = new Date(Math.floor(nowMs / (10 * 60 * 1000)) * 10 * 60 * 1000);
    const workspaceBucketStart = new Date(Math.floor(nowMs / (60 * 1000)) * 60 * 1000);
    const run = async (client: RentalBusinessFactTransaction) => {
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
    else await this.store.$transaction((client) => run(client));
  }

  private notificationDelivery(row: Prisma.RentalNotificationLogGetPayload<object>): RentalNotificationDeliveryRecord {
    return {
      log: this.toNotificationLog(row),
      recipientEncrypted: row.recipientEncrypted ?? undefined,
      maxAttempts: row.maxAttempts,
      observation: Object.freeze({ tenantId: row.tenantId, workspaceId: row.workspaceId, id: row.id, revision: row.revision })
    };
  }

  async findNotificationDelivery(tenantId: string, id: string): Promise<RentalNotificationDeliveryRecord | undefined> {
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, tenantId);
    const row = await this.store.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
    return row ? this.notificationDelivery(row) : undefined;
  }

  async listDueNotificationDeliveries(tenantId: string, at: string, limit: number): Promise<RentalNotificationDeliveryRecord[]> {
    const workspaceId = await this.contacts.resolveWorkspaceId(this.store, tenantId);
    const now = date(at);
    const rows = await this.store.rentalNotificationLog.findMany({
      where: {
        tenantId,
        workspaceId,
        channel: "sms",
        status: { in: ["queued", "failed"] },
        nextAttemptAt: { lte: now },
        // 仅筛选到期调度候选；租约过期不证明上次未发送，是否可重试仍由原服务/收据裁定。
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }]
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(limit, 100))
    });
    return rows.filter((row) => row.attempts < row.maxAttempts).map((row) => this.notificationDelivery(row));
  }

  async claimNotificationDelivery(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<boolean> {
    return Boolean(await this.claimNotificationDeliveryForDispatch(tenantId, id, at, leaseUntil, force));
  }

  async claimNotificationDeliveryForDispatch(tenantId: string, id: string, at: string, leaseUntil: string, force: boolean): Promise<RentalNotificationDeliveryRecord | undefined> {
    return this.store.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
      const current = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
      if (!current || current.channel !== "sms" || !["queued", "failed", "delivery_failed"].includes(current.status)) return undefined;
      if (current.attempts >= current.maxAttempts) return undefined;
      const atMs = new Date(at).getTime();
      if (!force && current.nextAttemptAt && current.nextAttemptAt.getTime() > atMs) return undefined;
      // 认领只占原租约，不消耗 attempts；未知结果不进入这个状态集合。
      // 保留原人工 force 语义，结果 CAS 仍绑定本次认领的 revision。
      if (!force && current.leaseUntil && current.leaseUntil.getTime() > atMs) return undefined;
      const result = await tx.rentalNotificationLog.updateMany({
        where: {
          id, tenantId, workspaceId,
          status: { in: ["queued", "failed", "delivery_failed"] },
          revision: current.revision,
          attempts: current.attempts,
          leaseUntil: current.leaseUntil
        },
        data: { lastAttemptAt: date(at), leaseUntil: date(leaseUntil), revision: { increment: 1 } }
      });
      if (result.count !== 1) return undefined;
      const claimed = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
      if (!claimed) throw new ConflictException("通知认领结果不可用");
      return this.notificationDelivery(claimed);
    }, { isolationLevel: "ReadCommitted" });
  }

  private assertNotificationObservation(tenantId: string, id: string, observation: RentalNotificationDeliveryObservation) {
    if (!observation || observation.tenantId !== tenantId || observation.id !== id ||
      !observation.workspaceId?.trim() || !Number.isSafeInteger(observation.revision) || observation.revision < 1) {
      throw new ConflictException("通知结果缺少原记录范围或版本依据");
    }
    return Object.freeze({ tenantId, id, workspaceId: observation.workspaceId, revision: observation.revision });
  }

  async assertNotificationDeliveryCurrent(tenantId: string, id: string, observation: RentalNotificationDeliveryObservation): Promise<void> {
    const observed = this.assertNotificationObservation(tenantId, id, observation);
    await this.store.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
      if (workspaceId !== observed.workspaceId) throw new ForbiddenException("通知认领不属于当前经营空间");
      const current = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId, revision: observed.revision } });
      if (!current || current.channel !== "sms" || !["queued", "failed", "delivery_failed"].includes(current.status) ||
        current.attempts >= current.maxAttempts || !current.leaseUntil || current.leaseUntil.getTime() <= Date.now()) {
        throw new ConflictException("通知投递认领已变化，不能继续发送");
      }
    }, { isolationLevel: "ReadCommitted" });
  }

  async beginNotificationDispatch(tenantId: string, id: string, observation: RentalNotificationDeliveryObservation): Promise<RentalNotificationDeliveryRecord> {
    const observed = this.assertNotificationObservation(tenantId, id, observation);
    return this.store.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const workspaceId = await this.contacts.resolveWorkspaceId(tx, tenantId);
      if (workspaceId !== observed.workspaceId) throw new ForbiddenException("通知认领不属于当前经营空间");
      const current = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId, revision: observed.revision } });
      if (!current || current.channel !== "sms" || !["queued", "failed", "delivery_failed"].includes(current.status) ||
        current.attempts >= current.maxAttempts || !current.leaseUntil || current.leaseUntil.getTime() <= Date.now()) {
        throw new ConflictException("通知投递认领已变化，不能继续发送");
      }
      // 沿原状态和操作键保留运输不确定性。先提交这个不可重发状态，再访问
      // 供应商；进程退出、响应丢失或随后两次结果写失败都不能把它重新排回队列。
      // 认领/准备不消耗 attempts，仍由明确的本次结果写入递增并释放租约。
      const result = await tx.rentalNotificationLog.updateMany({
        where: { id, tenantId, workspaceId, revision: observed.revision, status: current.status, leaseUntil: current.leaseUntil },
        // 上次确定失败的回执不属于本次派发，不能拿它结束当前 unknown 后再开新发送。
        // 新回执只由本次供应商观察结果写入；原操作键与认领版本仍保持不变。
        data: { status: "delivery_uncertain", nextAttemptAt: null, providerMessageId: null, sentAt: null,
          errorMessage: "短信投递尚未取得确定结果；请按原记录核对，禁止重新发送", revision: { increment: 1 } }
      });
      if (result.count !== 1) throw new ConflictException("通知投递准备版本已变化，不能继续发送");
      const prepared = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
      if (!prepared) throw new ConflictException("通知投递准备结果不可用，禁止重新发送");
      return this.notificationDelivery(prepared);
    }, { isolationLevel: "ReadCommitted" });
  }

  async listSentNotificationDeliveries(tenantId: string, workspaceId: string, take: number): Promise<RentalNotificationDeliveryRecord[]> {
    const rows = await this.store.rentalNotificationLog.findMany({
      where: { tenantId, workspaceId, channel: "sms", status: { in: ["sent", "delivery_pending"] }, providerMessageId: { not: null }, recipientEncrypted: { not: null } },
      orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(1, Math.min(take, 200))
    });
    return rows.map((row) => this.notificationDelivery(row));
  }

  async updateNotificationDelivery(tenantId: string, id: string, patch: RentalNotificationDeliveryPatch): Promise<RentalNotificationSendLogV1 | undefined> {
    const observation = patch.observation ? this.assertNotificationObservation(tenantId, id, patch.observation) : undefined;
    const run = async (tx: TTransaction) => {
      // 记录已派发结果不产生新的发送权；沿原范围/版本 CAS，不能因撤权或请求
      // 退出丢失供应商结果，也不能覆盖另一轮认领。未传版本的旧调用保持原范围解析。
      const workspaceId = observation?.workspaceId ?? await this.contacts.resolveWorkspaceId(tx, tenantId);
      const result = await tx.rentalNotificationLog.updateMany({
        where: { id, tenantId, workspaceId, ...(observation ? { revision: observation.revision } : {}) },
        data: {
          revision: { increment: 1 },
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
      const row = await tx.rentalNotificationLog.findFirst({ where: { id, tenantId, workspaceId } });
      if (row) await this.contacts.events?.notification(tx, { tenantId, workspaceId }, id);
      return row ? this.toNotificationLog(row) : undefined;
    };
    return this.store.$transaction(run, { isolationLevel: "ReadCommitted" });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toQuote(row: Prisma.RentalQuoteGetPayload<object>): RentalQuoteSnapshotV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      quoteNo: row.quoteNo,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      categoryVersionId: row.categoryVersionId ?? undefined,
      sourceSnapshot: row.sourceSnapshot === null ? undefined : row.sourceSnapshot as unknown as RentalQuoteSnapshotV1['sourceSnapshot'],
      inventoryBasis: row.inventoryBasis == null ? undefined : row.inventoryBasis as unknown as RentalQuoteSnapshotV1['inventoryBasis'],
      deliveryAddressSnapshot: row.deliveryAddressSnapshot === null ? undefined : row.deliveryAddressSnapshot as unknown as RentalQuoteSnapshotV1['deliveryAddressSnapshot'],
      rentalLineAmounts: row.rentalLineAmounts === null ? undefined : row.rentalLineAmounts as unknown as RentalQuoteSnapshotV1['rentalLineAmounts'],
      inspectionTemplateSnapshots: row.inspectionTemplateSnapshots === null ? undefined : row.inspectionTemplateSnapshots as unknown as RentalQuoteSnapshotV1["inspectionTemplateSnapshots"],
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
      capabilityRequirementsSnapshot: (row.capabilityRequirementsSnapshot ?? undefined) as unknown as RentalQuoteSnapshotV1["capabilityRequirementsSnapshot"],
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
      applicableRentalFrom: optionalIso(row.applicableRentalFrom),
      applicableRentalTo: optionalIso(row.applicableRentalTo),
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
