import type { AiScopeRepository } from '../ai-scope.repository';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { BudgetError, type BudgetQuotePort, type BudgetPolicyKey } from './budget.ports';
import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { z } from 'zod';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { validateBudgetSettings, presentBudgetSettingsFields } from './budget-settings';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';
import { PersistedBudgetEvidenceAdapter } from './budget-dependency-adapters';
import { BudgetGatewayAdapter } from './budget-gateway-adapter';
import { createPersistedBudgetSubsystem } from './budget.module';
import { PersistentGatewayBudget } from './persistent-gateway-budget';
import { PrismaGatewayAccountingFacts, type GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { PrismaTaskBudgetAuthorizationSource } from './prisma-task-budget-authorization.source';
import { PrismaClientTaskBudgetAuthorizationSource } from './prisma-client-task-budget-authorization.source';

export function createPersistedGatewayBudget(input: {
  db: ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0] & ConstructorParameters<typeof PrismaGatewayAccountingFacts>[0];
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  authorization: BudgetAuthorizationSource;
  pricing: BudgetQuotePort & GatewayActualUsagePricing;
  clock?: () => Date;
}) {
  const bindings = new PrismaGatewayInvocationBindings(input.db, input.scopes, input.clock);
  const facts = new PrismaGatewayAccountingFacts(input.db, bindings, input.scopes, input.pricing, input.clock);
  const service = createPersistedBudgetSubsystem({ db: input.db, subscriptions: input.subscriptions, authorization: input.authorization,
    quotes: input.pricing, evidence: new PersistedBudgetEvidenceAdapter(facts), clock: input.clock });
  const selector = z.object({ scope: z.enum(['tenant', 'workspace']),
    sceneCode: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const write = selector.extend({ expectedRevision: z.number().int().min(0).max(4294967294), settings: z.unknown() }).strict();
  const identity = (value: Awaited<ReturnType<typeof input.scopes.resolveCurrent>>) => {
    const { requestId: _, authorizedAt: __, ...context } = value.context;
    return requestFingerprint({ context, scope: value.scope });
  };
  const target = async (value: z.infer<typeof selector>) => {
    const current = structuredClone(await input.scopes.resolveCurrent());
    if (current.context.actor.kind !== 'user' || current.context.audience !== 'operator'
      || current.context.scope.kind !== 'workspace' || current.scope.kind !== 'WORKSPACE'
      || current.context.scope.tenantId !== current.scope.tenantId
      || current.context.scope.workspaceId !== current.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const tenantId = current.context.scope.tenantId;
    const columns = aiPersistenceScopeColumns(value.scope === 'tenant' ? { kind: 'tenant', tenantId } : current.context.scope);
    const row = await input.db.aiScope.findFirst({ where: columns });
    if (!row || Object.entries(columns).some(([key, item]) => row[key as keyof typeof row] !== item)) throw new BudgetError('UNAVAILABLE');
    const key: BudgetPolicyKey = { scopeKind: columns.kind, scopeId: row.id, sceneCode: value.sceneCode };
    const recheck = async () => {
      if (identity(current) !== identity(structuredClone(await input.scopes.resolveCurrent()))) throw new BudgetError('FORBIDDEN');
    };
    await recheck();
    return { key, tenantId, recheck };
  };
  // Management consumers use the SAME service/repository/entitlement as the
  // financial lifecycle. These are internal server methods, not public DTOs
  // or a client-supplied scope ID. Platform policy remains platform-owned.
  const readSettings = async (value: unknown) => {
    const parsed = selector.safeParse(value);
    if (!parsed.success) throw new BudgetError('INVALID');
    const current = await target(parsed.data);
    const policy = await service.settings(current.key);
    await current.recheck();
    if (policy && (policy.scopeId !== current.key.scopeId || policy.scopeKind !== current.key.scopeKind
      || policy.sceneCode !== current.key.sceneCode || policy.settings.sceneCode !== current.key.sceneCode
      || policy.settings.scope.kind !== 'tenant' || policy.settings.scope.tenantId !== current.tenantId)) throw new BudgetError('FORBIDDEN');
    return policy;
  };
  const settings = Object.freeze({
    read: readSettings,
    /** Tenant-facing data projection, not a model capability/dispatch grant.
     * The raw read above remains an internal server management result. */
    summary: async (value: unknown) => {
      const parsed = selector.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const policy = await readSettings(parsed.data);
      const base = { scope: parsed.data.scope, sceneCode: parsed.data.sceneCode, admission: 'not_granted' as const };
      if (!policy) return { ...base, state: 'not_configured' as const, revision: null, settings: null, modelPolicy: null };
      const stored = policy.settings;
      if (!isGatewayConfig(stored.config)) throw new BudgetError('UNAVAILABLE');
      if (stored.scope.kind !== 'tenant' || !('tenantId' in stored.config)
        || stored.config.tenantId !== stored.scope.tenantId) throw new BudgetError('FORBIDDEN');
      return { ...base, state: 'configured' as const, revision: policy.revision,
        settings: presentBudgetSettingsFields(stored),
        // Platform provider/model/credential metadata must not reach tenant UI,
        // including through an allowedModels whitelist used internally.
        modelPolicy: stored.config.serviceMode === 'platform_managed'
          ? { mode: 'platform_managed' as const, serviceName: 'Rental OS AI' as const, selection: 'managed_by_platform' as const }
          : { mode: 'tenant_managed' as const, allowedModels: [...stored.allowedModels] },
        configurationMeaning: 'saved_policy_reference_not_current_selection' as const };
    },
    save: async (value: unknown, revalidateSelection?: () => Promise<void>) => {
      const parsed = write.safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const command = parsed.data, proposed = command.settings as AiUsageSettingsDraft;
      validateBudgetSettings(proposed);
      if (!isGatewayConfig(proposed.config) || proposed.sceneCode !== command.sceneCode) throw new BudgetError('INVALID');
      const current = await target(command);
      if (proposed.scope.kind !== 'tenant' || proposed.scope.tenantId !== current.tenantId
        || !('tenantId' in proposed.config) || proposed.config.tenantId !== current.tenantId
        || (proposed.config.serviceMode === 'platform_managed'
          ? proposed.config.configurationScope.kind !== 'platform' : proposed.config.configurationScope.kind !== 'tenant')
        || (proposed.config.configurationScope.kind === 'tenant'
          && proposed.config.configurationScope.tenantId !== current.tenantId)) throw new BudgetError('FORBIDDEN');
      // Authorize the original management action before reading profile facts.
      const grant = await input.authorization.authorize('settings_write',
        structuredClone(await input.authorization.resolveContext()), { policy: current.key });
      if (!grant) throw new BudgetError('FORBIDDEN');
      const revalidateConfiguration = async () => {
        await revalidateSelection?.();
        const ownerColumns = aiPersistenceScopeColumns(proposed.config.configurationScope);
        const owner = await input.db.aiScope.findFirst({ where: ownerColumns });
        const profile = await input.db.aiProviderProfile.findFirst({ where: { id: proposed.config.configId,
          configRevision: proposed.config.configRevision } });
        if (!owner || Object.entries(ownerColumns).some(([key, item]) => owner[key as keyof typeof owner] !== item)
          || !profile || profile.id !== proposed.config.configId || profile.configRevision !== proposed.config.configRevision
          || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind
          || profile.serviceMode !== proposed.config.serviceMode || profile.model !== proposed.config.model
          || profile.provider !== proposed.config.provider || profile.protocol !== proposed.config.protocol
          || profile.credentialRef !== proposed.config.credentialRef) throw new BudgetError('FORBIDDEN');
        await current.recheck();
      };
      await revalidateConfiguration();
      const saved = await service.saveSettings(current.key, proposed, command.expectedRevision, revalidateConfiguration);
      // If current identity changed after COMMIT, do not disclose the saved
      // policy or pretend that the write was rolled back.
      try { await current.recheck(); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return saved;
    }
  });
  return { bindings, facts, settings, budget: new PersistentGatewayBudget(new BudgetGatewayAdapter(service, bindings), facts) };
}

/** Workspace-user server assembly with real current task/configuration
 * authorization. Trusted versioned pricing remains required and fail-closed;
 * this helper does not invent model rates or register a production provider. */
export function createAuthorizedPersistedGatewayBudget(input:
  Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'authorization' | 'scopes' | 'db'>
  & ConstructorParameters<typeof PrismaTaskBudgetAuthorizationSource>[0]) {
  const authorization = new PrismaTaskBudgetAuthorizationSource(input);
  return createPersistedGatewayBudget({ ...input, authorization, scopes: authorization.scopes });
}

/** Explicit customer assembly; requires current original material authorization,
 * persisted execution policy and trusted pricing. Does not enable client models. */
export function createAuthorizedClientPersistedGatewayBudget(input:
  Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'authorization' | 'scopes' | 'db'>
  & ConstructorParameters<typeof PrismaClientTaskBudgetAuthorizationSource>[0]) {
  const authorization = new PrismaClientTaskBudgetAuthorizationSource(input);
  return createPersistedGatewayBudget({ ...input, authorization, scopes: authorization.scopes });
}
