import { readRentalCategoryCode, rentalCategoryStorageCode, rentalDefaultWorkspaceName } from "./category-identity";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from 'zod';
import { assertCategoryAdoptionAllowed } from "./category-governance-policy";
import { lockActiveCategoryBinding, validateActiveCategoryWrite, type CategoryWriteBinding } from "./category-active-write";
import { Prisma, type $Enums, type RentalCouponTemplate as CouponTemplateRow } from "@prisma/client";
import type {
  RentalBundleComponent,
  RentalCategoryCode,
  RentalCurrency,
  RentalCouponTemplate,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalInspectionTemplate,
  RentalItemGroup,
  RentalPricingGroup,
  RentalLocationType,
  TenantRentalBusinessSettings,
  TenantRentalProfile
} from "@rental-os/shared";
import type { RentalCategoryDefinition } from "@rental-os/shared";
import { RentalInventoryMode, isRentalCategoryCode, RENTAL_CATEGORY_WORKSPACE_NAMES, RENTAL_CURRENCY_CODES, RENTAL_CAPABILITY_CODES, RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES, RENTAL_PAYMENT_METHOD_CODES } from "@rental-os/shared";
import type { BusinessContext } from './rental-business.service';
import { PrismaService } from "../database/prisma.service";
import { getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere } from "../../common/request-identity";
import { assertScopedWrite, resolveScopeWorkspaceId } from "./workspace-scope";
import type { RentalUniqueAttributeClaim } from "./rental-core-fact.repository";
import type { VersionedBusinessSettings } from './approved-settings-change.ports';
import { readRentalFulfillmentAdmission, type RentalFulfillmentRequirement } from './rental-fulfillment-admission';
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import { readRentalConfigurationRevision, RENTAL_CONFIGURATION_REVISION_MAX, writeRentalCoreConfigurationSnapshot } from "./rental-state.repository";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";
const PROFILE_TERMINOLOGY_MAX_LENGTH = 100;

/**
 * 单个**经营空间**的全部配置，用于启动预热写穿缓存。
 *
 * SPACE-03：以空间为单位而不是租户——同租户两个空间各有独立配置。
 * 品类取自 `business_workspaces.categoryCode`：需求 3 规定品类由空间决定，
 * `tenant_rental_profiles` 只是升级兼容层的租户级档案。
 */
export interface TenantConfigSnapshot {
  tenantId: string;
  workspaceId: string;
  workspaceCategoryCode: RentalCategoryCode;
  profile?: TenantRentalProfile;
  businessSettings?: TenantRentalBusinessSettings;
  operators: RentalFulfillmentOperator[];
  locations: RentalFulfillmentLocation[];
  itemGroups: RentalItemGroup[];
  pricingGroups?: RentalPricingGroup[];
  couponTemplates: RentalCouponTemplate[];
  inspectionTemplates: RentalInspectionTemplate[];
  /**
   * 该租户的配置是否真的写过库（存在品类档案之外的任一配置行）。
   *
   * 需要这个标记是因为租户集合里包含只有 `tenant_rental_profiles` 行的租户——
   * seed 会建品类档案但不建商品组和地点。缺少它就无法区分两种情况：
   * 「库里合法为空」应当覆盖缓存，而「库还没写过」必须保留 seedState 的内存配置，
   * 否则冷启动会把演示商品组直接抹掉。
   */
  hasPersistedConfig: boolean;
}
export interface WorkspaceCategoryConfigSnapshot extends TenantConfigSnapshot {
  binding: CategoryWriteBinding;
  definition: RentalCategoryDefinition;
  isDefault: boolean;
}

/**
 * 事务客户端。租户初始化必须把品类配置写在 `bootstrapTenant` 的同一事务内（需求 4.1），
 * 因此每个写方法都允许调用方传入外层事务；不传时各自独立提交。
 */
export type RentalConfigTx = Prisma.TransactionClient;
export interface RentalDefaultWorkspaceInitialization { categoryVersionId?: string; actorId?: string }
/** Bounded configuration read, not pricing or inventory reservation. */
export interface RentalItemGroupPageQuery { limit: number; cursor?: string; itemGroupId?: string; name?: string; }
export type RentalItemGroupReadFacts = Pick<RentalItemGroup, 'id' | 'tenantId' | 'categoryCode' | 'code' | 'name'
  | 'inventoryMode' | 'unit' | 'status' | 'bundleComponents' | 'createdAt' | 'updatedAt'>;
export interface RentalItemGroupPage {
  rows: RentalItemGroupReadFacts[]; nextCursor: string | null; truncated: boolean;
  configurationVersion: string; source: 'persisted_workspace_configuration';
}
export function parseRentalItemGroupPageQuery(value: RentalItemGroupPageQuery): RentalItemGroupPageQuery {
  const input = structuredClone(value), id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['limit', 'cursor', 'itemGroupId', 'name'].includes(key))
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100
    || (input.cursor !== undefined && (typeof input.cursor !== 'string' || !id.test(input.cursor)))
    || (input.itemGroupId !== undefined && (typeof input.itemGroupId !== 'string' || !id.test(input.itemGroupId)))
    || (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 191)))
    throw new BadRequestException('商品分页查询参数无效');
  if (input.name !== undefined) input.name = input.name.trim();
  return input;
}

/**
 * 服务层只依赖这个接口，不依赖 Prisma。
 *
 * 这样做的目的不是"方便 mock"：不连库的单元测试注入一个**吸收式 stub**
 * （读返回空、写丢弃），让配置读取继续由内存写穿缓存提供，从而保住那批
 * 只验证品类 schema 形状与领域算法的断言。真正依赖持久化语义的断言
 * （租户隔离、外键、唯一约束、过期预占过滤）只在 MySQL E2E 里才有意义，
 * 不得靠在 stub 上重写一遍查询逻辑来"覆盖"。
 */
export interface RentalReadinessCoreFacts {
  tenantId: string;
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  timeZone: string;
  enabledItemGroupCount: number;
  serviceableLocationCount: number;
  pricingGroups: Array<Pick<RentalPricingGroup, 'id' | 'name'>>;
}
export const RENTAL_READINESS_FACT_LIMIT = 10000;
export const RENTAL_OPENING_CONFIGURATION_LIMIT = 100;
export const RENTAL_OPENING_TERMINOLOGY_FIELDS = ['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel'] as const;
export type RentalOpeningTerminology = Pick<TenantRentalProfile['terminology'], typeof RENTAL_OPENING_TERMINOLOGY_FIELDS[number]>;
/** Internal opening projection, not a quote context or a new public DTO. */
export interface RentalOpeningConfigurationFacts {
  tenantId: string; workspaceId: string; categoryCode: RentalCategoryCode;
  profile: { configVersion: string; terminology: Partial<RentalOpeningTerminology> } | null;
  settings: { configVersion: string; pricing: Pick<TenantRentalBusinessSettings['pricing'], 'currency' | 'enabledUnits' | 'defaultUnit'>;
    fulfillment: Pick<TenantRentalBusinessSettings['fulfillment'], 'enabledModes'> };
  groups: Array<Pick<RentalItemGroup, 'id' | 'code' | 'status' | 'inventoryMode' | 'unit'>>;
  pricingGroups: Array<Pick<RentalPricingGroup, 'id' | 'code' | 'status' | 'version'>>;
  locations: Array<Pick<RentalFulfillmentLocation, 'id' | 'code' | 'status' | 'capabilities'>>;
  truncated: { groups: boolean; pricingGroups: boolean; locations: boolean };
  enabledItemGroupCount: number; enabledLocationCount: number;
}

/** Report metadata only: no quote, prices, credentials or configuration cache. */
export interface RentalReportConfigurationFacts {
  tenantId: string; workspaceId: string; categoryCode: RentalCategoryCode; currency: RentalCurrency;
}

export const RENTAL_QUOTE_CONFIGURATION_LIMIT = 100;
export const RENTAL_QUOTE_CONFIGURATION_MEMBER_LIMIT = 256;
/** Internal current configuration projection, never a historical quote DTO. */
export type RentalQuoteConfigurationFacts = Omit<BusinessContext, 'category'> & {
  tenantId: string; workspaceId: string; categoryCode: RentalCategoryCode;
};

export interface RentalConfigStore {
  loadAll(): Promise<TenantConfigSnapshot[]>;
  loadWorkspaceSnapshot?(tenantId: string, workspaceId: string): Promise<WorkspaceCategoryConfigSnapshot>;
  readQuoteConfigurationFacts?(tenantId: string, workspaceId: string): Promise<RentalQuoteConfigurationFacts>;
  readReportConfigurationFacts?(tenantId: string, workspaceId: string): Promise<RentalReportConfigurationFacts>;
  /** Opening-only projection. No cache initialization, bundle/member joins or credentials. */
  readReadinessCoreFacts?(tenantId: string, workspaceId: string, tx?: RentalConfigTx): Promise<RentalReadinessCoreFacts>;
  /** Bounded page/minimal settings/profile fields; no bundles, members or credentials. */
  readOpeningConfigurationFacts?(tenantId: string, workspaceId: string): Promise<RentalOpeningConfigurationFacts>;
  listItemGroupsPage?(tenantId: string, workspaceId: string, query: RentalItemGroupPageQuery, tx?: RentalConfigTx): Promise<RentalItemGroupPage>;
  listInspectionTemplates?(tenantId: string, workspaceId: string, tx?: RentalConfigTx): Promise<RentalInspectionTemplate[]>;
  loadWorkspace?(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantConfigSnapshot>;
  listCouponTemplates?(tenantId: string, workspaceId: string): Promise<RentalCouponTemplate[]>;
  /** Missing authority is unavailable, never permission to use a cached enabled flag. */
  readFulfillmentAdmission?(tenantId: string, workspaceId: string, requirements: readonly RentalFulfillmentRequirement[], tx?: RentalConfigTx): Promise<{
    locations: RentalFulfillmentLocation[]; operators: RentalFulfillmentOperator[];
  }>;
  /** 全部启用的经营空间，用于服务层按空间建状态并解析「租户 → 默认空间」。 */
  listWorkspaces(): Promise<Array<{ id: string; tenantId: string; categoryCode: RentalCategoryCode; isDefault: boolean }>>;
  upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx, initialization?: RentalDefaultWorkspaceInitialization, expectedBinding?: CategoryWriteBinding): Promise<void>;
  readVersionedBusinessSettings(tenantId: string, tx?: RentalConfigTx): Promise<VersionedBusinessSettings | null>;
  upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, expectedSettingsRevision?: number): Promise<number>;
  /** preserveStatus carries an omitted edit field into the writer's lock; the
   * returned status updates the local cache without reviving a stale flag. */
  upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx, preserveStatus?: boolean): Promise<RentalFulfillmentOperator['status'] | void>;
  upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, preserveStatus?: boolean): Promise<RentalFulfillmentLocation['status'] | void>;
  upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx, uniqueAttributes?: RentalUniqueAttributeClaim[], expectedBinding?: CategoryWriteBinding, allowMediaWrite?: boolean): Promise<void>;
  upsertPricingGroup?(group: RentalPricingGroup, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void>;
  upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void>;
  /** 在领券事务内锁定模板行，串行化不同幂等键对同一配额的竞争。 */
  lockCouponTemplateForClaim(tenantId: string, templateId: string, tx: RentalConfigTx): Promise<RentalCouponTemplate | undefined>;
  upsertInspectionTemplate(template: RentalInspectionTemplate, tx?: RentalConfigTx): Promise<void>;
}

function iso(value: Date): string {
  return value.toISOString();
}

function num(value: Prisma.Decimal): number {
  return Number(value);
}

// Prisma exposes enum member names; raw SQL returns schema @map values.
// Normalize at the repository edge before comparing either representation.
function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function upper<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

/** Current profile only. Default workspaces keep the original tenant compatibility
 * row. Other workspaces use the profile persisted by CoreController.committed →
 * Core.persist → RentalStateRepository.saveCoreState, bound to their adopted
 * version. Never load the aggregate snapshot or derive a profile from seed,
 * recommended/current definitions, another workspace or an uncommitted cache.
 * The caller supplies the fixed w/p aliases; all JSON paths are code-owned. */
function workspaceProfileReadSql() {
  const choose = (legacy: Prisma.Sql, saved: Prisma.Sql) => Prisma.sql`CASE WHEN w.isDefault = TRUE THEN ${legacy} ELSE ${saved} END`;
  const saved = (field: string) => Prisma.sql`JSON_EXTRACT(cs.state, ${`$.profile.${field}`})`;
  const timestamp = (field: string) => Prisma.sql`STR_TO_DATE(LEFT(JSON_UNQUOTE(${saved(field)}), 40), '%Y-%m-%dT%H:%i:%s.%fZ')`;
  return {
    joins: Prisma.sql`LEFT JOIN rental_category_versions AS cv ON cv.id = w.categoryVersionId
        AND cv.categoryCode = w.categoryCode AND cv.status IN ('published', 'legacy_baseline')
      LEFT JOIN rental_core_state_snapshots AS cs ON w.isDefault = FALSE
        AND cs.tenantId = w.tenantId AND cs.workspaceId = w.id
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.configPersisted')) = 'BOOLEAN'
        AND JSON_UNQUOTE(JSON_EXTRACT(cs.state, '$.configPersisted')) = 'true'
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile')) = 'OBJECT'
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.tenantId')) = 'STRING'
        AND JSON_UNQUOTE(JSON_EXTRACT(cs.state, '$.profile.tenantId')) = w.tenantId
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.categoryCode')) = 'STRING'
        AND LOWER(JSON_UNQUOTE(JSON_EXTRACT(cs.state, '$.profile.categoryCode'))) = LOWER(w.categoryCode)
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.configVersion')) = 'STRING'
        AND JSON_TYPE(JSON_EXTRACT(cv.definition, '$.version')) = 'STRING'
        AND JSON_UNQUOTE(JSON_EXTRACT(cs.state, '$.profile.configVersion')) = JSON_UNQUOTE(JSON_EXTRACT(cv.definition, '$.version'))
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.capabilities')) = 'ARRAY'
        AND JSON_TYPE(JSON_EXTRACT(cv.definition, '$.defaultCapabilities')) = 'ARRAY'
        AND JSON_CONTAINS(JSON_EXTRACT(cv.definition, '$.defaultCapabilities'), JSON_EXTRACT(cs.state, '$.profile.capabilities'))
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.initializedAt')) = 'STRING'
        AND JSON_TYPE(JSON_EXTRACT(cs.state, '$.profile.updatedAt')) = 'STRING'`,
    version: choose(Prisma.sql`p.configVersion`, Prisma.sql`LEFT(JSON_UNQUOTE(${saved('configVersion')}), 192)`),
    category: choose(Prisma.sql`p.categoryCode`, Prisma.sql`LEFT(JSON_UNQUOTE(${saved('categoryCode')}), 65)`),
    capabilities: choose(Prisma.sql`p.capabilities`, saved('capabilities')),
    terminology: choose(Prisma.sql`p.terminology`, saved('terminology')),
    initializedAt: choose(Prisma.sql`p.initializedAt`, timestamp('initializedAt')),
    updatedAt: choose(Prisma.sql`p.updatedAt`, timestamp('updatedAt')),
    available: Prisma.sql`((w.isDefault = TRUE AND p.tenantId IS NOT NULL) OR (w.isDefault = FALSE AND cs.workspaceId IS NOT NULL))`,
  };
}

/** RC-01 阶段 2：Rental Core 配置的库侧实现。库是事实源，服务层内存副本是写穿缓存。 */
@Injectable()
export class RentalCoreConfigRepository implements RentalConfigStore {
  constructor(private readonly prisma: PrismaService,
    @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) private readonly failureEvents?: BusinessFailureOutboxParticipant) {}

  private async captureOpening(tx: RentalConfigTx, tenantId: string, workspaceId: string,
    kind: 'tenant_profile' | 'core_snapshot' | 'business_settings') {
    if (!this.failureEvents?.openingConfiguration) return;
    await this.failureEvents.openingConfiguration(tx, { tenantId, workspaceId },
      { kind, id: kind === 'tenant_profile' ? tenantId : workspaceId });
  }

  /** One committed definition/configuration combination under adoption's space
   * mutex. Empty collections are facts; this reader never initializes samples. */
  async loadWorkspaceSnapshot(tenantId: string, workspaceId: string): Promise<WorkspaceCategoryConfigSnapshot> {
    return this.prisma.$transaction(async tx => {
      const { definition, binding } = await lockActiveCategoryBinding(tx, tenantId, workspaceId);
      const where = { tenantId, workspaceId };
      const [workspace, profile, settings, operators, locations, groups, pricing, coupons, inspections] = await Promise.all([
        tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { defaultMarker: true } }),
        tx.tenantRentalProfile.findUnique({ where: { tenantId } }),
        tx.rentalTenantBusinessSettings.findFirst({ where }),
        tx.rentalFulfillmentOperator.findMany({ where, orderBy: { createdAt: "desc" } }),
        tx.rentalFulfillmentLocation.findMany({ where, orderBy: { createdAt: "desc" } }),
        tx.rentalItemGroup.findMany({ where, orderBy: { createdAt: "desc" }, include: { bundleComponents: true } }),
        tx.rentalPricingGroup.findMany({ where, orderBy: { createdAt: "desc" }, include: { members: { orderBy: { sortOrder: "asc" } } } }),
        tx.rentalCouponTemplate.findMany({ where, orderBy: { createdAt: "desc" } }),
        tx.rentalInspectionTemplate.findMany({ where, orderBy: { createdAt: "desc" } })
      ]);
      const byId = new Map(groups.map(group => [group.id, group]));
      if (groups.some(group => group.bundleComponents.some(component => !byId.has(component.componentItemGroupId))) || pricing.some(group => group.members.some(member => !byId.has(member.itemGroupId)))) {
        throw new ConflictException("空间配置包含空间外的组成或定价成员，不能读取其他空间资料补齐");
      }
      return { tenantId, workspaceId, workspaceCategoryCode: definition.code, definition, binding, isDefault: workspace?.defaultMarker === "default",
        profile: this.toProfile(profile ?? undefined), businessSettings: this.toBusinessSettings(settings ?? undefined),
        operators: operators.map(row => this.toOperator(row)), locations: locations.map(row => this.toLocation(row)),
        itemGroups: groups.map(row => this.toItemGroup({ ...row, bundleComponents: row.bundleComponents.map(component => ({ ...component,
          componentItemGroup: { code: byId.get(component.componentItemGroupId)!.code, name: byId.get(component.componentItemGroupId)!.name } })) })),
        pricingGroups: pricing.map(row => this.toPricingGroup({ ...row, members: row.members.map(member => ({ ...member, itemGroup: byId.get(member.itemGroupId)! })) })),
        couponTemplates: coupons.map(row => this.toCouponTemplate(row)), inspectionTemplates: inspections.map(row => this.toInspectionTemplate(row)),
        hasPersistedConfig: Boolean(settings || operators.length || locations.length || groups.length || pricing.length || coupons.length || inspections.length) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Dedicated R0 preparation source. Collections stay normalized; only the
   * current workspace profile uses bounded paths in its original persisted
   * snapshot. loadAll/aggregate recovery are untouched. Each complete collection
   * has a sentinel; no partial context or seeded profile is returned. */
  async readQuoteConfigurationFacts(tenantId: string, workspaceId: string): Promise<RentalQuoteConfigurationFacts> {
    const locationWhere = staffLocationWhere('id'), locationBinding = JSON.stringify(locationWhere);
    const assertScope = async () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || JSON.stringify(staffLocationWhere('id')) !== locationBinding
        || await resolveScopeWorkspaceId(this.prisma, tenantId) !== workspaceId)
        throw new ForbiddenException('报价配置读取范围变化');
    };
    await assertScope();
    const where = { tenantId, workspaceId }, limit = RENTAL_QUOTE_CONFIGURATION_LIMIT, memberLimit = RENTAL_QUOTE_CONFIGURATION_MEMBER_LIMIT;
    // Bounds apply before JSON crosses the transport. Read only the persisted
    // profile paths, never a state/history blob or missing normalized facts.
    const profileSql = workspaceProfileReadSql();
    const boundedJson = (value: Prisma.Sql, bytes = 16384) => Prisma.sql`CASE
      WHEN OCTET_LENGTH(CAST(${value} AS CHAR)) <= ${bytes} THEN ${value}
      ELSE JSON_OBJECT('readLimitExceeded', TRUE) END`;
    const ids = getRequestStaffLocationIds();
    const locationsScope = ids === undefined ? Prisma.empty : ids.length ? Prisma.sql`AND l.id IN (${Prisma.join(ids)})` : Prisma.sql`AND 1 = 0`;
    type Meta = { tenantId: string; workspaceId: string; categoryCode: string; settingsCategoryCode: string; configVersion: string;
      settings: unknown; profileVersion: string; profileCategoryCode: string; capabilities: unknown; terminology: unknown; initializedAt: Date; profileUpdatedAt: Date };
    type Location = { id: string; tenantId: string; workspaceId: string; code: string; name: string; type: string;
      organizationId: string | null; operatorId: string | null; operatorType: string | null; operatorName: string | null;
      parentLocationId: string | null; timezone: string | null; capabilities: unknown; status: string };
    const [metadata, groups, pricing, locations, coupons] = await Promise.all([
      this.prisma.$queryRaw<Meta[]>(Prisma.sql`
        SELECT w.tenantId, w.id AS workspaceId, w.categoryCode, s.categoryCode AS settingsCategoryCode, s.configVersion,
          ${boundedJson(Prisma.sql`JSON_OBJECT('tenantId', JSON_EXTRACT(s.settings, '$.tenantId'), 'categoryCode', JSON_EXTRACT(s.settings, '$.categoryCode'),
            'configVersion', JSON_EXTRACT(s.settings, '$.configVersion'), 'pricing', JSON_EXTRACT(s.settings, '$.pricing'),
            'fulfillment', JSON_EXTRACT(s.settings, '$.fulfillment'), 'payment', JSON_EXTRACT(s.settings, '$.payment'),
            'calendar', JSON_EXTRACT(s.settings, '$.calendar'), 'membership', JSON_EXTRACT(s.settings, '$.membership'),
            'notifications', JSON_EXTRACT(s.settings, '$.notifications'), 'updatedAt', JSON_EXTRACT(s.settings, '$.updatedAt'),
            'updatedBy', JSON_EXTRACT(s.settings, '$.updatedBy'))`, 65536)} AS settings,
          ${profileSql.version} AS profileVersion, ${profileSql.category} AS profileCategoryCode,
          ${boundedJson(profileSql.capabilities, 4096)} AS capabilities, ${boundedJson(profileSql.terminology)} AS terminology,
          ${profileSql.initializedAt} AS initializedAt, ${profileSql.updatedAt} AS profileUpdatedAt
        FROM business_workspaces AS w
        JOIN rental_tenant_business_settings AS s ON s.tenantId = w.tenantId AND s.workspaceId = w.id
        LEFT JOIN tenant_rental_profiles AS p ON p.tenantId = w.tenantId AND w.isDefault = TRUE
        ${profileSql.joins}
        WHERE w.tenantId = ${tenantId} AND w.id = ${workspaceId} AND ${profileSql.available} LIMIT 1`),
      this.prisma.rentalItemGroup.findMany({ where, orderBy: { id: 'asc' }, take: limit + 1,
        select: { tenantId: true, workspaceId: true, id: true, categoryCode: true, code: true, name: true, inventoryMode: true,
          unit: true, status: true, createdAt: true, updatedAt: true, bundleComponents: { take: memberLimit + 1, orderBy: { id: 'asc' },
            select: { componentItemGroupId: true, quantity: true, optional: true, substitutionGroup: true,
              componentItemGroup: { select: { id: true, tenantId: true, workspaceId: true, code: true, name: true } } } } } }),
      this.prisma.rentalPricingGroup.findMany({ where, orderBy: { id: 'asc' }, take: limit + 1,
        select: { tenantId: true, workspaceId: true, id: true, categoryCode: true, code: true, name: true, defaultPricingUnit: true,
          status: true, version: true, createdAt: true, updatedAt: true, members: { take: memberLimit + 1, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { itemGroupId: true, itemGroup: { select: { tenantId: true, workspaceId: true, id: true,
              code: true, name: true, inventoryMode: true, unit: true, status: true } } } } } }),
      this.prisma.$queryRaw<Location[]>(Prisma.sql`
        SELECT l.id, l.tenantId, l.workspaceId, l.code, l.name, l.type, l.organizationId, l.operatorId, l.operatorType, l.operatorName,
          l.parentLocationId, l.timezone, ${boundedJson(Prisma.sql`l.capabilities`, 4096)} AS capabilities, l.status
        FROM rental_fulfillment_locations AS l
        WHERE l.tenantId = ${tenantId} AND l.workspaceId = ${workspaceId} ${locationsScope} ORDER BY l.id LIMIT ${limit + 1}`),
      this.prisma.$queryRaw<Array<Prisma.RentalCouponTemplateGetPayload<object>>>(Prisma.sql`
        SELECT c.id, c.tenantId, c.workspaceId, c.code, c.name, c.discountType, c.discountValue, c.minimumSpend, c.maximumDiscount,
          c.appliesTo, c.stackableWithDiscountPlans, c.totalQuota, c.claimedQuantity, c.perCustomerLimit, c.perCustomerUseLimit,
          c.totalBudget, c.lockedBudget, c.redeemedBudget, c.claimFrom, c.claimTo, c.effectiveFrom, c.effectiveTo,
          c.applicableRentalFrom, c.applicableRentalTo, ${boundedJson(Prisma.sql`c.applicableItemGroupIds`)} AS applicableItemGroupIds,
          c.status, c.version, c.createdAt, c.updatedAt
        FROM rental_coupon_templates AS c WHERE c.tenantId = ${tenantId} AND c.workspaceId = ${workspaceId} ORDER BY c.id LIMIT ${limit + 1}`)
    ]);
    const owned = (row: { tenantId: string; workspaceId: string }) => row.tenantId === tenantId && row.workspaceId === workspaceId;
    const complete = (rows: readonly { tenantId: string; workspaceId: string; id: string }[]) => {
      if (rows.some(row => !owned(row)) || new Set(rows.map(row => row.id)).size !== rows.length) throw new ConflictException('报价配置来源无效');
      if (rows.length > limit) throw new ServiceUnavailableException('报价配置全集超出只读上限');
    };
    for (const rows of [groups, pricing, locations, coupons]) complete(rows);
    if (locations.some(row => ids !== undefined && !ids.includes(row.id))) throw new ForbiddenException('报价配置返回未授权地点');
    if (groups.some(row => row.bundleComponents.length > memberLimit) || pricing.some(row => row.members.length > memberLimit))
      throw new ServiceUnavailableException('报价配置关联超出只读上限');
    if (groups.some(row => row.bundleComponents.some(c => !owned(c.componentItemGroup) || c.componentItemGroup.id !== c.componentItemGroupId))
      || pricing.some(row => row.members.some(m => !owned(m.itemGroup) || m.itemGroup.id !== m.itemGroupId))) throw new ConflictException('报价配置关联来源无效');
    const groupIds = groups.map(row => row.id), operatorIds = [...new Set(locations.map(row => row.operatorId).filter((id): id is string => Boolean(id)))];
    const [attributes, operators] = await Promise.all([
      groupIds.length ? this.prisma.$queryRaw<Array<{ tenantId: string; workspaceId: string; id: string; updatedAt: Date; attributes: unknown }>>(Prisma.sql`
        SELECT g.tenantId, g.workspaceId, g.id, g.updatedAt, ${boundedJson(Prisma.sql`g.attributes`, 32768)} AS attributes
        FROM rental_item_groups AS g WHERE g.tenantId = ${tenantId} AND g.workspaceId = ${workspaceId}
          AND g.id IN (${Prisma.join(groupIds)}) ORDER BY g.id LIMIT ${limit + 1}`) : [],
      operatorIds.length ? this.prisma.rentalFulfillmentOperator.findMany({ where: { ...where, id: { in: operatorIds } }, orderBy: { id: 'asc' }, take: limit + 1,
        select: { id: true, tenantId: true, workspaceId: true, code: true, name: true, type: true, status: true, createdAt: true, updatedAt: true } }) : []
    ]);
    complete(attributes); complete(operators);
    if (attributes.length !== groups.length || attributes.some(row => !groupIds.includes(row.id)
        || !(row.updatedAt instanceof Date) || row.updatedAt.getTime() !== groups.find(group => group.id === row.id)?.updatedAt.getTime())
      || operators.length !== operatorIds.length || operators.some(row => !operatorIds.includes(row.id))) throw new ConflictException('报价配置读取期间关联变化');
    const atom = z.string().min(1).max(191), flag = z.boolean(), amount = z.number().finite().nonnegative();
    const array = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(limit);
    const parseJson = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
    try {
      if (metadata.length !== 1) throw new ServiceUnavailableException('报价持久配置/独立空间档案不可用');
      const meta = metadata[0];
      if (!owned(meta) || meta.settingsCategoryCode !== meta.categoryCode || meta.profileCategoryCode !== meta.categoryCode
        || !Object.prototype.hasOwnProperty.call(RENTAL_CATEGORY_WORKSPACE_NAMES, lower(meta.categoryCode))) throw new ConflictException('报价配置品类来源变化');
      const settings = z.object({ tenantId: atom, categoryCode: atom, configVersion: atom,
        pricing: z.object({ enabledUnits: array(z.enum(RENTAL_PRICING_UNIT_CODES)), defaultUnit: z.enum(RENTAL_PRICING_UNIT_CODES),
          currency: atom.refine(value => (RENTAL_CURRENCY_CODES as readonly string[]).includes(value)), taxIncluded: flag, holidayPricingEnabled: flag }),
        fulfillment: z.object({ enabledModes: array(z.enum(RENTAL_FULFILLMENT_MODES)), deliveryServiceArea: z.object({ mode: z.enum(['all', 'allowlist']),
          areas: array(z.object({ province: atom, city: atom, district: atom.optional() })) }).optional() }),
        payment: z.object({ enabledMethods: array(z.enum(RENTAL_PAYMENT_METHOD_CODES)).optional() }),
        calendar: z.object({ weekendDays: z.array(z.number().int().min(0).max(6)).max(7), holidayPricingEnabled: flag,
          officialCalendarRegion: z.enum(['CN', 'NONE']), weeklyHours: z.array(z.object({
            windows: array(z.object({ start: z.string().max(80), end: z.string().max(80) })),
            pickup: array(z.object({ start: z.string().max(80), end: z.string().max(80) })).optional(),
            return: array(z.object({ start: z.string().max(80), end: z.string().max(80) })).optional(),
            delivery: array(z.object({ start: z.string().max(80), end: z.string().max(80) })).optional()
          })).max(7).optional(), timeZone: z.string().min(1).max(100).optional() }),
        membership: z.object({ signupRewardEnabled: flag, signupRewardType: z.enum(['points', 'balance', 'coupon']), signupRewardAmount: amount,
          signupRewardCouponTemplateId: atom.optional(), referralRewardEnabled: flag, referralRewardType: z.enum(['points', 'balance', 'coupon']),
          referrerRewardAmount: amount, inviteeRewardAmount: amount, referralRewardCouponTemplateId: atom.optional(), referralTrigger: z.enum(['registration', 'identity_verified', 'first_order_completed']) }),
        notifications: z.object({ enabledEvents: array(atom), editableChannels: array(z.enum(['sms', 'app_push', 'wechat', 'email'])) }),
        updatedAt: z.string().datetime({ offset: true }), updatedBy: atom
      }).parse(parseJson(meta.settings)) as TenantRentalBusinessSettings;
      if (settings.tenantId !== tenantId || settings.categoryCode !== lower(meta.categoryCode) || settings.configVersion !== meta.configVersion)
        throw new ConflictException('报价设置版本或归属变化');
      if (![meta.initializedAt, meta.profileUpdatedAt].every(value => value instanceof Date && Number.isFinite(value.getTime())))
        throw new ConflictException('报价档案时间来源无效');
      const terms = parseJson(meta.terminology);
      if (!terms || typeof terms !== 'object' || Array.isArray(terms) || 'readLimitExceeded' in terms) throw new ConflictException('报价术语投影无效或超限');
      const terminology = z.object(Object.fromEntries(['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel',
        'deliveryLabel', 'identifierLabel', 'serialLabel', 'usageMetricLabel', 'assetCollectionLabel'].map(key => [key, z.string().min(1).max(80).optional()]))
      ).extend({ navigationLabels: z.object({ inventoryGroup: atom.optional(), itemGroups: atom.optional(), pricingGroups: atom.optional(), assets: atom.optional(), locations: atom.optional() }).optional() }).parse(parseJson(meta.terminology));
      const profile = this.toProfile({ tenantId, categoryCode: meta.profileCategoryCode,
        capabilities: array(z.enum(RENTAL_CAPABILITY_CODES)).parse(parseJson(meta.capabilities)), terminology,
        configVersion: atom.parse(meta.profileVersion), initializedAt: meta.initializedAt, updatedAt: meta.profileUpdatedAt })!;
      const attrs = new Map(attributes.map(row => [row.id, row.attributes]));
      const projectedGroups = groups.map(row => {
        if (lower(row.categoryCode) !== lower(meta.categoryCode)) throw new ConflictException('报价型号品类来源变化');
        const value = parseJson(attrs.get(row.id));
        if (!value || typeof value !== 'object' || Array.isArray(value) || 'readLimitExceeded' in value) throw new ConflictException('报价型号属性无效或超限');
        return this.toItemGroup({ ...row, attributes: value as Prisma.JsonObject, description: null });
      });
      const projectedPricing = pricing.map(row => {
        if (lower(row.categoryCode) !== lower(meta.categoryCode)) throw new ConflictException('报价定价组品类来源变化');
        return this.toPricingGroup({ ...row, description: null });
      });
      const projectedLocations = locations.map(row => this.toLocation({ ...row,
        capabilities: array(z.enum(['pickup', 'return', 'storage', 'delivery'])).parse(parseJson(row.capabilities)),
        address: null, province: null, city: null, district: null, latitude: null, longitude: null, contactName: null, contactPhone: null, businessHours: null }));
      const projectedOperators = operators.map(row => this.toOperator({ ...row, contactName: null, contactPhone: null, settlementMode: null }));
      const projectedCoupons = coupons.map(row => this.toCouponTemplate({ ...row, stackableWithDiscountPlans: Boolean(row.stackableWithDiscountPlans),
        applicableItemGroupIds: array(atom).parse(parseJson(row.applicableItemGroupIds)) }));
      await assertScope();
      return { tenantId, workspaceId, categoryCode: lower<RentalCategoryCode>(meta.categoryCode), profile, settings, groups: projectedGroups,
        pricingGroups: projectedPricing, locations: projectedLocations, operators: projectedOperators, couponTemplates: projectedCoupons };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new ConflictException('报价配置投影无效或超出读取上限');
      throw error;
    }
  }

  async readReportConfigurationFacts(tenantId: string, workspaceId: string): Promise<RentalReportConfigurationFacts> {
    const assertScope = async () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || await resolveScopeWorkspaceId(this.prisma, tenantId) !== workspaceId)
        throw new ForbiddenException('经营报表配置读取范围变化');
    };
    await assertScope();
    // One bounded joined observation, not two reads of the full quote context.
    // Currency is projected/bounded in SQL; malformed or missing JSON is never
    // substituted by cached/default currency or reported as zero money.
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string; workspaceId: string;
      categoryCode: string; settingsCategoryCode: string; currency: string | null }>>(Prisma.sql`
      SELECT w.tenantId, w.id AS workspaceId, w.categoryCode, s.categoryCode AS settingsCategoryCode,
        CASE WHEN JSON_TYPE(JSON_EXTRACT(s.settings, '$.pricing.currency')) = 'STRING'
          THEN LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.settings, '$.pricing.currency')), 4)
          ELSE NULL END AS currency
      FROM business_workspaces AS w
      JOIN rental_tenant_business_settings AS s ON s.tenantId = w.tenantId AND s.workspaceId = w.id
      WHERE w.tenantId = ${tenantId} AND w.id = ${workspaceId} LIMIT 1`);
    if (rows.length !== 1) throw new ServiceUnavailableException('经营报表持久配置不可用');
    const row = rows[0];
    if (row.tenantId !== tenantId || row.workspaceId !== workspaceId
      || row.settingsCategoryCode !== row.categoryCode || typeof row.categoryCode !== 'string'
      || !Object.prototype.hasOwnProperty.call(RENTAL_CATEGORY_WORKSPACE_NAMES, lower(row.categoryCode))
      || !(RENTAL_CURRENCY_CODES as readonly unknown[]).includes(row.currency))
      throw new ConflictException('经营报表配置来源或币种无效');
    await assertScope();
    return { tenantId, workspaceId, categoryCode: lower<RentalCategoryCode>(row.categoryCode), currency: row.currency as RentalCurrency };
  }

  async readReadinessCoreFacts(tenantId: string, workspaceId: string, tx?: RentalConfigTx): Promise<RentalReadinessCoreFacts> {
    const client = tx ?? this.prisma;
    if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId)
      throw new ForbiddenException('开业读取缺少当前租户或经营空间');
    if (await resolveScopeWorkspaceId(client, tenantId) !== workspaceId) throw new ForbiddenException('开业读取经营空间变化');
    // Same selected-location population as Core.listLocations; scalar counts
    // must not widen a member's location scope merely because names are absent.
    const locationWhere = staffLocationWhere('id'), locationBinding = JSON.stringify(locationWhere);
    const where = { tenantId, workspaceId };
    const [workspace, settings, enabledItemGroupCount, serviceableLocationCount, groups] = await Promise.all([
      client.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId },
        select: { id: true, tenantId: true, categoryCode: true } }),
      // Only the timezone is needed: never materialize the settings JSON or its unrelated fields.
      client.$queryRaw<Array<{ tenantId: string; workspaceId: string; timeZone: string | null }>>(Prisma.sql`
        SELECT tenantId, workspaceId,
          CASE WHEN JSON_TYPE(JSON_EXTRACT(settings, '$.calendar.timeZone')) = 'STRING'
            THEN JSON_UNQUOTE(JSON_EXTRACT(settings, '$.calendar.timeZone'))
            WHEN JSON_TYPE(JSON_EXTRACT(settings, '$.calendar.timeZone')) IS NULL
              OR JSON_TYPE(JSON_EXTRACT(settings, '$.calendar.timeZone')) = 'NULL' THEN NULL
            ELSE '' END AS timeZone
        FROM rental_tenant_business_settings WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} LIMIT 1`),
      client.rentalItemGroup.count({ where: { ...where, status: 'enabled' } }),
      client.rentalFulfillmentLocation.count({ where: { ...where, ...locationWhere, status: 'enabled',
        capabilities: { array_contains: ['pickup', 'return'] },
        operator: { is: { ...where, status: 'enabled' } } } }),
      client.rentalPricingGroup.findMany({ where: { ...where, status: 'enabled' },
        select: { id: true, tenantId: true, workspaceId: true, name: true },
        orderBy: { id: 'asc' }, take: RENTAL_READINESS_FACT_LIMIT + 1 })
    ]);
    if (!workspace || workspace.tenantId !== tenantId || workspace.id !== workspaceId
      || settings.length > 1 || settings.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId)
      || groups.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId
        || typeof row.id !== 'string' || !row.id || row.id.length > 191
        || typeof row.name !== 'string' || !row.name || row.name.length > 191)
      || new Set(groups.map(row => row.id)).size !== groups.length
      || !isRentalCategoryCode(lower(workspace.categoryCode)))
      throw new ConflictException('开业配置来源变化');
    if (groups.length > RENTAL_READINESS_FACT_LIMIT) throw new ServiceUnavailableException('开业定价分组超出读取上限');
    if (![enabledItemGroupCount, serviceableLocationCount].every(value => Number.isSafeInteger(value) && value >= 0))
      throw new ConflictException('开业配置计数无效');
    const timeZone = settings[0]?.timeZone ?? 'Asia/Shanghai';
    if (typeof timeZone !== 'string' || !timeZone.length || timeZone.length > 100) throw new ConflictException('开业营业时区无效');
    try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new ConflictException('开业营业时区无效'); }
    if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
      || JSON.stringify(staffLocationWhere('id')) !== locationBinding
      || await resolveScopeWorkspaceId(client, tenantId) !== workspaceId) throw new ForbiddenException('开业读取经营空间或地点范围变化');
    return { tenantId, workspaceId, categoryCode: lower<RentalCategoryCode>(workspace.categoryCode), timeZone,
      enabledItemGroupCount, serviceableLocationCount, pricingGroups: groups.map(({ id, name }) => ({ id, name })) };
  }

  async readOpeningConfigurationFacts(tenantId: string, workspaceId: string): Promise<RentalOpeningConfigurationFacts> {
    const locationWhere = staffLocationWhere('id'), locationBinding = JSON.stringify(locationWhere);
    const assertScope = async () => {
      if (getRequestTenantId() !== tenantId || getRequestWorkspaceId() !== workspaceId
        || JSON.stringify(staffLocationWhere('id')) !== locationBinding
        || await resolveScopeWorkspaceId(this.prisma, tenantId) !== workspaceId)
        throw new ForbiddenException('开业配置读取范围变化');
    };
    await assertScope();
    const where = { tenantId, workspaceId }, limit = RENTAL_OPENING_CONFIGURATION_LIMIT;
    // SQL bounds JSON before transport, not only after materializing it in JS.
    // These paths are fixed source literals, never model/request expressions.
    const boundedArray = (value: Prisma.Sql) => Prisma.sql`CASE
      WHEN JSON_TYPE(${value}) IS NULL OR JSON_TYPE(${value}) = 'NULL' THEN JSON_ARRAY()
      WHEN JSON_TYPE(${value}) = 'ARRAY' AND JSON_LENGTH(${value}) <= 100
        AND OCTET_LENGTH(CAST(${value} AS CHAR)) <= 4096 THEN ${value}
      ELSE JSON_OBJECT('invalid', TRUE) END`;
    const profileSql = workspaceProfileReadSql();
    const term = (field: typeof RENTAL_OPENING_TERMINOLOGY_FIELDS[number]) => {
      const value = Prisma.sql`JSON_EXTRACT(${profileSql.terminology}, ${`$.${field}`})`;
      return Prisma.sql`CASE WHEN JSON_TYPE(${value}) = 'STRING' THEN LEFT(JSON_UNQUOTE(${value}), 81)
        WHEN JSON_TYPE(${value}) IS NULL OR JSON_TYPE(${value}) = 'NULL' THEN NULL ELSE REPEAT('!', 81) END`;
    };
    const locationIds = getRequestStaffLocationIds();
    const selectedLocations = locationIds === undefined ? Prisma.empty : locationIds.length
      ? Prisma.sql`AND l.id IN (${Prisma.join(locationIds)})` : Prisma.sql`AND 1 = 0`;
    type Meta = { tenantId: string; workspaceId: string; categoryCode: string; configVersion: string;
      options: unknown; profileVersion: string | null; profileCategoryCode: string | null; terminology: unknown };
    type Location = { tenantId: string; workspaceId: string; id: string; code: string; status: string; capabilities: unknown };
    const [workspace, metadata, groups, pricingGroups, locations, enabledItemGroupCount, enabledLocationCount] = await Promise.all([
      this.prisma.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { id: true, tenantId: true, categoryCode: true } }),
      this.prisma.$queryRaw<Meta[]>(Prisma.sql`
        SELECT s.tenantId, s.workspaceId, s.categoryCode, s.configVersion,
          JSON_OBJECT('configVersion', LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.settings, '$.configVersion')), 192),
            'currency', LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.settings, '$.pricing.currency')), 4),
            'defaultUnit', LEFT(JSON_UNQUOTE(JSON_EXTRACT(s.settings, '$.pricing.defaultUnit')), 192),
            'enabledUnits', ${boundedArray(Prisma.sql`JSON_EXTRACT(s.settings, '$.pricing.enabledUnits')`)},
            'enabledModes', ${boundedArray(Prisma.sql`JSON_EXTRACT(s.settings, '$.fulfillment.enabledModes')`)}) AS options,
          ${profileSql.version} AS profileVersion, ${profileSql.category} AS profileCategoryCode,
          JSON_OBJECT('itemLabel', ${term('itemLabel')}, 'itemGroupLabel', ${term('itemGroupLabel')},
            'assetLabel', ${term('assetLabel')}, 'fulfillmentLabel', ${term('fulfillmentLabel')},
            'pickupLabel', ${term('pickupLabel')}, 'returnLabel', ${term('returnLabel')}) AS terminology
        FROM rental_tenant_business_settings AS s
        JOIN business_workspaces AS w ON w.id = s.workspaceId AND w.tenantId = s.tenantId
        LEFT JOIN tenant_rental_profiles AS p ON p.tenantId = s.tenantId AND w.isDefault = TRUE
        ${profileSql.joins}
        WHERE s.tenantId = ${tenantId} AND s.workspaceId = ${workspaceId} LIMIT 1`),
      this.prisma.rentalItemGroup.findMany({ where, orderBy: { id: 'asc' }, take: limit + 1,
        select: { tenantId: true, workspaceId: true, id: true, code: true, status: true, inventoryMode: true, unit: true } }),
      this.prisma.rentalPricingGroup.findMany({ where, orderBy: { id: 'asc' }, take: limit + 1,
        select: { tenantId: true, workspaceId: true, id: true, code: true, status: true, version: true } }),
      this.prisma.$queryRaw<Location[]>(Prisma.sql`
        SELECT l.tenantId, l.workspaceId, l.id, l.code, l.status,
          ${boundedArray(Prisma.sql`l.capabilities`)} AS capabilities
        FROM rental_fulfillment_locations AS l
        WHERE l.tenantId = ${tenantId} AND l.workspaceId = ${workspaceId} ${selectedLocations}
        ORDER BY l.id LIMIT ${limit + 1}`),
      this.prisma.rentalItemGroup.count({ where: { ...where, status: 'enabled' } }),
      this.prisma.rentalFulfillmentLocation.count({ where: { ...where, ...locationWhere, status: 'enabled' } })
    ]);
    const owns = (row: { tenantId: string; workspaceId: string }) => row.tenantId === tenantId && row.workspaceId === workspaceId;
    const atom = z.string().min(1).max(191), status = z.enum(['enabled', 'disabled']);
    const groupSchema = z.object({ id: atom, code: atom, status, inventoryMode: z.nativeEnum(RentalInventoryMode), unit: atom });
    const pricingSchema = z.object({ id: atom, code: atom, status, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
    const locationSchema = z.object({ id: atom, code: atom, status, capabilities: z.array(z.enum(['pickup', 'return', 'storage', 'delivery'])).max(100) });
    const parseJson = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
    const page = <T extends { tenantId: string; workspaceId: string; id: string }, R>(rows: T[], project: (row: T) => R) => {
      if (rows.length > limit + 1 || rows.some(row => !owns(row)) || new Set(rows.map(row => row.id)).size !== rows.length)
        throw new ConflictException('开业配置页来源无效或超出读取上限');
      // Validate the sentinel too; it must not conceal foreign/corrupt rows.
      const projected = rows.map(project);
      return { rows: projected.slice(0, limit), truncated: projected.length > limit };
    };
    try {
      if (!workspace || workspace.id !== workspaceId || workspace.tenantId !== tenantId || metadata.length !== 1)
        throw new ServiceUnavailableException('开业持久配置尚不可用');
      const meta = metadata[0];
      if (!owns(meta) || lower(meta.categoryCode) !== lower(workspace.categoryCode) || !Object.prototype.hasOwnProperty.call(RENTAL_CATEGORY_WORKSPACE_NAMES, lower(workspace.categoryCode)))
        throw new ConflictException('开业配置元数据来源变化');
      const options = z.object({ configVersion: atom, currency: atom.refine(value => (RENTAL_CURRENCY_CODES as string[]).includes(value)),
        defaultUnit: atom, enabledUnits: z.array(atom).max(100), enabledModes: z.array(atom).max(100) }).strict().parse(parseJson(meta.options));
      if (options.configVersion !== meta.configVersion) throw new ConflictException('开业配置版本来源变化');
      let profile: RentalOpeningConfigurationFacts['profile'] = null;
      if (meta.profileVersion !== null) {
        if (meta.profileCategoryCode === null || lower(meta.profileCategoryCode) !== lower(workspace.categoryCode)) throw new ConflictException('开业术语品类来源变化');
        const terms = z.object(Object.fromEntries(RENTAL_OPENING_TERMINOLOGY_FIELDS.map(field => [field, z.string().min(1).max(80).nullable().optional()]))).strict().parse(parseJson(meta.terminology));
        profile = { configVersion: atom.parse(meta.profileVersion), terminology: Object.fromEntries(Object.entries(terms).filter(([, value]) => value != null)) };
      }
      const itemPage = page(groups, row => groupSchema.parse({ ...row, inventoryMode: lower(row.inventoryMode) }));
      const pricingPage = page(pricingGroups, row => pricingSchema.parse(row));
      const locationPage = page(locations, row => locationSchema.parse({ ...row, capabilities: parseJson(row.capabilities) }));
      if (![enabledItemGroupCount, enabledLocationCount].every(value => Number.isSafeInteger(value) && value >= 0))
        throw new ConflictException('开业配置计数无效');
      await assertScope();
      return { tenantId, workspaceId, categoryCode: lower<RentalCategoryCode>(workspace.categoryCode), profile,
        settings: { configVersion: options.configVersion, pricing: { currency: options.currency as TenantRentalBusinessSettings['pricing']['currency'],
          enabledUnits: options.enabledUnits as TenantRentalBusinessSettings['pricing']['enabledUnits'], defaultUnit: options.defaultUnit as TenantRentalBusinessSettings['pricing']['defaultUnit'] },
          fulfillment: { enabledModes: options.enabledModes as TenantRentalBusinessSettings['fulfillment']['enabledModes'] } },
        groups: itemPage.rows, pricingGroups: pricingPage.rows, locations: locationPage.rows,
        truncated: { groups: itemPage.truncated, pricingGroups: pricingPage.truncated, locations: locationPage.truncated }, enabledItemGroupCount, enabledLocationCount };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new ConflictException('开业配置投影内容无效');
      throw error;
    }
  }

  async listItemGroupsPage(tenantId: string, workspaceId: string, value: RentalItemGroupPageQuery, tx?: RentalConfigTx): Promise<RentalItemGroupPage> {
    const query = parseRentalItemGroupPageQuery(value);
    if (tx) {
      if (await resolveScopeWorkspaceId(tx, tenantId) !== workspaceId) throw new ConflictException('商品读取经营空间变化');
      // Item-group writers own this workspace mutex. Current locking reads
      // are necessary even when the caller already established an RR snapshot.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM business_workspaces
        WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`);
      if (locked.length !== 1) throw new ConflictException('商品经营空间不存在');
      const rows = await tx.$queryRaw<Prisma.RentalItemGroupGetPayload<object>[]>(Prisma.sql`
        SELECT * FROM rental_item_groups WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        ${query.itemGroupId ? Prisma.sql`AND id = ${query.itemGroupId}` : Prisma.empty}
        ${query.name ? Prisma.sql`AND name = ${query.name}` : Prisma.empty}
        ${query.cursor ? Prisma.sql`AND id > ${query.cursor}` : Prisma.empty}
        ORDER BY id LIMIT ${query.limit + 1} LOCK IN SHARE MODE`);
      // The sentinel still belongs to this page's scope, even though it is not returned.
      if (rows.length > query.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length
        || rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId))
        throw new ConflictException('商品配置来源无效或超出读取上限');
      const page = rows.slice(0, query.limit), result: RentalItemGroupReadFacts[] = [];
      for (const row of page) {
        const parts = await tx.$queryRaw<Array<{ componentItemGroupId: string; quantity: number; optional: number | boolean;
          substitutionGroup: string | null; code: string; name: string; tenantId: string; workspaceId: string }>>(Prisma.sql`
          SELECT b.componentItemGroupId, b.quantity, b.optional, b.substitutionGroup, g.code, g.name, g.tenantId, g.workspaceId
          FROM rental_bundle_components b JOIN rental_item_groups g ON g.id = b.componentItemGroupId
          WHERE b.bundleItemGroupId = ${row.id} ORDER BY b.componentItemGroupId LIMIT 257 LOCK IN SHARE MODE`);
        if (row.tenantId !== tenantId || row.workspaceId !== workspaceId || parts.length > 256
          || parts.some(part => part.tenantId !== tenantId || part.workspaceId !== workspaceId))
          throw new ConflictException('商品配置来源无效或超出读取上限');
        result.push({ id: row.id, tenantId: row.tenantId, categoryCode: lower<RentalCategoryCode>(row.categoryCode),
          code: row.code, name: row.name, inventoryMode: lower<RentalInventoryMode>(row.inventoryMode), unit: row.unit,
          status: row.status as RentalItemGroup['status'], createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
          bundleComponents: parts.map(part => ({ itemGroupId: part.componentItemGroupId, itemGroupCode: part.code,
            itemGroupName: part.name, quantity: part.quantity, optional: Boolean(part.optional), substitutionGroup: part.substitutionGroup ?? undefined })) });
      }
      const truncated = rows.length > query.limit;
      return { rows: result, nextCursor: truncated ? page[page.length - 1].id : null, truncated,
        source: 'persisted_workspace_configuration', configurationVersion: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
    }
    // Reuse the original server request-space/tenant check, not a caller scope.
    const currentSpace = await resolveScopeWorkspaceId(this.prisma, tenantId);
    if (currentSpace !== workspaceId) throw new ConflictException('商品读取经营空间变化');
    const rows = await this.prisma.rentalItemGroup.findMany({ where: { tenantId, workspaceId,
      ...(query.itemGroupId ? { id: query.itemGroupId } : {}), ...(query.name ? { name: query.name } : {}),
      ...(query.cursor ? { AND: [{ id: { gt: query.cursor } }] } : {}) }, orderBy: { id: 'asc' }, take: query.limit + 1,
      select: { id: true, tenantId: true, workspaceId: true, categoryCode: true, code: true, name: true,
        inventoryMode: true, unit: true, status: true, createdAt: true, updatedAt: true,
        bundleComponents: { take: 257, select: { componentItemGroupId: true, quantity: true, optional: true, substitutionGroup: true,
          componentItemGroup: { select: { code: true, name: true, tenantId: true, workspaceId: true } } } } } });
    // Even the pagination sentinel must have the requested ownership. Bundle
    // joins are bounded and cannot disclose names from another workspace.
    if (rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.bundleComponents.length > 256
      || row.bundleComponents.some(component => component.componentItemGroup.tenantId !== tenantId
        || component.componentItemGroup.workspaceId !== workspaceId))) throw new ConflictException('商品配置来源无效或超出读取上限');
    if ((await resolveScopeWorkspaceId(this.prisma, tenantId)) !== workspaceId) throw new ConflictException('商品读取经营空间变化');
    const truncated = rows.length > query.limit, page = rows.slice(0, query.limit);
    return { rows: page.map(row => ({ id: row.id, tenantId: row.tenantId, categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code, name: row.name, inventoryMode: lower<RentalInventoryMode>(row.inventoryMode), unit: row.unit,
      status: row.status as RentalItemGroup['status'], createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      bundleComponents: row.bundleComponents.map(component => ({ itemGroupId: component.componentItemGroupId,
        itemGroupCode: component.componentItemGroup.code, itemGroupName: component.componentItemGroup.name,
        quantity: component.quantity, optional: component.optional || undefined, substitutionGroup: component.substitutionGroup ?? undefined })) })),
      nextCursor: truncated ? page[page.length - 1].id : null, truncated, source: 'persisted_workspace_configuration',
      configurationVersion: createHash('sha256').update(JSON.stringify(page)).digest('hex') };
  }

  async readFulfillmentAdmission(tenantId: string, workspaceId: string, requirements: readonly RentalFulfillmentRequirement[], tx?: RentalConfigTx) {
    const input = structuredClone(requirements);
    const read = async (client: RentalConfigTx) => {
      if (await resolveScopeWorkspaceId(client, tenantId) !== workspaceId) throw new ConflictException("履约准入经营空间变化");
      const current = await readRentalFulfillmentAdmission(client, tenantId, workspaceId, input);
      return { locations: current.locations.map(row => this.toLocation(row)), operators: current.operators.map(row => this.toOperator(row)) };
    };
    return tx ? read(tx) : this.prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async listInspectionTemplates(tenantId: string, workspaceId: string, tx?: RentalConfigTx): Promise<RentalInspectionTemplate[]> {
    if (tx) {
      // Template writers use the same workspace mutex. Read their committed
      // fields after waiting, including when the outer transaction uses RR.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`);
      const rows = await tx.$queryRaw<Prisma.RentalInspectionTemplateGetPayload<object>[]>(Prisma.sql`
        SELECT * FROM rental_inspection_templates WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND enabled = TRUE ORDER BY id LOCK IN SHARE MODE`);
      return rows.map(row => this.toInspectionTemplate({ ...row, enabled: Boolean(row.enabled) }));
    }
    const rows = await this.prisma.rentalInspectionTemplate.findMany({
      where: { tenantId, workspaceId, enabled: true }, orderBy: { id: "asc" }
    });
    return rows.map((row) => this.toInspectionTemplate(row));
  }

  /** 有外层事务就用它，否则用连接自身——写方法据此既能独立提交，也能并入 bootstrap 事务。 */
  private db(tx?: RentalConfigTx) {
    return tx ?? this.prisma;
  }

  async listWorkspaces(): Promise<Array<{ id: string; tenantId: string; categoryCode: RentalCategoryCode; isDefault: boolean }>> {
    const rows = await this.prisma.businessWorkspace.findMany({
      select: { id: true, tenantId: true, categoryCode: true, isDefault: true }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      isDefault: row.isDefault
    }));
  }

  async loadAll(): Promise<TenantConfigSnapshot[]> {
    const [workspaces, profiles, settings, operators, locations, itemGroups, pricingGroups, couponTemplates, inspectionTemplates] =
      await Promise.all([
        this.listWorkspaces(),
        this.prisma.tenantRentalProfile.findMany(),
        this.prisma.rentalTenantBusinessSettings.findMany(),
        this.prisma.rentalFulfillmentOperator.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalFulfillmentLocation.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalItemGroup.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            bundleComponents: {
              include: { componentItemGroup: { select: { code: true, name: true } } }
            }
          }
        }),
        this.prisma.rentalPricingGroup.findMany({
          orderBy: { createdAt: "desc" },
          include: { members: { orderBy: { sortOrder: "asc" }, include: { itemGroup: true } } }
        }),
        this.prisma.rentalCouponTemplate.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalInspectionTemplate.findMany({ orderBy: { createdAt: "desc" } })
      ]);

    // SPACE-03：以**经营空间**为单位分组，而不是租户。
    // 空间集合取自 business_workspaces 而不是从配置行反推：一个刚建好、
    // 还没有任何配置的空间同样必须得到状态，否则它在读路径上会退化成
    // 「找不到状态」并沿用租户级演示配置。
    return workspaces.map((workspace) => {
      const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspace.id);
      const wsOperators = mine(operators);
      const wsLocations = mine(locations);
      const wsItemGroups = mine(itemGroups);
      const wsPricingGroups = mine(pricingGroups);
      const wsCouponTemplates = mine(couponTemplates);
      const wsInspectionTemplates = mine(inspectionTemplates);
      const wsSettings = mine(settings)[0];
      return {
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        workspaceCategoryCode: workspace.categoryCode,
        // 品类档案仍是租户级（升级兼容层），按 tenantId 取；品类本身以空间为准。
        profile: this.toProfile(profiles.find((row) => row.tenantId === workspace.tenantId)),
        businessSettings: this.toBusinessSettings(wsSettings),
        operators: wsOperators.map((row) => this.toOperator(row)),
        locations: wsLocations.map((row) => this.toLocation(row)),
        itemGroups: wsItemGroups.map((row) => this.toItemGroup(row)),
        pricingGroups: wsPricingGroups.map((row) => this.toPricingGroup(row)),
        couponTemplates: wsCouponTemplates.map((row) => this.toCouponTemplate(row)),
        inspectionTemplates: wsInspectionTemplates.map((row) => this.toInspectionTemplate(row)),
        // 品类档案不计入：seed 只建档案，不代表该空间的配置写过库。
        hasPersistedConfig: Boolean(
          wsSettings ||
            wsOperators.length ||
            wsLocations.length ||
            wsItemGroups.length ||
            wsPricingGroups.length ||
            wsCouponTemplates.length ||
            wsInspectionTemplates.length
        )
      };
    });
  }

  /** Scoped transaction read for new expense validation, with no seed/cache fallback. */
  async loadWorkspace(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantConfigSnapshot> {
    const workspace = await tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true, status: true } });
    if (!workspace || workspace.status !== "ACTIVE") throw new ConflictException("当前经营空间不可用");
    const where = { tenantId, workspaceId };
    const [profile, settings, groups, pricingGroups, locations, coupons] = await Promise.all([
      tx.tenantRentalProfile.findFirst({ where: { tenantId } }), tx.rentalTenantBusinessSettings.findFirst({ where }),
      tx.rentalItemGroup.findMany({ where, include: { bundleComponents: { include: { componentItemGroup: { select: { code: true, name: true } } } } } }),
      tx.rentalPricingGroup.findMany({ where, include: { members: { orderBy: { sortOrder: "asc" }, include: { itemGroup: true } } } }),
      tx.rentalFulfillmentLocation.findMany({ where }), tx.rentalCouponTemplate.findMany({ where }),
    ]);
    return { tenantId, workspaceId, workspaceCategoryCode: lower<RentalCategoryCode>(workspace.categoryCode), profile: this.toProfile(profile ?? undefined),
      businessSettings: this.toBusinessSettings(settings ?? undefined), itemGroups: groups.map(row => this.toItemGroup(row)), pricingGroups: pricingGroups.map(row => this.toPricingGroup(row)),
      locations: locations.map(row => this.toLocation(row)), couponTemplates: coupons.map(row => this.toCouponTemplate(row)), operators: [], inspectionTemplates: [], hasPersistedConfig: Boolean(settings) };
  }

  async upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx, initialization?: RentalDefaultWorkspaceInitialization, expectedBinding?: CategoryWriteBinding): Promise<void> {
    // The opening-policy lock must live through profile and workspace creation.
    // Autocommit SELECT FOR UPDATE would release it before the protected write.
    if (!tx) {
      await this.prisma.$transaction((client) => this.upsertProfile(profile, client, initialization, expectedBinding), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      return;
    }
    const data = {
      categoryCode: rentalCategoryStorageCode(profile.categoryCode),
      capabilities: profile.capabilities as unknown as Prisma.InputJsonValue,
      terminology: profile.terminology as unknown as Prisma.InputJsonValue,
      configVersion: profile.configVersion
    };
    // 租户级档案只能由**默认空间**写入。
    //
    // 这张表主键是 tenantId 一格，而 persistConfig 会被 registerWorkspace（新建
    // 任意空间）和 factContext（任一空间首次访问经营事实）调用。不做这个判定时，
    // 第二个空间的品类会覆盖租户级档案；启动预热又把这份租户级档案灌进**每个**
    // 空间的 state.profile，于是默认空间的品类被改成另一个空间的品类。
    // 实测后果：tenant_001 默认空间是 camera，档案被 camping 空间改成了 camping，
    // 之后业务侧每个请求都判定"品类变了"并用 camping 默认值覆盖该空间的定价、
    // 优惠、规则与通知模板——vehicle 的资质审核要求也会被一并抹掉。
    //
    // 档案在需求里是「租户级升级兼容层」，不是空间的品类来源；空间品类的事实源
    // 是 business_workspaces.categoryCode。因此非默认空间一律不碰它。
    const requestWorkspaceId = getRequestWorkspaceId();
    const isDefaultWorkspaceWrite = !requestWorkspaceId || requestWorkspaceId === `ws_${profile.tenantId}`;
    if (initialization?.categoryVersionId && !isDefaultWorkspaceWrite) throw new ConflictException("初始化选版只适用于新建默认空间");
    let current: Awaited<ReturnType<typeof lockActiveCategoryBinding>> | undefined;
    if (expectedBinding) {
      // 普通设置保存与采用共用空间锁，旧页面不能在新版生效后覆盖档案。
      // 已有绑定不再进入新空间政策/成员初始化，避免持空间锁后反向获取政策锁。
      const workspaceId = await resolveScopeWorkspaceId(tx, profile.tenantId);
      current = await lockActiveCategoryBinding(tx, profile.tenantId, workspaceId, expectedBinding, profile.categoryCode);
      const { definition } = current;
      if (profile.configVersion !== definition.version || profile.capabilities.some(code => !definition.defaultCapabilities.includes(code))) {
        throw new ConflictException("经营档案与当前采用品类版本不一致，请刷新后重新保存");
      }
    }
    if (isDefaultWorkspaceWrite) {
      await this.persistCompatibilityProfile(profile, data, tx, true);
      if (!expectedBinding) await this.ensureDefaultWorkspace(profile.tenantId, data.categoryCode, tx, initialization);
      if (this.failureEvents?.openingConfiguration) {
        await this.captureOpening(tx, profile.tenantId, await resolveScopeWorkspaceId(tx, profile.tenantId), 'tenant_profile');
      }
      return;
    }
    const workspaceId = requestWorkspaceId!;
    current ??= await lockActiveCategoryBinding(tx, profile.tenantId, workspaceId, expectedBinding, profile.categoryCode);
    if (profile.configVersion !== current.definition.version || profile.capabilities.some(code => !current.definition.defaultCapabilities.includes(code))) {
      throw new ConflictException("空间档案与当前品类定义不一致");
    }
    const storedProfile = this.parseWorkspaceProfile({ ...profile, categoryVersionId: current.binding.categoryVersionId,
      categoryAdoptionRevision: current.binding.adoptionRevision }, profile.tenantId, profile.categoryCode);
    if (Buffer.byteLength(JSON.stringify(storedProfile), "utf8") > 65536) throw new BadRequestException("空间档案超过64KiB");
    // 非默认空间：确保兼容档案存在，但绝不改既有品类；父锁和空间锁已先取得。
    await this.persistCompatibilityProfile(profile, data, tx, false);
    // This facet commits with profile/binding validation. Ordinary backup writes
    // preserve it, so a late cache snapshot cannot undo explicit terminology.
    const encoded = JSON.stringify(storedProfile);
    // The service stamps identical input too. Preserve the original edit time
    // when its actual profile facts match; compare in SQL without loading the
    // recovery aggregate or modifying any other facet.
    const nextProfile = Prisma.sql`CASE WHEN JSON_TYPE(JSON_EXTRACT(state, '$.profile')) = 'OBJECT'
      AND CAST(JSON_REMOVE(JSON_EXTRACT(state, '$.profile'), '$.updatedAt') AS BINARY)
        = CAST(JSON_REMOVE(CAST(${encoded} AS JSON), '$.updatedAt') AS BINARY)
      THEN JSON_EXTRACT(state, '$.profile') ELSE CAST(${encoded} AS JSON) END`;
    await writeRentalCoreConfigurationSnapshot(tx, profile.tenantId, workspaceId,
      { profile: storedProfile, configPersisted: true, profilePersisted: true }, Prisma.sql`JSON_SET(state, '$.profile', ${nextProfile},
        '$.profilePersisted', CAST('true' AS JSON), '$.configPersisted', CAST('true' AS JSON))`);
    await this.captureOpening(tx, profile.tenantId, workspaceId, 'core_snapshot');
  }

  /**
   * SPACE-01：保证「有品类档案的租户必然有一个默认经营空间，且其所有账号都是成员」。
   *
   * 为什么挂在 upsertProfile 上而不是只放在 bootstrapTenant：品类档案有两条写入路径——
   * 租户初始化，以及懒加载租户首次访问业务事实时的自愈补落。只在 bootstrap 里建空间，
   * 懒加载出来的租户就会有档案却没有空间，与回填迁移的规则不一致（E2E 第 50 节实测到
   * 5 个有档案的租户只有 3 个空间）。把不变量钉在档案的写入点上，两条路径才一致。
   *
   * 规则与回填迁移逐字一致：id 为 ws_<tenantId>、code 为 default、品类取自档案。
   *
   * 品类**只在创建时写入**：需求 3 规定空间产生业务后不得通过普通设置切换品类，
   * 因此即使档案品类被改动，也不在这里跟着改既有空间——那需要显式迁移。
   */
  private async ensureDefaultWorkspace(
    tenantId: string,
    categoryCode: RentalCategoryCode,
    tx?: RentalConfigTx,
    initialization?: RentalDefaultWorkspaceInitialization
  ): Promise<void> {
    const client = this.db(tx);
    const workspaceId = `ws_${tenantId}`;
    await client.$queryRaw(Prisma.sql`SELECT code FROM rental_category_definitions WHERE code = ${categoryCode.toLowerCase()} FOR UPDATE`);
    const existingWorkspace = await client.businessWorkspace.findUnique({ where: { id: workspaceId } });
    const category = await client.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } });
    if (existingWorkspace && (existingWorkspace.tenantId !== tenantId || existingWorkspace.categoryCode !== categoryCode ||
        initialization?.categoryVersionId && existingWorkspace.categoryVersionId !== initialization.categoryVersionId)) {
      throw new ConflictException("已有默认空间不能通过初始化切换品类或版本，请使用正式采用流程");
    }
    const versionId = existingWorkspace ? existingWorkspace.categoryVersionId : initialization?.categoryVersionId ?? category?.recommendedVersionId;
    const version = versionId
      ? await client.rentalCategoryVersion.findUnique({ where: { id: versionId } })
      : null;
    if (!version || version.categoryCode !== categoryCode ||
        !["published", "legacy_baseline"].includes(version.status)) {
      throw new ConflictException("默认经营空间缺少可采用的品类版本");
    }
    if (!existingWorkspace) await assertCategoryAdoptionAllowed(client, tenantId, categoryCode, version.id, "create");
    const definition = resolveRentalCategoryVersionBody(version, categoryCode);
    const workspace = await client.businessWorkspace.upsert({
      where: { id: workspaceId },
      create: {
        id: workspaceId,
        tenantId,
        code: "default",
        name: rentalDefaultWorkspaceName(definition),
        categoryCode,
        categoryVersionId: version.id,
        isDefault: true,
        defaultMarker: "default"
      },
      // 已存在即不动：不覆盖名称，也绝不改品类。
      update: {}
    });
    // 该租户的现有账号补为默认空间成员，仅在**首次创建**该空间时执行。
    //
    // 不能每次 upsertProfile 都跑：这个方法会被 registerWorkspace（新建任意空间）
    // 和 factContext（任一空间首次访问经营事实）触发，若每次都把全部账号 upsert
    // 进默认空间，管理员刻意移除的成员关系会被静默重建——一个只该进入空间 B 的
    // 账号会重新获得默认空间 A 的读写权。`update: {}` 只保护"已存在但被停用"的行，
    // 挡不住"已被删除"的行重新出现。
    //
    // 旧空间也可能没有初始化审计；只按其实际绑定补记，不把当前推荐版误写为旧空间版本。
    if (workspace.categoryVersionId && workspace.categoryAdoptionRevision === 0) {
      await client.rentalCategoryAdoptionAudit.upsert({
        where: { workspaceId_toRevision: { workspaceId, toRevision: 0 } },
        update: {},
        create: {
          tenantId, workspaceId, toVersionId: workspace.categoryVersionId,
          fromRevision: 0, toRevision: 0, action: "create",
          actorId: initialization?.actorId ?? "system", reason: initialization?.categoryVersionId ? "初始化默认经营空间明确采用品类版本" : "初始化默认经营空间品类版本"
        }
      });
    }
    // 首次创建的判定用 upsert 的返回值：createdAt === updatedAt 说明这次是 create。
    const isFreshWorkspace = workspace.createdAt.getTime() === workspace.updatedAt.getTime();
    if (!isFreshWorkspace) return;
    const users = await client.user.findMany({ where: { tenantId }, select: { id: true, isActive: true } });
    for (const user of users) {
      await client.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        // roleId 留空 = 沿用租户级角色集（与回填迁移同规则）。
        // 写 user.roleId 会让 findWorkspaceScopedUser 用单个角色整体替换权限，
        // 多角色账号的授权会静默收缩。
        create: { tenantId, workspaceId, userId: user.id, roleId: null, isActive: user.isActive },
        update: {}
      });
    }
  }

  async readVersionedBusinessSettings(tenantId: string, tx?: RentalConfigTx): Promise<VersionedBusinessSettings | null> {
    const client = this.db(tx), workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    if (tx) await lockActiveCategoryBinding(tx, tenantId, workspaceId);
    const row = await client.rentalTenantBusinessSettings.findUnique({ where: { workspaceId } });
    if (!row) return null;
    if (row.tenantId !== tenantId || row.workspaceId !== workspaceId || !Number.isSafeInteger(row.settingsRevision)
      || row.settingsRevision < 1 || !row.settings || typeof row.settings !== 'object' || Array.isArray(row.settings)) throw new ConflictException('经营设置版本不可用');
    return { settings: structuredClone(row.settings) as unknown as TenantRentalBusinessSettings, settingsRevision: row.settingsRevision };
  }

  async upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, expectedSettingsRevision?: number): Promise<number> {
    if (expectedSettingsRevision !== undefined && (!Number.isSafeInteger(expectedSettingsRevision)
      || expectedSettingsRevision < 1 || expectedSettingsRevision >= 4294967295)) throw new BadRequestException('经营设置版本无效');
    const data = {
      categoryCode: rentalCategoryStorageCode(settings.categoryCode),
      configVersion: settings.configVersion,
      settings: settings as unknown as Prisma.InputJsonValue,
      updatedBy
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, settings.tenantId);
      const { definition } = await lockActiveCategoryBinding(client, settings.tenantId, workspaceId, expectedBinding, settings.categoryCode);
      const model = definition.businessModel;
      if (!settings.pricing.enabledUnits.length || settings.pricing.enabledUnits.some((unit) => !model.pricingUnits.includes(unit)) || !settings.pricing.enabledUnits.includes(settings.pricing.defaultUnit)) throw new BadRequestException("当前经营品类不支持该计价设置");
      if (!settings.fulfillment.enabledModes.length || settings.fulfillment.enabledModes.some((mode) => !model.fulfillmentModes.includes(mode))) throw new BadRequestException("当前经营品类不支持该履约设置");
      if (!model.supportsHolidayPricing && (settings.pricing.holidayPricingEnabled || settings.calendar.holidayPricingEnabled)) throw new BadRequestException("当前经营品类不支持节假日差异定价");
      if (expectedSettingsRevision !== undefined) {
        const changed = await client.rentalTenantBusinessSettings.updateMany({
          where: { workspaceId, tenantId: settings.tenantId, settingsRevision: expectedSettingsRevision },
          data: { ...data, settingsRevision: { increment: 1 } }
        });
        if (changed.count !== 1) throw new ConflictException('经营设置版本已变化，请重新准备');
        await this.captureOpening(client, settings.tenantId, workspaceId, 'business_settings');
        return expectedSettingsRevision + 1;
      }
      const saved = await client.rentalTenantBusinessSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, tenantId: settings.tenantId, ...data, settingsRevision: 1 },
        update: { ...data, settingsRevision: { increment: 1 } },
        select: { settingsRevision: true }
      });
      await this.captureOpening(client, settings.tenantId, workspaceId, 'business_settings');
      return saved.settingsRevision;
    };
    // Scope lookup can happen before waiting for the space lock. READ COMMITTED
    // prevents that lookup from pinning an old MySQL snapshot for later reads.
    return tx ? write(tx) : this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx, preserveStatus = false): Promise<RentalFulfillmentOperator['status']> {
    const data = {
      tenantId: operator.tenantId,
      code: operator.code,
      name: operator.name,
      type: operator.type,
      contactName: operator.contactName ?? null,
      contactPhone: operator.contactPhone ?? null,
      settlementMode: operator.settlementMode ?? null,
      status: operator.status
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, operator.tenantId);
      await lockActiveCategoryBinding(client, operator.tenantId, workspaceId);
      const existing = await client.rentalFulfillmentOperator.findUnique({ where: { id: operator.id }, select: { tenantId: true, workspaceId: true, status: true } });
      assertScopedWrite(existing, operator.tenantId, workspaceId, "经营主体");
      const current = preserveStatus ? (await client.$queryRaw<Array<{ tenantId: string; workspaceId: string; status: string }>>(Prisma.sql`
        SELECT tenantId, workspaceId, status FROM rental_fulfillment_operators WHERE id = ${operator.id} FOR UPDATE
      `))[0] : undefined;
      if (preserveStatus && (!current || current.tenantId !== operator.tenantId || current.workspaceId !== workspaceId)) throw new ConflictException("经营主体原状态不可核实，请重新读取配置");
      const status = preserveStatus ? current!.status : operator.status;
      if (status !== 'enabled' && status !== 'disabled') throw new BadRequestException("经营主体状态无效");
      const saved = { ...data, status };
      await client.rentalFulfillmentOperator.upsert({
        where: { id: operator.id },
        create: { workspaceId, id: operator.id, ...saved, createdAt: new Date(operator.createdAt) },
        update: saved
      });
      await this.captureOpening(client, operator.tenantId, workspaceId, 'business_settings');
      return status;
    };
    return tx ? write(tx) : this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, preserveStatus = false): Promise<RentalFulfillmentLocation['status']> {
    const data = {
      tenantId: location.tenantId,
      organizationId: location.organizationId ?? null,
      code: location.code,
      name: location.name,
      type: location.type,
      operatorId: location.operatorId ?? null,
      operatorType: location.operatorType ?? null,
      operatorName: location.operatorName ?? null,
      parentLocationId: location.parentLocationId ?? null,
      capabilities: location.capabilities as unknown as Prisma.InputJsonValue,
      address: location.address ?? null,
      province: location.province ?? null,
      city: location.city ?? null,
      district: location.district ?? null,
      timezone: location.timezone ?? null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      contactName: location.contactName ?? null,
      contactPhone: location.contactPhone ?? null,
      businessHours: location.businessHours ?? null,
      status: location.status
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, location.tenantId);
      const { definition } = await lockActiveCategoryBinding(client, location.tenantId, workspaceId, expectedBinding);
      if (!definition.businessModel.locationTypes.includes(location.type)) throw new BadRequestException("当前经营品类不支持该履约地点类型");
      const existing = await client.rentalFulfillmentLocation.findUnique({ where: { id: location.id }, select: { tenantId: true, workspaceId: true, status: true } });
      assertScopedWrite(existing, location.tenantId, workspaceId, "履约地点");
      const current = preserveStatus ? (await client.$queryRaw<Array<{ tenantId: string; workspaceId: string; status: string }>>(Prisma.sql`
        SELECT tenantId, workspaceId, status FROM rental_fulfillment_locations WHERE id = ${location.id} FOR UPDATE
      `))[0] : undefined;
      if (preserveStatus && (!current || current.tenantId !== location.tenantId || current.workspaceId !== workspaceId)) throw new ConflictException("履约地点原状态不可核实，请重新读取配置");
      const status = preserveStatus ? current!.status : location.status;
      if (status !== 'enabled' && status !== 'disabled') throw new BadRequestException("履约地点状态无效");
      if (location.operatorId) {
        const operator = await client.rentalFulfillmentOperator.findFirst({ where: { id: location.operatorId, tenantId: location.tenantId, workspaceId }, select: { id: true } });
        if (!operator) throw new ConflictException("履约地点引用了其他租户或经营空间的经营主体");
      }
      if (location.organizationId) {
        const organization = await client.organizationUnit.findFirst({
          where: { id: location.organizationId, tenantId: location.tenantId, status: "enabled" },
          select: { id: true }
        });
        if (!organization) throw new ConflictException("履约地点只能归属当前租户内已启用的组织");
      }
      if (location.parentLocationId) {
        const parent = await client.rentalFulfillmentLocation.findFirst({ where: { id: location.parentLocationId, tenantId: location.tenantId, workspaceId }, select: { id: true } });
        if (!parent) throw new ConflictException("履约地点引用了其他租户或经营空间的上级地点");
      }
      const saved = { ...data, status };
      await client.rentalFulfillmentLocation.upsert({
        where: { id: location.id },
        create: { workspaceId, id: location.id, ...saved },
        update: saved
      });
      await this.captureOpening(client, location.tenantId, workspaceId, 'business_settings');
      return status;
    };
    return tx ? write(tx) : this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** 套装组成是独立表，整组替换以免留下已被移除的组件行。 */
  async upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx, uniqueAttributes?: RentalUniqueAttributeClaim[], expectedBinding?: CategoryWriteBinding, allowMediaWrite = false): Promise<void> {
    const data = {
      tenantId: group.tenantId,
      categoryCode: rentalCategoryStorageCode(group.categoryCode),
      code: group.code,
      name: group.name,
      inventoryMode: upper<$Enums.RentalInventoryMode>(group.inventoryMode),
      unit: group.unit,
      description: group.description ?? null,
      attributes: group.attributes as Prisma.InputJsonValue,
      status: group.status
    };
    // 商品组与套装组成必须一起提交，否则会留下"组已改、组成还是旧的"的中间态。
    // 有外层事务时直接复用它——Prisma 不支持嵌套交互式事务，自己再开一个会报错。
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, group.tenantId);
      const activeWrite = await validateActiveCategoryWrite(client, group.tenantId, workspaceId, {
        id: group.id, scope: "item_group", attributes: group.attributes, inventoryMode: group.inventoryMode, categoryCode: group.categoryCode
      }, expectedBinding, allowMediaWrite);
      const existing = await client.rentalItemGroup.findUnique({ where: { id: group.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, group.tenantId, workspaceId, "产品型号");
      const componentIds = [...new Set(group.bundleComponents.map((component) => component.itemGroupId))];
      if (componentIds.length) {
        const components = await client.rentalItemGroup.findMany({ where: { id: { in: componentIds }, tenantId: group.tenantId, workspaceId }, select: { id: true } });
        if (components.length !== componentIds.length) throw new ConflictException("套装组成引用了其他租户或经营空间的产品型号");
      }
      {
        await client.rentalAttributeUniqueValue.deleteMany({
          where: { tenantId: group.tenantId, workspaceId, entityType: "item_group", entityId: group.id }
        });
        for (const claim of activeWrite.claims) {
          try {
            await client.rentalAttributeUniqueValue.create({ data: {
              id: `attruniq_${createHash("sha256").update(`${workspaceId}|item_group|${claim.fieldCode}|${claim.normalizedValue}`).digest("hex")}`,
              tenantId: group.tenantId, workspaceId, entityType: "item_group",
              fieldCode: claim.fieldCode,
              normalizedHash: createHash("sha256").update(claim.normalizedValue).digest("hex"),
              normalizedValue: claim.normalizedValue, entityId: group.id
            } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              throw new ConflictException(`${claim.label}已存在`);
            }
            throw error;
          }
        }
      }
      await client.rentalItemGroup.upsert({
        where: { id: group.id },
        create: { workspaceId, id: group.id, ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue, createdAt: new Date(group.createdAt) },
        update: { ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue }
      });
      await client.rentalBundleComponent.deleteMany({ where: { bundleItemGroupId: group.id } });
      for (const component of group.bundleComponents) {
        await client.rentalBundleComponent.create({
          data: {
            bundleItemGroupId: group.id,
            componentItemGroupId: component.itemGroupId,
            quantity: component.quantity,
            optional: Boolean(component.optional),
            substitutionGroup: component.substitutionGroup ?? null
          }
        });
      }
      await this.captureOpening(client, group.tenantId, workspaceId, 'business_settings');
    };
    if (tx) {
      await write(tx);
      return;
    }
    try {
      await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (uniqueAttributes?.length && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException(`${uniqueAttributes[0].label}已存在`);
      }
      throw error;
    }
  }

  /** Group/member writes share adoption's workspace lock. Recheck current units
   * and member facts after waiting, before replacing the group atomically. */
  async upsertPricingGroup(group: RentalPricingGroup, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void> {
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, group.tenantId);
      const { definition } = await lockActiveCategoryBinding(client, group.tenantId, workspaceId, expectedBinding, group.categoryCode);
      const settings = await client.rentalTenantBusinessSettings.findFirst({ where: { tenantId: group.tenantId, workspaceId }, select: { settings: true } });
      const enabledUnits = (settings?.settings as unknown as TenantRentalBusinessSettings | undefined)?.pricing?.enabledUnits;
      if (group.defaultPricingUnit && (!definition.businessModel.pricingUnits.includes(group.defaultPricingUnit) ||
          (settings && (!Array.isArray(enabledUnits) || !enabledUnits.includes(group.defaultPricingUnit))))) {
        throw new ConflictException("定价分组默认计价单位与当前品类或经营设置不兼容，请重新核对");
      }
      const existing = await client.rentalPricingGroup.findUnique({ where: { id: group.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, group.tenantId, workspaceId, "定价分组");
      if (group.memberItemGroupIds.length) {
        const members = await client.rentalItemGroup.findMany({ where: { id: { in: group.memberItemGroupIds }, tenantId: group.tenantId, workspaceId }, select: { id: true, inventoryMode: true, status: true } });
        if (members.length !== new Set(group.memberItemGroupIds).size) throw new ConflictException("定价分组引用了其他租户或经营空间的产品型号");
        if (members.some(member => member.status !== "enabled") || new Set(members.map(member => member.inventoryMode)).size !== 1) {
          throw new ConflictException("定价分组成员在等待期间已变化，须为启用且库存方式相同的型号");
        }
      }
      await client.rentalPricingGroup.upsert({
        where: { id: group.id },
        create: {
          id: group.id,
          tenantId: group.tenantId,
          workspaceId,
          categoryCode: rentalCategoryStorageCode(group.categoryCode),
          code: group.code,
          name: group.name,
          description: group.description ?? null,
          defaultPricingUnit: group.defaultPricingUnit ?? null,
          status: group.status,
          version: group.version,
          createdAt: new Date(group.createdAt)
        },
        update: {
          code: group.code,
          name: group.name,
          description: group.description ?? null,
          defaultPricingUnit: group.defaultPricingUnit ?? null,
          status: group.status,
          version: group.version
        }
      });
      await client.rentalPricingGroupMember.deleteMany({ where: { pricingGroupId: group.id } });
      if (group.memberItemGroupIds.length) {
        await client.rentalPricingGroupMember.createMany({
          data: group.memberItemGroupIds.map((itemGroupId, sortOrder) => ({ pricingGroupId: group.id, itemGroupId, sortOrder }))
        });
      }
      await this.captureOpening(client, group.tenantId, workspaceId, 'business_settings');
    };
    if (tx) return void await write(tx);
    await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async listCouponTemplates(tenantId: string, workspaceId: string): Promise<RentalCouponTemplate[]> {
    const rows = await this.prisma.rentalCouponTemplate.findMany({
      where: { tenantId, workspaceId }, orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toCouponTemplate(row));
  }

  async upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      code: template.code,
      name: template.name,
      discountType: template.discountType,
      discountValue: new Prisma.Decimal(template.discountValue),
      minimumSpend: new Prisma.Decimal(template.minimumSpend),
      maximumDiscount: template.maximumDiscount === undefined ? null : new Prisma.Decimal(template.maximumDiscount),
      appliesTo: template.appliesTo,
      stackableWithDiscountPlans: template.stackableWithDiscountPlans,
      totalQuota: template.totalQuota,
      claimedQuantity: template.claimedQuantity,
      perCustomerLimit: template.perCustomerLimit,
      perCustomerUseLimit: template.perCustomerUseLimit,
      totalBudget: template.totalBudget === undefined ? null : new Prisma.Decimal(template.totalBudget),
      lockedBudget: new Prisma.Decimal(template.lockedBudget),
      redeemedBudget: new Prisma.Decimal(template.redeemedBudget),
      claimFrom: new Date(template.claimFrom),
      claimTo: new Date(template.claimTo),
      effectiveFrom: new Date(template.effectiveFrom),
      effectiveTo: new Date(template.effectiveTo),
      applicableRentalFrom: template.applicableRentalFrom ? new Date(template.applicableRentalFrom) : null,
      applicableRentalTo: template.applicableRentalTo ? new Date(template.applicableRentalTo) : null,
      applicableItemGroupIds: template.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      status: template.status,
      version: template.version
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, template.tenantId);
      await lockActiveCategoryBinding(client, template.tenantId, workspaceId, expectedBinding);
      // Locking reads must provide the values too: a caller's outer transaction may
      // already have a REPEATABLE READ snapshot from before a concurrent claim.
      const rows = await client.$queryRaw<CouponTemplateRow[]>(Prisma.sql`
        SELECT * FROM rental_coupon_templates WHERE id = ${template.id} FOR UPDATE
      `);
      const existing = rows[0];
      assertScopedWrite(existing, template.tenantId, workspaceId, "优惠券模板");
      if (existing) {
        if ((!tx || expectedBinding) && (existing.claimedQuantity !== template.claimedQuantity
          || Number(existing.lockedBudget) !== template.lockedBudget || Number(existing.redeemedBudget) !== template.redeemedBudget)) {
          throw new ConflictException("优惠券配额或预算已变化，请刷新后重新保存");
        }
        if (template.totalQuota < existing.claimedQuantity) throw new BadRequestException("发行量不能低于已领取数量");
        if (template.totalBudget !== undefined && template.totalBudget < Number(existing.lockedBudget) + Number(existing.redeemedBudget)) {
          throw new BadRequestException("总预算不能低于已锁定与已核销预算");
        }
        if (expectedBinding && template.version !== `${Number(existing.version.split(".")[0]) + 1}.0`) {
          throw new ConflictException("优惠券模板已被其他人员修改，请刷新后重新保存");
        }
      }
      await client.rentalCouponTemplate.upsert({
        where: { id: template.id },
        create: { workspaceId, id: template.id, ...data, createdAt: new Date(template.createdAt) },
        update: data
      });
    };
    if (tx) await write(tx);
    else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async lockCouponTemplateForClaim(
    tenantId: string,
    templateId: string,
    tx: RentalConfigTx
  ): Promise<RentalCouponTemplate | undefined> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await lockActiveCategoryBinding(tx, tenantId, workspaceId);
    const rows = await tx.$queryRaw<CouponTemplateRow[]>(Prisma.sql`
      SELECT * FROM \`rental_coupon_templates\`
      WHERE \`id\` = ${templateId}
        AND \`tenantId\` = ${tenantId}
        AND \`workspaceId\` = ${workspaceId}
        AND \`status\` = 'active'
      FOR UPDATE
    `);
    const row = rows[0];
    return row ? this.toCouponTemplate({ ...row, stackableWithDiscountPlans: Boolean(row.stackableWithDiscountPlans) }) : undefined;
  }

  async upsertInspectionTemplate(template: RentalInspectionTemplate, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      categoryCode: rentalCategoryStorageCode(template.categoryCode),
      code: template.code,
      name: template.name,
      stage: template.stage,
      version: template.version,
      fields: template.fields as unknown as Prisma.InputJsonValue,
      enabled: template.enabled
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, template.tenantId);
      await lockActiveCategoryBinding(client, template.tenantId, workspaceId, undefined, template.categoryCode);
      const existing = await client.rentalInspectionTemplate.findUnique({ where: { id: template.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, template.tenantId, workspaceId, "检查模板");
      await client.rentalInspectionTemplate.upsert({
        where: { id: template.id },
        create: { workspaceId, id: template.id, ...data },
        update: data
      });
    };
    if (tx) await write(tx); else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toProfile(row?: { tenantId: string; categoryCode: string; capabilities: Prisma.JsonValue; terminology: Prisma.JsonValue; configVersion: string; initializedAt: Date; updatedAt: Date }) {
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      capabilities: (row.capabilities ?? []) as TenantRentalProfile["capabilities"],
      terminology: (row.terminology ?? {}) as unknown as TenantRentalProfile["terminology"],
      configVersion: row.configVersion,
      initializedAt: iso(row.initializedAt),
      updatedAt: iso(row.updatedAt)
    } satisfies TenantRentalProfile;
  }

  private toBusinessSettings(row?: { settings: Prisma.JsonValue }) {
    if (!row) return undefined;
    // 嵌套配置块整体以 JSON 明细存放，读回即为领域对象。
    return row.settings as unknown as TenantRentalBusinessSettings;
  }

  private toOperator(row: {
    id: string; tenantId: string; code: string; name: string; type: string;
    contactName: string | null; contactPhone: string | null; settlementMode: string | null;
    status: string; createdAt: Date; updatedAt: Date;
  }): RentalFulfillmentOperator {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      type: row.type as RentalFulfillmentOperator["type"],
      contactName: row.contactName ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      settlementMode: (row.settlementMode ?? undefined) as RentalFulfillmentOperator["settlementMode"],
      status: row.status as RentalFulfillmentOperator["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toLocation(row: {
    id: string; tenantId: string; code: string; name: string; type: string;
    organizationId: string | null;
    operatorId: string | null; operatorType: string | null; operatorName: string | null;
    parentLocationId: string | null; capabilities: Prisma.JsonValue; address: string | null;
    province: string | null; city: string | null; district: string | null; timezone: string | null;
    latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null;
    contactName: string | null; contactPhone: string | null; businessHours: string | null; status: string;
  }): RentalFulfillmentLocation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId ?? undefined,
      code: row.code,
      name: row.name,
      type: row.type as RentalLocationType,
      operatorId: row.operatorId ?? undefined,
      operatorType: (row.operatorType ?? undefined) as RentalFulfillmentLocation["operatorType"],
      operatorName: row.operatorName ?? undefined,
      parentLocationId: row.parentLocationId ?? undefined,
      capabilities: (row.capabilities ?? []) as RentalFulfillmentLocation["capabilities"],
      address: row.address ?? undefined,
      province: row.province ?? undefined,
      city: row.city ?? undefined,
      district: row.district ?? undefined,
      timezone: row.timezone ?? undefined,
      latitude: row.latitude === null ? undefined : Number(row.latitude),
      longitude: row.longitude === null ? undefined : Number(row.longitude),
      contactName: row.contactName ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      businessHours: row.businessHours ?? undefined,
      status: row.status as RentalFulfillmentLocation["status"]
    };
  }

  private toItemGroup(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    inventoryMode: string; unit: string; description: string | null; attributes: Prisma.JsonValue;
    status: string; createdAt: Date; updatedAt: Date;
    bundleComponents: Array<{
      componentItemGroupId: string; quantity: number; optional: boolean; substitutionGroup: string | null;
      componentItemGroup: { code: string; name: string };
    }>;
  }): RentalItemGroup {
    const bundleComponents: RentalBundleComponent[] = row.bundleComponents.map((component) => ({
      itemGroupId: component.componentItemGroupId,
      itemGroupCode: component.componentItemGroup.code,
      itemGroupName: component.componentItemGroup.name,
      quantity: component.quantity,
      optional: component.optional || undefined,
      substitutionGroup: component.substitutionGroup ?? undefined
    }));
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const media = attributes.__itemGroupMedia;
    const storedImages = media && typeof media === "object" && !Array.isArray(media) && Array.isArray((media as { images?: unknown }).images)
      ? (media as { images: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; isCover: boolean }> }).images
      : [];
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      inventoryMode: lower<RentalInventoryMode>(row.inventoryMode),
      unit: row.unit,
      description: row.description ?? undefined,
      attributes,
      images: storedImages.map((image) => ({ ...image, url: `/api/rental/v1/item-groups/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })),
      bundleComponents,
      status: row.status as RentalItemGroup["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toPricingGroup(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    description: string | null; defaultPricingUnit: string | null; status: string; version: number;
    createdAt: Date; updatedAt: Date;
    members: Array<{ itemGroupId: string; itemGroup: {
      id: string; code: string; name: string; inventoryMode: string; unit: string; status: string;
    } }>;
  }): RentalPricingGroup {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      defaultPricingUnit: (row.defaultPricingUnit ?? undefined) as RentalPricingGroup["defaultPricingUnit"],
      memberItemGroupIds: row.members.map((member) => member.itemGroupId),
      members: row.members.map(({ itemGroup }) => ({
        id: itemGroup.id,
        code: itemGroup.code,
        name: itemGroup.name,
        inventoryMode: lower<RentalInventoryMode>(itemGroup.inventoryMode),
        unit: itemGroup.unit,
        status: itemGroup.status as RentalItemGroup["status"]
      })),
      status: row.status as RentalPricingGroup["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toCouponTemplate(row: {
    id: string; tenantId: string; code: string; name: string; discountType: string;
    discountValue: Prisma.Decimal; minimumSpend: Prisma.Decimal; maximumDiscount: Prisma.Decimal | null;
    appliesTo: string; stackableWithDiscountPlans: boolean;
    totalQuota: number; claimedQuantity: number; perCustomerLimit: number; perCustomerUseLimit: number;
    totalBudget: Prisma.Decimal | null; lockedBudget: Prisma.Decimal; redeemedBudget: Prisma.Decimal;
    claimFrom: Date; claimTo: Date;
    effectiveFrom: Date; effectiveTo: Date; applicableItemGroupIds: Prisma.JsonValue;
    applicableRentalFrom: Date | null; applicableRentalTo: Date | null;
    status: string; version: string; createdAt: Date; updatedAt: Date;
  }): RentalCouponTemplate {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      discountType: row.discountType as RentalCouponTemplate["discountType"],
      discountValue: num(row.discountValue),
      minimumSpend: num(row.minimumSpend),
      maximumDiscount: row.maximumDiscount === null ? undefined : num(row.maximumDiscount),
      appliesTo: row.appliesTo as RentalCouponTemplate["appliesTo"],
      stackableWithDiscountPlans: row.stackableWithDiscountPlans,
      totalQuota: row.totalQuota,
      claimedQuantity: row.claimedQuantity,
      perCustomerLimit: row.perCustomerLimit,
      perCustomerUseLimit: row.perCustomerUseLimit,
      totalBudget: row.totalBudget === null ? undefined : num(row.totalBudget),
      lockedBudget: num(row.lockedBudget),
      redeemedBudget: num(row.redeemedBudget),
      claimFrom: iso(row.claimFrom),
      claimTo: iso(row.claimTo),
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: iso(row.effectiveTo),
      applicableRentalFrom: row.applicableRentalFrom ? iso(row.applicableRentalFrom) : undefined,
      applicableRentalTo: row.applicableRentalTo ? iso(row.applicableRentalTo) : undefined,
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      status: row.status as RentalCouponTemplate["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toInspectionTemplate(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    stage: string; version: string; fields: Prisma.JsonValue; enabled: boolean;
  }): RentalInspectionTemplate {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      stage: row.stage as RentalInspectionTemplate["stage"],
      version: row.version,
      fields: (row.fields ?? []) as unknown as RentalInspectionTemplate["fields"],
      enabled: row.enabled
    };
  }

  private parseWorkspaceProfile(value: unknown, tenantId: string, categoryCode: RentalCategoryCode): TenantRentalProfile {
    const atom = z.string().min(1).max(PROFILE_TERMINOLOGY_MAX_LENGTH);
    const labels = z.object({ itemLabel: atom, itemGroupLabel: atom, assetLabel: atom, fulfillmentLabel: atom,
      pickupLabel: atom, returnLabel: atom, identifierLabel: atom, deliveryLabel: atom.optional(), serialLabel: atom.optional(),
      usageMetricLabel: atom.optional(), assetCollectionLabel: atom.optional(), navigationLabels: z.object({ inventoryGroup: atom.optional(),
        itemGroups: atom.optional(), pricingGroups: atom.optional(), assets: atom.optional(), locations: atom.optional() }).strict().optional() }).strict();
    const schema = z.object({ tenantId: z.literal(tenantId), categoryCode: z.literal(categoryCode),
      capabilities: z.array(z.enum(RENTAL_CAPABILITY_CODES)).max(100), terminology: labels, configVersion: z.string().min(1).max(64),
      initializedAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
      categoryVersionId: z.string().min(1).max(191).optional(), categoryAdoptionRevision: z.number().int().min(0).optional() }).strict();
    if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new ConflictException("空间档案JSON不可读"); } }
    if (value && typeof value === "object" && !Array.isArray(value) && "categoryCode" in value) {
      value = { ...value, categoryCode: readRentalCategoryCode(value.categoryCode) };
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ConflictException("空间档案无效或超过读取上限，不能用模板值覆盖");
    return parsed.data;
  }

  private async persistCompatibilityProfile(profile: TenantRentalProfile, data: {
    categoryCode: RentalCategoryCode; capabilities: Prisma.InputJsonValue; terminology: Prisma.InputJsonValue; configVersion: string;
  }, tx: RentalConfigTx, updateExisting: boolean) {
    await tx.tenantRentalProfile.upsert({ where: { tenantId: profile.tenantId },
      create: { tenantId: profile.tenantId, ...data, initializedAt: new Date(profile.initializedAt) }, update: {} });
    const rows = await tx.$queryRaw<Array<{ tenantId: string; categoryCode: string; capabilities: unknown; terminology: unknown;
      configVersion: string; configurationRevision: unknown }>>(Prisma.sql`
      SELECT tenantId, categoryCode, capabilities, terminology, configVersion, configurationRevision FROM tenant_rental_profiles
      WHERE tenantId = ${profile.tenantId} FOR UPDATE`);
    if (rows.length !== 1 || rows[0].tenantId !== profile.tenantId) throw new ConflictException("经营档案配置行不存在或来源变化");
    const row = rows[0], revision = readRentalConfigurationRevision(row.configurationRevision, "经营档案");
    if (!updateExisting) return;
    const parsed = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
    let unchanged: boolean;
    try { unchanged = requestFingerprint({ categoryCode: readRentalCategoryCode(row.categoryCode), capabilities: parsed(row.capabilities),
      terminology: parsed(row.terminology), configVersion: row.configVersion }) === requestFingerprint(data); }
    catch { throw new ConflictException("经营档案原配置不可读取"); }
    if (unchanged) return;
    if (revision === RENTAL_CONFIGURATION_REVISION_MAX) throw new ConflictException("经营档案配置行修订已达上限");
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE tenant_rental_profiles
      SET categoryCode = ${data.categoryCode}, capabilities = CAST(${JSON.stringify(data.capabilities)} AS JSON),
        terminology = CAST(${JSON.stringify(data.terminology)} AS JSON), configVersion = ${data.configVersion},
        configurationRevision = ${revision + 1}, updatedAt = NOW(3)
      WHERE tenantId = ${profile.tenantId} AND configurationRevision = ${revision}`);
    if (changed !== 1) throw new ConflictException("经营档案配置行修订已变化，拒绝覆盖");
  }
}
