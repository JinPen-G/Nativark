/** Original unsent notification bodies, erased in the existing maintenance tx.
 * The immutable log/key and hashes survive. Only real source associations hold
 * a draft; a workspace's unrelated Tasks never do. Empty ciphertext is not a
 * deletion receipt, and this leaf never sends, retries or creates a Task. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { SecretBox } from '@rental-os/platform-server/secret-box';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { AI_RETENTION_POLICY } from './retention-policy';
import {
  NOTIFICATION_DRAFT_RETENTION_KIND, metadataSchema, sameReceipt,
  notificationDraftRetentionIdSchema as id, notificationDraftRetentionHashSchema as hash,
  notificationDraftRetentionScopeSchema as scope, notificationDraftRetentionReceiptId,
  notificationDraftRetentionState, notificationDraftRetentionTargetHash, createNotificationDraftBodyRetentionReader,
  type NotificationDraftBodyErasure,
} from '../../privacy/notification-draft-reader';
export {
  NOTIFICATION_DRAFT_RETENTION_KIND, notificationDraftBodyErasureSchema,
  notificationDraftRetentionReceiptId, notificationDraftRetentionState, notificationDraftRetentionTargetHash,
  createNotificationDraftBodyRetentionReader, metadataSchema, sameReceipt,
  notificationDraftRetentionIdSchema, notificationDraftRetentionHashSchema, notificationDraftRetentionScopeSchema,
  type NotificationDraftBodyErasure, type NotificationDraftBodyRetention,
} from '../../privacy/notification-draft-reader';
import { lockRetentionSourceScope } from './retention-model-sources';
import type { RentalNotificationSendLogV1 } from '@rental-os/shared';
import { stripNotificationDraftCacheBody } from '@rental-os/rental-core/notification-snapshot';
type Row = Prisma.RentalNotificationLogGetPayload<object>;
type Owner = { tenantId: string; workspaceId: string };
export type NotificationDraftRetentionCipher = Pick<SecretBox, 'decrypt' | 'fingerprint'>;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const originalVariablesSchema = z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/u),
  z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]))
  .refine(value => Object.keys(value).length <= 64);

function verifyOriginalBody(row: Row, cipher: NotificationDraftRetentionCipher) {
  const { metadata, erasure } = notificationDraftRetentionState(row);
  if (erasure) return;
  if (typeof cipher?.decrypt !== 'function' || typeof cipher.fingerprint !== 'function') throw unavailable();
  try {
    const sealed = z.object({ metadata: z.string().max(8192), recipient: z.string().min(1).max(191),
      variables: z.string().max(32768), renderedTitle: z.string(), renderedBody: z.string() }).strict()
      .parse(cipher.decrypt(row.recipientEncrypted!));
    const variables = originalVariablesSchema.parse(JSON.parse(sealed.variables));
    const input = { customerId: metadata.customerId, templateId: metadata.templateId,
      templateVersion: metadata.templateVersion, variables };
    if (!isDeepStrictEqual(metadataSchema.parse(JSON.parse(sealed.metadata)), metadata)
      || Array.from(sealed.renderedTitle).length > 191 || Buffer.byteLength(sealed.renderedBody, 'utf8') > 32768
      || row.recipientFingerprint !== cipher.fingerprint(sealed.recipient)
      || metadata.commandHash !== cipher.fingerprint(requestFingerprint({ version: 'rental-notification-draft-1', input }))
      || metadata.inputHash !== cipher.fingerprint(requestFingerprint({ commandHash: metadata.commandHash,
        templateHash: metadata.templateHash, configurationHash: metadata.configurationHash,
        customerVersion: metadata.customerVersion, recipient: sealed.recipient }))
      || metadata.contentHash !== cipher.fingerprint(requestFingerprint({ inputHash: metadata.inputHash,
        recipient: sealed.recipient, renderedTitle: sealed.renderedTitle, renderedBody: sealed.renderedBody, variables }))) throw unavailable();
  } catch { throw unavailable(); }
}

type RetentionInput = { scopeId: string; owner: Owner; draftId: string; now: Date;
  cipher: NotificationDraftRetentionCipher; check(): Promise<void> };
type Hold = { state: 'held'; reason: 'unresolved_effects' | 'referenced_by_unresolved_task' | 'association_limit' }
  | { state: 'unavailable'; reason: 'source_task_binding_unavailable' };
const associationUnavailable = (): Hold => ({ state: 'unavailable', reason: 'source_task_binding_unavailable' });

/** The standalone draft has no inferred Task. Only the original FK event and
 * its hash-bound automation input can connect an actual unresolved Task. */
async function relatedEffects(tx: Prisma.TransactionClient, row: Row, input: RetentionInput): Promise<Hold | { state: 'clear'; digest: string }> {
  if (typeof tx.aiBusinessFailureOutbox?.findMany !== 'function') return associationUnavailable();
  const events = await tx.aiBusinessFailureOutbox.findMany({ where: { notificationId: row.id }, orderBy: { id: 'asc' }, take: 51 });
  if (events.length > 50) return { state: 'held', reason: 'association_limit' };
  const evidence: unknown[] = [];
  let associatedInputs = 0;
  for (const event of events) {
    const traceId = requestFingerprint({ ...input.owner, kind: 'notification', id: row.id });
    const causationId = requestFingerprint({ traceId, revision: event.resourceRevision });
    if (!id.safeParse(event.id).success || event.tenantId !== input.owner.tenantId || event.workspaceId !== input.owner.workspaceId
      || event.eventType !== 'notification.failed' || event.notificationId !== row.id || event.failureCode !== 'delivery_failed'
      || [event.refundId, event.inspectionId, event.exceptionId, event.fulfillmentOrderId, event.configurationKind,
        event.configurationId, event.configurationProfileTenantId, event.configurationSnapshotWorkspaceId,
        event.configurationSettingsWorkspaceId, event.sectionCode, event.orderId, event.locationId, event.sourceHash,
        event.sourcePolicyId, event.sourcePolicyRevision, event.dueAt].some(value => value !== null)
      || !Number.isInteger(event.resourceRevision) || event.resourceRevision < 1 || event.resourceRevision > row.revision
      || event.traceId !== traceId || event.causationId !== causationId
      || event.deduplicationKey !== requestFingerprint({ eventType: event.eventType, causationId })
      || !(event.occurredAt instanceof Date) || !Number.isFinite(event.occurredAt.getTime())
      || !(event.expiresAt instanceof Date) || !Number.isFinite(event.expiresAt.getTime()) || event.expiresAt <= event.occurredAt
      || !['pending', 'claimed', 'retry_scheduled', 'ready', 'dead_letter', 'expired', 'closed'].includes(event.status)
      || !Number.isInteger(event.fence) || event.fence < 0 || !Number.isInteger(event.attempts) || event.attempts < 0) return associationUnavailable();
    if (!['expired', 'closed'].includes(event.status) || event.leaseOwner !== null || event.leaseUntil !== null) {
      return { state: 'held', reason: 'unresolved_effects' };
    }
    if (typeof tx.aiAutomationInput?.findMany !== 'function') return associationUnavailable();
    const inputs = await tx.aiAutomationInput.findMany({ where: { eventId: event.id }, orderBy: { id: 'asc' }, take: 51 });
    associatedInputs += inputs.length;
    if (associatedInputs > 50) return { state: 'held', reason: 'association_limit' };
    const tasks: unknown[] = [];
    for (const original of inputs) {
      const payload = original.payload as Record<string, unknown>, source = payload?.event as Record<string, unknown>;
      const resource = source?.resource as Record<string, unknown>;
      if (!id.safeParse(original.id).success || original.tenantId !== input.owner.tenantId || original.workspaceId !== input.owner.workspaceId
        || original.scopeId !== input.scopeId || original.eventId !== event.id || original.resourceRevision !== event.resourceRevision
        || original.inputRevision !== 1 || !hash.safeParse(original.inputHash).success || requestFingerprint(payload) !== original.inputHash
        || original.creationKey !== requestFingerprint({ version: 'automation-creation-1', ...input.owner,
          policyId: original.policyId, policyRevision: original.policyRevision, eventId: event.id,
          sceneCode: original.sceneCode, sceneVersion: original.sceneVersion })
        || source?.eventId !== event.id || source?.type !== 'notification.failed' || resource?.kind !== 'notification'
        || resource?.id !== row.id || resource?.version !== event.resourceRevision
        || !isDeepStrictEqual(source?.scope, { kind: 'workspace', ...input.owner })
        || !['prepared', 'creation_unknown', 'linked'].includes(original.status)
        || !['open', 'closed'].includes(original.reviewStatus)) return associationUnavailable();
      if (original.status === 'creation_unknown' || original.reviewStatus !== 'closed') return { state: 'held', reason: 'unresolved_effects' };
      const found = await tx.aiTask.findMany({ where: { scopeId: input.scopeId,
        OR: [{ inputRef: original.id }, { creationKey: original.creationKey }] }, orderBy: { id: 'asc' }, take: 2 });
      if (found.length > 1 || original.status === 'linked' && found.length !== 1
        || original.status === 'prepared' && (original.taskId !== null || original.runId !== null)) return associationUnavailable();
      for (const task of found) {
        if (task.scopeId !== input.scopeId || task.scopeKind !== 'WORKSPACE' || task.ownerKind !== 'AUTOMATION'
          || task.ownerId !== original.subjectId || task.audience !== 'AUTOMATION' || task.creationKey !== original.creationKey
          || task.inputRef !== original.id || task.inputRevision !== original.inputRevision || task.inputHash !== original.inputHash
          || task.sceneCode !== original.sceneCode || task.sceneVersion !== original.sceneVersion
          || original.taskId !== task.id || !original.runId) return associationUnavailable();
        const run = await tx.aiRun.findFirst({ where: { id: original.runId, taskId: task.id, scopeId: input.scopeId } });
        if (!run) return associationUnavailable();
        if (!['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)
          || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
          || await aiTaskHasUnresolvedEffects(tx, input.scopeId, task.id, input.owner)) {
          return { state: 'held', reason: 'referenced_by_unresolved_task' };
        }
        tasks.push({ task, run });
      }
    }
    evidence.push({ event, inputs, tasks });
  }
  return { state: 'clear', digest: requestFingerprint(evidence) };
}

/** Remove this draft's old recovery copies under the original snapshot lock.
 * Only the notification JSON path is replaced. The enclosing retention tx owns
 * authorization and rollback, including trusted restores with no source row. */
export async function eraseNotificationDraftSnapshotCopies(tx: Prisma.TransactionClient, owner: Owner,
  draftId: string, check: () => Promise<void>) {
  if (!scope.safeParse(owner).success || !/^notification-draft-[a-f0-9]{64}$/u.test(draftId)) throw unavailable();
  const snapshots = await tx.$queryRaw<Array<{ tenantId: string; workspaceId: string; notifications: Prisma.JsonValue | null }>>(prismaRuntime.sql`
    SELECT tenantId, workspaceId, JSON_EXTRACT(state, '$.notificationLogs') AS notifications
    FROM rental_business_state_snapshots
    WHERE tenantId = ${owner.tenantId} AND workspaceId = ${owner.workspaceId} FOR UPDATE`);
  if (!Array.isArray(snapshots) || snapshots.length > 1) throw unavailable();
  await check();
  if (!snapshots.length) return;
  const snapshot = snapshots[0];
  if (snapshot.tenantId !== owner.tenantId || snapshot.workspaceId !== owner.workspaceId) throw denied();
  if (snapshot.notifications === null) return;
  if (!Array.isArray(snapshot.notifications)) throw unavailable();
  const notifications = snapshot.notifications.map(log => {
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw unavailable();
    if (log.id !== draftId) return log;
    return JSON.parse(JSON.stringify(stripNotificationDraftCacheBody(log as unknown as RentalNotificationSendLogV1))) as Prisma.JsonValue;
  });
  if (isDeepStrictEqual(notifications, snapshot.notifications)) return;
  await check();
  const changed = await tx.$executeRaw(prismaRuntime.sql`UPDATE rental_business_state_snapshots
    SET state = JSON_SET(state, '$.notificationLogs', CAST(${JSON.stringify(notifications)} AS JSON)), updatedAt = CURRENT_TIMESTAMP(3)
    WHERE tenantId = ${owner.tenantId} AND workspaceId = ${owner.workspaceId}
      AND JSON_EXTRACT(state, '$.notificationLogs') = CAST(${JSON.stringify(snapshot.notifications)} AS JSON)`);
  if (changed !== 1) throw conflict();
  await check();
}

/** Same transaction as AiRetentionService's scope lock and journal. The current
 * permission check is repeated after source waits and before each mutation. */
export async function eraseExpiredNotificationDraftBodies(tx: Prisma.TransactionClient, input: RetentionInput, expectedHash?: string) {
  if (!id.safeParse(input.scopeId).success || !scope.safeParse(input.owner).success
    || !/^notification-draft-[a-f0-9]{64}$/u.test(input.draftId) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || expectedHash !== undefined && !hash.safeParse(expectedHash).success || typeof input.check !== 'function'
    || typeof input.cipher?.decrypt !== 'function' || typeof input.cipher.fingerprint !== 'function') throw unavailable();
  const cipher = Object.freeze({ decrypt: input.cipher.decrypt.bind(input.cipher), fingerprint: input.cipher.fingerprint.bind(input.cipher) });
  await input.check();
  const locked = await lockRetentionSourceScope(tx, { kind: 'workspace', ...input.owner });
  if (locked.scopeId !== input.scopeId) throw denied();
  const locks = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM rental_notification_logs
    WHERE id = ${input.draftId} AND tenantId = ${input.owner.tenantId} AND workspaceId = ${input.owner.workspaceId} FOR UPDATE`);
  if (locks.length !== 1 || locks[0].id !== input.draftId) throw unavailable();
  const row = await tx.rentalNotificationLog.findFirst({ where: { id: input.draftId, ...input.owner } });
  if (!row || row.tenantId !== input.owner.tenantId || row.workspaceId !== input.owner.workspaceId) throw unavailable();
  const { metadata, erasure } = notificationDraftRetentionState(row), targetHash = notificationDraftRetentionTargetHash(row);
  const key = notificationDraftRetentionReceiptId(input.owner, row.id), receipt = await tx.aiDataErasure.findUnique({ where: { id: key } });
  if (expectedHash && targetHash !== expectedHash || receipt && !sameReceipt(receipt, row, targetHash)) throw denied();
  if (!expectedHash && !erasure && receipt || !expectedHash && row.createdAt.getTime()
    > input.now.getTime() - AI_RETENTION_POLICY.conversationDays * 86400000) throw unavailable();
  verifyOriginalBody(row, cipher);
  const related = await relatedEffects(tx, row, input);
  await input.check();
  if (related.state !== 'clear') return { id: key, ...related };
  if (erasure && !expectedHash) {
    await createNotificationDraftBodyRetentionReader(tx, () => input.now).readErasure(row);
    await eraseNotificationDraftSnapshotCopies(tx, input.owner, row.id, input.check);
    await input.check();
    return { id: key, state: 'erased' as const, replayed: true };
  }
  // A trusted restored row can already carry its original deletion instant
  // while the target's local journal is absent. Preserve that instant instead
  // of rewriting the mark with the later restore time.
  const erasedAt = receipt?.state === 'erased' && receipt.erasedAt instanceof Date ? receipt.erasedAt
    : erasure ? new Date(erasure.erasedAt) : input.now;
  if (!Number.isFinite(erasedAt.getTime()) || erasedAt > input.now
    || erasedAt.getTime() < row.createdAt.getTime() + AI_RETENTION_POLICY.conversationDays * 86400000) throw unavailable();
  const mark: NotificationDraftBodyErasure = { version: 'notification-draft-body-erasure-1', retention: 'erased',
    receiptId: key, policyVersion: AI_RETENTION_POLICY.version, erasedAt: erasedAt.toISOString(), erasedRevision: 2 };
  const finalRelated = await relatedEffects(tx, row, input);
  await input.check();
  if (finalRelated.state !== 'clear') return { id: key, ...finalRelated };
  if (finalRelated.digest !== related.digest) throw conflict();
  if (!erasure) {
    const changed = await tx.rentalNotificationLog.updateMany({ where: { id: row.id, ...input.owner,
      revision: row.revision, status: 'draft', provider: 'not_dispatched', idempotencyKey: metadata.key,
      attempts: 0, maxAttempts: 0, providerMessageId: null, sentAt: null, nextAttemptAt: null, lastAttemptAt: null, leaseUntil: null,
      recipientEncrypted: row.recipientEncrypted, recipientFingerprint: row.recipientFingerprint,
      variables: { equals: row.variables as Prisma.InputJsonValue } }, data: {
        recipientEncrypted: null, recipientFingerprint: null, recipient: '', renderedTitle: '', renderedBody: '',
        variables: { notificationDraft: metadata, bodyErasure: mark } as Prisma.InputJsonValue,
        revision: { increment: 1 },
      } });
    if (changed.count !== 1) throw conflict();
  } else if (!isDeepStrictEqual(erasure, mark)) throw unavailable();
  await input.check();
  if (!receipt) await tx.aiDataErasure.create({ data: { id: key, ...input.owner, kind: NOTIFICATION_DRAFT_RETENTION_KIND,
    resourceId: row.id, targetHash, policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt } });
  else if (receipt.state !== 'erased' || !(receipt.erasedAt instanceof Date) || receipt.erasedAt.getTime() !== erasedAt.getTime()) {
    if (receipt.revision >= 4294967295) throw unavailable();
    const updated = await tx.aiDataErasure.updateMany({ where: { id: key, ...input.owner,
      revision: receipt.revision, state: receipt.state, targetHash }, data: { state: 'erased', erasedAt, revision: { increment: 1 } } });
    if (updated.count !== 1) throw conflict();
  }
  const current = await tx.rentalNotificationLog.findFirst({ where: { id: row.id, ...input.owner } });
  if (!current || notificationDraftRetentionTargetHash(current) !== targetHash) throw unavailable();
  await createNotificationDraftBodyRetentionReader(tx, () => input.now).readErasure(current);
  await eraseNotificationDraftSnapshotCopies(tx, input.owner, row.id, input.check);
  const closing = await relatedEffects(tx, current, input);
  await input.check();
  if (closing.state !== 'clear' || closing.digest !== related.digest) throw unavailable();
  return { id: key, state: 'erased' as const, replayed: Boolean(receipt) };
}
