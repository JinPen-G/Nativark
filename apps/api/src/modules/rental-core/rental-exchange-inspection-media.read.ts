/** Reads the original dedicated upload and its committed byte evidence in a
 * caller-owned transaction. Never requests provider bytes or creates a ticket. */
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE, type RentalExchangeInspectionMediaRequirements,
  type RentalExchangeInspectionMediaSource } from "@rental-os/shared";
import { requestFingerprint } from "./rental-idempotency.repository";
import { frozenFileContentHash } from "../integrations/file-content-binding";

export interface ExchangeInspectionMediaBinding {
  source: RentalExchangeInspectionMediaSource;
  requirements: RentalExchangeInspectionMediaRequirements;
  provider: string;
  storageKey: string;
  configRowHash: string;
  storageLocationHash: string;
}
export interface ExchangeInspectionMediaRow {
  tenantId: string; workspaceId: string; actorUserId: string; orderId: string;
  operationKey: string; id: string; requestHash: string;
  binding: string | ExchangeInspectionMediaBinding; bindingHash: string;
  completion: string | RentalExchangeInspectionMediaSource["completion"] | null;
  completionHash: string | null;
  completionClaimId: string | null; completionClaimedAt: Date | string | null;
}

export function exchangeInspectionFileKey(actorUserId: string, workspaceId: string, key: string) {
  return `exchange-image-${requestFingerprint({ actorUserId, workspaceId, key })}`;
}

export function readExchangeInspectionMediaBinding(row: ExchangeInspectionMediaRow, orderId: string): ExchangeInspectionMediaBinding {
  let binding: ExchangeInspectionMediaBinding;
  try { binding = typeof row.binding === "string" ? JSON.parse(row.binding) : row.binding; }
  catch { throw new ConflictException("原影像上传绑定证据不可读取"); }
  const value = binding?.source;
  if (!value || row.orderId !== orderId || value.orderId !== orderId || value.id !== row.id || value.actorUserId !== row.actorUserId
    || value.workspaceId !== row.workspaceId || value.operationKey !== row.operationKey || value.requestHash !== row.requestHash
    || value.state !== "pending_upload" || value.completion !== undefined || value.retryable !== false || value.preparationUse !== "not_connected"
    || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.createdAt))
    || !["s3_compatible", "aliyun_oss", "tencent_cos"].includes(binding.provider)
    || binding.requirements?.requirementsHash !== value.requirementsHash || binding.requirements.orderId !== orderId
    || binding.requirements.expectedOrderUpdatedAt !== value.expectedOrderUpdatedAt || binding.requirements.workspaceId !== row.workspaceId
    || requestFingerprint(binding) !== row.bindingHash) throw new ConflictException("原影像上传绑定证据不一致");
  const input = { expectedOrderUpdatedAt: value.expectedOrderUpdatedAt, exchange: value.exchange, operationKey: value.operationKey,
    requirementsHash: value.requirementsHash, side: value.side, templateId: value.templateId, templateVersion: value.templateVersion,
    fieldCode: value.fieldCode, fileName: value.fileName, mimeType: value.mimeType, sizeBytes: value.sizeBytes };
  if (requestFingerprint({ orderId, actorUserId: row.actorUserId, input }) !== row.requestHash) {
    throw new ConflictException("原影像请求与已保存绑定不一致");
  }
  return binding;
}

export function readExchangeInspectionMediaClaim(row: ExchangeInspectionMediaRow) {
  // A missing rollout column must not silently restore permission to dispatch.
  if (row.completionClaimId === null && row.completionClaimedAt === null) return undefined;
  if (row.completionClaimedAt instanceof Date && !Number.isFinite(row.completionClaimedAt.getTime())) {
    throw new ConflictException("原影像完成占用时间不可核验");
  }
  const at = row.completionClaimedAt instanceof Date ? row.completionClaimedAt.toISOString() : row.completionClaimedAt;
  if (typeof row.completionClaimId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(row.completionClaimId)
    || typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new ConflictException("原影像完成占用证据不一致");
  return { id: row.completionClaimId, at };
}

export async function readExchangeInspectionMedia(row: ExchangeInspectionMediaRow, orderId: string,
  tx: Prisma.TransactionClient): Promise<RentalExchangeInspectionMediaSource> {
  const { source, provider, storageKey, storageLocationHash } = readExchangeInspectionMediaBinding(row, orderId);
  const claim = readExchangeInspectionMediaClaim(row);
  if (!row.completion && row.completionHash !== null) throw new ConflictException("原影像完成证据缺失");
  const asset = await tx.fileAsset.findFirst({ where: { id: source.fileAssetId, tenantId: row.tenantId }, include: { uploadSession: true } });
  const session = asset?.uploadSession, metadata = asset?.metadata as Record<string, unknown> | null | undefined;
  const evidence = metadata?.exchangeInspectionFrozenEvidence as { sourceId?: string; contentHash?: string; sizeBytes?: number; mimeType?: string } | undefined;
  const freezePlan = evidence?.sourceId === row.id && evidence.contentHash === frozenFileContentHash(asset!)
    && evidence.sizeBytes === source.sizeBytes && evidence.mimeType === source.mimeType;
  // A staging PUT can remain valid after its first GET. A completed claim must
  // refer to the original source's committed immutable object, not that mutable
  // staging key. Retain the original binding rather than rewriting its history.
  const storageMatches = row.completion || freezePlan
    ? metadata?.stagingStorageKey === storageKey && session?.storageKey === asset?.storageKey
    : session?.storageKey === storageKey && asset?.storageKey === storageKey;
  if (!asset || asset.businessModule !== "rental-core" || asset.businessType !== "rental_order" || asset.businessId !== orderId
    || asset.uploadScene !== RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE || asset.uploadedBy !== row.actorUserId
    || metadata?.workspaceId !== row.workspaceId || metadata.exchangeInspectionSourceId !== row.id
    || asset.fileName !== source.fileName.trim() || asset.mimeType !== source.mimeType || asset.sizeBytes !== source.sizeBytes || asset.storageProvider !== provider
    || !session || session.id !== source.sessionId || session.tenantId !== row.tenantId || session.fileAssetId !== source.fileAssetId || session.provider !== provider
    || !storageMatches || session.expiresAt.toISOString() !== source.expiresAt
    || session.idempotencyKey !== exchangeInspectionFileKey(row.actorUserId, row.workspaceId, row.operationKey)
    || metadata.storageLocationHash !== storageLocationHash) throw new ConflictException("原影像文件或会话关联不一致");
  if (row.completion) {
    let completion: RentalExchangeInspectionMediaSource["completion"];
    try { completion = typeof row.completion === "string" ? JSON.parse(row.completion) : row.completion; }
    catch { throw new ConflictException("原影像完成证据不可读取"); }
    if (!completion || requestFingerprint(completion) !== row.completionHash || !/^[a-f0-9]{64}$/u.test(completion.contentHash)
      || completion.sizeBytes !== source.sizeBytes || completion.mimeType !== source.mimeType || session.status !== "completed" || asset.status !== "active"
      || !session.completedAt || !Number.isFinite(Date.parse(completion.completedAt)) || session.completedAt.toISOString() !== completion.completedAt
      || !Number.isSafeInteger(completion.width) || !Number.isSafeInteger(completion.height) || completion.width < 1 || completion.height < 1
      || completion.width > 16384 || completion.height > 16384 || completion.width * completion.height > 40000000
      || asset.checksum !== completion.contentHash || metadata.exchangeInspectionContentHash !== completion.contentHash
      || frozenFileContentHash(asset) !== completion.contentHash) {
      throw new ConflictException("原影像完成证据不一致");
    }
    return { ...source, state: "completed", completion };
  }
  if (claim && freezePlan && (asset.status === "pending_upload" && session.status === "freeze_pending"
    || asset.status === "active" && session.status === "completed")) return { ...source, state: "completion_unknown" };
  if (asset.status !== "pending_upload" || session.status !== "pending_upload") throw new ConflictException("原影像上传状态需人工核对，不能重传");
  return { ...source, state: claim || Date.parse(source.expiresAt) <= Date.now() ? "completion_unknown" : "pending_upload" };
}
