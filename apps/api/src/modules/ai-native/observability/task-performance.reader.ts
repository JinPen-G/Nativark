/** Current owner-only task/run/resource observations from original persistence.
 * No telemetry body store, model request, financial recalculation or SLO claim.
 * Missing timestamps and samples remain explicitly unmeasured. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TERMINAL_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  type AiExecutionContext, type AiTaskPerformanceObservationDraft, type AiTaskOutcomeSampleDraft, type AiTaskStatusDraft, type AiTaskClientVisibleReportDraft, type AiTaskClientVisibleObservationDraft } from '@rental-os/shared';
import { z } from 'zod';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { TaskBudgetUsageReader } from '../budget/task-budget-usage.reader';
import { BudgetError } from '../budget/budget.ports';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { gatewayBudgetDenialLogId, gatewayDeliveryLogId, gatewayDeliveryTimingSchema } from '../prisma-task-gateway-audit';
import { CLIENT_VISIBLE_LOG_ACTION, parseClientVisibleLog } from './task-visible-observation.service';
import { PrismaTaskTakeoverRepository } from '../runner/prisma-task-takeover.repository';
import { evaluateAiTaskTransitionDraft } from '../task-transition-draft';
import { aiStepActionId } from '../ai-step-registration.repository';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { TaskLifecycleObservationReader, taskLifecycleSampleRates, type TaskLifecycleObservationDb,
  type TaskLifecycleObservation, type TaskLifecycleSampleRates } from './task-lifecycle-observation.reader';
import { TaskFaultObservationReader, type TaskFaultObservation, type TaskFaultObservationOptions } from './task-fault-observation.reader';

type Db = TaskLifecycleObservationDb & Pick<PrismaClient, 'aiGatewayInvocation'>;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ taskId: id, usageLimit: z.number().int().min(1).max(20), usageAfter: id.optional(), includeTaskFinancial: z.boolean().optional() }).strict();
const sampleSchema = z.object({ taskIds: z.array(id).min(1).max(50)
  .refine(ids => new Set(ids).size === ids.length) }).strict();
const takeoverSampleDetail = z.object({ receiptVersion: z.literal('original-run-takeover-1'), taskId: id, runId: id,
  taskRevision: z.number().int().min(1).max(4294967294), runRevision: z.number().int().min(2).max(4294967294),
  previousFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), purpose: z.literal('recovery_only') }).passthrough();
const taskSelect = { id: true, scopeId: true, sceneCode: true, sceneVersion: true, status: true, revision: true,
  contractVersion: true, eventCursor: true, createdAt: true, updatedAt: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, sequence: true,
  status: true, revision: true, fencingToken: true, leaseOwnerId: true, leaseExpiresAt: true, startedAt: true, endedAt: true } satisfies Prisma.AiRunSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true,
  toolCode: true, toolVersion: true, actionId: true, status: true, effect: true, revision: true } satisfies Prisma.AiStepSelect;
const budgetSelect = { scopeId: true, taskId: true, policyVersion: true, policyFingerprint: true, revision: true,
  maxSteps: true, reservedSteps: true, consumedSteps: true, maxCalls: true, reservedCalls: true, consumedCalls: true,
  maxActiveMs: true, reservedActiveMs: true, consumedActiveMs: true,
  maxOutputBytes: true, reservedOutputBytes: true, consumedOutputBytes: true } satisfies Prisma.AiTaskExecutionBudgetSelect;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = ({ requestId: _request, authorizedAt: _at, ...stable }: AiExecutionContext) => hash(stable);
const revision = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 4294967295;
function time(value: Date) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value.getTime(); }
function uint(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n || value > 18446744073709551615n) throw unavailable();
  return value;
}
function elapsed(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  const duration = time(end) - time(start);
  if (!Number.isSafeInteger(duration) || duration < 0) throw unavailable();
  return String(duration);
}
function fence(value: Prisma.Decimal) {
  if (!(value instanceof Prisma.Decimal) || !value.isInteger() || value.isNegative()
    || value.greaterThan('18446744073709551615')) throw unavailable();
  return value.toFixed(0);
}
// Prisma Decimal carries a constructor that structuredClone cannot copy. Keep
// immutable read snapshots as decimal strings, including subsequent comparison.
function fencedSnapshot<T extends { fencingToken: Prisma.Decimal }>(rows: T[]) {
  return structuredClone(rows.map(row => ({ ...row,
    fencingToken: row.fencingToken === undefined ? null : fence(row.fencingToken) })));
}

export class TaskPerformanceReader {
  private readonly lifecycle: TaskLifecycleObservationReader;
  private readonly faults: TaskFaultObservationReader;
  constructor(private readonly db: Db, private readonly actions: Pick<AiTaskRepositoryAuthority, 'resolve'>,
    private readonly usage: Pick<TaskBudgetUsageReader, 'read'> & Partial<Pick<TaskBudgetUsageReader, 'summary'>>, private readonly clock: () => Date = () => new Date(),
    faultOptions?: TaskFaultObservationOptions) {
    this.lifecycle = new TaskLifecycleObservationReader(db, actions, clock, usage);
    this.faults = new TaskFaultObservationReader(db, actions, clock, faultOptions);
  }

  /** A partial aggregate can close a failed/cancelled successor. Its original
   * Task event and released Run-time receipt attest that closure; status names,
   * lease expiry and Task.updatedAt cannot replace those persisted witnesses. */
  private async partialTaskEnd(task: Prisma.AiTaskGetPayload<{ select: typeof taskSelect }>,
    runs: ReturnType<typeof fencedSnapshot<Prisma.AiRunGetPayload<{ select: typeof runSelect }>>>,
    steps: Array<Prisma.AiStepGetPayload<{ select: typeof stepSelect }>>,
    budget: Prisma.AiTaskExecutionBudgetGetPayload<{ select: typeof budgetSelect }> | null,
    context: AiExecutionContext) {
    const run = runs.at(-1), db = this.db;
    if (task.status !== 'PARTIALLY_SUCCEEDED' || runs.length > 50 || steps.length > 200 || !run
      || !['FAILED', 'CANCELLED'].includes(run.status) || !run.endedAt || !budget
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
      || typeof db.aiTaskEvent?.findMany !== 'function' || typeof db.aiTaskRunOverhead?.findMany !== 'function'
      || typeof db.aiTaskRunPlan?.findMany !== 'function'
      || typeof db.aiTaskExecutionCharge.findMany !== 'function') return null;
    if (runs.some((row, index) => row.sequence !== index + 1 || !AI_TASK_TERMINAL_STATUSES_DRAFT.includes(row.status.toLowerCase() as AiTaskStatusDraft))) return null;
    const endedAt = run.endedAt, runFence = run.fencingToken;
    if (runFence === null || !/^[1-9][0-9]{0,19}$/u.test(runFence)
      || task.eventCursor < 1n || task.revision < 2 || budget.scopeId !== task.scopeId || budget.taskId !== task.id) return null;
    if (steps.some(step => !runs.some(row => row.id === step.runId))
      || runs.some(row => row.endedAt && time(row.endedAt) > time(endedAt))) throw unavailable();
    const authorize = async () => {
      for (const operation of ['read_events', 'read_step_terminal'] as const) {
        const current = await this.actions.resolve(task.id, operation);
        aiTaskAccessFromContext(current, task.id, this.clock());
        if (identity(current) !== identity(context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    };
    await authorize();
    const key = { scopeId: task.scopeId, taskId: task.id, runId: run.id };
    const readPlans = () => db.aiTaskRunPlan!.findMany({ where: key, take: 2 });
    const plans = structuredClone(await readPlans());
    if (!plans.length) return null;
    if (plans.length !== 1) throw unavailable();
    const saved = plans[0], parsedPlan = aiTaskRunPlanSchema.safeParse(saved.payload);
    if (!parsedPlan.success || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
      || saved.planHash !== hash(saved.payload) || parsedPlan.data.taskId !== task.id || parsedPlan.data.runId !== run.id) throw unavailable();
    const plan = parsedPlan.data, ownSteps = steps.filter(step => step.runId === run.id).sort((a, b) => a.sequence - b.sequence);
    const scope = aiTaskAccessFromContext(context, task.id, this.clock()).scope;
    if (ownSteps.some((step, index) => step.sequence !== index + 1 || !plan.steps[index]
      || step.actionId !== aiStepActionId(scope, task.id, plan.steps[index].registrationRef)
      || step.toolCode !== plan.steps[index].toolCode || step.toolVersion !== plan.steps[index].toolVersion)) throw unavailable();
    // With no successful step in this Run the original runner cannot pass its
    // first planned action. Even at a tied clock, startup is not that action's
    // interval. Bind the required pre interval to its frozen registration.
    const first = ownSteps[0], requiredSegment = plan.steps.length ? `pre:${plan.steps[0].registrationRef}` : 'startup';
    const readRegistrations = () => first ? db.aiTaskEvent!.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId,
      type: 'step.registered', payload: { path: '$.data.stepId', equals: first.id } }, take: 2 }) : Promise.resolve([]);
    const registrations = structuredClone(await readRegistrations());
    if (first) {
      if (!registrations.length) return null;
      if (registrations.length !== 1) throw unavailable();
      const original = registrations[0], payload = z.object({ data: z.object({ stepId: id, runId: id,
        sequence: z.number().int().positive(), stepRevision: z.literal(1) }).strict(),
      registration: z.object({ reference: z.string().min(1).max(191), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
      initiator: z.object({ kind: z.literal('worker'), id: z.string().min(1).max(191),
        actorKind: z.literal('USER'), actorId: id }).strict() }).passthrough().safeParse(original.payload);
      if (!payload.success || original.scopeId !== key.scopeId || original.taskId !== task.id || original.type !== 'step.registered'
        || uint(original.cursor) < 1n || original.cursor >= task.eventCursor || !revision(original.taskRevision)
        || original.taskRevision >= task.revision || time(original.occurredAt) > time(endedAt)
        || payload.data.data.stepId !== first.id || payload.data.data.runId !== run.id || payload.data.data.sequence !== first.sequence
        || payload.data.registration.reference !== plan.steps[0].registrationRef || payload.data.initiator.actorId !== run.actorId) throw unavailable();
    }
    const readEvents = () => db.aiTaskEvent!.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId,
      taskRevision: { lte: task.revision }, cursor: { lte: task.eventCursor }, type: 'task.transition', occurredAt: endedAt,
      payload: { path: '$.data.to', equals: 'partially_succeeded' } }, orderBy: { cursor: 'asc' }, take: 2 });
    // Rotated intervals and final settlement can share one millisecond. Verify
    // the whole bounded generation and its original charges, without guessing
    // the last interval from a segment name, ID order or wall-clock tie.
    const readOverheads = async () => fencedSnapshot(await db.aiTaskRunOverhead!.findMany({
      where: { ...key, fencingToken: new Prisma.Decimal(runFence) }, orderBy: { id: 'asc' }, take: 1001 }));
    const events = structuredClone(await readEvents()), overheads = await readOverheads();
    if (!events.length || !overheads.length) return null;
    if (overheads.length > 1000) return null;
    if (events.length !== 1 || new Set(overheads.map(row => row.id)).size !== overheads.length) throw unavailable();
    if (overheads.some(row => !row.completedAt || row.activeMs === null)) return null;
    const event = events[0];
    const envelope = z.object({ data: z.object({ from: z.enum(['running', 'cancel_requested']), to: z.literal('partially_succeeded'),
      reason: z.enum(['completed', 'cancel_settled']) }).strict(), initiator: z.object({ kind: z.literal('worker'),
      id: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), actorKind: z.literal('USER'), actorId: id }).strict() })
      .passthrough().safeParse(event.payload);
    if (!envelope.success || event.scopeId !== task.scopeId || event.taskId !== task.id || event.type !== 'task.transition'
      || !revision(event.taskRevision) || event.taskRevision < 2 || event.taskRevision > task.revision
      || uint(event.cursor) < 1n || event.cursor > task.eventCursor || time(event.occurredAt) !== time(endedAt)) throw unavailable();
    const owner = envelope.data.initiator;
    if (context.actor.kind !== 'user' || owner.actorId !== context.actor.userId || run.actorKind !== owner.actorKind
      || run.actorId !== owner.actorId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const decision = evaluateAiTaskTransitionDraft({ contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id,
      revision: event.taskRevision - 1, status: envelope.data.data.from, steps: steps.map(step => ({ stepId: step.id,
        runId: step.runId, sequence: step.sequence, revision: step.revision, actionId: step.actionId,
        outcome: { status: step.status.toLowerCase() as import('@rental-os/shared').AiStepStatusDraft,
          effect: step.effect.toLowerCase() as import('@rental-os/shared').AiStepStateDraft['outcome']['effect'] } })) },
    { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, expectedRevision: event.taskRevision - 1,
      ...envelope.data.data, occurredAt: endedAt.toISOString(), initiator: { kind: 'worker', id: owner.id } });
    if (!decision.allowed || decision.nextRevision !== event.taskRevision || ownSteps.some(step => step.status === 'SUCCEEDED')
      || run.status !== (envelope.data.data.reason === 'cancel_settled' ? 'CANCELLED' : 'FAILED')
      || envelope.data.data.reason === 'cancel_settled' && (!task.cancelRequestedAt || time(task.cancelRequestedAt) > time(endedAt)
        || !steps.some(step => step.effect === 'COMMITTED'))) throw unavailable();
    const readCharges = async () => fencedSnapshot(await db.aiTaskExecutionCharge.findMany({ where: { ...key,
      OR: [{ chargeId: { in: overheads.map(row => row.id) } }, { resource: 'ACTIVE_MS', stepId: null,
        fencingToken: new Prisma.Decimal(runFence), evidenceRef: { startsWith: 'overhead:' } }] },
      orderBy: { chargeId: 'asc' }, take: overheads.length + 1 }));
    const readPending = () => db.aiTaskExecutionCharge.findMany({ where: { ...key, resource: 'ACTIVE_MS', stepId: null,
      fencingToken: new Prisma.Decimal(runFence), status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { chargeId: true }, take: 1 });
    if ((await readPending()).length) return null;
    const charges = await readCharges();
    if (charges.length < overheads.length) return null;
    if (charges.length !== overheads.length || new Set(charges.map(row => row.chargeId)).size !== charges.length) throw unavailable();
    for (const overhead of overheads) {
      if (overhead.scopeId !== key.scopeId || overhead.taskId !== key.taskId || overhead.runId !== key.runId
        || overhead.chargeId !== overhead.id || !id.safeParse(overhead.id).success || !overhead.completedAt || overhead.activeMs === null
        || !revision(overhead.runRevision) || overhead.runRevision + 1 >= run.revision || overhead.fencingToken !== runFence
        || overhead.leaseOwnerId !== owner.id || !/^[a-f0-9]{64}$/u.test(overhead.originHash) || overhead.policyHash !== budget.policyFingerprint
        || !/^[a-f0-9]{64}$/u.test(overhead.requestFingerprint ?? '') || time(overhead.startedAt) > time(overhead.completedAt)
        || time(overhead.startedAt) > time(endedAt) || time(overhead.completedAt) >= time(overhead.expiresAt)
        || time(overhead.completedAt) > time(this.clock())) throw unavailable();
      const measurementHash = hash({ version: 'run-overhead-measurement-1', ...key, id: overhead.id,
        segment: overhead.segment, originHash: overhead.originHash, policyHash: overhead.policyHash,
        leaseOwnerId: overhead.leaseOwnerId, fencingToken: overhead.fencingToken, runRevision: overhead.runRevision,
        expiresAt: overhead.expiresAt.toISOString(), chargeId: overhead.chargeId, requestFingerprint: overhead.requestFingerprint,
        activeMs: uint(overhead.activeMs).toString(), completedAt: overhead.completedAt.toISOString() });
      const charge = charges.find(row => row.chargeId === overhead.id)!;
      if (charge.scopeId !== key.scopeId || charge.taskId !== key.taskId || charge.runId !== key.runId || charge.resource !== 'ACTIVE_MS'
        || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
        || charge.leaseOwnerId !== owner.id || charge.fencingToken !== runFence || charge.requestFingerprint !== overhead.requestFingerprint
        || overhead.measurementHash !== measurementHash || charge.status !== 'RECORDED' || charge.actualAmount !== overhead.activeMs
        || uint(charge.amount) < overhead.activeMs || charge.outcomeFingerprint !== measurementHash
        || charge.evidenceRef !== `overhead:${overhead.id}`) throw unavailable();
    }
    const closing = overheads.filter(row => row.segment === requiredSegment);
    if (!closing.length || time(closing[0].completedAt!) < time(endedAt)) return null;
    if (closing.length !== 1) throw unavailable();
    return { endedAt, revalidate: async () => {
      await authorize();
      if (!isDeepStrictEqual(await readEvents(), events) || !isDeepStrictEqual(await readOverheads(), overheads)
        || !isDeepStrictEqual(await readCharges(), charges) || !isDeepStrictEqual(await readPlans(), plans)
        || !isDeepStrictEqual(await readRegistrations(), registrations) || (await readPending()).length) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await authorize();
    } };
  }

  /** A caller-selected original sample, never a whole-tenant rate inferred
   * from one page. Each task and its independent takeover receipt need current
   * authority. Pending tasks do not become failures; SLO is not evaluated. */
  async sample(value: unknown): Promise<AiTaskOutcomeSampleDraft & { lifecycleRates: TaskLifecycleSampleRates }> {
    const parsed = sampleSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const now = this.clock(); time(now);
    const authorize = async (taskId: string, operation: 'read_metadata' | 'read_step_terminal') => {
      try {
        const context = structuredClone(await this.actions.resolve(taskId, operation));
        // Authorization completes after the observation window is captured.
        // Validate its current time without widening that original log window.
        aiTaskAccessFromContext(context, taskId, this.clock());
        return context;
      } catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
    };
    const db = this.db, transaction = db.$transaction;
    if (typeof transaction !== 'function') throw unavailable();
    const takeovers = new PrismaTaskTakeoverRepository({ aiTask: db.aiTask, aiRun: db.aiRun,
      operationLog: db.operationLog, $transaction: transaction.bind(db) }, this.actions, this.clock);
    type Item = { task: Prisma.AiTaskGetPayload<{ select: typeof taskSelect }>; status: AiTaskStatusDraft;
      context: AiExecutionContext; access: ReturnType<typeof aiTaskAccessFromContext>;
      logs: Awaited<ReturnType<typeof db.operationLog.findMany>>; takeover: boolean;
      lifecycle: Awaited<ReturnType<TaskLifecycleObservationReader['capture']>> };
    const items: Item[] = [];
    let sampleIdentity: string | undefined;
    try {
      for (const taskId of parsed.data.taskIds) {
        const context = await authorize(taskId, 'read_metadata');
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
          || !['operator', 'staff'].includes(context.audience)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const stable = identity(context);
        if (sampleIdentity !== undefined && stable !== sampleIdentity) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        sampleIdentity = stable;
        const access = aiTaskAccessFromContext(context, taskId, this.clock());
        const task = structuredClone(await db.aiTask.findFirst({ where: access.where, select: taskSelect }));
        const status = task && AI_TASK_STATUSES_DRAFT.find(status => status === task.status.toLowerCase());
        if (!task || task.id !== taskId || !status || !revision(task.revision) || !task.scopeId
          || time(task.createdAt) > time(now) || time(task.updatedAt) < time(task.createdAt)) throw unavailable();
        if (items.length && (task.scopeId !== items[0].task.scopeId || task.sceneCode !== items[0].task.sceneCode
          || task.sceneVersion !== items[0].task.sceneVersion)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        // Metadata permission cannot stand in for the original receipt's read
        // permission, even when the scoped receipt query finds no row.
        if (identity(await authorize(taskId, 'read_step_terminal')) !== stable)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const logs = structuredClone(await db.operationLog.findMany({ where: { tenantId: context.scope.tenantId,
          workspaceId: context.scope.workspaceId, userId: access.actorId, action: 'ai_task_run_takeover',
          detail: { path: '$.taskId', equals: taskId }, createdAt: { lte: now } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 }));
        if (logs.length > 2 || new Set(logs.map(row => row.id)).size !== logs.length) throw unavailable();
        let takeover = false;
        for (const row of logs) {
          const detail = takeoverSampleDetail.safeParse(row.detail);
          if (!detail.success || row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId
            || row.userId !== access.actorId || row.action !== 'ai_task_run_takeover' || detail.data.taskId !== taskId
            || time(row.createdAt) > time(now)) throw unavailable();
          const observed = await takeovers.readReceipt({ taskId, runId: detail.data.runId,
            expectedTaskRevision: detail.data.taskRevision, expectedRunRevision: detail.data.runRevision - 1,
            expectedFencingToken: detail.data.previousFencingToken });
          if (observed.status !== 'observed' || observed.receiptId !== row.id) throw unavailable();
          takeover = true;
        }
        const lifecycle = await this.lifecycle.capture(task.id, context, task);
        items.push({ task, status, context, access, logs, takeover, lifecycle });
      }
      for (const item of items) {
        if (identity(await authorize(item.task.id, 'read_metadata')) !== sampleIdentity
          || identity(await authorize(item.task.id, 'read_step_terminal')) !== sampleIdentity)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const current = await db.aiTask.findFirst({ where: item.access.where, select: taskSelect });
        const scope = item.context.scope;
        if (scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const latest = await db.operationLog.findMany({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId,
          userId: item.access.actorId, action: 'ai_task_run_takeover', detail: { path: '$.taskId', equals: item.task.id },
          createdAt: { lte: now } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 });
        if (!isDeepStrictEqual(current, item.task) || !isDeepStrictEqual(latest, item.logs))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      for (const item of items) await item.lifecycle.revalidate();
      // A later sample read may revoke an earlier task's authority. Close all
      // current grants after the final storage await, without using old access
      // as a cached permission or manufacturing an atomic snapshot.
      for (const item of items) {
        if (identity(await authorize(item.task.id, 'read_metadata')) !== sampleIdentity
          || identity(await authorize(item.task.id, 'read_step_terminal')) !== sampleIdentity)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        await item.lifecycle.reauthorize();
      }
      const counts = Object.fromEntries(AI_TASK_STATUSES_DRAFT.map(status => [status, 0])) as Record<AiTaskStatusDraft, number>;
      for (const item of items) counts[item.status]++;
      const total = items.length, terminal = items.filter(item => AI_TASK_TERMINAL_STATUSES_DRAFT.includes(item.status)).length;
      const takeoverCount = items.filter(item => item.takeover).length;
      return { version: 'task-outcome-sample-1', observedAt: now.toISOString(), sceneCode: items[0].task.sceneCode,
        sceneVersion: items[0].task.sceneVersion, taskIds: [...parsed.data.taskIds], sampleSize: total, statusCounts: counts,
        successRate: { state: terminal === total ? 'recorded' : 'pending', succeeded: counts.succeeded,
          terminal, total, percent: terminal === total ? (100 * counts.succeeded / total).toFixed(2) : null },
        takeoverRate: { tasksWithReceipt: takeoverCount, total, percent: (100 * takeoverCount / total).toFixed(2),
          basis: 'original_same_owner_takeover_receipts' },
        lifecycleRates: taskLifecycleSampleRates(items.map(item => item.lifecycle.value)),
        coverage: 'requested_authorized_one_owner_workspace_scene_version',
        consistency: 'revalidated_reads_not_atomic_snapshot', slo: 'not_evaluated', execution: 'read_only_no_lease_or_model' };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }

  async read(value: unknown, clientSourceBinding?: (value: AiTaskClientVisibleReportDraft) => Promise<string | null>): Promise<AiTaskPerformanceObservationDraft & { lifecycle: TaskLifecycleObservation; faults: TaskFaultObservation }> {
    const captured = await this.capture(value, clientSourceBinding);
    captured.assertCurrentPolicy();
    return captured.value;
  }

  /** Server-only observation handle. HTTP hosts keep its policy witness through
   * their last identity wait; no callback or authority enters the wire packet. */
  async capture(value: unknown, clientSourceBinding?: (value: AiTaskClientVisibleReportDraft) => Promise<string | null>) {
    const parsed = commandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, before = structuredClone(await this.actions.resolve(command.taskId, 'read_metadata'));
    if (before.actor.kind !== 'user' || before.scope.kind !== 'workspace' || !['operator', 'staff'].includes(before.audience)) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    const access = aiTaskAccessFromContext(before, command.taskId, this.clock());
    try {
      const task = structuredClone(await this.db.aiTask.findFirst({ where: access.where, select: taskSelect }));
      if (!task || task.id !== command.taskId || !revision(task.revision) || !task.scopeId
        || !AI_TASK_STATUSES_DRAFT.some(status => status === task.status.toLowerCase())) throw unavailable();
      uint(task.eventCursor);
      // A missing current original-source port cannot certify browser reports.
      // Source denials/errors propagate; only explicit unavailable/null remains
      // unrecorded. These are client diagnostics, never business/SLO evidence.
      const visibleNow = this.clock(); time(visibleNow);
      if (clientSourceBinding) {
        const visibleContext = await this.actions.resolve(command.taskId, 'read_step_terminal');
        aiTaskAccessFromContext(visibleContext, command.taskId, this.clock());
        if (identity(visibleContext) !== identity(before)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      const readVisibleLogs = () => clientSourceBinding ? this.db.operationLog.findMany({ where: {
        tenantId: before.scope.kind === 'workspace' ? before.scope.tenantId : '',
        workspaceId: before.scope.kind === 'workspace' ? before.scope.workspaceId : '', userId: access.actorId,
        action: CLIENT_VISIBLE_LOG_ACTION, detail: { path: '$.report.taskId', equals: task.id }, createdAt: { lte: visibleNow } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 21 }) : Promise.resolve([]);
      const visibleLogs = structuredClone(await readVisibleLogs());
      if (visibleLogs.length > 21 || new Set(visibleLogs.map(row => row.id)).size !== visibleLogs.length) throw unavailable();
      const clientItems: Array<AiTaskClientVisibleReportDraft & { recordedAt: string }> = [];
      const sourceChecks: Array<{ report: AiTaskClientVisibleReportDraft; binding: string | null }> = [];
      for (const row of visibleLogs.slice(0, 20)) {
        const detail = parseClientVisibleLog(row.detail), report = detail.report;
        if (report.taskId !== task.id || row.action !== CLIENT_VISIBLE_LOG_ACTION || row.userId !== access.actorId
          || before.scope.kind !== 'workspace' || row.tenantId !== before.scope.tenantId || row.workspaceId !== before.scope.workspaceId
          || time(row.createdAt) > time(visibleNow)) throw unavailable();
        const currentBinding = await clientSourceBinding!(report);
        sourceChecks.push({ report, binding: currentBinding });
        if (currentBinding !== null) {
          if (currentBinding !== detail.sourceBinding) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          clientItems.push({ ...report, recordedAt: row.createdAt.toISOString() });
        }
      }
      const clientVisible: AiTaskClientVisibleObservationDraft = clientItems.length ? { state: 'client_reported',
        observations: clientItems, truncated: visibleLogs.length > 20, coverage: 'original_host_reports_not_task_or_tenant_rate',
        evaluation: 'not_slo_evidence', currentDisplay: 'not_asserted' } : { state: 'not_recorded' };
      const related = { scopeId: task.scopeId, taskId: task.id, task: { is: access.where } };
      const readInvocations = () => this.db.aiGatewayInvocation.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
        actorId: access.actorId, run: { is: { ...related, actorKind: access.actorKind, actorId: access.actorId } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51,
        select: { id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true, actorId: true, callId: true,
          mode: true, sceneCode: true, registrationHash: true, configurationHash: true, priceVersion: true,
          accountingReceipts: { take: 2, select: { scopeId: true, taskId: true, invocationId: true, reservationId: true,
            admissionId: true, dispatchToken: true, requestHash: true, state: true } } } });
      const invocations = structuredClone(await readInvocations());
      if (!Array.isArray(invocations) || invocations.length > 51 || new Set(invocations.map(row => row.id)).size !== invocations.length) throw unavailable();
      for (const item of invocations) {
        if (!id.safeParse(item.id).success || !id.safeParse(item.runId).success || !id.safeParse(item.stepId).success
          || item.scopeId !== task.scopeId || item.taskId !== task.id
          || item.actorId !== access.actorId || !['invoke', 'stream'].includes(item.mode)) throw unavailable();
      }
      const visibleInvocations = invocations.slice(0, 50), logIds = visibleInvocations.map(row => gatewayDeliveryLogId(task.scopeId, row.id));
      const readDeliveryLogs = () => logIds.length ? this.db.operationLog.findMany({ where: {
        id: { in: logIds }, tenantId: before.scope.kind === 'workspace' ? before.scope.tenantId : '',
        workspaceId: before.scope.kind === 'workspace' ? before.scope.workspaceId : '',
        action: 'ai.gateway.delivery_observed', userId: access.actorKind === 'USER' ? access.actorId : null },
        orderBy: { id: 'asc' }, take: 51, select: { id: true, tenantId: true, workspaceId: true, userId: true, action: true, detail: true } }) : Promise.resolve([]);
      const deliveryLogs = structuredClone(await readDeliveryLogs());
      if (!Array.isArray(deliveryLogs) || deliveryLogs.length > 50 || new Set(deliveryLogs.map(row => row.id)).size !== deliveryLogs.length) throw unavailable();
      const denialIds = visibleInvocations.map(row => gatewayBudgetDenialLogId(task.scopeId, row.id));
      const readDenials = () => denialIds.length ? this.db.operationLog.findMany({ where: { id: { in: denialIds },
        tenantId: before.scope.kind === 'workspace' ? before.scope.tenantId : '',
        workspaceId: before.scope.kind === 'workspace' ? before.scope.workspaceId : '',
        action: 'ai.gateway.budget_denied', userId: access.actorKind === 'USER' ? access.actorId : null },
        orderBy: { id: 'asc' }, take: 51, select: { id: true, tenantId: true, workspaceId: true, userId: true, action: true, detail: true, createdAt: true } }) : Promise.resolve([]);
      const denials = structuredClone(await readDenials());
      if (!Array.isArray(denials) || denials.length > 50 || new Set(denials.map(row => row.id)).size !== denials.length) throw unavailable();
      const denialItems: NonNullable<AiTaskPerformanceObservationDraft['budgetAdmission']>['denials'] = [];
      for (const row of denials) {
        const invocation = visibleInvocations.find(item => gatewayBudgetDenialLogId(task.scopeId, item.id) === row.id);
        const detail = row.detail as Record<string, unknown> | null, meta = detail?.metadata as Record<string, unknown> | null;
        if (!invocation || row.action !== 'ai.gateway.budget_denied' || row.tenantId !== before.scope.tenantId
          || row.workspaceId !== before.scope.workspaceId || row.userId !== access.actorId
          || !detail || detail.targetType !== 'ai_gateway_invocation' || detail.targetId !== invocation.id
          || !meta || meta.version !== 'ai-gateway-budget-denial-1' || meta.code !== 'BUDGET_UNAVAILABLE'
          || meta.observation !== 'gate_rejected_not_release_evidence' || meta.actorKind !== access.actorKind || meta.actorId !== access.actorId
          || meta.taskId !== task.id || meta.runId !== invocation.runId || meta.stepId !== invocation.stepId
          || meta.actionId !== invocation.actionId || meta.callId !== invocation.callId || meta.mode !== invocation.mode
          || meta.sceneCode !== invocation.sceneCode || meta.registrationHash !== invocation.registrationHash
          || meta.configurationHash !== invocation.configurationHash || meta.priceVersion !== invocation.priceVersion
          || !id.safeParse(meta.admissionId).success || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(meta.requestHash).success
          || !z.string().regex(/^[a-f0-9]{64}$/u).safeParse(meta.dispatchBindingHash).success
          || time(row.createdAt) < time(task.createdAt) || time(row.createdAt) > time(this.clock())) throw unavailable();
        denialItems.push({ invocationId: invocation.id, runId: invocation.runId, stepId: invocation.stepId,
          callId: invocation.callId, observedAt: row.createdAt.toISOString(), code: 'budget_unavailable',
          observation: 'gate_rejected_not_release_evidence' });
      }
      const modelItems: AiTaskPerformanceObservationDraft['modelDelivery']['items'] = [];
      for (const row of deliveryLogs) {
        const invocation = visibleInvocations.find(item => gatewayDeliveryLogId(task.scopeId, item.id) === row.id);
        const detail = row.detail as Record<string, unknown> | null;
        const meta = detail?.metadata as Record<string, unknown> | null;
        const receipt = invocation?.accountingReceipts?.[0], parsedTime = gatewayDeliveryTimingSchema.safeParse(meta?.timing);
        if (!invocation || invocation.accountingReceipts.length !== 1 || !receipt || receipt.state !== 'dispatched'
          || receipt.scopeId !== task.scopeId || receipt.taskId !== task.id || receipt.invocationId !== invocation.id
          || !id.safeParse(receipt.reservationId).success || !id.safeParse(receipt.admissionId).success
          || typeof receipt.dispatchToken !== 'string' || !receipt.dispatchToken.length
          || row.tenantId !== before.scope.tenantId || row.workspaceId !== before.scope.workspaceId
          || row.action !== 'ai.gateway.delivery_observed' || row.userId !== (access.actorKind === 'USER' ? access.actorId : null)
          || !detail || detail.targetType !== 'ai_gateway_invocation' || detail.targetId !== invocation.id
          || !meta || meta.version !== 'ai-gateway-delivery-audit-1' || meta.status !== 'accepted'
          || meta.actorKind !== access.actorKind || meta.actorId !== access.actorId || meta.taskId !== task.id
          || meta.runId !== invocation.runId || meta.stepId !== invocation.stepId || meta.actionId !== invocation.actionId
          || meta.callId !== invocation.callId || meta.mode !== invocation.mode || meta.registrationHash !== invocation.registrationHash
          || meta.configurationHash !== invocation.configurationHash || meta.priceVersion !== invocation.priceVersion || meta.sceneCode !== invocation.sceneCode
          || meta.reservationId !== receipt.reservationId || meta.admissionId !== receipt.admissionId
          || meta.requestHash !== receipt.requestHash || meta.dispatchBindingHash !== hash(receipt.dispatchToken)
          || !parsedTime.success || invocation.mode === 'invoke' && parsedTime.data.firstValidatedTextMs !== null) throw unavailable();
        modelItems.push({ invocationId: invocation.id, runId: invocation.runId, stepId: invocation.stepId, callId: invocation.callId,
          mode: invocation.mode as 'invoke' | 'stream', transportWallMs: String(parsedTime.data.transportWallMs),
          firstValidatedTextMs: parsedTime.data.firstValidatedTextMs === null ? null : String(parsedTime.data.firstValidatedTextMs),
          basis: 'gateway_transport_including_usage_and_consumer_wait' });
      }
      const readRuns = () => this.db.aiRun.findMany({ where: { ...related, actorKind: access.actorKind, actorId: access.actorId },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }], take: 51, select: runSelect });
      const readSteps = () => this.db.aiStep.findMany({ where: related,
        orderBy: [{ runId: 'asc' }, { sequence: 'asc' }, { id: 'asc' }], take: 201, select: stepSelect });
      const readBudget = () => this.db.aiTaskExecutionBudget.findFirst({ where: related, select: budgetSelect });
      const runs = fencedSnapshot(await readRuns()), steps = structuredClone(await readSteps()), budget = structuredClone(await readBudget());
      if (!Array.isArray(runs) || runs.length > 51 || !Array.isArray(steps) || steps.length > 201
        || new Set(runs.map(row => row.id)).size !== runs.length || new Set(steps.map(row => row.id)).size !== steps.length) throw unavailable();
      for (const run of runs) {
        if (run.scopeId !== task.scopeId || run.taskId !== task.id || run.actorKind !== access.actorKind || run.actorId !== access.actorId
          || !id.safeParse(run.id).success || !revision(run.revision) || !revision(run.sequence)
          || !AI_TASK_STATUSES_DRAFT.some(status => status === run.status.toLowerCase())) throw unavailable();
        if (run.startedAt && time(run.startedAt) < time(task.createdAt)) throw unavailable();
        elapsed(run.startedAt, run.endedAt);
      }
      for (const step of steps) {
        if (step.scopeId !== task.scopeId || step.taskId !== task.id || !id.safeParse(step.id).success
          || !id.safeParse(step.runId).success || !revision(step.sequence) || !revision(step.revision)
          || typeof step.toolCode !== 'string' || !step.toolCode.length || step.toolCode.length > 191
          || typeof step.toolVersion !== 'string' || !step.toolVersion.length || step.toolVersion.length > 191
          || !AI_STEP_STATUSES_DRAFT.some(status => status === step.status.toLowerCase())
          || !['NONE', 'POSSIBLE', 'COMMITTED'].includes(step.effect)) throw unavailable();
      }
      const partialEnd = await this.partialTaskEnd(task, runs, steps, budget, before);
      const visibleSteps = steps.slice(0, 200), stepIds = visibleSteps.map(step => step.id);
      // Group only this bounded, owner-authorized step window in SQL. Do not
      // load every historical charge or label updatedAt-createdAt tool latency.
      const readActiveTime = () => stepIds.length ? this.db.aiTaskExecutionCharge.groupBy({
        by: ['scopeId', 'taskId', 'runId', 'stepId', 'status'],
        where: { scopeId: task.scopeId, taskId: task.id, resource: 'ACTIVE_MS', stepId: { in: stepIds },
          budget: { is: { task: { is: access.where } } } },
        _sum: { amount: true, actualAmount: true }, _count: { _all: true, actualAmount: true },
        orderBy: [{ runId: 'asc' }, { stepId: 'asc' }, { status: 'asc' }], take: 601,
      }) : Promise.resolve([]);
      const charges = structuredClone(await readActiveTime());
      if (!Array.isArray(charges) || charges.length > 600) throw unavailable();
      const activeTimes = new Map<string, { recordedMs: bigint | null; reservedMs: bigint; unknownMs: bigint }>();
      const chargeKeys = new Set<string>();
      for (const charge of charges) {
        const step = visibleSteps.find(item => item.id === charge.stepId), key = JSON.stringify([charge.runId, charge.stepId, charge.status]);
        if (!step || charge.scopeId !== task.scopeId || charge.taskId !== task.id || charge.runId !== step.runId
          || !['RECORDED', 'RESERVED', 'UNKNOWN'].includes(charge.status) || chargeKeys.has(key)
          || !Number.isSafeInteger(charge._count._all) || charge._count._all < 1) throw unavailable();
        chargeKeys.add(key);
        const current = activeTimes.get(step.id) ?? { recordedMs: null, reservedMs: 0n, unknownMs: 0n };
        if (charge.status === 'RECORDED') {
          if (charge._count.actualAmount !== charge._count._all || charge._sum.actualAmount === null) throw unavailable();
          current.recordedMs = uint(charge._sum.actualAmount);
        } else {
          if (charge._sum.amount === null) throw unavailable();
          if (charge.status === 'UNKNOWN') current.unknownMs = uint(charge._sum.amount);
          else current.reservedMs = uint(charge._sum.amount);
        }
        activeTimes.set(step.id, current);
      }
      if (!budget && charges.length) throw unavailable();
      if (budget) {
        const measured = [...activeTimes.values()];
        if (measured.reduce((total, item) => total + (item.recordedMs ?? 0n), 0n) > uint(budget.consumedActiveMs)
          || measured.reduce((total, item) => total + item.reservedMs + item.unknownMs, 0n) > uint(budget.reservedActiveMs)) throw unavailable();
      }
      let resources: AiTaskPerformanceObservationDraft['resources'] = { state: 'not_recorded' };
      if (budget) {
        if (budget.scopeId !== task.scopeId || budget.taskId !== task.id || !revision(budget.revision)
          || typeof budget.policyVersion !== 'string' || !budget.policyVersion.length || budget.policyVersion.length > 64) throw unavailable();
        const counter = (resource: 'steps' | 'calls' | 'active_ms' | 'output_bytes', limit: bigint, reserved: bigint, consumed: bigint) => {
          const used = uint(reserved) + uint(consumed), ceiling = uint(limit);
          return { resource, limit: ceiling.toString(), consumed: consumed.toString(), reservedAndUnknown: reserved.toString(),
            remaining: (used < ceiling ? ceiling - used : 0n).toString(), exhausted: used >= ceiling };
        };
        resources = { state: 'recorded', revision: budget.revision, policyVersion: budget.policyVersion, counters: [
          counter('steps', budget.maxSteps, budget.reservedSteps, budget.consumedSteps),
          counter('calls', budget.maxCalls, budget.reservedCalls, budget.consumedCalls),
          counter('active_ms', budget.maxActiveMs, budget.reservedActiveMs, budget.consumedActiveMs),
          counter('output_bytes', budget.maxOutputBytes, budget.reservedOutputBytes, budget.consumedOutputBytes)] };
      }
      // The financial reader rechecks read_step_terminal and original invocation /
      // allocation evidence. Never infer a zero bill from a missing reservation.
      const financial = await this.usage.read({ taskId: task.id, limit: command.usageLimit,
        ...(command.usageAfter ? { after: command.usageAfter } : {}) });
      if (financial.taskId !== task.id) throw unavailable();
      if (command.includeTaskFinancial && typeof this.usage.summary !== 'function') throw unavailable();
      const taskFinancial = command.includeTaskFinancial ? await this.usage.summary!({ taskId: task.id }) : undefined;
      if (taskFinancial && taskFinancial.taskId !== task.id) throw unavailable();
      if (taskFinancial) {
        const { observedAt: _, ...originalPage } = financial;
        const { observedAt: __, ...currentPage } = await this.usage.read({ taskId: task.id, limit: command.usageLimit,
          ...(command.usageAfter ? { after: command.usageAfter } : {}) });
        if (!isDeepStrictEqual(originalPage, currentPage)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      const lifecycle = await this.lifecycle.capture(task.id, before, task);
      const faults = await this.faults.capture(task.id, before, task, lifecycle);
      await partialEnd?.revalidate();
      const latest = structuredClone(await this.db.aiTask.findFirst({ where: access.where, select: taskSelect }));
      if (!latest || !isDeepStrictEqual(latest, task) || !isDeepStrictEqual(fencedSnapshot(await readRuns()), runs)
        || !isDeepStrictEqual(await readSteps(), steps) || !isDeepStrictEqual(await readBudget(), budget)
        || !isDeepStrictEqual(await readActiveTime(), charges) || !isDeepStrictEqual(await readInvocations(), invocations)
        || !isDeepStrictEqual(await readDeliveryLogs(), deliveryLogs) || !isDeepStrictEqual(await readDenials(), denials)
        || !isDeepStrictEqual(await readVisibleLogs(), visibleLogs)) {
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      for (const item of sourceChecks) if (await clientSourceBinding!(item.report) !== item.binding)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await faults.revalidate();
      const after = await this.actions.resolve(command.taskId, 'read_metadata');
      if (identity(before) !== identity(after)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await faults.reauthorize();
      const now = this.clock();
      if (time(now) < time(task.createdAt) || time(task.updatedAt) > time(now)) throw unavailable();
      if (runs.some(run => run.startedAt && time(run.startedAt) > time(now) || run.endedAt && time(run.endedAt) > time(now))) throw unavailable();
      const startTimes = runs.slice(0, 50).flatMap(run => run.startedAt ? [time(run.startedAt)] : []);
      // Terminal task.updatedAt is not a completion clock: later metadata can
      // change it. A partial Task with a failed/cancelled successor additionally
      // requires the original terminal event and released interval receipt above.
      const finalRun = runs.length <= 50 ? runs.at(-1) : undefined;
      const end = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)
        && finalRun?.status === task.status ? finalRun.endedAt : partialEnd?.endedAt ?? null;
      const result: AiTaskPerformanceObservationDraft & { lifecycle: TaskLifecycleObservation; faults: TaskFaultObservation } = { version: 'task-performance-1', observedAt: now.toISOString(),
        task: { taskId: task.id, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, status: task.status.toLowerCase(),
          revision: task.revision, createdAt: task.createdAt.toISOString(), lastChangedAt: task.updatedAt.toISOString(),
          cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null },
        timing: { ageMs: String(time(now) - time(task.createdAt)),
          firstRecordedStartAt: startTimes.length ? new Date(Math.min(...startTimes)).toISOString() : null,
          terminalEndedAt: end?.toISOString() ?? null, endToEndMs: elapsed(task.createdAt, end ?? null) },
        resources, runs: { items: runs.slice(0, 50).map(run => ({ runId: run.id, sequence: run.sequence,
          status: run.status.toLowerCase(), startedAt: run.startedAt?.toISOString() ?? null, endedAt: run.endedAt?.toISOString() ?? null,
          elapsedMs: elapsed(run.startedAt, run.endedAt) })), truncated: runs.length > 50, coverage: 'bounded_window' },
        steps: { items: visibleSteps.map(step => ({ stepId: step.id, runId: step.runId, sequence: step.sequence,
          toolCode: step.toolCode, toolVersion: step.toolVersion, status: step.status.toLowerCase(), effect: step.effect.toLowerCase(),
          revision: step.revision, activeTime: activeTimes.has(step.id) ? { state: 'recorded',
            recordedMs: activeTimes.get(step.id)!.recordedMs?.toString() ?? null,
            reservedMs: activeTimes.get(step.id)!.reservedMs.toString(), unknownMs: activeTimes.get(step.id)!.unknownMs.toString(),
            basis: 'persistent_resource_not_provider_latency' } : { state: 'not_recorded' } })), truncated: steps.length > 200, coverage: 'bounded_window' }, financial,
        ...(taskFinancial ? { taskFinancial } : {}),
        modelDelivery: { items: modelItems, unobservedInWindow: visibleInvocations.length - modelItems.length,
          truncated: invocations.length > 50, coverage: 'completed_gateway_observations_only' },
        budgetAdmission: { denials: denialItems, truncated: invocations.length > 50, coverage: 'recorded_rejections_only' },
        clientVisible,
        lifecycle: lifecycle.value,
        faults: faults.valueAt(now),
        measurements: { firstToken: clientItems.some(item => item.kind === 'text') ? 'client_reported' : 'not_recorded',
          firstCard: clientItems.some(item => item.kind === 'card') ? 'client_reported' : 'not_recorded',
          modelLatency: modelItems.length ? 'gateway_transport_wall_time_only' : 'not_recorded',
          toolLatency: [...activeTimes.values()].some(item => item.recordedMs !== null) ? 'resource_active_time_only' : 'not_recorded',
          rates: 'not_computed', slo: 'not_evaluated' },
        consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_dispatch_or_release' };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072) throw unavailable();
      faults.assertCurrentPolicy();
      return { value: result, assertCurrentPolicy: faults.assertCurrentPolicy };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof BudgetError) throw new AiTaskRepositoryError(error.code === 'INVALID' ? 'AI_INVALID_INPUT'
        : error.code === 'FORBIDDEN' ? 'AI_ACCESS_DENIED' : error.code === 'PENDING_RECONCILIATION' ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
}
