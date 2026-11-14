/** Standard original-scene counting host. Only explicit server configuration
 * enables counting/publication; history keeps its original current read policy.
 * Construction reads no credentials, seeds no budget and starts no transport. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { SecretBox } from '../../../common/secret-box';
import type { PrismaClient } from '@prisma/client';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { BudgetError } from '../budget/budget.ports';
import { GatewayPricingRequestFactory } from '../budget/gateway-pricing-request.composition';
import { InputCountingRequestFactory, type InputCountingRequestDependencies } from './input-counting-request.factory';
import { AiTaskRepository } from '../ai-task.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import { composePersistedOrderFactsTaskRunner } from '../runner/persisted-catalog-runner.composition';
import { PrismaModelStepEvidenceAuthority } from '../model-input/prisma-model-step-evidence.authority';
import { OriginalNativeToolResultSource } from '../model-input/original-native-tool-result.source';
import { PrismaNativeToolCallBindings } from '../model-input/prisma-native-tool-call-bindings';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { composePersistedTaskDispatchEvidence } from '../task-model-gateway.composition';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { createPersistedTenantModelConfiguration } from '../tenant-model-config.composition';
import { createPersistedTextCapabilityEvidence } from '../prisma-text-capability-receipt.repository';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { ProviderRouterService } from '../provider-router.service';
import { AiGatewayRoutingService } from '../gateway-routing.service';

export const AI_NATIVE_INPUT_COUNTING_CONFIGURATION = Symbol('AI_NATIVE_INPUT_COUNTING_CONFIGURATION');
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u);
const configurationSchema = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), sceneCode: z.enum(['order_explanation', 'opening_diagnosis', 'quote_clarification']),
    sceneMaxOutputTokens: z.number().int().min(1).max(32768), countingPriceVersion: identifier,
    platformProfileId: identifier.max(36), timeoutMs: z.number().int().min(1000).max(30000),
    nativeToolResults: z.boolean().default(false) }).strict()])
  .refine(value => !value.enabled || !value.nativeToolResults || value.sceneCode === 'order_explanation');
type Dependencies = Pick<InputCountingRequestDependencies, 'auth' | 'guard' | 'subscriptions' | 'clock' | 'nativeToolResultsForRequest' | 'capacity'> & {
  db: PrismaClient; secrets: SecretBox;
  core?: Pick<RentalCoreService, 'getOrder' | 'readOrderFacts'>;
};

/** Builds only original receipt/read adapters inside the current count request.
 * No model driver, task registration, new ledger or permissive resolver is made.
 * The existing Core Guard and original encrypted binding remain authoritative. */
function originalNativeFactory(input: Dependencies): NonNullable<InputCountingRequestDependencies['nativeToolResultsForRequest']> {
  if (!input.core || typeof input.core.getOrder !== 'function' || typeof input.core.readOrderFacts !== 'function')
    throw new BudgetError('UNAVAILABLE');
  const core = input.core;
  return request => {
    // The factory supplies identity-bound wrappers, deliberately distinct from
    // the singleton Guard/Auth. Reuse them in every original-receipt adapter.
    if (!Object.is(request.db, input.db) || typeof request.guard?.canActivate !== 'function'
      || typeof request.auth?.resolveAccessContext !== 'function') throw new BudgetError('FORBIDDEN');
    const taskId = request.reference.taskId, clock = request.clock;
    const dependencies = { db: input.db, auth: request.auth, credentials: request.credentials,
      subscriptions: input.subscriptions, clock };
    const tasks = new AiTaskRepository(input.db, request.taskAuthority, clock);
    const modelInputs = new PrismaTaskPlanInputSource(input.db, request.taskAuthority, request.execution,
      clock, TASK_TEXT_MODEL_TOOL, undefined, request.scenePolicy);
    const financial = composePersistedTaskDispatchEvidence(dependencies);
    const modelEvidence = new PrismaModelStepEvidenceAuthority(input.db, request.taskAuthority,
      modelInputs, request.scenePolicy, financial, clock);
    const order = composePersistedOrderFactsTaskRunner({ db: input.db, authorization: dependencies,
      guard: request.guard, core, wall: clock });
    const invocation = { resolve: () => request.execution.authorize(taskId) };
    const scopes = new AiScopeRepository(input.db, invocation, clock);
    const configAuthority = new TenantModelConfigurationAuthority(request.guard, request.credentials, invocation);
    const configuration = createPersistedTenantModelConfiguration({ db: input.db, secrets: input.secrets,
      authorize: configAuthority.authorize.bind(configAuthority) });
    const routing = new AiGatewayRoutingService(scopes, configuration,
      new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(input.db),
        capabilities: createPersistedTextCapabilityEvidence(input.db, clock) }), 'chat');
    const bindings = new PrismaNativeToolCallBindings(input.db,
      new AiScopeRepository(input.db, { resolve: () => request.taskAuthority.resolve(taskId, 'read_step_terminal') }, clock),
      input.secrets, taskId, clock);
    return new OriginalNativeToolResultSource({ db: input.db, tasks, execution: request.execution,
      modelEvidence, toolInputs: order.source, toolResults: order.results, reopenBusinessSource: order.reopenBusinessSource,
      bindings, routing, task: { taskId, runId: request.reference.runId,
        modelRegistrationRef: request.reference.modelRegistrationRef, orderRegistrationRef: request.reference.toolRegistrationRef },
      policy: request.scenePolicy });
  };
}

export function composeStandardInputCounting(input: Dependencies, value?: unknown): Pick<InputCountingRequestFactory, 'call'> {
  let configuration: z.infer<typeof configurationSchema>;
  try { configuration = configurationSchema.parse(structuredClone(value ?? { enabled: false })); }
  catch { throw new BudgetError('UNAVAILABLE'); }
  const { db, auth, guard, subscriptions, clock } = input;
  const reads = new InputCountingRequestFactory({ db, auth, guard, subscriptions, clock });
  const pricing = GatewayPricingRequestFactory.history({ db, auth, guard, subscriptions, clock });
  const nativeToolResultsForRequest = configuration.enabled && configuration.nativeToolResults
    ? input.nativeToolResultsForRequest ?? originalNativeFactory(input) : undefined;
  const writes = configuration.enabled ? new InputCountingRequestFactory({ db, auth, guard, subscriptions, clock,
    ...(input.capacity ? { capacity: input.capacity } : {}),
    ...(nativeToolResultsForRequest ? { nativeToolResultsForRequest } : {}),
    connectionConfiguration: { db, secrets: input.secrets, platformProfileId: configuration.platformProfileId },
    configuration: { sceneCode: configuration.sceneCode, sceneMaxOutputTokens: configuration.sceneMaxOutputTokens,
      countingPriceVersion: configuration.countingPriceVersion, timeoutMs: configuration.timeoutMs,
      nativeToolResults: configuration.nativeToolResults,
      // Match the standard original-scene native adapter registration exactly.
      toolPolicy: configuration.sceneCode === 'order_explanation'
        ? { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } } : {} }
  }) : undefined;
  return Object.freeze({ call: (request, action, command, signal) => {
    if (action === 'count' || action === 'publishInputBound') {
      if (!writes) return Promise.reject(new BudgetError('UNAVAILABLE'));
      return writes.call(request, action, command, signal);
    }
    if (action === 'readInputBound' || action === 'readPublication') return pricing.call(request, action, command, signal);
    return reads.call(request, action, command, signal);
  } });
}
