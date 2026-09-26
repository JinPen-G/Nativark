import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  FeatureEntitlementSource,
  FeatureOwnership,
  SubscriptionPlan,
  SubscriptionReminderStage,
  SubscriptionRequestStatus,
  SubscriptionRequestType,
  SubscriptionServiceStatus,
  SubscriptionSource,
  type ExtendSubscriptionRequest,
  type FeatureReleaseStatus,
  type GrantTenantFeatureRequest,
  type HandleSubscriptionRequestRequest,
  type ProvisionSubscriptionRequest,
  type RenewSubscriptionRequest,
  type RevokeTenantFeatureRequest,
  type ScheduleNextSubscriptionRequest,
  type SetStandardPriceRequest,
  type StaffSubscriptionContext,
  type StandardPlanPricing,
  type SubmitSubscriptionRequestRequest,
  type SubscriptionChangeLogEntry,
  type SubscriptionExpiryReminder,
  type SubscriptionFeatureCatalogEntry,
  type SubscriptionFeatureEntitlement,
  type SubscriptionMoney,
  type SubscriptionRequestRecord,
  type TenantSubscriptionOverview,
  type TenantSubscriptionView,
  type UpgradeSubscriptionProRequest,
  type UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import type {
  Prisma,
  FeatureOwnership as DbOwnership,
  FeatureReleaseStatus as DbRelease,
  SubscriptionEventType as DbEventType,
  SubscriptionPlan as DbPlan,
  SubscriptionRequestStatus as DbReqStatus,
  SubscriptionRequestType as DbReqType,
  SubscriptionSource as DbSource
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { anniversaryFromAnchor, endFromServiceYears, exclusiveEndFromDate, isValidTimeZone } from "./subscription-term";

/** 到期提醒阈值（天）：默认 30/7（§5.4 可配置，此处为默认建议值，非强制收费规则）。 */
const REMINDER_NORMAL_DAYS = 30;
const REMINDER_URGENT_DAYS = 7;
const DAY_MS = 86400000;

/**
 * Prisma 客户端枚举值 = 成员名（大写下划线，如 "HISTORICAL_REGISTER"）；
 * 共享契约枚举值 = @map 值（小写下划线，如 "historical_register"）。二者仅大小写不同，
 * 故双向用大小写转换即可，避免维护 8 张易漂移的映射表。
 */
function toShared<T extends string>(dbValue: string): T {
  return dbValue.toLowerCase() as T;
}
function toDb(sharedValue: string): string {
  return sharedValue.toUpperCase();
}

type SubRow = { plan: DbPlan; startAt: Date | null; endAt: Date | null } | null;

/**
 * SUB-01：SaaS 版本订阅框架服务（平台域）。
 * 服务状态实时推导、不落库（§11.2）；功能可用按"公共下放 ∪ 单租户特批 ∪ PRO"并集判定、
 * 不硬编码 PRO（§9.1）；金额一律可空、缺失=待确认/待公布、不落 0（§14.2）。
 * 写操作在事务内追加 SubscriptionEvent 审计，乐观锁按 revision 防并发覆盖（§11.2/A06）。
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 由起止时点 + 当前时间实时推导服务状态（§4.2）。无订阅/缺日期=unconfigured，不当作永久。 */
  private deriveStatus(sub: SubRow, now: Date): SubscriptionServiceStatus {
    if (!sub || !sub.startAt || !sub.endAt) return SubscriptionServiceStatus.Unconfigured;
    if (now < sub.startAt) return SubscriptionServiceStatus.PendingActivation;
    if (now >= sub.endAt) return SubscriptionServiceStatus.Expired;
    const daysLeft = Math.ceil((sub.endAt.getTime() - now.getTime()) / DAY_MS);
    return daysLeft <= REMINDER_NORMAL_DAYS ? SubscriptionServiceStatus.Expiring : SubscriptionServiceStatus.Active;
  }

  /** 金额缺额或缺币种一律返回 null（待确认/待公布），绝不落 0（§14.2）。 */
  private money(amount: unknown, currency: string | null, taxInclusive?: boolean | null): SubscriptionMoney | null {
    if (amount == null || !currency) return null;
    const value = Number(amount);
    // 与 normalizeAmount 同口径：0/负数一律按待确认处理、绝不显示 0（§14.2），
    // 兼容历史/迁移数据可能残留的 0 值。
    if (!Number.isFinite(value) || value <= 0) return null;
    return { amount: value, currency, ...(taxInclusive == null ? {} : { taxInclusive }) };
  }

  /** SUB-04A：到期只停"新业务"（§4.8）——仅 Expired 拦截；未配置/待生效/有效期内一律放行
   *（存量未登记租户不被误停业，§SUB-01E/§4.6）。守卫在各"新业务"入口调用它。 */
  async assertTenantWithinTerm(tenantId: string): Promise<void> {
    const sub = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (this.deriveStatus(sub, new Date()) === SubscriptionServiceStatus.Expired) {
      throw new ForbiddenException("SaaS 订阅已到期，暂停办理新业务；既有订单的履约、归还、退款、退押与争议不受影响，续费后恢复");
    }
  }

  /** 租户「版本与订阅」页一次拉取的聚合只读视图（§5.2）。 */
  async getTenantView(tenantId: string): Promise<TenantSubscriptionView> {
    const now = new Date();
    const [tenant, sub, scheduled, catalog, grants, requests, events, prices] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, code: true } }),
      this.prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      this.prisma.tenantSubscriptionSegment.findFirst({ where: { tenantId, status: "SCHEDULED" }, orderBy: { startAt: "asc" } }),
      this.prisma.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] }),
      this.prisma.tenantFeatureGrant.findMany({ where: { tenantId, revokedAt: null } }),
      this.prisma.subscriptionRequest.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
      this.prisma.subscriptionEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.subscriptionStandardPrice.findMany()
    ]);
    if (!tenant) throw new NotFoundException("租户不存在");
    const plan = sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard;
    const grantCodes = new Set(grants.map((g) => g.featureCode));
    return {
      overview: this.toOverview(tenant, sub, scheduled, now),
      entitlements: this.buildEntitlements(catalog, plan, grantCodes),
      standardPricing: this.buildPricing(prices),
      requests: requests.map((r) => this.toRequestRecord(r)),
      changeLog: events.map((e) => this.toChangeLog(e)),
      reminder: this.buildReminder(sub, requests, now)
    };
  }

  /** SUB-MP：员工小程序只读订阅/权益上下文（§4.4）。任意已登录员工可读自身租户；金额结构性脱敏（§SUB-MP-02）。 */
  async getStaffContext(tenantId: string): Promise<StaffSubscriptionContext> {
    const now = new Date();
    const [tenant, sub, scheduled, catalog, grants, pendingRequests] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, code: true } }),
      this.prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      this.prisma.tenantSubscriptionSegment.findFirst({ where: { tenantId, status: "SCHEDULED" }, orderBy: { startAt: "asc" } }),
      this.prisma.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] }),
      this.prisma.tenantFeatureGrant.findMany({ where: { tenantId, revokedAt: null } }),
      this.prisma.subscriptionRequest.findMany({ where: { tenantId, status: "PENDING" } })
    ]);
    if (!tenant) throw new NotFoundException("租户不存在");
    const plan = sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard;
    const full = this.toOverview(tenant, sub, scheduled, now);
    // 金额结构性脱敏：显式挑字段，绝不含 currentAmount/handledAt（§SUB-MP-02 员工不看内部商业明细）。
    const overview: StaffSubscriptionContext["overview"] = {
      tenantId: full.tenantId,
      tenantName: full.tenantName,
      tenantCode: full.tenantCode,
      plan: full.plan,
      serviceStatus: full.serviceStatus,
      ...(full.source ? { source: full.source } : {}),
      ...(full.startAt ? { startAt: full.startAt } : {}),
      ...(full.endAt ? { endAt: full.endAt } : {}),
      ...(full.timeZone ? { timeZone: full.timeZone } : {}),
      ...(full.next ? { next: full.next } : {}),
      revision: full.revision
    };
    return {
      overview,
      entitlements: this.buildEntitlements(catalog, plan, new Set(grants.map((g) => g.featureCode))),
      reminder: this.buildReminder(sub, pendingRequests, now)
    };
  }

  /** 左下角到期浮窗只读数据（§5.4）。 */
  async getReminder(tenantId: string): Promise<SubscriptionExpiryReminder> {
    const now = new Date();
    const [sub, requests] = await Promise.all([
      this.prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      this.prisma.subscriptionRequest.findMany({ where: { tenantId, status: "PENDING" } })
    ]);
    return this.buildReminder(sub, requests, now);
  }

  /** 平台端租户订阅列表（§8）；支持 plan/serviceStatus/dueWithin(天)/keyword 过滤。 */
  async listOverviews(filter: { plan?: string; serviceStatus?: string; dueWithin?: number; keyword?: string } = {}): Promise<TenantSubscriptionOverview[]> {
    const now = new Date();
    const [subs, scheduledRows] = await Promise.all([
      this.prisma.tenantSubscription.findMany({ include: { tenant: { select: { id: true, name: true, code: true } } } }),
      this.prisma.tenantSubscriptionSegment.findMany({ where: { status: "SCHEDULED" }, orderBy: { startAt: "asc" } })
    ]);
    const scheduledByTenant = new Map<string, (typeof scheduledRows)[number]>();
    for (const seg of scheduledRows) if (!scheduledByTenant.has(seg.tenantId)) scheduledByTenant.set(seg.tenantId, seg);
    const keyword = filter.keyword?.trim().toLowerCase();
    const plan = filter.plan?.trim().toLowerCase();
    const serviceStatus = filter.serviceStatus?.trim().toLowerCase();
    const dueWithin = typeof filter.dueWithin === "number" && Number.isFinite(filter.dueWithin) ? filter.dueWithin : undefined;
    return subs
      .map((s) => this.toOverview(s.tenant, s, scheduledByTenant.get(s.tenantId) ?? null, now))
      .filter((o) => (plan ? o.plan === plan : true))
      .filter((o) => (serviceStatus ? o.serviceStatus === serviceStatus : true))
      .filter((o) => (dueWithin == null ? true : this.dueWithinDays(o.endAt, now, dueWithin)))
      .filter((o) => (keyword ? `${o.tenantName}${o.tenantCode}`.toLowerCase().includes(keyword) : true));
  }

  /** 功能权益并集判定（§3.5/§9.1）：按 catalog.currentOwnership + 单租户特批 + 当前套餐，绝不硬编码 PRO。 */
  private buildEntitlements(
    rows: Array<{ code: string; name: string; module: string; categories: unknown; defaultOwnership: DbOwnership; currentOwnership: DbOwnership; releaseStatus: DbRelease; valueText: string | null; externalFeeNote: string | null }>,
    plan: SubscriptionPlan,
    grants: Set<string>
  ): SubscriptionFeatureEntitlement[] {
    return rows.map((row) => {
      const currentOwnership = toShared<FeatureOwnership>(row.currentOwnership);
      let source: FeatureEntitlementSource;
      if (currentOwnership === FeatureOwnership.Standard) source = FeatureEntitlementSource.StandardPublic;
      else if (grants.has(row.code)) source = FeatureEntitlementSource.TenantGrant;
      else if (plan === SubscriptionPlan.Pro) source = FeatureEntitlementSource.Pro;
      else source = FeatureEntitlementSource.NeedsUpgrade;
      const available = row.releaseStatus === "RELEASED" && source !== FeatureEntitlementSource.NeedsUpgrade;
      return {
        code: row.code,
        name: row.name,
        module: row.module,
        categories: ((row.categories as string[] | null) ?? []),
        defaultOwnership: toShared<FeatureOwnership>(row.defaultOwnership),
        currentOwnership,
        releaseStatus: toShared<FeatureReleaseStatus>(row.releaseStatus),
        source,
        available,
        ...(row.valueText ? { valueText: row.valueText } : {}),
        ...(row.externalFeeNote ? { externalFeeNote: row.externalFeeNote } : {})
      };
    });
  }

  /** 基础版/PRO 各一条标准价（未发布 published=false，缺价 annualFee=null，不落 0，§14.2 S-D01）。 */
  private buildPricing(rows: Array<{ plan: DbPlan; annualFee: unknown; currency: string | null; taxInclusive: boolean | null; published: boolean; priceVersion: string | null; note: string | null }>): StandardPlanPricing[] {
    const byPlan = new Map(rows.map((r) => [r.plan as string, r]));
    return [SubscriptionPlan.Standard, SubscriptionPlan.Pro].map((plan) => {
      const row = byPlan.get(toDb(plan));
      if (!row) return { plan, published: false };
      return {
        plan,
        annualFee: this.money(row.annualFee, row.currency, row.taxInclusive),
        published: row.published,
        ...(row.priceVersion ? { priceVersion: row.priceVersion } : {}),
        ...(row.note ? { note: row.note } : {})
      };
    });
  }

  /** endAt 距 now 的天数是否 <= within（用于列表「即将到期」过滤）。 */
  private dueWithinDays(endAtIso: string | undefined, now: Date, within: number): boolean {
    if (!endAtIso) return false;
    const days = Math.ceil((new Date(endAtIso).getTime() - now.getTime()) / DAY_MS);
    return days <= within;
  }

  /** 到期浮窗阶段/影响文案（§5.4）。到期只停"新业务"，已有订单与资金流水不受影响。 */
  private buildReminder(
    sub: { plan: DbPlan; startAt: Date | null; endAt: Date | null } | null,
    requests: Array<{ status: DbReqStatus }>,
    now: Date
  ): SubscriptionExpiryReminder {
    const plan = sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard;
    const serviceStatus = this.deriveStatus(sub, now);
    const hasOpenRequest = requests.some((r) => r.status === "PENDING");
    let stage = SubscriptionReminderStage.None;
    let remainingDays: number | undefined;
    let message: string | undefined;
    if (sub?.endAt) {
      remainingDays = Math.ceil((sub.endAt.getTime() - now.getTime()) / DAY_MS);
      if (serviceStatus === SubscriptionServiceStatus.Expired) {
        stage = SubscriptionReminderStage.Expired;
        message = "服务已到期：暂停办理新业务，已有订单与资金流水不受影响，续费后恢复。";
      } else if (remainingDays <= REMINDER_URGENT_DAYS) {
        stage = SubscriptionReminderStage.Urgent;
        message = `服务将在 ${remainingDays} 天后到期，请尽快续费以免影响新业务办理。`;
      } else if (remainingDays <= REMINDER_NORMAL_DAYS) {
        stage = SubscriptionReminderStage.Normal;
        message = `服务将在 ${remainingDays} 天后到期。`;
      }
    }
    return {
      plan,
      serviceStatus,
      ...(sub?.endAt ? { endAt: sub.endAt.toISOString() } : {}),
      ...(remainingDays == null ? {} : { remainingDays }),
      stage,
      ...(message ? { message } : {}),
      hasOpenRequest
    };
  }

  private toOverview(
    tenant: { id: string; name: string; code: string },
    sub: { plan: DbPlan; source: DbSource; startAt: Date | null; endAt: Date | null; serviceTimeZone: string | null; currentAmount: unknown; currentCurrency: string | null; handledAt: Date | null; revision: number } | null,
    scheduled: { plan: DbPlan; startAt: Date | null } | null,
    now: Date
  ): TenantSubscriptionOverview {
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantCode: tenant.code,
      plan: sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard,
      serviceStatus: this.deriveStatus(sub, now),
      ...(sub ? { source: toShared<SubscriptionSource>(sub.source) } : {}),
      ...(sub?.startAt ? { startAt: sub.startAt.toISOString() } : {}),
      ...(sub?.endAt ? { endAt: sub.endAt.toISOString() } : {}),
      ...(sub?.serviceTimeZone ? { timeZone: sub.serviceTimeZone } : {}),
      currentAmount: sub ? this.money(sub.currentAmount, sub.currentCurrency) : null,
      ...(sub?.handledAt ? { handledAt: sub.handledAt.toISOString() } : {}),
      ...(scheduled ? { next: { plan: toShared<SubscriptionPlan>(scheduled.plan), ...(scheduled.startAt ? { effectiveAt: scheduled.startAt.toISOString() } : {}) } } : {}),
      revision: sub?.revision ?? 0
    };
  }

  private toRequestRecord(r: {
    id: string; type: DbReqType; targetPlan: DbPlan | null; contactName: string | null; createdAt: Date;
    status: DbReqStatus; handledAmount: unknown; handledCurrency: string | null; periodText: string | null;
    publicReason: string | null; timeline: unknown;
  }): SubscriptionRequestRecord {
    return {
      id: r.id,
      type: toShared<SubscriptionRequestType>(r.type),
      ...(r.targetPlan ? { targetPlan: toShared<SubscriptionPlan>(r.targetPlan) } : {}),
      ...(r.contactName ? { submittedBy: r.contactName } : {}),
      submittedAt: r.createdAt.toISOString(),
      status: toShared<SubscriptionRequestStatus>(r.status),
      handledAmount: this.money(r.handledAmount, r.handledCurrency),
      ...(r.periodText ? { periodText: r.periodText } : {}),
      ...(r.publicReason ? { reason: r.publicReason } : {}),
      ...(Array.isArray(r.timeline) ? { timeline: r.timeline as SubscriptionRequestRecord["timeline"] } : {})
    };
  }

  private toChangeLog(e: { id: string; type: DbEventType; effectiveAt: Date | null; beforeJson: unknown; afterJson: unknown; reason: string | null; createdAt: Date }): SubscriptionChangeLogEntry {
    return {
      id: e.id,
      action: EVENT_ACTION_TEXT[e.type] ?? e.type,
      ...(e.effectiveAt ? { effectiveAt: e.effectiveAt.toISOString() } : {}),
      ...(e.beforeJson == null ? {} : { beforeText: this.describeState(e.beforeJson) }),
      ...(e.afterJson == null ? {} : { afterText: this.describeState(e.afterJson) }),
      ...(e.reason ? { reason: e.reason } : {}),
      operatedAt: e.createdAt.toISOString()
    };
  }

  /** 审计快照的人类可读摘要（版本 + 起止），仅用于变更记录展示。 */
  private describeState(json: unknown): string {
    const s = json as { plan?: string; startAt?: string; endAt?: string } | null;
    if (!s || typeof s !== "object") return "";
    const plan = s.plan ? s.plan.toUpperCase() : "";
    const range = s.startAt || s.endAt ? `${s.startAt?.slice(0, 10) ?? "?"} ~ ${s.endAt?.slice(0, 10) ?? "?"}` : "";
    return [plan, range].filter(Boolean).join(" ");
  }

  private parseInstant(iso: string, message: string): Date {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(message);
    return d;
  }

  /** 乐观并发：另一管理员已改期限/价格时，用 expectedRevision 不一致拦下，提示刷新（§11.2/A06）。 */
  private assertRevision(current: number | undefined, expected?: number): void {
    if (expected != null && current != null && expected !== current) {
      throw new ConflictException("订阅已被其他管理员更新，请刷新后基于最新结果重试");
    }
  }

  /**
   * 事务内按乐观锁做原子条件更新并自增 revision（§11.2/A06）。
   * expectedRevision 提供时 WHERE 带 revision=expected：并发下另一管理员先提交会抬高 revision，
   * 本次 updateMany 命中 0 行 → 抛 409，杜绝"读-判-写"三步下的静默覆盖。未提供时退化为不加并发保护。
   */
  private async bumpSubscription(
    tx: Prisma.TransactionClient,
    tenantId: string,
    expectedRevision: number | undefined,
    data: Prisma.TenantSubscriptionUpdateManyMutationInput
  ): Promise<void> {
    const res = await tx.tenantSubscription.updateMany({
      where: { tenantId, ...(expectedRevision != null ? { revision: expectedRevision } : {}) },
      data: { ...data, revision: { increment: 1 } }
    });
    if (res.count === 0) {
      throw new ConflictException("订阅已被其他管理员更新，请刷新后基于最新结果重试");
    }
  }

  /** 金额+币种任一缺失或非正数一律归零为 null（待确认），绝不落 0（§14.2）。 */
  private normalizeAmount(amount?: number | null, currency?: string | null): { amount: number | null; currency: string | null } {
    if (amount == null || !currency || !(amount > 0)) return { amount: null, currency: null };
    return { amount, currency };
  }

  /** serviceYears 或 endAt 二选一推导截止；endAt 为 YYYY-MM-DD 时按服务时区次日零点半开（§4.1.4/4.1.5）。 */
  private resolveEnd(input: { serviceYears?: number; endAt?: string }, startAt: Date, timeZone: string): Date {
    if (input.serviceYears != null && input.endAt) {
      throw new BadRequestException("serviceYears 与 endAt 只能二选一");
    }
    if (input.serviceYears != null) {
      if (!Number.isInteger(input.serviceYears) || input.serviceYears <= 0) throw new BadRequestException("serviceYears 必须为正整数");
      return new Date(endFromServiceYears(startAt.toISOString(), input.serviceYears));
    }
    if (input.endAt) {
      const trimmed = input.endAt.trim();
      const end = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? new Date(exclusiveEndFromDate(trimmed, timeZone))
        : this.parseInstant(trimmed, "截止时点无效");
      if (end.getTime() <= startAt.getTime()) throw new BadRequestException("截止时点必须晚于开始时点");
      return end;
    }
    throw new BadRequestException("serviceYears 与 endAt 需二选一");
  }

  private async reloadOverview(tenantId: string): Promise<TenantSubscriptionOverview> {
    const now = new Date();
    const [tenant, sub, scheduled] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, code: true } }),
      this.prisma.tenantSubscription.findUnique({ where: { tenantId } }),
      this.prisma.tenantSubscriptionSegment.findFirst({ where: { tenantId, status: "SCHEDULED" }, orderBy: { startAt: "asc" } })
    ]);
    if (!tenant) throw new NotFoundException("租户不存在");
    return this.toOverview(tenant, sub, scheduled, now);
  }

  /** 订阅快照（仅版本/来源/起止/金额），用于审计 before/after。 */
  private snapshot(sub: { plan: DbPlan; source: DbSource; startAt: Date | null; endAt: Date | null; currentAmount: unknown; currentCurrency: string | null } | null): Prisma.InputJsonValue | undefined {
    if (!sub) return undefined;
    return {
      plan: toShared<SubscriptionPlan>(sub.plan),
      source: toShared<SubscriptionSource>(sub.source),
      startAt: sub.startAt ? sub.startAt.toISOString() : null,
      endAt: sub.endAt ? sub.endAt.toISOString() : null,
      amount: sub.currentAmount == null ? null : Number(sub.currentAmount),
      currency: sub.currentCurrency ?? null
    };
  }

  /** 事务内追加只读审计事件（§5.2 订阅变更记录）；平台级目录/价格事件 tenantId 传 null。 */
  private async appendEvent(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    type: DbEventType,
    before: Prisma.InputJsonValue | undefined,
    after: Prisma.InputJsonValue | undefined,
    opts: { amount?: number | null; currency?: string | null; reason?: string; note?: string; operator?: string; effectiveAt?: Date } = {}
  ): Promise<void> {
    const norm = this.normalizeAmount(opts.amount, opts.currency);
    await tx.subscriptionEvent.create({
      data: {
        tenantId: tenantId ?? null,
        type,
        ...(before === undefined ? {} : { beforeJson: before }),
        ...(after === undefined ? {} : { afterJson: after }),
        amount: norm.amount,
        currency: norm.currency,
        ...(opts.note ? { handlingNote: opts.note } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.operator ? { operator: opts.operator } : {}),
        ...(opts.effectiveAt ? { effectiveAt: opts.effectiveAt } : {})
      }
    });
  }

  /** 事务内把旧的 CURRENT 段转历史，写入新的 CURRENT 段（支撑续费/降级追溯与 next 展示）。 */
  private async markCurrentSegment(
    tx: Prisma.TransactionClient, tenantId: string, plan: SubscriptionPlan, source: SubscriptionSource,
    startAt: Date | null, endAt: Date | null, amount?: number | null, currency?: string | null, reason?: string
  ): Promise<void> {
    await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId, status: "CURRENT" }, data: { status: "HISTORICAL" } });
    const norm = this.normalizeAmount(amount, currency);
    await tx.tenantSubscriptionSegment.create({
      data: {
        tenantId, status: "CURRENT", plan: toDb(plan) as DbPlan, source: toDb(source) as DbSource,
        startAt, endAt, amount: norm.amount, currency: norm.currency, ...(reason ? { reason } : {})
      }
    });
  }

  /** 租户提交升级/续费/降级/不续费/咨询申请（§7.2）：仅表达意向，不自动开通。同租户同键未关闭申请幂等复用。 */
  async submitRequest(tenantId: string, input: SubmitSubscriptionRequestRequest): Promise<SubscriptionRequestRecord> {
    if (!input.dedupeKey?.trim()) throw new BadRequestException("缺少幂等去重键");
    const now = new Date().toISOString();
    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionRequest.findUnique({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey: input.dedupeKey } }
      });
      // 未关闭(PENDING)同键：幂等复用，挡住租户双击/重复提交（§7.2）。
      if (existing && existing.status === "PENDING") return existing;
      // 命中已关闭(已办理/拒绝/撤销)同键：前端用按类型派生的稳定键，办结后应允许同类型再次发起。
      // 释放旧键（改写为唯一 released 值，让出这个稳定键），本次作为新的一条 open 申请创建。
      if (existing) {
        await tx.subscriptionRequest.update({
          where: { id: existing.id },
          data: { dedupeKey: `released:${existing.id}` }
        });
      }
      return tx.subscriptionRequest.create({
        data: {
          tenantId,
          type: toDb(input.type) as DbReqType,
          ...(input.targetPlan ? { targetPlan: toDb(input.targetPlan) as DbPlan } : {}),
          status: "PENDING",
          ...(input.contactName ? { contactName: input.contactName } : {}),
          ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
          ...(input.moduleIntent ? { moduleIntent: input.moduleIntent } : {}),
          ...(input.note ? { note: input.note } : {}),
          timeline: [{ at: now, status: SubscriptionRequestStatus.Pending, note: "租户提交申请" }],
          dedupeKey: input.dedupeKey
        }
      });
    });
    return this.toRequestRecord(created);
  }

  /** 租户撤销自己未办理的申请（§7.2）。只能撤销本租户、且仍为待处理的申请。 */
  async cancelRequest(tenantId: string, requestId: string): Promise<SubscriptionRequestRecord> {
    const req = await this.prisma.subscriptionRequest.findUnique({ where: { id: requestId } });
    if (!req || req.tenantId !== tenantId) throw new NotFoundException("申请不存在");
    if (req.status !== "PENDING") throw new ConflictException("仅未办理的申请可撤销");
    const now = new Date().toISOString();
    const timeline = [
      ...(Array.isArray(req.timeline) ? (req.timeline as unknown[]) : []),
      { at: now, status: SubscriptionRequestStatus.Cancelled, note: "租户撤销申请" }
    ];
    const updated = await this.prisma.subscriptionRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", timeline: timeline as Prisma.InputJsonValue }
    });
    return this.toRequestRecord(updated);
  }

  /** 平台直接开通（§7.1/§8.2）：start 必填，serviceYears 与 endAt 二选一；金额可空=待确认。 */
  async provision(tenantId: string, input: ProvisionSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    await this.ensureTenant(tenantId);
    const startAt = this.parseInstant(input.startAt, "开通开始时点无效");
    const timeZone = input.timeZone && isValidTimeZone(input.timeZone) ? input.timeZone : undefined;
    const endAt = this.resolveEnd(input, startAt, timeZone ?? "Asia/Shanghai");
    const amount = this.normalizeAmount(input.amount, input.currency);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      const before = this.snapshot(existing);
      const base = {
        plan: toDb(input.plan) as DbPlan,
        source: toDb(input.source) as DbSource,
        startAt, endAt,
        serviceTimeZone: timeZone ?? existing?.serviceTimeZone ?? null,
        billingAnniversary: startAt,
        currentAmount: amount.amount, currentCurrency: amount.currency,
        sourceReason: input.reason ?? null, handledAt: now
      };
      if (existing) {
        await this.bumpSubscription(tx, tenantId, input.expectedRevision, base);
      } else {
        await tx.tenantSubscription.create({ data: { tenantId, ...base } });
      }
      const saved = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      await this.markCurrentSegment(tx, tenantId, input.plan, input.source, startAt, endAt, input.amount, input.currency, input.reason);
      await this.appendEvent(tx, tenantId, "PROVISION", before, this.snapshot(saved), { amount: input.amount, currency: input.currency, reason: input.reason, operator, effectiveAt: startAt });
    });
    return this.reloadOverview(tenantId);
  }

  /** 续期（§4.4）：有效期内缺 startAt 接续当前截止；已过期须显式 startAt。计费锚点不动，避免逐年漂移。 */
  async renew(tenantId: string, input: RenewSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    const current = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!current) throw new NotFoundException("该租户尚未开通订阅，请先开通再续费");
    this.assertRevision(current.revision, input.expectedRevision);
    const now = new Date();
    const withinTerm = current.startAt != null && current.endAt != null && now >= current.startAt && now < current.endAt;
    let startAt: Date;
    if (input.startAt) startAt = this.parseInstant(input.startAt, "续期开始时点无效");
    else if (withinTerm && current.endAt) startAt = current.endAt;
    else throw new BadRequestException("订阅已过期，续费须显式提供开始时点");
    const endAt = this.resolveRenewEnd(input, startAt, current);
    const amount = this.normalizeAmount(input.amount, input.currency);
    const wasPro = toShared<SubscriptionPlan>(current.plan) === SubscriptionPlan.Pro;
    await this.prisma.$transaction(async (tx) => {
      const before = this.snapshot(current);
      await this.bumpSubscription(tx, tenantId, input.expectedRevision, {
        plan: toDb(input.plan) as DbPlan, source: toDb(input.source) as DbSource,
        startAt, endAt, currentAmount: amount.amount, currentCurrency: amount.currency,
        sourceReason: input.reason ?? null, handledAt: now
      });
      const saved = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      await this.markCurrentSegment(tx, tenantId, input.plan, input.source, startAt, endAt, input.amount, input.currency, input.reason);
      const evType = input.plan === SubscriptionPlan.Standard && wasPro ? "DOWNGRADE" : "RENEW";
      await this.appendEvent(tx, tenantId, evType, before, this.snapshot(saved), { amount: input.amount, currency: input.currency, reason: input.reason, operator, effectiveAt: startAt });
    });
    return this.reloadOverview(tenantId);
  }

  /**
   * 续期截止推导（§4.1.5 防漂移）：接续当前截止、用 serviceYears、且当前期确为锚点周年对齐时，
   * 基于**原计费锚点**累计年数推算，避免 2/29 这类锚点在闰年被永久固化为 2/28；
   * 其余情形（显式 startAt / 直接给 endAt / 当前期非锚点对齐）走通用 resolveEnd。
   */
  private resolveRenewEnd(
    input: { serviceYears?: number; endAt?: string },
    startAt: Date,
    current: { endAt: Date | null; billingAnniversary: Date | null; serviceTimeZone: string | null }
  ): Date {
    if (input.serviceYears != null && !input.endAt && current.billingAnniversary && current.endAt && startAt.getTime() === current.endAt.getTime()) {
      const anchorIso = current.billingAnniversary.toISOString();
      const yearsCovered = current.endAt.getUTCFullYear() - current.billingAnniversary.getUTCFullYear();
      const anchorAligned =
        yearsCovered > 0 && new Date(anniversaryFromAnchor(anchorIso, yearsCovered)).getTime() === current.endAt.getTime();
      if (anchorAligned) {
        return new Date(anniversaryFromAnchor(anchorIso, yearsCovered + input.serviceYears));
      }
    }
    return this.resolveEnd(input, startAt, current.serviceTimeZone ?? "Asia/Shanghai");
  }

  /** 升级为 PRO（§4.4）：保持原统一截止不变，仅记录人工补差金额（可空）。 */
  async upgradePro(tenantId: string, input: UpgradeSubscriptionProRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    const current = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!current) throw new NotFoundException("该租户尚未开通订阅，无法升级");
    this.assertRevision(current.revision, input.expectedRevision);
    if (toShared<SubscriptionPlan>(current.plan) === SubscriptionPlan.Pro) throw new ConflictException("该租户已是 PRO 版本");
    const now = new Date();
    const amount = this.normalizeAmount(input.amount, input.currency);
    await this.prisma.$transaction(async (tx) => {
      const before = this.snapshot(current);
      await this.bumpSubscription(tx, tenantId, input.expectedRevision, {
        plan: "PRO", source: toDb(input.source) as DbSource,
        currentAmount: amount.amount, currentCurrency: amount.currency,
        ...(input.reason ? { sourceReason: input.reason } : {}), handledAt: now
      });
      // 升级保持原统一截止不变，段沿用当前起止。
      await this.markCurrentSegment(tx, tenantId, SubscriptionPlan.Pro, input.source, current.startAt, current.endAt, input.amount, input.currency, input.reason);
      const saved = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      await this.appendEvent(tx, tenantId, "UPGRADE", before, this.snapshot(saved), { amount: input.amount, currency: input.currency, reason: input.reason, operator });
    });
    return this.reloadOverview(tenantId);
  }

  /** 临时延长当前套餐截止（§4.4/§8.2）：须填原因；不伪造收款、不自动续费；只后移 endAt。 */
  async extend(tenantId: string, input: ExtendSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    if (!input.reason?.trim()) throw new BadRequestException("临时延长必须填写原因");
    const current = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!current) throw new NotFoundException("该租户尚未开通订阅，无法延长");
    this.assertRevision(current.revision, input.expectedRevision);
    const newEnd = this.parseInstant(input.endAt, "新截止时点无效");
    if (current.endAt && newEnd.getTime() <= current.endAt.getTime()) throw new BadRequestException("新截止必须晚于当前截止");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const before = this.snapshot(current);
      await this.bumpSubscription(tx, tenantId, input.expectedRevision, { endAt: newEnd, sourceReason: input.reason, handledAt: now });
      await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId, status: "CURRENT" }, data: { endAt: newEnd } });
      const saved = await tx.tenantSubscription.findUnique({ where: { tenantId } });
      await this.appendEvent(tx, tenantId, "TEMP_EXTENSION", before, this.snapshot(saved), { reason: input.reason, operator, effectiveAt: newEnd });
    });
    return this.reloadOverview(tenantId);
  }

  /** 登记下一段套餐（续费或下期降级，§4.4）：当前付费期不提前结束，到 effectiveAt 才切换。 */
  async scheduleNext(tenantId: string, input: ScheduleNextSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    const current = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!current) throw new NotFoundException("该租户尚未开通订阅，无法登记下一段");
    const effectiveAt = this.parseInstant(input.effectiveAt, "下一段开始时点无效");
    const endAt = this.resolveEnd(input, effectiveAt, current.serviceTimeZone ?? "Asia/Shanghai");
    const amount = this.normalizeAmount(input.amount, input.currency);
    const wasPro = toShared<SubscriptionPlan>(current.plan) === SubscriptionPlan.Pro;
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantSubscriptionSegment.deleteMany({ where: { tenantId, status: "SCHEDULED" } });
      await tx.tenantSubscriptionSegment.create({
        data: {
          tenantId, status: "SCHEDULED", plan: toDb(input.plan) as DbPlan, source: toDb(input.source) as DbSource,
          startAt: effectiveAt, endAt, amount: amount.amount, currency: amount.currency, ...(input.reason ? { reason: input.reason } : {})
        }
      });
      const evType = input.plan === SubscriptionPlan.Standard && wasPro ? "DOWNGRADE" : "RENEW";
      await this.appendEvent(tx, tenantId, evType, undefined, { plan: input.plan, startAt: effectiveAt.toISOString(), endAt: endAt.toISOString() }, { amount: input.amount, currency: input.currency, reason: input.reason, operator, effectiveAt });
    });
    return this.reloadOverview(tenantId);
  }

  /** 单租户额外授权（§3.5 tenant_specific）：不要求整体升级 PRO，不改统一有效期。同码撤销后可重新授权。 */
  async grantFeature(tenantId: string, input: GrantTenantFeatureRequest, operator?: string): Promise<void> {
    await this.ensureTenant(tenantId);
    const code = input.featureCode?.trim();
    if (!code) throw new BadRequestException("缺少功能编码");
    await this.prisma.$transaction(async (tx) => {
      const feature = await tx.subscriptionFeatureCatalog.findUnique({ where: { code } });
      if (!feature) throw new NotFoundException("功能目录中不存在该功能");
      await tx.tenantFeatureGrant.upsert({
        where: { tenantId_featureCode: { tenantId, featureCode: code } },
        create: { tenantId, featureCode: code, ...(operator ? { operator } : {}), ...(input.reason ? { reason: input.reason } : {}) },
        update: { revokedAt: null, revokedReason: null, effectiveAt: new Date(), ...(operator ? { operator } : {}), ...(input.reason ? { reason: input.reason } : {}) }
      });
      await this.appendEvent(tx, tenantId, "TENANT_GRANT", undefined, { featureCode: code }, { reason: input.reason, operator });
    });
  }

  /** 撤销单租户额外授权（§3.5.8）：须填原因，保护既有承诺。撤销后功能回落到套餐公共权益判定。 */
  async revokeFeature(tenantId: string, input: RevokeTenantFeatureRequest, operator?: string): Promise<void> {
    if (!input.reason?.trim()) throw new BadRequestException("撤销单租户授权必须填写原因");
    const code = input.featureCode?.trim();
    if (!code) throw new BadRequestException("缺少功能编码");
    const grant = await this.prisma.tenantFeatureGrant.findUnique({ where: { tenantId_featureCode: { tenantId, featureCode: code } } });
    if (!grant || grant.revokedAt) throw new NotFoundException("该租户没有生效中的此项授权");
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantFeatureGrant.update({
        where: { tenantId_featureCode: { tenantId, featureCode: code } },
        data: { revokedAt: new Date(), revokedReason: input.reason }
      });
      await this.appendEvent(tx, tenantId, "TENANT_REVOKE", { featureCode: code }, undefined, { reason: input.reason, operator });
    });
  }

  /** SaaS 管理员办理申请（§7.3）：转已办理/已拒绝，附可公开原因；实际开通另走开通接口，这里不直接改订阅。 */
  async handleRequest(requestId: string, input: HandleSubscriptionRequestRequest, operator?: string): Promise<SubscriptionRequestRecord> {
    const req = await this.prisma.subscriptionRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException("申请不存在");
    if (req.status !== "PENDING") throw new ConflictException("该申请已办理或已关闭");
    if (input.status !== SubscriptionRequestStatus.Processed && input.status !== SubscriptionRequestStatus.Rejected) {
      throw new BadRequestException("办理结果只能为已办理或已拒绝");
    }
    const now = new Date().toISOString();
    const timeline = [
      ...(Array.isArray(req.timeline) ? (req.timeline as unknown[]) : []),
      { at: now, status: input.status, ...(input.note ? { note: input.note } : {}) }
    ];
    const updated = await this.prisma.subscriptionRequest.update({
      where: { id: requestId },
      data: {
        status: toDb(input.status) as DbReqStatus,
        ...(input.publicReason ? { publicReason: input.publicReason } : {}),
        timeline: timeline as Prisma.InputJsonValue
      }
    });
    return this.toRequestRecord(updated);
  }

  /** 已发布功能目录（平台端维护/版本对比用，非租户特定）（§3.3/§6）。 */
  async listFeatureCatalog(): Promise<SubscriptionFeatureCatalogEntry[]> {
    const rows = await this.prisma.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] });
    return rows.map((r) => this.toCatalogEntry(r));
  }

  /** 基础版/PRO 标准价（平台端）。 */
  async getStandardPrices(): Promise<StandardPlanPricing[]> {
    return this.buildPricing(await this.prisma.subscriptionStandardPrice.findMany());
  }

  /** 维护功能目录条目并设当前归属（§3.3/§8）。currentOwnership=standard 即公共下放基础版（§3.5）。全量 PUT。 */
  async upsertFeatureCatalog(code: string, input: UpsertFeatureCatalogRequest, operator?: string): Promise<SubscriptionFeatureCatalogEntry> {
    const key = code.trim();
    if (!key) throw new BadRequestException("缺少功能编码");
    const existing = await this.prisma.subscriptionFeatureCatalog.findUnique({ where: { code: key } });
    const data = {
      name: input.name, module: input.module, categories: (input.categories ?? []) as Prisma.InputJsonValue,
      defaultOwnership: toDb(input.defaultOwnership) as DbOwnership,
      currentOwnership: toDb(input.currentOwnership) as DbOwnership,
      releaseStatus: toDb(input.releaseStatus) as DbRelease,
      valueText: input.valueText ?? null, prerequisiteText: input.prerequisiteText ?? null,
      externalFeeNote: input.externalFeeNote ?? null, contentVersion: input.contentVersion ?? null
    };
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.subscriptionFeatureCatalog.update({ where: { code: key }, data })
        : await tx.subscriptionFeatureCatalog.create({ data: { code: key, ...data } });
      await this.appendEvent(tx, null, "CATALOG_UPDATE", existing ? { code: key } : undefined, { code: key, currentOwnership: input.currentOwnership, releaseStatus: input.releaseStatus }, { reason: input.reason, operator });
      return row;
    });
    return this.toCatalogEntry(saved);
  }

  /** 维护标准套餐年费（§5.2/§8）。未发布不落价；已发布必须有正年费+币种，绝不落 0（§14.2 S-D01）。 */
  async setStandardPrice(plan: SubscriptionPlan, input: SetStandardPriceRequest, operator?: string): Promise<StandardPlanPricing> {
    const amount = this.normalizeAmount(input.annualFee, input.currency);
    if (input.published && amount.amount == null) throw new BadRequestException("发布正式价格必须提供大于 0 的年费与币种");
    const dbPlan = toDb(plan) as DbPlan;
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionStandardPrice.findUnique({ where: { plan: dbPlan } });
      const data = {
        annualFee: amount.amount, currency: amount.currency,
        taxInclusive: input.taxInclusive ?? null, published: input.published,
        priceVersion: input.priceVersion ?? null, note: input.note ?? null
      };
      const row = existing
        ? await tx.subscriptionStandardPrice.update({ where: { plan: dbPlan }, data })
        : await tx.subscriptionStandardPrice.create({ data: { plan: dbPlan, ...data } });
      await this.appendEvent(tx, null, "PRICE_UPDATE", undefined, { plan, published: input.published }, { amount: input.annualFee, currency: input.currency, reason: input.note, operator });
      return row;
    });
    return this.buildPricing([saved]).find((p) => p.plan === plan) ?? { plan, published: input.published };
  }
  private toCatalogEntry(row: {
    code: string; name: string; module: string; categories: unknown; defaultOwnership: DbOwnership;
    currentOwnership: DbOwnership; releaseStatus: DbRelease; valueText: string | null;
    prerequisiteText: string | null; externalFeeNote: string | null; contentVersion: string | null;
  }): SubscriptionFeatureCatalogEntry {
    return {
      code: row.code,
      name: row.name,
      module: row.module,
      categories: ((row.categories as string[] | null) ?? []),
      defaultOwnership: toShared<FeatureOwnership>(row.defaultOwnership),
      currentOwnership: toShared<FeatureOwnership>(row.currentOwnership),
      releaseStatus: toShared<FeatureReleaseStatus>(row.releaseStatus),
      ...(row.valueText ? { valueText: row.valueText } : {}),
      ...(row.prerequisiteText ? { prerequisiteText: row.prerequisiteText } : {}),
      ...(row.externalFeeNote ? { externalFeeNote: row.externalFeeNote } : {}),
      ...(row.contentVersion ? { contentVersion: row.contentVersion } : {})
    };
  }

  private async ensureTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException("租户不存在");
  }
}

/** 审计事件类型 → 变更记录展示动作文案（§5.2）。 */
const EVENT_ACTION_TEXT: Record<string, string> = {
  PROVISION: "开通",
  UPGRADE: "升级 PRO",
  RENEW: "续期",
  DOWNGRADE: "降级",
  TEMP_EXTENSION: "临时延长",
  TERM_CORRECTION: "期限修正",
  PUBLIC_GRANT: "公共下放",
  PUBLIC_REVOKE: "取消公共下放",
  TENANT_GRANT: "单租户授权",
  TENANT_REVOKE: "撤销单租户授权",
  CATALOG_UPDATE: "功能目录更新",
  PRICE_UPDATE: "标准价更新"
};
