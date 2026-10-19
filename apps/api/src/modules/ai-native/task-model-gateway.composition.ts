import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { SecretBox } from '../../common/secret-box';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { AiScopeRepository } from './ai-scope.repository';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } from './tenant-model-config.composition';
import { createAuthorizedPlatformModelConfiguration } from './platform-model-config.composition';
import { PrismaTaskBudgetAuthorizationSource } from './budget/prisma-task-budget-authorization.source';
import { PrismaGatewayCallPricing } from './budget/prisma-gateway-call-pricing';
import { PrismaGatewayRecordedPricing } from './budget/prisma-gateway-recorded-pricing';
import { gatewayPricingSelectionSchema, type GatewayPricingSelection } from './budget/gateway-pricing-evidence';
import { createPersistedGatewayBudget } from './budget/gateway-budget.composition';
import { createPersistedTextCapabilityEvidence } from './prisma-text-capability-receipt.repository';
import { PrismaProviderProfileRepository } from './provider-profile.repository';
import { ProviderRouterService } from './provider-router.service';
import { AiGatewayRoutingService } from './gateway-routing.service';
import { PrismaAdmissionRepository } from './invocation-admission.repository';
import { InvocationAdmissionService } from './invocation-admission.service';
import { InvocationDispatchService } from './invocation-dispatch.service';
import { RoutedModelTransport } from './routed-model-transport';
import { gatewayBudgetPrincipal } from './budget/gateway-budget-principal';
import { ModelGatewayError, modelAdapterSupportsCapabilities, type ModelAdapter } from './model-gateway.ports';
import type { PublicGatewayRuntime } from './public-ai-gateway.service';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import type { AiRouteScene } from './provider-router.ports';
import { composeTaskModelHost, type TaskModelHostDependencies } from './runner/model-task-host.composition';
import type { GatewayMediaAttachmentResolver } from './gateway-intent';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { PrismaTaskGatewayAudit } from './prisma-task-gateway-audit';
import { PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import { BudgetError } from './budget/budget.ports';
import { ChatCompletionsAdapter } from './chat-completions.adapter';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';

export type PersistedTaskCallGatewayDependencies = PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  secrets: SecretBox;
  /** Server-owned original task and platform profile, never request switches. */
  taskId: string;
  platformProfileId: string;
  routeScene: AiRouteScene;
  callPriceVersion: string;
  adapters?: readonly ModelAdapter[];
  /** Explicit server selection of the existing bounded transport, instead of
   * injected adapters. Neither omission nor an empty array enables transport.
   * This is protocol support only, never a live provider/capability grant. */
  nativeProtocol?: 'openai_chat_completions';
  /** Optional explicit audit sink. Otherwise use the existing durable OperationLog. */
  audit?: UnifiedGatewayAudit;
  /** Server-created original attachment ACL/ObjectReader adapter, not request
   * bytes/URL or a capability grant. Absent means media remains unavailable. */
  media?: GatewayMediaAttachmentResolver;
};

export type PersistedTaskGatewayPricing = GatewayPricingSelection;
export type PersistedTaskGatewayDependencies = Omit<PersistedTaskCallGatewayDependencies, 'callPriceVersion'> & {
  /** Server policy only. Recorded mode reads the invocation's persisted price
   * and certified input bound; it never falls back to calls or guesses a rate. */
  pricing: PersistedTaskGatewayPricing;
};

function checkedPricing(value: unknown) {
  const parsed = gatewayPricingSelectionSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  return Object.freeze(parsed.data);
}
function taskPricing(db: PersistedTaskAuthorizationDependencies['db'], scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
  selection: PersistedTaskGatewayPricing, clock: () => Date) {
  return selection.kind === 'recorded' ? new PrismaGatewayRecordedPricing(db, scopes, clock)
    : new PrismaGatewayCallPricing(db, scopes, selection.priceVersion, clock);
}

/** Original-task accounting recovery is deliberately independent of model
 * configuration, adapters, credentials and the RUNNING-only execution gate.
 * It still requires current task read/reconcile action authority, entitlement
 * and persisted invocation/dispatch/usage evidence. No new model call exists
 * on this surface, including after a worker restart or AI configuration stop. */
export function composePersistedTaskCallAccountingRecovery(input: PersistedTaskAuthorizationDependencies &
  Pick<PersistedTaskCallGatewayDependencies, 'guard' | 'taskId' | 'callPriceVersion'>) {
  if (!input || 'pricing' in input) throw new ModelGatewayError('CONFIG_INVALID');
  const { callPriceVersion, ...dependencies } = input;
  return composePersistedTaskAccountingRecovery({ ...dependencies, pricing: { kind: 'calls', priceVersion: callPriceVersion } });
}

/** Original dispatch evidence only. No pricing/configuration/transport is
 * constructed, and this port cannot read usage, settle or create a reservation.
 * Current same-owner task read authority remains mandatory on both sides. */
export function composePersistedTaskDispatchEvidence(input: PersistedTaskAuthorizationDependencies) {
  const clock = input.clock ?? (() => new Date()), authorization = composePersistedTaskAuthorization(input);
  const scopes = authorization.scopes, bindings = new PrismaGatewayInvocationBindings(input.db, scopes, clock);
  const facts = new PrismaGatewayAccountingFacts(input.db, bindings, scopes,
    { quantity: async () => { throw new BudgetError('UNAVAILABLE'); } }, clock);
  return Object.freeze({ readDispatch: async (reservationId: string) => {
    const current = async () => {
      const scope = await scopes.resolveCurrent(), principal = gatewayBudgetPrincipal(scope.context);
      const row = await input.db.aiBudgetReservation.findUnique({ where: { id: reservationId },
        select: { scopeId: true, scopeKind: true, actorId: true, callId: true } });
      if (!row || row.scopeId !== scope.scope.id || row.scopeKind !== 'WORKSPACE' || row.actorId !== principal.actorId)
        throw new ModelGatewayError('FORBIDDEN');
      const invocation = await input.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: row.scopeId, callId: row.callId } },
        select: { id: true, scopeId: true, taskId: true, actorId: true, registrationHash: true } });
      if (!invocation || invocation.scopeId !== row.scopeId || invocation.actorId !== principal.actorId) throw new ModelGatewayError('FORBIDDEN');
      const context = await authorization.authority.resolve(invocation.taskId, 'read_step_terminal');
      const { requestId: _id, authorizedAt: _at, ...identity } = context;
      return requestFingerprint({ identity, invocation, reservationId });
    };
    const before = await current(), evidence = await facts.readDispatch(reservationId);
    if (await current() !== before) throw new ModelGatewayError('FORBIDDEN');
    return evidence;
  } });
}

/** Original recorded pricing is read by the accounting adapter, even after
 * that price expires or a new configuration is published. This composition
 * requires no model adapter, profile selection, secret or settings-write grant. */
export function composePersistedTaskAccountingRecovery(input: PersistedTaskAuthorizationDependencies &
  Pick<PersistedTaskCallGatewayDependencies, 'guard' | 'taskId'> & { pricing: PersistedTaskGatewayPricing }) {
  if (!input || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(input.taskId)
    || 'callPriceVersion' in input || typeof input.guard?.canActivate !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const selection = checkedPricing(input.pricing);
  const clock = input.clock ?? (() => new Date());
  const authorization = new PrismaTaskBudgetAuthorizationSource(input);
  const pricing = taskPricing(input.db, authorization.scopes, selection, clock);
  return createPersistedGatewayBudget({ db: input.db, scopes: authorization.scopes,
    subscriptions: input.subscriptions, authorization, pricing, clock }).recovery;
}

/** Inert server composition for workspace operator/staff tasks. Real current
 * task policy, encrypted configuration, persisted capability proof, dispatch
 * ownership and one financial ledger are reused, not injectable success gates.
 * Calls pricing is an invocation counter, NOT provider monetary/token pricing.
 * Missing policies/evidence/connections still reject at their original gates.
 * No root registration, timer, model call or credential read on construction.
 */
export function composePersistedTaskCallGateway(input: PersistedTaskCallGatewayDependencies) {
  if (!input || 'pricing' in input) throw new ModelGatewayError('CONFIG_INVALID');
  const { callPriceVersion, ...dependencies } = input;
  return composePersistedTaskGateway({ ...dependencies, pricing: { kind: 'calls', priceVersion: callPriceVersion } });
}

/** Same Gateway, dispatch owner and ledger for calls or trusted recorded
 * token/money pricing. Evidence publication stays with the original authorized
 * pricing producer; this does not publish prices or certify token counts. */
export function composePersistedTaskGateway(input: PersistedTaskGatewayDependencies) {
  if (!input || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(input.taskId)
    || !['chat', 'builder', 'vision', 'knowledge', 'reasoning'].includes(input.routeScene)
    || 'callPriceVersion' in input
    || input.nativeProtocol !== undefined && input.nativeProtocol !== 'openai_chat_completions'
    || input.nativeProtocol !== undefined && input.adapters !== undefined
    || input.nativeProtocol === undefined && (!Array.isArray(input.adapters) || !input.adapters.length)
    || input.audit !== undefined && typeof input.audit?.append !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const selection = checkedPricing(input.pricing);
  // Recorded evidence currently attests plain-text input/output tokens only.
  // Never price image/audio traffic with an unrelated text/calls upper bound.
  if (selection.kind === 'recorded' && (input.media || input.routeScene === 'vision')) throw new ModelGatewayError('CONFIG_INVALID');
  const { db, auth, credentials, subscriptions, guard, secrets, taskId, platformProfileId,
    routeScene, audit } = input;
  const clock = input.clock ?? (() => new Date());
  const adapters = input.nativeProtocol === 'openai_chat_completions'
    ? [new ChatCompletionsAdapter(createNativeModelEgressTransport(), {
      orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION },
      ...(input.media ? { mediaInput: ['image', 'audio'] as const } : {})
    })] : [...input.adapters!];
  const dependencies = { db, auth, credentials, subscriptions, clock };
  const authorization = composePersistedTaskAuthorization(dependencies);
  const invocation = { resolve: () => authorization.execution.authorize(taskId) };
  const scopes = new AiScopeRepository(db, invocation, clock);
  let media: GatewayMediaAttachmentResolver | undefined;
  if (input.media) {
    if (routeScene !== 'vision' || typeof input.media.resolve !== 'function'
      || typeof input.media.assertCurrent !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    const resolve = input.media.resolve.bind(input.media), assertCurrent = input.media.assertCurrent.bind(input.media);
    const currentMediaIdentity = async (context: Parameters<GatewayMediaAttachmentResolver['resolve']>[0]) => {
      const current = await scopes.resolveCurrent(), principal = gatewayBudgetPrincipal(current.context);
      if (principal.tenantId !== context.tenantId || principal.workspaceId !== context.workspaceId
        || principal.actorId !== context.actorId) throw new ModelGatewayError('FORBIDDEN');
      const { authorizedAt: _at, requestId: _id, ...identity } = current.context;
      return requestFingerprint(identity);
    };
    media = Object.freeze<GatewayMediaAttachmentResolver>({ resolve: async (context, reference, signal) => {
      context = structuredClone(context); reference = structuredClone(reference);
      const before = await currentMediaIdentity(context);
      const result = await resolve(context, reference, signal);
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (await currentMediaIdentity(context) !== before) throw new ModelGatewayError('FORBIDDEN');
      return result;
    }, assertCurrent: async (context, references, signal) => {
      context = structuredClone(context); references = structuredClone(references);
      const before = await currentMediaIdentity(context);
      await assertCurrent(context, references, signal);
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (await currentMediaIdentity(context) !== before) throw new ModelGatewayError('FORBIDDEN');
    } });
  }
  const configAuthority = new TenantModelConfigurationAuthority(guard, credentials, invocation);
  const configuration = createPersistedTenantModelConfiguration({ db, secrets,
    authorize: configAuthority.authorize.bind(configAuthority) });
  const tenant = createScopeBoundTenantModelConnection(configuration, scopes);
  const platform = createAuthorizedPlatformModelConfiguration({ db, guard, credentials,
    invocation, profileId: platformProfileId, secrets }).invocation;
  // Terminal accounting must remain readable: its authority is current identity
  // plus original invocation/action binding, not the new-effect RUNNING gate.
  const budgetAuthority = new PrismaTaskBudgetAuthorizationSource({ ...dependencies, guard, taskId });
  const pricing = taskPricing(db, budgetAuthority.scopes, selection, clock);
  const accounting = createPersistedGatewayBudget({ db, scopes: budgetAuthority.scopes,
    subscriptions, authorization: budgetAuthority, pricing, clock });
  const capabilities = createPersistedTextCapabilityEvidence(db, clock);
  const routing = new AiGatewayRoutingService(scopes, configuration,
    new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(db), capabilities }), routeScene);
  const admissions = new PrismaAdmissionRepository(db);
  const runtime: PublicGatewayRuntime = {
    evidence: 'live',
    ports: { routing, admission: new InvocationAdmissionService(admissions, clock),
      dispatch: new InvocationDispatchService(admissions), budget: accounting.budget,
      audit: audit ?? new PrismaTaskGatewayAudit(db, scopes, accounting.facts, taskId, clock),
      transport: new RoutedModelTransport({ platform, tenant }, adapters), ...(media ? { media } : {}) },
    verifyEvidence: async (resolution, mode) => {
      if (mode !== 'live' || resolution.scene !== routeScene) return false;
      // Remote evidence cannot make an absent local protocol feature work.
      // Refuse before publication/claim/reservation, not after marking dispatch.
      const adapter = adapters.find(value => value.provider === resolution.route.profile.protocol);
      if (!modelAdapterSupportsCapabilities(adapter, resolution.requiredCapabilities)) return false;
      const { actorKind: _, ...context } = gatewayBudgetPrincipal(resolution.context);
      await routing.assertCurrent(context, resolution);
      return (await capabilities.preflight(resolution.route.profile, resolution.requiredCapabilities)).allowed;
    }
  };
  // Keep the selected assembly intact; configuration/current authorization are
  // still re-read by the services, not frozen into a permanent grant.
  Object.freeze(runtime.ports);
  Object.freeze(runtime);
  return Object.freeze({ runtime, priceVersion: selection.priceVersion, accountingRecovery: accounting.recovery,
    financialEvidence: Object.freeze({ readDispatch: accounting.facts.readDispatch.bind(accounting.facts) }) });
}

/** Actual existing runner consumer. The task/model host cannot receive a second
 * runtime, price version or financial evidence source through this entrypoint.
 * Provider types stop at Gateway; runtime replacement keeps original evidence,
 * leases, input/plan and accounting semantics, never re-dispatches unknown work.
 */
export function composePersistedCallTaskModelHost(input:
  Omit<TaskModelHostDependencies, 'runtime' | 'priceVersion' | 'financialEvidence'> & {
    gateway: Omit<PersistedTaskCallGatewayDependencies,
      keyof PersistedTaskAuthorizationDependencies | 'guard' | 'taskId'>;
  }) {
  if (!input?.gateway || 'pricing' in input.gateway) throw new ModelGatewayError('CONFIG_INVALID');
  const { callPriceVersion, ...gateway } = input.gateway;
  return composePersistedTaskModelHost({ ...input, gateway: { ...gateway,
    pricing: { kind: 'calls', priceVersion: callPriceVersion } } });
}

export function composePersistedTaskModelHost(input:
  Omit<TaskModelHostDependencies, 'runtime' | 'priceVersion' | 'financialEvidence'> & {
    gateway: Omit<PersistedTaskGatewayDependencies,
      keyof PersistedTaskAuthorizationDependencies | 'guard' | 'taskId'>;
  }) {
  const { gateway, ...host } = input;
  // Protocol support alone is insufficient: media requires the explicit
  // original ACL/ObjectReader dependency and the server-selected vision route.
  if (!gateway || gateway.routeScene !== host.gatewayScene.routeScene
    || (host.kind && (!gateway.media || gateway.routeScene !== 'vision'))) {
    throw new ModelGatewayError('CONFIG_INVALID');
  }
  const runtime = composePersistedTaskGateway({ ...gateway, db: host.db, auth: host.auth,
    credentials: host.credentials, subscriptions: host.subscriptions, guard: host.guard,
    taskId: host.task.taskId, clock: host.clock });
  return composeTaskModelHost({ ...host, ...runtime });
}
