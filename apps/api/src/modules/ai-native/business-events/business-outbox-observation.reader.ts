/** Bounded current queue facts under the original per-resource business Guard.
 * No event claim, source-failure inference, AUTOMATION Task read, model call or
 * retry occurs. Missing authorized rows never becomes a healthy empty backlog. */
import type { PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { validateAiBusinessOutboxObservationDraft, type AiBusinessEventDraft,
  type AiBusinessOutboxObservationDraft, type AiExecutionContext } from '@rental-os/shared';
import { BusinessFailureError } from './prisma-business-failure-outbox';
import type { BusinessFailureReadAuthority } from './business-failure-read.authority';
import { taskFaultAlertPolicySchema } from '../observability/task-fault-observation.reader';
import type { RuntimeTaskFaultAlertPolicySource } from '../observability/task-fault-policy.configuration';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

const querySchema = z.object({ limit: z.number().int().min(1).max(20), after: z.string().uuid().optional(),
  eventType: z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception',
    'fulfillment.resource_shortage', 'opening.missing_configuration']).optional() }).strict();
const statuses = ['pending', 'claimed', 'retry_scheduled', 'dead_letter'] as const;
const unavailable = () => new BusinessFailureError('unavailable');
const principal = ({ requestId: _request, authorizedAt: _at, ...context }: AiExecutionContext) => hash(context);
const time = (value: Date) => {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) throw unavailable();
  return value.getTime();
};
type Dependencies = {
  db: Pick<PrismaClient, 'aiBusinessFailureOutbox'>;
  reads: Pick<BusinessFailureReadAuthority, 'current' | 'withOriginalEvent'>;
  scopeId(context: AiExecutionContext): Promise<string>;
  policy?: Pick<RuntimeTaskFaultAlertPolicySource, 'readForScope' | 'readCurrentForScope'>;
  clock?: () => Date;
};

export class BusinessOutboxObservationReader {
  constructor(private readonly d: Dependencies) {}

  async read(value: unknown): Promise<AiBusinessOutboxObservationDraft> {
    const captured = await this.capture(value);
    captured.assertCurrentPolicy();
    return captured.value;
  }

  /** Keep this private handle in the request host through its final identity
   * wait. Its closing witness is never serialized or supplied by a caller. */
  async capture(value: unknown) {
    const parsed = querySchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new BusinessFailureError('invalid_input');
    const command = parsed.data, clock = this.d.clock ?? (() => new Date());
    const before = await this.d.reads.current(), identity = principal(before.context), openedAt = clock();
    if (before.context.actor.kind !== 'user' || before.context.scope.kind !== 'workspace'
      || !['operator', 'staff'].includes(before.context.audience)) throw unavailable();
    const scope = { ...before.scope }, scopeId = await this.d.scopeId(before.context);
    if (!z.string().max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(scopeId).success) throw unavailable();
    const authorize = async () => {
      if (principal((await this.d.reads.current()).context) !== identity) throw unavailable();
    };
    await authorize();
    const readRows = () => this.d.db.aiBusinessFailureOutbox.findMany({ where: { ...scope,
      status: { in: [...statuses] }, ...(command.after ? { id: { gt: command.after } } : {}),
      ...(command.eventType ? { eventType: command.eventType } : {}) }, orderBy: { id: 'asc' }, take: command.limit + 1 });
    const rows = structuredClone(await readRows());
    if (rows.length > command.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length) throw unavailable();
    const readPolicy = () => this.d.policy?.readForScope(scopeId, before.context) ?? Promise.resolve(null);
    const rawPolicy = structuredClone(await readPolicy()), policy = rawPolicy === null ? null : taskFaultAlertPolicySchema.parse(rawPolicy);
    const assertCurrentPolicy = () => {
      const source = this.d.policy;
      if (source) {
        if (typeof source.readCurrentForScope !== 'function') throw unavailable();
        if (!isDeepStrictEqual(source.readCurrentForScope(scopeId, structuredClone(before.context)), rawPolicy))
          throw new BusinessFailureError('conflict');
      }
    };
    if (policy && (policy.scopeId !== scopeId || policy.tenantId !== scope.tenantId || policy.workspaceId !== scope.workspaceId
      || policy.actorId !== before.context.actor.userId || policy.audience !== before.context.audience)) throw unavailable();
    const sources = new Map<string, AiBusinessEventDraft>();
    for (const row of rows) {
      if (!z.string().uuid().safeParse(row.id).success || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || !statuses.includes(row.status as typeof statuses[number]) || !Number.isSafeInteger(row.attempts) || row.attempts < 0
        || row.attempts > 4294967295 || time(row.createdAt) > time(openedAt) || time(row.updatedAt) > time(openedAt)
        || time(row.updatedAt) < time(row.createdAt) || time(row.expiresAt) <= time(row.occurredAt)
        || time(row.nextAttemptAt) < 0 || (row.leaseOwner === null) !== (row.leaseUntil === null)
        || (row.status === 'claimed') !== (row.leaseOwner !== null)) throw unavailable();
      if (row.leaseUntil) time(row.leaseUntil);
      const current = await this.d.reads.withOriginalEvent(row, async event => {
        if (event.eventId !== row.id || event.type !== row.eventType || event.scope.kind !== 'workspace'
          || event.scope.tenantId !== scope.tenantId || event.scope.workspaceId !== scope.workspaceId) throw unavailable();
        return structuredClone(event);
      }, undefined, async () => {
        const latest = await this.d.db.aiBusinessFailureOutbox.findFirst({ where: { id: row.id, ...scope } });
        if (!isDeepStrictEqual(latest, row)) throw new BusinessFailureError('conflict');
      });
      sources.set(row.id, current);
      await authorize();
    }
    if (!isDeepStrictEqual(await readPolicy(), rawPolicy) || !isDeepStrictEqual(await readRows(), rows))
      throw new BusinessFailureError('conflict');
    await authorize();
    if (!isDeepStrictEqual(await readRows(), rows) || !isDeepStrictEqual(await readPolicy(), rawPolicy))
      throw new BusinessFailureError('conflict');
    // Close original resource access after the bounded window/policy waits.
    // Keep the final current identity check after the original row revalidation.
    await authorize();
    // The sentinel is also authorized; a caller cannot infer another role's
    // queued row through pagination or a count. Never scan to fill a window.
    for (const row of rows) await this.d.reads.withOriginalEvent(row, async event => {
      if (hash(event) !== hash(sources.get(row.id))) throw new BusinessFailureError('conflict');
    }, undefined, async () => {
      if (!isDeepStrictEqual(await this.d.db.aiBusinessFailureOutbox.findFirst({ where: { id: row.id, ...scope } }), row))
        throw new BusinessFailureError('conflict');
    });
    await authorize();
    assertCurrentPolicy();
    const now = clock();
    if (time(now) < time(openedAt)) throw unavailable();
    const items: Extract<AiBusinessOutboxObservationDraft['window'], { state: 'recorded' }>['items'] = rows.slice(0, command.limit).map(row => {
      const source = sources.get(row.id)!;
      return { eventId: row.id, type: source.type, resource: structuredClone(source.resource),
        status: row.status as typeof statuses[number], attempts: row.attempts, createdAt: row.createdAt.toISOString(),
        nextAttemptAt: row.nextAttemptAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
        lease: row.leaseUntil ? time(row.leaseUntil) <= time(now)
          ? { state: 'expired', expiresAt: row.leaseUntil.toISOString(), overdueMs: String(time(now) - time(row.leaseUntil)) }
          : { state: 'current', expiresAt: row.leaseUntil.toISOString(), overdueMs: null }
          : { state: 'not_held', expiresAt: null, overdueMs: null },
        pendingAgeMs: row.status === 'dead_letter' ? null : String(time(now) - time(row.createdAt)) };
    });
    const pending = items.filter(row => row.pendingAgeMs !== null), oldest = pending.reduce<bigint | null>((age, row) =>
      age === null || BigInt(row.pendingAgeMs!) > age ? BigInt(row.pendingAgeMs!) : age, null);
    let alerts: AiBusinessOutboxObservationDraft['alerts'] = { state: 'not_evaluated' };
    if (items.length && policy && Date.parse(policy.validFrom) <= time(now) && Date.parse(policy.expiresAt) > time(now)) {
      const count = policy.thresholds.outboxPendingCount, age = policy.thresholds.outboxPendingAgeMs;
      const source = pending.find(row => row.pendingAgeMs === oldest?.toString());
      alerts = { state: 'evaluated', policyId: policy.id, policyRevision: policy.revision, delivery: 'not_requested',
        items: source && count !== null && age !== null && pending.length >= count && oldest! >= BigInt(age) ? [{
          id: hash({ scopeId, actor: before.context.actor, policyId: policy.id, revision: policy.revision,
            eventId: source.eventId, code: 'bound_outbox_pending' }), eventId: source.eventId, code: 'bound_outbox_pending',
          measured: oldest!.toString(), threshold: String(age), semantics: 'diagnostic_only_no_retry_or_release' }] : [] };
    }
    const result: AiBusinessOutboxObservationDraft = { version: 'business-outbox-observation-1',
      audience: before.context.audience as 'operator' | 'staff', scope: { kind: 'workspace', ...scope }, observedAt: now.toISOString(),
      query: { limit: command.limit, after: command.after ?? null, nextAfter: rows.length > command.limit ? items.at(-1)?.eventId ?? null : null,
        truncated: rows.length > command.limit }, window: items.length ? { state: 'recorded', items,
        pendingInWindow: pending.length, deadLettersInWindow: items.length - pending.length, oldestPendingAgeMs: oldest?.toString() ?? null }
        : { state: 'not_recorded' }, alerts, coverage: 'bounded_original_business_event_window_not_task_or_workspace_total',
      consistency: 'revalidated_reads_not_atomic_snapshot', readOnly: true, workerStarted: false, executionPermission: false,
      businessActionRequested: false, automaticRetry: false, slo: 'not_evaluated' };
    if (!validateAiBusinessOutboxObservationDraft(result)) throw unavailable();
    assertCurrentPolicy();
    return { value: result, assertCurrentPolicy };
  }
}
