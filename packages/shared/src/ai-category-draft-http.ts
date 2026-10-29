/** Human CAT-GOV draft transport, not a new governance model. Mutable draft
 * sections intentionally carry JSON data which may fail the original publish
 * validator. A readable/saved draft is not an executable category definition. */
import { CATEGORY_DRAFT_SECTIONS, type CategoryDraftSection, type CreateCategoryDraftRequest,
  type PatchCategoryDraftRequest, type CategoryDefinitionDifference } from './category-governance';
import { RENTAL_CATEGORY_DEFINITIONS } from './core';
import { leafClosed as object, leafEnum as choice, leafInt as integer, leafList as list,
  leafRef as ref, leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export type AiCategoryDraftJson = string | number | boolean | null | AiCategoryDraftJson[] | { [key: string]: AiCategoryDraftJson };
export interface AiCategoryVersionWire {
  id: string; categoryCode: string; versionLabel: string; structureVersion: number; sourceVersionId: string | null;
  sourceKind: string; status: 'draft' | 'published' | 'legacy_baseline' | 'archived'; revision: number;
  definition: { [key: string]: AiCategoryDraftJson }; dependencyDigest: AiCategoryDraftJson;
  publishedAt: string | null; publishedBy: string | null; publishReason: string | null; createdAt: string; updatedAt: string;
  policy?: { versionId: string; createScope: 'all' | 'pilot' | 'none'; createTenantIds: string[] | null;
    upgradeScope: 'all' | 'pilot' | 'none'; upgradeTenantIds: string[] | null;
    restoreScope: 'all' | 'pilot' | 'none'; restoreTenantIds: string[] | null; revision: number; updatedAt: string } | null;
}
export type AiCategoryValidationWire = { valid: true; errors: []; dependencyDigest: {
  capabilities: Array<{ code: string; implementationVersion: string }>;
  pricingStrategies: Array<{ unit: string; implementationVersion: string }>; structureVersion: 1;
} } | { valid: false; errors: string[]; dependencyDigest: null };
export interface AiCategoryDraftHttpRequests {
  detail: { code: string }; create: { code: string; body: CreateCategoryDraftRequest };
  patch: { code: string; versionId: string; section: CategoryDraftSection; body: PatchCategoryDraftRequest };
  validate: { code: string; versionId: string }; review: { code: string; versionId: string };
}
export interface AiCategoryDraftHttpResponses {
  detail: { code: string; name: string; openingScope: 'all' | 'pilot' | 'unopened' | 'stopped'; openingTenantIds: string[] | null;
    openingRevision: number; recommendedVersionId: string | null; versions: AiCategoryVersionWire[] };
  create: AiCategoryVersionWire; patch: AiCategoryVersionWire; validate: AiCategoryValidationWire;
  review: { review: AiCategoryValidationWire & { previewOnly: true; revision: number; sourceVersionId: string | null;
    differences: Array<Omit<CategoryDefinitionDifference, 'before' | 'after'> & { before: AiCategoryDraftJson; after: AiCategoryDraftJson }>;
    changedSections: CategoryDraftSection[]; itemFields: AiCategoryDraftJson; inspectionFields: AiCategoryDraftJson; affectedSpaces: number };
    publication: 'unavailable'; adoption: 'unavailable'; semantics: 'draft_review_not_approval_publication_or_adoption' };
}
export const AI_CATEGORY_DRAFT_HTTP_CONTRACTS = Object.freeze({
  detail: { request: 'AiCategoryDetailRequest', response: 'AiCategoryDetailResponse', write: false },
  create: { request: 'AiCategoryCreateRequest', response: 'AiCategoryVersionWire', write: true },
  patch: { request: 'AiCategoryPatchRequest', response: 'AiCategoryVersionWire', write: true },
  validate: { request: 'AiCategoryVersionRequest', response: 'AiCategoryValidationWire', write: false },
  review: { request: 'AiCategoryVersionRequest', response: 'AiCategoryReviewResponse', write: false },
} as const);
const id = { ...text(191), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }, date: AiLeafSchemaDraft = { type: 'string', format: 'date-time' };
const nil: AiLeafSchemaDraft = { type: 'null' }, json = ref('AiCategoryDraftJson');
const nullable = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [value, nil] });
const code = choice(...RENTAL_CATEGORY_DEFINITIONS.map(row => row.code)), revision = integer(0, 2147483647);
const reason = { ...text(512), pattern: '\\S' };
const versionLabel = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' };
// Values are provisional under a fixed owned section, not a second definition validator.
const sections = {
  basic: ['name', 'description', 'terminology', 'display'], attributes: ['attributeSchema', 'assetFields', 'catalogPresentation'],
  inventory: ['supportedInventoryModes', 'fulfillmentModes', 'locationTypes', 'deliveryDestination'],
  pricing: ['pricingUnits', 'defaultPricingUnit', 'settingModules', 'supportsHolidayPricing', 'supportsUsagePricing', 'supportsPreauthorization', 'payment', 'overdue', 'fulfillment'],
  inspection: ['supportsQualificationReview', 'rules', 'inspectionFields'], capabilities: ['defaultCapabilities', 'requiredCapabilities', 'valueAddedServicePresets'],
} satisfies Record<CategoryDraftSection, string[]>;
const dependency = object({ capabilities: list(object({ code: text(191), implementationVersion: text(191) }), 1000),
  pricingStrategies: list(object({ unit: text(191), implementationVersion: text(191) }), 1000), structureVersion: { type: 'integer', const: 1 } });
const valid = { valid: { type: 'boolean', const: true }, errors: list(text(262144), 0), dependencyDigest: dependency };
const invalid = { valid: { type: 'boolean', const: false }, errors: list(text(262144), 1, 1), dependencyDigest: nil };
const preview = { previewOnly: { type: 'boolean', const: true }, revision, sourceVersionId: nullable(id),
  differences: list(object({ section: choice(...CATEGORY_DRAFT_SECTIONS), path: text(262144), label: text(262144),
    kind: choice('added', 'removed', 'changed', 'required_added', 'unique_enabled', 'type_changed', 'scope_narrowed'), before: json, after: json }), 262144),
  changedSections: { ...list(choice(...CATEGORY_DRAFT_SECTIONS), 6), uniqueItems: true }, itemFields: json, inspectionFields: json,
  affectedSpaces: integer(0, Number.MAX_SAFE_INTEGER) };
const tenantIds = nullable(list(id, 200)), policyScope = choice('all', 'pilot', 'none');
const definitionKeys = ['code', 'name', 'description', 'supportedInventoryModes', 'defaultCapabilities', 'requiredCapabilities', 'terminology', 'attributeSchema', 'businessModel', 'version', 'display'];
export const AI_CATEGORY_DRAFT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiCategoryDraftJson: { oneOf: [nil, { type: 'boolean' }, { type: 'number' }, text(1048576, 0),
    list(json, 262144), { type: 'object', maxProperties: 262144, additionalProperties: json }] },
  AiCategoryDetailRequest: object({ code }),
  AiCategoryVersionRequest: object({ code, versionId: id }),
  AiCategoryCreateRequest: object({ code, body: object({ sourceVersionId: { ...text(191), pattern: '\\S' }, versionLabel, reason }) }),
  AiCategoryPatchRequest: { oneOf: CATEGORY_DRAFT_SECTIONS.map(section => object({ code, versionId: id, section: choice(section),
    body: object({ expectedRevision: revision, values: { ...object(Object.fromEntries(sections[section].map(key => [key, json])), []), minProperties: 1 }, reason }) })) },
  AiCategoryVersionWire: object({ id, categoryCode: choice(...RENTAL_CATEGORY_DEFINITIONS.flatMap(row => [row.code, row.code.toUpperCase()])),
    versionLabel: text(64), structureVersion: integer(1), sourceVersionId: nullable(id), sourceKind: text(32),
    status: choice('draft', 'published', 'legacy_baseline', 'archived'), revision,
    definition: object(Object.fromEntries(definitionKeys.map(key => [key, json])), definitionKeys.filter(key => key !== 'display')),
    dependencyDigest: json, publishedAt: nullable(date), publishedBy: nullable(id), publishReason: nullable(text(512, 0)), createdAt: date, updatedAt: date,
    policy: nullable(object({ versionId: id, createScope: policyScope, createTenantIds: tenantIds, upgradeScope: policyScope,
      upgradeTenantIds: tenantIds, restoreScope: policyScope, restoreTenantIds: tenantIds, revision, updatedAt: date })) },
    ['id', 'categoryCode', 'versionLabel', 'structureVersion', 'sourceVersionId', 'sourceKind', 'status', 'revision', 'definition',
      'dependencyDigest', 'publishedAt', 'publishedBy', 'publishReason', 'createdAt', 'updatedAt']),
  AiCategoryDetailResponse: object({ code, name: text(262144, 0), openingScope: choice('all', 'pilot', 'unopened', 'stopped'),
    openingTenantIds: tenantIds, openingRevision: revision, recommendedVersionId: nullable(id), versions: list(ref('AiCategoryVersionWire'), 100) }),
  AiCategoryValidationWire: { oneOf: [object(valid), object(invalid)] },
  AiCategoryReviewResponse: object({ review: { oneOf: [object({ ...valid, ...preview }), object({ ...invalid, ...preview })] },
    publication: choice('unavailable'), adoption: choice('unavailable'), semantics: choice('draft_review_not_approval_publication_or_adoption') }),
};
