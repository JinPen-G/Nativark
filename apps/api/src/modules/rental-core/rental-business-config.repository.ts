import { rentalCategoryStorageCode } from "./category-identity";
import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type $Enums } from "@prisma/client";
import { RENTAL_CURRENCY_CODES, RENTAL_PRICING_UNIT_CODES } from "@rental-os/shared";
import { z } from 'zod';
import type {
  RentalCalendarDay,
  RentalCalendarOverrideAudit,
  RentalCalendarYear,
  RentalCategoryCode,
  RentalCurrency,
  RentalDayType,
  RentalDiscountPlan,
  RentalNotificationTemplateV1,
  RentalPricingPlanV1,
  RentalPricingRate,
  RentalRuleConfig,
  RentalRuleVersion,
  RentalRuleVersionAudit,
  RentalValueAddedService
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RENTAL_READINESS_FACT_LIMIT, type RentalConfigTx } from "./rental-core-config.repository";
import { getRequestIdentity, getRequestTenantId, getRequestWorkspaceId } from '../../common/request-identity';
import { requestFingerprint } from './rental-idempotency.repository';
import { RULE_VERSION_ISSUED_STATUSES, type RuleVersionTimelineEntry } from './rental-rule-version-chain';
import { assertScopedWrite, resolveScopeWorkspaceId } from "./workspace-scope";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";

const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
});

/** 单个租户的业务配置，用于启动预热写穿缓存。 */
/**
 * SPACE-03：单个**经营空间**的业务配置。同租户两个空间各有独立的定价、
 * 优惠、增值服务、营业日历、规则版本与通知模板。
 */
export interface TenantBusinessConfigSnapshot {
  tenantId: string;
  workspaceId: string;
  categoryCode?: RentalCategoryCode;
  pricingPlans: RentalPricingPlanV1[];
  discountPlans: RentalDiscountPlan[];
  services: RentalValueAddedService[];
  calendars: RentalCalendarYear[];
  ruleVersions: RentalRuleVersion[];
  notificationTemplates: RentalNotificationTemplateV1[];
  /**
   * 该空间的业务配置是否真的写过库。
   *
   * 必需：loadAll 现在为**每个经营空间**都返回一条（包括刚建好、还没写过配置的），
   * 而预热是「无条件覆盖，包括空数组」。缺这个标记就会把 seedState 生成的
   * 默认定价/优惠/服务/日历/规则/模板全部抹成空——表现为报价时
   * 「当前租户没有已启用的基础定价计划」。
   */
  hasPersistedConfig: boolean;
}

export interface RentalReadinessBusinessFacts {
  tenantId: string;
  workspaceId: string;
  ruleVersions: RuleVersionTimelineEntry[];
  publishedCalendarYears: number[];
  pricedGroupIds: string[];
  operationsAccounts: number;
  hasActiveRole: boolean;
  priceVersion: { sequence: number; effectiveFrom: string } | null;
  /** Present only when the persisted producer supplied this bounded source.
   * Legacy/test stores without it cannot attest an adopted calendar version. */
  calendarSource?: RentalReadinessCalendarSource;
}

/** Read-only current annual adoption metadata, never calendar days, prices or
 * an editable target. Publication/source references describe stored facts;
 * they do not attest the official registry or grant a calendar write. */
export interface RentalReadinessCalendarSource {
  readonly version: 'rental-calendar-read-source-1';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly years: ReadonlyArray<{
    readonly year: number;
    readonly status: 'adopted' | 'not_adopted';
    readonly binding: {
      readonly id: string;
      readonly year: number;
      readonly version: string;
      readonly status: 'published';
      readonly revision: number;
      readonly publishedAt: string;
      readonly officialSource: {
        readonly versionId: string | null;
        readonly version: string | null;
        readonly publishedAt: string | null;
        readonly importedAt: string | null;
      };
    } | null;
  }>;
  readonly sourceHash: string;
  readonly observations: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly consistency: 'caller_transaction_reads' | 'independent_persisted_reads';
  };
}

/** Preserve the original role override semantics without materializing members
 * or their roleAssignments. Empty legacy roleId follows the original JS test. */
export async function readRentalReadinessAccountFacts(prisma: Pick<PrismaService, 'workspaceMember'>, tenantId: string, workspaceId: string) {
  const where = { tenantId, workspaceId, isActive: true, user: { is: { isActive: true } } };
  const [operationsAccounts, activeRoleAccounts] = await Promise.all([
    prisma.workspaceMember.count({ where }),
    prisma.workspaceMember.count({ where: { ...where, OR: [
      { roleId: { not: null, notIn: [''] }, role: { is: { isActive: true } } },
      { OR: [{ roleId: null }, { roleId: '' }], user: { is: { OR: [
        { role: { is: { isActive: true } } },
        { roleAssignments: { some: { role: { is: { isActive: true } } } } }
      ] } } }
    ] } })
  ]);
  if (![operationsAccounts, activeRoleAccounts].every(value => Number.isSafeInteger(value) && value >= 0)
    || activeRoleAccounts > operationsAccounts) throw new ConflictException('开业账号事实无效或读取中变化');
  return { operationsAccounts, hasActiveRole: activeRoleAccounts > 0 };
}

/** Existing price-version targets/units for R0 selection, never money or a new quote. */
export type RentalQuoteRateTarget = Pick<RentalPricingRate, 'itemGroupId' | 'pricingGroupId' | 'unit'> & {
  priceVersionId: string; priceVersion: string;
};
/**
 * 业务配置的库侧接口。库是事实源，服务层内存副本是写穿缓存。
 * 各写入口可复用调用者原事务；范围读取和写入均参加该事务，提交/回滚仍归调用者。
 * 不连库的测试可注入吸收式store，但不能证明MySQL持久化与锁语义。
 */
export interface RentalBusinessConfigStore {
  loadAll(): Promise<TenantBusinessConfigSnapshot[]>;
  loadWorkspaceSnapshot?(tenantId: string, workspaceId: string, expected: CategoryWriteBinding): Promise<TenantBusinessConfigSnapshot>;
  readQuoteRateTargets?(tenantId: string, workspaceId: string, at: Date): Promise<RentalQuoteRateTarget[]>;
  /** Opening metadata only; never loads rule config, calendar days or prices. */
  readReadinessBusinessFacts?(tenantId: string, workspaceId: string, at: Date, calendarYears: readonly number[], tx?: RentalConfigTx): Promise<RentalReadinessBusinessFacts>;
  loadWorkspace?(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantBusinessConfigSnapshot>;
  upsertPricingPlan(plan: RentalPricingPlanV1, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void>;
  upsertDiscountPlan(plan: RentalDiscountPlan, expectedBinding?: CategoryWriteBinding, tx?: RentalConfigTx): Promise<void>;
  upsertService(service: RentalValueAddedService, expectedBinding?: CategoryWriteBinding, tx?: RentalConfigTx): Promise<void>;
  /** Current service admission under the same workspace mutex as service writers. */
  readServicesForExchange?(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<RentalValueAddedService[]>;
  upsertCalendar(
    calendar: RentalCalendarYear,
    expectedRevision?: number,
    audits?: RentalCalendarOverrideAudit[],
    tx?: RentalConfigTx
  ): Promise<void>;
  /**
   * 重新读取某年度的全部版本。乐观锁冲突后必须用它刷新进程内缓存：
   * 冲突说明缓存里那一版已经落后于库，继续基于它计算只会一直冲突，
   * 而把它简单丢弃又会让下一次编辑走「新建版本」路径、撞上库里已存在的版本号。
   */
  loadCalendarsForYear(tenantId: string, year: number): Promise<RentalCalendarYear[]>;
  /**
   * 读取某年度的人工覆盖审计（只追加表，按时间升序，**不截断**）。
   * `version` 给定时只回该版本的记录，供版本详情回放。
   */
  loadCalendarOverrideAudits(tenantId: string, year: number, version?: string): Promise<RentalCalendarOverrideAudit[]>;
  /** 某年度各版本的审计条数，供版本列表给出计数而不拉明细。 */
  countCalendarOverrideAudits(tenantId: string, year: number): Promise<Record<string, number>>;
  /**
   * 发布年度日历：新版本置 published 与旧版本置 superseded 必须在同一事务内。
   * 分两次写在失败时会留下两个 published 版本，或留下该年度没有已发布日历的空窗。
   */
  publishCalendarVersion(
    next: RentalCalendarYear,
    superseded?: RentalCalendarYear,
    expectedRevisions?: { next: number; superseded: number }
  ): Promise<void>;
  upsertRuleVersion(version: RentalRuleVersion, expectedBinding?: CategoryWriteBinding, tx?: RentalConfigTx): Promise<void>;
  /** Exact original target for refreshing a confirmed bound draft operation. */
  loadRuleVersionById?(tenantId: string, workspaceId: string, id: string): Promise<RentalRuleVersion | null>;
  /**
   * RULE-01A：写规则版本并追加一条审计。发布、恢复、作废三类动作都走这里。
   * 版本行与审计必须同一事务：分两次写，失败时会留下一个没有原因、没有操作者的生效版本，
   * 而需求 4.6.14 要求这三类动作**必须**有完整审计。
   */
  writeRuleVersionWithAudit(
    version: RentalRuleVersion,
    audit: RentalRuleVersionAudit,
    /** 一并落库的其它版本行（如被替代版本的状态与时间戳）。 */
    alsoWrite?: RentalRuleVersion[],
    expectedBinding?: CategoryWriteBinding
  ): Promise<void>;
  loadRuleVersionAudits(tenantId: string, workspaceId: string, ruleVersionId?: string): Promise<RentalRuleVersionAudit[]>;
  upsertNotificationTemplate(template: RentalNotificationTemplateV1, tx?: RentalConfigTx): Promise<void>;
  replaceNotificationTemplateVersion(
    previous: RentalNotificationTemplateV1,
    next: RentalNotificationTemplateV1
  ): Promise<void>;
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

function optionalNum(value: Prisma.Decimal | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function upper<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

function money(value: number | undefined) {
  return value === undefined ? null : new Prisma.Decimal(value);
}

/** RC-01 阶段 4：Rental Core 业务配置的库侧实现（定价、优惠、增值服务、日历、规则版本、通知模板）。 */
@Injectable()
export class RentalBusinessConfigRepository implements RentalBusinessConfigStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Current business configuration only. The expected Core binding prevents a
   * second read from joining a different adoption; empty sets remain empty. */
  async loadWorkspaceSnapshot(tenantId: string, workspaceId: string, expected: CategoryWriteBinding): Promise<TenantBusinessConfigSnapshot> {
    return this.prisma.$transaction(async tx => {
      const { definition } = await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected);
      const where = { tenantId, workspaceId };
      const [pricing, discounts, services, calendars, rules, templates] = await Promise.all([
        tx.rentalPricingPlan.findMany({ where, orderBy: { createdAt: "desc" } }), tx.rentalDiscountPlan.findMany({ where, orderBy: { createdAt: "desc" } }),
        tx.rentalValueAddedService.findMany({ where, orderBy: { createdAt: "desc" } }), tx.rentalBusinessCalendar.findMany({ where, orderBy: { year: "desc" } }),
        tx.rentalRuleVersion.findMany({ where, orderBy: { createdAt: "desc" } }), tx.rentalNotificationTemplate.findMany({ where, orderBy: { createdAt: "desc" } })
      ]);
      return { tenantId, workspaceId, categoryCode: definition.code,
        pricingPlans: pricing.map(row => this.toPricingPlan(row)), discountPlans: discounts.map(row => this.toDiscountPlan(row)),
        services: services.map(row => this.toService(row)), calendars: calendars.map(row => this.toCalendar(row)),
        ruleVersions: rules.map(row => this.toRuleVersion(row)), notificationTemplates: templates.map(row => this.toNotificationTemplate(row)),
        hasPersistedConfig: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async readQuoteRateTargets(tenantId: string, workspaceId: string, at: Date): Promise<RentalQuoteRateTarget[]> {
    const assertScope = async () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || await resolveScopeWorkspaceId(this.prisma, tenantId) !== workspaceId) throw new ForbiddenException('报价价格目标读取范围变化');
    };
    await assertScope();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new ConflictException('报价价格观察时间无效');
    type Row = { tenantId: string; workspaceId: string; id: string; sequence: number; ratesType: string;
      rateCount: number | bigint; rateIndex: number | bigint | null; pricingGroupId: string | null; itemGroupId: string | null; unit: string | null };
    // Same immutable-version selection as Core.findSpaceVersionAt. Project only
    // target/unit identity; never send the price snapshot, amounts or tier blobs.
    // Bound JSON_TABLE's input first, not just the final transmitted rows.
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT v.tenantId, v.workspaceId, v.id, v.sequence, JSON_TYPE(v.rates) AS ratesType, JSON_LENGTH(v.rates) AS rateCount, r.rateIndex,
        CASE WHEN JSON_TYPE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].pricingGroupId'))) = 'STRING'
          THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].pricingGroupId'))), 192)
          WHEN JSON_TYPE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].pricingGroupId'))) IS NULL THEN NULL ELSE '!' END AS pricingGroupId,
        CASE WHEN JSON_TYPE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].itemGroupId'))) = 'STRING'
          THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].itemGroupId'))), 192)
          WHEN JSON_TYPE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].itemGroupId'))) IS NULL THEN NULL ELSE '!' END AS itemGroupId,
        LEFT(JSON_UNQUOTE(JSON_EXTRACT(v.rates, CONCAT('$[', r.rateIndex - 1, '].unit'))), 192) AS unit
      FROM (SELECT tenantId, workspaceId, id, sequence, rates FROM rental_price_versions
        WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND effectiveFrom <= ${at}
        ORDER BY effectiveFrom DESC, sequence DESC LIMIT 1) AS v
      LEFT JOIN JSON_TABLE(CASE WHEN JSON_TYPE(v.rates) = 'ARRAY' AND JSON_LENGTH(v.rates) <= ${RENTAL_READINESS_FACT_LIMIT}
        THEN v.rates ELSE JSON_ARRAY() END, '$[*]' COLUMNS (rateIndex FOR ORDINALITY)) AS r ON TRUE
      ORDER BY r.rateIndex LIMIT ${RENTAL_READINESS_FACT_LIMIT + 1}`);
    await assertScope();
    if (!rows.length) return [];
    const first = rows[0], count = Number(first.rateCount);
    if (first.ratesType !== 'ARRAY' || !Number.isSafeInteger(count) || count < 0 || count > RENTAL_READINESS_FACT_LIMIT
      || rows.length > RENTAL_READINESS_FACT_LIMIT) throw new ServiceUnavailableException('报价价格目标超出只读上限或不可用');
    const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    if (!id.safeParse(first.id).success || !Number.isSafeInteger(first.sequence) || first.sequence < 1
      || rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.id !== first.id
        || row.sequence !== first.sequence || row.ratesType !== 'ARRAY' || Number(row.rateCount) !== count)) throw new ConflictException('报价价格目标来源变化');
    if (count === 0) {
      if (rows.length !== 1 || first.rateIndex !== null) throw new ConflictException('报价空价格版本来源无效');
      return [];
    }
    if (rows.length !== count || rows.some((row, index) => Number(row.rateIndex) !== index + 1)) throw new ConflictException('报价价格目标读取不完整');
    // The formal RentalPricingRate keeps itemGroupId as the required legacy
    // binding even for a pricingGroupId rate. Missing it is corrupt source data,
    // not permission to synthesize an alias or relax the shared contract.
    const target = z.object({ pricingGroupId: id.optional(), itemGroupId: id, unit: z.enum(RENTAL_PRICING_UNIT_CODES) });
    return rows.map(row => {
      const parsed = target.safeParse({ ...(row.pricingGroupId !== null ? { pricingGroupId: row.pricingGroupId } : {}),
        ...(row.itemGroupId !== null ? { itemGroupId: row.itemGroupId } : {}), unit: row.unit });
      if (!parsed.success) throw new ConflictException('报价价格目标字段无效');
      return { ...parsed.data, priceVersionId: first.id, priceVersion: `v${first.sequence}` };
    });
  }

  /** Bounded original metadata under an optional caller-owned transaction;
   * no new transaction, lock or readiness algorithm is introduced. */
  async readReadinessBusinessFacts(tenantId: string, workspaceId: string, at: Date, calendarYears: readonly number[], tx?: RentalConfigTx): Promise<RentalReadinessBusinessFacts> {
    const client = tx ?? this.prisma;
    const now = new Date(at), years = [...calendarYears], identity = requestFingerprint(getRequestIdentity());
    if (!Number.isFinite(now.getTime()) || years.length < 1 || years.length > 3
      || years.some(year => !Number.isInteger(year) || year < 1 || year > 9999)
      || new Set(years).size !== years.length) throw new ConflictException('开业查询时点或营业年度无效');
    const assertScope = async () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || requestFingerprint(getRequestIdentity()) !== identity)
        throw new ForbiddenException('开业读取缺少当前租户或经营空间');
      const resolved = await resolveScopeWorkspaceId(client, tenantId);
      if (resolved !== workspaceId || getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || requestFingerprint(getRequestIdentity()) !== identity)
        throw new ForbiddenException('开业读取缺少当前租户或经营空间');
    };
    await assertScope();
    const startedAt = new Date().toISOString();
    const where = { tenantId, workspaceId };
    type RateReference = { tenantId: string; workspaceId: string; planId: string; ratesType: string;
      rateIndex: number | null; pricingGroupId: string | null; pricingGroupIdType: string | null;
      itemGroupId: string | null; itemGroupIdType: string | null };
    const [rules, calendarBindings, refs, accounts, priceVersion] = await Promise.all([
      // Two latest issued rows are enough to preserve the original same-time
      // conflict test. Older rule contents/history are not opening facts.
      client.rentalRuleVersion.findMany({ where: { ...where, status: { in: [...RULE_VERSION_ISSUED_STATUSES] }, effectiveFrom: { lte: now } },
        select: { id: true, tenantId: true, workspaceId: true, version: true, status: true, effectiveFrom: true },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }], take: 2 }),
      this.readReadinessCalendarBindings(client, tenantId, workspaceId, now, years),
      // JSON_TABLE supplies only ordinality; extract target identifiers, not
      // monetary fields or full rates JSON. Empty plans still get a sentinel
      // row, and the global LIMIT bounds both plans and rate references.
      client.$queryRaw<RateReference[]>(Prisma.sql`
        SELECT p.tenantId, p.workspaceId, p.id AS planId, JSON_TYPE(p.rates) AS ratesType,
          r.rateIndex,
          JSON_UNQUOTE(JSON_EXTRACT(p.rates, CONCAT('$[', r.rateIndex - 1, '].pricingGroupId'))) AS pricingGroupId,
          JSON_TYPE(JSON_EXTRACT(p.rates, CONCAT('$[', r.rateIndex - 1, '].pricingGroupId'))) AS pricingGroupIdType,
          JSON_UNQUOTE(JSON_EXTRACT(p.rates, CONCAT('$[', r.rateIndex - 1, '].itemGroupId'))) AS itemGroupId,
          JSON_TYPE(JSON_EXTRACT(p.rates, CONCAT('$[', r.rateIndex - 1, '].itemGroupId'))) AS itemGroupIdType
        FROM rental_pricing_plans AS p
        LEFT JOIN JSON_TABLE(p.rates, '$[*]' COLUMNS (rateIndex FOR ORDINALITY)) AS r ON TRUE
        WHERE p.tenantId = ${tenantId} AND p.workspaceId = ${workspaceId} AND p.status = 'enabled'
        ORDER BY p.id, r.rateIndex LIMIT ${RENTAL_READINESS_FACT_LIMIT + 1}`),
      readRentalReadinessAccountFacts(client, tenantId, workspaceId),
      client.rentalPriceVersion.findFirst({ where: { ...where, effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
        select: { tenantId: true, workspaceId: true, sequence: true, effectiveFrom: true } })
    ]);
    if (refs.length > RENTAL_READINESS_FACT_LIMIT) throw new ServiceUnavailableException('开业价格引用超出读取上限');
    const owns = (row: { tenantId: string; workspaceId: string }) => row.tenantId === tenantId && row.workspaceId === workspaceId;
    if (rules.length > 2 || rules.some(row => !owns(row) || typeof row.id !== 'string' || !row.id
      || typeof row.version !== 'string' || !row.version || row.version.length > 191
      || !(RULE_VERSION_ISSUED_STATUSES as readonly string[]).includes(row.status)
      || !(row.effectiveFrom instanceof Date) || !Number.isFinite(row.effectiveFrom.getTime()) || row.effectiveFrom > now)
      || new Set(rules.map(row => row.id)).size !== rules.length
      || priceVersion && (!owns(priceVersion) || !Number.isSafeInteger(priceVersion.sequence) || priceVersion.sequence < 1
        || !(priceVersion.effectiveFrom instanceof Date) || !Number.isFinite(priceVersion.effectiveFrom.getTime()) || priceVersion.effectiveFrom > now))
      throw new ConflictException('开业业务元数据来源或内容无效');
    const identifiers = new Set<string>(), seen = new Set<string>();
    const referenceId = (value: string | null, type: string | null) => {
      if (type === null || type === 'NULL') return undefined;
      if (type !== 'STRING' || typeof value !== 'string' || !value || value.length > 191)
        throw new ConflictException('开业价格引用无效');
      return value;
    };
    for (const row of refs) {
      const key = `${row.planId}:${row.rateIndex}`;
      if (!owns(row) || typeof row.planId !== 'string' || !row.planId || row.planId.length > 191
        || row.ratesType !== 'ARRAY' || seen.has(key)
        || row.rateIndex !== null && (!Number.isSafeInteger(row.rateIndex) || row.rateIndex < 1))
        throw new ConflictException('开业价格引用来源或结构无效');
      seen.add(key);
      if (row.rateIndex === null) continue;
      const pricingGroupId = referenceId(row.pricingGroupId, row.pricingGroupIdType);
      const itemGroupId = referenceId(row.itemGroupId, row.itemGroupIdType);
      // Same nullish target precedence as the original pricingTargetId; no
      // amount, price validity or quote algorithm is recalculated here.
      const target = pricingGroupId ?? itemGroupId;
      if (!target) throw new ConflictException('开业价格引用缺少目标');
      identifiers.add(target);
    }
    // A same-year replacement must not disappear behind an unchanged annual
    // count or summary. Re-read metadata through this original client; this is
    // an observation fence, not a new transaction or a total readiness version.
    const currentCalendars = await this.readReadinessCalendarBindings(client, tenantId, workspaceId, now, years);
    const calendarBasis = { version: 'rental-calendar-read-source-1' as const, tenantId, workspaceId, years: calendarBindings };
    const sourceHash = requestFingerprint(calendarBasis);
    if (requestFingerprint({ ...calendarBasis, years: currentCalendars }) !== sourceHash)
      throw new ConflictException('开业读取期间营业日历采用版本已变化，请重新读取');
    await assertScope();
    return { tenantId, workspaceId, ruleVersions: rules.map(row => ({ id: row.id, version: row.version,
      status: row.status as RentalRuleVersion['status'], effectiveFrom: row.effectiveFrom!.toISOString() })),
      publishedCalendarYears: calendarBindings.filter(row => row.status === 'adopted').map(row => row.year),
      calendarSource: { ...calendarBasis, sourceHash, observations: { startedAt, completedAt: new Date().toISOString(),
        consistency: tx ? 'caller_transaction_reads' : 'independent_persisted_reads' } },
      pricedGroupIds: [...identifiers], ...accounts,
      priceVersion: priceVersion ? { sequence: priceVersion.sequence, effectiveFrom: priceVersion.effectiveFrom.toISOString() } : null };
  }

  /** At most two current rows per requested year: the second proves a conflict,
   * never a reason to pick the largest version. Missing publication facts are
   * unavailable; zero rows explicitly mean no adopted version, not a default. */
  private async readReadinessCalendarBindings(client: RentalConfigTx, tenantId: string, workspaceId: string,
    at: Date, years: readonly number[]): Promise<RentalReadinessCalendarSource['years']> {
    if (typeof client.rentalBusinessCalendar?.findMany !== 'function')
      throw new ServiceUnavailableException('营业日历绑定来源不可用');
    return Promise.all(years.map(async year => {
      const rows = await client.rentalBusinessCalendar.findMany({ where: { tenantId, workspaceId, year, status: 'published' },
        select: { id: true, tenantId: true, workspaceId: true, year: true, version: true, status: true, revision: true,
          publishedAt: true, sourceVersionId: true, sourceVersion: true, sourcePublishedAt: true, importedAt: true },
        orderBy: { id: 'asc' }, take: 2 });
      if (rows.length > 1) throw new ConflictException(`${year} 年度存在多个已发布营业日历，无法唯一确定采用版本`);
      const row = rows[0];
      if (!row) return { year, status: 'not_adopted' as const, binding: null };
      const identifier = (value: unknown) => typeof value === 'string' && Boolean(value.trim()) && value.length <= 191;
      const instant = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) && value <= at;
      if (row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.year !== year || row.status !== 'published'
        || !identifier(row.id) || !identifier(row.version) || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > 2147483647)
        throw new ConflictException('营业日历绑定范围或原修订无效');
      if (!instant(row.publishedAt)) throw new ServiceUnavailableException('营业日历缺少可核对的原发布依据');
      if (row.sourceVersionId !== null && !identifier(row.sourceVersionId) || row.sourceVersion !== null && !identifier(row.sourceVersion)
        || row.sourcePublishedAt !== null && !instant(row.sourcePublishedAt) || row.importedAt !== null && !instant(row.importedAt))
        throw new ConflictException('营业日历原来源引用或时点无效');
      return { year, status: 'adopted' as const, binding: { id: row.id, year: row.year, version: row.version,
        status: 'published' as const, revision: row.revision, publishedAt: row.publishedAt!.toISOString(),
        officialSource: { versionId: row.sourceVersionId, version: row.sourceVersion,
          publishedAt: row.sourcePublishedAt?.toISOString() ?? null, importedAt: row.importedAt?.toISOString() ?? null } } };
    }));
  }

  async loadAll(): Promise<TenantBusinessConfigSnapshot[]> {
    const [workspaces, pricing, discounts, services, calendars, rules, templates] = await Promise.all([
      this.prisma.businessWorkspace.findMany({ select: { id: true, tenantId: true, categoryCode: true } }),
      this.prisma.rentalPricingPlan.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalDiscountPlan.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalValueAddedService.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalBusinessCalendar.findMany({ orderBy: { year: "desc" } }),
      this.prisma.rentalRuleVersion.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.rentalNotificationTemplate.findMany({ orderBy: { createdAt: "desc" } })
    ]);

    // 以经营空间为单位分组。空间集合取自 business_workspaces 而不是从配置行反推：
    // 一个还没有任何业务配置的空间同样必须得到状态。
    return workspaces.map((workspace) => {
      const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspace.id);
      const wsRules = mine(rules);
      return {
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        // 品类以经营空间为准（需求 3），不再从配置行反推。
        categoryCode: lower<RentalCategoryCode>(workspace.categoryCode),
        pricingPlans: mine(pricing).map((row) => this.toPricingPlan(row)),
        discountPlans: mine(discounts).map((row) => this.toDiscountPlan(row)),
        services: mine(services).map((row) => this.toService(row)),
        calendars: mine(calendars).map((row) => this.toCalendar(row)),
        ruleVersions: wsRules.map((row) => this.toRuleVersion(row)),
        notificationTemplates: mine(templates).map((row) => this.toNotificationTemplate(row)),
        hasPersistedConfig: Boolean(
          mine(pricing).length ||
            mine(discounts).length ||
            mine(services).length ||
            mine(calendars).length ||
            wsRules.length ||
            mine(templates).length
        )
      };
    });
  }

  /** Reuse the original decoders for one transaction-scoped pricing context. */
  async loadWorkspace(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantBusinessConfigSnapshot> {
    const where = { tenantId, workspaceId };
    const [workspace, pricing, discounts, services, calendars, rules] = await Promise.all([
      tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true } }),
      tx.rentalPricingPlan.findMany({ where }), tx.rentalDiscountPlan.findMany({ where }), tx.rentalValueAddedService.findMany({ where }),
      tx.rentalBusinessCalendar.findMany({ where }), tx.rentalRuleVersion.findMany({ where }),
    ]);
    if (!workspace) throw new ConflictException("经营空间不存在");
    return { tenantId, workspaceId, categoryCode: lower<RentalCategoryCode>(workspace.categoryCode), pricingPlans: pricing.map(row => this.toPricingPlan(row)),
      discountPlans: discounts.map(row => this.toDiscountPlan(row)), services: services.map(row => this.toService(row)), calendars: calendars.map(row => this.toCalendar(row)),
      ruleVersions: rules.map(row => this.toRuleVersion(row)), notificationTemplates: [], hasPersistedConfig: Boolean(pricing.length || services.length || rules.length || calendars.length) };
  }

  async upsertPricingPlan(plan: RentalPricingPlanV1, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void> {
    const data = {
      tenantId: plan.tenantId,
      categoryCode: rentalCategoryStorageCode(plan.categoryCode),
      code: plan.code,
      name: plan.name,
      currency: plan.currency,
      status: plan.status,
      version: plan.version,
      effectiveFrom: new Date(plan.effectiveFrom),
      effectiveTo: plan.effectiveTo ? new Date(plan.effectiveTo) : null,
      rates: plan.rates as unknown as Prisma.InputJsonValue,
      // 未配置时写 null 而不是 []：null 表示"该计划不收履约费"，
      // 与"配了一个空清单"在语义上同义，但省掉一次无意义的 JSON 解析。
      fulfillmentFees: (plan.fulfillmentFees ?? null) as unknown as Prisma.InputJsonValue
    };
    // Standalone scope resolution precedes our transaction so the workspace
    // lock is its first read. A caller-owned transaction retains its own fence
    // and must also own the scope read; never escape through the root client.
    const workspaceId = await resolveScopeWorkspaceId(tx ?? this.prisma, plan.tenantId);
    const write = async (client: RentalConfigTx) => {
    const { definition } = await lockActiveCategoryBinding(client, plan.tenantId, workspaceId, expectedBinding, plan.categoryCode);
    const existing = await client.rentalPricingPlan.findUnique({ where: { id: plan.id }, select: { tenantId: true, workspaceId: true } });
    assertScopedWrite(existing, plan.tenantId, workspaceId, "基础定价计划");
    if (plan.rates.some((rate) => !definition.businessModel.pricingUnits.includes(rate.unit))) throw new ConflictException("价格计划包含当前品类不支持的计价单位");
    if (plan.fulfillmentFees?.some((fee) => !definition.businessModel.fulfillmentModes.includes(fee.mode))) throw new ConflictException("价格计划包含当前品类不支持的履约收费方式");
    await client.rentalPricingPlan.upsert({
      where: { id: plan.id },
      create: { workspaceId, id: plan.id, ...data, createdAt: new Date(plan.createdAt) },
      update: data
    });
    };
    if (tx) await write(tx); else await this.prisma.$transaction(write);
  }

  async upsertDiscountPlan(plan: RentalDiscountPlan, expectedBinding?: CategoryWriteBinding, existingTx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: plan.tenantId,
      categoryCode: rentalCategoryStorageCode(plan.categoryCode),
      code: plan.code,
      name: plan.name,
      status: plan.status,
      discountType: plan.discountType,
      discountValue: new Prisma.Decimal(plan.discountValue),
      minimumSpend: new Prisma.Decimal(plan.minimumSpend),
      thresholdAmount: money(plan.thresholdAmount),
      maximumDiscount: money(plan.maximumDiscount),
      appliesTo: plan.appliesTo,
      exclusiveGroup: plan.exclusiveGroup ?? null,
      stackableWithOtherPlans: plan.stackableWithOtherPlans,
      customerScope: plan.customerScope,
      applicableItemGroupIds: plan.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      applicablePricingGroupIds: (plan.applicablePricingGroupIds ?? []) as unknown as Prisma.InputJsonValue,
      applicableDayTypes: plan.applicableDayTypes as unknown as Prisma.InputJsonValue,
      priority: plan.priority,
      stackableWithCoupon: plan.stackableWithCoupon,
      effectiveFrom: new Date(plan.effectiveFrom),
      effectiveTo: plan.effectiveTo ? new Date(plan.effectiveTo) : null,
      version: plan.version
    };
    const workspaceId = await resolveScopeWorkspaceId(existingTx ?? this.prisma, plan.tenantId);
    const write = async (tx: RentalConfigTx) => {
      await lockActiveCategoryBinding(tx, plan.tenantId, workspaceId, expectedBinding, plan.categoryCode);
      const existing = await tx.rentalDiscountPlan.findUnique({ where: { id: plan.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, plan.tenantId, workspaceId, "优惠方案");
      await tx.rentalDiscountPlan.upsert({
        where: { id: plan.id },
        create: { workspaceId, id: plan.id, ...data, createdAt: new Date(plan.createdAt) },
        update: data
      });
    };
    if (existingTx) await write(existingTx); else await this.prisma.$transaction(write);
  }

  async readServicesForExchange(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<RentalValueAddedService[]> {
    if (!workspaceId || workspaceId !== await resolveScopeWorkspaceId(tx, tenantId)) throw new ConflictException("换货服务经营空间不一致");
    const workspace = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM business_workspaces WHERE id = ${workspaceId} AND tenantId = ${tenantId} FOR UPDATE`);
    if (!workspace.length) throw new ConflictException("换货服务经营空间不存在");
    const rows = await tx.$queryRaw<Prisma.RentalValueAddedServiceGetPayload<object>[]>(Prisma.sql`
      SELECT * FROM rental_value_added_services
      WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} ORDER BY id FOR UPDATE`);
    return rows.map(row => {
      const value: unknown = row.requiresCapacity;
      if (![true, false, 0, 1].includes(value as boolean | number)) throw new ConflictException("服务容量配置无效");
      return this.toService({ ...row, requiresCapacity: value === true || value === 1 });
    });
  }

  async upsertService(service: RentalValueAddedService, expectedBinding?: CategoryWriteBinding, existingTx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: service.tenantId,
      categoryCode: rentalCategoryStorageCode(service.categoryCode),
      code: service.code,
      name: service.name,
      serviceType: service.serviceType,
      billingUnit: service.billingUnit,
      price: new Prisma.Decimal(service.price),
      minimumQuantity: service.minimumQuantity,
      maximumQuantity: service.maximumQuantity,
      coverageLimit: money(service.coverageLimit),
      deductible: money(service.deductible),
      termsVersion: service.termsVersion,
      terms: service.terms,
      applicableItemGroupIds: service.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      applicableFulfillmentModes: service.applicableFulfillmentModes as unknown as Prisma.InputJsonValue,
      applicableLocationIds: service.applicableLocationIds as unknown as Prisma.InputJsonValue,
      customerScope: service.customerScope,
      selectionMode: service.selectionMode,
      mandatoryRule: (service.mandatoryRule ?? null) as unknown as Prisma.InputJsonValue,
      insuranceProviderStatus: service.insuranceProviderStatus ?? null,
      insuranceProviderName: service.insuranceProviderName ?? null,
      requiresCapacity: service.requiresCapacity,
      status: service.status,
      version: service.version
    };
    const workspaceId = await resolveScopeWorkspaceId(existingTx ?? this.prisma, service.tenantId);
    const snapshot = JSON.parse(JSON.stringify({ ...service, workspaceId })) as Prisma.InputJsonValue;
    const write = async (tx: RentalConfigTx) => {
      const { definition } = await lockActiveCategoryBinding(tx, service.tenantId, workspaceId, expectedBinding, service.categoryCode);
      const modes = [...service.applicableFulfillmentModes, ...(service.mandatoryRule?.fulfillmentModes ?? [])];
      if (modes.some((mode) => !definition.businessModel.fulfillmentModes.includes(mode))) throw new ConflictException("增值服务包含当前品类不支持的履约方式");
      const existing = await tx.rentalValueAddedService.findUnique({ where: { id: service.id }, select: { tenantId: true, workspaceId: true, version: true } });
      assertScopedWrite(existing, service.tenantId, workspaceId, "增值服务");
      await tx.rentalValueAddedService.upsert({
        where: { id: service.id },
        create: { workspaceId, id: service.id, ...data, createdAt: new Date(service.createdAt) },
        update: data
      });
      // 当前主档可继续前进，但每个服务版本只追加一次。报价和订单另存正文快照，
      // 版本表用于运营回放与证明“旧版本没有被原地改写”。
      const existingVersion = await tx.rentalValueAddedServiceVersion.findUnique({
        where: {
          serviceId_serviceVersion: {
            serviceId: service.id,
            serviceVersion: service.version
          }
        },
        select: { snapshot: true }
      });
      if (existingVersion) {
        if (existing && existing.version !== service.version) throw new ConflictException("增值服务版本已前进，历史版本不可覆盖当前主档；请刷新后重试");
        if (canonicalJson(existingVersion.snapshot) !== canonicalJson(snapshot)) {
          throw new ConflictException(
            `增值服务 ${service.code} 的版本 ${service.version} 已存在，不能原地改写；请递增服务版本后再保存`
          );
        }
        return;
      }
      await tx.rentalValueAddedServiceVersion.create({
        data: {
          tenantId: service.tenantId,
          workspaceId,
          serviceId: service.id,
          serviceVersion: service.version,
          termsVersion: service.termsVersion,
          snapshot,
          createdAt: new Date(service.updatedAt)
        }
      });
    };
    if (existingTx) await write(existingTx); else await this.prisma.$transaction(write);
  }

  /** 日历按 (租户, 年份, 版本) 唯一；整年按日明细随该行一起写。 */
  private calendarData(calendar: RentalCalendarYear) {
    return {
      region: calendar.region,
      version: calendar.version,
      status: calendar.status,
      sourceName: calendar.sourceName ?? null,
      sourceUrl: calendar.sourceUrl ?? null,
      sourcePublishedAt: calendar.sourcePublishedAt ? new Date(calendar.sourcePublishedAt) : null,
      // 引用的公共来源版本（需求 4.5.7）。漏接这两列会得到「schema 有列、领域对象有值、
      // 落库永远为 NULL」——重启后追溯不出这一年的官方安排来自哪一版。
      sourceVersionId: calendar.sourceVersionId ?? null,
      sourceVersion: calendar.sourceVersion ?? null,
      importedAt: calendar.importedAt ? new Date(calendar.importedAt) : null,
      publishedAt: calendar.publishedAt ? new Date(calendar.publishedAt) : null,
      // 发布记录字段（需求 4.5.7）。漏掉它们的话 schema 有列、领域对象也有值，
      // 但落库全是 NULL——E2E 断言「发布记录必须能追溯上一版本号」正是这样报出来的。
      supersededAt: calendar.supersededAt ? new Date(calendar.supersededAt) : null,
      publishedBy: calendar.publishedBy ?? null,
      changeReason: calendar.changeReason ?? null,
      previousVersion: calendar.previousVersion ?? null,
      restoredFromVersion: calendar.restoredFromVersion ?? null,
      restoreReason: calendar.restoreReason ?? null,
      voidedAt: calendar.voidedAt ? new Date(calendar.voidedAt) : null,
      voidedBy: calendar.voidedBy ?? null,
      voidReason: calendar.voidReason ?? null,
      publishDiff: (calendar.publishDiff ?? null) as unknown as Prisma.InputJsonValue,
      // 审计已搬到只追加的独立表（JSON 里的 slice(-500) 截断会静默删掉最早记录，
      // 与需求 4.5.8「完整审计」冲突）。这里恒写 null：迁移已把历史 JSON 回填成行，
      // 保留双写只会让两份数据分叉。
      overrideAudits: Prisma.DbNull,
      importPreservedOverrides: (calendar.importPreservedOverrides ?? null) as unknown as Prisma.InputJsonValue,
      days: calendar.days as unknown as Prisma.InputJsonValue,
      revision: calendar.revision ?? 0
    };
  }

  /**
   * 写入年度日历，并在**同一事务**内追加本次产生的覆盖审计。
   *
   * `expectedRevision` 给出读到该行时的 revision，写入即以它为条件。为什么必须条件写：
   * 整年日期在同一个 JSON 字段里，两个编辑人同时改不同日期时都会复制全年再写回，
   * 无条件 upsert 会让后写者整体覆盖先写者，双方都收到成功。条件不匹配时抛 409。
   *
   * 审计与日历同事务：审计留在一个被回滚的编辑上（或反之）比没有审计更难排查。
   */
  async upsertCalendar(
    calendar: RentalCalendarYear,
    expectedRevision?: number,
    audits: RentalCalendarOverrideAudit[] = [],
    existingTx?: RentalConfigTx
  ): Promise<void> {
    const data = this.calendarData(calendar);
    const workspaceId = await resolveScopeWorkspaceId(existingTx ?? this.prisma, calendar.tenantId);
    try {
      const write = async (tx: RentalConfigTx) => {
      // Calendar changes participate in adoption preflight. Hold the same space
      // lock until both the calendar and its override audit have committed.
      await lockActiveCategoryBinding(tx, calendar.tenantId, workspaceId);
      if (audits.some((entry) => (entry.year !== undefined && entry.year !== calendar.year) || (entry.version !== undefined && entry.version !== calendar.version))) {
        throw new ConflictException("日历覆盖审计必须属于本次写入的年度与版本");
      }
      if (expectedRevision === undefined) {
        await tx.rentalBusinessCalendar.upsert({
          where: { workspaceId_year_version: { workspaceId, year: calendar.year, version: calendar.version } },
          create: { workspaceId, tenantId: calendar.tenantId, year: calendar.year, ...data },
          update: data
        });
      } else {
        // 条件更新：只有 revision 仍是读到的值时才写入。
        const updated = await tx.rentalBusinessCalendar.updateMany({
          where: { workspaceId, year: calendar.year, version: calendar.version, revision: expectedRevision },
          data
        });
        if (updated.count === 0) {
          // 没更新到：要么该行还不存在（首次写这个版本号），要么 revision 已被别人推进。
          const existing = await tx.rentalBusinessCalendar.findUnique({
            where: { workspaceId_year_version: { workspaceId, year: calendar.year, version: calendar.version } },
            select: { revision: true }
          });
          if (existing) {
            throw new ConflictException(
              `${calendar.year} 年度日历已被其他人修改（当前版本 ${existing.revision}，你基于 ${expectedRevision}），请刷新后重试`
            );
          }
          await tx.rentalBusinessCalendar.create({
            data: { workspaceId, tenantId: calendar.tenantId, year: calendar.year, ...data }
          });
        }
      }
      if (audits.length) {
        await tx.rentalCalendarOverrideAuditEntry.createMany({
          data: audits.map((entry) => ({
            tenantId: calendar.tenantId,
            workspaceId,
            year: entry.year ?? calendar.year,
            version: entry.version ?? calendar.version,
            date: entry.date,
            action: entry.action,
            reason: entry.reason,
            operator: entry.operator ?? null,
            at: new Date(entry.at),
            batchId: entry.batchId ?? null,
            before: (entry.before ?? null) as unknown as Prisma.InputJsonValue,
            after: (entry.after ?? null) as unknown as Prisma.InputJsonValue
          }))
        });
      }
      };
      if (existingTx) await write(existingTx); else await this.prisma.$transaction(write);
    } catch (error) {
      // 并发落库冲突转 409：条件更新前的「先查后写」在并发下必然有窗口——两路恢复/编辑
      // 可能都查到无该版本号、算出同一个新版本号并进入 create，唯一键 (ws,year,version)
      // 会挡住第二条，但那是 P2002；写事务相互死锁则是 P2034。二者都应表现为「请刷新后重试」
      // 而不是 500。ConflictException（revision 不匹配那条）不带 code，会照原样抛出。
      const code = (error as { code?: string }).code;
      if (code === "P2002" || code === "P2034") {
        throw new ConflictException(
          `${calendar.year} 年度日历正被并发修改（版本 ${calendar.version} 已被占用），请刷新后重试`
        );
      }
      throw error;
    }
  }

  async loadCalendarOverrideAudits(
    tenantId: string,
    year: number,
    version?: string
  ): Promise<RentalCalendarOverrideAudit[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalCalendarOverrideAuditEntry.findMany({
      where: { workspaceId, year, ...(version ? { version } : {}) },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      date: row.date,
      action: row.action as RentalCalendarOverrideAudit["action"],
      reason: row.reason,
      operator: row.operator ?? undefined,
      at: iso(row.at),
      before: (row.before ?? undefined) as unknown as RentalCalendarOverrideAudit["before"],
      after: (row.after ?? undefined) as unknown as RentalCalendarOverrideAudit["after"],
      year: row.year,
      version: row.version,
      batchId: row.batchId ?? undefined
    }));
  }

  /** 某年度各版本的审计条数。版本列表只需要计数，不需要把明细拉出来。 */
  async countCalendarOverrideAudits(tenantId: string, year: number): Promise<Record<string, number>> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalCalendarOverrideAuditEntry.groupBy({
      by: ["version"],
      where: { workspaceId, year },
      _count: { _all: true }
    });
    return Object.fromEntries(rows.map((row) => [row.version, row._count._all]));
  }

  async loadCalendarsForYear(tenantId: string, year: number): Promise<RentalCalendarYear[]> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const rows = await this.prisma.rentalBusinessCalendar.findMany({ where: { workspaceId, year } });
    return rows.map((row) => this.toCalendar(row));
  }

  /**
   * 发布年度日历：新版本置 published 与旧版本置 superseded 必须原子完成。
   *
   * 两次独立 upsert 时，第二次失败会留下**两个 published 版本**——报价按版本号取
   * 最大的那个，于是旧口径被静默弃用却没有任何替代记录，历史报价也无法解释；
   * 反序写又会在中途失败时留下"该年度没有已发布日历"，报价静默回落到周模板。
   */
  async publishCalendarVersion(
    next: RentalCalendarYear,
    superseded?: RentalCalendarYear,
    expectedRevisions?: { next: number; superseded: number }
  ): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, next.tenantId);
    const nextData = this.calendarData(next);
    const supersededData = superseded ? this.calendarData(superseded) : undefined;
    await this.prisma.$transaction(async (tx) => {
      await lockActiveCategoryBinding(tx, next.tenantId, workspaceId);
      if (superseded && (superseded.tenantId !== next.tenantId || superseded.year !== next.year || superseded.version === next.version)) {
        throw new ConflictException("日历发布只能替代本租户同年度的其他版本");
      }
      // 条件更新，条件是「读到的 revision」：两人同时发布同一年度时，后者会更新到 0 行
      // 并在这里整体回滚，而不是两次都成功留下两个 published 版本。
      const conditional = async (
        target: RentalCalendarYear,
        data: ReturnType<RentalBusinessConfigRepository["calendarData"]>,
        expected: number | undefined
      ) => {
        if (expected === undefined) {
          await tx.rentalBusinessCalendar.upsert({
            where: { workspaceId_year_version: { workspaceId, year: target.year, version: target.version } },
            create: { workspaceId, tenantId: target.tenantId, year: target.year, ...data },
            update: data
          });
          return;
        }
        const updated = await tx.rentalBusinessCalendar.updateMany({
          where: { workspaceId, year: target.year, version: target.version, revision: expected },
          data
        });
        if (updated.count > 0) return;
        const existing = await tx.rentalBusinessCalendar.findUnique({
          where: { workspaceId_year_version: { workspaceId, year: target.year, version: target.version } },
          select: { revision: true }
        });
        if (existing) {
          throw new ConflictException(
            `${target.year} 年度日历已被其他人修改（当前版本 ${existing.revision}，你基于 ${expected}），请刷新后重试`
          );
        }
        await tx.rentalBusinessCalendar.create({
          data: { workspaceId, tenantId: target.tenantId, year: target.year, ...data }
        });
      };
      await conditional(next, nextData, expectedRevisions?.next);
      if (superseded && supersededData) {
        await conditional(superseded, supersededData, expectedRevisions?.superseded);
      }
    });
  }

  private ruleVersionData(version: RentalRuleVersion) {
    return {
      tenantId: version.tenantId,
      categoryCode: rentalCategoryStorageCode(version.categoryCode),
      version: version.version,
      status: version.status,
      config: version.config as unknown as Prisma.InputJsonValue,
      changeReason: version.changeReason,
      createdBy: version.createdBy,
      publishedAt: version.publishedAt ? new Date(version.publishedAt) : null,
      // RULE-01A：生效时点是匹配键，必须与状态一起落库，否则重启后版本无从匹配。
      effectiveFrom: version.effectiveFrom ? new Date(version.effectiveFrom) : null,
      publishedBy: version.publishedBy ?? null,
      supersededAt: version.supersededAt ? new Date(version.supersededAt) : null,
      previousVersion: version.previousVersion ?? null,
      restoredFromVersion: version.restoredFromVersion ?? null,
      restoreReason: version.restoreReason ?? null,
      voidedAt: version.voidedAt ? new Date(version.voidedAt) : null,
      voidedBy: version.voidedBy ?? null,
      voidReason: version.voidReason ?? null
    };
  }

  async upsertRuleVersion(version: RentalRuleVersion, expectedBinding?: CategoryWriteBinding, existingTx?: RentalConfigTx): Promise<void> {
    const data = this.ruleVersionData(version);
    const workspaceId = await resolveScopeWorkspaceId(existingTx ?? this.prisma, version.tenantId);
    try {
      const write = async (tx: RentalConfigTx) => {
      await lockActiveCategoryBinding(tx, version.tenantId, workspaceId, expectedBinding, version.categoryCode);
      const existing = await tx.rentalRuleVersion.findUnique({ where: { id: version.id }, select: { tenantId: true, workspaceId: true, status: true, config: true } });
      assertScopedWrite(existing, version.tenantId, workspaceId, "规则版本");
      if (existing && existing.status !== "draft" && (existing.status !== version.status || canonicalJson(existing.config) !== canonicalJson(version.config))) throw new ConflictException("已发布或历史规则不可覆盖，请恢复为新草稿");
      await tx.rentalRuleVersion.upsert({
        where: { id: version.id },
        create: { workspaceId, id: version.id, ...data, createdAt: new Date(version.createdAt) },
        update: data
      });
      };
      if (existingTx) await write(existingTx); else await this.prisma.$transaction(write);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("规则版本号已被其他操作占用，请刷新后重试");
      }
      throw error;
    }
  }

  async writeRuleVersionWithAudit(
    version: RentalRuleVersion,
    audit: RentalRuleVersionAudit,
    alsoWrite: RentalRuleVersion[] = [],
    expectedBinding?: CategoryWriteBinding
  ): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, version.tenantId);
    try {
      await this.prisma.$transaction(async (tx) => {
        // 同一空间的发布、恢复与作废必须串行。只在服务层检查缓存挡不住多进程并发。
        await lockActiveCategoryBinding(tx, version.tenantId, workspaceId, expectedBinding, version.categoryCode);
        if (audit.tenantId !== version.tenantId || audit.workspaceId !== workspaceId || audit.ruleVersionId !== version.id || audit.version !== version.version || audit.toStatus !== version.status) throw new ConflictException("规则审计与本次写入的空间或版本不一致");
        if (audit.action === "publish") {
          const persisted = await tx.rentalRuleVersion.findFirst({
            where: { id: version.id, tenantId: version.tenantId, workspaceId },
            select: { status: true, config: true }
          });
          if (!persisted || persisted.status !== "draft") {
            throw new ConflictException("规则草稿状态已变化，请刷新后重试");
          }
          if (canonicalJson(persisted.config) !== canonicalJson(version.config)) throw new ConflictException("规则草稿正文已变化，请刷新后重新预览并发布");
          const effectiveFrom = version.effectiveFrom ? new Date(version.effectiveFrom) : undefined;
          if (!effectiveFrom) throw new ConflictException("发布规则缺少生效时间");
          const issuedStatuses = ["pending", "published", "superseded"];
          const clash = await tx.rentalRuleVersion.findFirst({
            where: { workspaceId, id: { not: version.id }, status: { in: issuedStatuses }, effectiveFrom },
            select: { version: true }
          });
          if (clash) throw new ConflictException(`规则版本 ${clash.version} 已占用该生效时点`);
          const latest = await tx.rentalRuleVersion.findFirst({
            where: { workspaceId, id: { not: version.id }, status: { in: issuedStatuses }, effectiveFrom: { not: null } },
            orderBy: { effectiveFrom: "desc" },
            select: { version: true, effectiveFrom: true }
          });
          if (latest?.effectiveFrom && latest.effectiveFrom.getTime() > effectiveFrom.getTime()) {
            throw new ConflictException(`生效时点必须晚于已发布的最新规则版本 ${latest.version}`);
          }
        }
        for (const row of [version, ...alsoWrite]) {
          if (row.tenantId !== version.tenantId) throw new ConflictException("规则版本不能跨租户写入");
          const existing = await tx.rentalRuleVersion.findUnique({ where: { id: row.id }, select: { tenantId: true, workspaceId: true, status: true, config: true } });
          assertScopedWrite(existing, version.tenantId, workspaceId, "规则版本");
          if (existing && existing.status !== "draft" && canonicalJson(existing.config) !== canonicalJson(row.config)) throw new ConflictException("历史规则正文不可覆盖");
          if (row.id === version.id && audit.action === "restore" && existing) throw new ConflictException("规则恢复必须建立新草稿，不能覆盖已有版本");
          if (row.id === version.id && audit.action === "void" && (!existing || !["pending", "published"].includes(existing.status))) throw new ConflictException("规则状态已变化，当前版本不可作废");
          const data = this.ruleVersionData(row);
          await tx.rentalRuleVersion.upsert({
            where: { id: row.id },
            create: { workspaceId, id: row.id, ...data, createdAt: new Date(row.createdAt) },
            update: data
          });
        }
        await tx.rentalRuleVersionAudit.create({
          data: {
            id: audit.id,
            tenantId: audit.tenantId,
            workspaceId: audit.workspaceId,
            ruleVersionId: audit.ruleVersionId,
            version: audit.version,
            action: audit.action,
            fromStatus: audit.fromStatus ?? null,
            toStatus: audit.toStatus,
            reason: audit.reason,
            operator: audit.operator ?? null,
            at: new Date(audit.at)
          }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("规则版本已被其他操作推进，请刷新后重试");
      }
      throw error;
    }
  }

  async loadRuleVersionAudits(
    tenantId: string,
    workspaceId: string,
    ruleVersionId?: string
  ): Promise<RentalRuleVersionAudit[]> {
    const rows = await this.prisma.rentalRuleVersionAudit.findMany({
      where: { tenantId, workspaceId, ...(ruleVersionId ? { ruleVersionId } : {}) },
      orderBy: { at: "desc" }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      ruleVersionId: row.ruleVersionId,
      version: row.version,
      action: row.action as RentalRuleVersionAudit["action"],
      fromStatus: (row.fromStatus ?? undefined) as RentalRuleVersionAudit["fromStatus"],
      toStatus: row.toStatus as RentalRuleVersionAudit["toStatus"],
      reason: row.reason,
      operator: row.operator ?? undefined,
      at: iso(row.at)
    }));
  }

  private notificationTemplateData(template: RentalNotificationTemplateV1) {
    return {
      tenantId: template.tenantId,
      eventCode: template.eventCode,
      channel: template.channel,
      name: template.name,
      title: template.title,
      body: template.body,
      providerTemplateCode: template.providerTemplateCode ?? null,
      variableSchema: template.variableSchema as unknown as Prisma.InputJsonValue,
      status: template.status,
      version: template.version
    };
  }

  async upsertNotificationTemplate(template: RentalNotificationTemplateV1, existingTx?: RentalConfigTx): Promise<void> {
    const data = this.notificationTemplateData(template);
    const write = async (tx: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(tx, template.tenantId);
      // MySQL 的 Prisma upsert 可能拆成读取和创建；并发首次补落默认配置
      // 不能同时观察到“模板不存在”。与品类采用共用空间锁，并在锁后检查范围。
      await lockActiveCategoryBinding(tx, template.tenantId, workspaceId);
      const existing = await tx.rentalNotificationTemplate.findUnique({ where: { id: template.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, template.tenantId, workspaceId, "通知模板");
      await tx.rentalNotificationTemplate.upsert({
        where: { id: template.id },
        create: { workspaceId, id: template.id, ...data },
        update: data
      });
    };
    if (existingTx) await write(existingTx);
    else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async replaceNotificationTemplateVersion(
    previous: RentalNotificationTemplateV1,
    next: RentalNotificationTemplateV1
  ): Promise<void> {
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, next.tenantId);
    try {
      await this.prisma.$transaction(async (tx) => {
        // 锁旧版本，避免两个编辑请求都基于同一版创建相同的新版本号。
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM rental_notification_templates
           WHERE id = ${previous.id} AND tenantId = ${previous.tenantId} AND workspaceId = ${workspaceId}
           FOR UPDATE
        `);
        const current = await tx.rentalNotificationTemplate.findFirst({
          where: { id: previous.id, tenantId: previous.tenantId, workspaceId }
        });
        if (!current) throw new ConflictException("通知模板版本已变化，请刷新后重试");
        await tx.rentalNotificationTemplate.update({
          where: { id: previous.id },
          data: { status: "disabled" }
        });
        await tx.rentalNotificationTemplate.create({
          data: { workspaceId, id: next.id, ...this.notificationTemplateData(next) }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("通知模板版本已被其他操作推进，请刷新后重试");
      }
      throw error;
    }
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toPricingPlan(row: Prisma.RentalPricingPlanGetPayload<object>): RentalPricingPlanV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      // 币种按登记表校验后再收：库里可能有历史脏值，强转会让一个不认识的币种
      // 一路流到界面上被当成人民币显示。认不出就落回 CNY，与旧行为一致。
      currency: RENTAL_CURRENCY_CODES.includes(row.currency as RentalCurrency)
        ? (row.currency as RentalCurrency)
        : "CNY",
      status: row.status as RentalPricingPlanV1["status"],
      version: row.version,
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: optionalIso(row.effectiveTo),
      rates: (row.rates ?? []) as unknown as RentalPricingRate[],
      fulfillmentFees: (row.fulfillmentFees ?? undefined) as unknown as RentalPricingPlanV1["fulfillmentFees"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toDiscountPlan(row: Prisma.RentalDiscountPlanGetPayload<object>): RentalDiscountPlan {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      status: row.status as RentalDiscountPlan["status"],
      discountType: row.discountType as RentalDiscountPlan["discountType"],
      discountValue: num(row.discountValue),
      minimumSpend: num(row.minimumSpend),
      thresholdAmount: optionalNum(row.thresholdAmount),
      maximumDiscount: optionalNum(row.maximumDiscount),
      appliesTo: row.appliesTo as RentalDiscountPlan["appliesTo"],
      exclusiveGroup: row.exclusiveGroup ?? undefined,
      stackableWithOtherPlans: row.stackableWithOtherPlans,
      customerScope: row.customerScope as RentalDiscountPlan["customerScope"],
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      applicablePricingGroupIds: (row.applicablePricingGroupIds ?? []) as string[],
      applicableDayTypes: (row.applicableDayTypes ?? []) as RentalDayType[],
      priority: row.priority,
      stackableWithCoupon: row.stackableWithCoupon,
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: optionalIso(row.effectiveTo),
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toService(row: Prisma.RentalValueAddedServiceGetPayload<object>): RentalValueAddedService {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      serviceType: row.serviceType as RentalValueAddedService["serviceType"],
      billingUnit: row.billingUnit as RentalValueAddedService["billingUnit"],
      price: num(row.price),
      minimumQuantity: row.minimumQuantity,
      maximumQuantity: row.maximumQuantity,
      coverageLimit: optionalNum(row.coverageLimit),
      deductible: optionalNum(row.deductible),
      termsVersion: row.termsVersion,
      terms: row.terms,
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      applicableFulfillmentModes: (row.applicableFulfillmentModes ?? []) as RentalValueAddedService["applicableFulfillmentModes"],
      applicableLocationIds: (row.applicableLocationIds ?? []) as string[],
      customerScope: row.customerScope as RentalValueAddedService["customerScope"],
      selectionMode: row.selectionMode as RentalValueAddedService["selectionMode"],
      mandatoryRule: (row.mandatoryRule ?? undefined) as RentalValueAddedService["mandatoryRule"],
      insuranceProviderStatus: (row.insuranceProviderStatus ?? undefined) as RentalValueAddedService["insuranceProviderStatus"],
      insuranceProviderName: row.insuranceProviderName ?? undefined,
      requiresCapacity: row.requiresCapacity,
      status: row.status as RentalValueAddedService["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toCalendar(row: Prisma.RentalBusinessCalendarGetPayload<object>): RentalCalendarYear {
    return {
      tenantId: row.tenantId,
      year: row.year,
      region: row.region as RentalCalendarYear["region"],
      version: row.version,
      status: row.status as RentalCalendarYear["status"],
      sourceName: row.sourceName ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      sourcePublishedAt: optionalIso(row.sourcePublishedAt),
      sourceVersionId: row.sourceVersionId ?? undefined,
      sourceVersion: row.sourceVersion ?? undefined,
      importedAt: optionalIso(row.importedAt),
      publishedAt: optionalIso(row.publishedAt),
      supersededAt: optionalIso(row.supersededAt),
      publishedBy: row.publishedBy ?? undefined,
      changeReason: row.changeReason ?? undefined,
      previousVersion: row.previousVersion ?? undefined,
      restoredFromVersion: row.restoredFromVersion ?? undefined,
      restoreReason: row.restoreReason ?? undefined,
      voidedAt: optionalIso(row.voidedAt),
      voidedBy: row.voidedBy ?? undefined,
      voidReason: row.voidReason ?? undefined,
      publishDiff: (row.publishDiff ?? undefined) as unknown as RentalCalendarYear["publishDiff"],
      // 审计不再随年度日历加载：它在独立表里且不设上限，整体带进内存没有意义。
      // 需要时由 loadCalendarOverrideAudits 按年度/版本查询（版本详情与审计页各自按需取）。
      importPreservedOverrides: (row.importPreservedOverrides ?? undefined) as unknown as string[] | undefined,
      days: (row.days ?? []) as unknown as RentalCalendarDay[],
      revision: row.revision
    };
  }

  async loadRuleVersionById(tenantId: string, workspaceId: string, id: string): Promise<RentalRuleVersion | null> {
    const check = () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId) throw new ForbiddenException('原规则读取范围变化');
    };
    check();
    const row = await this.prisma.rentalRuleVersion.findFirst({ where: { tenantId, workspaceId, id } });
    check();
    return row ? this.toRuleVersion(row) : null;
  }

  private toRuleVersion(row: Prisma.RentalRuleVersionGetPayload<object>): RentalRuleVersion {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      version: row.version,
      status: row.status as RentalRuleVersion["status"],
      config: row.config as unknown as RentalRuleConfig,
      changeReason: row.changeReason,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      publishedAt: optionalIso(row.publishedAt),
      effectiveFrom: optionalIso(row.effectiveFrom),
      publishedBy: row.publishedBy ?? undefined,
      supersededAt: optionalIso(row.supersededAt),
      previousVersion: row.previousVersion ?? undefined,
      restoredFromVersion: row.restoredFromVersion ?? undefined,
      restoreReason: row.restoreReason ?? undefined,
      voidedAt: optionalIso(row.voidedAt),
      voidedBy: row.voidedBy ?? undefined,
      voidReason: row.voidReason ?? undefined
    };
  }

  private toNotificationTemplate(row: Prisma.RentalNotificationTemplateGetPayload<object>): RentalNotificationTemplateV1 {
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventCode: row.eventCode,
      channel: row.channel as RentalNotificationTemplateV1["channel"],
      name: row.name,
      title: row.title,
      body: row.body,
      providerTemplateCode: row.providerTemplateCode ?? undefined,
      variableSchema: (row.variableSchema ?? {}) as RentalNotificationTemplateV1["variableSchema"],
      status: row.status as RentalNotificationTemplateV1["status"],
      version: row.version,
      updatedAt: iso(row.updatedAt)
    };
  }
}
