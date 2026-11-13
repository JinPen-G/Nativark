/** Read the original persisted refund through its existing finance GET.
 * The event and current scope are checked before and after. No refresh, retry,
 * payment/refund creation, model invocation or inferred financial outcome. */
import type { AiAutomationReviewsForEventDraft, ApiResult } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import type { AutomationReviewOriginalTarget } from '@/features/ai-native/automation-review-session';
import { aiAutomationReviewsApi } from './aiAutomationReviews';
import { http } from './http';

export interface AutomationOriginalRefundRecord {
  refundId: string; paymentIntentId: string; orderId: string;
  status: 'pending' | 'accepted' | 'funding_pending' | 'succeeded' | 'failed' | 'closed';
  acceptedAt: string | null; succeededAt: string | null; fundedAt: string | null; updatedAt: string;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const instant = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));

export async function readAutomationOriginalRefund(target: AutomationReviewOriginalTarget, signal: AbortSignal,
  current: () => boolean): Promise<AutomationOriginalRefundRecord> {
  const original = structuredClone(target), resource = original.resource;
  if (resource.kind !== 'refund' || !id(resource.id) || !id(resource.orderId) || !id(resource.paymentIntentId)) throw Error('AI_RESOURCE_UNAVAILABLE');
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  const check = () => {
    const auth = useAuthStore.getState();
    if (active.aborted || epoch !== currentSessionEpoch() || !current() || !auth.sessionVerified || !auth.token || auth.user?.isSaasAdmin
      || auth.tenant?.tenantId !== original.scope.tenantId || auth.currentWorkspaceId !== original.scope.workspaceId
      || auth.user?.id !== original.scope.actorId || original.scope.audience !== 'operator'
      || !auth.hasPermission('rental-os:finance:view') && !auth.hasPermission('rental-os:finance:reconcile')) throw Error('AI_SCOPE_CHANGED');
  };
  const source = async () => {
    check(); const value: AiAutomationReviewsForEventDraft = await aiAutomationReviewsApi.forEvent({ eventId: original.eventId, limit: 1 }, active); check();
    if (value.event.eventId !== original.eventId || value.event.type !== original.eventType
      || value.event.resourceRevision !== original.resourceRevision || value.currentSource.revision !== original.currentRevision
      || ('sourceHash' in value.currentSource ? value.currentSource.sourceHash : undefined) !== original.sourceHash
      || JSON.stringify(value.originalResource) !== JSON.stringify(resource)) throw Error('AI_REVISION_CONFLICT');
    return { failed: value.currentSource.failed,
      signature: JSON.stringify({ event: value.event, source: value.currentSource, resource: value.originalResource }) };
  };
  const before = await source();
  const response = await http.get<ApiResult<unknown>>(`/rental/v1/orders/${encodeURIComponent(resource.orderId)}/payment-intents/${encodeURIComponent(resource.paymentIntentId)}/refunds`,
    { signal: active, timeout: 15000 }); check();
  const rows = response.data.data;
  if (!Array.isArray(rows) || new TextEncoder().encode(JSON.stringify(rows)).byteLength > 262144) throw Error('AI_RESOURCE_UNAVAILABLE');
  const matches = rows.filter(row => row && typeof row === 'object' && row.refundId === resource.id);
  if (matches.length !== 1) throw Error('AI_RESOURCE_UNAVAILABLE');
  const row = matches[0];
  if (row.paymentIntentId !== resource.paymentIntentId || row.orderId !== resource.orderId
    || !['pending', 'accepted', 'funding_pending', 'succeeded', 'failed', 'closed'].includes(row.status)
    || !instant(row.updatedAt) || ['acceptedAt', 'succeededAt', 'fundedAt'].some(key => row[key] !== undefined && row[key] !== null && !instant(row[key]))) throw Error('AI_RESOURCE_UNAVAILABLE');
  if ((row.status === 'failed') !== before.failed) throw Error('AI_REVISION_CONFLICT');
  const result: AutomationOriginalRefundRecord = { refundId: resource.id, paymentIntentId: resource.paymentIntentId, orderId: resource.orderId,
    status: row.status, acceptedAt: row.acceptedAt ?? null, succeededAt: row.succeededAt ?? null, fundedAt: row.fundedAt ?? null, updatedAt: row.updatedAt };
  if ((await source()).signature !== before.signature) throw Error('AI_REVISION_CONFLICT');
  check(); return result;
}
