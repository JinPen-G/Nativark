import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  CATEGORY_PREPARATION_LIMITS,
  type CategoryEntityPreparationPatch,
  type CategoryEntityPreparationRemoval,
  type CategoryPreparationSaveResult,
  type RentalCategoryDefinition,
  type SaveCategoryPreparationBatchRequest
} from "@rental-os/shared";
import type { CategoryPreparationRecord } from "./category-adoption-records";
import { validateRentalCategoryAttributes } from "./rental-category-attributes";

/** Merge only staged entity fields. The application owns authorization, collection
 * revision/idempotency and persistence. This never validates adoption readiness or
 * changes current entities; the final adoption transaction must recheck all facts. */
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identity = (value: Pick<CategoryEntityPreparationPatch, "entityType" | "entityId">) =>
  `${value.entityType}:${value.entityId}`;
const entityReference = (value: unknown): value is CategoryEntityPreparationRemoval =>
  object(value) && (value.entityType === "item_group" || value.entityType === "asset") &&
  typeof value.entityId === "string" && Boolean(value.entityId.trim()) && value.entityId.length <= 191;
const isoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const safeField = (code: string) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(code) &&
  !["constructor", "prototype", "__proto__"].includes(code);
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Stored batch results are immutable receipts, not the current collection.
 * Validate their public shape and stable parent/key binding without re-reading
 * today's target eligibility, preparation basis or entity count. No authority. */
export function readCategoryPreparationBatchResult(value: unknown,
  expected: { preparationId: string; targetVersionId: string; batchId: string }): CategoryPreparationSaveResult {
  const keys = ["id", "revision", "sourceRevision", "targetVersionId", "preparedOnly", "adoptionImplemented", "batchId", "entityCount", "replayed"];
  const text = (value: unknown, max: number) => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
  const revision = (value: unknown, minimum: number) => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= 2147483647;
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) ||
    !text(expected.preparationId, 191) || !text(expected.targetVersionId, 191) || !text(expected.batchId, 128) ||
    value.id !== expected.preparationId || value.targetVersionId !== expected.targetVersionId || value.batchId !== expected.batchId ||
    !revision(value.revision, 1) || !revision(value.sourceRevision, 0) || value.preparedOnly !== true || typeof value.adoptionImplemented !== "boolean" ||
    (value.entityCount !== undefined && (!Number.isSafeInteger(value.entityCount) || Number(value.entityCount) < 0 || Number(value.entityCount) > CATEGORY_PREPARATION_LIMITS.collectionEntities)) ||
    (value.replayed !== undefined && typeof value.replayed !== "boolean")) {
    throw new ServiceUnavailableException("原批次回执格式或标识绑定无效，请保留原批次标识核对，不能重新保存");
  }
  return structuredClone(value) as unknown as CategoryPreparationSaveResult;
}

function patchShape(value: unknown): asserts value is CategoryEntityPreparationPatch {
  if (!entityReference(value) || !object(value) ||
      Object.keys(value).some((key) => !["entityType", "entityId", "expectedUpdatedAt", "values"].includes(key)) ||
      !isoDate(value.expectedUpdatedAt) || !object(value.values) ||
      !Object.keys(value.values).length || Object.keys(value.values).length > 100) {
    throw new BadRequestException("预备实体、来源修订或字段格式不合法");
  }
  for (const [code, fieldValue] of Object.entries(value.values)) {
    if (!safeField(code) || !["string", "number", "boolean"].includes(typeof fieldValue) ||
        (typeof fieldValue === "number" && !Number.isFinite(fieldValue))) {
      throw new BadRequestException("预备字段必须使用已声明的安全编码及文本、数字或布尔值");
    }
  }
}

export function assertCategoryPreparationBatchSize(patches: unknown, removals: unknown = []) {
  if (!Array.isArray(patches) || !Array.isArray(removals) ||
      patches.length + removals.length > CATEGORY_PREPARATION_LIMITS.batchEntities ||
      size({ patches, removals }) > CATEGORY_PREPARATION_LIMITS.batchBytes) {
    throw new BadRequestException("单批预备资料超过条数或256KB限制，请分批保存");
  }
}

export function mergeCategoryPreparationBatch(
  definition: RentalCategoryDefinition,
  records: { groups: CategoryPreparationRecord[]; assets: CategoryPreparationRecord[] },
  previous: CategoryEntityPreparationPatch[],
  patches: CategoryEntityPreparationPatch[],
  removals: CategoryEntityPreparationRemoval[] = []
): CategoryEntityPreparationPatch[] {
  assertCategoryPreparationBatchSize(patches, removals);
  if (!Array.isArray(previous) || previous.length > CATEGORY_PREPARATION_LIMITS.collectionEntities ||
      size(previous) > CATEGORY_PREPARATION_LIMITS.collectionBytes) {
    throw new ConflictException("已有预备集合格式或规模不受支持，请核对原准备记录");
  }
  const result = new Map<string, CategoryEntityPreparationPatch>();
  for (const patch of previous) {
    patchShape(patch);
    const key = identity(patch);
    if (result.has(key)) throw new ConflictException("已有预备集合包含重复实体，不能覆盖修复");
    result.set(key, structuredClone(patch));
  }
  const current = new Map<string, CategoryPreparationRecord>([
    ...records.groups.map((row) => [`item_group:${row.id}`, row] as const),
    ...records.assets.map((row) => [`asset:${row.id}`, row] as const)
  ]);
  const removed = new Map<string, Set<string> | "all">();
  for (const removal of removals) {
    if (!entityReference(removal) || Object.keys(removal).some((key) => !["entityType", "entityId", "fieldCodes"].includes(key)) ||
        (removal.fieldCodes !== undefined && (!Array.isArray(removal.fieldCodes) || !removal.fieldCodes.length ||
          removal.fieldCodes.length > 100 || removal.fieldCodes.some((code) => typeof code !== "string" || !safeField(code)) ||
          new Set(removal.fieldCodes).size !== removal.fieldCodes.length))) {
      throw new BadRequestException("撤回准备必须明确合法实体及字段范围");
    }
    const key = identity(removal);
    if (removed.has(key)) throw new BadRequestException("同批不能重复撤回同一实体");
    if (!current.has(key) && !result.has(key)) throw new BadRequestException("撤回引用了不属于当前空间的实体");
    removed.set(key, removal.fieldCodes ? new Set(removal.fieldCodes) : "all");
    const prior = result.get(key);
    if (!prior) continue;
    if (removal.fieldCodes === undefined) result.delete(key);
    else {
      for (const field of removal.fieldCodes) delete prior.values[field];
      if (!Object.keys(prior.values).length) result.delete(key);
    }
  }
  const seen = new Set<string>();
  for (const patch of patches) {
    patchShape(patch);
    const key = identity(patch);
    if (seen.has(key)) throw new BadRequestException("同批不能重复修改同一实体");
    seen.add(key);
    const withdrawn = removed.get(key);
    if (withdrawn === "all" || (withdrawn && Object.keys(patch.values).some((field) => withdrawn.has(field)))) {
      throw new BadRequestException("同批不能保存并撤回同一字段，请明确本次操作");
    }
    const row = current.get(key);
    if (!row) throw new BadRequestException("预备资料引用了不属于当前空间的实体");
    if (row.updatedAt.toISOString() !== patch.expectedUpdatedAt) throw new ConflictException("预备资料的来源实体已修改，请重新核对");
    const prior = result.get(key);
    // A new entity revision cannot silently rebase earlier values over changed
    // active facts. The user must inspect and explicitly withdraw stale input.
    if (prior && prior.expectedUpdatedAt !== patch.expectedUpdatedAt) {
      throw new ConflictException("该实体已有准备基于旧修订，请核对并撤回陈旧字段后重新准备");
    }
    // Validate only fields in this batch. Missing target-required values and
    // cross-entity uniqueness are reported by completeness/final adoption checks.
    validateRentalCategoryAttributes(definition.businessModel.assetFields, patch.entityType, patch.values, {}, false);
    result.set(key, { ...structuredClone(patch), values: { ...prior?.values, ...structuredClone(patch.values) } });
  }
  const merged = [...result.values()].sort((a, b) => identity(a).localeCompare(identity(b), "en"));
  if (merged.length > CATEGORY_PREPARATION_LIMITS.collectionEntities || size(merged) > CATEGORY_PREPARATION_LIMITS.collectionBytes) {
    throw new BadRequestException("累计预备资料超过安全上限，本批未保存，原准备已保留");
  }
  return merged;
}

/** Fingerprint the complete original batch, including expected revisions. Same
 * key with a different body is a conflict, never permission to apply it again. */
export function categoryPreparationBatchFingerprint(body: SaveCategoryPreparationBatchRequest): string {
  const canonical = JSON.stringify(body, (_key, value: unknown) => {
    if (!object(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  });
  return createHash("sha256").update(canonical).digest("hex");
}
