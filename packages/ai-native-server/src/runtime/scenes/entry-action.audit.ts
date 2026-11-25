/** Minimal registered-entry events in the existing OperationLog. Scope and
 * actor come from the original server identity; no request body, variables,
 * contact, Action proof or second audit ledger is stored. Save receipts use
 * the same original transaction and stable draft key. */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiRegisteredEntrySurface } from '@rental-os/shared';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { EntryNotificationDraftError } from './entry-notification-draft.contract';
type Store = Pick<PrismaClient, 'operationLog'> | Pick<Prisma.TransactionClient, 'operationLog'>;
const fail = () => new EntryNotificationDraftError('AI_RESOURCE_UNAVAILABLE');
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const hash = /^[a-f0-9]{64}$/u;
const knownCodes = ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_RESOURCE_UNAVAILABLE',
  'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'] as const;
export interface EntryActionAuditEvent {
  requestId: string; surface: AiRegisteredEntrySurface; contractVersion: string;
  operation: 'issue' | 'fromOrder' | 'revalidate' | 'prepareNotificationDraft' | 'saveNotificationDraft' | 'readNotificationDraft';
  state: 'observed' | 'refused' | 'unknown'; durationMs: number;
  actionId?: string; actionCode?: string; resourceId?: string; draftId?: string; operationKeyHash?: string;
  taskId?: string; runId?: string; refusalCode?: string; resultState?: 'prepared' | 'saved' | 'unknown';
  actions?: Array<{ actionId: string; actionCode: string; resourceId: string }>;
}
function identity(context: AiExecutionContext) {
  if (context.scope.kind !== 'workspace' || !identifier.test(context.scope.tenantId) || !identifier.test(context.scope.workspaceId)) throw fail();
  const actorId = context.actor.kind === 'user' ? context.actor.userId : context.actor.kind === 'customer' ? context.actor.customerId : null;
  if (!actorId || !identifier.test(actorId) || !['operator', 'staff', 'client'].includes(context.audience)) throw fail();
  return { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
    ...(context.actor.kind === 'user' ? { userId: actorId } : {}), actorId, actorKind: context.actor.kind, audience: context.audience };
}
export async function recordEntryActionObservation(store: Store, context: AiExecutionContext, event: EntryActionAuditEvent) {
  if (typeof store.operationLog?.create !== 'function' || !identifier.test(event.requestId)
    || !Number.isFinite(event.durationMs) || event.durationMs < 0) throw fail();
  const owner = identity(context), metadata: Record<string, string | number | Array<{ actionId: string; actionCode: string; resourceId: string }>> = { version: event.contractVersion,
    requestId: event.requestId, audience: owner.audience, surface: event.surface, actorKind: owner.actorKind,
    actorId: owner.actorId, operation: event.operation, state: event.state, durationMs: Math.min(Math.floor(event.durationMs), 120000) };
  for (const field of ['actionId', 'actionCode', 'resourceId', 'draftId', 'taskId', 'runId', 'resultState'] as const)
    if (event[field] && identifier.test(event[field]!)) metadata[field] = event[field]!;
  if (event.operationKeyHash && hash.test(event.operationKeyHash)) metadata.operationKeyHash = event.operationKeyHash;
  if (event.refusalCode && (knownCodes as readonly string[]).includes(event.refusalCode)) metadata.refusalCode = event.refusalCode;
  if (event.actions) {
    if (event.actions.length > 44 || event.actions.some(row => !identifier.test(row.actionId)
      || !identifier.test(row.actionCode) || !identifier.test(row.resourceId))) throw fail();
    metadata.actions = event.actions.map(row => ({ actionId: row.actionId, actionCode: row.actionCode, resourceId: row.resourceId }));
  }
  const result = await store.operationLog.create({ data: { tenantId: owner.tenantId, workspaceId: owner.workspaceId,
    ...('userId' in owner ? { userId: owner.userId } : {}), action: 'ai.native.entry.observation',
    detail: { operator: owner.actorId, targetType: 'ai-registered-entry', targetId: event.actionId ?? event.requestId, metadata } }, select: { id: true } });
  if (!result || typeof result.id !== 'string' || !identifier.test(result.id)) throw fail();
}
export async function recordOriginalNotificationDraftSaved(transaction: Store, context: AiExecutionContext,
  original: { draftId: string; key: string; commandHash: string; inputHash: string; contentHash: string }) {
  const owner = identity(context);
  if (owner.actorKind !== 'user' || !identifier.test(original.draftId) || ![original.key, original.commandHash, original.inputHash, original.contentHash].every(value => hash.test(value))
    || typeof transaction.operationLog?.findUnique !== 'function' || typeof transaction.operationLog?.create !== 'function') throw fail();
  const digest = createHash('sha256').update(JSON.stringify(['ai-notification-draft-save-1', owner.tenantId,
    owner.workspaceId, owner.actorId, original.key])).digest('hex');
  const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const detail = { operator: owner.actorId, targetType: 'ai-notification-draft', targetId: original.draftId,
    metadata: { version: 'ain-entry-notification-draft-1', audience: owner.audience, surface: 'tenant_admin',
      actionCode: 'CREATE_NOTIFICATION_DRAFT', operationKeyHash: original.key, commandHash: original.commandHash,
      inputHash: original.inputHash, contentHash: original.contentHash, state: 'draft_saved', dispatch: 'not_dispatched' } };
  const old = await transaction.operationLog.findUnique({ where: { id } });
  if (old) {
    if (old.tenantId !== owner.tenantId || old.workspaceId !== owner.workspaceId || old.userId !== owner.actorId
      || old.action !== 'ai.native.notification.draft.saved' || requestFingerprint(old.detail) !== requestFingerprint(detail)) throw fail();
    return;
  }
  const result = await transaction.operationLog.create({ data: { id, tenantId: owner.tenantId, workspaceId: owner.workspaceId,
    userId: owner.actorId, action: 'ai.native.notification.draft.saved', detail }, select: { id: true } });
  if (result.id !== id) throw fail();
}
