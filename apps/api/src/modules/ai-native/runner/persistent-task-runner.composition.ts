import type { PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import type { AiTaskExecutionPolicySource } from '../task-execution-budget.ports';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import { createAiTaskRunnerRepositoryPorts, type AiTaskRunnerRepositoryAdapters } from './ai-task-runner.repository-adapter';
import { createPersistentAiTaskRunner } from './ai-task-runner.module';
import type { AiTaskRunnerClock, AiTaskRunnerOutcomePort } from './ai-task-runner.ports';
import { PrismaTaskExecutionScopeAuthority } from './prisma-task-execution-scope.authority';
import { PrismaTaskExecutionBudgetRepository } from './prisma-task-execution-budget.repository';
import { PrismaTaskRunEvidenceRepository, type AiTaskPlanEvidenceAuthority } from './prisma-task-run-evidence.repository';
import { PrismaTaskRunnerResourceSource, type AiTaskToolResourceCatalog } from './prisma-task-runner-resource.source';
import { PersistentTaskRunnerResourceGate } from './persistent-task-runner-resource-gate';
import { PrismaTaskMeasuredEffects, type AiTaskRegisteredExecutor } from './prisma-task-measured-effects';

export interface PersistentTaskRunnerComposition {
  db: PrismaClient;
  tasks: AiTaskRunnerRepositoryAdapters['tasks'] & Pick<AiTaskRepository, 'resolveAccess'>;
  registrations: AiTaskRunnerRepositoryAdapters['registrations'];
  replays: NonNullable<AiTaskRunnerRepositoryAdapters['replays']>;
  transitions: AiTaskRunnerRepositoryAdapters['transitions'];
  commands: AiTaskRunnerRepositoryAdapters['commands'];
  taskOutcome: AiTaskRunnerOutcomePort;
  policy: AiTaskExecutionPolicySource;
  planAuthority: AiTaskPlanEvidenceAuthority;
  toolCatalog: AiTaskToolResourceCatalog;
  executors: AiTaskRegisteredExecutor;
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
  requires(input?.taskOutcome, ['commit']); requires(input?.policy, ['resolve']);
  requires(input?.planAuthority, ['authorize']); requires(input?.toolCatalog, ['resolve']); requires(input?.executors, ['resolve']);
  const scopes = new PrismaTaskExecutionScopeAuthority(input.tasks, input.db);
  const evidence = new PrismaTaskRunEvidenceRepository(input.db, scopes, input.planAuthority, input.wall, input.monotonic);
  const accounting = new PrismaTaskExecutionBudgetRepository(input.db, scopes, input.policy, evidence, input.wall);
  const source = new PrismaTaskRunnerResourceSource(input.db, scopes, evidence, input.toolCatalog, input.wall);
  const resources = new PersistentTaskRunnerResourceGate(accounting, source);
  const effects = new PrismaTaskMeasuredEffects(input.db, input.tasks, evidence, input.executors);
  const ports = createAiTaskRunnerRepositoryPorts(input);
  const runner = createPersistentAiTaskRunner({ ...ports, plan: evidence, effects, resources, taskOutcome: input.taskOutcome, clock: input.clock });
  return { runner, evidence, accounting };
}
