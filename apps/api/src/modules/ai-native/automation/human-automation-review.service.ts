import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiAutomationReviewOperation, type AiBusinessFailureOutbox } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext, type AiAutomationReviewDraft, type AiAutomationReviewsForEventDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { hasEffectivePermission } from '../../../common/permission-match';
import { BusinessFailureReadAuthority, type FailureSource } from '../business-events/business-failure-read.authority';
import { aiPersistenceScopeColumns } from '../persistence-scope';

const uuid = z.string().uuid(), revision = z.number().int().min(1).max(4294967293);
const fence = z.number().int().min(0).max(4294967293);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const reason = z.enum(['resolved', 'dismissed', 'duplicate', 'not_applicable']);
const feedback = z.enum(['helpful', 'not_helpful', 'incorrect', 'not_applicable']);
const readInput = z.object({ inputRef: uuid }).strict();
const eventInput = z.object({ eventId: uuid, limit: z.number().int().min(1).max(10), after: uuid.optional() }).strict();
const frozenMode = z.object({ version: z.literal('automation-input-1'), trust: z.literal('untrusted_data'),
  purpose: z.literal('review_only'), mode: z.enum(['shadow', 'manual_confirmation']) }).passthrough();
const operationInput = readInput.extend({ operationKey: key }).strict();
const mutation = operationInput.extend({ expectedRevision: revision, expectedEventFence: fence, expectedTaskId: uuid.nullable() }).strict();
const closeInput = mutation.extend({ reason }).strict();
const feedbackInput = mutation.extend({ code: feedback }).strict();
const grantTargetInput = readInput.extend({ action: z.enum(['close', 'feedback']) }).strict();
type Command = (z.infer<typeof closeInput> & { action: 'close' }) | (z.infer<typeof feedbackInput> & { action: 'feedback' });
type ReadDb = Pick<PrismaClient, 'aiAutomationInput' | 'aiBusinessFailureOutbox' | 'aiScope' | 'aiTask' | 'aiAutomationReviewGrant' | 'aiAutomationReviewOperation' | 'operationLog'>;
const taskSelect = { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true,
  policyId: true, policyRevision: true, sceneCode: true, sceneVersion: true, creationKey: true, inputRef: true, inputHash: true, inputRevision: true,
  contractVersion: true, status: true, revision: true, archivedAt: true,
  runs: { where: { sequence: 1 }, take: 2, select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true } } } satisfies Prisma.AiTaskSelect;
const readSemantics = { executionPermission: false as const, businessActionRequested: false as const };
const principal = (context: AiExecutionContext) => requestFingerprint({ actor: context.actor, audience: context.audience,
  scope: context.scope, access: 'access' in context ? context.access : null });
export class HumanAutomationReviewError extends Error {
  readonly retryable = false;
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'conflict') { super(code); }
}
const unavailable = () => new HumanAutomationReviewError('unavailable');
const conflict = () => new HumanAutomationReviewError('conflict');
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HumanAutomationReviewError('invalid_input');
  return result.data;
};
type Target = Awaited<ReturnType<HumanAutomationReviewService['load']>>;

/** Internal current-human target, not a public grant or policy. The publication
 * policy consumer supplies concrete permissions and TTL separately. */
export type HumanAutomationReviewGrantTarget = {
  scopeId: string; tenantId: string; workspaceId: string; userId: string; actorKind: 'user'; actorId: string;
  audience: 'operator' | 'staff'; inputId: string; eventId: string; action: 'close' | 'feedback';
  expectedRevision: number; resourceHash: string; inputHash: string; creationKey: string;
  reviewStatus: 'open' | 'closed'; eventStatus: string; principalFingerprint: string; sourceFingerprint: string;
  targetFingerprint: string; resource: Target['resource']; context: AiExecutionContext;
};
export type HumanAutomationOriginalGrantTarget = Pick<HumanAutomationReviewGrantTarget,
  'scopeId' | 'tenantId' | 'workspaceId' | 'userId' | 'actorKind' | 'actorId' | 'audience' | 'inputId' | 'eventId'
  | 'action' | 'expectedRevision' | 'resourceHash' | 'inputHash' | 'creationKey' | 'reviewStatus' | 'eventStatus'
  | 'principalFingerprint' | 'sourceFingerprint' | 'resource'>;
export type HumanAutomationCurrentGrantPort = (inputRef: string, action: 'close' | 'feedback', db: ReadDb,
  original: HumanAutomationOriginalGrantTarget) => Promise<{ id: string; revision: number; policyFingerprint: string; preparedRef: string }>;

export class HumanAutomationReviewService {
  constructor(private readonly db: ReadDb & Pick<PrismaClient, '$transaction'>,
    private readonly reads: BusinessFailureReadAuthority, private readonly clock: () => Date = () => new Date(),
    /** Required only for new metadata writes. Historical reads use original access. */
    private readonly currentGrant?: HumanAutomationCurrentGrantPort) {}

  private async load(inputRef: string, db: ReadDb) {
    const { context, scope } = await this.reads.current();
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !['operator', 'staff'].includes(context.audience) || !('access' in context)) throw unavailable();
    const row = await db.aiAutomationInput.findFirst({ where: { id: inputRef, ...scope } });
    if (!row || row.id !== inputRef || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || row.inputRevision !== 1 || !revision.safeParse(row.reviewRevision).success
      || !['prepared', 'creation_unknown', 'linked'].includes(row.status) || !['open', 'closed'].includes(row.reviewStatus)
      || (row.reviewStatus === 'closed' ? !reason.safeParse(row.closeReason).success : row.closeReason !== null)
      || row.feedbackCode !== null && !feedback.safeParse(row.feedbackCode).success
      || !/^[a-f0-9]{64}$/u.test(row.inputHash) || requestFingerprint(row.payload) !== row.inputHash) throw unavailable();
    const payload = frozenMode.safeParse(row.payload);
    if (!payload.success) throw unavailable();
    const expectedScope = aiPersistenceScopeColumns(context.scope);
    const storedScope = await db.aiScope.findFirst({ where: { id: row.scopeId, ...expectedScope } });
    if (!storedScope || storedScope.id !== row.scopeId
      || Object.entries(expectedScope).some(([name, value]) => storedScope[name as keyof typeof storedScope] !== value)) throw unavailable();
    const event = await db.aiBusinessFailureOutbox.findFirst({ where: { id: row.eventId, ...scope } });
    if (!event || event.id !== row.eventId || event.tenantId !== scope.tenantId || event.workspaceId !== scope.workspaceId
      || event.resourceRevision !== row.resourceRevision || event.deduplicationKey !== row.deduplicationKey
      || !fence.safeParse(event.fence).success) throw unavailable();
    const task = await db.aiTask.findFirst({ where: { scopeId: row.scopeId, creationKey: row.creationKey,
      audience: 'AUTOMATION', ownerKind: 'AUTOMATION', ownerId: row.subjectId }, select: taskSelect });
    if (task) {
      const expected = { scopeId: row.scopeId, scopeKind: 'WORKSPACE', audience: 'AUTOMATION', ownerKind: 'AUTOMATION', ownerId: row.subjectId,
        policyId: row.policyId, policyRevision: row.policyRevision, creationKey: row.creationKey, inputRef: row.id,
        inputHash: row.inputHash, inputRevision: row.inputRevision, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, contractVersion: AI_TASK_DRAFT_VERSION };
      if (Object.entries(expected).some(([name, value]) => task[name as keyof typeof task] !== value)
        || task.runs.length !== 1 || task.runs[0].scopeId !== row.scopeId || task.runs[0].taskId !== task.id
        || task.runs[0].actorKind !== 'AUTOMATION' || task.runs[0].actorId !== row.subjectId) throw unavailable();
    }
    if (row.status === 'linked' && (!task || row.taskId !== task.id || row.runId !== task.runs[0].id)) throw unavailable();
    const person = { actorKind: 'user' as const, actorId: context.actor.userId, audience: context.audience };
    const resource = { inputRef: row.id, inputHash: row.inputHash, creationKey: row.creationKey, eventId: event.id,
      resourceRevision: event.resourceRevision, deduplicationKey: event.deduplicationKey,
      expectedRevision: row.reviewRevision, eventFence: event.fence, taskId: task?.id ?? null, runId: task?.runs[0].id ?? null };
    return { row, event, task, person, context, scope, inputMode: payload.data.mode,
      resource, resourceHash: requestFingerprint(resource), principal: principal(context) };
  }

  private async withTarget<T>(inputRef: string, execute: (target: Target & { source: FailureSource }) => Promise<T>, db: ReadDb = this.db): Promise<T> {
    const before = await this.load(inputRef, db);
    return this.reads.withEvent(before.event, async source => {
      const current = await this.load(inputRef, db);
      if (current.principal !== before.principal || current.resourceHash !== before.resourceHash) throw conflict();
      const result = await execute({ ...current, source });
      if (principal((await this.reads.current()).context) !== current.principal) throw unavailable();
      return result;
    });
  }

  private async withStableTarget<T>(inputRef: string, read: (target: Target & { source: FailureSource }) => Promise<T>): Promise<T> {
    const snapshot = (target: Target) => requestFingerprint({ row: target.row, event: target.event, task: target.task, principal: target.principal });
    let observed: string | undefined, observedSource: string | undefined;
    const result = await this.withTarget(inputRef, async target => {
      observed = snapshot(target);
      observedSource = requestFingerprint(target.source);
      return read(target);
    });
    // The final row/task read can outlive withTarget's last source authorization.
    const latest = await this.load(inputRef, this.db);
    if (snapshot(latest) !== observed) throw conflict();
    return this.reads.withEvent(latest.event, async source => {
      if (requestFingerprint(source) !== observedSource) throw conflict();
      return result;
    });
  }

  /** Feature-private policy/grant port. Fresh Auth, original Guard/Scope/source,
   * input and review bindings are checked around the callback, including within
   * the caller's original DB transaction. No permission or TTL is inferred here. */
  async withGrantTarget<T>(value: unknown, execute: (target: HumanAutomationReviewGrantTarget) => Promise<T>, db: ReadDb = this.db): Promise<T> {
    const query = parse(grantTargetInput, value);
    if (typeof execute !== 'function') throw unavailable();
    const snapshot = (target: Target) => requestFingerprint({ row: target.row, event: target.event,
      task: target.task, principal: target.principal });
    let observed: HumanAutomationReviewGrantTarget | undefined, fingerprint: string | undefined;
    const result = await this.withTarget(query.inputRef, async target => {
      if (target.context.actor.kind !== 'user' || !['operator', 'staff'].includes(target.context.audience)) throw unavailable();
      fingerprint = snapshot(target);
      const fields = { scopeId: target.row.scopeId, ...target.scope, userId: target.context.actor.userId,
        ...target.person, audience: target.person.audience as 'operator' | 'staff',
        inputId: target.row.id, eventId: target.event.id, action: query.action,
        expectedRevision: target.row.reviewRevision, resourceHash: target.resourceHash,
        inputHash: target.row.inputHash, creationKey: target.row.creationKey,
        reviewStatus: target.row.reviewStatus as 'open' | 'closed', eventStatus: target.event.status, principalFingerprint: target.principal,
        sourceFingerprint: requestFingerprint(target.source), resource: structuredClone(target.resource) };
      observed = { ...fields, targetFingerprint: requestFingerprint(fields), context: structuredClone(target.context) };
      return execute(structuredClone(observed));
    }, db);
    const latest = await this.load(query.inputRef, db);
    if (!observed || snapshot(latest) !== fingerprint || latest.principal !== observed.principalFingerprint) throw conflict();
    return this.reads.withEvent(latest.event, async source => {
      if (requestFingerprint(source) !== observed!.sourceFingerprint
        || principal((await this.reads.current()).context) !== observed!.principalFingerprint) throw unavailable();
      return result;
    });
  }

  private operationKey(target: Target, operationKey: string) {
    return { scopeId: target.row.scopeId, actorId: target.person.actorId, audience: target.person.audience, operationKey };
  }
  private hash(target: Target, command: Command) {
    return requestFingerprint({ version: 'human-automation-review-1', command, person: target.person, scope: target.scope,
      inputHash: target.row.inputHash, eventId: target.row.eventId, creationKey: target.row.creationKey });
  }
  private async grant(target: Target & { source: FailureSource }, action: Command['action'], db: ReadDb) {
    const current = (await this.reads.current()).context;
    if (principal(current) !== target.principal || !('access' in current)) throw unavailable();
    const currentPermissions = current.access.permissions;
    if (!this.currentGrant) throw unavailable();
    const original: HumanAutomationOriginalGrantTarget = {
      scopeId: target.row.scopeId, ...target.scope, userId: target.person.actorId, ...target.person,
      audience: target.person.audience as 'operator' | 'staff', inputId: target.row.id, eventId: target.event.id,
      action, expectedRevision: target.row.reviewRevision, resourceHash: target.resourceHash,
      inputHash: target.row.inputHash, creationKey: target.row.creationKey,
      reviewStatus: target.row.reviewStatus as 'open' | 'closed', eventStatus: target.event.status, principalFingerprint: target.principal,
      sourceFingerprint: requestFingerprint(target.source), resource: structuredClone(target.resource),
    };
    const published = await this.currentGrant(target.row.id, action, db, original);
    const where = { scopeId: target.row.scopeId, actorId: target.person.actorId, audience: target.person.audience,
      inputId: target.row.id, action, expectedRevision: target.row.reviewRevision };
    const row = await db.aiAutomationReviewGrant.findFirst({ where });
    if (!row || Object.entries(where).some(([name, value]) => row[name as keyof typeof row] !== value)
      || row.actorKind !== 'user' || row.tenantId !== target.scope.tenantId || row.workspaceId !== target.scope.workspaceId
      || row.eventId !== target.row.eventId || !row.enabled || row.resourceHash !== target.resourceHash
      || !revision.safeParse(row.revision).success || row.expiresAt <= this.clock()
      || !Array.isArray(row.requiredPermissions) || !row.requiredPermissions.length || row.requiredPermissions.length > 64
      || new Set(row.requiredPermissions).size !== row.requiredPermissions.length
      || row.requiredPermissions.some(permission => typeof permission !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$/u.test(permission)
        || !hasEffectivePermission(currentPermissions, permission))) throw unavailable();
    if (!published || published.id !== row.id || published.revision !== row.revision
      || !/^[a-f0-9]{64}$/u.test(published.policyFingerprint) || !/^[a-f0-9]{64}$/u.test(published.preparedRef)) throw unavailable();
    const authorizationHash = requestFingerprint({ principal: target.principal, key: where, id: row.id, revision: row.revision,
      resourceHash: row.resourceHash, permissions: row.requiredPermissions, expiresAt: row.expiresAt.toISOString(),
      publication: published.policyFingerprint, preparedRef: published.preparedRef });
    if (principal((await this.reads.current()).context) !== target.principal) throw unavailable();
    return { id: row.id, revision: row.revision, authorizationHash };
  }

  private receipt(target: Target, row: AiAutomationReviewOperation, command?: Command) {
    if (row.inputId !== target.row.id || row.eventId !== target.row.eventId || row.tenantId !== target.scope.tenantId
      || row.workspaceId !== target.scope.workspaceId || row.scopeId !== target.row.scopeId || row.actorKind !== 'user'
      || row.actorId !== target.person.actorId || row.audience !== target.person.audience
      || row.resultRevision !== row.expectedRevision + 1 || row.resultRevision > target.row.reviewRevision
      || row.eventFenceAfter < row.eventFenceBefore || row.eventFenceAfter > target.event.fence
      || !['prepared', 'creation_unknown', 'linked'].includes(row.inputStatusAtCommit)
      || !['open', 'closed'].includes(row.resultStatus) || Boolean(row.taskId) !== Boolean(row.runId)) throw conflict();
    const base = { inputRef: row.inputId, operationKey: row.operationKey, expectedRevision: row.expectedRevision,
      expectedEventFence: row.eventFenceBefore, expectedTaskId: row.taskId };
    const original: Command = row.action === 'close'
      ? { ...parse(closeInput, { ...base, reason: row.closeReason }), action: 'close' }
      : row.action === 'feedback' ? { ...parse(feedbackInput, { ...base, code: row.feedbackCode }), action: 'feedback' } : (() => { throw unavailable(); })();
    if (row.requestHash !== this.hash(target, original) || command && row.requestHash !== this.hash(target, command)) throw conflict();
    return { state: 'observed' as const, operationId: row.id, operationKey: row.operationKey, action: row.action,
      inputRef: row.inputId, eventId: row.eventId, taskId: row.taskId, runId: row.runId, revision: row.resultRevision,
      status: row.resultStatus, closeReason: row.closeReason, feedbackCode: row.feedbackCode, eventFence: row.eventFenceAfter,
      inputStatusAtCommit: row.inputStatusAtCommit, recordedAt: row.createdAt.toISOString(), retryable: false as const, ...readSemantics };
  }

  /** Current result fields only. Internal original-event material and its
   * captured binding remain available to authorization, never to the wire. */
  private sourceView(source: FailureSource): AiAutomationReviewDraft['currentSource'] {
    return { revision: source.revision, failed: source.failed, orderId: source.orderId,
      ...(source.paymentIntentId === undefined ? {} : { paymentIntentId: source.paymentIntentId }),
      ...(source.sourceHash === undefined ? {} : { sourceHash: source.sourceHash }) };
  }

  private suggestionCurrent(event: AiBusinessFailureOutbox, source: FailureSource) {
    const originalResource = event.eventType === 'fulfillment.resource_shortage' || event.eventType === 'opening.missing_configuration';
    return source.failed && source.revision === event.resourceRevision && event.expiresAt > this.clock()
      && !['closed', 'expired', 'dead_letter'].includes(event.status)
      && (!originalResource || Boolean(source.sourceHash && source.sourceHash === source.capturedSourceHash));
  }

  private originalResource(event: AiBusinessFailureOutbox, source: FailureSource): AiAutomationReviewsForEventDraft['originalResource'] {
    if (event.eventType === 'fulfillment.resource_shortage' || event.eventType === 'opening.missing_configuration') {
      const original = source.resourceEvent;
      if (!original || original.type !== event.eventType || original.eventId !== event.id
        || original.resource.version !== event.resourceRevision || original.scope.kind !== 'workspace'
        || original.scope.tenantId !== event.tenantId || original.scope.workspaceId !== event.workspaceId) throw unavailable();
      if (original.type === 'fulfillment.resource_shortage') {
        if (source.orderId !== event.orderId || original.resource.id !== event.orderId) throw unavailable();
        return { kind: 'order', id: original.resource.id, orderId: original.resource.id, version: original.resource.version };
      }
      if (original.type !== 'opening.missing_configuration' || source.orderId !== null || event.orderId !== null) throw unavailable();
      return { kind: 'configuration', id: original.resource.id, orderId: null, version: original.resource.version,
        sectionCode: original.payload.sectionCode };
    }
    if (event.eventType === 'notification.failed' && event.notificationId && !event.refundId && !event.inspectionId)
      return { kind: 'notification', id: event.notificationId, orderId: source.orderId };
    if (event.eventType === 'inspection.return_exception' && event.inspectionId && event.exceptionId && !event.notificationId && !event.refundId)
      return { kind: 'inspection', id: event.inspectionId, exceptionId: event.exceptionId, orderId: source.orderId };
    if (event.eventType === 'refund.failed' && event.refundId && !event.notificationId && !event.inspectionId)
      return { kind: 'refund', id: event.refundId, orderId: source.orderId,
        ...(source.paymentIntentId === undefined ? {} : { paymentIntentId: source.paymentIntentId }) };
    throw unavailable();
  }

  async read(value: unknown) {
    const { inputRef } = parse(readInput, value);
    return this.withStableTarget(inputRef, async target => ({ inputRef, inputStatus: target.row.status, inputHash: target.row.inputHash,
      inputMode: target.inputMode, policyReference: { policyId: target.row.policyId, revision: target.row.policyRevision },
      nextAction: target.row.reviewStatus === 'closed' ? 'read_review_operation' as const
        : !this.suggestionCurrent(target.event, target.source) ? 'read_original_resource' as const
        : target.row.status === 'creation_unknown' ? 'read_original_creation' as const : 'human_review' as const,
      review: { revision: target.row.reviewRevision, status: target.row.reviewStatus, closeReason: target.row.closeReason, feedbackCode: target.row.feedbackCode },
      event: { eventId: target.event.id, type: target.event.eventType, resourceRevision: target.event.resourceRevision,
        status: target.event.status, fence: target.event.fence, expiresAt: target.event.expiresAt.toISOString() },
      task: target.task ? { state: 'observed' as const, taskId: target.task.id, runId: target.task.runs[0].id,
        status: target.task.status.toLowerCase(), revision: target.task.revision, archived: Boolean(target.task.archivedAt) }
        : { state: 'not_observed' as const, taskId: null, runId: null },
      currentSource: this.sourceView(target.source), actionResource: target.resource, resourceHash: target.resourceHash, ...readSemantics }));
  }

  /** Read existing work for a business event, never prepare/create/re-dispatch it.
   * Historical human review remains readable under current business read
   * permission even when the original automation policy has since been disabled. */
  async forEvent(value: unknown) {
    const input = parse(eventInput, value), { context, scope } = await this.reads.current();
    const initialPrincipal = principal(context);
    const event = await this.db.aiBusinessFailureOutbox.findFirst({ where: { id: input.eventId, ...scope } });
    if (!event || event.id !== input.eventId || event.tenantId !== scope.tenantId || event.workspaceId !== scope.workspaceId) throw unavailable();
    return this.reads.withEvent(event, async source => {
      if (principal((await this.reads.current()).context) !== initialPrincipal) throw unavailable();
      const rows = await this.db.aiAutomationInput.findMany({ where: { ...scope, eventId: input.eventId,
        ...(input.after ? { id: { gt: input.after } } : {}) }, orderBy: { id: 'asc' }, take: input.limit + 1, select: { id: true } });
      if (rows.length > input.limit + 1) throw unavailable();
      const items = [];
      // hasMore also discloses existence. The sentinel must use the same
      // current resource authorization and binding as the returned rows.
      const observed = [];
      let previous = input.after ?? '';
      for (const row of rows) {
        if (!uuid.safeParse(row.id).success || row.id <= previous) throw unavailable();
        previous = row.id;
        const view = await this.read({ inputRef: row.id });
        if (view.event.eventId !== event.id || view.event.fence !== event.fence) throw conflict();
        observed.push(view);
        if (items.length < input.limit) items.push(view);
      }
      for (const view of observed) {
        if (requestFingerprint(await this.read({ inputRef: view.inputRef })) !== requestFingerprint(view)) throw conflict();
      }
      const latest = await this.db.aiBusinessFailureOutbox.findFirst({ where: { id: input.eventId, ...scope } });
      if (!latest || requestFingerprint(latest) !== requestFingerprint(event)) throw conflict();
      if (principal((await this.reads.current()).context) !== initialPrincipal) throw unavailable();
      const hasMore = rows.length > input.limit;
      return { event: { eventId: event.id, type: event.eventType, status: event.status, fence: event.fence,
        resourceRevision: event.resourceRevision }, currentSource: this.sourceView(source),
        originalResource: this.originalResource(event, source),
        inputs: { state: items.length ? 'observed' as const : 'not_observed' as const, items, hasMore,
          nextAfter: hasMore ? items[items.length - 1].inputRef : null, coverage: 'bounded_authorized_event_window' as const },
        nextAction: !this.suggestionCurrent(event, source) ? 'read_original_resource' as const : 'human_business_review' as const,
        ...readSemantics };
    });
  }

  async operation(value: unknown) {
    const { inputRef, operationKey } = parse(operationInput, value);
    return this.withStableTarget(inputRef, async target => {
      let row: AiAutomationReviewOperation | null;
      try { row = await this.db.aiAutomationReviewOperation.findFirst({ where: this.operationKey(target, operationKey) }); }
      catch { return { state: 'unknown' as const, inputRef, operationKey, retryable: false as const, nextAction: 'read_operation' as const, ...readSemantics }; }
      return row ? this.receipt(target, row) : { state: 'not_observed' as const, inputRef, operationKey,
        retryable: false as const, nextAction: 'read_operation' as const, ...readSemantics };
    });
  }

  close(value: unknown) { return this.apply({ ...parse(closeInput, value), action: 'close' }); }
  feedback(value: unknown) { return this.apply({ ...parse(feedbackInput, value), action: 'feedback' }); }

  private async apply(command: Command) {
    let attempted = false, acknowledged = false;
    try {
      return await this.withTarget(command.inputRef, async before => {
        const key = this.operationKey(before, command.operationKey);
        const existing = await this.db.aiAutomationReviewOperation.findFirst({ where: key });
        if (existing) return this.receipt(before, existing, command);
        const result = await this.db.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_business_failure_outbox WHERE id = ${before.event.id} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_inputs WHERE id = ${before.row.id} FOR UPDATE`);
          return this.withTarget(command.inputRef, async target => {
            if (target.principal !== before.principal) throw unavailable();
            if (requestFingerprint(target.task) !== requestFingerprint(before.task)) throw conflict();
            const replay = await tx.aiAutomationReviewOperation.findFirst({ where: key });
            if (replay) return this.receipt(target, replay, command);
            if (target.row.reviewRevision !== command.expectedRevision || target.event.fence !== command.expectedEventFence
              || (target.task?.id ?? null) !== command.expectedTaskId || command.action === 'close' && target.row.reviewStatus === 'closed') throw conflict();
            const grant = await this.grant(target, command.action, tx);
            await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_review_grants WHERE id = ${grant.id} FOR UPDATE`);
            if ((await this.grant(target, command.action, tx)).authorizationHash !== grant.authorizationHash) throw unavailable();
            attempted = true;
            const updated = await tx.aiAutomationInput.updateMany({ where: { id: target.row.id, ...target.scope,
              inputHash: target.row.inputHash, reviewRevision: command.expectedRevision, reviewStatus: target.row.reviewStatus }, data: {
              reviewRevision: { increment: 1 }, reviewedAt: this.clock(),
              ...(command.action === 'close' ? { reviewStatus: 'closed', closeReason: command.reason } : { feedbackCode: command.code }) } });
            if (updated.count !== 1) throw conflict();
            let eventFence = target.event.fence;
            if (command.action === 'close' && target.event.status !== 'closed') {
              const closed = await tx.aiBusinessFailureOutbox.updateMany({ where: { id: target.event.id, ...target.scope, fence: target.event.fence },
                data: { status: 'closed', fence: { increment: 1 }, leaseOwner: null, leaseUntil: null } });
              if (closed.count !== 1) throw conflict();
              eventFence++;
            }
            const receipt = await tx.aiAutomationReviewOperation.create({ data: { id: randomUUID(), ...target.scope, scopeId: target.row.scopeId,
              inputId: target.row.id, eventId: target.event.id, taskId: target.task?.id ?? null, runId: target.task?.runs[0].id ?? null,
              ...target.person, action: command.action, operationKey: command.operationKey, requestHash: this.hash(target, command),
              expectedRevision: target.row.reviewRevision, resultRevision: target.row.reviewRevision + 1,
              eventFenceBefore: target.event.fence, eventFenceAfter: eventFence,
              resultStatus: command.action === 'close' ? 'closed' : target.row.reviewStatus, inputStatusAtCommit: target.row.status,
              closeReason: command.action === 'close' ? command.reason : target.row.closeReason,
              feedbackCode: command.action === 'feedback' ? command.code : target.row.feedbackCode,
              grantId: grant.id, grantRevision: grant.revision, authorizationHash: grant.authorizationHash } });
            if ((await this.grant(target, command.action, tx)).authorizationHash !== grant.authorizationHash) throw unavailable();
            const after = await this.load(command.inputRef, tx);
            if (requestFingerprint(after.task) !== requestFingerprint(target.task)) throw conflict();
            return this.receipt(after, receipt, command);
          }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        acknowledged = true;
        return result;
      });
    } catch (error) {
      if (error instanceof HumanAutomationReviewError && !acknowledged) throw error;
      if (attempted || acknowledged) return { state: 'unknown' as const, inputRef: command.inputRef, operationKey: command.operationKey,
        retryable: false as const, nextAction: 'read_operation' as const, ...readSemantics };
      throw unavailable();
    }
  }
}
