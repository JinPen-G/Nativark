import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiBusinessFailureOutbox, PrismaClient } from '@prisma/client';
import { AI_EVENTS_DRAFT_VERSION, type AiBusinessEventDraft } from '@rental-os/shared';
import { BusinessFailureReadAuthority, type FailureSource } from './business-failure-read.authority';
import { BusinessFailureError, type FailureScope } from './prisma-business-failure-outbox';

const inputSchema = z.object({ eventId: z.string().min(1).max(36).regex(/^[a-f0-9-]+$/i) }).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BusinessFailureError('invalid_input');
  return parsed.data;
};

export class BusinessFailureCandidateService {
  constructor(private readonly db: Pick<PrismaClient, 'aiBusinessFailureOutbox'>,
    private readonly authority: BusinessFailureReadAuthority, private readonly clock: () => Date = () => new Date()) {}

  async read(value: unknown) {
    const { eventId } = parse(inputSchema, value), { scope } = await this.authority.current();
    const row = await this.load(scope, eventId);
    return this.authority.withEvent(row, async source => {
      if (!this.current(row, source)) return this.invalidate(row, 'expired');
      return this.view(row);
    });
  }

  async prepare(value: unknown) {
    const { eventId } = parse(inputSchema, value), { scope } = await this.authority.current();
    const row = await this.load(scope, eventId);
    return this.authority.withEvent(row, async source => {
      if (!this.current(row, source)) return this.invalidate(row, 'expired');
      if (['ready', 'closed', 'expired', 'dead_letter'].includes(row.status)) return this.view(row);
      const now = this.clock();
      if (row.status === 'claimed' && row.leaseUntil && row.leaseUntil > now || row.nextAttemptAt > now) return this.view(row);
      if (row.attempts >= 3) return this.invalidate(row, 'dead_letter');
      const leaseOwner = randomUUID();
      const claim = await this.db.aiBusinessFailureOutbox.updateMany({ where: {
        id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, fence: row.fence, attempts: { lt: 3 }, expiresAt: { gt: now },
        OR: [{ status: { in: ['pending', 'retry_scheduled'] }, nextAttemptAt: { lte: now } }, { status: 'claimed', leaseUntil: { lte: now } }]
      }, data: { status: 'claimed', leaseOwner, leaseUntil: new Date(now.getTime() + 10000), fence: { increment: 1 }, attempts: { increment: 1 } } });
      if (claim.count !== 1) return this.view(await this.load(scope, row.id));
      const claimed = await this.load(scope, row.id);
      if (claimed.leaseOwner !== leaseOwner || claimed.fence !== row.fence + 1) throw new BusinessFailureError('result_unknown');
      try {
        return await this.authority.withEvent(claimed, async fresh => {
          const state = this.current(claimed, fresh) ? 'ready' : 'expired';
          await this.finish(claimed, state);
          return this.view(await this.load(scope, row.id));
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
    const input = parse(z.object({ limit: z.number().int().min(1).max(10) }).strict(), value);
    const { scope } = await this.authority.current(), now = this.clock();
    const rows = await this.db.aiBusinessFailureOutbox.findMany({ where: { ...scope,
      OR: [{ status: { in: ['pending', 'retry_scheduled'] }, nextAttemptAt: { lte: now } }, { status: 'claimed', leaseUntil: { lte: now } }] },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: input.limit, select: { id: true } });
    const items = [];
    for (const row of rows) {
      try { items.push(await this.prepare({ eventId: row.id })); }
      catch (error) { if (!(error instanceof BusinessFailureError)) throw error; }
    }
    return { items, coverage: 'bounded_authorized_window' as const, workerStarted: false as const };
  }

  private async load(scope: FailureScope, id: string) {
    const row = await this.db.aiBusinessFailureOutbox.findFirst({ where: { id, tenantId: scope.tenantId, workspaceId: scope.workspaceId } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || !Number.isSafeInteger(row.resourceRevision) || row.resourceRevision < 1 || !Number.isSafeInteger(row.fence)
      || !['pending', 'claimed', 'retry_scheduled', 'ready', 'expired', 'dead_letter', 'closed'].includes(row.status)) throw new BusinessFailureError('unavailable');
    return row;
  }

  private current(row: AiBusinessFailureOutbox, source: FailureSource) {
    return row.expiresAt > this.clock() && source.failed && source.revision === row.resourceRevision && source.orderId === row.orderId;
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

  private view(row: AiBusinessFailureOutbox) {
    return { eventId: row.id, status: row.status, attempts: row.attempts, fence: row.fence,
      material: row.status === 'ready' ? { event: this.event(row), nextAction: 'human_review' as const, semantics: 'candidate_not_task_or_execution' as const } : null,
      retryAt: row.status === 'retry_scheduled' ? row.nextAttemptAt.toISOString() : null,
      nextAction: row.status === 'dead_letter' ? 'manual' as const : 'read_original_event' as const,
      taskCreated: false as const };
  }

  private event(row: AiBusinessFailureOutbox): AiBusinessEventDraft {
    const base = { draftVersion: AI_EVENTS_DRAFT_VERSION, eventId: row.id, eventVersion: '1' as const,
      scope: { kind: 'workspace' as const, tenantId: row.tenantId, workspaceId: row.workspaceId },
      occurredAt: row.occurredAt.toISOString(), traceId: row.traceId, causationId: row.causationId,
      deduplicationKey: row.deduplicationKey, causalDepth: 1 };
    if (row.eventType === 'notification.failed' && row.notificationId && !row.refundId && row.failureCode === 'delivery_failed') {
      return { ...base, type: 'notification.failed', resource: { kind: 'notification', id: row.notificationId, version: row.resourceRevision }, payload: { failureCode: 'delivery_failed' } };
    }
    if (row.eventType === 'refund.failed' && row.refundId && !row.notificationId && row.orderId && row.failureCode === 'provider_failed') {
      return { ...base, type: 'refund.failed', resource: { kind: 'refund', id: row.refundId, version: row.resourceRevision }, payload: { orderId: row.orderId, failureCode: 'provider_failed' } };
    }
    throw new BusinessFailureError('unavailable');
  }
}
