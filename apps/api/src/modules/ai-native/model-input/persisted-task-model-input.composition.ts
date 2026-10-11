import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { PrismaTaskPlanInputSource, type PersistedTaskInputTool } from '../runner/prisma-task-plan-input.source';
import { PrismaTaskPlanPolicyRepository } from '../runner/prisma-task-plan-policy.repository';
import { PrismaTaskExecutionScopeAuthority } from '../runner/prisma-task-execution-scope.authority';
import { PrismaTaskRunEvidenceRepository } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskGatewayInvocationPreparation } from '../runner/prisma-task-gateway-invocation.preparation';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { GatewayTextIntentBinding } from '../gateway-intent';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, type TaskModelKind } from './task-model-input';
import { TaskModelGatewayInputSource } from './task-model-gateway-input.source';
import { PrismaModelStepEvidenceAuthority } from './prisma-model-step-evidence.authority';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import type { AiTaskRunnerRepositoryCommandFactory } from '../runner/ai-task-runner.repository-adapter';
import { AiTaskRepositoryError } from '../ai-task.repository';

export function composePersistedTaskModelInput(input: PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  scene: { code: string; version: string };
  gatewayScene: GatewayTextIntentBinding;
  priceVersion: string;
  runtime: PublicGatewayRuntime;
  /** Server-selected tool policy; never an Agent-controlled feature switch. */
  kind?: TaskModelKind;
  /** Explicit server scene assembly; policy management still requires its Guard and CAS. */
  planTools?: readonly PersistedTaskInputTool[];
}) {
  if (input.scene.code !== input.gatewayScene.sceneCode) throw new Error('Model scene binding mismatch');
  const clock = input.clock ?? (() => new Date());
  const tool = input.kind === 'image' ? TASK_IMAGE_MODEL_TOOL : input.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_TEXT_MODEL_TOOL;
  const modelPolicy = { sceneCode: input.gatewayScene.sceneCode, maxOutputTokens: input.gatewayScene.maxOutputTokens,
    ...(input.kind ? { kind: input.kind } : {}) };
  const authorization = composePersistedTaskAuthorization(input);
  const policy = new PrismaTaskPlanPolicyRepository(input.db, { ...input, tool, tools: input.planTools }, clock);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    tool, undefined, modelPolicy);
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db);
  const plans = new PrismaTaskRunEvidenceRepository(input.db, scopes, source, clock);
  const registrations = new AiStepRegistrationRepository(input.db, source, clock);
  const inputs = new TaskModelGatewayInputSource(input.db, source, authorization.execution, input.runtime,
    input.gatewayScene, input.priceVersion, clock, input.kind);
  const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, clock);
  const invocations = new PrismaTaskGatewayInvocationPreparation(bindings, inputs);
  const createTransitionAuthority = (financial: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>) =>
    new PrismaModelStepEvidenceAuthority(input.db, authorization.authority, source, modelPolicy, financial, clock);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      if (plan.toolCode !== tool || plan.toolVersion !== AI_TOOL_DRAFT_VERSION || plan.operation !== 'external_unknown') {
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      const task = await authorization.tasks.readMetadata(lease.taskId);
      return { taskId: lease.taskId, registrationRef: plan.registrationRef, expectedTaskRevision: task.revision,
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    },
    transition(kind, step, lease, resultRef) {
      if (kind === 'pause' || step.plan.toolCode !== tool || (kind !== 'start' && !resultRef)) {
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  return Object.freeze({ authorization, tasks: authorization.tasks, policy, planAuthority: source, plans, registrations,
    publish: inputs.publish.bind(inputs), invocations, executors: inputs.registeredExecutors(), commands, createTransitionAuthority,
    toolCatalog: { resolve: async (code: string, version: string) => code === tool && version === AI_TOOL_DRAFT_VERSION
      ? { modelCall: true } : null } });
}
