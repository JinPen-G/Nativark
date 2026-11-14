/** Current-source candidate preparation and durable bounded batch recovery.
 * Claiming keeps the original source, lease and fence checks; original batch
 * reads authorize frozen event links without expiring or preparing candidates.
 * Explicit continuation only advances the stored batch, never selects new events. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiBusinessFailureOutbox, Prisma, PrismaClient } from '@prisma/client';
import { AI_EVENTS_DRAFT_VERSION, type AiBusinessEventDraft, type AiAutomationCandidateDraft,
  type AiAutomationPendingBatchObservationDraft } from '@rental-os/shared';
import { BusinessFailureReadAuthority, type FailureSource } from './business-failure-read.authority';
import { BusinessFailureError, isResourceFailureEvent, type FailureScope } from './prisma-business-failure-outbox';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PendingCandidateBatchRepository, type PendingCandidateBatchDb, type PendingCandidateBatchJournal,
  type PendingCandidateBatchReference, type PendingCandidateEvent } from './pending-candidate-batch.repository';

const batchRequest = z.object({ limit: z.number().int().min(1).max(10),
  operationKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).optional() }).strict();
const batchReference = batchRequest.required();
const batchContinuation = batchReference.extend({ decision: z.literal('continue_original_candidate_batch') }).strict();
const originalHash = (row: AiBusinessFailureOutbox) => requestFingerprint({ id: row.id, tenantId: row.tenantId,
  workspaceId: row.workspaceId, eventType: row.eventType, notificationId: row.notificationId, refundId: row.refundId,
  inspectionId: row.inspectionId ?? null, exceptionId: row.exceptionId ?? null, orderId: row.orderId,
  resourceRevision: row.resourceRevision, failureCode: row.failureCode, traceId: row.traceId, causationId: row.causationId,
  deduplicationKey: row.deduplicationKey, occurredAt: row.occurredAt.toISOString(), expiresAt: row.expiresAt.toISOString() });
const batchSemantics = { retryable: false as const, automaticRetry: false as const, readOnly: true as const,
  workerStarted: false as const, executionPermission: false as const, businessActionRequested: false as const,
  nextAction: 'read_original_batch' as const, sourceBasis: 'recorded_event_not_current_failure' as const };

const inputSchema = z.object({ eventId: z.string().min(1).max(36).regex(/^[a-f0-9-]+$/i) }).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BusinessFailureError('invalid_input');
  return parsed.data;
};

export class BusinessFailureCandidateService {
  constructor(private readonly db: Pick<PrismaClient, 'aiBusinessFailureOutbox'>,
    private readonly authority: BusinessFailureReadAuthority, private readonly clock: () => Date = () => new Date(),
    private readonly batchDb?: PendingCandidateBatchDb) {}

  async read(value: unknown) {
    const { eventId } = parse(inputSchema, value), { scope } = await this.authority.current();
    const row = await this.load(scope, eventId);
    return this.authority.withEvent(row, async source => {
      if (!this.current(row, source)) return this.invalidate(row, 'expired');
      return this.view(row, source);
    });
  }

  async prepare(value: unknown) {
    const { eventId } = parse(inputSchema, value), { scope } = await this.authority.current();
    const row = await this.load(scope, eventId);
    return this.authority.withEvent(row, async source => {
      if (!this.current(row, source)) return this.invalidate(row, 'expired');
      if (['ready', 'closed', 'expired', 'dead_letter'].includes(row.status)) return this.view(row, source);
      const now = this.clock();
      if (row.status === 'claimed' && row.leaseUntil && row.leaseUntil > now || row.nextAttemptAt > now) return this.view(row, source);
      if (row.attempts >= 3) return this.invalidate(row, 'dead_letter');
      const leaseOwner = randomUUID();
      const claim = await this.db.aiBusinessFailureOutbox.updateMany({ where: {
        id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, fence: row.fence, attempts: { lt: 3 }, expiresAt: { gt: now },
        OR: [{ status: { in: ['pending', 'retry_scheduled'] }, nextAttemptAt: { lte: now } }, { status: 'claimed', leaseUntil: { lte: now } }]
      }, data: { status: 'claimed', leaseOwner, leaseUntil: new Date(now.getTime() + 10000), fence: { increment: 1 }, attempts: { increment: 1 } } });
      if (claim.count !== 1) return this.view(await this.load(scope, row.id), source);
      const claimed = await this.load(scope, row.id);
      if (claimed.leaseOwner !== leaseOwner || claimed.fence !== row.fence + 1) throw new BusinessFailureError('result_unknown');
      try {
        return await this.authority.withEvent(claimed, async fresh => {
          const state = this.current(claimed, fresh) ? 'ready' : 'expired';
          await this.finish(claimed, state);
          return this.view(await this.load(scope, row.id), fresh);
        });
      } catch (error) {
        const state = claimed.attempts >= 3 ? 'dead_letter' : 'retry_scheduled';
        try { await this.finish(claimed, state, 'source_unavailable'); }
        catch { throw new BusinessFailureError('result_unknown'); }
        throw error;
      }
    });
  }

  async preparePending(value: unknown) {
    const input = parse(batchRequest, value);
    if (input.operationKey !== undefined) return this.prepareBatch({ ...input, operationKey: input.operationKey });
    // Published limit-only consumers retain their original contract/algorithm.
    // New durable batch callers must supply their original operation key.
    const binding = ({ context, scope }: Awaited<ReturnType<BusinessFailureReadAuthority['current']>>) =>
      requestFingerprint({ scope, actor: context.actor, audience: context.audience, contextScope: context.scope,
        access: 'access' in context ? context.access : null });
    const initial = await this.authority.current(), { scope } = initial, principal = binding(initial), now = this.clock();
    const assertCurrent = async () => {
      if (binding(await this.authority.current()) !== principal) throw new BusinessFailureError('unavailable');
    };
    const rows = await this.db.aiBusinessFailureOutbox.findMany({ where: { ...scope,
      OR: [{ status: { in: ['pending', 'retry_scheduled'] }, nextAttemptAt: { lte: now } }, { status: 'claimed', leaseUntil: { lte: now } }] },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: input.limit, select: { id: true } });
    await assertCurrent();
    for (const row of rows) {
      await this.prepare({ eventId: row.id });
      await assertCurrent();
    }
    const items = [];
    for (const row of rows) {
      items.push(await this.read({ eventId: row.id }));
      await assertCurrent();
    }
    return { items, coverage: 'bounded_authorized_window' as const, workerStarted: false as const };
  }

  private batches() {
    if (!this.batchDb) throw new BusinessFailureError('unavailable');
    return new PendingCandidateBatchRepository(this.batchDb, this.clock);
  }

  private async batchIdentity(input: z.infer<typeof batchReference>) {
    const current = await this.authority.current(), { context, scope } = current;
    if (context.actor.kind !== 'user' || !['operator', 'staff'].includes(context.audience)) throw new BusinessFailureError('unavailable');
    const reference: PendingCandidateBatchReference = { ...input, ...scope, userId: context.actor.userId,
      audience: context.audience as 'operator' | 'staff' };
    const principal = requestFingerprint({ actor: context.actor, audience: context.audience, scope: context.scope,
      access: 'access' in context ? context.access : null });
    return { reference, principal };
  }

  private async sameBatchIdentity(input: z.infer<typeof batchReference>, principal: string) {
    if ((await this.batchIdentity(input)).principal !== principal) throw new BusinessFailureError('unavailable');
  }

  private async prepareBatch(input: z.infer<typeof batchReference>) {
    const batches = this.batches(), identity = await this.batchIdentity(input);
    const response = () => this.batchResponse(input);
    // Existing keys never enter the current source/claim path.
    let prior: PendingCandidateBatchJournal | null;
    try { prior = await batches.read(identity.reference); } catch { return response(); }
    if (prior) return response();
    let admitted: Awaited<ReturnType<PendingCandidateBatchRepository['create']>>;
    try {
      admitted = await batches.create(identity.reference, async tx => {
        await this.sameBatchIdentity(input, identity.principal);
        const now = this.clock(), rows = await tx.aiBusinessFailureOutbox.findMany({ where: { tenantId: identity.reference.tenantId,
          workspaceId: identity.reference.workspaceId,
          OR: [{ status: { in: ['pending', 'retry_scheduled'] }, nextAttemptAt: { lte: now } },
            { status: 'claimed', leaseUntil: { lte: now } }] }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
          take: input.limit, select: { id: true } });
        if (rows.length > input.limit || new Set(rows.map(row => row.id)).size !== rows.length) throw new BusinessFailureError('unavailable');
        const events: PendingCandidateEvent[] = [];
        for (const selected of rows) {
          const row = await this.load(identity.reference, selected.id, tx);
          await this.authority.withOriginalEvent(row, async event => {
            events.push({ eventId: row.id, originalHash: originalHash(row), bindingHash: requestFingerprint(event) });
          }, tx);
          await this.sameBatchIdentity(input, identity.principal);
        }
        return events;
      }, async (tx, events) => {
        for (const event of events) await this.observeBatchEvent(identity.reference, event, tx);
        await this.sameBatchIdentity(input, identity.principal);
      });
    } catch { return response(); }
    if (!admitted.created) return response();
    let journal = admitted.journal;
    // Only the transaction's acknowledged creator may prepare this fixed list.
    // Stop at the first uncertain event/confirmation; a replay observes only.
    for (const event of journal.events) {
      try {
        await this.sameBatchIdentity(input, identity.principal);
        await this.observeBatchEvent(identity.reference, event);
        await this.prepare({ eventId: event.eventId });
        await this.sameBatchIdentity(input, identity.principal);
        journal = await batches.confirm(journal, event.eventId);
      } catch { break; }
    }
    return response();
  }

  /** A new human decision may continue only the original journal's suffix.
   * Terminal markers can be confirmed through current original-event read rights;
   * unfinished markers still require the original prepare/source/lease CAS. */
  async continuePendingBatch(value: unknown): Promise<AiAutomationPendingBatchObservationDraft> {
    const { decision: _decision, ...input } = parse(batchContinuation, value);
    const batches = this.batches(), identity = await this.batchIdentity(input);
    const response = async () => {
      await this.sameBatchIdentity(input, identity.principal);
      const result = await this.readPendingBatch(input);
      await this.sameBatchIdentity(input, identity.principal);
      return result;
    };
    let journal: PendingCandidateBatchJournal | null;
    try { journal = await batches.read(identity.reference); }
    catch { return response(); }
    if (!journal) return response();
    // Authorize every frozen event before the first mutation, including the
    // already confirmed prefix. No pending-window query or journal creation.
    for (const event of journal.events) {
      await this.observeBatchEvent(identity.reference, event);
      await this.sameBatchIdentity(input, identity.principal);
    }
    const unchanged = async () => {
      const current = await batches.read(identity.reference);
      await this.sameBatchIdentity(input, identity.principal);
      if (!current || requestFingerprint(current) !== requestFingerprint(journal)) throw new BusinessFailureError('result_unknown');
    };
    const terminal = (status: AiAutomationCandidateDraft['status']) => ['ready', 'expired', 'dead_letter', 'closed'].includes(status);
    for (const event of journal.events.slice(journal.confirmed.length)) {
      try {
        await unchanged();
        const candidate = await this.observeBatchEvent(identity.reference, event);
        await this.sameBatchIdentity(input, identity.principal);
        if (!terminal(candidate.status)) {
          const row = await this.load(identity.reference, event.eventId), now = this.clock();
          if (originalHash(row) !== event.originalHash || row.status !== candidate.status || row.fence !== candidate.fence
            || row.attempts !== candidate.attempts || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || row.attempts > 3
            || !(now instanceof Date) || !Number.isFinite(now.getTime())
            || !(row.nextAttemptAt instanceof Date) || !Number.isFinite(row.nextAttemptAt.getTime())) throw new BusinessFailureError('unavailable');
          if (row.status === 'claimed') {
            if (!(row.leaseUntil instanceof Date) || !Number.isFinite(row.leaseUntil.getTime())) throw new BusinessFailureError('unavailable');
            if (row.leaseUntil > now) break;
          }
          if (row.nextAttemptAt > now) break;
          await unchanged();
          // Exactly one original preparation attempt per event in this command.
          // An uncertain acknowledgement stops the suffix; it is never retried here.
          await this.prepare({ eventId: event.eventId });
          await this.sameBatchIdentity(input, identity.principal);
        }
        await unchanged();
        const settled = await this.observeBatchEvent(identity.reference, event);
        if (!terminal(settled.status)) break;
        await this.sameBatchIdentity(input, identity.principal);
        journal = await batches.confirm(journal, event.eventId);
        await this.sameBatchIdentity(input, identity.principal);
      } catch { break; }
    }
    return response();
  }

  private async batchResponse(input: z.infer<typeof batchReference>) {
    const batch = await this.readPendingBatch(input);
    return { items: batch.state === 'observed' ? batch.events.filter(event => event.preparationState === 'observed')
      .map(event => event.candidate) : [], coverage: 'bounded_authorized_window' as const, workerStarted: false as const, batch };
  }

  private async observeBatchEvent(scope: FailureScope, expected: PendingCandidateEvent, tx?: Prisma.TransactionClient) {
    const row = await this.load(scope, expected.eventId, tx);
    if (originalHash(row) !== expected.originalHash) throw new BusinessFailureError('unavailable');
    const state = requestFingerprint(JSON.parse(JSON.stringify(row)));
    return this.authority.withOriginalEvent(row, async event => {
      if (requestFingerprint(event) !== expected.bindingHash) throw new BusinessFailureError('unavailable');
      // This is a recorded-event observation. It does not assert that the
      // original failure still holds, expire a marker or authorize a new task.
      return this.view(row, { revision: row.resourceRevision, failed: false, orderId: row.orderId, resourceEvent: event });
    }, tx, async () => {
      const latest = await this.load(scope, row.id, tx);
      if (requestFingerprint(JSON.parse(JSON.stringify(latest))) !== state) throw new BusinessFailureError('conflict');
    });
  }

  async readPendingBatch(value: unknown): Promise<AiAutomationPendingBatchObservationDraft> {
    const input = parse(batchReference, value), identity = await this.batchIdentity(input), batches = this.batches();
    const unknown = () => ({ ...input, state: 'unknown' as const, ...batchSemantics });
    let journal: PendingCandidateBatchJournal | null;
    try { journal = await batches.read(identity.reference); }
    catch { await this.sameBatchIdentity(input, identity.principal); return unknown(); }
    if (!journal) {
      await this.sameBatchIdentity(input, identity.principal);
      return { ...input, state: 'not_observed', ...batchSemantics };
    }
    const events: { eventId: string; preparationState: 'observed' | 'unconfirmed'; candidate: AiAutomationCandidateDraft }[] = [];
    for (const event of journal.events) {
      const candidate = await this.observeBatchEvent(identity.reference, event);
      events.push({ eventId: event.eventId, preparationState: journal.confirmed.includes(event.eventId) ? 'observed' : 'unconfirmed', candidate });
      await this.sameBatchIdentity(input, identity.principal);
    }
    // Reauthorize every original row at delivery, and then the journal itself.
    for (let index = 0; index < journal.events.length; index++) {
      if (requestFingerprint(await this.observeBatchEvent(identity.reference, journal.events[index])) !== requestFingerprint(events[index].candidate))
        throw new BusinessFailureError('conflict');
    }
    let unchanged = false;
    try { unchanged = requestFingerprint(await batches.read(identity.reference)) === requestFingerprint(journal); }
    catch { /* An unreadable final journal remains unknown after current Auth. */ }
    await this.sameBatchIdentity(input, identity.principal);
    if (!unchanged) return unknown();
    return { ...input, state: 'observed', batchId: batches.id(identity.reference), recordedAt: journal.recordedAt,
      complete: journal.confirmed.length === journal.events.length, events, ...batchSemantics };
  }

  private async load(scope: FailureScope, id: string, tx?: Prisma.TransactionClient) {
    const row = await (tx ?? this.db).aiBusinessFailureOutbox.findFirst({ where: { id, tenantId: scope.tenantId, workspaceId: scope.workspaceId } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || !Number.isSafeInteger(row.resourceRevision) || row.resourceRevision < 1 || !Number.isSafeInteger(row.fence)
      || !['pending', 'claimed', 'retry_scheduled', 'ready', 'expired', 'dead_letter', 'closed'].includes(row.status)) throw new BusinessFailureError('unavailable');
    return row;
  }

  private current(row: AiBusinessFailureOutbox, source: FailureSource) {
    return row.expiresAt > this.clock() && source.failed && source.revision === row.resourceRevision && source.orderId === row.orderId
      && (!isResourceFailureEvent(row) || source.resourceEvent && source.sourceHash && source.sourceHash === source.capturedSourceHash);
  }

  private async invalidate(row: AiBusinessFailureOutbox, status: 'expired' | 'dead_letter') {
    if (row.status === status || row.status === 'closed' || row.status === 'expired') return this.view(row);
    const result = await this.db.aiBusinessFailureOutbox.updateMany({ where: {
      id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, fence: row.fence, status: row.status
    }, data: { status, fence: { increment: 1 }, leaseOwner: null, leaseUntil: null,
      lastErrorCode: status === 'expired' ? 'resource_changed_or_expired' : 'attempts_exhausted' } });
    if (result.count !== 1) throw new BusinessFailureError('conflict');
    return this.view(await this.load(row, row.id));
  }

  private async finish(row: AiBusinessFailureOutbox, status: 'ready' | 'expired' | 'retry_scheduled' | 'dead_letter', lastErrorCode?: string) {
    const now = this.clock();
    const result = await this.db.aiBusinessFailureOutbox.updateMany({ where: {
      id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, status: 'claimed', fence: row.fence,
      leaseOwner: row.leaseOwner, leaseUntil: { gt: now }, ...(status === 'ready' ? { expiresAt: { gt: now } } : {})
    }, data: { status, leaseOwner: null, leaseUntil: null, lastErrorCode: lastErrorCode ?? null,
      ...(status === 'retry_scheduled' ? { nextAttemptAt: new Date(now.getTime() + row.attempts * 30000) } : {}) } });
    if (result.count !== 1) throw new BusinessFailureError('result_unknown');
  }

  private view(row: AiBusinessFailureOutbox, source?: FailureSource): AiAutomationCandidateDraft {
    const base = { eventId: row.id, attempts: row.attempts, fence: row.fence, taskCreated: false as const };
    if (row.status === 'ready') return { ...base, status: 'ready',
      material: { event: this.event(row, source), nextAction: 'human_review', semantics: 'candidate_not_task_or_execution' },
      retryAt: null, nextAction: 'read_original_event' };
    if (row.status === 'retry_scheduled') return { ...base, status: 'retry_scheduled', material: null,
      retryAt: row.nextAttemptAt.toISOString(), nextAction: 'read_original_event' };
    if (row.status === 'dead_letter') return { ...base, status: 'dead_letter', material: null, retryAt: null, nextAction: 'manual' };
    if (row.status === 'pending' || row.status === 'claimed' || row.status === 'closed' || row.status === 'expired')
      return { ...base, status: row.status, material: null, retryAt: null, nextAction: 'read_original_event' };
    throw new BusinessFailureError('unavailable');
  }

  private event(row: AiBusinessFailureOutbox, source?: FailureSource): AiBusinessEventDraft {
    if (isResourceFailureEvent(row)) {
      const event = source?.resourceEvent;
      if (!event || event.eventId !== row.id || event.type !== row.eventType || event.resource.version !== row.resourceRevision
        || event.scope.kind !== 'workspace' || event.scope.tenantId !== row.tenantId || event.scope.workspaceId !== row.workspaceId)
        throw new BusinessFailureError('unavailable');
      return structuredClone(event);
    }
    const base = { draftVersion: AI_EVENTS_DRAFT_VERSION, eventId: row.id, eventVersion: '1' as const,
      scope: { kind: 'workspace' as const, tenantId: row.tenantId, workspaceId: row.workspaceId },
      occurredAt: row.occurredAt.toISOString(), traceId: row.traceId, causationId: row.causationId,
      deduplicationKey: row.deduplicationKey, causalDepth: 1 };
    if (row.eventType === 'inspection.return_exception' && row.inspectionId && row.exceptionId && row.orderId
      && !row.notificationId && !row.refundId && row.failureCode === 'review_pending') {
      return { ...base, type: 'inspection.return_exception', resource: { kind: 'inspection', id: row.inspectionId, version: row.resourceRevision },
        payload: { orderId: row.orderId, exceptionId: row.exceptionId } };
    }
    if (row.inspectionId || row.exceptionId) throw new BusinessFailureError('unavailable');
    if (row.eventType === 'notification.failed' && row.notificationId && !row.refundId && row.failureCode === 'delivery_failed') {
      return { ...base, type: 'notification.failed', resource: { kind: 'notification', id: row.notificationId, version: row.resourceRevision }, payload: { failureCode: 'delivery_failed' } };
    }
    if (row.eventType === 'refund.failed' && row.refundId && !row.notificationId && row.orderId && row.failureCode === 'provider_failed') {
      return { ...base, type: 'refund.failed', resource: { kind: 'refund', id: row.refundId, version: row.resourceRevision }, payload: { orderId: row.orderId, failureCode: 'provider_failed' } };
    }
    throw new BusinessFailureError('unavailable');
  }
}
