import type { RentalCategoryDefinition, RentalCapability, RentalCapabilityConfig } from "./core";

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
/** Full replacement of an existing enabled instance's config only. No activation
 * or implementation switch is implied by preparing a category version. */
export interface CategoryCapabilityPreparationPatch {
  code: RentalCapability;
  expectedRevision: number;
  expectedImplementationVersion: string;
  config: RentalCapabilityConfig;
}
export interface CreateCategoryDraftRequest { sourceVersionId: string; versionLabel: string; reason: string }
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
