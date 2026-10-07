import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import { PrismaTaskPlanPolicyRepository } from '../runner/prisma-task-plan-policy.repository';
import { PrismaTaskExecutionScopeAuthority } from '../runner/prisma-task-execution-scope.authority';
import { PrismaTaskRunEvidenceRepository } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskGatewayInvocationPreparation } from '../runner/prisma-task-gateway-invocation.preparation';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { GatewayTextIntentBinding } from '../gateway-intent';
import { TASK_TEXT_MODEL_TOOL } from './task-model-input';
import { TaskModelGatewayInputSource } from './task-model-gateway-input.source';

export function composePersistedTaskModelInput(input: PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  scene: { code: string; version: string };
  gatewayScene: GatewayTextIntentBinding;
  priceVersion: string;
  runtime: PublicGatewayRuntime;
}) {
  if (input.scene.code !== input.gatewayScene.sceneCode) throw new Error('Model scene binding mismatch');
  const clock = input.clock ?? (() => new Date());
  const authorization = composePersistedTaskAuthorization(input);
  const policy = new PrismaTaskPlanPolicyRepository(input.db, { ...input, tool: TASK_TEXT_MODEL_TOOL }, clock);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    TASK_TEXT_MODEL_TOOL, undefined, { sceneCode: input.gatewayScene.sceneCode, maxOutputTokens: input.gatewayScene.maxOutputTokens });
  const scopes = new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db);
  const plans = new PrismaTaskRunEvidenceRepository(input.db, scopes, source, clock);
  const registrations = new AiStepRegistrationRepository(input.db, source, clock);
  const inputs = new TaskModelGatewayInputSource(input.db, source, authorization.execution, input.runtime,
    input.gatewayScene, input.priceVersion, clock);
  const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, clock);
  const invocations = new PrismaTaskGatewayInvocationPreparation(bindings, inputs);
  return Object.freeze({ authorization, tasks: authorization.tasks, policy, planAuthority: source, plans, registrations,
    publish: inputs.publish.bind(inputs), invocations, executors: inputs.registeredExecutors(),
    toolCatalog: { resolve: async (code: string, version: string) => code === TASK_TEXT_MODEL_TOOL && version === AI_TOOL_DRAFT_VERSION
      ? { modelCall: true } : null } });
}
