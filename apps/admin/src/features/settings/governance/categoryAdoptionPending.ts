import type { AdoptRentalCategoryRequest, CategoryAdoptionResult, CategoryPreparationPreview } from "@rental-os/shared";

/** Client recovery metadata only; it grants no action or scope. Never persist
 * free-form reasons, prepared attributes, credentials or a cached success. */
export interface PendingCategoryAdoption extends Omit<AdoptRentalCategoryRequest, "reason"> { targetId: string }
const storageKey = (scope: string) => `rental:category-adoption:${encodeURIComponent(scope)}`;
const metadataKeys = ["targetId", "expectedSourceVersionId", "expectedSourceRevision", "expectedPreparationRevision", "expectedTargetPolicyRevision", "operation", "idempotencyKey"];
function valid(value: unknown): value is PendingCategoryAdoption {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(key => metadataKeys.includes(key)) &&
    ["targetId", "expectedSourceVersionId"].every(key => typeof row[key] === "string" && Boolean((row[key] as string).trim()) && (row[key] as string).length <= 191) &&
    ["expectedSourceRevision", "expectedPreparationRevision", "expectedTargetPolicyRevision"].every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= (key === "expectedPreparationRevision" ? 1 : 0)) &&
    ["upgrade", "restore"].includes(String(row.operation)) && typeof row.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u.test(row.idempotencyKey);
}
export function readPendingCategoryAdoption(storage: Pick<Storage, "getItem">, scope: string): PendingCategoryAdoption | undefined {
  const raw = storage.getItem(storageKey(scope));
  if (raw === null) return undefined;
  try {
    const envelope = JSON.parse(raw) as { version?: number; scope?: string; operation?: unknown };
    if (envelope.version === 1 && envelope.scope === scope && valid(envelope.operation)) return structuredClone(envelope.operation);
  } catch { /* Keep unknown metadata intact; never turn corruption into a new key. */ }
  throw new Error("本地原采用标识无法读取，请先核对原采用记录，暂不能发起新采用");
}
export function rememberCategoryAdoption(storage: Pick<Storage, "getItem" | "setItem">, scope: string, targetId: string, body: AdoptRentalCategoryRequest) {
  if (storage.getItem(storageKey(scope)) !== null) throw new Error("请先核对上一笔采用结果");
  const { reason: _reason, ...basis } = body;
  const operation = { ...basis, targetId };
  if (!valid(operation)) throw new Error("采用版本或修订依据不完整，请重新读取");
  storage.setItem(storageKey(scope), JSON.stringify({ version: 1, scope, operation }));
  return operation;
}
export function forgetCategoryAdoption(storage: Pick<Storage, "removeItem">, scope: string) { storage.removeItem(storageKey(scope)); }
export function canAdoptPreparedCategory(preview: CategoryPreparationPreview | undefined, dirty: boolean) {
  return Boolean(preview && !dirty && preview.adoptionImplemented && !preview.stale && preview.validation.valid &&
    preview.businessCompatibility.valid && preview.businessCompatibility.complete && preview.commercialContext.newBusinessAllowed &&
    preview.preparation?.revision && Number.isSafeInteger(preview.targetPolicyRevision) &&
    preview.preparation.sourceRevision === preview.sourceRevision && preview.preparation.patches.sourceVersionId === preview.sourceVersionId);
}
export function assertCategoryAdoptionReceipt(operation: PendingCategoryAdoption, result: CategoryAdoptionResult) {
  if (!result || result.outcome !== "adopted" || result.operation !== operation.operation || result.targetVersionId !== operation.targetId ||
      result.sourceVersionId !== operation.expectedSourceVersionId || result.sourceRevision !== operation.expectedSourceRevision ||
      result.adoptionRevision !== operation.expectedSourceRevision + 1 || result.preparationRevision !== operation.expectedPreparationRevision ||
      result.targetPolicyRevision !== operation.expectedTargetPolicyRevision || !result.auditId || !result.adoptedAt || !result.categoryCode) {
    throw new Error("采用回执与原版本或修订不一致，请核对原操作");
  }
}
