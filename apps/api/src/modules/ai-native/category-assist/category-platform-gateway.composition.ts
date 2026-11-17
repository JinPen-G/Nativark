/** Platform category generation through the existing Gateway and one PLATFORM
 * budget. This composes the original router, Vault, capability receipts and
 * ledger; it neither seeds policy nor provides a tenant/workspace fallback. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SecretBox } from '../../../common/secret-box';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { PlatformTaskAuthorization } from '../platform-capability-probe/platform-probe.authorization';
import { AiScopeRepository } from '../ai-scope.repository';
import { gatewayPlatformBudgetPrincipal } from '../budget/gateway-budget-principal';
import { PlatformBudgetAuthorizationSource, PlatformPolicyEntitlementSource, PlatformGatewayCallPricing } from '../platform-capability-probe/platform-budget.authorization';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { createPersistedGatewayBudget } from '../budget/gateway-budget.composition';
import { createAuthorizedPlatformModelConfiguration } from '../platform-model-config.composition';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { ProviderRouterService } from '../provider-router.service';
import { createPersistedTextCapabilityEvidence } from '../prisma-text-capability-receipt.repository';
import { PrismaAdmissionRepository } from '../invocation-admission.repository';
import { InvocationAdmissionService } from '../invocation-admission.service';
import { InvocationDispatchService } from '../invocation-dispatch.service';
import { PrismaPlatformGatewayAudit } from '../prisma-platform-gateway-audit';
import { createNativeModelAdapters } from '../native-model-adapters';
import type { NativeModelProtocol } from '../native-model-protocols';
import type { ModelJsonTransport } from '../chat-completions.adapter';
import { RoutedModelTransport } from '../routed-model-transport';
import { ModelGatewayError, modelAdapterSupportsCapabilities, type GatewayContext } from '../model-gateway.ports';
import { gatewayRoutingBinding, type GatewayRoutingResolution } from '../gateway-routing.service';
import type { AiProfileCapability } from '../provider-profile.ports';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { GatewayCapacityPort } from '../gateway-capacity.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { modelEgressEvidence } from '../model-egress.transport';

export const CATEGORY_PROPOSAL_SCENE = 'platform.category.propose';
export const CATEGORY_PROPOSAL_OUTPUT = Object.freeze({ name: 'rental_category_candidate', schema: {
  type: 'object', properties: { version: { type: 'string', const: 'category-proposal-1', maxLength: 32 },
    candidateJson: { type: 'string', minLength: 2, maxLength: 16000 } },
  required: ['version', 'candidateJson'], additionalProperties: false
} });
export const CATEGORY_PROPOSAL_SCHEMA_HASH = requestFingerprint({ version: 'rental-response-schema-1',
  name: CATEGORY_PROPOSAL_OUTPUT.name, schema: CATEGORY_PROPOSAL_OUTPUT.schema, strict: true });
const platformContext = z.object({ actorId: z.string().min(1).max(191) }).strict();
const stable = ({ requestId: _request, authorizedAt: _time, ...context }: GatewayRoutingResolution['context']) => requestFingerprint(context);

export function composeCategoryPlatformGateway(input: {
  db: PrismaClient; guard: Pick<ApiAuthGuard, 'canActivate'>; secrets: SecretBox;
  credentials: AiOrderRouteCredentialSource; authorization: PlatformTaskAuthorization;
  taskId: string; platformProfileId: string; priceVersion: string;
  protocols: NativeModelProtocol | readonly NativeModelProtocol[]; protocol?: ModelJsonTransport;
  capacity?: GatewayCapacityPort; clock?: () => Date; assertPublished(): Promise<void>;
}) {
  const clock = input.clock ?? (() => new Date());
  const executionScopes = new AiScopeRepository(input.db, { resolve: () => input.authorization.execution.authorize(input.taskId) }, clock);
  const readScopes = new AiScopeRepository(input.db, { resolve: () => input.authorization.authority.resolve(input.taskId, 'read_step_terminal') }, clock);
  const profiles = new PrismaProviderProfileRepository(input.db), capabilities = createPersistedTextCapabilityEvidence(input.db, clock);
  const router = new ProviderRouterService({ profiles, capabilities });
  const bindings = new PrismaGatewayInvocationBindings(input.db, readScopes, clock);
  const authorization = new PlatformBudgetAuthorizationSource({ db: input.db, scopes: readScopes, clock }, bindings, CATEGORY_PROPOSAL_SCENE);
  const accounting = createPersistedGatewayBudget({ db: input.db, scopes: readScopes,
    subscriptions: { readCategoryCommercialContext: async () => { throw new ModelGatewayError('FORBIDDEN'); } },
    authorization, entitlements: new PlatformPolicyEntitlementSource(input.db, CATEGORY_PROPOSAL_SCENE, clock, 'ai.native.platform.category'),
    entitlementFeatureCode: 'ai.native.platform.category', pricing: new PlatformGatewayCallPricing(input.db, readScopes, input.priceVersion, clock), clock });
  const adapters = createNativeModelAdapters(input.protocols, { structuredOutput: CATEGORY_PROPOSAL_OUTPUT }, input.protocol);
  const required = ['text', 'tools', 'structured_output'] as const;
  const current = async (caller: GatewayContext, requested: readonly AiProfileCapability[]): Promise<GatewayRoutingResolution> => {
    const parsed = platformContext.safeParse(caller);
    if (!parsed.success || requested.some(value => !required.includes(value as typeof required[number]))
      || !requested.includes('text') || !requested.includes('structured_output')) throw new ModelGatewayError('FORBIDDEN');
    await input.assertPublished();
    const scope = await executionScopes.resolveRoutingScopes('platform_managed');
    const principal = gatewayPlatformBudgetPrincipal(scope.context);
    if (principal.actorId !== parsed.data.actorId || scope.consumerScope.kind !== 'PLATFORM'
      || scope.configurationScope.kind !== 'PLATFORM' || scope.consumerScope.id !== scope.configurationScope.id) throw new ModelGatewayError('FORBIDDEN');
    const route = await router.resolve({ consumerScope: scope.consumerScope, configurationScope: scope.configurationScope,
      mode: 'platform_managed', scene: 'builder', requiredCapabilities: required });
    if (route.profile.id !== input.platformProfileId || !modelAdapterSupportsCapabilities(adapters.find(a => a.provider === route.profile.protocol), ['text', 'structured_output']))
      throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const after = await executionScopes.resolveCurrent();
    await input.assertPublished();
    if (after.scope.id !== scope.consumerScope.id || stable(after.context) !== stable(scope.context)) throw new ModelGatewayError('FORBIDDEN');
    return { context: after.context, consumerScope: scope.consumerScope, route,
      selection: { mode: 'platform_managed', revision: route.profile.configRevision }, scene: 'builder', requiredCapabilities: [...requested] };
  };
  const routing = { resolve: current, async assertCurrent(caller: GatewayContext, original: GatewayRoutingResolution) {
    if (gatewayRoutingBinding(await current(caller, original.requiredCapabilities)) !== gatewayRoutingBinding(original)) throw new ModelGatewayError('CONFIG_INVALID');
  } };
  const platform = createAuthorizedPlatformModelConfiguration({ db: input.db, guard: input.guard, credentials: input.credentials,
    invocation: { resolve: () => input.authorization.execution.authorize(input.taskId) }, profileId: input.platformProfileId, secrets: input.secrets }).invocation;
  const checkConnection = async (context: GatewayContext) => {
    const identity = platformContext.safeParse(context);
    if (!identity.success || gatewayPlatformBudgetPrincipal(await input.authorization.execution.authorize(input.taskId)).actorId !== identity.data.actorId)
      throw new ModelGatewayError('FORBIDDEN');
    await input.assertPublished();
  };
  const boundPlatform = { async resolve(...args: Parameters<typeof platform.resolve>) {
    await checkConnection(args[0]); const result = await platform.resolve(...args); await checkConnection(args[0]); return result;
  }, async assertCurrent(...args: Parameters<typeof platform.assertCurrent>) {
    await checkConnection(args[0]); await platform.assertCurrent(...args); await checkConnection(args[0]);
  } };
  const transport = new RoutedModelTransport({ platform: boundPlatform,
    tenant: { resolve: async () => { throw new ModelGatewayError('FORBIDDEN'); } } }, adapters);
  const audit = new PrismaPlatformGatewayAudit(input.db, readScopes, accounting.facts, input.taskId, clock);
  const admissions = new PrismaAdmissionRepository(input.db);
  const runtime: PublicGatewayRuntime = { evidence: input.protocol ? modelEgressEvidence(input.protocol) : 'live', ports: { routing,
    admission: new InvocationAdmissionService(admissions, clock), dispatch: new InvocationDispatchService(admissions),
    budget: accounting.budget, audit, transport, ...(input.capacity ? { capacity: input.capacity } : {}) },
    async verifyEvidence(resolution, mode) {
      const adapter = adapters.find(a => a.provider === resolution.route.profile.protocol);
      if (mode !== runtime.evidence || !adapter || !modelAdapterSupportsCapabilities(adapter, ['text', 'structured_output'])
        || adapter.structuredSchemaHash !== CATEGORY_PROPOSAL_SCHEMA_HASH) return false;
      await routing.assertCurrent({ actorId: gatewayPlatformBudgetPrincipal(resolution.context).actorId }, resolution);
      return (await capabilities.preflight(resolution.route.profile, required)).allowed;
    } };
  return Object.freeze({ runtime, financialEvidence: Object.freeze({ readDispatch: accounting.facts.readDispatch.bind(accounting.facts) }),
    accounting: accounting.recovery });
}
