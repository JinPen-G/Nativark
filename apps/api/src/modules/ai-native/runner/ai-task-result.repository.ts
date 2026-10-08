import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_STEP_STATUSES_DRAFT } from '@rental-os/shared';
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
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiTaskResultArtifact'>;

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
        if (status === 'running' || !artifact.completeMeasurement) {
          return {
            contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, resultId: artifact.id, runId: artifact.runId,
            stepId: artifact.stepId, actionId: artifact.actionId, status: 'unknown', errorCode: null, payload: null,
            contentHash: artifact.contentHash, outputBytes: uint64(artifact.outputBytes), activeMs: uint64(artifact.activeMs),
            completeMeasurement: false, observedAt: artifact.createdAt.toISOString()
          };
        }
        const parsedStatus = terminal.safeParse(status);
        if (!parsedStatus.success || step.status !== artifact.outcome) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
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
