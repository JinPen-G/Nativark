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

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionBudget'>;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ taskId: id, usageLimit: z.number().int().min(1).max(20), usageAfter: id.optional() }).strict();
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
    private readonly usage: Pick<TaskBudgetUsageReader, 'read'>, private readonly clock: () => Date = () => new Date()) {}

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
      const latest = structuredClone(await this.db.aiTask.findFirst({ where: access.where, select: taskSelect }));
      if (!latest || !isDeepStrictEqual(latest, task) || !isDeepStrictEqual(await readRuns(), runs)
        || !isDeepStrictEqual(await readSteps(), steps) || !isDeepStrictEqual(await readBudget(), budget)) {
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
        steps: { items: steps.slice(0, 200).map(step => ({ stepId: step.id, runId: step.runId, sequence: step.sequence,
          toolCode: step.toolCode, toolVersion: step.toolVersion, status: step.status.toLowerCase(), effect: step.effect.toLowerCase(),
          revision: step.revision })), truncated: steps.length > 200, coverage: 'bounded_window' }, financial,
        measurements: { firstToken: 'not_recorded', firstCard: 'not_recorded', toolLatency: 'not_recorded', rates: 'not_computed', slo: 'not_evaluated' },
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
