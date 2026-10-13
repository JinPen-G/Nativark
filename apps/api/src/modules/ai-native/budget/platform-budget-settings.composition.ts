import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiUsageSettingsDraft } from '@rental-os/shared';
import { AI_USAGE_DRAFT_VERSION } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetService } from './budget.service';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { BudgetError, type BudgetAuthority, type BudgetPolicyKey } from './budget.ports';

const code = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const readSchema = z.object({ sceneCode: code }).strict();
const fields = z.object({ gates: z.unknown(), allowedModels: z.array(z.string().min(1).max(256)).max(100),
  allowedScenes: z.array(code).max(100), budget: z.unknown(),
  maxConcurrent: z.number().int().min(0).max(10000), maxCallsPerRun: z.number().int().min(0).max(10000) }).strict();
const writeSchema = readSchema.extend({ expectedRevision: z.number().int().min(0).max(4294967294), settings: fields }).strict();
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...current } = context;
  return requestFingerprint(current);
};

/** Platform-only management of the original policies. Its actual existing
 * provider-management Guard is not a tenant AI entitlement or an invocation
 * permit. This root exposes no reservation/dispatch/settlement method, creates
 * no default policy, and registers no route, worker or production module.
 */
export function createAuthorizedPlatformBudgetSettings(input: {
  db: ConstructorParameters<typeof PrismaBudgetRepository>[0] & Pick<PrismaClient, 'aiProviderProfile'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  /** Fixed by the server composition, never by a request or model. */
  profileId: string;
  clock?: () => Date;
}) {
  const { db, guard, credentials, profileId } = input;
  const clock = input.clock ?? (() => new Date());
  const denied = async (): Promise<never> => { throw new BudgetError('FORBIDDEN'); };
  const management = new PlatformModelConfigurationAuthority(guard, credentials,
    profileId, { resolve: denied }, clock);
  const scopes = new AiScopeRepository(db, management, clock);
  const current = async () => {
    const result = structuredClone(await scopes.resolveCurrent());
    if (result.scope.kind !== 'PLATFORM' || result.context.scope.kind !== 'platform'
      || result.context.actor.kind !== 'saas_admin') throw new BudgetError('FORBIDDEN');
    return result;
  };
  const authority: BudgetAuthority = {
    resolve: async (action, resource) => {
      if (action !== 'settings_read' && action !== 'settings_write') throw new BudgetError('FORBIDDEN');
      const command = structuredClone(resource), before = await current(), now = clock();
      if (!command.policy || command.policy.scopeKind !== 'PLATFORM' || command.policy.scopeId !== before.scope.id
        || !code.safeParse(command.policy.sceneCode).success || !(now instanceof Date)
        || !Number.isFinite(now.getTime())) throw new BudgetError('FORBIDDEN');
      const after = await current();
      if (identity(before.context) !== identity(after.context) || before.scope.id !== after.scope.id) throw new BudgetError('FORBIDDEN');
      return { context: after.context,
        authorizationKey: `platform-budget:${requestFingerprint({ action, policy: command.policy, principal: identity(after.context) })}`,
        expiresAt: new Date(now.getTime() + 5000),
        // Derived from the current real platform Guard, ONLY for configuration.
        // Financial admission still uses its own tenant subscription source.
        entitled: after.context.actor.kind === 'saas_admin' && after.context.scope.kind === 'platform' };
    }
  };
  const service = new BudgetService(new PrismaBudgetRepository(db), authority,
    { quote: denied }, { dispatch: denied, usage: denied }, clock);
  const target = async (sceneCode: string) => {
    const before = await current();
    const key: BudgetPolicyKey = { scopeKind: 'PLATFORM', scopeId: before.scope.id, sceneCode };
    const recheck = async () => {
      const after = await current();
      if (after.scope.id !== before.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    };
    return { key, recheck };
  };
  return Object.freeze({
    read: async (value: unknown) => {
      const parsed = readSchema.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const selected = await target(parsed.data.sceneCode);
      const result = await service.settings(selected.key);
      await selected.recheck();
      return result;
    },
    save: async (value: unknown) => {
      const parsed = writeSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const command = parsed.data, selected = await target(command.sceneCode);
      const profile = structuredClone(await db.aiProviderProfile.findFirst({ where: {
        id: profileId, scopeId: selected.key.scopeId, scopeKind: 'PLATFORM', serviceMode: 'platform_managed' } }));
      if (!profile || profile.id !== profileId || profile.scopeId !== selected.key.scopeId
        || profile.scopeKind !== 'PLATFORM' || profile.serviceMode !== 'platform_managed') throw new BudgetError('UNAVAILABLE');
      const config: AiGatewayConfigReferenceDraft = { configId: profile.id, configRevision: profile.configRevision,
        credentialRef: profile.credentialRef, protocol: profile.protocol, provider: profile.provider, model: profile.model,
        serviceMode: 'platform_managed', consumerScope: { kind: 'platform' }, configurationScope: { kind: 'platform' } };
      if (!isGatewayConfig(config)) throw new BudgetError('UNAVAILABLE');
      const observed = requestFingerprint(profile);
      const revalidateConfiguration = async () => {
        const latest = await db.aiProviderProfile.findFirst({ where: { id: profileId,
          scopeId: selected.key.scopeId, scopeKind: 'PLATFORM', serviceMode: 'platform_managed' } });
        if (!latest || requestFingerprint(latest) !== observed) throw new BudgetError('REVISION_CONFLICT');
        await selected.recheck();
      };
      const settings = { ...command.settings, draftVersion: AI_USAGE_DRAFT_VERSION, scope: { kind: 'platform' },
        sceneCode: command.sceneCode, config } as AiUsageSettingsDraft;
      const result = await service.saveSettings(selected.key, settings, command.expectedRevision, revalidateConfiguration);
      try { await selected.recheck(); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return result;
    }
  });
}
