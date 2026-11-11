/** Original preparation and dedicated photo acceptance. The caller owns the
 * order/tenant transaction; this module grants no customer or expense authority. */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { rentalExchangeExecutionBasisComparable, type RentalExchangeInspectionAcceptedMedia, type RentalExchangeInspectionPhotoReference, type RentalExchangeInspectionPreparation,
  type RentalExchangeInspectionRequirements, type RentalExchangeInspectionResult } from "@rental-os/shared";
import { requestFingerprint } from "./rental-idempotency.repository";
import { readExchangeInspectionMedia, readExchangeInspectionMediaBinding, type ExchangeInspectionMediaRow } from "./rental-exchange-inspection-media.read";
import { preparedInspectionResults } from "./rental-inspection-result-validation";

export interface ExchangeInspectionPreparationRow {
  tenantId: string; id: string; orderId: string; workspaceId: string; actorUserId: string;
  operationKey: string; requestHash: string; payloadHash: string; payload: string | RentalExchangeInspectionPreparation;
}
export function readPreparedExchangeInspection(row: ExchangeInspectionPreparationRow,
  scope: { tenantId: string; workspaceId: string; orderId: string }): RentalExchangeInspectionPreparation {
  let value: RentalExchangeInspectionPreparation;
  try { value = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; }
  catch { throw new ConflictException("原换货检查准备证据不可读取"); }
  if (!value || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.orderId !== scope.orderId
    || value.id !== row.id || value.orderId !== scope.orderId || value.workspaceId !== row.workspaceId
    || value.actorUserId !== row.actorUserId || value.operationKey !== row.operationKey || value.requestHash !== row.requestHash
    || value.state !== "prepared" || value.revision !== 1 || value.customerConsent !== "not_connected" || value.execution !== "not_connected"
    || !Array.isArray(value.templates) || !Array.isArray(value.inspections) || value.templates.length > 40
    || value.templates.length !== value.inspections.length || !Array.isArray(value.exceptions) || value.exceptions.length > 20
    || requestFingerprint(value) !== row.payloadHash) throw new ConflictException("原换货检查准备证据不一致");
  return structuredClone(value);
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
function photoReferences(value: RentalExchangeInspectionPhotoReference[] | undefined) {
  const refs = value ?? [];
  if (!Array.isArray(refs) || refs.length > 100 || refs.some(row => !row || Object.keys(row).some(key => !["fieldCode", "sourceId", "operationKey", "fileAssetId"].includes(key))
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(row.fieldCode) || ["__proto__", "constructor", "prototype"].includes(row.fieldCode)
    || !validId(row.sourceId) || !validId(row.fileAssetId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(row.operationKey))
    || new Set(refs.map(row => row.fieldCode)).size !== refs.length) throw new BadRequestException("原检查照片引用无效或重复");
  return refs;
}

export async function acceptPreparedExchangeInspectionMedia(tx: Prisma.TransactionClient,
  scope: { tenantId: string; workspaceId: string; actorUserId: string }, requirements: RentalExchangeInspectionRequirements,
  inspections: RentalExchangeInspectionResult[]) {
  const acceptedMedia: RentalExchangeInspectionAcceptedMedia[] = [], seen = new Set<string>();
  const results: RentalExchangeInspectionResult[] = [];
  for (const inspection of inspections) {
    if (!inspection || Object.keys(inspection).some(key => !["side", "templateId", "templateVersion", "results", "photoSources"].includes(key))) throw new BadRequestException("检查结果字段无效");
    const key = `${inspection.side}:${inspection.templateId}`;
    const template = requirements.templates.find(row => row.side === inspection.side && row.template.id === inspection.templateId)?.template;
    if (!template || seen.has(key) || template.version !== inspection.templateVersion) throw new BadRequestException("检查模板或修订不匹配");
    seen.add(key);
    const refs = photoReferences(inspection.photoSources), accepted = new Map<string, string>();
    for (const ref of refs) {
      if (!template.fields.some(field => field.code === ref.fieldCode && field.type === "photo") || inspection.results?.[ref.fieldCode] !== ref.fileAssetId
        || acceptedMedia.some(row => row.sourceId === ref.sourceId || row.fileAssetId === ref.fileAssetId)) throw new BadRequestException("照片不属于当前检查字段或已重复使用");
      const rows = await tx.$queryRaw<ExchangeInspectionMediaRow[]>`SELECT * FROM rental_exchange_inspection_media
        WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.actorUserId}
          AND orderId=${requirements.orderId} AND id=${ref.sourceId} AND operationKey=${ref.operationKey} FOR UPDATE`;
      const row = rows[0];
      if (rows.length !== 1 || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.actorUserId !== scope.actorUserId
        || row.id !== ref.sourceId || row.operationKey !== ref.operationKey) throw new ConflictException("原检查影像来源缺失或范围不一致");
      // File removal/completion must not change beneath the evidence read.
      await tx.$queryRaw`SELECT id FROM FileAsset WHERE tenantId=${scope.tenantId} AND id=${ref.fileAssetId} LOCK IN SHARE MODE`;
      const source = await readExchangeInspectionMedia(row, requirements.orderId, tx);
      // A completed legacy source retains its original key/hash. Compare its
      // frozen requirements under the current contract instead of re-uploading.
      const originalRequirements = readExchangeInspectionMediaBinding(row, requirements.orderId).requirements;
      const comparableHash = requestFingerprint({ orderId: originalRequirements.orderId, expectedOrderUpdatedAt: originalRequirements.expectedOrderUpdatedAt,
        exchange: originalRequirements.exchange, templates: originalRequirements.templates, basis: rentalExchangeExecutionBasisComparable(originalRequirements.executionBasis) });
      if (source.state !== "completed" || !source.completion || source.fileAssetId !== ref.fileAssetId
        || source.expectedOrderUpdatedAt !== requirements.expectedOrderUpdatedAt || comparableHash !== requirements.requirementsHash
        || source.side !== inspection.side || source.templateId !== template.id || source.templateVersion !== template.version || source.fieldCode !== ref.fieldCode
        || requestFingerprint(source.exchange) !== requestFingerprint(requirements.exchange)) throw new ConflictException("照片未完成或与原订单、意图、模板和检查要求不一致");
      accepted.set(ref.fieldCode, ref.fileAssetId);
      acceptedMedia.push({ ...ref, side: inspection.side, templateId: template.id, templateVersion: template.version,
        contentHash: source.completion.contentHash, completionHash: requestFingerprint(source.completion) });
    }
    results.push({ ...inspection, results: preparedInspectionResults(template, inspection.results, accepted) });
  }
  if (acceptedMedia.length > 50) throw new BadRequestException("检查照片超过本次执行支持的50份范围");
  return { inspections: results, acceptedMedia };
}

export async function recordPreparedExchangeInspectionMedia(tx: Prisma.TransactionClient, tenantId: string, value: RentalExchangeInspectionPreparation) {
  for (const media of value.acceptedMedia ?? []) {
    const uses = await tx.$queryRaw<Array<{ preparationId: string }>>`SELECT preparationId FROM rental_exchange_inspection_media_uses
      WHERE tenantId=${tenantId} AND workspaceId=${value.workspaceId} AND sourceId=${media.sourceId} FOR UPDATE`;
    if (uses.length) throw new ConflictException("原检查影像已接受到另一准备，不能再次消费");
    await tx.$executeRaw`INSERT INTO rental_exchange_inspection_media_uses (tenantId,workspaceId,sourceId,preparationId,evidenceHash)
      VALUES (${tenantId},${value.workspaceId},${media.sourceId},${value.id},${requestFingerprint(media)})`;
  }
}

export async function verifyPreparedExchangeInspectionMedia(tx: Prisma.TransactionClient, tenantId: string, value: RentalExchangeInspectionPreparation) {
  const actual = await acceptPreparedExchangeInspectionMedia(tx, { tenantId, workspaceId: value.workspaceId, actorUserId: value.actorUserId }, value, value.inspections);
  if (requestFingerprint(actual.acceptedMedia) !== requestFingerprint(value.acceptedMedia ?? [])) throw new ConflictException("原检查已接受影像证据发生变化");
  for (const media of actual.acceptedMedia) {
    const uses = await tx.$queryRaw<Array<{ preparationId: string; evidenceHash: string }>>`SELECT preparationId,evidenceHash FROM rental_exchange_inspection_media_uses
      WHERE tenantId=${tenantId} AND workspaceId=${value.workspaceId} AND sourceId=${media.sourceId} LOCK IN SHARE MODE`;
    if (uses.length !== 1 || uses[0].preparationId !== value.id || uses[0].evidenceHash !== requestFingerprint(media)) throw new ConflictException("原检查照片消费关联缺失或不一致");
  }
}
