import type { AdoptRentalCategoryRequest, CategoryAdoptionReceipt, CategoryAdoptionResult, CategoryPreparationPreview, CategoryPreparationOperation, CategoryPreparationBatchReadResult, CategoryPreparationEntitiesQuery, CategoryPreparationEntityPage, CategoryPreparationSaveResult, SaveCategoryPreparationBatchRequest, SaveCategoryPreparationRequest } from "@rental-os/shared";
import { request } from "./http";
export type { CategoryPreparationOperation, CategoryPreparationEntity, CategoryPreparationPreview } from "@rental-os/shared";
export const categoryPreparationApi = {
  candidates: (operation: CategoryPreparationOperation) => request<{ sourceVersionId: string; sourceRevision: number; versions: Array<{ id: string; versionLabel: string; definitionExecutable: boolean; unavailableReason?: string }> }>("/rental/v1/category-adoption/candidates", { params: { operation } }),
  preview: (id: string, operation: CategoryPreparationOperation, options: { metadataOnly?: boolean; signal?: AbortSignal } = {}) => request<CategoryPreparationPreview>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation`, { params: { operation, metadataOnly: options.metadataOnly }, signal: options.signal }),
  entities: (id: string, params: CategoryPreparationEntitiesQuery, signal?: AbortSignal) => request<CategoryPreparationEntityPage>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation/entities`, { params, signal }),
  save: (id: string, data: SaveCategoryPreparationRequest) => request<CategoryPreparationSaveResult>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation`, { method: "put", data }),
  saveBatch: (id: string, data: SaveCategoryPreparationBatchRequest) => request<CategoryPreparationSaveResult>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation`, { method: "patch", data }),
  readBatch: (id: string, batchId: string) => request<CategoryPreparationBatchReadResult>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/preparation/batches/${encodeURIComponent(batchId)}`),
  adopt: (id: string, data: AdoptRentalCategoryRequest) => request<CategoryAdoptionResult>(`/rental/v1/category-adoption/${encodeURIComponent(id)}/adopt`, { method: "post", data }),
  readOriginal: (key: string, signal?: AbortSignal) => request<CategoryAdoptionReceipt>(`/rental/v1/category-adoption/operations/${encodeURIComponent(key)}`, { signal })
};
