/** Current owner-only task/run/resource observations from original persistence.
 * No telemetry body store, model request, financial recalculation or SLO claim.
 * Missing timestamps and samples remain explicitly unmeasured. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, type AiExecutionContext, type AiTaskPerformanceObservationDraft } from '@rental-os/shared';
import { z } from 'zod';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { TaskBudgetUsageReader } from '../budget/task-budget-usage.reader';
import { BudgetError } from '../budget/budget.ports';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { gatewayBudgetDenialLogId, gatewayDeliveryLogId, gatewayDeliveryTimingSchema } from '../prisma-task-gateway-audit';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionBudget' | 'aiTaskExecutionCharge'
  | 'aiGatewayInvocation' | 'operationLog'>;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ taskId: id, usageLimit: z.number().int().min(1).max(20), usageAfter: id.optional(), includeTaskFinancial: z.boolean().optional() }).strict();
const taskSelect = { id: true, scopeId: true, sceneCode: true, sceneVersion: true, status: true, revision: true,
  eventCursor: true, createdAt: true, updatedAt: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, sequence: true,
  status: true, revision: true, startedAt: true, endedAt: true } satisfies Prisma.AiRunSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true,
  toolCode: true, toolVersion: true, status: true, effect: true, revision: true } satisfies Prisma.AiStepSelect;
const budgetSelect = { scopeId: true, taskId: true, policyVersion: true, revision: true,
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

export class TaskPerformanceReader {
  constructor(private readonly db: Db, private readonly actions: Pick<AiTaskRepositoryAuthority, 'resolve'>,
    private readonly usage: Pick<TaskBudgetUsageReader, 'read'> & Partial<Pick<TaskBudgetUsageReader, 'summary'>>, private readonly clock: () => Date = () => new Date()) {}

  async read(value: unknown): Promise<AiTaskPerformanceObservationDraft> {
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
      const runs = structuredClone(await readRuns()), steps = structuredClone(await readSteps()), budget = structuredClone(await readBudget());
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
      const latest = structuredClone(await this.db.aiTask.findFirst({ where: access.where, select: taskSelect }));
      if (!latest || !isDeepStrictEqual(latest, task) || !isDeepStrictEqual(await readRuns(), runs)
        || !isDeepStrictEqual(await readSteps(), steps) || !isDeepStrictEqual(await readBudget(), budget)
        || !isDeepStrictEqual(await readActiveTime(), charges) || !isDeepStrictEqual(await readInvocations(), invocations)
        || !isDeepStrictEqual(await readDeliveryLogs(), deliveryLogs) || !isDeepStrictEqual(await readDenials(), denials)) {
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      const after = await this.actions.resolve(command.taskId, 'read_metadata'), now = this.clock();
      if (identity(before) !== identity(after)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (time(now) < time(task.createdAt) || time(task.updatedAt) > time(now)) throw unavailable();
      if (runs.some(run => run.startedAt && time(run.startedAt) > time(now) || run.endedAt && time(run.endedAt) > time(now))) throw unavailable();
      const startTimes = runs.slice(0, 50).flatMap(run => run.startedAt ? [time(run.startedAt)] : []);
      // Terminal task.updatedAt is not a completion clock: later metadata can
      // change it. Only a complete, matching final run supplies an end timestamp.
      const finalRun = runs.length <= 50 ? runs.at(-1) : undefined;
      const end = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)
        && finalRun?.status === task.status ? finalRun.endedAt : null;
      const result: AiTaskPerformanceObservationDraft = { version: 'task-performance-1', observedAt: now.toISOString(),
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
        measurements: { firstToken: 'not_recorded', firstCard: 'not_recorded',
          modelLatency: modelItems.length ? 'gateway_transport_wall_time_only' : 'not_recorded',
          toolLatency: [...activeTimes.values()].some(item => item.recordedMs !== null) ? 'resource_active_time_only' : 'not_recorded',
          rates: 'not_computed', slo: 'not_evaluated' },
        consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_dispatch_or_release' };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072) throw unavailable();
      return result;
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof BudgetError) throw new AiTaskRepositoryError(error.code === 'INVALID' ? 'AI_INVALID_INPUT'
        : error.code === 'FORBIDDEN' ? 'AI_ACCESS_DENIED' : error.code === 'PENDING_RECONCILIATION' ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
}
