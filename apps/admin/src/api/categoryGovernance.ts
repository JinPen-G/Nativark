import { request } from "./http";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { isRentalCategoryCode, AI_CATEGORY_DRAFT_HTTP_SCHEMAS, type AiCategoryGovernanceAuditWire } from "@rental-os/shared";
import type { CreateCategoryDraftRequest, CategoryVersionView, CategoryDraftSection, PatchCategoryDraftRequest, SaveCategoryOpeningRequest, SaveCategoryVersionPolicyRequest, RentalCapabilityModuleDefinition, RentalCapabilityCompositionContract, RentalCapabilityHookPoint, CategoryDefinitionDifference,
  RentalCategoryDefinition, PreviewRentalCategoryCreationRequest, CreateRentalCategoryRequest, RentalCategoryCreationPreview, RentalCategoryCreationReceipt } from "@rental-os/shared";

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

/** Original platform audit evidence; current version/policy state alone cannot
 * settle a lost write response. These fields never grant publication authority. */
export type CategoryGovernanceAudit = AiCategoryGovernanceAuditWire;
const auditValidator = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(auditValidator);
for (const [name, schema] of Object.entries(AI_CATEGORY_DRAFT_HTTP_SCHEMAS)) auditValidator.addSchema(schema, `#/components/schemas/${name}`);
const auditPage = auditValidator.getSchema('#/components/schemas/AiCategoryGovernanceAuditPage')!;
export function readCategoryGovernanceAudits(value: unknown, code: string): CategoryGovernanceAudit[] {
  // Use the public runtime schema; declaration-only casts cannot establish
  // that an audit contains the original K, revision and before/after evidence.
  const copy = structuredClone(value);
  if (!isRentalCategoryCode(code) || !auditPage(copy)) throw Error("AI_CATEGORY_AUDIT_UNAVAILABLE");
  const rows = copy as CategoryGovernanceAudit[];
  if (rows.some(row => row.categoryCode !== code)) throw Error("AI_CATEGORY_AUDIT_UNAVAILABLE");
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("AI_CATEGORY_AUDIT_UNAVAILABLE");
  return rows;
}
export const categoryGovernanceApi = {
  list: () => request<CategoryGovernanceSummary[]>("/platform/rental-categories"),
  tenantDirectory: () => request<Array<{ id: string; code: string; name: string }>>("/platform/rental-categories/tenant-directory"),
  detail: (code: string) => request<CategoryGovernanceDetail>(`/platform/rental-categories/${encodeURIComponent(code)}`),
  createDraft: (code: string, data: CreateCategoryDraftRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/drafts`, { method: "post", data }),
  previewCreation: (data: PreviewRentalCategoryCreationRequest) => request<RentalCategoryCreationPreview>("/platform/rental-categories/creation-preview", { method: "post", data }),
  createCategory: (data: CreateRentalCategoryRequest) => request<CategoryVersionView>("/platform/rental-categories", { method: "post", data }),
  creationReceipt: (key: string) => request<RentalCategoryCreationReceipt>(`/platform/rental-categories/creation-requests/${encodeURIComponent(key)}`),
  patch: (code: string, id: string, section: CategoryDraftSection, data: PatchCategoryDraftRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/sections/${section}`, { method: "patch", data }),
  validate: (code: string, id: string) => request<{ valid: boolean; errors: string[] }>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/validate`, { method: "post" }),
  preview: (code: string, id: string) => request<{ valid: boolean; errors: string[]; changedSections: CategoryDraftSection[]; differences: CategoryDefinitionDifference[]; affectedSpaces: number; revision: number }>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/preview`),
  publish: (code: string, id: string, data: { expectedRevision: number; idempotencyKey: string; reason: string }) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/publish`, { method: "post", data }),
  opening: (code: string, data: SaveCategoryOpeningRequest) => request<unknown>(`/platform/rental-categories/${encodeURIComponent(code)}/opening-policy`, { method: "put", data }),
  policy: (code: string, id: string, data: SaveCategoryVersionPolicyRequest) => request<CategoryVersionView>(`/platform/rental-categories/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/adoption-policy`, { method: "put", data }),
  audits: async (code: string) => readCategoryGovernanceAudits(await request<unknown>(`/platform/rental-categories/${encodeURIComponent(code)}/audits`), code),
  catalog: () => request<{ dynamicCreationEnabled: boolean; templates: Array<{ id: "serialized" | "quantity" | "kit"; revision: string; definition: RentalCategoryDefinition }>; capabilities: Array<RentalCapabilityModuleDefinition & { implemented: boolean;
    composition?: RentalCapabilityCompositionContract & { points: RentalCapabilityHookPoint[]; order: number } }>; pricingStrategies: Array<{ code: string; implementationVersion: string }> }>("/platform/rental-categories/capability-catalog")
};
