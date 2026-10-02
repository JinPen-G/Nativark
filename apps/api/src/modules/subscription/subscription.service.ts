import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  FeatureEntitlementSource, FeatureOwnership, SubscriptionPlan, SubscriptionReminderStage,
  SubscriptionRequestStatus, SubscriptionRequestType, SubscriptionServiceStatus, SubscriptionSource,
  type ExtendSubscriptionRequest, type FeatureReleaseStatus, type GrantTenantFeatureRequest,
  type HandleSubscriptionRequestRequest, type ProvisionSubscriptionRequest, type RenewSubscriptionRequest,
  type RevokeTenantFeatureRequest, type ScheduleNextSubscriptionRequest, type SetStandardPriceRequest,
  type StaffSubscriptionContext, type StandardPlanPricing, type SubmitSubscriptionRequestRequest,
  type SubscriptionChangeLogEntry, type SubscriptionExpiryReminder, type SubscriptionFeatureCatalogEntry,
  type SubscriptionFeatureEntitlement, type SubscriptionMoney, type SubscriptionRequestRecord,
  type TenantSubscriptionOverview, type TenantSubscriptionPage, type TenantSubscriptionView,
  type UpgradeSubscriptionProRequest, type UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import { Prisma, type TenantSubscription, type TenantSubscriptionSegment, type SubscriptionRequest,
  type SubscriptionEvent, type SubscriptionFeatureCatalog, type SubscriptionStandardPrice,
  type SubscriptionPlan as DbPlan, type SubscriptionSource as DbSource,
  type SubscriptionEventType as DbEventType, type SubscriptionRequestType as DbReqType,
  type FeatureOwnership as DbOwnership, type FeatureReleaseStatus as DbRelease } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { anniversaryFromAnchor, calendarYear, endFromServiceYears, exclusiveEndFromDate, isValidTimeZone } from "./subscription-term";

const DAY_MS = 86400000;
const DEFAULT_ZONE = "Asia/Shanghai";
const tenantSelect = { id: true, name: true, code: true } as const;
type TenantIdentity = { id: string; name: string; code: string };
type SubscriptionState = { current: TenantSubscription | null; next: TenantSubscriptionSegment | null; due: TenantSubscriptionSegment[] };
type OperationInput = ProvisionSubscriptionRequest | RenewSubscriptionRequest | UpgradeSubscriptionProRequest | ScheduleNextSubscriptionRequest;
type EventOptions = { amount?: number | null; currency?: string | null; reason?: string; note?: string; operator?: string; effectiveAt?: Date };

function toShared<T extends string>(value: string): T { return value.toLowerCase() as T; }
function toDb(value: string): string { return value.toUpperCase(); }

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  private reminderDays() {
    const read = (name: string, fallback: number) => {
      const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
      if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error(`${name} must be an integer from 1 to 365`);
      return value;
    };
    const normal = read("SUBSCRIPTION_REMINDER_NORMAL_DAYS", 30);
    const urgent = read("SUBSCRIPTION_REMINDER_URGENT_DAYS", 7);
    if (urgent > normal) throw new Error("SUBSCRIPTION_REMINDER_URGENT_DAYS must not exceed normal days");
    return { normal, urgent };
  }

  private deriveStatus(sub: Pick<TenantSubscription, "startAt" | "endAt"> | null, now: Date): SubscriptionServiceStatus {
    if (!sub?.startAt || !sub.endAt) return SubscriptionServiceStatus.Unconfigured;
    if (now < sub.startAt) return SubscriptionServiceStatus.PendingActivation;
    if (now >= sub.endAt) return SubscriptionServiceStatus.Expired;
    return sub.endAt.getTime() - now.getTime() <= this.reminderDays().normal * DAY_MS
      ? SubscriptionServiceStatus.Expiring : SubscriptionServiceStatus.Active;
  }

  private project(sub: TenantSubscription | null, segments: TenantSubscriptionSegment[], now: Date): SubscriptionState {
    const scheduled = segments.filter((s) => s.status === "SCHEDULED").sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0));
    const due = scheduled.filter((s) => s.startAt && s.endAt && s.startAt <= now);
    const latest = due.at(-1);
    return {
      current: sub && latest ? { ...sub, ...this.segmentData(latest, sub), revision: sub.revision + due.length } : sub,
      next: scheduled.find((s) => s.startAt && s.startAt > now) ?? null,
      due
    };
  }

  private segmentData(segment: TenantSubscriptionSegment, current: TenantSubscription) {
    return {
      plan: segment.plan, source: segment.source, startAt: segment.startAt, endAt: segment.endAt,
      currentAmount: segment.amount, currentCurrency: segment.currency, currentTaxInclusive: segment.taxInclusive,
      billingAnniversary: segment.billingAnniversary ?? current.billingAnniversary ?? segment.startAt,
      sourceReason: segment.reason, handledAt: segment.createdAt
    };
  }

  private async readState(tx: Prisma.TransactionClient, tenantId: string, now: Date): Promise<SubscriptionState> {
    const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: { subscription: true, subscriptionSegments: { where: { status: "SCHEDULED" } } } });
    if (!row) throw new NotFoundException("租户不存在");
    return this.project(row.subscription, row.subscriptionSegments, now);
  }

  // The parent row also serializes first provision and requests before a subscription exists.
  private async lockTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id = ${tenantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("租户不存在");
  }

  private async writableState(tx: Prisma.TransactionClient, tenantId: string, expected: number, now: Date): Promise<SubscriptionState> {
    if (!Number.isInteger(expected) || expected < 0) throw new BadRequestException("必须提供有效的 expectedRevision，请刷新后重试");
    await this.lockTenant(tx, tenantId);
    // A scheduled term may activate while this writer waits for the tenant lock.
    now.setTime(Date.now());
    const state = await this.readState(tx, tenantId, now);
    if ((state.current?.revision ?? 0) !== expected) throw new ConflictException("订阅已更新，请刷新并复核最新期限后重试");
    if (state.current && state.due.length) {
      const latest = state.due.at(-1)!;
      await tx.tenantSubscription.update({ where: { tenantId }, data: { ...this.segmentData(latest, state.current), revision: state.current.revision } });
      await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId, OR: [{ status: "CURRENT" }, { id: { in: state.due.map((s) => s.id) } }] }, data: { status: "HISTORICAL" } });
      await tx.tenantSubscriptionSegment.update({ where: { id: latest.id }, data: { status: "CURRENT" } });
    }
    return state;
  }

  private async bump(tx: Prisma.TransactionClient, tenantId: string, expected: number, data: Prisma.TenantSubscriptionUpdateManyMutationInput = {}) {
    const changed = await tx.tenantSubscription.updateMany({ where: { tenantId, revision: expected }, data: { ...data, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ConflictException("订阅已更新，请刷新后重试");
  }

  async assertTenantWithinTerm(tenantId: string): Promise<void> {
    const now = new Date();
    const state = await this.readState(this.prisma, tenantId, now);
    if (this.deriveStatus(state.current, now) === SubscriptionServiceStatus.Expired) {
      throw new ForbiddenException("SaaS 订阅已到期，暂停办理新业务；既有订单的履约、归还、退款、退押与争议不受影响，续费后恢复");
    }
  }

  async getTenantView(tenantId: string, includeInternal = false): Promise<TenantSubscriptionView> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const [tenant, state, catalog, grants, requests, events, prices] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: tenantSelect }), this.readState(tx, tenantId, now),
        tx.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] }),
        tx.tenantFeatureGrant.findMany({ where: { tenantId, revokedAt: null, effectiveAt: { lte: now } } }),
        tx.subscriptionRequest.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
        tx.subscriptionEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
        tx.subscriptionStandardPrice.findMany()
      ]);
      if (!tenant) throw new NotFoundException("租户不存在");
      return {
        overview: this.toOverview(tenant, state, now),
        entitlements: this.buildEntitlements(catalog, state.current, new Set(grants.map((g) => g.featureCode)), now),
        standardPricing: this.buildPricing(prices), requests: requests.map((r) => this.toRequestRecord(r)),
        changeLog: events.map((e) => this.toChangeLog(e, includeInternal)), reminder: this.buildReminder(state.current, requests, now)
      };
    });
  }

  /** Minimal read-only snapshot inside the caller's transaction. No nested
   * transaction, scheduled-term activation writes, prices or internal notes.
   * Final adoption still needs tenant/catalog locking and explicit capability
   * to commercial-feature mappings; this snapshot is not an authorization. */
  async readCategoryCommercialContext(tenantId: string, tx: Prisma.TransactionClient, now: Date, featureCodes?: readonly string[]) {
    const [state, catalog, grants] = await Promise.all([
      this.readState(tx, tenantId, now),
      tx.subscriptionFeatureCatalog.findMany({ ...(featureCodes ? { where: { code: { in: [...featureCodes] } } } : {}), orderBy: [{ module: "asc" }, { name: "asc" }] }),
      tx.tenantFeatureGrant.findMany({ where: { tenantId, revokedAt: null, effectiveAt: { lte: now } } })
    ]);
    const serviceStatus = this.deriveStatus(state.current, now);
    return {
      serviceStatus, revision: state.current?.revision ?? 0,
      // Same existing new-business term boundary as assertTenantWithinTerm.
      newBusinessAllowed: serviceStatus !== SubscriptionServiceStatus.Expired,
      entitlements: this.buildEntitlements(catalog, state.current, new Set(grants.map((row) => row.featureCode)), now)
        .map((row) => ({ code: row.code, categories: row.categories, available: row.available })),
      complete: false as const, scope: "current_subscription_term_and_feature_snapshot_without_capability_mapping"
    };
  }

  /** Internal adoption barrier, not a public authorization endpoint.
   * Call BEFORE category/policy -> space locks in the same ReadCommitted tx.
   * Required codes come from trusted code-owned capability mappings, never a
   * client's selection. Missing catalog rows fail closed (no RC gap-lock claim).
   * Parent lock serializes provision/term/grant/revoke; per-code row locks match
   * catalog updates. Unrelated catalog entries are neither locked nor returned.
   * Caller still owns capability mappings, applicability and final adoption. */
  async lockCategoryCommercialContext(tenantId: string, tx: Prisma.TransactionClient, featureCodes: readonly string[]) {
    if (!Array.isArray(featureCodes) || featureCodes.some((code) => typeof code !== "string" || !code.trim() || code !== code.trim() || code.length > 191)) {
      throw new BadRequestException("品类商业依赖编码无效");
    }
    const codes = [...new Set(featureCodes)].sort();
    await this.lockTenant(tx, tenantId);
    for (const code of codes) {
      const rows = await tx.$queryRaw<Array<{ code: string }>>`SELECT code FROM subscription_feature_catalog WHERE code=${code} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].code !== code) throw new ConflictException("品类依赖的商业功能未登记或编码不一致，采用未完成");
    }
    // Waiting for either lock may cross an expiry or scheduled activation.
    const now = new Date();
    const context = await this.readCategoryCommercialContext(tenantId, tx, now, codes);
    return { ...context, checkedAt: now.toISOString(), lockedFeatureCodes: codes,
      scope: "locked_subscription_term_and_required_feature_snapshot_without_capability_mapping" };
  }

  async getStaffContext(tenantId: string): Promise<StaffSubscriptionContext> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const [tenant, state, catalog, grants, pending] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: tenantSelect }), this.readState(tx, tenantId, now),
        tx.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] }),
        tx.tenantFeatureGrant.findMany({ where: { tenantId, revokedAt: null, effectiveAt: { lte: now } } }),
        tx.subscriptionRequest.findMany({ where: { tenantId, status: "PENDING" } })
      ]);
      if (!tenant) throw new NotFoundException("租户不存在");
      const full = this.toOverview(tenant, state, now);
      const overview: StaffSubscriptionContext["overview"] = {
        tenantId: full.tenantId, tenantName: full.tenantName, tenantCode: full.tenantCode,
        plan: full.plan, serviceStatus: full.serviceStatus, source: full.source, startAt: full.startAt,
        endAt: full.endAt, timeZone: full.timeZone, next: full.next, revision: full.revision
      };
      return { overview, entitlements: this.buildEntitlements(catalog, state.current, new Set(grants.map((g) => g.featureCode)), now), reminder: this.buildReminder(state.current, pending, now) };
    });
  }

  async getReminder(tenantId: string): Promise<SubscriptionExpiryReminder> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const state = await this.readState(tx, tenantId, now);
      const requests = await tx.subscriptionRequest.findMany({ where: { tenantId, status: "PENDING" } });
      return this.buildReminder(state.current, requests, now);
    });
  }

  async listOverviews(filter: { plan?: string; serviceStatus?: string; dueWithin?: number; keyword?: string; page?: number; pageSize?: number } = {}): Promise<TenantSubscriptionPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException("分页参数无效，pageSize 应为 1–100");
    const plan = filter.plan?.trim().toLowerCase();
    const status = filter.serviceStatus?.trim().toLowerCase();
    if (plan && !Object.values(SubscriptionPlan).includes(plan as SubscriptionPlan)) throw new BadRequestException("套餐筛选无效");
    if (status && !Object.values(SubscriptionServiceStatus).includes(status as SubscriptionServiceStatus)) throw new BadRequestException("服务状态筛选无效");
    if (filter.dueWithin != null && (!Number.isInteger(filter.dueWithin) || filter.dueWithin < 0 || filter.dueWithin > 36500)) throw new BadRequestException("到期范围无效");
    const now = new Date();
    const expiringAt = new Date(now.getTime() + this.reminderDays().normal * DAY_MS);
    const start = Prisma.sql`CASE WHEN sg.id IS NOT NULL THEN sg.startAt ELSE s.startAt END`;
    const end = Prisma.sql`CASE WHEN sg.id IS NOT NULL THEN sg.endAt ELSE s.endAt END`;
    const effectivePlan = Prisma.sql`CASE WHEN sg.id IS NOT NULL THEN sg.plan ELSE COALESCE(s.plan, 'standard') END`;
    const serviceStatus = Prisma.sql`CASE WHEN ${start} IS NULL OR ${end} IS NULL THEN 'unconfigured' WHEN ${start} > ${now} THEN 'pending_activation' WHEN ${end} <= ${now} THEN 'expired' WHEN ${end} <= ${expiringAt} THEN 'expiring' ELSE 'active' END`;
    const clauses: Prisma.Sql[] = [Prisma.sql`1=1`];
    if (plan) clauses.push(Prisma.sql`${effectivePlan} = ${plan}`);
    if (status) clauses.push(Prisma.sql`${serviceStatus} = ${status}`);
    if (filter.keyword?.trim()) clauses.push(Prisma.sql`LOCATE(${filter.keyword.trim().toLowerCase()}, LOWER(CONCAT(t.name, t.code))) > 0`);
    if (filter.dueWithin != null) clauses.push(Prisma.sql`${end} > ${now} AND ${end} <= ${new Date(now.getTime() + filter.dueWithin * DAY_MS)}`);
    const from = Prisma.sql`FROM Tenant t LEFT JOIN tenant_subscriptions s ON s.tenantId=t.id LEFT JOIN tenant_subscription_segments sg ON sg.id=(SELECT ds.id FROM tenant_subscription_segments ds WHERE ds.tenantId=t.id AND ds.status='scheduled' AND ds.startAt <= ${now} AND ds.endAt IS NOT NULL ORDER BY ds.startAt DESC, ds.createdAt DESC, ds.id DESC LIMIT 1) WHERE ${Prisma.join(clauses, " AND ")}`;
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total ${from}`);
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT t.id ${from} ORDER BY t.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      const tenants = await tx.tenant.findMany({ where: { id: { in: ids.map((t) => t.id) } }, include: { subscription: true, subscriptionSegments: { where: { status: "SCHEDULED" } } }, orderBy: { id: "asc" } });
      return { items: tenants.map((t) => this.toOverview(t, this.project(t.subscription, t.subscriptionSegments, now), now)), total: Number(count[0].total), page, pageSize };
    });
  }

  private buildEntitlements(rows: SubscriptionFeatureCatalog[], sub: TenantSubscription | null, grants: Set<string>, now: Date): SubscriptionFeatureEntitlement[] {
    const status = this.deriveStatus(sub, now);
    const active = status === SubscriptionServiceStatus.Active || status === SubscriptionServiceStatus.Expiring;
    return rows.map((row) => {
      const ownership = toShared<FeatureOwnership>(row.currentOwnership);
      const source = ownership === FeatureOwnership.Standard ? FeatureEntitlementSource.StandardPublic
        : grants.has(row.code) ? FeatureEntitlementSource.TenantGrant
        : sub?.plan === "PRO" && active ? FeatureEntitlementSource.Pro : FeatureEntitlementSource.NeedsUpgrade;
      const delivered = row.releaseStatus === "RELEASED" || (row.releaseStatus === "PILOT" && grants.has(row.code));
      const termAllows = active || (status === SubscriptionServiceStatus.Unconfigured && ownership === FeatureOwnership.Standard);
      return {
        code: row.code, name: row.name, module: row.module, categories: (row.categories as string[]) ?? [],
        defaultOwnership: toShared<FeatureOwnership>(row.defaultOwnership), currentOwnership: ownership,
        releaseStatus: toShared<FeatureReleaseStatus>(row.releaseStatus), source, hasTenantGrant: grants.has(row.code),
        available: delivered && termAllows && source !== FeatureEntitlementSource.NeedsUpgrade,
        ...(row.valueText ? { valueText: row.valueText } : {}), ...(row.externalFeeNote ? { externalFeeNote: row.externalFeeNote } : {})
      };
    });
  }

  private money(amount: unknown, currency: string | null, taxInclusive?: boolean | null): SubscriptionMoney | null {
    const value = Number(amount);
    return amount != null && currency && Number.isFinite(value) && value > 0 ? { amount: value, currency, ...(taxInclusive == null ? {} : { taxInclusive }) } : null;
  }

  private buildPricing(rows: SubscriptionStandardPrice[]): StandardPlanPricing[] {
    return [SubscriptionPlan.Standard, SubscriptionPlan.Pro].map((plan) => {
      const row = rows.find((r) => r.plan === toDb(plan));
      return row ? { plan, annualFee: row.published ? this.money(row.annualFee, row.currency, row.taxInclusive) : null, published: row.published, ...(row.priceVersion ? { priceVersion: row.priceVersion } : {}), ...(row.note ? { note: row.note } : {}) } : { plan, published: false };
    });
  }

  private buildReminder(sub: TenantSubscription | null, requests: Array<{ status: string }>, now: Date): SubscriptionExpiryReminder {
    const serviceStatus = this.deriveStatus(sub, now);
    const days = sub?.startAt && sub.endAt ? Math.ceil((sub.endAt.getTime() - now.getTime()) / DAY_MS) : undefined;
    let stage = SubscriptionReminderStage.None;
    let message: string | undefined;
    if (serviceStatus === SubscriptionServiceStatus.Expired) {
      stage = SubscriptionReminderStage.Expired;
      message = "服务已到期：暂停办理新业务，已有订单与资金流水不受影响，续费后恢复。";
    } else if (serviceStatus === SubscriptionServiceStatus.Expiring && days != null) {
      stage = days <= this.reminderDays().urgent ? SubscriptionReminderStage.Urgent : SubscriptionReminderStage.Normal;
      message = `服务将在 ${days} 天后到期，请联系管理员续费。`;
    }
    return {
      plan: sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard, serviceStatus,
      revision: sub?.revision ?? 0, timeZone: sub?.serviceTimeZone ?? DEFAULT_ZONE,
      ...(sub?.endAt ? { endAt: sub.endAt.toISOString() } : {}), ...(days == null ? {} : { remainingDays: days }),
      stage, ...(message ? { message } : {}), hasOpenRequest: requests.some((r) => r.status === "PENDING")
    };
  }

  private toOverview(tenant: TenantIdentity, state: SubscriptionState, now: Date): TenantSubscriptionOverview {
    const sub = state.current;
    return {
      tenantId: tenant.id, tenantName: tenant.name, tenantCode: tenant.code,
      plan: sub ? toShared<SubscriptionPlan>(sub.plan) : SubscriptionPlan.Standard, serviceStatus: this.deriveStatus(sub, now),
      ...(sub ? { source: toShared<SubscriptionSource>(sub.source) } : {}),
      ...(sub?.startAt ? { startAt: sub.startAt.toISOString() } : {}), ...(sub?.endAt ? { endAt: sub.endAt.toISOString() } : {}),
      ...(sub?.billingAnniversary ? { anniversaryAnchor: sub.billingAnniversary.toISOString() } : {}),
      timeZone: sub?.serviceTimeZone ?? DEFAULT_ZONE,
      currentAmount: sub ? this.money(sub.currentAmount, sub.currentCurrency, sub.currentTaxInclusive) : null,
      ...(sub?.handledAt ? { handledAt: sub.handledAt.toISOString() } : {}),
      ...(state.next ? { next: { plan: toShared<SubscriptionPlan>(state.next.plan), effectiveAt: state.next.startAt?.toISOString(), endAt: state.next.endAt?.toISOString() } } : {}), revision: sub?.revision ?? 0
    };
  }

  private toRequestRecord(r: SubscriptionRequest): SubscriptionRequestRecord {
    return {
      id: r.id, type: toShared<SubscriptionRequestType>(r.type), status: toShared<SubscriptionRequestStatus>(r.status),
      ...(r.targetPlan ? { targetPlan: toShared<SubscriptionPlan>(r.targetPlan) } : {}),
      ...(r.contactName ? { submittedBy: r.contactName, contactName: r.contactName } : {}), submittedAt: r.createdAt.toISOString(),
      ...(r.contactPhone ? { contactPhone: r.contactPhone } : {}), ...(r.moduleIntent ? { moduleIntent: r.moduleIntent as string[] } : {}),
      ...(r.note ? { note: r.note } : {}), ...(r.linkedEventId ? { linkedEventId: r.linkedEventId } : {}),
      handledAmount: this.money(r.handledAmount, r.handledCurrency, r.handledTaxInclusive),
      ...(r.periodText ? { periodText: r.periodText } : {}), ...(r.publicReason ? { reason: r.publicReason } : {}),
      ...(Array.isArray(r.timeline) ? { timeline: r.timeline as SubscriptionRequestRecord["timeline"] } : {})
    };
  }

  private toChangeLog(e: SubscriptionEvent, includeInternal = false): SubscriptionChangeLogEntry {
    const publicReason = e.afterJson && typeof e.afterJson === "object" && !Array.isArray(e.afterJson) ? e.afterJson.publicReason : undefined;
    return { id: e.id, action: EVENT_ACTION_TEXT[e.type] ?? e.type, effectiveAt: e.effectiveAt?.toISOString(),
      ...(typeof publicReason === "string" ? { reason: publicReason } : includeInternal && e.reason ? { reason: e.reason } : {}),
      ...(includeInternal && e.handlingNote ? { internalNote: e.handlingNote } : {}),
      beforeText: this.describeState(e.beforeJson), afterText: this.describeState(e.afterJson), operatedAt: e.createdAt.toISOString() };
  }

  private describeState(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const state = value as { plan?: string; startAt?: string; endAt?: string; featureCode?: string };
    return [state.plan?.toUpperCase(), state.featureCode, state.startAt, state.endAt].filter(Boolean).join(" / ");
  }

  private parseInstant(value: string, message: string): Date {
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new BadRequestException(`${message}，必须包含明确时区偏移`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(message);
    return date;
  }

  private normalizeAmount(amount?: number | null, currency?: string | null) {
    if (amount == null && !currency?.trim()) return { amount: null, currency: null };
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) throw new BadRequestException("金额必须是大于 0、最多两位小数的有效金额；未确认时留空");
    const normalized = currency?.trim().toUpperCase();
    if (!normalized || !/^[A-Z]{3}$/.test(normalized)) throw new BadRequestException("填写金额时必须提供三位币种代码");
    return { amount, currency: normalized };
  }

  private resolveEnd(input: { serviceYears?: number; endAt?: string }, start: Date, zone: string): Date {
    if ((input.serviceYears != null) === Boolean(input.endAt)) throw new BadRequestException("serviceYears 与 endAt 必须二选一");
    if (input.serviceYears != null && (!Number.isInteger(input.serviceYears) || input.serviceYears < 1 || input.serviceYears > 100)) throw new BadRequestException("服务年数应为 1–100 的整数");
    let end: Date;
    try {
      end = input.serviceYears != null ? new Date(endFromServiceYears(start.toISOString(), input.serviceYears, zone))
        : /^\d{4}-\d{2}-\d{2}$/.test(input.endAt!) ? new Date(exclusiveEndFromDate(input.endAt!, zone)) : this.parseInstant(input.endAt!, "截止时点无效");
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "期限无效"); }
    if (end <= start) throw new BadRequestException("截止时点必须晚于开始时点");
    return end;
  }

  private renewalDates(input: { serviceYears?: number; endAt?: string }, start: Date, current: TenantSubscription) {
    const zone = current.serviceTimeZone ?? DEFAULT_ZONE;
    let end = this.resolveEnd(input, start, zone);
    let anchor = start;
    if (current.endAt?.getTime() === start.getTime() && current.billingAnniversary) {
      const previousAnchor = current.billingAnniversary;
      const years = calendarYear(start, zone) - calendarYear(previousAnchor, zone);
      let aligned = false;
      try { aligned = years > 0 && anniversaryFromAnchor(previousAnchor.toISOString(), years, zone) === start.toISOString(); }
      catch { /* A nonexistent anniversary cannot match an explicitly agreed custom cutoff. */ }
      if (aligned) {
        anchor = previousAnchor;
        if (input.serviceYears) {
          try { end = new Date(anniversaryFromAnchor(anchor.toISOString(), years + input.serviceYears, zone)); }
          catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "续期日期无效"); }
        }
      }
    }
    return { end, anchor };
  }

  private snapshot(sub: TenantSubscription | null): Prisma.InputJsonValue | undefined {
    if (!sub) return undefined;
    return { plan: toShared<SubscriptionPlan>(sub.plan), source: toShared<SubscriptionSource>(sub.source), startAt: sub.startAt?.toISOString() ?? null, endAt: sub.endAt?.toISOString() ?? null, amount: sub.currentAmount == null ? null : Number(sub.currentAmount), currency: sub.currentCurrency, taxInclusive: sub.currentTaxInclusive };
  }

  private async appendEvent(tx: Prisma.TransactionClient, tenantId: string | null, type: DbEventType, before: Prisma.InputJsonValue | undefined, after: Prisma.InputJsonValue | undefined, opts: EventOptions = {}): Promise<string> {
    const amount = this.normalizeAmount(opts.amount, opts.currency);
    const publicAfter = opts.reason ? { ...(after as object), publicReason: opts.reason } : after;
    const event = await tx.subscriptionEvent.create({ data: { tenantId, type, ...(before === undefined ? {} : { beforeJson: before }), ...(publicAfter === undefined ? {} : { afterJson: publicAfter }), amount: amount.amount, currency: amount.currency, handlingNote: opts.note, reason: opts.reason, operator: opts.operator, effectiveAt: opts.effectiveAt } });
    return event.id;
  }

  private async markCurrent(tx: Prisma.TransactionClient, sub: TenantSubscription) {
    await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId: sub.tenantId, status: "CURRENT" }, data: { status: "HISTORICAL" } });
    await tx.tenantSubscriptionSegment.create({ data: { tenantId: sub.tenantId, status: "CURRENT", plan: sub.plan, source: sub.source, startAt: sub.startAt, endAt: sub.endAt, amount: sub.currentAmount, currency: sub.currentCurrency, taxInclusive: sub.currentTaxInclusive, billingAnniversary: sub.billingAnniversary, reason: sub.sourceReason } });
  }

  private async checkPrice(tx: Prisma.TransactionClient, plan: SubscriptionPlan, input: OperationInput) {
    if (input.amount != null && typeof input.taxInclusive !== "boolean") throw new BadRequestException("填写金额时必须明确含税 / 未税口径");
    if (input.source !== SubscriptionSource.Sale) {
      if (!input.reason?.trim()) throw new BadRequestException("非正常收费办理必须说明试点、历史登记等依据");
      return;
    }
    // Formal PRO sales remain outside this framework until the four professional packages are released.
    if (plan === SubscriptionPlan.Pro) throw new BadRequestException("PRO 正式销售尚未开放，仅可按明确范围登记受控试点或历史服务");
    if (input.amount == null || !input.currency || typeof input.taxInclusive !== "boolean" || !input.priceVersion?.trim()) throw new BadRequestException("正常收费办理必须提供金额、币种、税口径和已发布价格版本");
    const prices = await tx.$queryRaw<Array<{ published: boolean; priceVersion: string | null }>>`SELECT published, priceVersion FROM subscription_standard_prices WHERE plan = ${plan} LOCK IN SHARE MODE`;
    const price = prices[0];
    if (input.priceVersion && (!price?.published || price.priceVersion !== input.priceVersion)) throw new ConflictException("标准价已更新，请重新核对价格版本");
    if (input.amount != null && !input.priceVersion) throw new BadRequestException("收费办理必须核对并提供已发布的价格版本");
  }

  private async fulfill(tx: Prisma.TransactionClient, tenantId: string, input: OperationInput, operation: "provision" | "renew" | "upgrade" | "schedule", plan: SubscriptionPlan, start: Date, end: Date, eventId: string) {
    if (!input.requestId) return;
    const req = await tx.subscriptionRequest.findUnique({ where: { id: input.requestId } });
    if (!req || req.tenantId !== tenantId) throw new NotFoundException("申请不存在");
    if (req.status !== "PENDING") throw new ConflictException("申请已关闭，请刷新后复核");
    const compatible = req.type === "UPGRADE_PRO" ? plan === SubscriptionPlan.Pro && ["provision", "upgrade"].includes(operation)
      : req.type === "RENEW_STANDARD" ? plan === SubscriptionPlan.Standard && ["provision", "renew"].includes(operation)
      : req.type === "RENEW_PRO" ? plan === SubscriptionPlan.Pro && ["provision", "renew"].includes(operation)
      : req.type === "NEXT_STANDARD" ? plan === SubscriptionPlan.Standard && operation === "schedule" : false;
    if (!compatible || (req.targetPlan && req.targetPlan !== toDb(plan))) throw new BadRequestException("申请类型与实际办理不一致");
    const amount = this.normalizeAmount(input.amount, input.currency);
    const timeline = [...(Array.isArray(req.timeline) ? req.timeline : []), { at: new Date().toISOString(), status: SubscriptionRequestStatus.Processed, note: `已登记${operation === "schedule" || start > new Date() ? "待生效" : ""}服务，${start.toISOString()} 至 ${end.toISOString()}` }];
    await tx.subscriptionRequest.update({ where: { id: req.id }, data: { status: "PROCESSED", linkedEventId: eventId, handledAmount: amount.amount, handledCurrency: amount.currency, handledTaxInclusive: input.taxInclusive, periodText: `${start.toISOString()} / ${end.toISOString()}`, timeline } });
  }

  private async reloadOverview(tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: tenantSelect });
      if (!tenant) throw new NotFoundException("租户不存在");
      return this.toOverview(tenant, await this.readState(tx, tenantId, now), now);
    });
  }

  async provision(tenantId: string, input: ProvisionSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    const start = this.parseInstant(input.startAt, "开通开始时点无效");
    const amount = this.normalizeAmount(input.amount, input.currency);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { current, next } = await this.writableState(tx, tenantId, input.expectedRevision, now);
      const zone = input.timeZone ?? current?.serviceTimeZone ?? DEFAULT_ZONE;
      if (!isValidTimeZone(zone)) throw new BadRequestException("服务时区无效");
      const end = this.resolveEnd(input, start, zone);
      if (next) throw new ConflictException("已有下期授权，不能直接覆盖；请先复核下期安排");
      if (current && start > now && current.startAt && current.startAt <= now) throw new BadRequestException("未来套餐应登记为下一段，不能提前替换当前套餐");
      if (current && !input.reason?.trim()) throw new BadRequestException("修正已有订阅必须填写原因");
      await this.checkPrice(tx, input.plan, input);
      const data = { plan: toDb(input.plan) as DbPlan, source: toDb(input.source) as DbSource, startAt: start, endAt: end, serviceTimeZone: zone, billingAnniversary: start, currentAmount: amount.amount, currentCurrency: amount.currency, currentTaxInclusive: input.taxInclusive ?? null, sourceReason: input.reason ?? null, handledAt: now };
      if (current) await this.bump(tx, tenantId, input.expectedRevision, data);
      else await tx.tenantSubscription.create({ data: { tenantId, ...data } });
      const saved = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      await this.markCurrent(tx, saved);
      const id = await this.appendEvent(tx, tenantId, current ? "TERM_CORRECTION" : "PROVISION", this.snapshot(current), { ...this.snapshot(saved) as object, priceVersion: input.priceVersion ?? null }, { ...input, operator, effectiveAt: start });
      await this.fulfill(tx, tenantId, input, "provision", input.plan, start, end, id);
    });
    return this.reloadOverview(tenantId);
  }

  async renew(tenantId: string, input: RenewSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { current, next } = await this.writableState(tx, tenantId, input.expectedRevision, now);
      if (!current?.startAt || !current.endAt) throw new BadRequestException("请先登记完整的当前订阅");
      if (next) throw new ConflictException("已有下一段授权，请复核而非重复续费");
      const active = current.startAt <= now && now < current.endAt;
      const start = input.startAt ? this.parseInstant(input.startAt, "续期开始时点无效") : active ? current.endAt : null;
      if (!start) throw new BadRequestException("非有效期内续费须显式提供新开始时点");
      if (start < current.endAt) throw new BadRequestException("续期不能重叠当前服务期");
      if (!active && start < now && !input.reason?.trim()) throw new BadRequestException("到期续费的过去开始时点必须记录双方确认的依据");
      const { end, anchor } = this.renewalDates(input, start, current);
      await this.checkPrice(tx, input.plan, input);
      const amount = this.normalizeAmount(input.amount, input.currency);
      const data = { plan: toDb(input.plan) as DbPlan, source: toDb(input.source) as DbSource, startAt: start, endAt: end, currentAmount: amount.amount, currentCurrency: amount.currency, currentTaxInclusive: input.taxInclusive ?? null, billingAnniversary: anchor, sourceReason: input.reason ?? null, handledAt: now };
      if (start > now) {
        await this.bump(tx, tenantId, input.expectedRevision);
        await tx.tenantSubscriptionSegment.create({ data: { tenantId, status: "SCHEDULED", plan: data.plan, source: data.source, startAt: start, endAt: end, amount: amount.amount, currency: amount.currency, taxInclusive: input.taxInclusive, billingAnniversary: anchor, reason: input.reason } });
      } else {
        await this.bump(tx, tenantId, input.expectedRevision, data);
        await this.markCurrent(tx, await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } }));
      }
      const after = { plan: input.plan, startAt: start.toISOString(), endAt: end.toISOString(), priceVersion: input.priceVersion ?? null, taxInclusive: input.taxInclusive ?? null };
      const id = await this.appendEvent(tx, tenantId, current.plan === "PRO" && input.plan === SubscriptionPlan.Standard ? "DOWNGRADE" : "RENEW", this.snapshot(current), after, { ...input, operator, effectiveAt: start });
      await this.fulfill(tx, tenantId, input, "renew", input.plan, start, end, id);
    });
    return this.reloadOverview(tenantId);
  }

  async upgradePro(tenantId: string, input: UpgradeSubscriptionProRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { current } = await this.writableState(tx, tenantId, input.expectedRevision, now);
      if (!current?.startAt || !current.endAt || current.startAt > now || current.endAt <= now) throw new BadRequestException("仅有效基础套餐可以补差升级；请先开通或续费");
      if (current.plan === "PRO") throw new ConflictException("该租户已是 PRO 版本");
      await this.checkPrice(tx, SubscriptionPlan.Pro, input);
      const amount = this.normalizeAmount(input.amount, input.currency);
      await this.bump(tx, tenantId, input.expectedRevision, { plan: "PRO", source: toDb(input.source) as DbSource, currentAmount: amount.amount, currentCurrency: amount.currency, currentTaxInclusive: input.taxInclusive ?? null, sourceReason: input.reason, handledAt: now });
      const saved = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      await this.markCurrent(tx, saved);
      const id = await this.appendEvent(tx, tenantId, "UPGRADE", this.snapshot(current), { ...this.snapshot(saved) as object, priceVersion: input.priceVersion ?? null }, { ...input, operator, effectiveAt: now });
      await this.fulfill(tx, tenantId, input, "upgrade", SubscriptionPlan.Pro, now, current.endAt, id);
    });
    return this.reloadOverview(tenantId);
  }

  async extend(tenantId: string, input: ExtendSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    if (!input.reason?.trim()) throw new BadRequestException("临时延长必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const { current, next } = await this.writableState(tx, tenantId, input.expectedRevision, new Date());
      if (!current?.startAt || !current.endAt) throw new BadRequestException("请先登记完整订阅期限");
      const end = this.resolveEnd({ endAt: input.endAt }, current.startAt, current.serviceTimeZone ?? DEFAULT_ZONE);
      if (end <= current.endAt) throw new BadRequestException("新截止必须晚于当前截止");
      if (next?.startAt && end > next.startAt) throw new ConflictException("延长期限与下一段授权重叠，请先复核排期");
      await this.bump(tx, tenantId, input.expectedRevision, { endAt: end, sourceReason: input.reason, handledAt: new Date() });
      await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId, status: "CURRENT" }, data: { endAt: end } });
      const saved = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } });
      await this.appendEvent(tx, tenantId, "TEMP_EXTENSION", this.snapshot(current), this.snapshot(saved), { reason: input.reason, operator, effectiveAt: end });
    });
    return this.reloadOverview(tenantId);
  }

  async scheduleNext(tenantId: string, input: ScheduleNextSubscriptionRequest, operator?: string): Promise<TenantSubscriptionOverview> {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { current, next } = await this.writableState(tx, tenantId, input.expectedRevision, now);
      if (!current?.endAt) throw new BadRequestException("请先登记当前服务期限");
      const start = this.parseInstant(input.effectiveAt, "下一段开始时点无效");
      if (start < current.endAt || start <= now) throw new BadRequestException("下期开始必须在未来，且不得早于当前截止");
      if (next && !input.reason?.trim()) throw new BadRequestException("替换既有排期必须填写原因");
      const { end, anchor } = this.renewalDates(input, start, current);
      const amount = this.normalizeAmount(input.amount, input.currency);
      await this.checkPrice(tx, input.plan, input);
      await this.bump(tx, tenantId, input.expectedRevision);
      await tx.tenantSubscriptionSegment.updateMany({ where: { tenantId, status: "SCHEDULED" }, data: { status: "HISTORICAL" } });
      await tx.tenantSubscriptionSegment.create({ data: { tenantId, status: "SCHEDULED", plan: toDb(input.plan) as DbPlan, source: toDb(input.source) as DbSource, startAt: start, endAt: end, billingAnniversary: anchor, amount: amount.amount, currency: amount.currency, taxInclusive: input.taxInclusive, reason: input.reason } });
      const before = next ? { plan: toShared<SubscriptionPlan>(next.plan), startAt: next.startAt?.toISOString() ?? null, endAt: next.endAt?.toISOString() ?? null } : undefined;
      const id = await this.appendEvent(tx, tenantId, current.plan === "PRO" && input.plan === SubscriptionPlan.Standard ? "DOWNGRADE" : "RENEW", before, { plan: input.plan, startAt: start.toISOString(), endAt: end.toISOString(), priceVersion: input.priceVersion ?? null, taxInclusive: input.taxInclusive ?? null }, { ...input, operator, effectiveAt: start });
      await this.fulfill(tx, tenantId, input, "schedule", input.plan, start, end, id);
    });
    return this.reloadOverview(tenantId);
  }

  async submitRequest(tenantId: string, input: SubmitSubscriptionRequestRequest): Promise<SubscriptionRequestRecord> {
    if (!input.dedupeKey?.trim()) throw new BadRequestException("缺少幂等去重键");
    const targets: Partial<Record<SubscriptionRequestType, SubscriptionPlan>> = { upgrade_pro: SubscriptionPlan.Pro, upgrade_consult: SubscriptionPlan.Pro, renew_pro: SubscriptionPlan.Pro, renew_standard: SubscriptionPlan.Standard, next_standard: SubscriptionPlan.Standard };
    const targetPlan = targets[input.type];
    if (!Object.values(SubscriptionRequestType).includes(input.type) || (input.targetPlan && input.targetPlan !== targetPlan)) throw new BadRequestException("申请目标与类型不一致");
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      const key = input.dedupeKey.trim();
      const sameKey = await tx.subscriptionRequest.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: key } } });
      if (sameKey?.status === "PENDING") {
        if (sameKey.type !== toDb(input.type)) throw new ConflictException("该幂等键已用于其他类型的申请");
        return sameKey;
      }
      const pending = await tx.subscriptionRequest.findFirst({ where: { tenantId, type: toDb(input.type) as DbReqType, status: "PENDING" } });
      if (pending) return pending;
      if (sameKey) await tx.subscriptionRequest.update({ where: { id: sameKey.id }, data: { dedupeKey: `released:${sameKey.id}:${randomUUID()}` } });
      return tx.subscriptionRequest.create({ data: { tenantId, type: toDb(input.type) as DbReqType, targetPlan: targetPlan ? toDb(targetPlan) as DbPlan : null, status: "PENDING", contactName: input.contactName, contactPhone: input.contactPhone, moduleIntent: input.moduleIntent, note: input.note, dedupeKey: key, timeline: [{ at: new Date().toISOString(), status: SubscriptionRequestStatus.Pending, note: "租户提交申请" }] } });
    });
    return this.toRequestRecord(created);
  }

  async cancelRequest(tenantId: string, requestId: string): Promise<SubscriptionRequestRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      const req = await tx.subscriptionRequest.findUnique({ where: { id: requestId } });
      if (!req || req.tenantId !== tenantId) throw new NotFoundException("申请不存在");
      if (req.status !== "PENDING") throw new ConflictException("仅未办理申请可撤销");
      const updated = await tx.subscriptionRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", timeline: [...(Array.isArray(req.timeline) ? req.timeline : []), { at: new Date().toISOString(), status: SubscriptionRequestStatus.Cancelled, note: "租户撤销申请" }] } });
      return this.toRequestRecord(updated);
    });
  }

  async handleRequest(requestId: string, input: HandleSubscriptionRequestRequest, operator?: string): Promise<SubscriptionRequestRecord> {
    if (![SubscriptionRequestStatus.Processed, SubscriptionRequestStatus.Rejected].includes(input.status)) throw new BadRequestException("办理结果只能为已办理或已拒绝");
    if (!input.publicReason?.trim()) throw new BadRequestException("请填写可公开的办理结果或拒绝原因");
    const initial = await this.prisma.subscriptionRequest.findUnique({ where: { id: requestId } });
    if (!initial) throw new NotFoundException("申请不存在");
    return this.prisma.$transaction(async (tx) => {
      const state = await this.writableState(tx, initial.tenantId, input.expectedRevision, new Date());
      const latest = await tx.subscriptionRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (latest.status !== "PENDING") throw new ConflictException("申请已关闭，请刷新");
      if (input.status === SubscriptionRequestStatus.Processed && !["UPGRADE_CONSULT", "NO_RENEW"].includes(initial.type)) throw new BadRequestException("授权类申请必须关联实际开通、续期或排期办理");
      if (state.current) await this.bump(tx, initial.tenantId, input.expectedRevision);
      const eventId = await this.appendEvent(tx, initial.tenantId, "TERM_CORRECTION", undefined, { requestId, status: input.status }, { reason: input.publicReason, note: input.note, operator });
      const updated = await tx.subscriptionRequest.update({ where: { id: requestId }, data: { status: toDb(input.status) as "PROCESSED" | "REJECTED", publicReason: input.publicReason, linkedEventId: eventId, timeline: [...(Array.isArray(initial.timeline) ? initial.timeline : []), { at: new Date().toISOString(), status: input.status, note: input.publicReason }] } });
      return this.toRequestRecord(updated);
    });
  }

  async grantFeature(tenantId: string, input: GrantTenantFeatureRequest, operator?: string): Promise<void> {
    if (!input.reason?.trim()) throw new BadRequestException("授权必须填写依据");
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { current } = await this.writableState(tx, tenantId, input.expectedRevision, now);
      const status = this.deriveStatus(current, now);
      if (status !== SubscriptionServiceStatus.Active && status !== SubscriptionServiceStatus.Expiring) throw new BadRequestException("单租户授权依附有效订阅，请先开通或续费");
      const feature = await tx.subscriptionFeatureCatalog.findUnique({ where: { code: input.featureCode } });
      if (!feature || !["RELEASED", "PILOT"].includes(feature.releaseStatus)) throw new BadRequestException("只能授权已上线或明确试点的功能");
      await this.bump(tx, tenantId, input.expectedRevision);
      await tx.tenantFeatureGrant.upsert({ where: { tenantId_featureCode: { tenantId, featureCode: input.featureCode } }, create: { tenantId, featureCode: input.featureCode, reason: input.reason, operator }, update: { revokedAt: null, revokedReason: null, effectiveAt: now, reason: input.reason, operator } });
      await this.appendEvent(tx, tenantId, "TENANT_GRANT", undefined, { featureCode: input.featureCode }, { reason: input.reason, operator });
    });
  }

  async revokeFeature(tenantId: string, input: RevokeTenantFeatureRequest, operator?: string): Promise<void> {
    if (!input.reason?.trim()) throw new BadRequestException("撤销授权必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const { current } = await this.writableState(tx, tenantId, input.expectedRevision, new Date());
      const grant = await tx.tenantFeatureGrant.findUnique({ where: { tenantId_featureCode: { tenantId, featureCode: input.featureCode } } });
      if (!grant || grant.revokedAt) throw new NotFoundException("没有生效中的此项授权");
      if (current) await this.bump(tx, tenantId, input.expectedRevision);
      await tx.tenantFeatureGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedReason: input.reason } });
      await this.appendEvent(tx, tenantId, "TENANT_REVOKE", { featureCode: input.featureCode }, undefined, { reason: input.reason, operator });
    });
  }

  async listFeatureCatalog(): Promise<SubscriptionFeatureCatalogEntry[]> {
    return (await this.prisma.subscriptionFeatureCatalog.findMany({ orderBy: [{ module: "asc" }, { name: "asc" }] })).map((r) => this.toCatalogEntry(r));
  }

  async getStandardPrices(): Promise<StandardPlanPricing[]> { return this.buildPricing(await this.prisma.subscriptionStandardPrice.findMany()); }

  async upsertFeatureCatalog(code: string, input: UpsertFeatureCatalogRequest, operator?: string): Promise<SubscriptionFeatureCatalogEntry> {
    const key = code.trim();
    if (!key) throw new BadRequestException("缺少功能编码");
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT code FROM subscription_feature_catalog WHERE code=${key} FOR UPDATE`;
      const existing = await tx.subscriptionFeatureCatalog.findUnique({ where: { code: key } });
      if (existing?.currentOwnership === "STANDARD" && input.currentOwnership === FeatureOwnership.Pro) throw new BadRequestException("公共下放权益不可直接收回，须另行确认租户告知与在途保护范围");
      const data = { name: input.name, module: input.module, categories: input.categories, defaultOwnership: toDb(input.defaultOwnership) as DbOwnership, currentOwnership: toDb(input.currentOwnership) as DbOwnership, releaseStatus: toDb(input.releaseStatus) as DbRelease, valueText: input.valueText ?? null, prerequisiteText: input.prerequisiteText ?? null, externalFeeNote: input.externalFeeNote ?? null, contentVersion: input.contentVersion ?? null, effectiveAt: new Date() };
      const row = await tx.subscriptionFeatureCatalog.upsert({ where: { code: key }, create: { code: key, ...data }, update: data });
      await this.appendEvent(tx, null, "CATALOG_UPDATE", existing ? { code: key, currentOwnership: toShared<FeatureOwnership>(existing.currentOwnership), releaseStatus: toShared<FeatureReleaseStatus>(existing.releaseStatus) } : undefined, { code: key, currentOwnership: input.currentOwnership, releaseStatus: input.releaseStatus }, { reason: input.reason, operator });
      return row;
    });
    return this.toCatalogEntry(saved);
  }

  async setStandardPrice(plan: SubscriptionPlan, input: SetStandardPriceRequest, operator?: string): Promise<StandardPlanPricing> {
    const amount = this.normalizeAmount(input.annualFee, input.currency);
    if (input.published && !amount.amount) throw new BadRequestException("发布价格必须提供正年费与币种");
    const dbPlan = toDb(plan) as DbPlan;
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionStandardPrice.findUnique({ where: { plan: dbPlan } });
      if ((existing?.priceVersion ?? null) !== (input.expectedPriceVersion ?? null)) throw new ConflictException("标准价已更新，请刷新后重试");
      const version = input.priceVersion?.trim() || randomUUID();
      if (existing && version === existing.priceVersion) throw new BadRequestException("修改价格须使用新的价格版本");
      const data = { annualFee: amount.amount, currency: amount.currency, taxInclusive: input.taxInclusive ?? null, published: input.published, priceVersion: version, note: input.note ?? null };
      if (existing) {
        const updated = await tx.subscriptionStandardPrice.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt }, data });
        if (!updated.count) throw new ConflictException("标准价已更新，请刷新后重试");
      } else {
        try { await tx.subscriptionStandardPrice.create({ data: { plan: dbPlan, ...data } }); }
        catch (error) { if ((error as { code?: string }).code === "P2002") throw new ConflictException("标准价已创建，请刷新后重试"); throw error; }
      }
      await this.appendEvent(tx, null, "PRICE_UPDATE", existing ? { plan, priceVersion: existing.priceVersion } : undefined, { plan, published: input.published, priceVersion: version }, { amount: input.annualFee, currency: input.currency, reason: input.note, operator });
      return tx.subscriptionStandardPrice.findUniqueOrThrow({ where: { plan: dbPlan } });
    });
    return this.buildPricing([saved]).find((p) => p.plan === plan)!;
  }

  private toCatalogEntry(row: SubscriptionFeatureCatalog): SubscriptionFeatureCatalogEntry {
    return { code: row.code, name: row.name, module: row.module, categories: row.categories as string[], defaultOwnership: toShared<FeatureOwnership>(row.defaultOwnership), currentOwnership: toShared<FeatureOwnership>(row.currentOwnership), releaseStatus: toShared<FeatureReleaseStatus>(row.releaseStatus), ...(row.valueText ? { valueText: row.valueText } : {}), ...(row.prerequisiteText ? { prerequisiteText: row.prerequisiteText } : {}), ...(row.externalFeeNote ? { externalFeeNote: row.externalFeeNote } : {}), ...(row.contentVersion ? { contentVersion: row.contentVersion } : {}) };
  }
}

const EVENT_ACTION_TEXT: Record<string, string> = {
  PROVISION: "开通", UPGRADE: "升级 PRO", RENEW: "续期", DOWNGRADE: "降级", TEMP_EXTENSION: "临时延长", TERM_CORRECTION: "期限修正 / 办理记录",
  PUBLIC_GRANT: "公共下放", PUBLIC_REVOKE: "取消公共下放", TENANT_GRANT: "单租户授权", TENANT_REVOKE: "撤销单租户授权", CATALOG_UPDATE: "功能目录更新", PRICE_UPDATE: "标准价更新"
};
