import type { RentalCategoryDefinition, RentalCapability, RentalCapabilityConfig, RentalInventoryMode, RentalPricingUnit, RentalFulfillmentMode } from "./core";
import type { SubscriptionServiceStatus } from "./subscription";

export const CATEGORY_GOVERNANCE_PERMISSIONS = {
  view: "system:rental-category:view", edit: "system:rental-category:edit",
  publish: "system:rental-category:publish", opening: "system:rental-category:opening",
  audit: "system:rental-category:audit"
} as const;
export const CATEGORY_DRAFT_SECTIONS = ["basic", "attributes", "inventory", "pricing", "inspection", "capabilities"] as const;
export type CategoryDraftSection = typeof CATEGORY_DRAFT_SECTIONS[number];
export interface CategoryDefinitionDifference {
  section: CategoryDraftSection;
  path: string;
  label: string;
  kind: "added" | "removed" | "changed" | "required_added" | "unique_enabled" | "type_changed" | "scope_narrowed";
  before: unknown;
  after: unknown;
}
export type CategoryAdoptionScope = "all" | "pilot" | "none";
export interface CategoryEntityPreparationPatch {
  entityType: "item_group" | "asset";
  entityId: string;
  expectedUpdatedAt: string;
  values: Record<string, string | number | boolean>;
}
export interface SaveCategoryPreparationRequest {
  expectedSourceVersionId: string;
  expectedSourceRevision: number;
  expectedPreparationRevision: number;
  operation: "upgrade" | "restore";
  patches: CategoryEntityPreparationPatch[];
  capabilityPatches?: CategoryCapabilityPreparationPatch[];
  reason: string;
}
/** Request/collection safety limits, not a claim about measured database throughput. */
export const CATEGORY_PREPARATION_LIMITS = {
  batchEntities: 1000,
  batchBytes: 256 * 1024,
  collectionEntities: 10000,
  collectionBytes: 2 * 1024 * 1024
} as const;
/** Final transaction bounds; production capacity still requires database evidence. */
export const CATEGORY_ADOPTION_LIMITS = {
  entities: 10000, configurationRowsPerDomain: 10000, configurationRows: 50000,
  candidateBytes: 16 * 1024 * 1024
} as const;
export interface AdoptRentalCategoryRequest {
  expectedSourceVersionId: string;
  expectedSourceRevision: number;
  expectedPreparationRevision: number;
  expectedTargetPolicyRevision: number;
  operation: "upgrade" | "restore";
  idempotencyKey: string;
  reason: string;
}
export interface CategoryAdoptionResult {
  outcome: "adopted";
  operation: "upgrade" | "restore";
  categoryCode: string;
  sourceVersionId: string;
  sourceRevision: number;
  targetVersionId: string;
  adoptionRevision: number;
  preparationRevision: number;
  targetPolicyRevision: number;
  auditId: string;
  adoptedAt: string;
}
export type CategoryAdoptionReceipt = { outcome: "adopted"; result: CategoryAdoptionResult } | { outcome: "unknown" };
/** Explicitly withdraw staged values; omission never removes another batch's input. */
export interface CategoryEntityPreparationRemoval {
  entityType: "item_group" | "asset";
  entityId: string;
  /** Omit to withdraw this entity's entire staged patch. */
  fieldCodes?: string[];
}
export interface SaveCategoryPreparationBatchRequest extends SaveCategoryPreparationRequest {
  batchId: string;
  removals?: CategoryEntityPreparationRemoval[];
  removeCapabilityCodes?: RentalCapability[];
  /** Explicitly discard staged inputs before applying this batch; active facts are untouched. */
  resetPreparation?: boolean;
}
export interface CategoryPreparationSaveResult {
  id: string;
  revision: number;
  sourceRevision: number;
  targetVersionId: string;
  preparedOnly: true;
  adoptionImplemented: boolean;
  batchId?: string;
  entityCount?: number;
  replayed?: boolean;
}
export type CategoryPreparationBatchReadResult =
  | { outcome: "saved"; result: CategoryPreparationSaveResult }
  | { outcome: "unknown" };
export interface CategoryPreparationEntitiesQuery {
  operation?: "upgrade" | "restore";
  entityType: "item_group" | "asset";
  /** Scoped exact lookup for existing configuration references. */
  entityId?: string;
  after?: string;
  limit?: number;
  search?: string;
}
export interface CategoryPreparationEntityView {
  id: string;
  updatedAt: string;
  attributes: Record<string, unknown>;
  name?: string;
  assetNo?: string;
  serialNo?: string | null;
  prepared?: CategoryEntityPreparationPatch;
  preparationStale: boolean;
}
export interface CategoryPreparationEntityPage {
  entityType: "item_group" | "asset";
  sourceVersionId: string;
  sourceRevision: number;
  preparationRevision: number;
  total: number;
  rows: CategoryPreparationEntityView[];
  nextCursor?: string;
}
/** Explicit candidate intent, never an immediate activation. enable_new is
 * restricted to an absent target-required or condition-declared instance and its registered current
 * implementation; existing paused/disabled instances need their own lifecycle. */
export interface CategoryCapabilityPreparationPatch {
  intent?: "configure" | "enable_new";
  code: RentalCapability;
  expectedRevision: number;
  expectedImplementationVersion: string;
  config: RentalCapabilityConfig;
}

export type CategoryPreparationOperation = "upgrade" | "restore";
export interface CategoryPreparationEntity {
  id: string; updatedAt: string; attributes: Record<string, unknown>;
  name?: string; assetNo?: string; serialNo?: string | null;
}
export interface CategoryConditionalCapabilityReadiness {
  required: RentalCapability[];
  matches: Array<{ code: RentalCapability; fulfillmentMode: RentalFulfillmentMode; itemGroupIds: string[] }>;
  checkedItemGroupCount: number;
}
/** Operator-only current-space preview. These facts never authorize adoption or
 * replace historical quote/order/inspection snapshots. */
export interface CategoryPreparationPreview {
  sourceVersionId: string; sourceRevision: number; targetVersionId: string; targetVersionLabel: string;
  targetPolicyRevision?: number;
  targetDefinition: RentalCategoryDefinition; differences: CategoryDefinitionDifference[];
  registeredCapabilityVersions?: string[];
  preparation: { id?: string; revision: number; sourceRevision?: number; formatVersion?: number; entityCount?: number;
    patches: { sourceVersionId?: string; operation?: CategoryPreparationOperation; reason?: string;
      items?: CategoryEntityPreparationPatch[]; capabilityPatches?: CategoryCapabilityPreparationPatch[] } } | null;
  metadataOnly?: boolean; previewOnly?: boolean; preparationLimits?: typeof CATEGORY_PREPARATION_LIMITS;
  validation: { valid: boolean; errors: string[] }; stale: boolean; adoptionImplemented: boolean;
  businessCompatibility: { valid: boolean; complete: boolean; blockers: Array<{ domain: string; id: string; message: string }>;
    requiredCapabilityCodes?: RentalCapability[]; conditionalReadiness?: CategoryConditionalCapabilityReadiness };
  commercialContext: { serviceStatus: SubscriptionServiceStatus; revision: number; newBusinessAllowed: boolean;
    entitlements: Array<{ code: string; categories: string[]; available: boolean }>; complete: false; scope: string };
  entities: { itemGroups: CategoryPreparationEntity[]; assets: CategoryPreparationEntity[];
    capabilities?: Array<{ code: RentalCapability; status: string; revision: number; implementationVersion: string; configVersion: string; config: RentalCapabilityConfig }> };
}
export interface CreateCategoryDraftRequest { sourceVersionId: string; versionLabel: string; reason: string }
export const RENTAL_CATEGORY_TEMPLATE_IDS = ["serialized", "quantity", "kit"] as const;
export interface PreviewRentalCategoryCreationRequest {
  code: string;
  name: string;
  templateId?: typeof RENTAL_CATEGORY_TEMPLATE_IDS[number];
  sourceVersionId?: string;
  versionLabel: string;
  inventoryModes: RentalInventoryMode[];
  pricingUnits: RentalPricingUnit[];
  defaultPricingUnit: RentalPricingUnit;
  fulfillmentModes: RentalFulfillmentMode[];
  capabilityCodes: RentalCapability[];
}
export interface CreateRentalCategoryRequest extends PreviewRentalCategoryCreationRequest {
  expectedDefinitionHash: string;
  idempotencyKey: string;
  reason: string;
}
export interface RentalCategoryCreationPreview {
  valid: boolean;
  errors: string[];
  definition: RentalCategoryDefinition;
  definitionHash: string;
  removedCapabilities: RentalCapability[];
  previewOnly: true;
}
export type RentalCategoryCreationReceipt = { outcome: "created"; version: CategoryVersionView } | { outcome: "unknown" };
export interface RentalCategoryOpeningOptionsQuery { tenantId?: string; search?: string }
export interface RentalCategoryIdentityLabel { code: string; name: string }
export interface RentalCategoryOpeningOption {
  categoryCode: string;
  name: string;
  nameEn?: string;
  versionId?: string;
  versionLabel?: string;
  recommended: boolean;
  defaultWorkspaceName: string;
}
export interface RentalCategoryOpeningOptions {
  structureVersion: 1;
  source: "published" | "builtin_demo";
  options: RentalCategoryOpeningOption[];
  truncated: boolean;
}
export interface PatchCategoryDraftRequest { expectedRevision: number; values: Record<string, unknown>; reason: string }
export interface PublishCategoryDraftRequest { expectedRevision: number; idempotencyKey: string; reason: string }
export interface ArchiveCategoryDraftRequest { expectedRevision: number; reason: string }
export interface SaveCategoryOpeningRequest {
  expectedRevision: number; scope: "all" | "pilot" | "unopened" | "stopped";
  tenantIds: string[]; recommendedVersionId?: string; reason: string;
}
export interface SaveCategoryVersionPolicyRequest {
  expectedRevision: number; createScope: CategoryAdoptionScope; createTenantIds: string[];
  upgradeScope: CategoryAdoptionScope; upgradeTenantIds: string[];
  restoreScope: CategoryAdoptionScope; restoreTenantIds: string[]; reason: string;
}
export interface CategoryVersionView {
  id: string; categoryCode: string; versionLabel: string; structureVersion: number;
  status: string; revision: number; definition: RentalCategoryDefinition;
  sourceVersionId?: string | null; publishedAt?: string | null;
  policy?: { createScope: string; createTenantIds: string[]; upgradeScope: string; upgradeTenantIds: string[];
    restoreScope: string; restoreTenantIds: string[]; revision: number } | null;
}
