import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AiAutomationReviewQueueItemDraft, AiAutomationReviewQueueResponseDraft } from '../../../../../../packages/shared/src/ai-automation-review-queue-http-draft';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { HumanAutomationReviewService } from './human-automation-review.service';
import { AutomationError } from './prisma-automation.authority';

const uuid = z.string().uuid();
const eventType = z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception']);
const reviewStatus = z.enum(['open', 'closed']);
const filters = z.object({ reviewStatus, eventType: eventType.optional() }).strict();
const limit = z.number().int().min(1).max(10);
const inputSchema = z.object({ limit, after: z.string().min(1).max(1536).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  filters: filters.extend({ reviewStatus: reviewStatus.default('open') }).default({ reviewStatus: 'open' }) }).strict();
const cursorSchema = z.object({ kind: z.literal('automation-review-queue-1'), order: z.literal('input_id_asc'),
  afterInputRef: uuid, filters, limit, principalFingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type View = Awaited<ReturnType<HumanAutomationReviewService['read']>>;
const unavailable = () => new AutomationError('unavailable');
const invalid = () => new AutomationError('invalid_input');

export class HumanAutomationReviewQueueService {
  constructor(private readonly db: Pick<PrismaClient, 'aiAutomationInput'>,
    private readonly reads: Pick<BusinessFailureReadAuthority, 'current'>,
    private readonly reviews: Pick<HumanAutomationReviewService, 'read'>,
    /** Trusted request binding includes organization scope, but no Bearer/requestId/time. */
    private readonly identityBinding: () => Promise<string>) {
    if (typeof db?.aiAutomationInput?.findMany !== 'function' || typeof reads?.current !== 'function'
      || typeof reviews?.read !== 'function' || typeof identityBinding !== 'function') throw unavailable();
  }

  private async current() {
    const binding = await this.identityBinding(), current = await this.reads.current();
    if (!/^[a-f0-9]{64}$/u.test(binding) || binding !== await this.identityBinding()) throw unavailable();
    const context = current.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !['operator', 'staff'].includes(context.audience)
      || !('access' in context) || current.scope.tenantId !== context.scope.tenantId || current.scope.workspaceId !== context.scope.workspaceId) throw unavailable();
    return { scope: current.scope, fingerprint: hash({ binding, actor: context.actor, audience: context.audience,
      scope: context.scope, access: context.access }) };
  }

  private async same(fingerprint: string) {
    if ((await this.current()).fingerprint !== fingerprint) throw unavailable();
  }

  private cursor(value: string) {
    try {
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.toString('base64url') !== value) throw invalid();
      const result = cursorSchema.safeParse(JSON.parse(decoded.toString('utf8')));
      if (!result.success) throw invalid();
      return result.data;
    } catch { throw invalid(); }
  }

  private item(view: View): AiAutomationReviewQueueItemDraft {
    const type = eventType.safeParse(view.event.type), status = reviewStatus.safeParse(view.review.status);
    if (!type.success || !status.success) throw unavailable();
    return { inputRef: view.inputRef, mode: view.inputMode,
      review: { ...view.review, status: status.data }, event: { ...view.event, type: type.data }, task: view.task,
      suggestionActive: view.nextAction === 'human_review' && !(view.task.state === 'observed' && view.task.archived),
      nextAction: view.nextAction };
  }

  async read(value: unknown): Promise<AiAutomationReviewQueueResponseDraft> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw invalid();
    const input = parsed.data, before = await this.current();
    const position = input.after ? this.cursor(input.after) : undefined;
    if (position && (position.principalFingerprint !== before.fingerprint || position.limit !== input.limit
      || hash(position.filters) !== hash(input.filters))) throw invalid();
    // The cursor is just a constrained keyset position. Reauthorize its anchor;
    // changing actor/filters or inventing a position cannot confer read access.
    const anchor = position ? await this.reviews.read({ inputRef: position.afterInputRef }) : undefined;
    if (anchor && (anchor.inputRef !== position!.afterInputRef || input.filters.eventType && anchor.event.type !== input.filters.eventType)) throw unavailable();
    await this.same(before.fingerprint);
    const rows = await this.db.aiAutomationInput.findMany({ where: { ...before.scope,
      reviewStatus: input.filters.reviewStatus, status: { in: ['prepared', 'creation_unknown', 'linked'] },
      ...(input.filters.eventType ? { event: { is: { ...before.scope, eventType: input.filters.eventType } } } : {}),
      ...(position ? { id: { gt: position.afterInputRef } } : {}) }, orderBy: { id: 'asc' }, take: input.limit, select: { id: true } });
    await this.same(before.fingerprint);
    if (rows.length > input.limit) throw unavailable();
    let previous = position?.afterInputRef ?? '';
    const views: View[] = [];
    for (const row of rows) {
      if (!uuid.safeParse(row.id).success || row.id <= previous) throw unavailable();
      previous = row.id;
      const view = await this.reviews.read({ inputRef: row.id });
      if (view.inputRef !== row.id || view.review.status !== input.filters.reviewStatus
        || input.filters.eventType && view.event.type !== input.filters.eventType) throw unavailable();
      await this.same(before.fingerprint);
      views.push(view);
    }
    const items: AiAutomationReviewQueueItemDraft[] = [];
    for (const view of views) {
      const latest = await this.reviews.read({ inputRef: view.inputRef });
      await this.same(before.fingerprint);
      if (hash(latest) !== hash(view)) throw unavailable();
      items.push(this.item(latest));
    }
    if (anchor && hash(await this.reviews.read({ inputRef: anchor.inputRef })) !== hash(anchor)) throw unavailable();
    await this.same(before.fingerprint);
    // No sentinel/total or scan-to-fill: every disclosed row was authorized.
    // A full window gets a resume position, not a claim that more rows exist.
    const nextAfter = items.length === input.limit ? Buffer.from(JSON.stringify({ kind: 'automation-review-queue-1', order: 'input_id_asc',
      afterInputRef: items[items.length - 1].inputRef, filters: input.filters, limit: input.limit, principalFingerprint: before.fingerprint })).toString('base64url') : null;
    return { items, nextAfter, coverage: 'bounded_authorized_window', continuation: 'position_only_not_more_results',
      readOnly: true, workerStarted: false, executionPermission: false, businessActionRequested: false };
  }
}
