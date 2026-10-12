import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiAutomationReviewOperation } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
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
type Command = (z.infer<typeof closeInput> & { action: 'close' }) | (z.infer<typeof feedbackInput> & { action: 'feedback' });
type ReadDb = Pick<PrismaClient, 'aiAutomationInput' | 'aiBusinessFailureOutbox' | 'aiScope' | 'aiTask' | 'aiAutomationReviewGrant' | 'aiAutomationReviewOperation'>;
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

export class HumanAutomationReviewService {
  constructor(private readonly db: ReadDb & Pick<PrismaClient, '$transaction'>,
    private readonly reads: BusinessFailureReadAuthority, private readonly clock: () => Date = () => new Date()) {}

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

  private operationKey(target: Target, operationKey: string) {
    return { scopeId: target.row.scopeId, actorId: target.person.actorId, audience: target.person.audience, operationKey };
  }
  private hash(target: Target, command: Command) {
    return requestFingerprint({ version: 'human-automation-review-1', command, person: target.person, scope: target.scope,
      inputHash: target.row.inputHash, eventId: target.row.eventId, creationKey: target.row.creationKey });
  }
  private async grant(target: Target, action: Command['action'], db: ReadDb) {
    const current = (await this.reads.current()).context;
    if (principal(current) !== target.principal || !('access' in current)) throw unavailable();
    const currentPermissions = current.access.permissions;
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
        || !currentPermissions.includes(permission))) throw unavailable();
    const authorizationHash = requestFingerprint({ principal: target.principal, key: where, id: row.id, revision: row.revision,
      resourceHash: row.resourceHash, permissions: row.requiredPermissions, expiresAt: row.expiresAt.toISOString() });
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

  async read(value: unknown) {
    const { inputRef } = parse(readInput, value);
    return this.withStableTarget(inputRef, async target => ({ inputRef, inputStatus: target.row.status, inputHash: target.row.inputHash,
      inputMode: target.inputMode, policyReference: { policyId: target.row.policyId, revision: target.row.policyRevision },
      nextAction: target.row.reviewStatus === 'closed' ? 'read_review_operation' as const
        : !target.source.failed || target.source.revision !== target.event.resourceRevision || target.event.expiresAt <= this.clock()
          || ['closed', 'expired', 'dead_letter'].includes(target.event.status) ? 'read_original_resource' as const
        : target.row.status === 'creation_unknown' ? 'read_original_creation' as const : 'human_review' as const,
      review: { revision: target.row.reviewRevision, status: target.row.reviewStatus, closeReason: target.row.closeReason, feedbackCode: target.row.feedbackCode },
      event: { eventId: target.event.id, type: target.event.eventType, resourceRevision: target.event.resourceRevision,
        status: target.event.status, fence: target.event.fence, expiresAt: target.event.expiresAt.toISOString() },
      task: target.task ? { state: 'observed' as const, taskId: target.task.id, runId: target.task.runs[0].id,
        status: target.task.status.toLowerCase(), revision: target.task.revision, archived: Boolean(target.task.archivedAt) }
        : { state: 'not_observed' as const, taskId: null, runId: null },
      currentSource: target.source, actionResource: target.resource, resourceHash: target.resourceHash, ...readSemantics }));
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
      const items = [];
      for (const row of rows.slice(0, input.limit)) {
        const view = await this.read({ inputRef: row.id });
        if (view.event.eventId !== event.id || view.event.fence !== event.fence) throw conflict();
        items.push(view);
      }
      for (const view of items) {
        if (requestFingerprint(await this.read({ inputRef: view.inputRef })) !== requestFingerprint(view)) throw conflict();
      }
      const latest = await this.db.aiBusinessFailureOutbox.findFirst({ where: { id: input.eventId, ...scope } });
      if (!latest || requestFingerprint(latest) !== requestFingerprint(event)) throw conflict();
      if (principal((await this.reads.current()).context) !== initialPrincipal) throw unavailable();
      const hasMore = rows.length > input.limit;
      return { event: { eventId: event.id, type: event.eventType, status: event.status, fence: event.fence,
        resourceRevision: event.resourceRevision }, currentSource: source,
        originalResource: event.notificationId
          ? { kind: 'notification' as const, id: event.notificationId, orderId: source.orderId }
          : event.inspectionId
            ? { kind: 'inspection' as const, id: event.inspectionId, exceptionId: event.exceptionId, orderId: source.orderId }
            : { kind: 'refund' as const, id: event.refundId!, orderId: source.orderId, paymentIntentId: source.paymentIntentId },
        inputs: { state: items.length ? 'observed' as const : 'not_observed' as const, items, hasMore,
          nextAfter: hasMore ? items[items.length - 1].inputRef : null, coverage: 'bounded_authorized_event_window' as const },
        nextAction: !source.failed || source.revision !== event.resourceRevision || event.expiresAt <= this.clock()
          || ['closed', 'expired', 'dead_letter'].includes(event.status) ? 'read_original_resource' as const : 'human_business_review' as const,
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
