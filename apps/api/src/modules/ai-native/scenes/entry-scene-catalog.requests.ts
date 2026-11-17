/** 四端目录的原身份和元数据来源装配。只读Auth／Guard、原scope、
 * 发布与政策、权益及Gateway能力收据；不读密钥、不创建任务或原业务。
 * 缺原host／政策／能力不补签可用。目录结果仍不授权具体对象或后续动作。 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, isAiEntrySceneCatalogResponse,
  type AiExecutionContext, type AiEntrySceneCatalogResponse } from '@rental-os/shared';
import type { AiClientHostCapabilities, AiAutomationPolicyCurrentDraft } from '@rental-os/shared';
import { hasEffectivePermission } from '../../../common/permission-match';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { PlatformPolicyEntitlementSource } from '../platform-capability-probe/platform-budget.authorization';
import { PrismaTenantModelConfigRepository } from '../tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled } from '../model-config-compatibility';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import { createPersistedTextCapabilityEvidence } from '../prisma-text-capability-receipt.repository';
import { ProviderRouterService } from '../provider-router.service';
import type { AiProfileCapability } from '../provider-profile.ports';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { readRuntimePublication, type RuntimePublication } from '../runtime-publication.configuration';
import { createEntrySceneCatalogApplication, entryCatalogIdentityHash,
  type EntryCatalogCurrent, type EntryCatalogOriginalSource } from './entry-scene-catalog.application';
import type { EntrySceneDefinition, EntrySceneSurface } from './entry-scene-catalog';
import type { EntrySceneCatalogRequestFactory, EntrySceneCatalogHttpRequest } from './entry-scene-catalog.controller';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const bearer = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
type Host = { registered: boolean; clientHost?: AiClientHostCapabilities;
  automationPolicy?: AiAutomationPolicyCurrentDraft;
  stage?: { available: boolean; reference: string; revision: string; expiresAt: string } };
export interface EntrySceneCatalogDependencies {
  db: PrismaClient; auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  publication: Parameters<typeof readRuntimePublication>[0];
  /** Only the fixed provider registry may resolve an original host. Never
   * accepts an HTTP/model token, host name, permission or supplied success. */
  host(entry: EntrySceneDefinition, request: EntrySceneCatalogHttpRequest, current: EntryCatalogCurrent,
    signal?: AbortSignal): Promise<Host>;
  /** Reuse the original host's closed publication parser, including time
   * windows. This observation cannot enable an absent deployment section. */
  configured(entry: EntrySceneDefinition, publication: RuntimePublication): boolean;
  clock?(): Date;
}

export function composeEntrySceneCatalogRequests(d: EntrySceneCatalogDependencies, surface: EntrySceneSurface): EntrySceneCatalogRequestFactory {
  return request => {
    const parsed = bearer.safeParse(request?.headers?.authorization);
    if (!parsed.success) throw denied();
    let authorization: string | undefined = parsed.data;
    const boundRequest = Object.freeze({ headers: Object.freeze({ authorization: parsed.data }), ip: request.ip });
    const clock = d.clock ?? (() => new Date()), requestId = randomUUID();
    const assertLive = (signal?: AbortSignal) => { if (!authorization || signal?.aborted) throw denied(); };
    const credentials = { current: async () => { assertLive(); return { authorization: authorization!, requestId,
      audience: surface === 'staff_miniprogram' ? 'staff' as const : 'operator' as const }; } };
    const client = surface === 'client_miniprogram' || surface === 'tenant_website';
    const resolveIdentity = async (signal?: AbortSignal) => {
      assertLive(signal);
      let context: AiExecutionContext, customer: EntryCatalogCurrent['customer'];
      if (client) {
        const session = createAiGuardedClientSession(d.guard, { current: async () => {
          assertLive(signal); return { authorization: authorization!, ip: request.ip };
        } });
        const identity = await session.current(); assertLive(signal);
        context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId, authorizedAt: clock().toISOString(), audience: 'client',
          actor: { kind: 'customer', customerId: identity.customerId },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId } };
        customer = { customerId: identity.customerId, customerType: identity.customerType, sessionId: identity.sessionId,
          membership: 'active', enterpriseRelation: identity.customerType === 'corporate' ? 'current_owned_relation' : 'not_required' };
      } else {
        const identity = await d.auth.resolveAccessContext(authorization!, { audience: surface === 'staff_miniprogram' ? 'staff' : 'operator' });
        assertLive(signal);
        if (!identity) throw denied();
        if (identity.user.isSaasAdmin) {
          if (surface !== 'tenant_admin') throw denied();
          context = await new PlatformModelConfigurationAuthority(d.guard, credentials, undefined,
            { resolve: async () => { throw denied(); } }, clock).resolveDirectoryRead();
        } else context = await new AiTaskCurrentIdentityAuthority(d.auth, credentials, clock).resolve();
      }
      assertLive(signal); return { context, customer };
    };
    const current = async (signal?: AbortSignal): Promise<EntryCatalogCurrent> => {
      const before = await resolveIdentity(signal), expected = originalIdentityHash(before.context);
      const scopes = new AiScopeRepository(d.db, { resolve: async () => (await resolveIdentity(signal)).context }, clock);
      const canonical = await scopes.resolveCurrent(); assertLive(signal);
      const after = await resolveIdentity(signal);
      if (originalIdentityHash(canonical.context) !== expected || originalIdentityHash(after.context) !== expected
        || hash(after.customer ?? null) !== hash(before.customer ?? null)) throw denied();
      return { context: after.context, scopeId: canonical.scope.id, ...(after.customer ? { customer: after.customer } : {}) };
    };
    const readPlan = async (entry: EntrySceneDefinition, principal: EntryCatalogCurrent, automation?: AiAutomationPolicyCurrentDraft) => {
      const sceneCode = automation?.policy.sceneCode ?? entry.sceneCode, sceneVersion = automation?.policy.sceneVersion ?? entry.sceneVersion;
      if (!sceneCode) return undefined;
      const key = { scopeId: principal.scopeId, sceneCode, sceneVersion };
      const row = await d.db.aiTaskPlanPolicy.findFirst({ where: key });
      if (!row) return undefined;
      const tools = aiPersistedPlanToolsSchema.safeParse(row.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(row.limits);
      if (Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
        || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
        || !tools.success || !limits.success || limits.data.maxStepMs > limits.data.maxTotalMs
        || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
      return { scopeId: row.scopeId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
        enabled: row.enabled, revision: row.revision, expiresAt: row.expiresAt.toISOString(), allowedTools: tools.data };
    };
    const entitlement = async (entry: EntrySceneDefinition, principal: EntryCatalogCurrent) => {
      const featureCode = entry.policy.featureCode;
      if (!featureCode) return undefined;
      const c = principal.context;
      if (c.scope.kind === 'platform') {
        const result = await new PlatformPolicyEntitlementSource(d.db, entry.sceneCode!, clock, featureCode).check(c, featureCode);
        return { featureCode, state: result.available ? 'available' as const : 'unavailable' as const,
          reference: principal.scopeId, revision: String(result.revision) };
      }
      if (c.scope.kind !== 'workspace') throw denied();
      const result = await new PrismaSubscriptionBudgetReader(d.db, d.subscriptions, clock).read(c.scope.tenantId, featureCode);
      const rows = result.entitlements.filter(row => row.code === featureCode);
      if (rows.length !== 1) throw unavailable();
      return { featureCode, state: rows[0].available ? 'available' as const : 'unavailable' as const,
        reference: c.scope.tenantId, revision: String(result.revision) };
    };
    const capability = async (entry: EntrySceneDefinition, principal: EntryCatalogCurrent, signal?: AbortSignal) => {
      const kind = entry.policy.modelCapability;
      if (!kind) return undefined;
      const repository = new PrismaTenantModelConfigRepository(d.db);
      const c = principal.context;
      const record = c.scope.kind === 'workspace' ? await repository.read(c.scope.tenantId) : null;
      assertLive(signal);
      const mode = c.scope.kind === 'platform' ? 'platform_managed' : tenantModelMode(record);
      if (c.scope.kind !== 'platform' && !tenantModelServiceEnabled(record)) return undefined;
      const scopes = new AiScopeRepository(d.db, { resolve: async () => {
        const latest = await current(signal);
        if (entryCatalogIdentityHash(latest) !== entryCatalogIdentityHash(principal)) throw denied();
        return latest.context;
      } }, clock);
      const resolved = await scopes.resolveRoutingScopes(mode);
      const required: AiProfileCapability[] = kind === 'image' ? ['text', 'vision'] : kind === 'audio' ? ['text', 'audio']
        : entry.audience === 'platform' ? ['text', 'tools', 'structured_output'] : entry.entryId === 'operations.order_explanation' ? ['text', 'tools'] : ['text'];
      const route = await new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(d.db),
        capabilities: createPersistedTextCapabilityEvidence(d.db, clock) }).resolve({
        consumerScope: resolved.consumerScope, configurationScope: resolved.configurationScope, mode,
        // The original inspection host uses the VISION route for both image
        // and audio; directory observations must select that same profile role.
        scene: kind === 'image' || kind === 'audio' ? 'vision' : entry.audience === 'platform' ? 'builder' : 'chat', requiredCapabilities: required });
      assertLive(signal);
      const publication = readRuntimePublication(d.publication), configuration = publication.configurations[entry.disable.configurationSections[0]];
      const expectedProfile = entry.audience === 'staff' && configuration ?
        (configuration[kind === 'audio' ? 'audio' : 'image'] as { platformProfileId?: unknown } | undefined)?.platformProfileId
        : configuration?.platformProfileId;
      if (mode === 'platform_managed' && typeof expectedProfile === 'string' && route.profile.id !== expectedProfile) return undefined;
      if (c.scope.kind === 'workspace' && hash(await repository.read(c.scope.tenantId)) !== hash(record)) throw unavailable();
      return { kind, state: 'verified' as const, reference: route.profile.id,
        revision: hash({ profile: route.profile, selection: record ? { mode, revision: record.revision } : { mode }, preflight: route.preflight }) };
    };
    const original = async (entry: Readonly<EntrySceneDefinition>, principal: Readonly<EntryCatalogCurrent>, signal?: AbortSignal): Promise<EntryCatalogOriginalSource | null> => {
      assertLive(signal);
      const publication = readRuntimePublication(d.publication), now = clock();
      const permissions = 'access' in principal.context ? principal.context.access.permissions
        : 'permissions' in principal.context ? principal.context.permissions : [];
      const permitted = entry.permissionMode === 'any' ? entry.requiredPermissions.some(p => hasEffectivePermission(permissions, p))
        : entry.requiredPermissions.every(p => hasEffectivePermission(permissions, p));
      if (!permitted) return null;
      const host = await d.host(entry, boundRequest, principal, signal); assertLive(signal);
      if (!host.registered) return null;
      const enabled = d.configured(entry, publication), plan = await readPlan(entry, principal, host.automationPolicy);
      let grant: Awaited<ReturnType<typeof entitlement>> | undefined, model: Awaited<ReturnType<typeof capability>> | undefined;
      try { grant = await entitlement(entry, principal); } catch (error) {
        if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
      }
      if (enabled) try { model = entry.policy.modelCapability ? await capability(entry, principal, signal) : undefined; } catch (error) {
        if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
      }
      const stableStage = host.stage && { available: host.stage.available, reference: host.stage.reference, revision: host.stage.revision };
      const stableHost = host.clientHost && (({ observedAt: _at, expiresAt: _expiry, ...stable }) => stable)(host.clientHost);
      const expiresAt = new Date(Math.min(now.getTime() + 30000, plan?.enabled && Date.parse(plan.expiresAt) > now.getTime()
        ? Date.parse(plan.expiresAt) : Infinity, host.stage?.available ? Date.parse(host.stage.expiresAt) : Infinity,
        host.clientHost ? Date.parse(host.clientHost.expiresAt) : Infinity)).toISOString();
      const source: EntryCatalogOriginalSource = { entryId: entry.entryId, identityHash: entryCatalogIdentityHash(principal), surface,
        producer: entry.source.kind, reference: `entry:${entry.entryId}`, revision: hash({ publicationRevision: publication.revision,
          enabled, plan: plan ?? null, entitlement: grant ?? null, capability: model ?? null, stage: stableStage ?? null, clientHost: stableHost ?? null }),
        observedAt: now.toISOString(), expiresAt, implementation: enabled ? 'implemented' : 'preview_only', authority: 'allowed',
        tools: entry.tools.filter(tool => !tool.code.startsWith('ai.model.') || model).map(tool => ({ code: tool.code, version: AI_TOOL_DRAFT_VERSION })),
        manualExit: { key: entry.manualExit, state: host.stage?.available ? 'available' : 'unavailable' },
        ...(plan ? { plan } : {}), ...(grant ? { entitlement: grant } : {}), ...(model ? { capability: model } : {}),
        ...(host.clientHost ? { clientHost: host.clientHost } : {}),
        ...(host.automationPolicy ? { automationPolicy: host.automationPolicy } : {}),
        ...(host.stage ? { originalStage: { entryId: entry.entryId, scopeId: principal.scopeId,
          state: host.stage.available ? 'available' : 'unavailable', reference: host.stage.reference,
          revision: host.stage.revision, expiresAt: host.stage.expiresAt } } : {}) };
      return source;
    };
    const application = createEntrySceneCatalogApplication({ surface, current,
      publication: () => readRuntimePublication(d.publication), original, clock });
    return { async read(value, signal): Promise<AiEntrySceneCatalogResponse> {
      assertLive(signal); const result = await application.read(value, signal); assertLive(signal);
      if (!isAiEntrySceneCatalogResponse(result)) throw unavailable(); return result;
    }, close: () => { authorization = undefined; } };
  };
}
