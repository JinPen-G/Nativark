/** Read-only Core extension observations. Prices and historical snapshots stay
 * in Core's units and types, including signed differences. These wire schemas
 * neither calculate prices nor grant extension, payment or inventory authority. */
import type { AiWorkspaceScope } from './ai-native';
import type { AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import { RentalCategoryCode, RentalInventoryMode, RENTAL_CAPABILITY_CODES, RENTAL_PRICING_UNIT_CODES,
  RENTAL_FULFILLMENT_MODES, RENTAL_LOCATION_TYPES, RENTAL_CATEGORY_ICON_CODES,
  RENTAL_SERVICE_BILLING_UNITS, RENTAL_SERVICE_SELECTION_MODES, RENTAL_INSURANCE_PROVIDER_STATUSES,
  RENTAL_DISCOUNT_TARGETS, RENTAL_DISCOUNT_TYPES, RENTAL_DISCOUNT_SKIP_REASONS,
  type RentalOrderExtensionPreview, type RentalCategoryDefinition, type RentalCategoryBusinessModel,
  type RentalCalendarYear, type RentalCalendarDay, type RentalPricingRate, type RentalQuoteServiceSnapshot,
  type RentalQuoteDiscountEvaluation, type RentalQuoteCouponEvaluation, type RentalExtensionPricingSnapshot,
  type RentalOrderActionExecutionBasis, type RentalMembershipBenefitEvaluation } from './core';
import { leafClosed as object, leafEnum as choice, leafRef as ref, leafList as list,
  leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export type AiExtensionPreviewObservationDraft = {
  orderId: string; scope: AiWorkspaceScope; observedAt: string;
  source: { kind: 'core_extension_preview'; orderVersion: string; inputFingerprint: string };
  persistence: 'not_persisted'; inventory: 'not_reserved'; approval: 'not_granted'; execution: 'not_attempted';
  validity: 'observation_only_recheck_in_original_business_flow';
} & ({ status: 'blocked'; reason: 'core_validation_failed'; coreStatus: 400 | 409 }
  | { status: 'previewed'; preview: RentalOrderExtensionPreview });
export interface AiSceneOrderExtensionPreviewResponseDraft {
  original: Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: 'order_explanation' };
  result: AiExtensionPreviewObservationDraft; taskExecution: 'not_started';
}
export const AI_EXTENSION_PREVIEW_HTTP_CONTRACT = Object.freeze({
  request: 'AiSceneOrderExtensionPreviewDraft', response: 'AiSceneOrderExtensionPreviewResponseDraft'
} as const);

const number: AiLeafSchemaDraft = { type: 'number' }, boolean: AiLeafSchemaDraft = { type: 'boolean' };
// Core owns value limits. The existing 128 KiB preview cap bounds these wire
// collections; do not invent a smaller limit that truncates a historical body.
const string = text(131072, 0), strings = list(string, 131072);
const time: AiLeafSchemaDraft = { type: 'string', format: 'date-time', maxLength: 64 };
const numbers: AiLeafSchemaDraft = { type: 'object', additionalProperties: number, maxProperties: 131072 };
const json = ref('AiExtensionSnapshotJson');
const shape = <T>(properties: Record<keyof T & string, AiLeafSchemaDraft>, required: readonly (keyof T & string)[]) => object(properties, required);
const dayType = choice('workday', 'weekend', 'statutory_holiday', 'makeup_workday', 'tenant_special');
const businessStatus = choice('open', 'limited', 'closed', 'self_service');
const calendarSource = choice('week_rule', 'official_cn', 'tenant_override');
const unit = choice(...RENTAL_PRICING_UNIT_CODES), inventory = choice(...Object.values(RentalInventoryMode));
const category = choice(...Object.values(RentalCategoryCode));
const eligibility = list(object({ rule: string, passed: boolean, detail: string }, ['rule', 'passed']), 131072);
const allocations = numbers, target = choice(...RENTAL_DISCOUNT_TARGETS), discountType = choice(...RENTAL_DISCOUNT_TYPES);
const windows = list(object({ start: string, end: string }), 131072);
const hours = object({ windows, pickup: windows, return: windows, delivery: windows }, ['windows']);
const dayBase = { dayType, name: string, pricingMultiplier: number, closed: boolean, businessStatus, source: calendarSource };
const dayRequired = ['dayType', 'name', 'pricingMultiplier', 'closed', 'source'];
const daySnapshot = object({ ...dayBase, hours, pricingOverrideRef: string }, dayRequired);
const terminology = { itemLabel: string, itemGroupLabel: string, assetLabel: string, fulfillmentLabel: string,
  pickupLabel: string, returnLabel: string, deliveryLabel: string, identifierLabel: string, serialLabel: string,
  usageMetricLabel: string, assetCollectionLabel: string, navigationLabels: object({ inventoryGroup: string,
    itemGroups: string, pricingGroups: string, assets: string, locations: string }, []) };
const terminologyRequired = ['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel', 'identifierLabel'];
const attribute = object({ code: string, label: string, scope: choice('item_group', 'asset', 'transaction'),
  type: choice('string', 'number', 'boolean', 'date', 'select'), required: boolean, unique: boolean, unit: string, options: strings }, ['code', 'label', 'scope', 'type']);
const inspectionField = object({ code: string, label: string, type: choice('boolean', 'number', 'text', 'select', 'photo'),
  required: boolean, unit: string, options: strings, usageMetric: boolean }, ['code', 'label', 'type', 'required']);
const chargeLines = list(ref('AiExtensionChargeLineDraft'), 1000);
const common = { orderId: string, scope: ref('AiWorkspaceScope'), observedAt: time,
  source: object({ kind: choice('core_extension_preview'), orderVersion: time,
    inputFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } }),
  persistence: choice('not_persisted'), inventory: choice('not_reserved'), approval: choice('not_granted'),
  execution: choice('not_attempted'), validity: choice('observation_only_recheck_in_original_business_flow') };

export const AI_EXTENSION_PREVIEW_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  // Only Core's explicit attributeSchema extension bag is dynamic JSON; fixed
  // snapshot records below are closed. Consumers must treat schema text as data.
  AiExtensionSnapshotJson: { oneOf: [{ type: 'null' }, boolean, number, string, list(json, 131072),
    { type: 'object', maxProperties: 131072, additionalProperties: json }] },
  AiExtensionCategoryPolicyDraft: shape<RentalCategoryDefinition>({ code: category, name: string, description: string,
    display: object({ nameEn: string, descriptionEn: string, icon: choice(...RENTAL_CATEGORY_ICON_CODES), defaultWorkspaceName: string,
      defaultWorkspaceNameEn: string, terminologyEn: object(terminology, []) }, []),
    supportedInventoryModes: list(inventory, 131072), defaultCapabilities: list(choice(...RENTAL_CAPABILITY_CODES), 131072),
    requiredCapabilities: list(choice(...RENTAL_CAPABILITY_CODES), 131072), terminology: object(terminology, terminologyRequired),
    attributeSchema: { type: 'object', additionalProperties: json, maxProperties: 131072 },
    businessModel: ref('AiExtensionCategoryBusinessDraft'), version: string },
  ['code', 'name', 'description', 'supportedInventoryModes', 'defaultCapabilities', 'requiredCapabilities', 'terminology', 'attributeSchema', 'businessModel', 'version']),
  AiExtensionCategoryBusinessDraft: shape<RentalCategoryBusinessModel>({ pricingUnits: list(unit, 131072), defaultPricingUnit: unit,
    fulfillmentModes: list(choice(...RENTAL_FULFILLMENT_MODES), 131072), locationTypes: list(choice(...RENTAL_LOCATION_TYPES), 131072),
    deliveryDestination: choice('customer_address', 'tenant_location'), settingModules: list(choice('pricing', 'discounts', 'coupons',
      'value_added_services', 'rental_rules', 'business_calendar', 'membership_rewards', 'notification_templates'), 131072),
    assetFields: list(attribute, 131072), catalogPresentation: object({ itemGroupDescription: string, itemGroupCodeLabel: string,
      itemGroupNameLabel: string, itemGroupNamePlaceholder: string, fixedInventoryMode: inventory, fixedUnit: string,
      itemGroupSummaryFields: strings, assetDescription: string, assetSummaryFields: strings }, []),
    supportsHolidayPricing: boolean, supportsUsagePricing: boolean, supportsPreauthorization: boolean, supportsQualificationReview: boolean,
    valueAddedServicePresets: strings, defaults: object({ fulfillment: object({ allowDifferentReturnLocation: boolean }),
      payment: object({ timing: choice('order', 'confirmation', 'pickup', 'offline_terms') }),
      overdue: object({ graceMinutes: number, feeMode: choice('none', 'hourly', 'next_period', 'multiplier', 'manual_review', 'hourly_to_daily'), feeMultiplier: number }),
      rules: object({ evidenceRequired: boolean, cancellation: object({ freeBeforeHours: number,
        lateFeeType: choice('none', 'fixed_amount', 'percentage'), lateFeeValue: number, weatherExceptionEnabled: boolean }), qualificationDocumentTypes: strings }),
      initialSetup: object({ operatorName: string, locationName: string, locationType: choice(...RENTAL_LOCATION_TYPES) }),
      inspectionFields: list(inspectionField, 131072), sampleBaseAmount: number, sampleAmountIncrement: number }) },
  ['pricingUnits', 'defaultPricingUnit', 'fulfillmentModes', 'locationTypes', 'deliveryDestination', 'settingModules', 'assetFields',
    'supportsHolidayPricing', 'supportsUsagePricing', 'supportsPreauthorization', 'supportsQualificationReview', 'valueAddedServicePresets', 'defaults']),
  AiExtensionExecutionBasisDraft: shape<RentalOrderActionExecutionBasis>({ pricingMode: choice('incremental', 'original_total'),
    policySource: choice('current_workspace', 'original_quote'), categoryCode: category, originalCategoryVersionId: string,
    categoryVersionId: string, adoptionRevision: number, categoryPolicySnapshot: ref('AiExtensionCategoryPolicyDraft'),
    incrementalPricing: object({ version: { type: 'integer', enum: [1] }, startAt: time, endAt: time,
      context: object({ dayRates: list(ref('AiExtensionPricingRateDraft'), 131072), timeZone: string,
        legacyDayTypeMultipliers: boolean, calendars: list(ref('AiExtensionCalendarYearDraft'), 131072) },
      ['timeZone', 'legacyDayTypeMultipliers', 'calendars']),
      lines: list(object({ orderLineId: string, itemGroupId: string, pricingGroupId: string, quantity: number, exchangeId: string,
        pricingUnit: unit, amount: number, billableUnits: number, billedHours: number, selectedUnitAmount: number },
      ['itemGroupId', 'quantity', 'pricingUnit', 'amount', 'billableUnits', 'billedHours', 'selectedUnitAmount']), 131072) }, ['version', 'startAt', 'endAt', 'context', 'lines']),
    pricingStrategies: list(object({ unit, implementationVersion: string }), 131072) }, ['pricingMode', 'policySource', 'categoryCode', 'pricingStrategies']),
  AiExtensionChargeLineDraft: object({ code: string, name: string, type: choice('rental', 'calendar_adjustment', 'fulfillment',
    'preauthorization', 'discount', 'coupon', 'service', 'deposit', 'cancellation', 'overdue', 'damage', 'extension', 'early_return_refund', 'order_change'),
    amount: number, sourceId: string, sourceVersion: string, detail: string }, ['code', 'name', 'type', 'amount']),
  AiExtensionCalendarDayDraft: shape<RentalCalendarDay>({ date: string, ...dayBase, hours, pricingOverrideRef: string,
    overrideReason: string, overrideBy: string, overrideAt: string,
    overriddenFrom: object({ ...dayBase, source: choice('week_rule', 'official_cn') }, dayRequired),
    overrideScope: object({ kind: choice('single', 'range'), batchId: string, rangeStart: string, rangeEnd: string,
      startDateTime: string, endDateTime: string }, ['kind', 'batchId', 'rangeStart', 'rangeEnd']) },
  ['date', 'dayType', 'name', 'pricingMultiplier', 'closed', 'source']),
  AiExtensionCalendarYearDraft: shape<RentalCalendarYear>({ tenantId: string, year: number, region: choice('CN', 'NONE'), version: string,
    status: choice('draft', 'published', 'superseded', 'void'), supersededAt: string, publishedBy: string, changeReason: string,
    previousVersion: string, restoredFromVersion: string, restoreReason: string, voidedAt: string, voidedBy: string, voidReason: string,
    publishDiff: object({ added: strings, removed: strings, changed: strings }),
    overrideAudits: list(object({ date: string, action: choice('override', 'revert'), reason: string, operator: string, at: string,
      before: daySnapshot, after: daySnapshot, year: number, version: string, batchId: string }, ['date', 'action', 'reason', 'at', 'after']), 131072),
    sourceName: string, sourceUrl: string, sourcePublishedAt: string, importedAt: string, sourceVersionId: string, sourceVersion: string,
    officialSourceUpdateAvailable: boolean, officialSourceAvailableToSelect: boolean, availableOfficialSourceCount: number,
    officialSourceRegisteredButUnavailable: boolean, latestOfficialSourceVersionId: string, latestOfficialSourceVersion: string,
    importPreservedOverrides: strings, publishedAt: string, revision: number, days: list(ref('AiExtensionCalendarDayDraft'), 131072) },
  ['tenantId', 'year', 'region', 'version', 'status', 'days']),
  AiExtensionPricingRateDraft: shape<RentalPricingRate>({ id: string, pricingGroupId: string, pricingGroupCode: string, pricingGroupName: string,
    itemGroupId: string, itemGroupCode: string, itemGroupName: string, unit, baseAmount: number, weekendMultiplier: number, holidayMultiplier: number,
    depositAmount: number, minimumUnits: number, includedUsage: number, excessUsageAmount: number, usagePrecision: { type: 'number', enum: [0, 1, 2] },
    tierMode: choice('whole_order', 'progressive'), tiers: list(object({ minUnits: number, unitAmount: number }), 131072), maxAmount: number,
    depositMultiple: number, preAuthAmount: number, preAuthMultiple: number, hourGranularityMinutes: number,
    dayTypePrices: object({ workday: number, weekend: number, statutory_holiday: number, makeup_workday: number, tenant_special: number }, []),
    periodicWindows: list(object({ fromWeekday: number, fromTime: string, toWeekday: number, toTime: string, multiplier: number }), 131072),
    datetimeOverrides: list(object({ id: string, start: string, end: string, multiplier: number }, ['start', 'end', 'multiplier']), 131072) },
  ['id', 'itemGroupId', 'itemGroupCode', 'itemGroupName', 'unit', 'baseAmount', 'weekendMultiplier', 'holidayMultiplier', 'depositAmount', 'minimumUnits']),
  AiExtensionServiceSnapshotDraft: shape<RentalQuoteServiceSnapshot>({ serviceId: string, serviceCode: string, serviceName: string,
    serviceType: choice('insurance', 'damage_waiver', 'delivery', 'consumable', 'operator', 'support', 'other'), serviceVersion: string, workspaceId: string,
    billingUnit: choice(...RENTAL_SERVICE_BILLING_UNITS), selectionMode: choice(...RENTAL_SERVICE_SELECTION_MODES), requiredByRule: boolean,
    mandatoryRuleHit: string, unitPrice: number, quantity: number, billingUnits: number, amount: number, formula: string, coverageLimit: number,
    deductible: number, applicableItemGroupIds: strings, termsVersion: string, terms: string, eligibility,
    insuredDisplayable: { type: 'boolean', const: false }, insuranceProviderStatus: choice(...RENTAL_INSURANCE_PROVIDER_STATUSES), insuranceProviderName: string,
    requiresCapacity: boolean, scheduledStartAt: string, scheduledEndAt: string, serviceLocationId: string, capacityQuantity: number,
    discountAllocatedAmount: number, couponAllocatedAmount: number }, ['serviceId', 'serviceCode', 'serviceName', 'serviceType', 'serviceVersion', 'workspaceId',
    'billingUnit', 'selectionMode', 'requiredByRule', 'unitPrice', 'quantity', 'billingUnits', 'amount', 'formula', 'termsVersion', 'terms', 'eligibility',
    'insuredDisplayable', 'requiresCapacity', 'scheduledStartAt', 'scheduledEndAt', 'serviceLocationId', 'capacityQuantity']),
  AiExtensionDiscountPlanDraft: object({ id: string, tenantId: string, categoryCode: category, code: string, name: string,
    status: choice('draft', 'enabled', 'disabled'), discountType, discountValue: number, minimumSpend: number, thresholdAmount: number,
    maximumDiscount: number, appliesTo: target, customerScope: choice('all', 'personal', 'corporate', 'member'), applicableItemGroupIds: strings,
    applicablePricingGroupIds: strings, applicableDayTypes: list(dayType, 131072), priority: number, exclusiveGroup: string,
    stackableWithOtherPlans: boolean, stackableWithCoupon: boolean, effectiveFrom: string, effectiveTo: string, version: string, createdAt: string, updatedAt: string },
  ['id', 'tenantId', 'categoryCode', 'code', 'name', 'status', 'discountType', 'discountValue', 'minimumSpend', 'appliesTo', 'customerScope',
    'applicableItemGroupIds', 'applicableDayTypes', 'priority', 'stackableWithOtherPlans', 'stackableWithCoupon', 'effectiveFrom', 'version', 'createdAt', 'updatedAt']),
  AiExtensionDiscountEvaluationDraft: shape<RentalQuoteDiscountEvaluation>({ planSnapshot: ref('AiExtensionDiscountPlanDraft'), planId: string,
    planCode: string, planName: string, planVersion: string, workspaceId: string, appliesTo: target, discountType, priority: number, exclusiveGroup: string,
    stackableWithOtherPlans: boolean, stackableWithCoupon: boolean, applied: boolean, skipReason: choice(...RENTAL_DISCOUNT_SKIP_REASONS), skipDetail: string,
    eligibility, grossAmount: number, base: number, formula: string, candidateAmount: number, discountAmount: number,
    rentalAllocations: allocations, maximumDiscount: number, capped: boolean }, ['planId', 'planCode', 'planName', 'planVersion', 'workspaceId', 'appliesTo',
    'discountType', 'priority', 'stackableWithOtherPlans', 'stackableWithCoupon', 'applied', 'eligibility', 'grossAmount', 'base', 'formula', 'candidateAmount', 'discountAmount', 'capped']),
  AiExtensionCouponEvaluationDraft: shape<RentalQuoteCouponEvaluation>({ couponId: string, templateId: string, templateCode: string, templateName: string,
    templateVersion: string, appliesTo: target, discountType: choice('percentage', 'fixed_amount'), discountValue: number, minimumSpend: number,
    maximumDiscount: number, stackableWithDiscountPlans: boolean, checkedAt: string, rentalStartAt: string, applicableRentalFrom: string, applicableRentalTo: string,
    baseBeforeDiscount: number, runningBase: number, formula: string, discountAmount: number, rentalAllocations: allocations, serviceAllocations: allocations },
  ['couponId', 'templateId', 'templateCode', 'templateName', 'templateVersion', 'appliesTo', 'discountType', 'discountValue', 'minimumSpend',
    'stackableWithDiscountPlans', 'checkedAt', 'rentalStartAt', 'baseBeforeDiscount', 'runningBase', 'formula', 'discountAmount']),
  AiExtensionMembershipBenefitDraft: shape<RentalMembershipBenefitEvaluation>({ applicableServiceIds: strings,
    scope: { oneOf: [object({ type: choice('tenant') }), object({ type: choice('workspaces'), workspaceIds: strings }),
      object({ type: choice('categories'), categoryCodes: list(category, 131072) })] }, scopeMatched: boolean,
    source: choice('personal', 'corporate'), planId: string, planVersionId: string, planName: string,
    type: choice('rental_discount', 'deposit_reduction', 'preauth_reduction', 'service_benefit', 'priority_reservation', 'quote_validity_extension'),
    calculation: choice('percentage', 'amount', 'quota', 'priority'), configuredValue: number,
    appliesTo: choice('rental', 'service', 'deposit', 'preauthorization', 'quote_validity', 'priority'),
    appliedAmount: number, base: number, configuredMaximum: number, allocations, skippedReason: string, detail: string,
    securityRiskLevels: list(choice('low', 'standard', 'high', 'unclassified'), 131072),
    securityRiskAssessments: list(object({ itemGroupId: string, pricingGroupId: string,
      riskLevel: choice('low', 'standard', 'high', 'unclassified'), allowed: boolean, quantity: number }, ['riskLevel', 'allowed', 'quantity']), 131072),
    securityRiskCheck: choice('not_enabled', 'not_checked', 'clear', 'open_risk', 'unavailable'),
    securityPolicySnapshot: object({ enabled: boolean, allowedRiskLevels: list(choice('low', 'standard', 'high'), 131072),
      maxReductionPercent: number, maxReductionAmount: number }, ['enabled']), securityOriginalAmount: number, securityEligibleBase: number },
  ['source', 'planId', 'planVersionId', 'planName', 'type', 'calculation', 'configuredValue', 'appliesTo', 'appliedAmount', 'detail']),
  AiExtensionPricingSnapshotDraft: shape<RentalExtensionPricingSnapshot>({ method: choice('original_version_difference'), scope: choice('order', 'exchange_line'), fullChargeLines: list(ref('AiExtensionChargeLineDraft'), 131072),
    context: object({ dayRates: list(ref('AiExtensionPricingRateDraft'), 131072), timeZone: string, legacyDayTypeMultipliers: boolean,
      calendars: list(ref('AiExtensionCalendarYearDraft'), 131072) }, ['timeZone', 'legacyDayTypeMultipliers', 'calendars']),
    previousPayableAmount: number, recalculatedPayableAmount: number, recalculatedRentalAmount: number, recalculatedServiceAmount: number,
    recalculatedDiscountAmount: number, membershipBenefitEvaluations: list(ref('AiExtensionMembershipBenefitDraft'), 131072),
    recalculatedCouponAmount: number, totalBillableUnits: number, differenceAmount: number,
    discountEvaluations: list(ref('AiExtensionDiscountEvaluationDraft'), 131072), couponEvaluation: ref('AiExtensionCouponEvaluationDraft'),
    chargeLines: list(ref('AiExtensionChargeLineDraft'), 131072),
    refundReview: object({ amount: number, status: choice('pending', 'approved', 'rejected', 'superseded'), reason: string, reviewedBy: string, reviewedAt: string }, ['amount', 'status']) },
  ['method', 'fullChargeLines', 'context', 'previousPayableAmount', 'recalculatedPayableAmount', 'recalculatedRentalAmount', 'recalculatedServiceAmount',
    'recalculatedDiscountAmount', 'recalculatedCouponAmount', 'totalBillableUnits', 'differenceAmount', 'discountEvaluations', 'chargeLines']),
  AiCoreExtensionPreviewDraft: shape<RentalOrderExtensionPreview>({ orderId: string, originalEndAt: time, newEndAt: time,
    billableUnits: { type: 'number', minimum: 0 }, rentalAmount: number, serviceAmount: number, depositDelta: number, preAuthDelta: number, payableAmount: number,
    currency: { type: 'string', pattern: '^[A-Z]{3}$' }, settlementMode: choice('immediate', 'monthly'), paymentRequired: boolean, chargeLines,
    calendarSnapshot: list(object({ date: string, year: number, dayType, businessStatus, source: calendarSource, calendarVersion: string,
      itemGroupId: string, itemGroupCode: string, unitCount: number, unitAmount: number, multiplier: number, amount: number,
      priceAt: string, hitLayer: choice('date_override', 'periodic', 'day_type', 'day_type_legacy', 'base'), pricingPlanVersion: string },
    ['date', 'year', 'dayType', 'businessStatus', 'source', 'calendarVersion', 'itemGroupId', 'itemGroupCode', 'unitCount', 'unitAmount', 'multiplier', 'amount']), 1000),
    serviceSnapshots: list(ref('AiExtensionServiceSnapshotDraft'), 131072), priceVersionId: string, priceVersion: string, ruleVersion: text(191),
    executionBasis: ref('AiExtensionExecutionBasisDraft'), pricingSnapshot: ref('AiExtensionPricingSnapshotDraft') },
  ['orderId', 'originalEndAt', 'newEndAt', 'billableUnits', 'rentalAmount', 'serviceAmount', 'depositDelta', 'preAuthDelta', 'payableAmount',
    'currency', 'settlementMode', 'paymentRequired', 'chargeLines', 'calendarSnapshot', 'ruleVersion']),
  AiExtensionPreviewObservationDraft: { oneOf: [object({ ...common, status: choice('blocked'), reason: choice('core_validation_failed'),
    coreStatus: { type: 'integer', enum: [400, 409] } }), object({ ...common, status: choice('previewed'), preview: ref('AiCoreExtensionPreviewDraft') })] },
  AiSceneOrderExtensionPreviewResponseDraft: object({ original: ref('AiSceneRequestReceiptDraft'),
    result: ref('AiExtensionPreviewObservationDraft'), taskExecution: choice('not_started') })
};
