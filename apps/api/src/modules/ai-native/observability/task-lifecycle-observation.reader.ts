/** Original cancellation/recovery observations under current task read rights.
 * Reads existing events, receipts, plans and resource accounts only. A clock,
 * expired lease or terminal label cannot invent completion, release resources
 * or authorize another model/Core attempt. Missing evidence stays pending. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT,
  AI_STEP_STATUSES_DRAFT, AI_STEP_TRANSITION_REASONS_DRAFT, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE,
  AI_TEXT_CAPABILITY_PROBE_STEP_CODE, type AiExecutionContext, type AiTaskStatusDraft,
  type AiTaskLifecycleObservationDraft, type AiTaskLifecycleSampleRatesDraft } from '@rental-os/shared';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { PrismaTaskTakeoverRepository } from '../runner/prisma-task-takeover.repository';
import { aiTaskRunPlanSchema, aiTaskConfirmationPhasePayloadSchema } from '../runner/prisma-task-run-evidence.repository';
import { aiStepActionId } from '../ai-step-registration.repository';
import { evaluateAiTaskTransitionDraft } from '../task-transition-draft';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { modelUsageSchema } from '../model-gateway.ports';
import { isTaskModelCountCharge, taskStepChargesValid } from '../runner/task-model-count-charge';
import { taskPreparationDefinitionSchema } from '../runner/task-run-preparation.ports';
import { taskExecutionPhaseStartSchema, taskExecutionPhaseReceiptSchema } from '../runner/task-execution-phase.store';
import { BudgetError } from '../budget/budget.ports';
import type { TaskBudgetUsageReader } from '../budget/task-budget-usage.reader';

export type TaskLifecycleObservationDb = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep'
  | 'aiTaskExecutionBudget' | 'aiTaskExecutionCharge' | 'operationLog'> & Partial<Pick<PrismaClient,
    '$transaction' | 'aiTaskEvent' | 'aiTaskRunPlan' | 'aiTaskRunOverhead' | 'aiTaskRunPreparation' | 'aiTaskResultArtifact'
    | 'aiTaskExecutionPhaseReceipt' | 'aiTaskExecutionPhaseStart' | 'aiGatewayInvocation'
    | 'aiGatewayAccountingReceipt' | 'aiBudgetReservation' | 'aiInvocationAdmission' | 'aiApprovalConsumption'>>;
type TerminalOutcome = 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled';
// Reuse the published optional observation contracts. This reader supplies no
// request/DTO, public registration or independent authorization surface.
export type TaskLifecycleObservation = AiTaskLifecycleObservationDraft;
export type TaskCancellationObservation = TaskLifecycleObservation['cancellation'];
export type TaskRecoveryObservation = TaskLifecycleObservation['recovery']['items'][number];
export type TaskLifecycleSampleRates = AiTaskLifecycleSampleRatesDraft;

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const longId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967295);
const token = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const envelope = z.object({ data: z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT),
  to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT) }).strict(),
  initiator: z.object({ kind: z.enum(['user', 'worker', 'system']), id: longId,
    actorKind: z.string(), actorId: longId }).strict() }).passthrough();
const takeoverDetail = z.object({ receiptVersion: z.literal('original-run-takeover-1'),
  taskId: id, runId: id, taskRevision: revision, runRevision: revision,
  previousHolderId: longId, holderId: longId, previousFencingToken: token, fencingToken: token,
  purpose: z.literal('recovery_only'), expiresAt: z.string().datetime({ offset: true }) }).passthrough();
const taskSelect = { id: true, scopeId: true, sceneCode: true, sceneVersion: true, status: true,
  revision: true, contractVersion: true, eventCursor: true, cancelRequestedAt: true,
  createdAt: true, updatedAt: true } satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, scopeId: true, taskId: true, sequence: true, revision: true,
  actorKind: true, actorId: true, status: true, fencingToken: true, leaseOwnerId: true,
  leaseExpiresAt: true, startedAt: true, endedAt: true, inputReceiptId: true,
  resourceOriginRunId: true } satisfies Prisma.AiRunSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true,
  toolCode: true, toolVersion: true, actionId: true, requestFingerprint: true, inputRef: true,
  resultRef: true, status: true, effect: true } satisfies Prisma.AiStepSelect;
const artifactSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true,
  actionId: true, stepFingerprint: true, leaseOwnerId: true, fencingToken: true, outcome: true,
  completeMeasurement: true, contentHash: true, payload: true,
  activeMs: true, outputBytes: true, createdAt: true } satisfies Prisma.AiTaskResultArtifactSelect;
const phaseSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true,
  phaseId: true, kind: true, errorCode: true, contentHash: true, activeMs: true, outputBytes: true,
  payload: true, decisionRef: true, proposalId: true, proposalRevision: true,
  reviewedPayloadHash: true, businessResultRef: true, createdAt: true } satisfies Prisma.AiTaskExecutionPhaseReceiptSelect;
const invocationSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true,
  actionId: true, stepFingerprint: true, actorId: true, callId: true, sceneCode: true,
  mode: true, registrationHash: true, configuration: true, configurationHash: true,
  priceVersion: true, leaseOwnerId: true, fencingToken: true } satisfies Prisma.AiGatewayInvocationSelect;
const reservationSelect = { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true,
  actorId: true, callId: true, requestId: true, idempotencyKey: true, runId: true, stepId: true,
  actionId: true, sceneCode: true, configurationHash: true, configRevision: true, priceVersion: true,
  status: true, dispatchState: true, unitKind: true, actualCalls: true, actualTokens: true,
  actualMoney: true } satisfies Prisma.AiBudgetReservationSelect;
const fail = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const stableIdentity = ({ requestId: _id, authorizedAt: _at, ...value }: AiExecutionContext) => hash(value);
const terminal = (status: string): status is TerminalOutcome =>
  ['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(status);
function time(value: Date) {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) throw fail();
  return value.getTime();
}
function uint(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n || value > 18446744073709551615n) throw fail();
  return value;
}
function fence(value: Prisma.Decimal): string {
  if (!(value instanceof Prisma.Decimal) || !value.isInteger() || value.isNegative()
    || value.greaterThan('18446744073709551615')) throw fail();
  return value.toFixed(0);
}
function detached<T extends { fencingToken: Prisma.Decimal }>(rows: T[]) {
  return structuredClone(rows.map(row => {
    const { fencingToken, ...value } = row;
    return { ...value, fencingToken: fence(fencingToken) };
  }));
}
const uuid = (value: string) => `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
const emptyCancellation = (): TaskCancellationObservation => ({ state: 'not_recorded', requestRevision: null,
  settlementRevision: null, requestedAt: null, settledAt: null, elapsedMs: null, outcome: null,
  semantics: 'request_settlement_not_business_rollback' });
const empty = (): TaskLifecycleObservation => ({ version: 'task-lifecycle-1', cancellation: emptyCancellation(),
  recovery: { state: 'not_recorded', items: [], truncated: false, coverage: 'original_fenced_recovery_generations' },
  consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_lease_model_dispatch_or_release' });

type Task = Prisma.AiTaskGetPayload<{ select: typeof taskSelect }>;
type Run = ReturnType<typeof detached<Prisma.AiRunGetPayload<{ select: typeof runSelect }>>>[number];
type Charge = ReturnType<typeof detached<Prisma.AiTaskExecutionChargeGetPayload<object>>>[number];
type Overhead = ReturnType<typeof detached<Prisma.AiTaskRunOverheadGetPayload<object>>>[number];
type Preparation = ReturnType<typeof detached<Prisma.AiTaskRunPreparationGetPayload<object>>>[number];
type Event = Prisma.AiTaskEventGetPayload<object>;
type Snapshot = {
  task: Task; runs: Run[]; steps: Prisma.AiStepGetPayload<{ select: typeof stepSelect }>[];
  budget: Prisma.AiTaskExecutionBudgetGetPayload<object> | null; charges: Charge[]; overheads: Overhead[];
  plans: Prisma.AiTaskRunPlanGetPayload<object>[]; preparations: Preparation[];
  events: Event[]; logs: Prisma.OperationLogGetPayload<object>[];
  artifacts: ReturnType<typeof detached<Prisma.AiTaskResultArtifactGetPayload<{ select: typeof artifactSelect }>>>;
  phases: Prisma.AiTaskExecutionPhaseReceiptGetPayload<{ select: typeof phaseSelect }>[];
  phaseStarts: ReturnType<typeof detached<Prisma.AiTaskExecutionPhaseStartGetPayload<object>>>;
  consumptions: Prisma.AiApprovalConsumptionGetPayload<object>[];
  invocations: ReturnType<typeof detached<Prisma.AiGatewayInvocationGetPayload<{ select: typeof invocationSelect }>>>;
  accounting: Prisma.AiGatewayAccountingReceiptGetPayload<object>[];
  admissions: Prisma.AiInvocationAdmissionGetPayload<object>[];
  reservations: Array<Omit<Prisma.AiBudgetReservationGetPayload<{ select: typeof reservationSelect }>, 'actualMoney'> & { actualMoney: string | null }>;
  financialAvailable: boolean;
  bounded: boolean;
};
type Generation = { runId: string; fence: string; holder: string;
  log?: Prisma.OperationLogGetPayload<object>; intervals: Overhead[] };

export class TaskLifecycleObservationReader {
  constructor(private readonly db: TaskLifecycleObservationDb,
    private readonly actions: Pick<AiTaskRepositoryAuthority, 'resolve'>,
    private readonly clock: () => Date = () => new Date(),
    private readonly financial?: Partial<Pick<TaskBudgetUsageReader, 'summary'>>) {}

  async capture(taskId: string, expected?: AiExecutionContext,
    expectedTask?: Pick<Task, 'id' | 'scopeId' | 'revision' | 'eventCursor' | 'status'>) {
    if (!id.safeParse(taskId).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const initial = structuredClone(await this.actions.resolve(taskId, 'read_metadata'));
    const access = aiTaskAccessFromContext(initial, taskId, this.clock());
    if (initial.actor.kind !== 'user' || initial.scope.kind !== 'workspace'
      || !['operator', 'staff'].includes(initial.audience)
      || expected && stableIdentity(expected) !== stableIdentity(initial)) throw denied();
    const originalIdentity = stableIdentity(initial);
    const authorize = async () => {
      for (const operation of ['read_metadata', 'read_events', 'read_step_terminal'] as const) {
        const current = await this.actions.resolve(taskId, operation);
        aiTaskAccessFromContext(current, taskId, this.clock());
        if (stableIdentity(current) !== originalIdentity) throw denied();
      }
    };
    const readTask = () => this.db.aiTask.findFirst({ where: access.where, select: taskSelect });
    const window = this.clock(); time(window);
    try {
      const task = structuredClone(await readTask());
      if (!task || task.id !== taskId || !revision.safeParse(task.revision).success
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || !id.safeParse(task.scopeId).success
        || time(task.createdAt) > time(window)) throw fail();
      uint(task.eventCursor);
      if (task.cancelRequestedAt && (time(task.cancelRequestedAt) < time(task.createdAt)
        || time(task.cancelRequestedAt) > time(window))) throw fail();
      if (expectedTask && (['id', 'scopeId', 'revision', 'eventCursor', 'status'] as const)
        .some(key => task[key] !== expectedTask[key])) throw conflict();
      const capable = typeof this.db.aiTaskEvent?.findMany === 'function'
        && typeof this.db.aiTaskRunPlan?.findMany === 'function'
        && typeof this.db.aiTaskRunOverhead?.findMany === 'function'
        && typeof this.db.aiTaskExecutionCharge.findMany === 'function'
        && typeof this.db.$transaction === 'function';
      if (!capable) {
        // Old receipt-only hosts may omit these stores. Absence does not grant
        // completion, and the old performance surface remains independently usable.
        const reauthorize = async () => {
          const current = await this.actions.resolve(taskId, 'read_metadata');
          aiTaskAccessFromContext(current, taskId, this.clock());
          if (stableIdentity(current) !== originalIdentity) throw denied();
        };
        const value = empty();
        if (task.cancelRequestedAt) value.cancellation = { ...emptyCancellation(), state: 'pending',
          requestedAt: new Date(time(task.cancelRequestedAt)).toISOString() };
        return { value, reauthorize, revalidate: async () => {
          await reauthorize();
          if (!isDeepStrictEqual(await readTask(), task)) throw conflict();
        } };
      }
      await authorize();
      const key = { scopeId: task.scopeId, taskId: task.id };
      const readSnapshot = async (): Promise<Snapshot> => {
        const currentTask = structuredClone(await readTask());
        if (!currentTask || !isDeepStrictEqual(currentTask, task)) throw conflict();
        const [runs, steps, budget, charges, overheads, plans, events, logs] = await Promise.all([
          this.db.aiRun.findMany({ where: { ...key, actorKind: access.actorKind, actorId: access.actorId },
            orderBy: [{ sequence: 'asc' }, { id: 'asc' }], take: 51, select: runSelect }),
          this.db.aiStep.findMany({ where: key, orderBy: [{ runId: 'asc' }, { sequence: 'asc' }], take: 201, select: stepSelect }),
          this.db.aiTaskExecutionBudget.findFirst({ where: key }),
          this.db.aiTaskExecutionCharge.findMany({ where: key, orderBy: { chargeId: 'asc' }, take: 1001 }),
          this.db.aiTaskRunOverhead!.findMany({ where: key, orderBy: { id: 'asc' }, take: 1001 }),
          this.db.aiTaskRunPlan!.findMany({ where: key, orderBy: { runId: 'asc' }, take: 51 }),
          this.db.aiTaskEvent!.findMany({ where: { ...key, cursor: { lte: task.eventCursor },
            type: { in: ['task.transition', 'step.registered', 'step.changed'] } }, orderBy: { cursor: 'asc' }, take: 1001 }),
          this.db.operationLog.findMany({ where: { tenantId: initial.scope.kind === 'workspace' ? initial.scope.tenantId : '',
            workspaceId: initial.scope.kind === 'workspace' ? initial.scope.workspaceId : '', userId: access.actorId,
            action: 'ai_task_run_takeover', detail: { path: '$.taskId', equals: task.id }, createdAt: { lte: window } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21 })
        ]);
        const resultSteps = steps.slice(0, 200).filter(step => step.resultRef),
          resultIds = resultSteps.map(step => step.resultRef!), resultStepIds = resultSteps.map(step => step.id);
        const [phases, invocations] = await Promise.all([
          this.db.aiTaskExecutionPhaseReceipt && resultIds.length ? this.db.aiTaskExecutionPhaseReceipt.findMany({
            where: { ...key, stepId: { in: resultStepIds } }, take: 201, select: phaseSelect }) : [],
          this.db.aiGatewayInvocation?.findMany ? this.db.aiGatewayInvocation.findMany({
            where: { ...key, actorId: access.actorId }, orderBy: { id: 'asc' }, take: 51, select: invocationSelect }) : []
        ]);
        const financialAvailable = typeof this.db.aiGatewayInvocation?.findMany === 'function'
          && typeof this.db.aiGatewayAccountingReceipt?.findMany === 'function'
          && typeof this.db.aiBudgetReservation?.findMany === 'function'
          && typeof this.db.aiInvocationAdmission?.findMany === 'function';
        const [phaseStarts, accounting, preparations] = await Promise.all([
          this.db.aiTaskExecutionPhaseStart?.findMany && phases.length ? this.db.aiTaskExecutionPhaseStart.findMany({
            where: { ...key, stepId: { in: resultStepIds } }, take: 201 }) : [],
          financialAvailable && invocations.length ? this.db.aiGatewayAccountingReceipt!.findMany({
            where: { ...key, invocationId: { in: invocations.slice(0, 50).map(row => row.id) } }, take: 51 }) : [],
          this.db.aiTaskRunPreparation?.findMany ? this.db.aiTaskRunPreparation.findMany({
            where: key, orderBy: { id: 'asc' }, take: 201 }) : []
        ]);
        const [reservations, admissions, artifacts, consumptions] = await Promise.all([
          financialAvailable && accounting.length ? this.db.aiBudgetReservation!.findMany({
            where: { scopeId: key.scopeId, scopeKind: 'WORKSPACE', id: { in: accounting.map(row => row.reservationId) } },
            take: 51, select: reservationSelect }) : [],
          financialAvailable && accounting.length ? this.db.aiInvocationAdmission!.findMany({
            where: { scopeKind: 'WORKSPACE', id: { in: accounting.map(row => row.admissionId) },
              tenantId: initial.scope.kind === 'workspace' ? initial.scope.tenantId : '',
              workspaceId: initial.scope.kind === 'workspace' ? initial.scope.workspaceId : '' }, take: 51 }) : [],
          this.db.aiTaskResultArtifact && resultIds.length ? this.db.aiTaskResultArtifact.findMany({
            where: { ...key, id: { in: [...new Set([...resultIds, ...phaseStarts.map(row => row.originalArtifactId)])] } },
            take: 201, select: artifactSelect }) : [],
          this.db.aiApprovalConsumption?.findMany && phases.length ? this.db.aiApprovalConsumption.findMany({
            where: { ...key, actionId: { in: resultSteps.map(row => row.actionId) } }, take: 201 }) : []
        ]);
        return { task: currentTask, runs: detached(runs), steps: structuredClone(steps), budget: structuredClone(budget),
          charges: detached(charges), overheads: detached(overheads), plans: structuredClone(plans), events: structuredClone(events),
          logs: structuredClone(logs), artifacts: detached(artifacts), phases: structuredClone(phases),
          phaseStarts: detached(phaseStarts), preparations: detached(preparations),
          invocations: detached(invocations), accounting: structuredClone(accounting), consumptions: structuredClone(consumptions),
          admissions: structuredClone(admissions), financialAvailable,
          reservations: structuredClone(reservations.map(row => ({ ...row, actualMoney: row.actualMoney?.toFixed(6) ?? null }))),
          bounded: runs.length <= 50 && steps.length <= 200 && plans.length <= 50 && charges.length <= 1000
            && overheads.length <= 1000 && events.length <= 1000 && logs.length <= 20 && artifacts.length <= 200
            && phases.length <= 200 && phaseStarts.length <= 200 && consumptions.length <= 200
            && preparations.length <= 200 && invocations.length <= 50
            && accounting.length <= 50 && reservations.length <= 50 && admissions.length <= 50 };
      };
      const snapshot = await readSnapshot();
      this.validateSnapshot(snapshot, initial, window);
      const receipts: Array<() => Promise<unknown>> = [];
      const financialComplete = await this.financialComplete(snapshot, initial, receipts);
      const value = empty();
      value.cancellation = await this.cancellation(snapshot, initial, receipts, financialComplete);
      value.recovery = await this.recovery(snapshot, initial, receipts, financialComplete);
      const revalidate = async () => {
        await authorize();
        if (!isDeepStrictEqual(await readSnapshot(), snapshot)) throw conflict();
        for (const receipt of receipts) await receipt();
        // Receipt/account reads may await after the first snapshot comparison.
        // Recheck all source rows again before delivering their old projection.
        if (!isDeepStrictEqual(await readSnapshot(), snapshot)) throw conflict();
        await authorize();
      };
      await revalidate();
      return { value, revalidate, reauthorize: authorize };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof BudgetError) throw new AiTaskRepositoryError(error.code === 'INVALID' ? 'AI_INVALID_INPUT'
        : error.code === 'FORBIDDEN' ? 'AI_ACCESS_DENIED'
          : ['REVISION_CONFLICT', 'PENDING_RECONCILIATION'].includes(error.code) ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }

  private validateSnapshot(s: Snapshot, context: AiExecutionContext, window: Date) {
    const key = { scopeId: s.task.scopeId, taskId: s.task.id }, belongs = (row: typeof key) =>
      row.scopeId === key.scopeId && row.taskId === key.taskId;
    const unique = (values: readonly string[]) => { if (new Set(values).size !== values.length) throw fail(); };
    unique(s.runs.map(row => row.id)); unique(s.steps.map(row => row.id)); unique(s.charges.map(row => row.chargeId));
    unique(s.overheads.map(row => row.id)); unique(s.plans.map(row => row.runId)); unique(s.events.map(row => row.cursor.toString()));
    unique(s.preparations.map(row => row.id));
    unique(s.phaseStarts.map(row => row.id));
    unique(s.logs.map(row => row.id)); unique([...s.artifacts.map(row => row.id), ...s.phases.map(row => row.id)]);
    for (const run of s.runs) {
      if (!belongs(run) || !id.safeParse(run.id).success || !revision.safeParse(run.revision).success
        || !revision.safeParse(run.sequence).success || run.actorKind !== 'USER'
        || context.actor.kind !== 'user' || run.actorId !== context.actor.userId
        || !AI_TASK_STATUSES_DRAFT.includes(run.status.toLowerCase() as AiTaskStatusDraft)) throw denied();
      if (run.startedAt && (time(run.startedAt) < time(s.task.createdAt) || time(run.startedAt) > time(window))
        || run.endedAt && (time(run.endedAt) < time(s.task.createdAt) || time(run.endedAt) > time(window)
          || run.startedAt && time(run.endedAt) < time(run.startedAt))) throw fail();
    }
    for (const step of s.steps) if (!belongs(step) || !id.safeParse(step.id).success
      || !s.runs.some(run => run.id === step.runId) && s.runs.length <= 50
      || !revision.safeParse(step.revision).success || !revision.safeParse(step.sequence).success
      || !longId.safeParse(step.actionId).success || !digest.safeParse(step.requestFingerprint).success
      || !AI_STEP_STATUSES_DRAFT.includes(step.status.toLowerCase() as typeof AI_STEP_STATUSES_DRAFT[number])
      || !['NONE', 'POSSIBLE', 'COMMITTED'].includes(step.effect)) throw fail();
    for (const row of s.plans) {
      const parsed = aiTaskRunPlanSchema.safeParse(row.payload);
      if (!belongs(row) || !parsed.success || row.planHash !== hash(row.payload)
        || parsed.data.taskId !== key.taskId || parsed.data.runId !== row.runId
        || !digest.safeParse(row.authorityHash).success || !longId.safeParse(row.policyVersion).success
        || parsed.data.taskRevision > s.task.revision || time(row.createdAt) > time(window)) throw fail();
    }
    for (const event of s.events) if (!belongs(event) || !revision.safeParse(event.taskRevision).success
      || uint(event.cursor) < 1n || event.cursor > s.task.eventCursor || event.taskRevision > s.task.revision
      || time(event.occurredAt) < time(s.task.createdAt) || time(event.occurredAt) > time(window)) throw fail();
    for (const charge of s.charges) if (!belongs(charge) || !id.safeParse(charge.chargeId).success
      || !digest.safeParse(charge.requestFingerprint).success || !['STEPS', 'CALLS', 'ACTIVE_MS', 'OUTPUT_BYTES'].includes(charge.resource)
      || !['RESERVED', 'UNKNOWN', 'RECORDED'].includes(charge.status) || uint(charge.amount) < 1n
      || !revision.safeParse(charge.revision).success
      || !s.runs.some(row => row.id === charge.runId) && s.runs.length <= 50
      || !token.safeParse(charge.fencingToken).success
      || charge.status !== 'RECORDED' && (charge.actualAmount !== null || charge.evidenceRef !== null || charge.outcomeFingerprint !== null)) throw fail();
    for (const row of s.overheads) if (!belongs(row) || !id.safeParse(row.id).success
      || !revision.safeParse(row.runRevision).success || !longId.safeParse(row.leaseOwnerId).success
      || !digest.safeParse(row.originHash).success || !digest.safeParse(row.policyHash).success
      || time(row.startedAt) < time(s.task.createdAt) || time(row.startedAt) >= time(row.expiresAt)
      || time(row.startedAt) > time(window)) throw fail();
  }

  private transition(s: Snapshot, event: Event) {
    const parsed = envelope.safeParse(event.payload);
    if (event.type !== 'task.transition' || !parsed.success) throw fail();
    const { data, initiator } = parsed.data;
    if (initiator.actorKind !== 'USER') throw denied();
    const decision = evaluateAiTaskTransitionDraft({ contractVersion: AI_TASK_DRAFT_VERSION, taskId: s.task.id,
      revision: event.taskRevision - 1, status: data.from, steps: s.steps.map(step => ({ stepId: step.id,
        runId: step.runId, sequence: step.sequence, revision: step.revision, actionId: step.actionId,
        outcome: { status: step.status.toLowerCase() as typeof AI_STEP_STATUSES_DRAFT[number],
          effect: step.effect.toLowerCase() as 'none' | 'possible' | 'committed' } })) }, {
      contractVersion: AI_TASK_DRAFT_VERSION, taskId: s.task.id, expectedRevision: event.taskRevision - 1,
      ...data, occurredAt: event.occurredAt.toISOString(), initiator: { kind: initiator.kind, id: initiator.id }
    });
    if (!decision.allowed || decision.nextRevision !== event.taskRevision) throw fail();
    return parsed.data;
  }

  private ledgerComplete(s: Snapshot) {
    const budget = s.budget;
    if (!s.bounded || !budget) return false;
    if (budget.scopeId !== s.task.scopeId || budget.taskId !== s.task.id
      || !revision.safeParse(budget.revision).success || !digest.safeParse(budget.policyFingerprint).success) throw fail();
    const resources = [['STEPS', budget.maxSteps, budget.consumedSteps, budget.reservedSteps],
      ['CALLS', budget.maxCalls, budget.consumedCalls, budget.reservedCalls],
      ['ACTIVE_MS', budget.maxActiveMs, budget.consumedActiveMs, budget.reservedActiveMs],
      ['OUTPUT_BYTES', budget.maxOutputBytes, budget.consumedOutputBytes, budget.reservedOutputBytes]] as const;
    let complete = s.charges.length > 0;
    for (const [resource, ceiling, consumed, reserved] of resources) {
      if (uint(ceiling) < 1n || uint(consumed) + uint(reserved) > ceiling) throw fail();
      let known = 0n, pending = 0n;
      for (const row of s.charges.filter(charge => charge.resource === resource)) {
        if (row.status === 'RECORDED') {
          if (row.actualAmount === null || uint(row.actualAmount) > row.amount
            || !digest.safeParse(row.outcomeFingerprint).success || !row.evidenceRef) throw fail();
          known += row.actualAmount;
        } else { pending += row.amount; complete = false; }
      }
      // A missing original charge is incomplete evidence, not a zero charge.
      // Excess/mismatched stored accounting remains an invalid observation.
      if (known > consumed || pending > reserved) throw fail();
      if (known !== consumed || pending !== reserved) complete = false;
    }
    if (!complete) return false;
    // The cumulative account includes old generations and preparation. A
    // recorded scalar cannot replace their immutable original time receipts.
    if (s.overheads.some(row => !this.intervalComplete(s, row))
      || s.preparations.some(row => !this.preparationComplete(s, row))) return false;
    return s.charges.filter(row => row.stepId === null).every(row => row.resource === 'ACTIVE_MS'
      && (s.overheads.some(value => value.id === row.chargeId && row.evidenceRef === `overhead:${value.id}`)
        || s.preparations.some(value => value.id === row.chargeId && row.evidenceRef === `preparation:${value.id}`)));
  }

  private preparationComplete(s: Snapshot, row: Preparation) {
    const definition = taskPreparationDefinitionSchema.safeParse(row.definition),
      run = s.runs.find(value => value.id === row.runId), charge = s.charges.find(value => value.chargeId === row.chargeId);
    if (!run || !charge || !row.completedAt || row.activeMs === null) return false;
    if (!definition.success || row.scopeId !== s.task.scopeId || row.taskId !== s.task.id
      || definition.data.taskId !== row.taskId
      || ![run.id, run.resourceOriginRunId ?? run.id].includes(definition.data.runId)
      || hash(row.definition) !== row.definitionHash || !digest.safeParse(row.authorityHash).success
      || !longId.safeParse(row.policyVersion).success || row.id !== row.chargeId
      || !revision.safeParse(row.runRevision).success || row.runRevision > run.revision
      || BigInt(row.fencingToken) > BigInt(run.fencingToken)
      || time(row.startedAt) < time(s.task.createdAt) || time(row.completedAt) < time(row.startedAt)
      || time(row.completedAt) >= time(row.expiresAt) || time(row.completedAt) > time(this.clock())) throw fail();
    const measurement = hash({ version: 'run-preparation-measurement-1', scopeId: row.scopeId, taskId: row.taskId,
      runId: row.runId, definitionHash: row.definitionHash, authorityHash: row.authorityHash, policyVersion: row.policyVersion,
      leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken, runRevision: row.runRevision,
      chargeId: row.chargeId, requestFingerprint: row.requestFingerprint, prepared: row.prepared,
      planHash: row.planHash, activeMs: uint(row.activeMs).toString() });
    if (row.measurementHash !== measurement || charge.resource !== 'ACTIVE_MS' || charge.runId !== row.runId
      || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
      || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken !== row.fencingToken
      || charge.requestFingerprint !== row.requestFingerprint || charge.status !== 'RECORDED'
      || charge.actualAmount !== row.activeMs || row.activeMs > charge.amount
      || charge.outcomeFingerprint !== measurement || charge.evidenceRef !== `preparation:${row.id}`) throw fail();
    const plan = s.plans.find(value => value.runId === row.runId);
    if (row.prepared ? !plan : row.planHash !== null) return false;
    if (row.prepared && row.planHash !== plan!.planHash) throw fail();
    return true;
  }

  private intervalComplete(s: Snapshot, row: Overhead) {
    if (!row.completedAt || row.activeMs === null || !row.chargeId || !row.requestFingerprint) return false;
    const charge = s.charges.find(candidate => candidate.chargeId === row.chargeId);
    if (!charge) return false;
    if (row.id !== row.chargeId || time(row.completedAt) < time(row.startedAt)
      || time(row.completedAt) >= time(row.expiresAt) || time(row.completedAt) > time(this.clock())
      || !s.budget || row.policyHash !== s.budget.policyFingerprint) throw fail();
    const originalHash = hash({ version: 'run-overhead-measurement-1', scopeId: row.scopeId,
      taskId: row.taskId, runId: row.runId, id: row.id, segment: row.segment, originHash: row.originHash,
      policyHash: row.policyHash, leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken,
      runRevision: row.runRevision, expiresAt: row.expiresAt.toISOString(), chargeId: row.chargeId,
      requestFingerprint: row.requestFingerprint, activeMs: uint(row.activeMs).toString(), completedAt: row.completedAt.toISOString() });
    if (row.measurementHash !== originalHash || charge.runId !== row.runId || charge.resource !== 'ACTIVE_MS'
      || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
      || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken !== row.fencingToken
      || charge.requestFingerprint !== row.requestFingerprint || uint(charge.amount) < row.activeMs) throw fail();
    if (charge.status !== 'RECORDED') return false;
    if (charge.actualAmount !== row.activeMs || charge.outcomeFingerprint !== originalHash
      || charge.evidenceRef !== `overhead:${row.id}`) throw fail();
    const run = s.runs.find(value => value.id === row.runId);
    const origin = run && s.plans.find(plan => plan.runId === (run.resourceOriginRunId ?? run.id));
    if (!origin) return false;
    const original = aiTaskRunPlanSchema.parse(origin.payload);
    if (row.originHash !== hash({ taskId: original.taskId, runId: original.runId,
      steps: original.steps, limits: original.limits })) throw fail();
    return true;
  }

  private async financialComplete(s: Snapshot, context: AiExecutionContext, checks: Array<() => Promise<unknown>>) {
    const modelCharges = s.charges.filter(row => row.resource === 'CALLS');
    const modelSteps = s.steps.filter(row => [AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE,
      AI_AUDIO_MODEL_STEP_CODE, AI_TEXT_CAPABILITY_PROBE_STEP_CODE].some(code => code === row.toolCode));
    if (!modelCharges.length && !s.invocations.length) return modelSteps.length === 0;
    if (!s.bounded || !s.financialAvailable || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') return false;
    if (!modelCharges.length || !s.invocations.length || typeof this.financial?.summary !== 'function') return false;
    const summary = await this.financial.summary({ taskId: s.task.id });
    const { observedAt: _observed, ...stableSummary } = summary;
    checks.push(async () => {
      const { observedAt: _latest, ...latest } = await this.financial!.summary!({ taskId: s.task.id });
      if (!isDeepStrictEqual(latest, stableSummary)) throw conflict();
    });
    if (summary.state !== 'observed' || !summary.accountingComplete
      || summary.coverage !== 'all_registered_invocations' || summary.invocationCount !== s.invocations.length
      || summary.notRecordedCount !== 0) return false;
    if (modelCharges.some(row => !s.invocations.some(value => value.id === row.gatewayInvocationId))
      || modelSteps.some(row => !s.invocations.some(value => value.stepId === row.id))) return false;
    for (const invocation of s.invocations) {
      const charges = modelCharges.filter(row => row.gatewayInvocationId === invocation.id);
      if (!charges.length || !charges.some(row => !isTaskModelCountCharge(row))) throw fail();
      const step = s.steps.find(row => row.id === invocation.stepId);
      if (!step || invocation.scopeId !== s.task.scopeId || invocation.taskId !== s.task.id
        || invocation.runId !== step.runId || invocation.actionId !== step.actionId
        || invocation.stepFingerprint !== step.requestFingerprint || invocation.actorId !== context.actor.userId
        || !isGatewayConfig(invocation.configuration) || hash(invocation.configuration) !== invocation.configurationHash
        || !('tenantId' in invocation.configuration) || invocation.configuration.tenantId !== context.scope.tenantId
        || !digest.safeParse(invocation.registrationHash).success || !longId.safeParse(invocation.callId).success
        || charges.some(row => row.runId !== invocation.runId || row.stepId !== step.id || row.actionId !== step.actionId
          || row.stepFingerprint !== step.requestFingerprint || row.leaseOwnerId !== invocation.leaseOwnerId
          || row.fencingToken !== invocation.fencingToken)) throw denied();
      if (charges.some(row => row.status !== 'RECORDED')) return false;
      const accounting = s.accounting.filter(row => row.invocationId === invocation.id);
      if (!accounting.length) return false;
      if (accounting.length !== 1) throw fail();
      const receipt = accounting[0], reservation = s.reservations.find(row => row.id === receipt.reservationId),
        admission = s.admissions.find(row => row.id === receipt.admissionId);
      if (!reservation || !admission) return false;
      if (receipt.scopeId !== s.task.scopeId || receipt.taskId !== s.task.id || receipt.scopeKind !== 'WORKSPACE'
        || receipt.tenantId !== context.scope.tenantId || receipt.workspaceId !== context.scope.workspaceId
        || receipt.dispatchToken !== admission.dispatchId || receipt.requestHash !== admission.requestHash
        || admission.scopeKind !== 'WORKSPACE' || admission.tenantId !== context.scope.tenantId
        || admission.workspaceId !== context.scope.workspaceId || admission.actorId !== invocation.actorId
        || admission.callId !== invocation.callId || admission.profileId !== invocation.configuration.configId
        || reservation.scopeId !== s.task.scopeId || reservation.scopeKind !== 'WORKSPACE'
        || reservation.tenantId !== context.scope.tenantId || reservation.workspaceId !== context.scope.workspaceId
        || reservation.actorId !== invocation.actorId || reservation.callId !== invocation.callId
        || reservation.requestId !== invocation.callId || reservation.idempotencyKey !== invocation.callId
        || reservation.runId !== invocation.runId || reservation.stepId !== invocation.stepId
        || reservation.actionId !== invocation.actionId || reservation.sceneCode !== invocation.sceneCode
        || reservation.configRevision !== invocation.configuration.configRevision
        || reservation.configurationHash !== invocation.configurationHash || reservation.priceVersion !== invocation.priceVersion) throw denied();
      if (reservation.status === 'released') {
        if (reservation.dispatchState !== 'not_dispatched' || receipt.state !== 'cancelled'
          || admission.status !== 'cancelled' || !admission.revokedAt || admission.completedAt !== null
          || admission.unknownReason !== null || receipt.usageHash !== null
          || receipt.inputTokens !== null || receipt.outputTokens !== null) return false;
        continue;
      }
      if (reservation.status !== 'settled' || reservation.dispatchState !== 'completed'
        || receipt.state !== 'dispatched' || !['completed', 'unknown'].includes(admission.status)) return false;
      if (receipt.inputTokens === null || receipt.outputTokens === null || !receipt.usageHash) return false;
      const usage = { inputTokens: Number(uint(receipt.inputTokens)), outputTokens: Number(uint(receipt.outputTokens)),
        ...(receipt.usageDetails !== null ? { billingDetails: receipt.usageDetails } : {}) };
      if (!modelUsageSchema.safeParse(usage).success || hash({ receiptId: receipt.id,
        invocationId: receipt.invocationId, admissionId: receipt.admissionId, reservationId: receipt.reservationId,
        dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash, usage }) !== receipt.usageHash) throw fail();
    }
    return true;
  }

  private terminalEvidence(s: Snapshot, event: Event, context: AiExecutionContext,
    financialComplete: boolean, generation?: Generation) {
    if (!s.bounded || !financialComplete || !this.ledgerComplete(s) || !s.runs.length) return null;
    const run = s.runs.at(-1)!;
    const endedAt = run.endedAt;
    if (!endedAt || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
      || !terminal(run.status.toLowerCase()) || !terminal(s.task.status.toLowerCase())
      || s.runs.some((value, index) => value.sequence !== index + 1 || !terminal(value.status.toLowerCase())
        || value.leaseOwnerId !== null || value.leaseExpiresAt !== null)) return null;
    if (generation && (run.id !== generation.runId || run.fencingToken !== generation.fence)) return null;
    if (time(endedAt) !== time(event.occurredAt)) return null;
    const proof = this.transition(s, event), owner = proof.initiator;
    if (context.actor.kind !== 'user' || owner.actorId !== context.actor.userId || run.actorId !== owner.actorId) throw denied();
    if (proof.data.to !== s.task.status.toLowerCase()) throw fail();
    if (generation && (owner.kind !== 'worker' || owner.id !== generation.holder)) return null;
    const scope = aiTaskAccessFromContext(context, s.task.id, this.clock()).scope;
    for (const currentRun of s.runs) {
      const saved = s.plans.find(row => row.runId === currentRun.id);
      if (!saved) return null;
      const plan = aiTaskRunPlanSchema.parse(saved.payload), ownSteps = s.steps.filter(step => step.runId === currentRun.id)
        .sort((a, b) => a.sequence - b.sequence);
      // A settled cancellation can leave an unstarted planned suffix. Its
      // recorded outcome describes the original request's disposition, not a
      // claim that every planned business step ran. Normal success needs all.
      if (currentRun.status === 'SUCCEEDED' && ownSteps.length !== plan.steps.length
        && !(currentRun.id === run.id && proof.data.reason === 'cancel_settled')) return null;
      for (const [index, step] of ownSteps.entries()) {
        const planned = plan.steps[index];
        if (!planned || step.sequence !== index + 1 || step.toolCode !== planned.toolCode || step.toolVersion !== planned.toolVersion
          || step.actionId !== aiStepActionId(scope, s.task.id, planned.registrationRef)) throw fail();
        const registrations = s.events.filter(row => row.type === 'step.registered'
          && typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)
          && (row.payload as { data?: { stepId?: unknown } }).data?.stepId === step.id);
        if (!registrations.length) return null;
        if (registrations.length !== 1) throw fail();
        const registration = z.object({ data: z.object({ stepId: id, runId: id, sequence: revision,
          stepRevision: z.literal(1) }).strict(), registration: z.object({ reference: longId, digest }).strict(),
          initiator: z.object({ kind: z.literal('worker'), id: longId, actorKind: z.literal('USER'), actorId: longId }).strict() }).passthrough()
          .safeParse(registrations[0].payload);
        if (!registration.success || registration.data.data.runId !== step.runId || registration.data.data.sequence !== step.sequence
          || registration.data.registration.reference !== planned.registrationRef
          || registration.data.initiator.actorId !== run.actorId
          || registrations[0].cursor >= event.cursor || time(registrations[0].occurredAt) > time(event.occurredAt)) throw fail();
        if (['RUNNING', 'UNKNOWN', 'PENDING'].includes(step.status)) return null;
        if (step.status === 'SUCCEEDED' || step.status === 'FAILED') {
          if (!step.resultRef) return null;
          const result = s.artifacts.find(row => row.id === step.resultRef);
          const phase = s.phases.find(row => row.id === step.resultRef);
          if (!result && !phase) return null;
          const row = result ?? phase!;
          if (row.scopeId !== s.task.scopeId || row.taskId !== s.task.id || row.runId !== step.runId || row.stepId !== step.id
            || !digest.safeParse(row.contentHash).success || row.contentHash !== hash(row.payload)
            || uint(row.outputBytes) !== BigInt(Buffer.byteLength(JSON.stringify(row.payload), 'utf8'))
            || time(row.createdAt) > time(event.occurredAt)) throw fail();
          if (result && (!result.completeMeasurement || result.outcome !== step.status)) return null;
          if (result && (BigInt(result.fencingToken) > BigInt(currentRun.fencingToken) || result.actionId !== step.actionId
            || result.stepFingerprint !== step.requestFingerprint)) throw fail();
          if (phase && phase.kind !== step.status.toLowerCase()) return null;
          const changed = s.events.filter(row => row.type === 'step.changed'
            && (row.payload as { data?: { stepId?: unknown; stepRevision?: unknown } } | null)?.data?.stepId === step.id
            && (row.payload as { data?: { stepRevision?: unknown } } | null)?.data?.stepRevision === step.revision);
          if (!changed.length) return null;
          if (changed.length !== 1) throw fail();
          const finalStep = z.object({ data: z.object({ stepId: id, runId: id, stepRevision: revision,
            status: z.enum(AI_STEP_STATUSES_DRAFT), reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT) }).strict(),
            initiator: z.object({ kind: z.literal('worker'), id: longId, actorKind: z.literal('USER'), actorId: longId }).strict(),
            evidence: z.object({ id: longId, revision, digest }).strict() }).passthrough().safeParse(changed[0].payload);
          if (!finalStep.success || finalStep.data.data.runId !== step.runId
            || finalStep.data.data.status !== step.status.toLowerCase() || finalStep.data.initiator.actorId !== run.actorId
            || finalStep.data.evidence.id !== step.resultRef || finalStep.data.evidence.revision >= step.revision
            || changed[0].cursor <= registrations[0].cursor || changed[0].cursor >= event.cursor
            || time(changed[0].occurredAt) < time(row.createdAt) || time(changed[0].occurredAt) > time(endedAt)) throw fail();
          const start = phase && s.phaseStarts.find(value => value.id === phase.phaseId);
          if (phase && !start) return null;
          let resourceOrigin = result, measuredActive = result?.activeMs, measuredOutput = result?.outputBytes;
          if (phase) {
            const starts = s.phaseStarts.filter(value => value.stepId === step.id).sort((a, b) => a.sequence - b.sequence),
              receipts = s.phases.filter(value => value.stepId === step.id), first = starts[0];
            if (!first || !starts.length || receipts.length !== starts.length) return null;
            if (starts.length > 2 || start!.sequence !== starts.length) throw fail();
            const origin = s.artifacts.find(value => value.id === first.originalArtifactId);
            if (!origin) return null;
            if (origin.scopeId !== s.task.scopeId || origin.taskId !== s.task.id || origin.runId !== step.runId
              || origin.stepId !== step.id || origin.actionId !== step.actionId || origin.stepFingerprint !== step.requestFingerprint
              || origin.leaseOwnerId !== first.leaseOwnerId || origin.fencingToken !== first.fencingToken
              || origin.outcome !== 'RUNNING' || origin.completeMeasurement
              || origin.contentHash !== hash({}) || hash(origin.payload) !== origin.contentHash
              || origin.activeMs !== 0n || origin.outputBytes !== 0n) throw fail();
            for (const [index, current] of starts.entries()) {
              const parsed = taskExecutionPhaseStartSchema.safeParse({ ...current,
                fencingToken: new Prisma.Decimal(current.fencingToken) });
              if (!parsed.success || current.sequence !== index + 1 || current.scopeId !== s.task.scopeId
                || current.taskId !== s.task.id || current.runId !== step.runId || current.stepId !== step.id
                || current.originalArtifactId !== origin.id || current.actionId !== step.actionId
                || current.inputRef !== step.inputRef || current.stepFingerprint !== step.requestFingerprint
                || current.planHash !== saved.planHash || current.stepRevision >= step.revision
                || current.runRevision > currentRun.revision || BigInt(current.fencingToken) > BigInt(currentRun.fencingToken)) throw fail();
              const matches = receipts.filter(value => value.phaseId === current.id);
              if (matches.length !== 1) throw fail();
              const receipt = matches[0], parsedReceipt = taskExecutionPhaseReceiptSchema.safeParse(receipt),
                payload = aiTaskConfirmationPhasePayloadSchema.safeParse(receipt.payload);
              if (!parsedReceipt.success || !payload.success || time(receipt.createdAt) < time(current.createdAt)
                || time(receipt.createdAt) > time(endedAt) || hash(receipt.payload) !== receipt.contentHash
                || uint(receipt.outputBytes) !== BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8'))
                || payload.data.binding.scopeId !== s.task.scopeId || payload.data.binding.taskId !== s.task.id
                || payload.data.binding.runId !== step.runId || payload.data.binding.stepId !== step.id
                || payload.data.binding.actionId !== step.actionId || payload.data.binding.inputRef !== step.inputRef
                || payload.data.binding.fingerprint !== step.requestFingerprint
                || payload.data.presentedLease.holderId !== current.leaseOwnerId
                || payload.data.presentedLease.runId !== step.runId || payload.data.presentedLease.taskId !== s.task.id
                || payload.data.presentedLease.fencingToken !== current.fencingToken
                || payload.data.presentedLease.revision !== current.runRevision) throw fail();
              if (index === 0 && (current.previousReceiptId !== null || current.decisionRef !== null)
                || index === 1 && (current.previousReceiptId !== receipts.find(value => value.phaseId === first.id)?.id
                  || current.decisionRef !== phase.decisionRef)) throw fail();
              if (current.stepsChargeId !== first.stepsChargeId || current.activeMsChargeId !== first.activeMsChargeId
                || current.outputBytesChargeId !== first.outputBytesChargeId) throw fail();
              if (index < starts.length - 1 && receipt.kind !== 'confirmation') throw fail();
            }
            if (phase.kind === 'succeeded') {
              const consumption = s.consumptions.find(value => value.actionId === step.actionId);
              if (!consumption) return null;
              if (consumption.scopeId !== s.task.scopeId || consumption.taskId !== s.task.id
                || consumption.status !== 'COMMITTED' || consumption.actionFingerprint !== step.requestFingerprint
                || consumption.resultRef !== phase.businessResultRef || consumption.approvalId !== phase.decisionRef
                || consumption.proposalId !== phase.proposalId || consumption.proposalRevision !== phase.proposalRevision
                || time(consumption.updatedAt) > time(endedAt)) throw fail();
            }
            const originalCharges = s.charges.filter(value => value.stepId === step.id);
            if (originalCharges.find(value => value.resource === 'STEPS')?.chargeId !== first.stepsChargeId
              || originalCharges.find(value => value.resource === 'ACTIVE_MS')?.chargeId !== first.activeMsChargeId
              || originalCharges.find(value => value.resource === 'OUTPUT_BYTES')?.chargeId !== first.outputBytesChargeId) throw fail();
            resourceOrigin = origin;
            measuredActive = receipts.reduce((sum, value) => sum + value.activeMs, 0n);
            measuredOutput = receipts.reduce((sum, value) => sum + value.outputBytes, 0n);
          }
          const holder = resourceOrigin!.leaseOwnerId, resultFence = resourceOrigin!.fencingToken,
            outcomeHolder = result?.leaseOwnerId ?? start!.leaseOwnerId, outcomeFence = result?.fencingToken ?? start!.fencingToken;
          if (outcomeFence === currentRun.fencingToken && finalStep.data.initiator.id !== outcomeHolder) throw denied();
          const charges = s.charges.filter(value => value.runId === step.runId && value.stepId === step.id);
          if (!taskStepChargesValid(charges) || charges.some(value => value.status !== 'RECORDED')) return null;
          if (charges.some(value => value.actionId !== step.actionId || value.stepFingerprint !== step.requestFingerprint
            || value.leaseOwnerId !== holder || value.fencingToken !== resultFence)) throw fail();
          const base = charges.filter(value => !isTaskModelCountCharge(value));
          if (base.find(value => value.resource === 'STEPS')?.actualAmount !== 1n
            || base.find(value => value.resource === 'ACTIVE_MS')?.actualAmount === null
            || base.find(value => value.resource === 'OUTPUT_BYTES')?.actualAmount === null) return null;
          if (base.find(value => value.resource === 'ACTIVE_MS')?.actualAmount !== measuredActive
            || base.find(value => value.resource === 'OUTPUT_BYTES')?.actualAmount !== measuredOutput) throw fail();
          if (base.some(value => value.evidenceRef !== `${row.id}:${value.resource.toLowerCase()}`)) throw fail();
        }
      }
    }
    const currentIntervals = s.overheads.filter(row => row.runId === run.id && row.fencingToken === run.fencingToken);
    if (!currentIntervals.length || currentIntervals.some(row => !this.intervalComplete(s, row))) return null;
    const currentCharges = s.charges.filter(row => row.runId === run.id && row.fencingToken === run.fencingToken
      && row.resource === 'ACTIVE_MS' && row.stepId === null);
    if (currentCharges.length !== currentIntervals.length
      || currentCharges.some(charge => !currentIntervals.some(row => row.id === charge.chargeId))) return null;
    if (currentIntervals.some(row => row.runRevision + 1 >= run.revision)) return null;
    if (owner.kind === 'worker' && currentIntervals.some(row => row.leaseOwnerId !== owner.id)) return null;
    // Bind the last pre/startup span to the original event/CAS path and release.
    // An earlier same-time span cannot replace that final receipt.
    const latestRevision = Math.max(...currentIntervals.map(row => row.runRevision));
    const closingIntervals = currentIntervals.filter(row => row.runRevision === latestRevision);
    const lastPlan = aiTaskRunPlanSchema.parse(s.plans.find(row => row.runId === run.id)!.payload);
    const ownSteps = s.steps.filter(step => step.runId === run.id).sort((a, b) => a.sequence - b.sequence);
    const cancelledSuffix = proof.data.reason === 'cancel_settled' && ownSteps.length < lastPlan.steps.length
      && ownSteps.every(step => step.status === 'SUCCEEDED');
    const lastIndex = cancelledSuffix ? ownSteps.length : Math.max(0, ownSteps.length - 1);
    const requiredSegment = lastPlan.steps.length ? `pre:${lastPlan.steps[lastIndex]?.registrationRef}` : 'startup';
    const closing = closingIntervals.filter(row => row.segment === requiredSegment);
    if (!closing.length) return null;
    if (closing.length !== 1) throw fail();
    const span = closing[0], revisionDistance = run.revision - span.runRevision;
    const recovering = span.id === uuid(hash({ version: 'run-overhead-charge-1', scopeId: span.scopeId,
      taskId: span.taskId, runId: span.runId, holder: span.leaseOwnerId, fence: span.fencingToken,
      segment: span.segment, recoveryRevision: span.runRevision }));
    if (recovering) {
      // Recovery only observes an existing registration: terminal/release add
      // two CAS revisions, and recording its original result may add one.
      if (revisionDistance !== 2 && revisionDistance !== 3) return null;
    } else if (cancelledSuffix || !lastPlan.steps.length) {
      if (revisionDistance !== 2) return null;
    } else if (revisionDistance === 3) {
      const step = ownSteps[lastIndex], phase = step && s.phases.find(row => row.id === step.resultRef),
        start = phase && s.phaseStarts.find(row => row.id === phase.phaseId);
      if (!step || !phase || !start || start.runRevision !== span.runRevision
        || start.leaseOwnerId !== span.leaseOwnerId || start.fencingToken !== span.fencingToken
        || time(start.createdAt) < time(span.startedAt)) return null;
      const resumed = s.events.filter(row => row.type === 'task.transition'
        && (row.payload as { confirmation?: { runId?: unknown; runRevision?: unknown; phaseId?: unknown } } | null)
          ?.confirmation?.runId === run.id
        && (row.payload as { confirmation?: { runRevision?: unknown } }).confirmation?.runRevision === span.runRevision);
      if (resumed.length !== 1) return null;
      const value = resumed[0], detail = (value.payload as { confirmation: {
        phaseId: string; fencingToken: string; holderId: string; decisionRef: string } }).confirmation,
        result = s.events.find(row => row.type === 'step.changed'
          && (row.payload as { data?: { stepId?: unknown; stepRevision?: unknown } } | null)?.data?.stepId === step.id
          && (row.payload as { data?: { stepRevision?: unknown } }).data?.stepRevision === step.revision);
      if (!result || value.cursor >= result.cursor || result.cursor >= event.cursor
        || this.transition(s, value).data.reason !== 'resume'
        || !s.phases.some(row => row.id === start.previousReceiptId && row.phaseId === detail.phaseId)
        || detail.fencingToken !== span.fencingToken || detail.holderId !== span.leaseOwnerId
        || detail.decisionRef !== phase.decisionRef) return null;
    } else {
      // A normal pre-step span precedes registration, start and result. Bind
      // those three original events instead of borrowing recovery's shorter
      // revision path or rejecting a fully recorded normal cancellation.
      const step = ownSteps[lastIndex];
      if (!step || revisionDistance !== 5) return null;
      const original = s.events.filter(row => ['step.registered', 'step.changed'].includes(row.type)
        && (row.payload as { data?: { stepId?: unknown } } | null)?.data?.stepId === step.id);
      const started = original.filter(row => row.type === 'step.changed'
        && (row.payload as { data?: { status?: unknown; stepRevision?: unknown } }).data?.status === 'running'
        && (row.payload as { data?: { stepRevision?: unknown } }).data?.stepRevision === 2);
      if (original.length !== 3 || started.length !== 1 || step.revision !== 3
        || original.some(row => time(row.occurredAt) < time(span.startedAt) || row.cursor >= event.cursor
          || (row.payload as { initiator?: { id?: unknown } }).initiator?.id !== span.leaseOwnerId)) return null;
    }
    const completion = currentIntervals.reduce((last, row) => Math.max(last, time(row.completedAt!)), 0);
    if (!closing[0].completedAt || time(closing[0].completedAt) < time(endedAt) || completion < time(endedAt)) return null;
    return { outcome: proof.data.to as TerminalOutcome, completedAt: new Date(completion) };
  }

  private async cancellation(s: Snapshot, context: AiExecutionContext,
    checks: Array<() => Promise<unknown>>, financialComplete: boolean) {
    const none = emptyCancellation();
    if (!s.task.cancelRequestedAt) return none;
    const requests = s.events.filter(row => row.type === 'task.transition' && time(row.occurredAt) === time(s.task.cancelRequestedAt!)
      && envelope.safeParse(row.payload).success && envelope.parse(row.payload).data.to === 'cancel_requested');
    if (!requests.length) return { ...none, state: 'pending' as const,
      requestedAt: new Date(time(s.task.cancelRequestedAt)).toISOString() };
    if (requests.length !== 1) throw fail();
    const request = requests[0], original = envelope.parse(request.payload);
    if (request.taskRevision < 2 || original.data.reason !== 'cancel_requested' || original.initiator.kind !== 'user'
      || context.actor.kind !== 'user' || original.initiator.id !== context.actor.userId
      || original.initiator.actorId !== context.actor.userId || original.initiator.actorKind !== 'USER') throw denied();
    const repository = new AiTaskTransitionRepository({ aiTask: this.db.aiTask, aiRun: this.db.aiRun,
      $transaction: this.db.$transaction!.bind(this.db) }, this.actions, this.clock);
    const query = { taskId: s.task.id, expectedRevision: request.taskRevision - 1 };
    const observeRequest = async () => {
      const receipt = await repository.readCancellationReceipt(query);
      if (receipt.status !== 'observed' || receipt.event?.cursor !== request.cursor.toString()) throw conflict();
      return receipt;
    };
    await observeRequest(); checks.push(observeRequest);
    const pending: TaskCancellationObservation = { ...none, state: 'pending', requestRevision: request.taskRevision,
      requestedAt: request.occurredAt.toISOString() };
    const settled = s.events.filter(row => row.type === 'task.transition' && row.cursor > request.cursor
      && envelope.safeParse(row.payload).success && envelope.parse(row.payload).data.from === 'cancel_requested'
      && envelope.parse(row.payload).data.reason === 'cancel_settled');
    if (!settled.length) return pending;
    if (settled.length !== 1 || settled[0].taskRevision < 2) throw fail();
    const event = settled[0], observeSettlement = async () => {
      const receipt = await repository.readCancellationSettlementReceipt({ taskId: s.task.id, expectedRevision: event.taskRevision - 1 });
      if (receipt.status !== 'observed' || receipt.event?.cursor !== event.cursor.toString()) throw conflict();
      return receipt;
    };
    await observeSettlement(); checks.push(observeSettlement);
    const proof = this.terminalEvidence(s, event, context, financialComplete);
    if (!proof || !['succeeded', 'partially_succeeded', 'cancelled'].includes(proof.outcome)) return pending;
    const duration = time(event.occurredAt) - time(request.occurredAt);
    if (duration < 0) throw fail();
    return { ...pending, state: 'recorded' as const, settlementRevision: event.taskRevision,
      settledAt: event.occurredAt.toISOString(), elapsedMs: String(duration),
      outcome: proof.outcome as TaskCancellationObservation['outcome'] };
  }

  private async recovery(s: Snapshot, context: AiExecutionContext,
    checks: Array<() => Promise<unknown>>, financialComplete: boolean) {
    const generations = new Map<string, Generation>();
    const group = (runId: string, value: string, holder: string): Generation => {
      const key = JSON.stringify([runId, value]), original = generations.get(key);
      if (original && original.holder !== holder) throw fail();
      if (original) return original;
      const next: Generation = { runId, fence: value, holder, intervals: [] };
      generations.set(key, next); return next;
    };
    const repository = new PrismaTaskTakeoverRepository({ aiTask: this.db.aiTask, aiRun: this.db.aiRun,
      operationLog: this.db.operationLog, $transaction: this.db.$transaction!.bind(this.db) }, this.actions, this.clock);
    for (const row of s.logs) {
      const parsed = takeoverDetail.safeParse(row.detail);
      if (!parsed.success || context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId || row.userId !== context.actor.userId
        || parsed.data.taskId !== s.task.id || parsed.data.taskRevision > s.task.revision
        || BigInt(parsed.data.previousFencingToken) + 1n !== BigInt(parsed.data.fencingToken)
        || time(row.createdAt) < time(s.task.createdAt)) throw denied();
      const detail = parsed.data, run = s.runs.find(value => value.id === detail.runId);
      if (!run) { if (!s.bounded) continue; throw fail(); }
      if (detail.runRevision < 2 || detail.previousHolderId === detail.holderId
        || run.revision < detail.runRevision || BigInt(run.fencingToken) < BigInt(detail.fencingToken)) throw fail();
      const read = async () => {
        const value = await repository.readReceipt({ taskId: s.task.id, runId: detail.runId,
          expectedTaskRevision: detail.taskRevision, expectedRunRevision: detail.runRevision - 1,
          expectedFencingToken: detail.previousFencingToken });
        if (value.status !== 'observed' || value.receiptId !== row.id) throw conflict();
        return value;
      };
      await read(); checks.push(read);
      const entry = group(detail.runId, detail.fencingToken, detail.holderId);
      if (entry.log) throw fail(); entry.log = row;
    }
    for (const row of s.overheads) {
      // Recovery adds its original held CAS revision to this deterministic key.
      // Ordinary start/continue intervals deliberately omit it. Reconstructing
      // the existing key distinguishes recovery without minting a new receipt.
      const original = uuid(hash({ version: 'run-overhead-charge-1', scopeId: row.scopeId, taskId: row.taskId,
        runId: row.runId, holder: row.leaseOwnerId, fence: row.fencingToken, segment: row.segment, recoveryRevision: row.runRevision }));
      const run = s.runs.find(value => value.id === row.runId);
      if (!run) { if (!s.bounded) continue; throw fail(); }
      if (row.runRevision > run.revision || BigInt(row.fencingToken) > BigInt(run.fencingToken)) throw fail();
      if (row.id === original) group(row.runId, row.fencingToken, row.leaseOwnerId).intervals.push(row);
    }
    const values: TaskRecoveryObservation[] = [];
    for (const generation of generations.values()) {
      const starts = generation.intervals.filter(row => row.segment === 'startup');
      if (starts.length > 1) throw fail();
      const first = starts[0], started = generation.log?.createdAt ?? first?.startedAt ?? null;
      if (generation.log && first && time(first.startedAt) < time(generation.log.createdAt)) throw fail();
      const reference = generation.log?.id ?? first?.id ?? generation.intervals[0].id;
      const item: TaskRecoveryObservation = { runId: generation.runId, fencingToken: generation.fence,
        origin: generation.log ? 'takeover_receipt' : 'recovery_run_interval', referenceId: reference,
        state: 'pending', startedAt: started?.toISOString() ?? null, completedAt: null, elapsedMs: null, outcome: null };
      const run = s.runs.find(value => value.id === generation.runId);
      if (run?.endedAt && run.fencingToken === generation.fence && first && started
        && generation.intervals.every(row => this.intervalComplete(s, row))) {
        const events = s.events.filter(row => row.type === 'task.transition' && time(row.occurredAt) === time(run.endedAt!)
          && envelope.safeParse(row.payload).success && terminal(envelope.parse(row.payload).data.to)
          && envelope.parse(row.payload).initiator.id === generation.holder);
        if (events.length > 1) throw fail();
        const completed = events[0] && this.terminalEvidence(s, events[0], context, financialComplete, generation);
        if (completed) {
          const duration = time(completed.completedAt) - time(started);
          if (duration < 0) throw fail();
          item.state = 'recorded'; item.completedAt = completed.completedAt.toISOString();
          item.elapsedMs = String(duration); item.outcome = completed.outcome;
        }
      }
      values.push(item);
    }
    values.sort((a, b) => (b.startedAt ? Date.parse(b.startedAt) : -1) - (a.startedAt ? Date.parse(a.startedAt) : -1)
      || a.runId.localeCompare(b.runId) || (BigInt(a.fencingToken) === BigInt(b.fencingToken) ? 0
        : BigInt(a.fencingToken) > BigInt(b.fencingToken) ? -1 : 1));
    return { state: values.length ? 'observed' as const : 'not_recorded' as const, items: values.slice(0, 20),
      truncated: !s.bounded || values.length > 20, coverage: 'original_fenced_recovery_generations' as const };
  }
}

export function taskLifecycleSampleRates(values: readonly TaskLifecycleObservation[]): TaskLifecycleSampleRates {
  const requested = values.filter(value => value.cancellation.state !== 'not_recorded').length;
  const recorded = values.filter(value => value.cancellation.state === 'recorded').length;
  const attempts = values.flatMap(value => value.recovery.items);
  const recovered = attempts.filter(item => item.state === 'recorded');
  const succeeded = recovered.filter(item => item.outcome === 'succeeded').length;
  const truncated = values.some(value => value.recovery.truncated);
  return { version: 'task-lifecycle-rates-1',
    cancellation: { state: requested === 0 ? 'not_recorded' : recorded === requested ? 'recorded' : 'pending',
      requested, recorded, pending: requested - recorded, notRecordedTasks: values.length - requested,
      percent: requested && recorded === requested ? (100 * recorded / requested).toFixed(2) : null,
      basis: 'original_request_settlement_not_business_rollback' },
    recovery: { state: attempts.length === 0 && !truncated ? 'not_recorded'
      : !truncated && recovered.length === attempts.length ? 'recorded' : 'pending', attempts: attempts.length,
      recorded: recovered.length, pending: attempts.length - recovered.length, succeeded,
      notRecordedTasks: values.filter(value => value.recovery.state === 'not_recorded').length, truncated,
      percent: attempts.length && !truncated && recovered.length === attempts.length ? (100 * succeeded / attempts.length).toFixed(2) : null,
      basis: 'original_fenced_recovery_terminal_evidence' } };
}
