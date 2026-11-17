/** Current original Task diagnostics from bounded, revalidated reads. Query wait
 * measures this reader only; leases and unfinished charges are not worker death
 * or retry permission. Business Outbox needs its original binding and Guard.
 * No writes, notification delivery, release, model call or SLO verdict occurs. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_ERROR_CODES, AI_STEP_TRANSITION_REASONS_DRAFT,
  validateAiTaskFaultObservationDraft, type AiTaskFaultObservationDraft,
  type AiExecutionContext, type AiTaskLifecycleObservationDraft } from '@rental-os/shared';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { TaskLifecycleObservationReader } from './task-lifecycle-observation.reader';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { BusinessFailureError } from '../business-events/prisma-business-failure-outbox';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

export type TaskFaultObservationDb = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionCharge'>
  & Partial<Pick<PrismaClient, 'aiTaskEvent' | 'aiBusinessFailureOutbox'>>;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reference = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967295);
const instant = z.string().max(40).datetime({ offset: true });
const threshold = z.number().int().min(1).max(86400000).nullable();
export const taskFaultAlertPolicySchema = z.object({ version: z.literal('task-fault-alert-policy-1'), id: reference, revision,
  scopeId: id, tenantId: reference, workspaceId: reference, actorId: reference, audience: z.enum(['operator', 'staff']),
  validFrom: instant, expiresAt: instant, thresholds: z.object({ dbQueryWaitMs: threshold, leaseOverdueMs: threshold,
    unresolvedResourceAgeMs: threshold, recoveryPendingAgeMs: threshold,
    outboxPendingCount: z.number().int().min(1).max(20).nullable(), outboxPendingAgeMs: threshold }).strict()
}).strict().refine(value => Date.parse(value.validFrom) < Date.parse(value.expiresAt)
  && (value.thresholds.outboxPendingCount === null) === (value.thresholds.outboxPendingAgeMs === null));
export type TaskFaultAlertPolicy = z.infer<typeof taskFaultAlertPolicySchema>;
export type TaskFaultTaskReference = { taskId: string; scopeId: string; inputRef: string | null;
  inputHash: string | null; creationKey: string | null; sceneCode: string; sceneVersion: string };
/** Server composition only. A policy is diagnostic, never a business grant.
 * Return null when no current published policy exists; do not seed defaults. */
export interface TaskFaultAlertPolicySource {
  read(task: Readonly<TaskFaultTaskReference>, context: AiExecutionContext): Promise<unknown | null>;
  /** A non-null alert policy needs this server-only closing witness. */
  readCurrent?(task: Readonly<TaskFaultTaskReference>, context: AiExecutionContext): unknown | null;
}
/** This source must validate the original Task/Run-to-event relation, not list
 * tenant events. It supplies references only: the reader still invokes the real
 * business read authority for each row. Neither port is accepted over HTTP. */
export interface TaskFaultBoundOutboxSource {
  capture(task: Readonly<TaskFaultTaskReference>, context: AiExecutionContext): Promise<null | {
    references: Array<{ eventId: string; runId: string; sourceRef: string }>;
    truncated: boolean; revalidate(): Promise<void>; reauthorize(): Promise<void>;
  }>;
}
export type TaskFaultObservationOptions = { monotonicMs?: () => number; alertPolicy?: TaskFaultAlertPolicySource;
  outboxBinding?: TaskFaultBoundOutboxSource;
  businessReads?: Pick<BusinessFailureReadAuthority, 'current' | 'withOriginalEvent'> };
type Recovery = AiTaskLifecycleObservationDraft['recovery'];
type AlertCode = 'db_query_wait' | 'expired_lease_with_unresolved_resources' | 'unresolved_resource_age'
  | 'bound_outbox_pending' | 'recovery_pending';
type Lease = { state: 'not_held' | 'current' | 'expired'; expiresAt: string | null; overdueMs: string | null };
type FaultAlert = { id: string; code: AlertCode; referenceId: string; runId: string | null;
  measured: string; threshold: string; semantics: 'diagnostic_only_no_retry_or_release' };
export type TaskFaultObservation = AiTaskFaultObservationDraft;

const taskSelect = { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true,
  archivedAt: true, sceneCode: true, sceneVersion: true, inputRef: true, inputHash: true, creationKey: true,
  status: true, revision: true, contractVersion: true, eventCursor: true, createdAt: true, updatedAt: true,
  scope: { select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } }
} satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, sequence: true,
  revision: true, status: true, fencingToken: true, leaseOwnerId: true, leaseExpiresAt: true,
  startedAt: true, endedAt: true } satisfies Prisma.AiRunSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true,
  actionId: true, requestFingerprint: true, status: true, errorCode: true, run: { select: runSelect }
} satisfies Prisma.AiStepSelect;
const chargeSelect = { scopeId: true, taskId: true, chargeId: true, runId: true, stepId: true, actionId: true,
  stepFingerprint: true, leaseOwnerId: true, fencingToken: true, resource: true, status: true, amount: true,
  actualAmount: true, createdAt: true, updatedAt: true, revision: true, run: { select: runSelect },
  step: { select: { id: true, scopeId: true, taskId: true, runId: true, actionId: true, requestFingerprint: true } }
} satisfies Prisma.AiTaskExecutionChargeSelect;
const eventSelect = { scopeId: true, taskId: true, cursor: true, taskRevision: true, type: true,
  occurredAt: true } satisfies Prisma.AiTaskEventSelect;
const failureEvent = z.object({ data: z.object({ stepId: id, runId: id, stepRevision: revision,
  status: z.enum(['failed', 'unknown']), reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT) }).strict(),
  initiator: z.object({ kind: z.literal('worker'), id: reference, actorKind: z.literal('USER'), actorId: reference }).strict(),
  evidence: z.object({ id: reference, revision, digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
}).passthrough();
const outboxReferences = z.object({ references: z.array(z.object({ eventId: z.string().uuid(), runId: id,
  sourceRef: reference }).strict()).max(20), truncated: z.boolean() }).strict();
// `ready` is an already prepared candidate waiting for a human, not an
// undelivered worker item. Keep dead letters visible without calling them pending.
const pendingOutbox = ['pending', 'claimed', 'retry_scheduled'] as const;
const outboxStatuses = [...pendingOutbox, 'ready', 'closed', 'expired', 'dead_letter'] as const;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
function readError(error: unknown): never {
  if (error instanceof AiTaskRepositoryError) throw error;
  if (error instanceof BusinessFailureError) throw new AiTaskRepositoryError(error.code === 'conflict' || error.code === 'result_unknown'
    ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
  if (error instanceof z.ZodError) throw unavailable();
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
const principal = ({ requestId: _request, authorizedAt: _at, ...value }: AiExecutionContext) => hash(value);
function time(value: Date) {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) throw unavailable();
  return value.getTime();
}
function unsigned(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n || value > 18446744073709551615n) throw unavailable();
  return value;
}
function fence(value: Prisma.Decimal) {
  if (!(value instanceof Prisma.Decimal) || !value.isInteger() || value.isNegative()
    || value.greaterThan('18446744073709551615')) throw unavailable();
  return value.toFixed(0);
}
function detachedRun<T extends { fencingToken: Prisma.Decimal }>(value: T) {
  return structuredClone({ ...value, fencingToken: fence(value.fencingToken) });
}
function lease(holder: string | null, expires: Date | null, now: Date): Lease {
  if ((holder === null) !== (expires === null) || holder !== null && !reference.safeParse(holder).success) throw unavailable();
  if (!expires) return { state: 'not_held', expiresAt: null, overdueMs: null };
  const age = time(now) - time(expires);
  return { state: age >= 0 ? 'expired' : 'current', expiresAt: expires.toISOString(), overdueMs: age >= 0 ? String(age) : null };
}
type Task = Prisma.AiTaskGetPayload<{ select: typeof taskSelect }>;
type Run = ReturnType<typeof detachedRun<Prisma.AiRunGetPayload<{ select: typeof runSelect }>>>;
type Lifecycle = Awaited<ReturnType<TaskLifecycleObservationReader['capture']>>;

export class TaskFaultObservationReader {
  constructor(private readonly db: TaskFaultObservationDb, private readonly actions: Pick<AiTaskRepositoryAuthority, 'resolve'>,
    private readonly clock: () => Date = () => new Date(), private readonly options: TaskFaultObservationOptions = {}) {}

  async capture(taskId: string, expected?: AiExecutionContext,
    expectedTask?: Pick<Task, 'id' | 'scopeId' | 'revision' | 'eventCursor' | 'status'>, lifecycle?: Lifecycle) {
    if (!id.safeParse(taskId).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    try {
      const initial = structuredClone(await this.actions.resolve(taskId, 'read_metadata'));
      const access = aiTaskAccessFromContext(initial, taskId, this.clock()), identity = principal(initial);
      if (initial.actor.kind !== 'user' || initial.scope.kind !== 'workspace' || !['operator', 'staff'].includes(initial.audience)
        || expected && principal(expected) !== identity) throw denied();
      const authorize = async () => {
        for (const operation of ['read_metadata', 'read_events', 'read_step_terminal'] as const) {
          const current = await this.actions.resolve(taskId, operation);
          aiTaskAccessFromContext(current, taskId, this.clock());
          if (principal(current) !== identity) throw denied();
        }
      };
      await authorize();
      let queryCount = 0, cumulativeWait = 0n, maximumWait = 0n;
      const monotonic = this.options.monotonicMs ?? (() => performance.now());
      const query = async <T>(read: () => PromiseLike<T>): Promise<T> => {
        const start = monotonic(), value = await read(), end = monotonic(), duration = Math.ceil(end - start);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || !Number.isSafeInteger(duration) || duration < 0
          || queryCount >= 200 || cumulativeWait + BigInt(duration) > 18446744073709551615n) throw unavailable();
        queryCount++; cumulativeWait += BigInt(duration); maximumWait = maximumWait > BigInt(duration) ? maximumWait : BigInt(duration);
        return value;
      };
      const readTask = () => query(() => this.db.aiTask.findFirst({ where: access.where, select: taskSelect }));
      const task = structuredClone(await readTask()), window = this.clock();
      if (!task || task.id !== taskId || task.scopeKind !== 'WORKSPACE' || task.ownerKind !== access.actorKind
        || task.ownerId !== access.actorId || task.audience !== access.audience || task.archivedAt !== null
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || !id.safeParse(task.scopeId).success
        || !revision.safeParse(task.revision).success || !AI_TASK_STATUSES_DRAFT.includes(task.status.toLowerCase() as never)
        || !task.scope || task.scope.id !== task.scopeId || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)
        || time(task.createdAt) > time(window) || time(task.updatedAt) > time(window) || time(task.updatedAt) < time(task.createdAt)) throw unavailable();
      unsigned(task.eventCursor);
      if (expectedTask && (['id', 'scopeId', 'revision', 'eventCursor', 'status'] as const).some(key => expectedTask[key] !== task[key])) throw conflict();
      const related = { scopeId: task.scopeId, taskId, task: { is: access.where } };
      const validateRun = (run: Run) => {
        if (run.scopeId !== task.scopeId || run.taskId !== taskId || run.actorKind !== access.actorKind || run.actorId !== access.actorId
          || !id.safeParse(run.id).success || !revision.safeParse(run.revision).success || !revision.safeParse(run.sequence).success
          || !AI_TASK_STATUSES_DRAFT.includes(run.status.toLowerCase() as never)
          || run.leaseOwnerId !== null && run.fencingToken === '0') throw unavailable();
        lease(run.leaseOwnerId, run.leaseExpiresAt, window);
        if (run.startedAt && (time(run.startedAt) < time(task.createdAt) || time(run.startedAt) > time(window))
          || run.endedAt && (time(run.endedAt) > time(window) || run.startedAt && time(run.endedAt) < time(run.startedAt))) throw unavailable();
      };
      const readRuns = async () => (await query(() => this.db.aiRun.findMany({ where: { ...related, actorKind: access.actorKind, actorId: access.actorId },
        orderBy: [{ sequence: 'desc' }, { id: 'asc' }], take: 21, select: runSelect }))).map(detachedRun);
      const readCharges = async () => (await query(() => this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: task.scopeId, taskId,
        status: { in: ['RESERVED', 'UNKNOWN'] }, budget: { is: { task: { is: access.where } } } },
        orderBy: [{ createdAt: 'asc' }, { chargeId: 'asc' }], take: 101, select: chargeSelect })))
        .map(row => structuredClone({ ...row, fencingToken: fence(row.fencingToken), run: detachedRun(row.run) }));
      const readFailures = async () => (await query(() => this.db.aiStep.findMany({ where: { ...related, status: { in: ['FAILED', 'UNKNOWN'] } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 21, select: stepSelect })))
        .map(row => structuredClone({ ...row, run: detachedRun(row.run) }));
      const timelineAvailable = typeof this.db.aiTaskEvent?.findMany === 'function';
      const readEvents = async () => timelineAvailable ? structuredClone(await query(() => this.db.aiTaskEvent!.findMany({ where: {
        ...related, cursor: { lte: task.eventCursor }, taskRevision: { lte: task.revision } },
        orderBy: { cursor: 'desc' }, take: 101, select: eventSelect }))) : [];
      const runs = await readRuns(), charges = await readCharges(), failures = await readFailures(), events = await readEvents();
      // Timeline pagination needs metadata only. Read payloads just for the
      // bounded current failed/unknown step revisions, including older witnesses
      // outside the last timeline page; never copy their body into diagnostics.
      const readFailureEvents = async () => timelineAvailable && failures.length ? structuredClone(await query(() => this.db.aiTaskEvent!.findMany({
        where: { ...related, type: 'step.changed', cursor: { lte: task.eventCursor }, taskRevision: { lte: task.revision },
          OR: failures.slice(0, 20).map(step => ({ AND: [{ payload: { path: '$.data.stepId', equals: step.id } },
            { payload: { path: '$.data.stepRevision', equals: step.revision } }] })) },
        orderBy: { cursor: 'desc' }, take: 21, select: { ...eventSelect, payload: true } }))) : [];
      const failureEvents = await readFailureEvents();
      if (runs.length > 21 || charges.length > 101 || failures.length > 21 || events.length > 101
        || new Set(runs.map(row => row.id)).size !== runs.length || new Set(charges.map(row => row.chargeId)).size !== charges.length
        || failureEvents.length > 20 || new Set(failures.map(row => row.id)).size !== failures.length
        || new Set(events.map(row => row.cursor)).size !== events.length
        || new Set(failureEvents.map(row => row.cursor)).size !== failureEvents.length) throw unavailable();
      runs.forEach(validateRun);
      for (const row of charges) {
        validateRun(row.run);
        if (row.scopeId !== task.scopeId || row.taskId !== taskId || row.runId !== row.run.id || !id.safeParse(row.chargeId).success
          || !reference.safeParse(row.leaseOwnerId).success || !revision.safeParse(row.revision).success
          || !['RESERVED', 'UNKNOWN'].includes(row.status) || !['STEPS', 'CALLS', 'ACTIVE_MS', 'OUTPUT_BYTES'].includes(row.resource)
          || row.actionId !== null && !reference.safeParse(row.actionId).success || row.stepId !== null && !id.safeParse(row.stepId).success
          || row.actualAmount !== null || BigInt(row.fencingToken) < 1n || BigInt(row.fencingToken) > BigInt(row.run.fencingToken)
          || time(row.createdAt) < time(task.createdAt) || time(row.createdAt) > time(window) || time(row.updatedAt) > time(window)
          || (row.stepId === null) !== (row.step === null) || row.step && (row.step.id !== row.stepId || row.step.runId !== row.runId
            || row.step.scopeId !== task.scopeId || row.step.taskId !== taskId || row.actionId !== row.step.actionId
            || row.stepFingerprint !== row.step.requestFingerprint)) throw unavailable();
        unsigned(row.amount);
      }
      for (const row of failures) {
        validateRun(row.run);
        if (row.scopeId !== task.scopeId || row.taskId !== taskId || row.runId !== row.run.id || !id.safeParse(row.id).success
          || !revision.safeParse(row.revision).success || !reference.safeParse(row.actionId).success
          || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(row.requestFingerprint).success || !['FAILED', 'UNKNOWN'].includes(row.status)
          || row.errorCode !== null && (!AI_ERROR_CODES.includes(row.errorCode as never)
            || (row.status === 'UNKNOWN') !== (row.errorCode === 'AI_RESULT_UNKNOWN'))) throw unavailable();
      }
      for (const event of [...events, ...failureEvents]) {
        if (event.scopeId !== task.scopeId || event.taskId !== taskId || unsigned(event.cursor) < 1n || event.cursor > task.eventCursor
          || !revision.safeParse(event.taskRevision).success || event.taskRevision > task.revision || !reference.max(32).safeParse(event.type).success
          || time(event.occurredAt) < time(task.createdAt) || time(event.occurredAt) > time(window)) throw unavailable();
      }
      if (failureEvents.some(row => Buffer.byteLength(JSON.stringify(row.payload), 'utf8') > 4096)) throw unavailable();
      const target: TaskFaultTaskReference = { taskId, scopeId: task.scopeId, inputRef: task.inputRef, inputHash: task.inputHash,
        creationKey: task.creationKey, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion };
      const readPolicy = () => this.options.alertPolicy?.read(structuredClone(target), structuredClone(initial)) ?? Promise.resolve(null);
      const rawPolicy = structuredClone(await readPolicy());
      const assertCurrentPolicy = () => {
        const source = this.options.alertPolicy;
        if (source?.readCurrent) {
          if (!isDeepStrictEqual(source.readCurrent(structuredClone(target), structuredClone(initial)), rawPolicy)) throw conflict();
        } else if (rawPolicy !== null) throw unavailable();
      };
      let policy: TaskFaultAlertPolicy | null = null;
      if (rawPolicy !== null) {
        const parsed = taskFaultAlertPolicySchema.safeParse(rawPolicy);
        if (!parsed.success || parsed.data.scopeId !== task.scopeId || parsed.data.tenantId !== initial.scope.tenantId
          || parsed.data.workspaceId !== initial.scope.workspaceId || parsed.data.actorId !== access.actorId
          || parsed.data.audience !== initial.audience) throw unavailable();
        policy = parsed.data;
      }
      // No original binding or business authority means no Outbox assertion.
      // A Task read grant alone is deliberately insufficient.
      const business = this.options.businessReads, binding = business && this.options.outboxBinding
        && typeof this.db.aiBusinessFailureOutbox?.findMany === 'function'
        ? await this.options.outboxBinding.capture(structuredClone(target), structuredClone(initial)) : null;
      const refs = binding ? outboxReferences.parse({ references: binding.references, truncated: binding.truncated }) : null;
      if (binding && (typeof binding.revalidate !== 'function' || typeof binding.reauthorize !== 'function')
        || refs && new Set(refs.references.map(row => row.eventId)).size !== refs.references.length) throw unavailable();
      const eventIds = refs?.references.map(row => row.eventId) ?? [], boundRunIds = [...new Set(refs?.references.map(row => row.runId) ?? [])];
      const readBoundRuns = async () => boundRunIds.length ? (await query(() => this.db.aiRun.findMany({ where: { ...related,
        actorKind: access.actorKind, actorId: access.actorId, id: { in: boundRunIds } }, orderBy: { id: 'asc' }, take: 21, select: runSelect })))
        .map(detachedRun) : [];
      const readOutbox = async () => eventIds.length ? structuredClone(await query(() => this.db.aiBusinessFailureOutbox!.findMany({
        where: { id: { in: eventIds }, tenantId: initial.scope.kind === 'workspace' ? initial.scope.tenantId : '',
          workspaceId: initial.scope.kind === 'workspace' ? initial.scope.workspaceId : '' }, orderBy: { id: 'asc' }, take: 21 }))) : [];
      const readOutboxRow = async (eventId: string) => structuredClone(await query(() => this.db.aiBusinessFailureOutbox!.findMany({ where: {
        id: eventId, tenantId: initial.scope.kind === 'workspace' ? initial.scope.tenantId : '',
        workspaceId: initial.scope.kind === 'workspace' ? initial.scope.workspaceId : '' }, take: 2 })));
      const boundRuns = await readBoundRuns(), outbox = await readOutbox();
      if (boundRuns.length !== boundRunIds.length || outbox.length !== eventIds.length
        || new Set(boundRuns.map(row => row.id)).size !== boundRuns.length || new Set(outbox.map(row => row.id)).size !== outbox.length) throw unavailable();
      boundRuns.forEach(validateRun);
      for (const row of outbox) {
        if (row.tenantId !== initial.scope.tenantId || row.workspaceId !== initial.scope.workspaceId || !eventIds.includes(row.id)
          || !outboxStatuses.includes(row.status as never) || !Number.isSafeInteger(row.attempts) || row.attempts < 0
          || row.attempts > 4294967295 || time(row.occurredAt) > time(window) || time(row.createdAt) > time(window)
          || time(row.updatedAt) > time(window) || time(row.updatedAt) < time(row.createdAt)
          || time(row.expiresAt) <= time(row.occurredAt) || time(row.nextAttemptAt) < 0
          || !Number.isSafeInteger(row.fence) || row.fence < 0 || row.fence > 4294967295
          || row.status === 'claimed' && row.leaseOwner === null || row.status !== 'claimed' && row.leaseOwner !== null) throw unavailable();
        lease(row.leaseOwner, row.leaseUntil, window);
      }
      const authorizeOutbox = async (closing = false) => {
        if (!binding || !business) return;
        const current = (await business.current()).context;
        if (principal(current) !== identity) throw denied();
        for (const row of outbox) await business.withOriginalEvent(row, async original => {
          if (original.eventId !== row.id || original.type !== row.eventType || original.scope.kind !== 'workspace'
            || original.scope.tenantId !== row.tenantId || original.scope.workspaceId !== row.workspaceId) throw unavailable();
        }, undefined, closing ? async () => {
          await binding.revalidate();
          if (!isDeepStrictEqual(await readOutboxRow(row.id), [row])) throw conflict();
        } : undefined);
        await binding.reauthorize();
        if (principal((await business.current()).context) !== identity) throw denied();
      };
      await authorizeOutbox();
      const verify = async () => {
        if (!isDeepStrictEqual(await readTask(), task) || !isDeepStrictEqual(await readRuns(), runs)
          || !isDeepStrictEqual(await readCharges(), charges) || !isDeepStrictEqual(await readFailures(), failures)
          || !isDeepStrictEqual(await readEvents(), events) || !isDeepStrictEqual(await readFailureEvents(), failureEvents)
          || !isDeepStrictEqual(await readPolicy(), rawPolicy)) throw conflict();
        await binding?.revalidate();
        if (!isDeepStrictEqual(await readOutbox(), outbox) || !isDeepStrictEqual(await readBoundRuns(), boundRuns)) throw conflict();
      };
      const close = async () => {
        try {
          await authorize(); await verify(); await authorizeOutbox(true);
          // The business Guard and the authority may await after the first
          // comparison. Recheck the original rows after those calls too.
          await authorize(); await verify(); await authorize();
          await lifecycle?.revalidate();
          assertCurrentPolicy();
        } catch (error) { readError(error); }
      };
      const revalidate = async () => { try { await lifecycle?.revalidate(); await close(); } catch (error) { readError(error); } };
      const reauthorize = async () => { try { await lifecycle?.reauthorize(); await close(); } catch (error) { readError(error); } };
      const valueAt = (now: Date = this.clock()): TaskFaultObservation => {
        assertCurrentPolicy();
        if (time(now) < time(window)) throw unavailable();
        const originalRecovery: Recovery = lifecycle ? structuredClone(lifecycle.value.recovery) : { state: 'not_recorded', items: [],
          truncated: false, coverage: 'original_fenced_recovery_generations' };
        const recovery: TaskFaultObservation['recovery'] = { ...originalRecovery, items: originalRecovery.items.map(row => ({ ...row,
          pendingAgeMs: row.state === 'pending' && row.startedAt ? String(time(now) - Date.parse(row.startedAt)) : null })) };
        if (recovery.items.some(row => row.pendingAgeMs !== null && (!/^(0|[1-9][0-9]*)$/u.test(row.pendingAgeMs)))) throw unavailable();
        // Keep a known expired-lease witness in the public bounded window.
        // The extra row detects truncation; it must not create an alert whose
        // original resource evidence is absent from the delivered projection.
        const leaseWitnesses = runs.slice(0, 20).flatMap(run => {
          const witness = lease(run.leaseOwnerId, run.leaseExpiresAt, now).state === 'expired'
            ? charges.find(row => row.runId === run.id && row.fencingToken === run.fencingToken
              && row.leaseOwnerId === run.leaseOwnerId && row.amount > 0n) : undefined;
          return witness ? [witness] : [];
        });
        const visibleChargeIds = new Set(leaseWitnesses.map(row => row.chargeId));
        for (const row of charges) {
          if (visibleChargeIds.size >= 100) break;
          visibleChargeIds.add(row.chargeId);
        }
        const visibleCharges = charges.filter(row => visibleChargeIds.has(row.chargeId));
        const resourceItems: TaskFaultObservation['worker']['unresolvedResources']['items'] = visibleCharges.map(row => ({
          chargeId: row.chargeId, runId: row.runId, stepId: row.stepId, actionId: row.actionId, holderId: row.leaseOwnerId,
          fencingToken: row.fencingToken, resource: row.resource.toLowerCase() as 'steps' | 'calls' | 'active_ms' | 'output_bytes',
          status: row.status.toLowerCase() as 'reserved' | 'unknown', amount: row.amount.toString(), openedAt: row.createdAt.toISOString(),
          ageMs: String(time(now) - time(row.createdAt)) }));
        const faultItems: TaskFaultObservation['worker']['faults']['items'] = failures.slice(0, 20).map(step => {
          const matching = failureEvents.filter(row => (row.payload as { data?: { stepId?: unknown } } | null)?.data?.stepId === step.id
            && (row.payload as { data?: { stepRevision?: unknown } } | null)?.data?.stepRevision === step.revision);
          if (matching.length > 1) throw unavailable();
          const event = matching[0], proof = event && failureEvent.safeParse(event.payload);
          if (event && (!proof?.success || proof.data.data.runId !== step.runId || proof.data.data.status !== step.status.toLowerCase()
            || proof.data.initiator.actorId !== access.actorId)) throw unavailable();
          return { stepId: step.id, runId: step.runId, revision: step.revision, status: step.status.toLowerCase() as 'failed' | 'unknown',
            errorCode: step.errorCode, evidence: event && proof?.success ? { state: 'recorded', cursor: event.cursor.toString(),
              referenceId: proof.data.evidence.id, occurredAt: event.occurredAt.toISOString() } : { state: 'not_recorded' } };
        });
        const outboxItems = outbox.map(row => { const ref = refs!.references.find(value => value.eventId === row.id)!;
          return { eventId: row.id, runId: ref.runId, sourceRef: ref.sourceRef, status: row.status, attempts: row.attempts,
            lease: lease(row.leaseOwner, row.leaseUntil, now), pendingAgeMs: pendingOutbox.includes(row.status as never)
              ? String(time(now) - time(row.createdAt)) : null }; });
        const pending = outboxItems.filter(row => row.pendingAgeMs !== null), oldest = pending.reduce<bigint | null>((age, row) =>
          age === null || BigInt(row.pendingAgeMs!) > age ? BigInt(row.pendingAgeMs!) : age, null);
        let alerts: TaskFaultObservation['alerts'] = { state: 'not_evaluated' };
        if (policy && Date.parse(policy.validFrom) <= time(now) && Date.parse(policy.expiresAt) > time(now)) {
          const candidates: FaultAlert[] = [], limits = policy.thresholds;
          const add = (code: AlertCode, referenceId: string, runId: string | null, measured: bigint, limit: number | null) => {
            if (limit === null || measured < BigInt(limit)) return;
            candidates.push({ id: hash({ scopeId: task.scopeId, taskId, policyId: policy!.id, revision: policy!.revision, code, referenceId }),
              code, referenceId, runId, measured: measured.toString(), threshold: String(limit), semantics: 'diagnostic_only_no_retry_or_release' });
          };
          add('db_query_wait', taskId, null, maximumWait, limits.dbQueryWaitMs);
          for (const run of runs.slice(0, 20)) {
            const currentLease = lease(run.leaseOwnerId, run.leaseExpiresAt, now);
            if (currentLease.state === 'expired' && resourceItems.some(row => row.runId === run.id && row.fencingToken === run.fencingToken
              && row.holderId === run.leaseOwnerId && BigInt(row.amount) > 0n)) add('expired_lease_with_unresolved_resources',
                `${run.id}:${run.fencingToken}`, run.id, BigInt(currentLease.overdueMs!), limits.leaseOverdueMs);
          }
          for (const row of resourceItems) if (BigInt(row.amount) > 0n) add('unresolved_resource_age', row.chargeId, row.runId,
            BigInt(row.ageMs), limits.unresolvedResourceAgeMs);
          for (const row of recovery.items) if (row.pendingAgeMs !== null) add('recovery_pending', row.referenceId, row.runId,
            BigInt(row.pendingAgeMs), limits.recoveryPendingAgeMs);
          if (oldest !== null && limits.outboxPendingCount !== null && pending.length >= limits.outboxPendingCount) {
            const ref = pending.find(row => BigInt(row.pendingAgeMs!) === oldest)!;
            add('bound_outbox_pending', ref.eventId, ref.runId, oldest, limits.outboxPendingAgeMs);
          }
          const unique = [...new Map(candidates.map(row => [row.id, row])).values()];
          alerts = { state: 'evaluated', policyId: policy.id, policyRevision: policy.revision, items: unique.slice(0, 20), truncated: unique.length > 20,
            delivery: 'not_requested', deduplication: 'stable_original_reference_id', basis: 'trusted_server_policy_current_original_evidence' };
        }
        const value: TaskFaultObservation = { version: 'task-fault-1', observedAt: now.toISOString(), dbRead: { state: 'recorded', queryCount,
          cumulativeWaitMs: cumulativeWait.toString(), maximumWaitMs: maximumWait.toString(), resolution: 'ceiling_millisecond',
          coverage: 'this_reader_direct_queries_not_execution_latency' }, worker: { state: runs.length || charges.length || failures.length ? 'observed' : 'not_recorded',
          runs: { items: runs.slice(0, 20).map(row => ({ runId: row.id, revision: row.revision, fencingToken: row.fencingToken,
            holderId: row.leaseOwnerId, status: row.status.toLowerCase(), lease: lease(row.leaseOwnerId, row.leaseExpiresAt, now) })),
          truncated: runs.length > 20, coverage: 'latest_original_runs_window' }, unresolvedResources: { items: resourceItems,
            truncated: charges.length > 100, coverage: 'original_unresolved_charge_window_not_financial_account' },
          faults: { state: failures.length ? 'observed' : 'not_recorded', items: faultItems, truncated: failures.length > 20,
            coverage: 'original_step_state_and_matching_event_only' }, liveness: 'not_recorded',
          semantics: 'lease_and_resource_state_not_execution_or_redispatch_permission' }, events: { taskTimeline: {
          state: timelineAvailable ? 'recorded' : 'not_recorded', retainedInWindow: Math.min(events.length, 100),
          firstCursor: events.slice(0, 100).at(-1)?.cursor.toString() ?? null, lastCursor: events[0]?.cursor.toString() ?? null,
          taskCursor: task.eventCursor.toString(), truncated: events.length > 100, deliveryBacklog: 'not_recorded',
          coverage: 'retained_task_timeline_not_business_outbox' }, businessOutbox: refs && refs.references.length > 0 ? { state: 'recorded', items: outboxItems,
          pendingInWindow: pending.length, oldestPendingAgeMs: oldest?.toString() ?? null, truncated: refs.truncated,
          coverage: 'original_task_bound_business_outbox_window' } : { state: 'not_recorded' } }, recovery, alerts,
          consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_dispatch_or_release', slo: 'not_evaluated' };
        if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536 || !validateAiTaskFaultObservationDraft(value)) throw unavailable();
        return value;
      };
      await close();
      return { valueAt, revalidate, reauthorize, assertCurrentPolicy };
    } catch (error) { readError(error); }
  }
}
