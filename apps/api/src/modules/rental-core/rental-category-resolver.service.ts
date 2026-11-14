import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_FULFILLMENT_MODES,
  RENTAL_LOCATION_TYPES,
  RENTAL_CAPABILITY_MODULES,
  RENTAL_PRICING_UNIT_CODES,
  RENTAL_CATEGORY_ICON_CODES,
  isRentalCategoryCode,
  RentalInventoryMode,
  type RentalCategoryDefinition, type RentalCategoryOpeningOptionsQuery, type RentalCategoryOpeningOptions
} from "@rental-os/shared";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { assertRentalCategoryExtensions } from "./rental-extension-registry";
import { validateConditionalCapabilities } from "./category-capability-conditions";
import { readRentalCategoryCode, rentalDefaultWorkspaceName } from "./category-identity";

export interface ResolvedRentalCategory {
  workspaceId: string;
  categoryVersionId: string;
  adoptionRevision: number;
  definition: RentalCategoryDefinition;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const unique = (items: string[]) => new Set(items).size === items.length;
const DEFINITION_KEYS = new Set([
  "code", "name", "description", "supportedInventoryModes", "defaultCapabilities",
  "requiredCapabilities", "conditionalCapabilities", "terminology", "attributeSchema", "businessModel", "version", "display"
]);
const BUSINESS_KEYS = new Set([
  "pricingUnits", "defaultPricingUnit", "fulfillmentModes", "locationTypes",
  "deliveryDestination", "settingModules", "assetFields", "catalogPresentation",
  "supportsHolidayPricing", "supportsUsagePricing", "supportsPreauthorization",
  "supportsQualificationReview", "valueAddedServicePresets", "defaults"
]);
const SETTING_MODULES = new Set([
  "pricing", "discounts", "coupons", "value_added_services", "rental_rules",
  "business_calendar", "membership_rewards", "notification_templates"
]);
const ATTRIBUTE_TYPES = new Set(["string", "number", "boolean", "date", "select"]);
const ATTRIBUTE_SCOPES = new Set(["item_group", "asset", "transaction"]);
const ATTRIBUTE_KEYS = new Set(["code", "label", "scope", "type", "required", "unique", "clientVisible", "unit", "options"]);
const text = (value: unknown, max = 100): value is string =>
  typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const safeFieldCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}(?![\s\S])/u.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);

/**
 * Published bodies are data, not executable instructions. Validate the small
 * executable surface before exposing one to pricing, fulfillment or the UI.
 */
export function parsePublishedRentalCategory(value: unknown, expectedCode: string): RentalCategoryDefinition {
  const fail = (reason: string): never => { throw new ConflictException(`品类版本不可执行：${reason}`); };
  if (!object(value)) return fail("正文为空");
  if (JSON.stringify(value).length > 256 * 1024) return fail("正文超过 256 KiB");
  if (Object.keys(value).some((key) => !DEFINITION_KEYS.has(key))) return fail("存在未知的顶层字段");
  if (value.code !== expectedCode || !isRentalCategoryCode(expectedCode)) fail("编码不匹配");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      typeof value.description !== "string" || value.description.length > 2000 ||
      typeof value.version !== "string" || !value.version.trim() || value.version.length > 64) fail("基础信息不合法");
  if (value.display !== undefined) {
    if (!object(value.display) || !onlyKeys(value.display, ["nameEn", "descriptionEn", "icon", "defaultWorkspaceName", "defaultWorkspaceNameEn", "terminologyEn"])) return fail("展示元数据结构不合法");
    const display = value.display;
    for (const key of ["nameEn", "descriptionEn", "defaultWorkspaceName", "defaultWorkspaceNameEn"]) {
      if (display[key] !== undefined && (typeof display[key] !== "string" || display[key].length > (key === "descriptionEn" ? 2000 : 100))) fail(`展示文案 ${key} 不合法`);
    }
    if (display.icon !== undefined && !RENTAL_CATEGORY_ICON_CODES.includes(display.icon as typeof RENTAL_CATEGORY_ICON_CODES[number])) fail("图标必须从受支持集合选择");
    if (display.terminologyEn !== undefined) {
      if (!object(display.terminologyEn) || !onlyKeys(display.terminologyEn, ["itemLabel", "itemGroupLabel", "assetLabel", "fulfillmentLabel", "pickupLabel", "returnLabel", "identifierLabel", "deliveryLabel", "serialLabel", "usageMetricLabel", "assetCollectionLabel", "navigationLabels"])) return fail("英文术语结构不合法");
      for (const [key, label] of Object.entries(display.terminologyEn)) {
        if (key === "navigationLabels") {
          if (!object(label) || !onlyKeys(label, ["inventoryGroup", "itemGroups", "pricingGroups", "assets", "locations"]) || Object.values(label).some((entry) => typeof entry !== "string" || entry.length > 100)) fail("英文导航术语不合法");
        } else if (typeof label !== "string" || label.length > 100) fail(`英文术语 ${key} 不合法`);
      }
    }
  }
  if (!strings(value.supportedInventoryModes) || !value.supportedInventoryModes.length ||
      !unique(value.supportedInventoryModes) ||
      value.supportedInventoryModes.some((mode) => !Object.values(RentalInventoryMode).includes(mode as RentalInventoryMode))) {
    fail("库存形态不合法");
  }
  if (!strings(value.defaultCapabilities) || !unique(value.defaultCapabilities) ||
      !strings(value.requiredCapabilities) || !unique(value.requiredCapabilities)) fail("能力声明不合法");
  if (!object(value.terminology) || !object(value.attributeSchema) || !object(value.businessModel)) return fail("品类结构不完整");
  const terminology = value.terminology;
  if (!onlyKeys(terminology, ["itemLabel", "itemGroupLabel", "assetLabel", "fulfillmentLabel", "pickupLabel", "returnLabel", "identifierLabel", "deliveryLabel", "serialLabel", "usageMetricLabel", "assetCollectionLabel", "navigationLabels"])) fail("存在未知的术语字段");
  for (const key of ["itemLabel", "itemGroupLabel", "assetLabel", "fulfillmentLabel", "pickupLabel", "returnLabel", "identifierLabel"]) {
    if (typeof terminology[key] !== "string" || !terminology[key].trim() || terminology[key].length > 100) fail(`术语 ${key} 不合法`);
  }
  for (const key of ["deliveryLabel", "serialLabel", "usageMetricLabel", "assetCollectionLabel"]) {
    if (terminology[key] !== undefined && !text(terminology[key])) fail(`术语 ${key} 不合法`);
  }
  if (terminology.navigationLabels !== undefined &&
      (!object(terminology.navigationLabels) ||
       !onlyKeys(terminology.navigationLabels, ["inventoryGroup", "itemGroups", "pricingGroups", "assets", "locations"]) ||
       Object.values(terminology.navigationLabels).some((label) => !text(label)))) fail("导航术语不合法");
  if (Object.entries(value.attributeSchema).some(([key, kind]) =>
    !safeFieldCode(key) || typeof kind !== "string" || !ATTRIBUTE_TYPES.has(kind))) fail("属性概要不合法");
  const business = value.businessModel;
  if (Object.keys(business).some((key) => !BUSINESS_KEYS.has(key))) return fail("存在未知的业务结构字段");
  if (!strings(business.pricingUnits) || !business.pricingUnits.length || !unique(business.pricingUnits) ||
      business.pricingUnits.some((unit) => !RENTAL_PRICING_UNIT_CODES.includes(unit as typeof RENTAL_PRICING_UNIT_CODES[number])) ||
      typeof business.defaultPricingUnit !== "string" || !business.pricingUnits.includes(business.defaultPricingUnit)) fail("计价单位不合法");
  if (!strings(business.fulfillmentModes) || !business.fulfillmentModes.length || !unique(business.fulfillmentModes) ||
      business.fulfillmentModes.some((mode) => !RENTAL_FULFILLMENT_MODES.includes(mode as typeof RENTAL_FULFILLMENT_MODES[number]))) fail("履约方式不合法");
  if (!strings(business.locationTypes) || !business.locationTypes.length || !unique(business.locationTypes) ||
      business.locationTypes.some((kind) => !RENTAL_LOCATION_TYPES.includes(kind as typeof RENTAL_LOCATION_TYPES[number]))) fail("地点类型不合法");
  if (!strings(business.settingModules) || !unique(business.settingModules) ||
      business.settingModules.some((module) => !SETTING_MODULES.has(module))) fail("设置模块不合法");
  if (business.deliveryDestination !== "customer_address" && business.deliveryDestination !== "tenant_location") fail("配送目的地类型不合法");
  for (const key of ["supportsHolidayPricing", "supportsUsagePricing", "supportsPreauthorization", "supportsQualificationReview"]) {
    if (typeof business[key] !== "boolean") fail(`${key} 只能为布尔值`);
  }
  if (!strings(business.valueAddedServicePresets) || business.valueAddedServicePresets.length > 100 ||
      !unique(business.valueAddedServicePresets)) fail("增值服务预设不合法");
  if (!object(business.defaults) || !object(business.defaults.fulfillment) ||
      typeof business.defaults.fulfillment.allowDifferentReturnLocation !== "boolean" ||
      !object(business.defaults.payment) || typeof business.defaults.payment.timing !== "string" ||
      !object(business.defaults.overdue) ||
      typeof business.defaults.overdue.graceMinutes !== "number" ||
      !Number.isFinite(business.defaults.overdue.graceMinutes) || business.defaults.overdue.graceMinutes < 0 ||
      typeof business.defaults.overdue.feeMode !== "string" ||
      typeof business.defaults.overdue.feeMultiplier !== "number" ||
      !Number.isFinite(business.defaults.overdue.feeMultiplier) || business.defaults.overdue.feeMultiplier < 0 ||
      !object(business.defaults.rules) || typeof business.defaults.rules.evidenceRequired !== "boolean" ||
      !object(business.defaults.rules.cancellation) ||
      !strings(business.defaults.rules.qualificationDocumentTypes) ||
      !object(business.defaults.initialSetup) ||
      typeof business.defaults.initialSetup.operatorName !== "string" ||
      typeof business.defaults.initialSetup.locationName !== "string" ||
      typeof business.defaults.initialSetup.locationType !== "string" ||
      !(business.locationTypes as string[]).includes(business.defaults.initialSetup.locationType) ||
      !Array.isArray(business.defaults.inspectionFields) ||
      typeof business.defaults.sampleBaseAmount !== "number" || !Number.isFinite(business.defaults.sampleBaseAmount) ||
      typeof business.defaults.sampleAmountIncrement !== "number" || !Number.isFinite(business.defaults.sampleAmountIncrement)) {
    fail("首版规则或初始化缺省值不合法");
  }
  const defaults = business.defaults as Record<string, unknown>;
  if (!onlyKeys(defaults, ["fulfillment", "payment", "overdue", "rules", "initialSetup", "inspectionFields", "sampleBaseAmount", "sampleAmountIncrement"])) fail("存在未知的初始化字段");
  const payment = defaults.payment as Record<string, unknown>;
  const overdue = defaults.overdue as Record<string, unknown>;
  const rules = defaults.rules as Record<string, unknown>;
  const cancellation = rules.cancellation as Record<string, unknown>;
  const setup = defaults.initialSetup as Record<string, unknown>;
  if (!onlyKeys(defaults.fulfillment as Record<string, unknown>, ["allowDifferentReturnLocation"]) ||
      !onlyKeys(payment, ["timing"]) || !["order", "confirmation", "pickup", "offline_terms"].includes(String(payment.timing)) ||
      !onlyKeys(overdue, ["graceMinutes", "feeMode", "feeMultiplier"]) || !Number.isInteger(overdue.graceMinutes) ||
      !["none", "hourly", "next_period", "multiplier", "manual_review", "hourly_to_daily"].includes(String(overdue.feeMode)) ||
      !onlyKeys(rules, ["evidenceRequired", "cancellation", "qualificationDocumentTypes"]) ||
      !onlyKeys(cancellation, ["freeBeforeHours", "lateFeeType", "lateFeeValue", "weatherExceptionEnabled"]) ||
      !nonnegative(cancellation.freeBeforeHours) || !nonnegative(cancellation.lateFeeValue) ||
      !["none", "fixed_amount", "percentage"].includes(String(cancellation.lateFeeType)) ||
      (cancellation.lateFeeType === "percentage" && (cancellation.lateFeeValue as number) > 100) ||
      typeof cancellation.weatherExceptionEnabled !== "boolean" ||
      !unique(rules.qualificationDocumentTypes as string[]) ||
      (rules.qualificationDocumentTypes as string[]).some((kind) => !text(kind)) ||
      !onlyKeys(setup, ["operatorName", "locationName", "locationType"]) ||
      !text(setup.operatorName) || !text(setup.locationName) ||
      !nonnegative(defaults.sampleBaseAmount) || !nonnegative(defaults.sampleAmountIncrement)) fail("初始化规则的取值或范围不合法");
  const inspectionCodes = new Set<string>();
  const inspections = defaults.inspectionFields as unknown[];
  if (inspections.length > 100) fail("交接检查字段过多");
  for (const field of inspections) {
    if (!object(field) || !onlyKeys(field, ["code", "label", "type", "required", "unit", "options", "usageMetric", "appliesToCapability"]) ||
        !safeFieldCode(field.code) ||
        !text(field.label) || !["boolean", "number", "text", "select", "photo"].includes(String(field.type)) ||
        typeof field.required !== "boolean" || (field.unit !== undefined && !text(field.unit, 32)) ||
        (field.usageMetric !== undefined && typeof field.usageMetric !== "boolean") ||
        (field.usageMetric === true && field.type !== "number") ||
        (field.appliesToCapability !== undefined && !(value.defaultCapabilities as string[]).includes(String(field.appliesToCapability)))) return fail("交接检查字段不合法");
    if (inspectionCodes.has(field.code)) fail("交接检查字段编码重复");
    inspectionCodes.add(field.code);
    if (field.type === "select" && (!strings(field.options) || !field.options.length || !unique(field.options) || field.options.some((option) => !text(option)))) fail("交接检查选项不合法");
    if (field.type !== "select" && field.options !== undefined) fail("非枚举检查字段不能配置选项");
  }
  const presentation = business.catalogPresentation;
  if (presentation !== undefined) {
    if (!object(presentation) || !onlyKeys(presentation, ["itemGroupDescription", "itemGroupCodeLabel", "itemGroupNameLabel", "itemGroupNamePlaceholder", "fixedInventoryMode", "fixedUnit", "itemGroupSummaryFields", "assetDescription", "assetSummaryFields"])) return fail("主档展示配置不合法");
    for (const key of ["itemGroupDescription", "itemGroupCodeLabel", "itemGroupNameLabel", "itemGroupNamePlaceholder", "fixedUnit", "assetDescription"]) {
      if (presentation[key] !== undefined && !text(presentation[key], 2000)) fail("主档展示文案不合法");
    }
    if (presentation.fixedInventoryMode !== undefined && !(value.supportedInventoryModes as string[]).includes(String(presentation.fixedInventoryMode))) fail("固定库存形态不在支持范围内");
    for (const key of ["itemGroupSummaryFields", "assetSummaryFields"]) {
      if (presentation[key] !== undefined && (!strings(presentation[key]) || !unique(presentation[key]) || presentation[key].some((code) => !safeFieldCode(code)))) fail("主档摘要字段不合法");
    }
  }
  const assetFields = business.assetFields;
  if (!Array.isArray(assetFields) || assetFields.length > 100) return fail("资产属性声明过多或不是数组");
  const attributeCodes = new Set<string>();
  for (const field of assetFields as unknown[]) {
    if (!object(field)) return fail("资产属性字段不合法");
    const entry = field as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !ATTRIBUTE_KEYS.has(key)) ||
        !safeFieldCode(entry.code) ||
        typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 100 ||
        typeof entry.scope !== "string" || !ATTRIBUTE_SCOPES.has(entry.scope) ||
        typeof entry.type !== "string" || !ATTRIBUTE_TYPES.has(entry.type) ||
        (entry.required !== undefined && typeof entry.required !== "boolean") ||
        (entry.unique !== undefined && typeof entry.unique !== "boolean") ||
        (entry.clientVisible !== undefined && (typeof entry.clientVisible !== "boolean" || entry.scope !== "item_group")) ||
        (entry.unit !== undefined && !text(entry.unit, 32)) ||
        (entry.scope === "transaction" && entry.unique === true)) return fail("资产属性字段不合法");
    const identity = `${entry.scope}:${entry.code}`;
    if (attributeCodes.has(identity)) fail(`资产属性 ${identity} 重复`);
    attributeCodes.add(identity);
    if (entry.type === "select" && (!strings(entry.options) || !entry.options.length || entry.options.length > 100 || !unique(entry.options) || entry.options.some((option) => !text(option)))) fail(`资产属性 ${identity} 缺少有效选项`);
    if (entry.type !== "select" && entry.options !== undefined) fail(`非枚举资产属性 ${identity} 不能配置选项`);
  }
  const candidate = value as unknown as RentalCategoryDefinition;
  try { assertRentalCategoryExtensions([candidate]); validateConditionalCapabilities(candidate); }
  catch (error) { fail(error instanceof Error ? error.message : "扩展能力不合法"); }
  const declared = new Set(candidate.defaultCapabilities);
  for (const code of declared) {
    const module = RENTAL_CAPABILITY_MODULES.find((item) => item.code === code)!;
    if (module.applicableCategories !== "all" && !module.applicableCategories.includes(candidate.code)) fail(`能力 ${code} 不适用于该品类`);
    if (module.dependsOn.some((dependency) => !declared.has(dependency))) fail(`能力 ${code} 的依赖未声明`);
    if (module.conflictsWith.some((conflict) => declared.has(conflict))) fail(`能力 ${code} 存在互斥声明`);
  }
  return candidate;
}

/** One decoder for historical reads and transaction-local active writes. */
export function resolveRentalCategoryVersionBody(version: { categoryCode: string; structureVersion: number; status: string; definition: unknown } | null, categoryCode: string): RentalCategoryDefinition {
  // Only the four recorded Prisma enum aliases have a legacy interpretation.
  // Lowercasing any stored value would invent aliases for dynamic identities.
  if (!version || readRentalCategoryCode(version.categoryCode) !== categoryCode) throw new ConflictException("业务引用的品类版本不存在或编码不匹配");
  if (version.structureVersion !== 1) throw new ConflictException("当前程序不支持该品类结构版本，请升级兼容程序");
  if (version.status === "legacy_baseline") {
    const runtime = RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === categoryCode);
    if (!runtime || !isDeepStrictEqual(version.definition, runtime)) throw new ConflictException("旧库品类快照与运行定义不一致，需先完成显式对账");
  } else if (version.status !== "published") throw new ConflictException("业务不可引用未发布的品类版本");
  return parsePublishedRentalCategory(version.definition, categoryCode);
}

/** Workspace binding is always re-read. Only a published version body can be cached later. */
@Injectable()
export class RentalCategoryResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Historical work reads the version named by the quote/order, never the current workspace binding. */
  async forVersion(categoryCode: string, versionId: string, tx?: Prisma.TransactionClient): Promise<RentalCategoryDefinition> {
    const version = await (tx ?? this.prisma).rentalCategoryVersion.findUnique({ where: { id: versionId } });
    return resolveRentalCategoryVersionBody(version, categoryCode);
  }

  /** Creation reads the recommended immutable body inside the caller's transaction. */
  async forNewWorkspace(categoryCode: string, tx?: Prisma.TransactionClient): Promise<RentalCategoryDefinition> {
    if (!isRentalCategoryCode(categoryCode)) throw new ConflictException("品类编码格式无效");
    const category = await (tx ?? this.prisma).rentalCategoryDefinition.findFirst({
      where: { code: categoryCode }
    });
    if (!category?.recommendedVersionId) throw new ConflictException("品类尚未设置可采用的推荐版本");
    return this.forVersion(categoryCode, category.recommendedVersionId, tx);
  }

  /** Opening options are a bounded read projection. The create transaction independently rechecks policy and implementation. */
  async openingOptions(query: RentalCategoryOpeningOptionsQuery): Promise<RentalCategoryOpeningOptions> {
    const tenantId = query.tenantId, search = query.search?.trim();
    if (tenantId !== undefined && (typeof tenantId !== "string" || !tenantId.trim() || tenantId.length > 191)) throw new BadRequestException("目标租户格式无效");
    if (search !== undefined && search.length > 100) throw new BadRequestException("品类搜索内容过长");
    if (tenantId && !await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) throw new NotFoundException("目标租户不存在");
    const rows = await this.prisma.rentalCategoryVersion.findMany({
      where: { status: { in: ["published", "legacy_baseline"] },
        category: { is: { OR: [{ openingScope: "all" }, ...(tenantId ? [{ openingScope: "pilot", openingTenantIds: { array_contains: tenantId } }] : [])] } },
        policy: { is: { OR: [{ createScope: "all" }, ...(tenantId ? [{ createScope: "pilot", createTenantIds: { array_contains: tenantId } }] : [])] } },
        ...(search ? { OR: [{ categoryCode: { contains: search } }, { versionLabel: { contains: search } }, { definition: { path: "$.name", string_contains: search } }] } : {}) },
      include: { category: { select: { recommendedVersionId: true } } },
      orderBy: [{ categoryCode: "asc" }, { publishedAt: "desc" }, { id: "asc" }], take: 101
    });
    return { structureVersion: 1, source: "published", truncated: rows.length > 100, options: rows.slice(0, 100).map(row => {
      const definition = resolveRentalCategoryVersionBody(row, readRentalCategoryCode(row.categoryCode));
      return { categoryCode: definition.code, name: definition.name, nameEn: definition.display?.nameEn,
        versionId: row.id, versionLabel: row.versionLabel, recommended: row.category.recommendedVersionId === row.id,
        defaultWorkspaceName: rentalDefaultWorkspaceName(definition) };
    }) };
  }

  async forWorkspace(tenantId: string, workspaceId: string, tx?: Prisma.TransactionClient): Promise<ResolvedRentalCategory> {
    const workspace = await (tx ?? this.prisma).businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId, status: "ACTIVE" },
      select: { categoryCode: true, categoryVersionId: true, categoryAdoptionRevision: true }
    });
    if (!workspace) throw new NotFoundException("经营空间不存在或不可用");
    if (typeof workspace.categoryVersionId !== "string" || !workspace.categoryVersionId.trim()) throw new ConflictException("经营空间尚未绑定品类版本");
    if (typeof workspace.categoryCode !== "string" || !Number.isSafeInteger(workspace.categoryAdoptionRevision)
      || workspace.categoryAdoptionRevision < 0) throw new ConflictException("经营空间品类绑定来源或采用修订无效");
    // Capture one observed binding before awaiting its immutable body. Invalid
    // stored revisions cannot be emitted as metadata or initial/legacy context;
    // a concurrent adoption is checked by each action's existing commit fence.
    const categoryVersionId = workspace.categoryVersionId, adoptionRevision = workspace.categoryAdoptionRevision;
    const definition = await this.forVersion(readRentalCategoryCode(workspace.categoryCode), categoryVersionId, tx);
    return {
      workspaceId, categoryVersionId, adoptionRevision,
      definition
    };
  }
}
