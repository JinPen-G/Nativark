/** Persisted Task plans and Runner accounting shared with the original host.
 * The caller owns current authorization, measured effect evidence and the
 * Gateway. This factory does not register or execute a tool. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from './task-transactions';
import { AiTaskExecutionBudgetError, createPublicAiTaskResourceLedger, type AiTaskExecutionEvidenceSource,
  type AiTaskExecutionScopeSource } from './task-resource-ledger';
import { TaskRunPlanRepository, type AiTaskControlResourceOrigin, type TaskRunPlanAuthority } from './runtime/runner/task-run-plan.repository';
import { PrismaTaskRunPreparation } from './runtime/runner/prisma-task-run-preparation';
import { PrismaTaskRunOverhead } from './runtime/runner/prisma-task-run-overhead';
import { PersistedPlanResourcePolicySource } from './runtime/runner/persisted-plan-resource-policy.source';
import { PrismaTaskRunnerResourceSource, type AiTaskToolResourceCatalog,
  type AiTaskModelInvocationPreparation } from './runtime/runner/prisma-task-runner-resource.source';
import { PersistentTaskRunnerResourceGate } from './runtime/runner/persistent-task-runner-resource-gate';
import type { TaskPersistenceRepository } from './runtime/task-persistence.repository';

export { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from './runtime/runner/task-run-plan.repository';
export type { TaskRunPlanAuthority, AiTaskControlResourceOrigin, AiTaskToolResourceCatalog, AiTaskModelInvocationPreparation };

export function createPublicAiTaskRunnerResources(input: {
  db: PrismaClient;
  scopes: AiTaskExecutionScopeSource;
  tasks: Pick<TaskPersistenceRepository, 'readMetadata'>;
  transactions: AiTaskTransactionBoundary<Prisma.TransactionClient>;
  planAuthority: Required<TaskRunPlanAuthority>;
  toolCatalog: AiTaskToolResourceCatalog;
  invocations?: AiTaskModelInvocationPreparation;
  /** The measured effect adapter uses this same clock observer and reads
   * original artifacts and, for model steps, the single Gateway ledger. */
  bindEffectEvidence(observe: PrismaTaskRunOverhead['excludeToolActivity']): AiTaskExecutionEvidenceSource;
  controlResourceOrigin?: AiTaskControlResourceOrigin;
  wall?: () => Date;
  monotonic?: () => number;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.planAuthority?.authorizePreparation !== 'function'
    || typeof input.bindEffectEvidence !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  const { db, scopes, transactions, planAuthority, controlResourceOrigin, monotonic } = input;
  const wall = input.wall ?? (() => new Date());
  const plans = new TaskRunPlanRepository(db, scopes, planAuthority, wall, controlResourceOrigin, transactions, true);
  const preparation = new PrismaTaskRunPreparation(db, plans, planAuthority, wall, monotonic, controlResourceOrigin, true);
  const overhead = new PrismaTaskRunOverhead(db, plans, wall, monotonic, true);
  const effects = input.bindEffectEvidence(overhead.excludeToolActivity.bind(overhead));
  if (typeof effects?.read !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  const policies = new PersistedPlanResourcePolicySource(input.tasks, plans, preparation);
  const accounting = createPublicAiTaskResourceLedger({ db, scopes, policies, transactions, clock: wall, evidence: {
    read: (request, reconcile) => request.evidenceRef.startsWith('overhead:') ? overhead.read(request, reconcile)
      : request.evidenceRef.startsWith('preparation:') ? preparation.read(request, reconcile) : effects.read(request, reconcile)
  } });
  overhead.bindLedger(accounting);
  const source = new PrismaTaskRunnerResourceSource(db, scopes, plans, input.toolCatalog, wall, input.invocations, true);
  return Object.freeze({ plans, resources: new PersistentTaskRunnerResourceGate(accounting, source, preparation, overhead) });
}
