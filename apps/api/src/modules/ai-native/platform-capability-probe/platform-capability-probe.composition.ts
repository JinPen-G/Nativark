import type { PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SecretBox } from '../../../common/secret-box';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import { createAuthorizedPlatformModelConfiguration } from '../platform-model-config.composition';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutation, type AiTaskActionPolicyMutationAuthority } from '../prisma-task-action-policy.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import type { ModelJsonTransport } from '../chat-completions.adapter';
import { TextCapabilityProbeApplication } from '../text-capability-probe.application';
import { composePersistedTextProbeWorkflow } from '../text-capability-probe-task.composition';
import { PrismaTextProbeOriginalRequestRepository, type TextProbeOriginalAccessPort } from '../prisma-text-probe-original-request.repository';
import { composeTextCapabilityProbeTaskProducer } from '../text-capability-probe-task-producer.composition';
import { TEXT_PROBE_SCENE, TEXT_CAPABILITY_PROBE_TOOL, type TextProbeCommand, type TextProbeContext } from '../text-capability-probe';
import type { UnifiedGatewayAudit } from '../unified-ai-gateway.ports';
import type { AiTaskRunnerClock } from '../runner/ai-task-runner.ports';
import { PlatformTaskIdentityAuthority, composePlatformTaskAuthorization, PlatformTaskPlanPolicyReader } from './platform-probe.authorization';
import { PlatformBudgetAuthorizationSource, PlatformPolicyEntitlementSource, PlatformGatewayCallPricing } from './platform-budget.authorization';
import { PlatformCapabilityProbeAuthority } from './platform-probe.authority';

export interface AuthorizedPlatformCapabilityProbeDependencies {
  db: PrismaClient;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  secrets: SecretBox;
  /** Server-selected platform profile; requests and models never choose it. */
  platformProfileId: string;
  sceneVersion: string;
  priceVersion: string;
  host: { holderId: string; leaseMs: number };
  audit?: UnifiedGatewayAudit;
  protocol?: ModelJsonTransport;
  clock?: () => Date;
  monotonic?: () => number;
  runnerClock?: AiTaskRunnerClock;
}

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Sentinel tenant-session sources. The platform composition resolves identity
 * through the real platform Guard; these keep the shared engine's required
 * ports present while making any accidental tenant fallback fail closed. */
function tenantSessionSentinels() {
  const reject = async (): Promise<never> => { throw new Error('PLATFORM_PRINCIPAL_NO_TENANT_SESSION'); };
  return {
    auth: { resolveAccessContext: reject },
    subscriptions: { readCategoryCommercialContext: reject } as unknown as Pick<SubscriptionService, 'readCategoryCommercialContext'>,
  };
}

/** Explicit server assembly for the platform capability probe. Everything is
 * request-scoped and fail-closed: no policy seeding, no dispatch at assembly,
 * no tenant subscription, workspace scope or fabricated attribution. The real
 * platform budget policy gates new usage; the original lifecycle keeps its
 * separate current-authority grant. */
export function composeAuthorizedPlatformCapabilityProbe(input: AuthorizedPlatformCapabilityProbeDependencies) {
  const clock = input.clock ?? (() => new Date());
  // Mutual reference: the management Guard resolves the SaaS identity, while
  // the identity adapter closes over the authority created right after it.
  let platformIdentity!: PlatformTaskIdentityAuthority;
  const platformAuthority = new PlatformModelConfigurationAuthority(input.guard, input.credentials, input.platformProfileId,
    { resolve: () => platformIdentity.resolve() }, clock);
  platformIdentity = new PlatformTaskIdentityAuthority(platformAuthority, clock);
  const scopes = new AiScopeRepository(input.db, platformIdentity, clock);
  const bindings = new PrismaGatewayInvocationBindings(input.db, scopes, clock);
  const profiles = new PrismaProviderProfileRepository(input.db);
  const sentinels = tenantSessionSentinels();

  const identityPort = {
    async currentRequest(): Promise<{ context: TextProbeContext; binding: string }> {
      const current = structuredClone(await scopes.resolveCurrent());
      const principal = current.context;
      if (current.scope.kind !== 'PLATFORM' || principal.actor.kind !== 'saas_admin'
        || principal.scope.kind !== 'platform' || principal.audience !== 'operator') throw new ModelGatewayError('FORBIDDEN');
      const { requestId: _, authorizedAt: __, ...rest } = principal;
      return { context: { actorId: principal.actor.userId, scopeKind: 'platform' },
        binding: requestFingerprint({ identity: rest, scope: current.scope }) };
    },
    authority(context: TextProbeContext, command: TextProbeCommand) {
      return new PlatformCapabilityProbeAuthority({ management: platformAuthority, scopes, profiles,
        bindings, profileId: input.platformProfileId }, context, command);
    },
  };

  const application = new TextCapabilityProbeApplication({
    db: input.db, scopes, subscriptions: sentinels.subscriptions,
    management: { authorize: async () => { throw new ModelGatewayError('FORBIDDEN'); } },
    configuration: {
      selectionForInvocation: async () => { throw new ModelGatewayError('FORBIDDEN'); },
      profile: async () => { throw new ModelGatewayError('FORBIDDEN'); },
      credential: async () => { throw new ModelGatewayError('FORBIDDEN'); },
    },
    authorization: new PlatformBudgetAuthorizationSource({ db: input.db, scopes, clock }, bindings),
    entitlements: new PlatformPolicyEntitlementSource(input.db, TEXT_PROBE_SCENE, clock),
    entitlementFeatureCode: 'ai.native.platform.probe',
    pricing: new PlatformGatewayCallPricing(input.db, scopes, input.priceVersion, clock),
    ...(input.audit !== undefined ? { audit: input.audit } : {}),
    ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
    clock,
    platformConnection: createAuthorizedPlatformModelConfiguration({ db: input.db, guard: input.guard,
      credentials: input.credentials, invocation: platformIdentity, profileId: input.platformProfileId,
      secrets: input.secrets }).invocation,
    identity: identityPort,
  });

  const accessPort: TextProbeOriginalAccessPort = {
    async access() {
      const current = structuredClone(await scopes.resolveCurrent());
      const access = aiTaskAccessFromContext(current.context, 'platform-probe-original', clock());
      if (access.actorKind !== 'SAAS_ADMIN' || access.audience !== 'OPERATOR' || access.scope.kind !== 'PLATFORM'
        || current.scope.kind !== 'PLATFORM' || current.context.actor.kind !== 'saas_admin') throw denied();
      const { requestId: _, authorizedAt: __, ...rest } = current.context;
      return { context: current.context,
        owner: { scopeId: current.scope.id, audience: 'OPERATOR' as const, ownerKind: 'SAAS_ADMIN' as const, ownerId: access.actorId },
        binding: requestFingerprint(rest) };
    },
    async authorizeManagement(context) {
      if (context.actor.kind !== 'saas_admin' || context.scope.kind !== 'platform') throw denied();
      await platformAuthority.manage(input.platformProfileId);
    },
  };
  const planPolicyReader = new PlatformTaskPlanPolicyReader(input.db, platformIdentity,
    { code: TEXT_PROBE_SCENE, version: input.sceneVersion },
    [{ code: TEXT_CAPABILITY_PROBE_TOOL, version: AI_TOOL_DRAFT_VERSION }], clock);
  const originals = new PrismaTextProbeOriginalRequestRepository(input.db,
    { scopes, policy: planPolicyReader, probe: application, access: accessPort,
      sceneVersion: input.sceneVersion, priceVersion: input.priceVersion }, clock);
  const producer = { originals, ...composeTextCapabilityProbeTaskProducer({ db: input.db, source: originals, clock }) };

  const taskAuthorization = composePlatformTaskAuthorization({ db: input.db, guard: input.guard,
    credentials: input.credentials, profileId: input.platformProfileId, clock });
  const policyAuthority = (permissions: readonly string[]): AiTaskActionPolicyMutationAuthority => ({
    async resolve(taskId, operation) {
      if (operation !== 'configure_action_policy') throw denied();
      // Platform policy configuration is the real platform management Guard
      // plus current platform task ownership; never a tenant system-rules grant.
      await platformAuthority.manage(input.platformProfileId);
      const before = structuredClone(await scopes.resolveCurrent());
      const access = aiTaskAccessFromContext(before.context, taskId, clock());
      const held = 'permissions' in before.context ? before.context.permissions : [];
      if (access.actorKind !== 'SAAS_ADMIN' || access.audience !== 'OPERATOR' || access.scope.kind !== 'PLATFORM'
        || before.scope.kind !== 'PLATFORM' || before.context.actor.kind !== 'saas_admin'
        || permissions.some(permission => typeof permission !== 'string' || !held.includes(permission))) throw denied();
      const row = await input.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: before.scope.id }] },
        select: { id: true, scopeId: true, archivedAt: true } });
      if (!row || row.id !== taskId || row.scopeId !== before.scope.id || row.archivedAt !== null) throw denied();
      const after = structuredClone(await scopes.resolveCurrent());
      if (after.scope.id !== before.scope.id
        || requestFingerprint(after.context) !== requestFingerprint(before.context)) throw denied();
      return after.context;
    },
  });
  const taskPolicies = Object.freeze({
    read(taskId: string, operation: AiTaskActionPolicyMutation['operation']) {
      return new PrismaTaskActionPolicyRepository(input.db, scopes, policyAuthority([]), clock).read(taskId, operation);
    },
    readMutation(taskId: string, operation: AiTaskActionPolicyMutation['operation'], expectedRevision: number | null) {
      return new PrismaTaskActionPolicyRepository(input.db, scopes, policyAuthority([]), clock).readMutation(taskId, operation, expectedRevision);
    },
    put(value: AiTaskActionPolicyMutation, expectedRevision: number | null, recordOriginalReceipt = false) {
      const command = structuredClone(value);
      if (!Array.isArray(command?.requiredPermissions)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return new PrismaTaskActionPolicyRepository(input.db, scopes, policyAuthority([...command.requiredPermissions]), clock)
        .put(command, expectedRevision, recordOriginalReceipt);
    },
    clear(taskId: string, operation: AiTaskActionPolicyMutation['operation'], expectedRevision: number) {
      return new PrismaTaskActionPolicyRepository(input.db, scopes, policyAuthority([]), clock).clear(taskId, operation, expectedRevision);
    },
  });

  const workflow = composePersistedTextProbeWorkflow({
    db: input.db, auth: sentinels.auth, credentials: input.credentials, subscriptions: sentinels.subscriptions,
    guard: input.guard, host: input.host, probe: application,
    financialEvidence: application.financialEvidence,
    sceneVersion: input.sceneVersion, priceVersion: input.priceVersion,
    clock, ...(input.monotonic !== undefined ? { monotonic: input.monotonic } : {}),
    ...(input.runnerClock !== undefined ? { runnerClock: input.runnerClock } : {}),
    authorization: taskAuthorization, taskScopeKind: 'PLATFORM' as const,
    producer, taskPolicies,
  });
  return Object.freeze({ application, workflow, authorization: taskAuthorization, scopes, identity: platformIdentity });
}
