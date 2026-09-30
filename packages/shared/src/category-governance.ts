import type { RentalCategoryDefinition } from "./core";

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
