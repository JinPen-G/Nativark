/** 原未发送通知草稿的正文保留读取器；只核对原行与删除收据，不运行清理、发送或 Task。
 * 缺账、旧密文恢复或来源不一致保持不可用；writer 复用同一纯校验函数。 */
import { z } from 'zod';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';
import { fingerprint } from '../knowledge-fingerprint';
import { AI_RETENTION_POLICY } from './retention-policy';
import type { RentalNotificationDraftRow, RentalNotificationDraftErasureSource, RentalNotificationErasureReceipt } from '@rental-os/rental-core/notification-draft';


export const NOTIFICATION_DRAFT_RETENTION_KIND = 'notification_draft' as const;
type Row = RentalNotificationDraftRow;
type Owner = { tenantId: string; workspaceId: string };
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.string().max(40).datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const scope = z.object({ tenantId: id, workspaceId: id }).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const metadataSchema = z.object({
  version: z.literal('rental-notification-draft-1'), id: id, key: hash, actorId: id, scope,
  customerId: id, customerVersion: time, templateId: id, templateVersion: id, eventCode: id,
  channel: z.enum(['sms', 'email', 'app_push', 'wechat']), createdAt: time,
  commandHash: hash, inputHash: hash, templateHash: hash, configurationHash: hash,
  contentHash: hash, previewHash: hash,
}).strict();
const previewSchema = z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/u),
  z.union([z.literal('[已加密保留]'), z.literal(''), z.null()]))
  .refine(value => Object.keys(value).length <= 64);
export const notificationDraftBodyErasureSchema = z.object({
  version: z.literal('notification-draft-body-erasure-1'), retention: z.literal('erased'),
  receiptId: hash, policyVersion: z.literal(AI_RETENTION_POLICY.version), erasedAt: time,
  erasedRevision: z.literal(2),
}).strict();
export type NotificationDraftBodyErasure = z.infer<typeof notificationDraftBodyErasureSchema>;
export type NotificationDraftBodyRetention = {
  state: 'erased'; receiptId: string; policyVersion: typeof AI_RETENTION_POLICY.version;
  erasedAt: string; erasedRevision: 2;
};

/** Original scope/id only; neither status nor the ciphertext identifies a receipt. */
export function notificationDraftRetentionReceiptId(owner: Owner, draftId: string) {
  if (!scope.safeParse(owner).success || !/^notification-draft-[a-f0-9]{64}$/u.test(draftId)) throw unavailable();
  return fingerprint([AI_RETENTION_POLICY.version, owner.tenantId, owner.workspaceId,
    NOTIFICATION_DRAFT_RETENTION_KIND, draftId]);
}

export function notificationDraftRetentionState(row: Row) {
  const parsed = z.object({ notificationDraft: metadataSchema,
    preview: previewSchema.optional(), bodyErasure: notificationDraftBodyErasureSchema.optional() }).strict().safeParse(row.variables);
  if (!parsed.success) throw unavailable();
  const metadata = parsed.data.notificationDraft, erasure = parsed.data.bodyErasure;
  if (row.id !== `notification-draft-${metadata.key}` || row.id !== metadata.id
    || row.tenantId !== metadata.scope.tenantId || row.workspaceId !== metadata.scope.workspaceId
    || row.idempotencyKey !== metadata.key || row.templateId !== metadata.templateId
    || row.templateVersion !== metadata.templateVersion || row.eventCode !== metadata.eventCode || row.channel !== metadata.channel
    || row.businessObjectType !== 'customer' || row.businessObjectId !== metadata.customerId
    || row.status !== 'draft' || row.provider !== 'not_dispatched' || row.attempts !== 0 || row.maxAttempts !== 0
    || row.providerMessageId !== null || row.sentAt !== null || row.nextAttemptAt !== null
    || row.lastAttemptAt !== null || row.leaseUntil !== null || row.errorMessage !== null
    || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
    || row.createdAt.toISOString() !== metadata.createdAt) throw unavailable();
  if (erasure) {
    if (row.revision !== erasure.erasedRevision || parsed.data.preview !== undefined
      || row.recipientEncrypted !== null || row.recipientFingerprint !== null || row.recipient !== ''
      || row.renderedTitle !== '' || row.renderedBody !== ''
      || erasure.receiptId !== notificationDraftRetentionReceiptId(metadata.scope, row.id)
      || Date.parse(erasure.erasedAt) < row.createdAt.getTime() + AI_RETENTION_POLICY.conversationDays * 86400000) throw unavailable();
  } else if (row.revision !== 1 || typeof row.recipientEncrypted !== 'string' || !row.recipientEncrypted
    || Buffer.byteLength(row.recipientEncrypted, 'utf8') > 60000 || !hash.safeParse(row.recipientFingerprint).success
    || !parsed.data.preview || typeof row.recipient !== 'string' || !row.recipient || row.recipient.length > 191
    || typeof row.renderedTitle !== 'string' || Array.from(row.renderedTitle).length > 191
    || typeof row.renderedBody !== 'string' || Buffer.byteLength(row.renderedBody, 'utf8') > 32768
    || metadata.previewHash !== requestFingerprint({ recipient: row.recipient,
      renderedTitle: row.renderedTitle, renderedBody: row.renderedBody, variables: parsed.data.preview })) throw unavailable();
  return { metadata, erasure, preview: parsed.data.preview };
}

/** All retained source hashes are immutable across body erasure and restore. */
export function notificationDraftRetentionTargetHash(row: Row) {
  const { metadata } = notificationDraftRetentionState(row);
  return fingerprint([NOTIFICATION_DRAFT_RETENTION_KIND, row.id, row.tenantId,
    row.workspaceId, metadata, row.createdAt.toISOString()]);
}

function sameReceipt(receipt: RentalNotificationErasureReceipt,
  row: Row, targetHash: string) {
  return receipt.id === notificationDraftRetentionReceiptId({ tenantId: row.tenantId, workspaceId: row.workspaceId }, row.id)
    && receipt.tenantId === row.tenantId && receipt.workspaceId === row.workspaceId
    && receipt.kind === NOTIFICATION_DRAFT_RETENTION_KIND && receipt.resourceId === row.id
    && receipt.policyVersion === AI_RETENTION_POLICY.version && receipt.targetHash === targetHash
    && Number.isInteger(receipt.revision) && receipt.revision > 0 && receipt.revision <= 4294967295;
}

/** An old restored ciphertext paired with a deletion journal is unavailable
 * until the trusted restore host reapplies that journal. Reads never erase it. */
export function createNotificationDraftBodyRetentionReader(db: RentalNotificationDraftErasureSource,
  clock: () => Date = () => new Date()) {
  return { async readErasure(row: Row): Promise<NotificationDraftBodyErasure | null> {
    if (typeof db.aiDataErasure?.findUnique !== 'function') throw unavailable();
    const { erasure } = notificationDraftRetentionState(row), targetHash = notificationDraftRetentionTargetHash(row);
    const receipt = await db.aiDataErasure.findUnique({ where: { id: notificationDraftRetentionReceiptId({
      tenantId: row.tenantId, workspaceId: row.workspaceId }, row.id) } });
    if (receipt && !sameReceipt(receipt, row, targetHash)) throw unavailable();
    if (!erasure) { if (receipt) throw unavailable(); return null; }
    const now = clock();
    if (!receipt || receipt.state !== 'erased' || !(receipt.erasedAt instanceof Date)
      || !Number.isFinite(receipt.erasedAt.getTime()) || !(now instanceof Date) || !Number.isFinite(now.getTime())
      || receipt.erasedAt.getTime() > now.getTime() || receipt.erasedAt.toISOString() !== erasure.erasedAt) throw unavailable();
    return structuredClone(erasure);
  } };
}

/** 原维护 writer 共享这些校验；读取器本身没有清理或授权写入能力。 */
export { metadataSchema, sameReceipt,
  id as notificationDraftRetentionIdSchema,
  hash as notificationDraftRetentionHashSchema,
  scope as notificationDraftRetentionScopeSchema };
