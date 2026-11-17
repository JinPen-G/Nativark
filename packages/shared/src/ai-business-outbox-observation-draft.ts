/** Original business-event diagnostics only. A bounded window is not a tenant
 * total, an AUTOMATION Task grant, notification delivery or permission to retry. */
import type { AiBusinessEventDraft } from './ai-events-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import { validateAiLeafSchemaValue } from './ai-leaf-schema-validation';

export const AI_BUSINESS_OUTBOX_OBSERVATION_HTTP_DRAFT = Object.freeze({ operation: 'candidates/observation' } as const);
export interface AiBusinessOutboxObservationRequestDraft { limit: number; after?: string; eventType?: AiBusinessEventDraft['type'] }
export type AiBusinessOutboxObservationDraft = {
  version: 'business-outbox-observation-1'; audience: 'operator' | 'staff';
  scope: { kind: 'workspace'; tenantId: string; workspaceId: string }; observedAt: string;
  query: { limit: number; after: string | null; nextAfter: string | null; truncated: boolean };
  window: { state: 'not_recorded' } | { state: 'recorded'; items: Array<{
    eventId: string; type: AiBusinessEventDraft['type']; resource: AiBusinessEventDraft['resource'];
    status: 'pending' | 'claimed' | 'retry_scheduled' | 'dead_letter'; attempts: number;
    createdAt: string; nextAttemptAt: string; expiresAt: string;
    lease: { state: 'not_held' | 'current' | 'expired'; expiresAt: string | null; overdueMs: string | null };
    pendingAgeMs: string | null }>;
    pendingInWindow: number; deadLettersInWindow: number; oldestPendingAgeMs: string | null };
  alerts: { state: 'not_evaluated' } | { state: 'evaluated'; policyId: string; policyRevision: number;
    items: Array<{ id: string; eventId: string; code: 'bound_outbox_pending'; measured: string; threshold: string;
      semantics: 'diagnostic_only_no_retry_or_release' }>; delivery: 'not_requested' };
  coverage: 'bounded_original_business_event_window_not_task_or_workspace_total';
  consistency: 'revalidated_reads_not_atomic_snapshot'; readOnly: true; workerStarted: false;
  executionPermission: false; businessActionRequested: false; automaticRetry: false; slo: 'not_evaluated';
};

const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const flag: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const count: AiLeafSchemaDraft = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
const nullable = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ anyOf: [value, { type: 'null' }] });
const eventType = choice('notification.failed', 'refund.failed', 'inspection.return_exception',
  'fulfillment.resource_shortage', 'opening.missing_configuration');
const lease: AiLeafSchemaDraft = { oneOf: [
  object({ state: choice('not_held'), expiresAt: { type: 'null' }, overdueMs: { type: 'null' } }),
  object({ state: choice('current'), expiresAt: time, overdueMs: { type: 'null' } }),
  object({ state: choice('expired'), expiresAt: time, overdueMs: count }),
] };
export const AI_BUSINESS_OUTBOX_OBSERVATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiBusinessOutboxObservationRequestDraft: object({ limit: integer(1, 20), after: uuid, eventType }, ['limit']),
  AiBusinessOutboxObservationDraft: object({ version: choice('business-outbox-observation-1'), audience: choice('operator', 'staff'),
    scope: object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }), observedAt: time,
    query: object({ limit: integer(1, 20), after: nullable(uuid), nextAfter: nullable(uuid), truncated: flag }),
    window: { oneOf: [object({ state: choice('not_recorded') }), object({ state: choice('recorded'), items: list(object({
      eventId: uuid, type: eventType, resource: object({ kind: id(), id: id(), version: integer(1, 4294967295) }),
      status: choice('pending', 'claimed', 'retry_scheduled', 'dead_letter'), attempts: integer(0, 4294967295),
      createdAt: time, nextAttemptAt: time, expiresAt: time, lease, pendingAgeMs: nullable(count) }), 20, 1),
      pendingInWindow: integer(0, 20), deadLettersInWindow: integer(0, 20), oldestPendingAgeMs: nullable(count) })] },
    alerts: { oneOf: [object({ state: choice('not_evaluated') }), object({ state: choice('evaluated'), policyId: id(),
      policyRevision: integer(1, 4294967295), items: list(object({ id: { type: 'string', pattern: '^[a-f0-9]{64}$' }, eventId: uuid,
        code: choice('bound_outbox_pending'), measured: count, threshold: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' },
        semantics: choice('diagnostic_only_no_retry_or_release') }), 1), delivery: choice('not_requested') })] },
    coverage: choice('bounded_original_business_event_window_not_task_or_workspace_total'),
    consistency: choice('revalidated_reads_not_atomic_snapshot'), readOnly: { type: 'boolean', const: true },
    workerStarted: no, executionPermission: no, businessActionRequested: no, automaticRetry: no, slo: choice('not_evaluated') }),
};

export function validateAiBusinessOutboxObservationDraft(value: unknown): value is AiBusinessOutboxObservationDraft {
  if (!validateAiLeafSchemaValue(AI_BUSINESS_OUTBOX_OBSERVATION_SCHEMAS.AiBusinessOutboxObservationDraft, value,
    AI_BUSINESS_OUTBOX_OBSERVATION_SCHEMAS)) return false;
  const observation = value as AiBusinessOutboxObservationDraft, window = observation.window;
  if (window.state === 'not_recorded') return observation.alerts.state === 'not_evaluated';
  const now = Date.parse(observation.observedAt), pending = window.items.filter(row => row.status !== 'dead_letter');
  if (window.items.length > observation.query.limit || new Set(window.items.map(row => row.eventId)).size !== window.items.length
    || pending.length !== window.pendingInWindow || window.deadLettersInWindow !== window.items.length - pending.length
    || window.items.some(row => Date.parse(row.createdAt) > now || (row.pendingAgeMs !== null) !== pending.includes(row)
      || row.pendingAgeMs !== null && BigInt(row.pendingAgeMs) !== BigInt(now - Date.parse(row.createdAt)))) return false;
  if (window.items.some(row => row.lease.state === 'expired'
    ? Date.parse(row.lease.expiresAt!) > now || BigInt(row.lease.overdueMs!) !== BigInt(now - Date.parse(row.lease.expiresAt!))
    : row.lease.state === 'current' && Date.parse(row.lease.expiresAt!) <= now)) return false;
  const oldest = pending.reduce<bigint | null>((age, row) => age === null || BigInt(row.pendingAgeMs!) > age
    ? BigInt(row.pendingAgeMs!) : age, null);
  if (window.oldestPendingAgeMs !== (oldest?.toString() ?? null)) return false;
  return observation.alerts.state !== 'evaluated' || observation.alerts.items.every(alert => {
    const source = pending.find(row => row.eventId === alert.eventId);
    return source && alert.measured === window.oldestPendingAgeMs && alert.measured === source.pendingAgeMs
      && BigInt(alert.measured) >= BigInt(alert.threshold);
  });
}
