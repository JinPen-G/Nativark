import type { SecretBox } from '../../../common/secret-box';
import type { PrismaClient } from '@prisma/client';
import { AiScopeRepository } from '../ai-scope.repository';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import { ModelGatewayError } from '../model-gateway.ports';
import { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } from '../tenant-model-config.composition';
import { composeClientMaterialTasks } from './client-task.composition';
import { composePersistedClientTaskAuthorization } from './client-task-execution.composition';
import { clientTaskCommandSchema } from './prisma-client-task-input.repository';
import type { AiAuthorizedClientMaterial, AiClientTaskDependencies } from './client-task.authority';
import { AiGatewayRoutingService } from '../gateway-routing.service';
import { ProviderRouterService } from '../provider-router.service';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { createPersistedTextCapabilityEvidence } from '../prisma-text-capability-receipt.repository';
import { PrismaAdmissionRepository } from '../invocation-admission.repository';
import { InvocationAdmissionService } from '../invocation-admission.service';
import { InvocationDispatchService } from '../invocation-dispatch.service';
import { PrismaClientTaskBudgetAuthorizationSource } from '../budget/prisma-client-task-budget-authorization.source';
import { PrismaGatewayCallPricing } from '../budget/prisma-gateway-call-pricing';
import { createPersistedGatewayBudget } from '../budget/gateway-budget.composition';
import { RoutedModelTransport, type GatewayConnectionResolver } from '../routed-model-transport';
import type { ModelAdapter } from '../model-gateway.ports';
import type { PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { UnifiedGatewayAudit } from '../unified-ai-gateway.ports';
import type { AiRouteScene } from '../provider-router.ports';
import { PrismaPlatformModelConnection } from '../platform-model-connection';

export type ClientCallGatewayDependencies = {
  db: PrismaClient;
  routeScene: AiRouteScene;
  /** Explicit server version for a call-count policy, not a provider money rate. */
  callPriceVersion: string;
  adapters: readonly ModelAdapter[];
  platformConnection: GatewayConnectionResolver;
  audit: UnifiedGatewayAudit;
};
/** Formal platform Vault producer; no caller-provided connection or grant. */
export type ClientPersistedCallGatewayDependencies = Omit<ClientCallGatewayDependencies, 'platformConnection'>;

/** Original customer request accounting only. No operator credentials, model
 * configuration or new dispatch dependency is required to observe old usage.
 * The original material loader and client policy are rechecked on every call. */
export function composeClientTaskCallAccountingRecovery(input: AiClientTaskDependencies & {
  db: PrismaClient;
  loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>;
  callPriceVersion: string;
  clock?: () => Date;
}, value: unknown) {
  const command = structuredClone(clientTaskCommandSchema.parse(structuredClone(value)));
  if (typeof input?.loadMaterial !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const clock = input.clock ?? (() => new Date());
  const authorization = new PrismaClientTaskBudgetAuthorizationSource({ db: input.db,
    subscriptions: input.subscriptions, sceneCode: input.sceneCode, sceneVersion: input.sceneVersion,
    loadMaterial: input.loadMaterial, command, clock });
  const pricing = new PrismaGatewayCallPricing(input.db, authorization.scopes, input.callPriceVersion, clock);
  return createPersistedGatewayBudget({ db: input.db, scopes: authorization.scopes,
    subscriptions: input.subscriptions, authorization, pricing, clock }).recovery;
}

/** Server-only invocation configuration for one original customer task. The
 * loader is the existing authenticated material source; caller scope is not an
 * authority. No configuration management, dispatch grant or production enable.
 * Resolve only while the original task is RUNNING and its execute gate remains
 * valid. Tenant credentials stay inside the existing encrypted resolver.
 */
export async function composeClientTaskModelConfiguration(input: AiClientTaskDependencies & {
  db: Parameters<typeof createPersistedTenantModelConfiguration>[0]['db'];
  secrets: SecretBox;
  loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>;
  clock?: () => Date;
}, value: unknown) {
  const command = structuredClone(clientTaskCommandSchema.parse(structuredClone(value)));
  const dependencies = { db: input.db, subscriptions: input.subscriptions,
    sceneCode: input.sceneCode, sceneVersion: input.sceneVersion };
  const loader = input.loadMaterial, clock = input.clock ?? (() => new Date()), secrets = input.secrets;
  const authorization = composePersistedClientTaskAuthorization(dependencies, command, loader, clock);
  const receipt = await composeClientMaterialTasks(dependencies, loader, clock).readCreation(command);
  if (!receipt.task) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const taskId = receipt.task.taskId;
  // A queued/paused task can build an inert assembly for startup/input handling.
  // This neither reads a model/credential nor permits invocation before RUNNING.
  await authorization.authority.resolve(taskId, 'read_metadata');
  const scopes = new AiScopeRepository(dependencies.db, {
    resolve: () => authorization.execution.authorize(taskId)
  }, clock);
  const configuration = createPersistedTenantModelConfiguration({ db: dependencies.db, secrets,
    authorize: async (value, action) => {
      const expected = structuredClone(value);
      if (action !== 'invoke') throw new ModelGatewayError('FORBIDDEN');
      const current = gatewayBudgetPrincipal(await authorization.execution.authorize(taskId));
      if (current.actorKind !== 'CUSTOMER' || current.actorId !== expected.actorId
        || current.tenantId !== expected.tenantId || current.workspaceId !== expected.workspaceId) {
        throw new ModelGatewayError('FORBIDDEN');
      }
    }
  });
  const connection = createScopeBoundTenantModelConnection(configuration, scopes);
  const createCallGateway = (server: ClientCallGatewayDependencies) => {
    /** Same original task, original encrypted configuration and one persistent
     * ledger. Only explicit server adapters; no default provider or HTTP client.
     * Live capabilities must already have the original verified probe receipt.
     * Building this object does not read a model, reserve, claim or invoke. */
      if (!server || server.db !== dependencies.db || typeof server.audit?.append !== 'function'
        || typeof server.platformConnection?.resolve !== 'function' || !Array.isArray(server.adapters)
        || !server.adapters.length) throw new ModelGatewayError('CONFIG_INVALID');
      const db = server.db, routeScene = server.routeScene, callPriceVersion = server.callPriceVersion;
      const adapters = [...server.adapters], audit = server.audit, platformConnection = server.platformConnection;
      const budgetAuthority = new PrismaClientTaskBudgetAuthorizationSource({ ...dependencies, db,
        command, loadMaterial: loader, clock });
      // Financial reads/reconcile use the original accounting authority, not a
      // RUNNING-only gate that would prohibit accounting after a terminal result.
      const pricing = new PrismaGatewayCallPricing(db, budgetAuthority.scopes, callPriceVersion, clock);
      const accounting = createPersistedGatewayBudget({ db, scopes: budgetAuthority.scopes,
        subscriptions: dependencies.subscriptions, authorization: budgetAuthority, pricing, clock });
      const capabilities = createPersistedTextCapabilityEvidence(db, clock);
      const profiles = new PrismaProviderProfileRepository(db);
      const routing = new AiGatewayRoutingService(scopes, configuration,
        new ProviderRouterService({ profiles, capabilities }), routeScene);
      const admissions = new PrismaAdmissionRepository(db);
      const runtime: PublicGatewayRuntime = {
        evidence: 'live',
        ports: { routing, admission: new InvocationAdmissionService(admissions, clock),
          dispatch: new InvocationDispatchService(admissions), budget: accounting.budget, audit,
          transport: new RoutedModelTransport({ platform: platformConnection, tenant: connection }, adapters) },
        verifyEvidence: async (resolution, mode) => {
          if (mode !== 'live' || resolution.scene !== routeScene) return false;
          // The existing router and preflight resolve the exact current profile
          // and verified persisted evidence; a declared/mock fingerprint alone
          // never becomes a live transport capability here.
          const { actorKind: _, ...context } = gatewayBudgetPrincipal(resolution.context);
          await routing.assertCurrent(context, resolution);
          return (await capabilities.preflight(resolution.route.profile, resolution.requiredCapabilities)).allowed;
        }
      };
      return Object.freeze({ runtime, callPriceVersion, accountingRecovery: accounting.recovery,
        financialEvidence: Object.freeze({ readDispatch: accounting.facts.readDispatch.bind(accounting.facts) }) });
  };
  return Object.freeze({ configuration, scopes, connection, createCallGateway,
    createPersistedCallGateway(server: ClientPersistedCallGatewayDependencies) {
      if (!server || server.db !== dependencies.db) throw new ModelGatewayError('CONFIG_INVALID');
      const platformConnection = new PrismaPlatformModelConnection(server.db, scopes, {
        // Customer tasks never manage or save platform configuration.
        manage: async () => { throw new ModelGatewayError('FORBIDDEN'); },
        invoke: async value => {
          const expected = structuredClone(value);
          const principal = gatewayBudgetPrincipal(await authorization.execution.authorize(taskId));
          if (principal.actorKind !== 'CUSTOMER' || principal.actorId !== expected.actorId
            || principal.tenantId !== expected.tenantId || principal.workspaceId !== expected.workspaceId)
            throw new ModelGatewayError('FORBIDDEN');
        }
      }, secrets);
      return createCallGateway({ ...server, platformConnection });
    }
  });
}
