/** Inert original AUTOMATION model bridge. The existing router, encrypted
 * connections, invocation/usage receipts and financial ledger are reused.
 * No subject/policy, task, budget setting or default capability is created. */
import type { PrismaClient } from '@prisma/client';
import type { SecretBox } from '../../../common/secret-box';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { AiScopeRepository } from '../ai-scope.repository';
import type { CurrentPersistentTaskAuthorization } from '../runner/authorized-persistent-task-input.composition';
import { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } from '../tenant-model-config.composition';
import { PrismaPlatformModelConnection } from '../platform-model-connection';
import { createPersistedGatewayBudget } from '../budget/gateway-budget.composition';
import { PrismaAutomationTaskBudgetAuthorizationSource } from '../budget/prisma-automation-task-budget-authorization.source';
import { PrismaGatewayCallPricing } from '../budget/prisma-gateway-call-pricing';
import { PrismaGatewayRecordedPricing } from '../budget/prisma-gateway-recorded-pricing';
import { gatewayPricingSelectionSchema, type GatewayPricingSelection } from '../budget/gateway-pricing-evidence';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import { AiGatewayRoutingService } from '../gateway-routing.service';
import { ProviderRouterService } from '../provider-router.service';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { createPersistedTextCapabilityEvidence } from '../prisma-text-capability-receipt.repository';
import { PrismaAdmissionRepository } from '../invocation-admission.repository';
import { InvocationAdmissionService } from '../invocation-admission.service';
import { InvocationDispatchService } from '../invocation-dispatch.service';
import { RoutedModelTransport } from '../routed-model-transport';
import { PrismaTaskGatewayAudit } from '../prisma-task-gateway-audit';
import { ModelGatewayError, modelAdapterSupportsCapabilities, type ModelAdapter, type GatewayContext } from '../model-gateway.ports';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { AutomationExplanationAuthority } from './automation-model-explanation.composition';
import { createOriginalAutomationDispatchReader } from './original-automation-dispatch.reader';

export function composeAutomationModelGateway(d: { db: PrismaClient; authorization: CurrentPersistentTaskAuthorization;
  taskId: string; subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>; secrets: SecretBox;
  pricing: GatewayPricingSelection; adapters: readonly ModelAdapter[]; clock?: () => Date;
  /** An explicit publication can pin the already registered platform profile. */
  platformProfileId?: string;
  /** Current-human original access; never reused to admit a new model call. */
  originalReads?: Pick<AutomationExplanationAuthority, 'original' | 'withOriginalRead'> }) {
  const selected = gatewayPricingSelectionSchema.safeParse(structuredClone(d?.pricing));
  if (!selected.success || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(d.taskId)
    || !Array.isArray(d.adapters) || !d.adapters.length || typeof d.authorization?.execution?.authorize !== 'function'
    || d.platformProfileId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(d.platformProfileId)) {
    throw new ModelGatewayError('CONFIG_INVALID');
  }
  if (d.originalReads && (d.originalReads.original.taskId !== d.taskId
    || typeof d.originalReads.withOriginalRead !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  const clock = d.clock ?? (() => new Date()), pricingChoice = Object.freeze(selected.data), adapters = [...d.adapters];
  const scopes = new AiScopeRepository(d.db, { resolve: () => d.authorization.execution.authorize(d.taskId) }, clock);
  const authorize = async (value: GatewayContext, action: 'read' | 'manage' | 'invoke') => {
    if (action !== 'invoke' || !('tenantId' in value && 'workspaceId' in value)) throw new ModelGatewayError('FORBIDDEN');
    const current = gatewayBudgetPrincipal(await d.authorization.execution.authorize(d.taskId));
    if (current.actorKind !== 'AUTOMATION' || current.actorId !== value.actorId
      || current.tenantId !== value.tenantId || current.workspaceId !== value.workspaceId) throw new ModelGatewayError('FORBIDDEN');
  };
  const configuration = createPersistedTenantModelConfiguration({ db: d.db, secrets: d.secrets, authorize });
  const tenant = createScopeBoundTenantModelConnection(configuration, scopes);
  const platform = new PrismaPlatformModelConnection(d.db, scopes, {
    manage: async () => { throw new ModelGatewayError('FORBIDDEN'); }, invoke: value => authorize(value, 'invoke') }, d.secrets);
  const budgetAuthority = new PrismaAutomationTaskBudgetAuthorizationSource(d.db, d.authorization, d.taskId, clock);
  const pricing = pricingChoice.kind === 'recorded' ? new PrismaGatewayRecordedPricing(d.db, budgetAuthority.scopes, clock, true)
    : new PrismaGatewayCallPricing(d.db, budgetAuthority.scopes, pricingChoice.priceVersion, clock);
  const accounting = createPersistedGatewayBudget({ db: d.db, scopes: budgetAuthority.scopes, subscriptions: d.subscriptions,
    authorization: budgetAuthority, pricing, clock });
  const capabilities = createPersistedTextCapabilityEvidence(d.db, clock);
  const routing = new AiGatewayRoutingService(scopes, configuration,
    new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(d.db), capabilities }), 'chat');
  const admission = new PrismaAdmissionRepository(d.db), audit = new PrismaTaskGatewayAudit(d.db, scopes, accounting.facts, d.taskId, clock);
  const runtime: PublicGatewayRuntime = { evidence: 'live',
    ports: { routing, admission: new InvocationAdmissionService(admission, clock), dispatch: new InvocationDispatchService(admission),
      budget: accounting.budget, audit, observation: audit, transport: new RoutedModelTransport({ platform, tenant }, adapters) },
    verifyEvidence: async (resolution, mode) => {
      if (mode !== 'live' || resolution.scene !== 'chat') return false;
      if (d.platformProfileId !== undefined && resolution.selection.mode === 'platform_managed'
        && resolution.route.profile.id !== d.platformProfileId) return false;
      const principal = gatewayBudgetPrincipal(resolution.context);
      if (principal.actorKind !== 'AUTOMATION') return false;
      const adapter = adapters.find(value => value.provider === resolution.route.profile.protocol);
      if (!modelAdapterSupportsCapabilities(adapter, resolution.requiredCapabilities)) return false;
      const { actorKind: _kind, ...context } = principal;
      await routing.assertCurrent(context, resolution);
      return (await capabilities.preflight(resolution.route.profile, resolution.requiredCapabilities)).allowed;
    } };
  Object.freeze(runtime.ports); Object.freeze(runtime);
  const financialEvidence = d.originalReads ? createOriginalAutomationDispatchReader(d.db, d.originalReads)
    : Object.freeze({ readDispatch: accounting.facts.readDispatch.bind(accounting.facts) });
  return Object.freeze({ runtime, priceVersion: pricingChoice.priceVersion, accountingRecovery: accounting.recovery,
    financialEvidence });
}
