/** Bodyless notification references for caches and business recovery snapshots.
 * This projection supplies no receipt verification, retention claim or sending
 * permission. Original authorized readers own draft bodies and deletion proof. */
import type { RentalNotificationSendLogV1 } from '@rental-os/shared';

export function isNotificationDraftCacheLog(log: RentalNotificationSendLogV1) {
  // Template variable names are customer input and cannot identify a draft.
  // These fields are assigned by the original notification-domain writer.
  return log.status === 'draft' || log.provider === 'not_dispatched'
    || typeof log.id === 'string' && log.id.startsWith('notification-draft-');
}

/** Use only known receipt fields so legacy ciphertext or extra preview fields
 * cannot survive by being spread into another recovery copy. */
export function stripNotificationDraftCacheBody(log: RentalNotificationSendLogV1): RentalNotificationSendLogV1 {
  return { id: log.id, tenantId: log.tenantId, templateId: log.templateId,
    templateVersion: log.templateVersion, eventCode: log.eventCode, channel: log.channel,
    status: log.status, provider: log.provider, attempts: log.attempts, maxAttempts: log.maxAttempts,
    businessObjectType: log.businessObjectType, businessObjectId: log.businessObjectId,
    idempotencyKey: log.idempotencyKey, createdAt: log.createdAt,
    recipient: '', renderedTitle: '', renderedBody: '', variables: {} };
}

/** Applied by the original snapshot writer even for a stale detached payload.
 * Ordinary delivery records and other business collections keep their values. */
export function stripNotificationDraftSnapshotBodies(state: unknown): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !('notificationLogs' in state)) return state;
  if (!Array.isArray(state.notificationLogs)) throw new Error('业务快照通知集合无效');
  const notificationLogs = state.notificationLogs.map((log: RentalNotificationSendLogV1) => {
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('业务快照通知记录无效');
    return isNotificationDraftCacheLog(log) ? stripNotificationDraftCacheBody(log) : log;
  });
  return { ...state, notificationLogs };
}
