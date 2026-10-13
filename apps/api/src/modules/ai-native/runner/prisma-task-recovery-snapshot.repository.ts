import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import type { AiTaskRecoverySnapshot, AiTaskRecoverySnapshotSource } from './task-recovery-snapshot.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const inputSchema = z.object({ taskId: id, runId: id }).strict();
const revision = z.number().int().min(1).max(4294967295);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const effects = z.enum(['none', 'possible', 'committed']);
const resources = z.enum(['steps', 'calls', 'active_ms', 'output_bytes']);
const chargeStatuses = z.enum(['reserved', 'recorded', 'unknown']);
const uint64 = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n || value > 18446744073709551615n) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  return value.toString();
};
const fence = (value: Prisma.Decimal) => {
  const token = value.toFixed(0);
  if (!/^(0|[1-9][0-9]{0,19})$/u.test(token) || !value.equals(token)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  return token;
};
const ref = (value: string | null) => value === null ? null : id.parse(value);
const taskSelect = { id: true, scopeId: true, status: true, revision: true, contractVersion: true, eventCursor: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true,
  status: true, revision: true, fencingToken: true } satisfies Prisma.AiRunSelect;
const planSelect = { scopeId: true, taskId: true, runId: true, planHash: true, policyVersion: true } satisfies Prisma.AiTaskRunPlanSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true, actionId: true,
  requestFingerprint: true, toolCode: true, toolVersion: true, status: true, effect: true, inputRef: true, resultRef: true, errorCode: true } satisfies Prisma.AiStepSelect;
// Do not buffer or expose arbitrary tool payloads, prompts, provider settings or internal audit envelopes.
const artifactSelect = { scopeId: true, taskId: true, runId: true, stepId: true, id: true, actionId: true, stepFingerprint: true,
  fencingToken: true, outcome: true, contentHash: true, completeMeasurement: true, outputBytes: true, activeMs: true } satisfies Prisma.AiTaskResultArtifactSelect;
const chargeSelect = { scopeId: true, taskId: true, runId: true, stepId: true, actionId: true, stepFingerprint: true, chargeId: true,
  resource: true, status: true, amount: true, actualAmount: true, evidenceRef: true, gatewayInvocationId: true } satisfies Prisma.AiTaskExecutionChargeSelect;
const budgetSelect = { scopeId: true, taskId: true, revision: true, policyVersion: true, maxSteps: true, maxCalls: true, maxActiveMs: true, maxOutputBytes: true,
  reservedSteps: true, reservedCalls: true, reservedActiveMs: true, reservedOutputBytes: true,
  consumedSteps: true, consumedCalls: true, consumedActiveMs: true, consumedOutputBytes: true } satisfies Prisma.AiTaskExecutionBudgetSelect;
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge' | 'aiTaskExecutionBudget'>;

/** Current owner-authorized persisted fact projection. No held lease, claim,
 * effect, accounting write or reapproval. A stored COMMITTED step is not a
 * rollback promise; an artifact is not Core evidence or a dispatch permit.
 * Actual recovery still uses the original runner/evidence/transition ports.
 */
export class PrismaTaskRecoverySnapshotRepository implements AiTaskRecoverySnapshotSource {
  constructor(private readonly db: Db, private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>) {
    if (typeof db?.$transaction !== 'function' || typeof tasks?.resolveAccess !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }

  async read(value: unknown): Promise<AiTaskRecoverySnapshot> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data, initial = structuredClone(await this.tasks.resolveAccess(input.taskId, 'read_step_terminal'));
    let snapshot: AiTaskRecoverySnapshot;
    try {
      snapshot = await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.id !== input.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const key = { scopeId: task.scopeId, taskId: task.id, runId: input.runId };
        const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
          actorKind: initial.actorKind, actorId: initial.actorId }, select: runSelect });
        if (!run) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.id !== key.runId
          || run.actorKind !== initial.actorKind || run.actorId !== initial.actorId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const plan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key }, select: planSelect });
        const steps = await tx.aiStep.findMany({ where: key, select: stepSelect, orderBy: { sequence: 'asc' }, take: 1001 });
        const artifacts = await tx.aiTaskResultArtifact.findMany({ where: key, select: artifactSelect, orderBy: { id: 'asc' }, take: 2001 });
        const charges = await tx.aiTaskExecutionCharge.findMany({ where: key, select: chargeSelect, orderBy: { chargeId: 'asc' }, take: 4001 });
        const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: key.scopeId, taskId: key.taskId } }, select: budgetSelect });
        if (steps.length > 1000 || artifacts.length > 2000 || charges.length > 4000) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const scoped = (row: typeof key) => {
          if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        };
        if (plan) scoped(plan);
        for (const row of steps) scoped(row);
        for (const row of [...artifacts, ...charges]) {
          scoped(row);
          if (!steps.some(step => step.id === row.stepId && step.actionId === row.actionId && step.requestFingerprint === row.stepFingerprint)) {
            throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
          }
        }
        if (new Set(steps.map(s => s.id)).size !== steps.length || new Set(steps.map(s => s.sequence)).size !== steps.length
          || new Set(steps.map(s => s.actionId)).size !== steps.length) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const runFence = fence(run.fencingToken);
        const counters = (limit: bigint, reserved: bigint, consumed: bigint) => ({ limit: uint64(limit), reserved: uint64(reserved), consumed: uint64(consumed) });
        if (budget && (budget.scopeId !== key.scopeId || budget.taskId !== key.taskId)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return {
          task: { taskId: task.id, status: z.enum(AI_TASK_STATUSES_DRAFT).parse(task.status.toLowerCase()), revision: revision.parse(task.revision),
            cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null, eventCursor: uint64(task.eventCursor) },
          run: { runId: run.id, revision: revision.parse(run.revision), status: run.status.toLowerCase(), fencingToken: runFence },
          plan: plan ? { planHash: hash.parse(plan.planHash), policyVersion: id.parse(plan.policyVersion) } : null,
          steps: steps.map(step => ({ stepId: id.parse(step.id), sequence: revision.parse(step.sequence), revision: revision.parse(step.revision),
            actionId: id.parse(step.actionId), fingerprint: hash.parse(step.requestFingerprint), toolCode: id.parse(step.toolCode), toolVersion: id.parse(step.toolVersion),
            status: z.enum(AI_STEP_STATUSES_DRAFT).parse(step.status.toLowerCase()), effect: effects.parse(step.effect.toLowerCase()),
            inputRef: ref(step.inputRef), resultRef: ref(step.resultRef), errorCode: ref(step.errorCode),
            artifacts: artifacts.filter(row => row.stepId === step.id).map(row => {
              const token = fence(row.fencingToken);
              if (token === '0' || BigInt(token) > BigInt(runFence)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
              return { resultRef: id.parse(row.id), outcome: z.enum(AI_STEP_STATUSES_DRAFT).parse(row.outcome.toLowerCase()),
                completeMeasurement: z.boolean().parse(row.completeMeasurement), contentHash: hash.parse(row.contentHash),
                outputBytes: uint64(row.outputBytes), activeMs: uint64(row.activeMs), fencingToken: token };
            }),
            charges: charges.filter(row => row.stepId === step.id).map(row => ({ chargeId: id.parse(row.chargeId), resource: resources.parse(row.resource.toLowerCase()),
              status: chargeStatuses.parse(row.status.toLowerCase()), amount: uint64(row.amount), actualAmount: row.actualAmount === null ? null : uint64(row.actualAmount),
              evidenceRef: ref(row.evidenceRef), gatewayInvocationId: ref(row.gatewayInvocationId) })) })),
          resources: budget ? { revision: revision.parse(budget.revision), policyVersion: id.parse(budget.policyVersion), counters: {
            steps: counters(budget.maxSteps, budget.reservedSteps, budget.consumedSteps), calls: counters(budget.maxCalls, budget.reservedCalls, budget.consumedCalls),
            active_ms: counters(budget.maxActiveMs, budget.reservedActiveMs, budget.consumedActiveMs), output_bytes: counters(budget.maxOutputBytes, budget.reservedOutputBytes, budget.consumedOutputBytes)
          } } : null
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    // Buffered references/counters must not escape after logout or scope change.
    const current = await this.tasks.resolveAccess(input.taskId, 'read_step_terminal');
    if (current.bindingKey !== initial.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return snapshot;
  }
}
