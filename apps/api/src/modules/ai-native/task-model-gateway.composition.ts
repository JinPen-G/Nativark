import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { SecretBox } from '../../common/secret-box';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from './task-authorization.composition';
import { AiScopeRepository } from './ai-scope.repository';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } from './tenant-model-config.composition';
import { createAuthorizedPlatformModelConfiguration } from './platform-model-config.composition';
import { PrismaTaskBudgetAuthorizationSource } from './budget/prisma-task-budget-authorization.source';
import { PrismaGatewayCallPricing } from './budget/prisma-gateway-call-pricing';
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
import { ModelGatewayError, type ModelAdapter } from './model-gateway.ports';
import type { PublicGatewayRuntime } from './public-ai-gateway.service';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import type { AiRouteScene } from './provider-router.ports';
import { composeTaskModelHost, type TaskModelHostDependencies } from './runner/model-task-host.composition';
import type { GatewayMediaAttachmentResolver } from './gateway-intent';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export type PersistedTaskCallGatewayDependencies = PersistedTaskAuthorizationDependencies & {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  secrets: SecretBox;
  /** Server-owned original task and platform profile, never request switches. */
  taskId: string;
  platformProfileId: string;
  routeScene: AiRouteScene;
  callPriceVersion: string;
  adapters: readonly ModelAdapter[];
  audit: UnifiedGatewayAudit;
  /** Server-created original attachment ACL/ObjectReader adapter, not request
   * bytes/URL or a capability grant. Absent means media remains unavailable. */
  media?: GatewayMediaAttachmentResolver;
};

/** Inert server composition for workspace operator/staff tasks. Real current
 * task policy, encrypted configuration, persisted capability proof, dispatch
 * ownership and one financial ledger are reused, not injectable success gates.
 * Calls pricing is an invocation counter, NOT provider monetary/token pricing.
 * Missing policies/evidence/connections still reject at their original gates.
 * No root registration, timer, model call or credential read on construction.
 */
export function composePersistedTaskCallGateway(input: PersistedTaskCallGatewayDependencies) {
  if (!input || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(input.taskId)
    || !['chat', 'builder', 'vision', 'knowledge', 'reasoning'].includes(input.routeScene)
    || !Array.isArray(input.adapters) || !input.adapters.length
    || typeof input.audit?.append !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const { db, auth, credentials, subscriptions, guard, secrets, taskId, platformProfileId,
    routeScene, callPriceVersion, audit } = input;
  const clock = input.clock ?? (() => new Date()), adapters = [...input.adapters];
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
  const pricing = new PrismaGatewayCallPricing(db, budgetAuthority.scopes, callPriceVersion, clock);
  const accounting = createPersistedGatewayBudget({ db, scopes: budgetAuthority.scopes,
    subscriptions, authorization: budgetAuthority, pricing, clock });
  const capabilities = createPersistedTextCapabilityEvidence(db, clock);
  const routing = new AiGatewayRoutingService(scopes, configuration,
    new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(db), capabilities }), routeScene);
  const admissions = new PrismaAdmissionRepository(db);
  const runtime: PublicGatewayRuntime = {
    evidence: 'live',
    ports: { routing, admission: new InvocationAdmissionService(admissions, clock),
      dispatch: new InvocationDispatchService(admissions), budget: accounting.budget, audit,
      transport: new RoutedModelTransport({ platform, tenant }, adapters), ...(media ? { media } : {}) },
    verifyEvidence: async (resolution, mode) => {
      if (mode !== 'live' || resolution.scene !== routeScene) return false;
      const { actorKind: _, ...context } = gatewayBudgetPrincipal(resolution.context);
      await routing.assertCurrent(context, resolution);
      return (await capabilities.preflight(resolution.route.profile, resolution.requiredCapabilities)).allowed;
    }
  };
  // Keep the selected assembly intact; configuration/current authorization are
  // still re-read by the services, not frozen into a permanent grant.
  Object.freeze(runtime.ports);
  Object.freeze(runtime);
  return Object.freeze({ runtime, priceVersion: callPriceVersion,
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
  const { gateway, ...host } = input;
  // Protocol support alone is insufficient: media requires the explicit
  // original ACL/ObjectReader dependency and the server-selected vision route.
  if (!gateway || gateway.routeScene !== host.gatewayScene.routeScene
    || (host.kind && (!gateway.media || gateway.routeScene !== 'vision'))) {
    throw new ModelGatewayError('CONFIG_INVALID');
  }
  const runtime = composePersistedTaskCallGateway({ ...gateway, db: host.db, auth: host.auth,
    credentials: host.credentials, subscriptions: host.subscriptions, guard: host.guard,
    taskId: host.task.taskId, clock: host.clock });
  return composeTaskModelHost({ ...host, ...runtime });
}
