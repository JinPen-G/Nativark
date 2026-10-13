import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const inputSchema = z.object({ taskId: id, resultId: id }).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const terminal = z.enum(['succeeded', 'failed', 'unknown']);
const uint64 = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n || value > 18446744073709551615n) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  return value.toString();
};
const artifactSelect = {
  scopeId: true, taskId: true, id: true, runId: true, stepId: true, actionId: true,
  stepFingerprint: true, outcome: true, errorCode: true, payload: true, contentHash: true,
  outputBytes: true, activeMs: true, completeMeasurement: true, createdAt: true
} satisfies Prisma.AiTaskResultArtifactSelect;
const stepSelect = { id: true, runId: true, actionId: true, requestFingerprint: true, resultRef: true, status: true } satisfies Prisma.AiStepSelect;
const taskSelect = { id: true, scopeId: true, contractVersion: true } satisfies Prisma.AiTaskSelect;
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiTaskResultArtifact'> & Partial<Pick<PrismaClient, 'aiRun'>>;

export interface AiTaskResultProjection {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  resultId: string;
  runId: string;
  stepId: string;
  actionId: string;
  status: 'succeeded' | 'failed' | 'unknown';
  errorCode: string | null;
  /** Unknown or incomplete artifacts never expose a payload as a result. */
  payload: Prisma.JsonValue | null;
  contentHash: string;
  outputBytes: string;
  activeMs: string;
  completeMeasurement: boolean;
  observedAt: string;
}

/**
 * Owner-authorized result reader for `task.output_ready` references.
 *
 * This is deliberately a read port, not a worker or a provider adapter. The
 * event's resultId is only a lookup key; task, step, run, fingerprint and
 * terminal artifact state are re-bound inside one repeatable-read transaction.
 * Incomplete/unknown artifacts remain visible only as unknown metadata and do
 * not become a successful model result.
 */
export class AiTaskResultRepository {
  constructor(private readonly db: Db, private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskResultArtifact?.findFirst !== 'function'
      || typeof db?.aiStep?.findFirst !== 'function' || typeof tasks?.resolveAccess !== 'function') {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  /** Bounded original-run recovery observation. Only individually proven
   * terminal artifacts are returned; unknown/running steps expose no payload.
   * Coverage describes registered steps, not unpublished plans or business
   * completion. No execution claim, policy creation or provider invocation. */
  async readRunResults(value: unknown) {
    const parsed = z.object({ taskId: id, runId: id, limit: z.number().int().min(1).max(50).default(20) }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (!this.db.aiRun?.findFirst || !this.db.aiStep.findMany) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const command = parsed.data;
    const before = structuredClone(await this.tasks.resolveAccess(command.taskId, 'read_step_terminal'));
    const snapshot = async () => this.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: before.where, select: { ...taskSelect, status: true, revision: true } });
      if (!task || task.id !== command.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const run = await tx.aiRun.findFirst({ where: { id: command.runId, taskId: task.id, scopeId: task.scopeId,
        actorKind: before.actorKind, actorId: before.actorId }, select: { id: true, scopeId: true, taskId: true,
          actorKind: true, actorId: true, status: true, revision: true } });
      if (!run || run.id !== command.runId || run.scopeId !== task.scopeId || run.taskId !== task.id
        || run.actorKind !== before.actorKind || run.actorId !== before.actorId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const steps = await tx.aiStep.findMany({ where: { taskId: task.id, scopeId: task.scopeId, runId: run.id },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }], take: command.limit + 1,
        select: { ...stepSelect, scopeId: true, taskId: true, sequence: true, revision: true, toolCode: true, toolVersion: true } });
      if (steps.length > command.limit + 1 || new Set(steps.map(step => step.id)).size !== steps.length
        || new Set(steps.map(step => step.sequence)).size !== steps.length || steps.some(step => step.runId !== run.id
          || step.scopeId !== task.scopeId || step.taskId !== task.id
          || !Number.isSafeInteger(step.sequence) || step.sequence < 1)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      return { task, run, steps };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    try {
      const initial = await snapshot();
      const items = [];
      for (const step of initial.steps.slice(0, command.limit)) {
        const result = step.resultRef && ['SUCCEEDED', 'FAILED'].includes(step.status)
          ? await this.read({ taskId: command.taskId, resultId: step.resultRef }) : null;
        if (result && (result.runId !== command.runId || result.stepId !== step.id || result.actionId !== step.actionId)) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        items.push({ stepId: step.id, sequence: step.sequence, revision: step.revision, toolCode: step.toolCode,
          toolVersion: step.toolVersion, stepStatus: step.status.toLowerCase(),
          observation: result && result.status !== 'unknown' ? 'terminal_result' as const : 'not_confirmed' as const,
          result });
      }
      if ((await this.tasks.resolveAccess(command.taskId, 'read_step_terminal')).bindingKey !== before.bindingKey) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      // Sequential reads are not a database-wide atomic snapshot. Reject a
      // changed run/step set instead of mixing generations into a response.
      if (requestFingerprint(initial) !== requestFingerprint(await snapshot())) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if ((await this.tasks.resolveAccess(command.taskId, 'read_step_terminal')).bindingKey !== before.bindingKey) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: command.taskId, runId: command.runId,
        taskStatus: initial.task.status.toLowerCase(), runStatus: initial.run.status.toLowerCase(),
        taskRevision: initial.task.revision, runRevision: initial.run.revision, items,
        coverage: initial.steps.length > command.limit ? 'bounded_registered_steps' as const : 'all_registered_steps' as const,
        hasMore: initial.steps.length > command.limit, execution: 'not_invoked' as const,
        semantics: 'step_results_not_aggregate_business_success' as const };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }

  async read(value: unknown): Promise<AiTaskResultProjection> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data;
    const initial = structuredClone(await this.tasks.resolveAccess(input.taskId, 'read_step_terminal'));
    let projection: AiTaskResultProjection;
    try {
      projection = await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task || task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: input.resultId }, select: artifactSelect });
        if (!artifact || artifact.scopeId !== task.scopeId || artifact.taskId !== task.id) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const step = await tx.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: artifact.stepId }, select: stepSelect });
        if (!step || step.runId !== artifact.runId || step.actionId !== artifact.actionId || step.requestFingerprint !== artifact.stepFingerprint
          || (step.resultRef !== null && step.resultRef !== artifact.id)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        if (!(artifact.createdAt instanceof Date) || !Number.isFinite(artifact.createdAt.getTime())
          || !hash.safeParse(artifact.contentHash).success || requestFingerprint(artifact.payload) !== artifact.contentHash
          || typeof artifact.completeMeasurement !== 'boolean') throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const status = artifact.outcome.toLowerCase();
        if (!terminal.safeParse(status).success && status !== 'running') throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        if (status === 'running' || status === 'unknown' || !artifact.completeMeasurement) {
          return {
            contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, resultId: artifact.id, runId: artifact.runId,
            stepId: artifact.stepId, actionId: artifact.actionId, status: 'unknown', errorCode: null, payload: null,
            contentHash: artifact.contentHash, outputBytes: uint64(artifact.outputBytes), activeMs: uint64(artifact.activeMs),
            completeMeasurement: false, observedAt: artifact.createdAt.toISOString()
          };
        }
        const parsedStatus = terminal.safeParse(status);
        if (!parsedStatus.success || step.status !== artifact.outcome || step.resultRef !== artifact.id)
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const encoded = JSON.stringify(artifact.payload);
        if (typeof encoded !== 'string' || BigInt(Buffer.byteLength(encoded, 'utf8')) !== artifact.outputBytes) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        return {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, resultId: artifact.id, runId: artifact.runId,
          stepId: artifact.stepId, actionId: artifact.actionId, status: parsedStatus.data, errorCode: artifact.errorCode,
          payload: structuredClone(artifact.payload), contentHash: artifact.contentHash, outputBytes: uint64(artifact.outputBytes),
          activeMs: uint64(artifact.activeMs), completeMeasurement: true, observedAt: artifact.createdAt.toISOString()
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const current = await this.tasks.resolveAccess(input.taskId, 'read_step_terminal');
    if (initial.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return projection;
  }
}
