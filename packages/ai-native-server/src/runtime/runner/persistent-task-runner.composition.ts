import type { PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import type { AiTaskExecutionPolicySource } from '../task-execution-budget.ports';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import { createAiTaskRunnerRepositoryPorts, type AiTaskRunnerRepositoryAdapters } from './ai-task-runner.repository-adapter';
import { createPersistentAiTaskRunner } from './ai-task-runner.module';
import type { AiTaskRunnerClock, AiTaskRunnerOutcomePort, AiTaskRunnerInputPort } from './ai-task-runner.ports';
import { PrismaTaskExecutionScopeAuthority } from './prisma-task-execution-scope.authority';
import { PrismaTaskExecutionBudgetRepository } from './prisma-task-execution-budget.repository';
import { PrismaTaskRunEvidenceRepository, type AiTaskPlanEvidenceAuthority, type AiTaskOrderPhaseBusinessEvidence, type AiConfirmationTool } from './prisma-task-run-evidence.repository';
import { PrismaTaskRunnerResourceSource, type AiTaskToolResourceCatalog, type AiTaskModelInvocationPreparation } from './prisma-task-runner-resource.source';
import { PersistentTaskRunnerResourceGate } from './persistent-task-runner-resource-gate';
import { PrismaTaskMeasuredEffects, type AiTaskRegisteredExecutor, type AiTaskExecutionAuthorization } from './prisma-task-measured-effects';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import type { AiTaskInputReader } from '../task-input/task-input.ports';
import { PersistedPlanResourcePolicySource } from './persisted-plan-resource-policy.source';
import { PrismaTaskRunPreparation } from './prisma-task-run-preparation';
import { PrismaTaskRunOverhead } from './prisma-task-run-overhead';
import type { AiTaskControlResourceOrigin } from './task-run-preparation.ports';

export interface PersistentTaskRunnerComposition {
  db: PrismaClient;
  tasks: AiTaskRunnerRepositoryAdapters['tasks'] & Pick<AiTaskRepository, 'resolveAccess'>;
  registrations: AiTaskRunnerRepositoryAdapters['registrations'];
  replays: NonNullable<AiTaskRunnerRepositoryAdapters['replays']>;
  transitions: AiTaskRunnerRepositoryAdapters['transitions'];
  commands: AiTaskRunnerRepositoryAdapters['commands'];
  confirmation?: AiTaskRunnerRepositoryAdapters['confirmation'];
  taskOutcome: AiTaskRunnerOutcomePort;
  executionAuthorization: AiTaskExecutionAuthorization;
  inputs?: AiTaskRunnerInputPort & AiTaskInputReader;
  /** Optional stricter server policy. Otherwise use the authorized durable plan;
   * absence of a saved plan/current plan authority still denies initialization. */
  policy?: AiTaskExecutionPolicySource;
  planAuthority: AiTaskPlanEvidenceAuthority;
  toolCatalog: AiTaskToolResourceCatalog;
  executors: AiTaskRegisteredExecutor;
  invocations?: AiTaskModelInvocationPreparation;
  /** Same persistent financial evidence source used by the single-ledger Gateway.
   * Required to meter model calls; its absence never enables a local fallback. */
  financialEvidence?: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  orderEvidence?: AiTaskOrderPhaseBusinessEvidence;
  confirmationTool?: AiConfirmationTool;
  controlResourceOrigin?: AiTaskControlResourceOrigin;
  wall?: () => Date;
  monotonic?: () => number;
  clock?: AiTaskRunnerClock;
}

/** Explicit, disabled-until-composed core. No background worker, AppModule or
 * provider dispatch is registered. Current authorization and versioned policy
 * are mandatory external dependencies, not assertions inferred from scope.
 * Task resources do not deduct money; model executors must use the single-ledger
 * Gateway. No legacy unmeasured effects or in-memory resource fallback here.
 */
export function composePersistentTaskRunner(input: PersistentTaskRunnerComposition) {
  const requires = (value: unknown, methods: string[]) => {
    if (!value || methods.some(method => typeof (value as Record<string, unknown>)[method] !== 'function')) {
      throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    }
  };
  requires(input?.db, ['$transaction']);
  requires(input?.tasks, ['resolveAccess', 'readMetadata', 'claimRun', 'claimRecoveryRun', 'releaseRun']);
  requires(input?.registrations, ['register']); requires(input?.replays, ['readReplay']);
  requires(input?.transitions, ['transition']); requires(input?.commands, ['register', 'transition']);
  requires(input?.taskOutcome, ['commit']); if (input.policy) requires(input.policy, ['resolve']);
  requires(input?.executionAuthorization, ['authorize']);
  if (input.inputs !== undefined) requires(input.inputs, ['afterSucceeded', 'readForStep']);
  requires(input?.planAuthority, ['authorize']); requires(input?.toolCatalog, ['resolve']); requires(input?.executors, ['resolve']);
  if (input.invocations) requires(input.financialEvidence, ['readDispatch']);
  const scopes = new PrismaTaskExecutionScopeAuthority(input.tasks, input.db);
  const evidence = new PrismaTaskRunEvidenceRepository(input.db, scopes, input.planAuthority, input.wall, input.monotonic, input.financialEvidence, input.orderEvidence, input.confirmationTool, input.controlResourceOrigin);
  const preparation = new PrismaTaskRunPreparation(input.db, evidence, input.planAuthority, input.wall, input.monotonic, input.controlResourceOrigin);
  const overhead = new PrismaTaskRunOverhead(input.db, evidence, input.wall, input.monotonic);
  evidence.bindToolActivityObserver((lease, chargeId, started, ended) => overhead.excludeToolActivity(lease, chargeId, started, ended));
  const policy = input.policy ?? new PersistedPlanResourcePolicySource(input.tasks, evidence, preparation);
  const measurements = { read: (request: import('../task-execution-budget.ports').AiTaskExecutionSettlementRequest, reconcile: boolean) =>
    request.evidenceRef.startsWith('overhead:') ? overhead.read(request, reconcile)
      : request.evidenceRef.startsWith('preparation:') ? preparation.read(request, reconcile) : evidence.read(request, reconcile) };
  const accounting = new PrismaTaskExecutionBudgetRepository(input.db, scopes, policy, measurements, input.wall);
  overhead.bindLedger(accounting);
  const source = new PrismaTaskRunnerResourceSource(input.db, scopes, evidence, input.toolCatalog, input.wall, input.invocations);
  const resources = new PersistentTaskRunnerResourceGate(accounting, source, preparation, overhead);
  const effects = new PrismaTaskMeasuredEffects(input.db, input.tasks, evidence, input.executors, input.executionAuthorization, input.inputs, input.wall);
  const ports = createAiTaskRunnerRepositoryPorts(input);
  const runner = createPersistentAiTaskRunner({ ...ports, plan: evidence, effects, resources, taskOutcome: input.taskOutcome, inputs: input.inputs, clock: input.clock });
  return { runner, evidence, accounting, preparation };
}
