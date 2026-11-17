/** Original notification-log cache projection, not a sender or retention job.
 * Draft bodies remain in their separately authorized original reader. Cache
 * and recovery snapshots contain only verified immutable receipt metadata;
 * neither an old preview nor an empty ciphertext proves deletion. */
import type { PrismaClient } from '@prisma/client';
import type { RentalNotificationSendLogV1 } from "./contracts";
import { ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { RentalBusinessSecretBox } from "./business-runtime-ports";
import type { RentalNotificationDraftRetention } from "./notification-draft";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
export { isNotificationDraftCacheLog, stripNotificationDraftCacheBody } from "./notification-snapshot";

type Owner = { tenantId: string; workspaceId: string };
export type Source = Pick<PrismaClient, 'rentalNotificationLog' | 'aiDataErasure'>;
export type Cipher = Pick<RentalBusinessSecretBox, 'decrypt' | 'fingerprint'>;
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const unavailable = () => new ServiceUnavailableException('原通知草稿缓存来源不可核对');
const verifiedReceipts = new WeakSet<object>();
const values = z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/u),
  z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]))
  .refine(value => Object.keys(value).length <= 64);

/** Deserialized snapshot objects are never current source evidence. The only
 * brand producer below verifies the original row and deletion journal. */
export function isVerifiedNotificationDraftCacheLog(log: RentalNotificationSendLogV1) {
  return verifiedReceipts.has(log);
}

export async function readNotificationDraftCacheLog(db: Source, cipher: Cipher, owner: Owner,
  cached: RentalNotificationSendLogV1, bodyRetention: RentalNotificationDraftRetention): Promise<RentalNotificationSendLogV1> {
  if (!id.test(owner.tenantId) || !id.test(owner.workspaceId) || cached.tenantId !== owner.tenantId
    || !/^notification-draft-[a-f0-9]{64}$/u.test(cached.id)
    || typeof db?.rentalNotificationLog?.findFirst !== 'function' || typeof db.aiDataErasure?.findUnique !== 'function'
    || typeof cipher?.decrypt !== 'function' || typeof cipher.fingerprint !== 'function') throw unavailable();
  const native = Object.freeze({ decrypt: cipher.decrypt.bind(cipher), fingerprint: cipher.fingerprint.bind(cipher) });
  const row = await db.rentalNotificationLog.findFirst({ where: { ...owner, id: cached.id } });
  if (!row || row.tenantId !== owner.tenantId || row.workspaceId !== owner.workspaceId) throw unavailable();
  const { metadata, erasure } = bodyRetention.state(row);
  if (cached.idempotencyKey !== metadata.key || cached.templateId !== metadata.templateId
    || cached.templateVersion !== metadata.templateVersion || cached.eventCode !== metadata.eventCode
    || cached.channel !== metadata.channel || cached.businessObjectType !== 'customer'
    || cached.businessObjectId !== metadata.customerId) throw unavailable();
  const retention = bodyRetention.createReader(db);
  const verifiedErasure = await retention.readErasure(row);
  if (!isDeepStrictEqual(erasure ?? null, verifiedErasure)) throw unavailable();
  if (!erasure) {
    try {
      const sealed = native.decrypt(row.recipientEncrypted!);
      const originalValues = values.parse(JSON.parse(sealed.variables));
      const input = { customerId: metadata.customerId, templateId: metadata.templateId,
        templateVersion: metadata.templateVersion, variables: originalValues };
      if (!isDeepStrictEqual(JSON.parse(sealed.metadata), metadata)
        || typeof sealed.recipient !== 'string' || !sealed.recipient || sealed.recipient.length > 191
        || typeof sealed.renderedTitle !== 'string' || Array.from(sealed.renderedTitle).length > 191
        || typeof sealed.renderedBody !== 'string' || Buffer.byteLength(sealed.renderedBody, 'utf8') > 32768
        || row.recipientFingerprint !== native.fingerprint(sealed.recipient)
        || metadata.commandHash !== native.fingerprint(requestFingerprint({ version: 'rental-notification-draft-1', input }))
        || metadata.inputHash !== native.fingerprint(requestFingerprint({ commandHash: metadata.commandHash,
          templateHash: metadata.templateHash, configurationHash: metadata.configurationHash,
          customerVersion: metadata.customerVersion, recipient: sealed.recipient }))
        || metadata.contentHash !== native.fingerprint(requestFingerprint({ inputHash: metadata.inputHash,
          recipient: sealed.recipient, renderedTitle: sealed.renderedTitle, renderedBody: sealed.renderedBody,
          variables: originalValues }))) throw unavailable();
    } catch { throw unavailable(); }
  }
  const closing = await db.rentalNotificationLog.findFirst({ where: { ...owner, id: row.id, idempotencyKey: metadata.key } });
  if (!closing || !isDeepStrictEqual(closing, row)
    || !isDeepStrictEqual(await retention.readErasure(closing), verifiedErasure)) throw unavailable();
  // This is a historical immutable receipt projection, not a current erasure
  // assertion. Only the original draft reader returns verified bodyRetention.
  const receipt = Object.freeze({ ...metadata, scope: Object.freeze({ ...metadata.scope }) });
  const projected: RentalNotificationSendLogV1 = Object.freeze({ id: row.id, tenantId: row.tenantId, templateId: metadata.templateId,
    templateVersion: metadata.templateVersion, eventCode: metadata.eventCode, channel: metadata.channel,
    recipient: '', renderedTitle: '', renderedBody: '', variables: Object.freeze({ notificationDraft: receipt }),
    status: 'draft', provider: 'not_dispatched', attempts: 0, maxAttempts: 0,
    businessObjectType: 'customer', businessObjectId: metadata.customerId, idempotencyKey: metadata.key,
    createdAt: metadata.createdAt });
  verifiedReceipts.add(projected);
  return projected;
}
