import type { CategoryCapabilityPreparationPatch, CategoryDefinitionDifference, CategoryEntityPreparationPatch, RentalCapability, RentalCapabilityConfig, RentalCategoryDefinition, SaveCategoryPreparationRequest, SubscriptionServiceStatus } from "@rental-os/shared";
import { request } from "./http";
export type CategoryPreparationOperation = "upgrade" | "restore";
export interface CategoryPreparationEntity { id: string; updatedAt: string; attributes: Record<string, unknown>; name?: string; assetNo?: string; serialNo?: string | null }
export interface CategoryPreparationPreview {
  sourceVersionId: string; sourceRevision: number; targetVersionId: string; targetVersionLabel: string;
  targetDefinition: RentalCategoryDefinition; differences: CategoryDefinitionDifference[];
  preparation: { revision: number; patches: { operation?: CategoryPreparationOperation; reason?: string; items?: CategoryEntityPreparationPatch[]; capabilityPatches?: CategoryCapabilityPreparationPatch[] } } | null;
  validation: { valid: boolean; errors: string[] }; stale: boolean; adoptionImplemented: boolean;
  businessCompatibility: { valid: boolean; complete: boolean; blockers: Array<{ domain: string; id: string; message: string }> };
  commercialContext: { serviceStatus: SubscriptionServiceStatus; revision: number; newBusinessAllowed: boolean; entitlements: Array<{ code: string; categories: string[]; available: boolean }>; complete: false; scope: string };
  entities: { itemGroups: CategoryPreparationEntity[]; assets: CategoryPreparationEntity[]; capabilities?: Array<{ code: RentalCapability; status: string; revision: number; implementationVersion: string; configVersion: string; config: RentalCapabilityConfig }> };
}
export const categoryPreparationApi = {
  candidates: (operation: CategoryPreparationOperation) => request<{ sourceVersionId: string; sourceRevision: number; versions: Array<{ id: string; versionLabel: string; definitionExecutable: boolean; unavailableReason?: string }> }>("/rental/v1/category-adoption/candidates", { params: { operation } }),
  preview: (id: string, operation: CategoryPreparationOperation) => request<CategoryPreparationPreview>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation`, { params: { operation } }),
  save: (id: string, data: SaveCategoryPreparationRequest) => request<{ revision: number; preparedOnly: boolean; adoptionImplemented: boolean }>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation`, { method: "put", data })
};
