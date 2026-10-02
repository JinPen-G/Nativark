import { request } from "./http";
import type { CreateCategoryDraftRequest, CategoryVersionView, CategoryDraftSection, PatchCategoryDraftRequest, SaveCategoryOpeningRequest, SaveCategoryVersionPolicyRequest, RentalCapabilityModuleDefinition, CategoryDefinitionDifference } from "@rental-os/shared";

export interface CategoryGovernanceSummary {
  code: string; name: string; nameEn?: string; icon?: string; openingScope: string; openingRevision: number;
  recommendedVersionId: string | null;
  recommendedVersionLabel?: string | null;
  latestPublished: { id: string; versionLabel: string } | null;
  drafts: Array<{ id: string; versionLabel: string }>;
  adoptedSpaces: number; adoptedTenants: number;
}
export interface CategoryGovernanceDetail {
  code: string; name: string; openingScope: string; openingRevision: number;
  recommendedVersionId: string | null; versions: CategoryVersionView[];
  openingTenantIds: string[];
}
export const categoryGovernanceApi = {
  list: () => request<CategoryGovernanceSummary[]>("/platform/rental-categories"),
  tenantDirectory: () => request<Array<{ id: string; code: string; name: string }>>("/platform/rental-categories/tenant-directory"),
  detail: (code: string) => request<CategoryGovernanceDetail>(`/platform/rental-categories/${encodeURIComponent(code)}`),
  createDraft: (code: string, data: CreateCategoryDraftRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/drafts`, { method: "post", data }),
  patch: (code: string, id: string, section: CategoryDraftSection, data: PatchCategoryDraftRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/sections/${section}`, { method: "patch", data }),
  validate: (code: string, id: string) => request<{ valid: boolean; errors: string[] }>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/validate`, { method: "post" }),
  preview: (code: string, id: string) => request<{ valid: boolean; errors: string[]; changedSections: CategoryDraftSection[]; differences: CategoryDefinitionDifference[]; affectedSpaces: number; revision: number }>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/preview`),
  publish: (code: string, id: string, data: { expectedRevision: number; idempotencyKey: string; reason: string }) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/publish`, { method: "post", data }),
  opening: (code: string, data: SaveCategoryOpeningRequest) => request<unknown>(`/platform/rental-categories/${encodeURIComponent(code)}/opening-policy`, { method: "put", data }),
  policy: (code: string, id: string, data: SaveCategoryVersionPolicyRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/adoption-policy`, { method: "put", data }),
  audits: (code: string) => request<Array<{ id: string; versionId?: string; action: string; actorId: string; reason: string; createdAt: string }>>(`/platform/rental-categories/${encodeURIComponent(code)}/audits`),
  catalog: () => request<{ dynamicCreationEnabled: boolean; capabilities: Array<RentalCapabilityModuleDefinition & { implemented: boolean }>; pricingStrategies: Array<{ code: string; implementationVersion: string }> }>("/platform/rental-categories/capability-catalog")
};
