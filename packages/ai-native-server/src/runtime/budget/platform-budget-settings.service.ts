/** The original platform budget settings logic, with explicit host identity and
 * the same reservation/financial repository. No default policy or dispatch. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft } from '@rental-os/platform-contracts/ai-gateway';
import { AI_USAGE_DRAFT_VERSION, type AiUsageSettingsDraft } from '@rental-os/platform-contracts/ai-usage';
import { isGatewayConfig } from '@rental-os/platform-server/ai-gateway';
import { AiScopeRepository, type AiCurrentScopeAuthority } from '../ai-scope.repository';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { BudgetService } from './budget.service';
import { BudgetError, type BudgetAuthority, type BudgetPolicyKey, type BudgetTransactionRepository } from './budget.ports';
import { platformBudgetOperationWhere, platformBudgetReceiptSchema } from './budget-settings-operation';
import { taskMoneyLimitSchema } from './budget-settings';

const code = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const readSchema = z.object({ sceneCode: code }).strict();
const fields = z.object({ gates: z.unknown(), allowedModels: z.array(z.string().min(1).max(256)).max(100),
  allowedScenes: z.array(code).max(100), budget: z.unknown(),
  maxConcurrent: z.number().int().min(0).max(10000), maxCallsPerRun: z.number().int().min(0).max(10000),
  maxMoneyPerTask: taskMoneyLimitSchema.optional() }).strict();
const writeSchema = readSchema.extend({ expectedRevision: z.number().int().min(0).max(4294967294), operationKey: code.optional(), settings: fields }).strict();
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...current } = context;
  return requestFingerprint(current);
};

export function createPlatformBudgetSettings(input: {
  db: Pick<PrismaClient, 'aiProviderProfile' | 'aiScope'> & Partial<Pick<PrismaClient, 'aiModelConfigurationOperation'>>;
  authority: AiCurrentScopeAuthority & { resolveRead(): Promise<AiExecutionContext> };
  /** Actual server-selected Profile, never a caller's configuration. */
  profileId: string;
  /** Original repository scoped to the current pre-commit authority. */
  repository(platform?: { actorId: string; scopeId: string; profileFingerprint: string }): BudgetTransactionRepository;
  requireOperationKey?: boolean;
  clock?: () => Date;
}) {
  const { db, authority: management, profileId } = input;
  const clock = input.clock ?? (() => new Date());
  const denied = async (): Promise<never> => { throw new BudgetError('FORBIDDEN'); };
  const scopes = new AiScopeRepository(db, management, clock);
  const readScopes = new AiScopeRepository(db, { resolve: () => management.resolveRead() }, clock);
  const current = async (write = true) => {
    const result = structuredClone(await (write ? scopes : readScopes).resolveCurrent());
    if (result.scope.kind !== 'PLATFORM' || result.context.scope.kind !== 'platform'
      || result.context.actor.kind !== 'saas_admin') throw new BudgetError('FORBIDDEN');
    return result;
  };
  const authority: BudgetAuthority = {
    resolve: async (action, resource) => {
      if (action !== 'settings_read' && action !== 'settings_write') throw new BudgetError('FORBIDDEN');
      const command = structuredClone(resource), before = await current(action === 'settings_write'), now = clock();
      if (!command.policy || command.policy.scopeKind !== 'PLATFORM' || command.policy.scopeId !== before.scope.id
        || !code.safeParse(command.policy.sceneCode).success || !(now instanceof Date)
        || !Number.isFinite(now.getTime())) throw new BudgetError('FORBIDDEN');
      const after = await current(action === 'settings_write');
      if (identity(before.context) !== identity(after.context) || before.scope.id !== after.scope.id) throw new BudgetError('FORBIDDEN');
      return { context: after.context,
        authorizationKey: `platform-budget:${requestFingerprint({ action, policy: command.policy, principal: identity(after.context) })}`,
        expiresAt: new Date(now.getTime() + 5000),
        // Derived from the current real platform Guard, ONLY for configuration.
        // Financial admission still uses its own tenant subscription source.
        entitled: after.context.actor.kind === 'saas_admin' && after.context.scope.kind === 'platform' };
    }
  };
  const service = (platform?: { actorId: string; scopeId: string; profileFingerprint: string }) => new BudgetService(
    input.repository(platform), authority, { quote: denied }, { dispatch: denied, usage: denied }, clock);
  const target = async (sceneCode: string, write = true) => {
    const before = await current(write);
    const key: BudgetPolicyKey = { scopeKind: 'PLATFORM', scopeId: before.scope.id, sceneCode };
    const recheck = async () => {
      const after = await current(write);
      if (after.scope.id !== before.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    };
    return { key, recheck, context: before.context };
  };
  return Object.freeze({
    read: async (value: unknown) => {
      const parsed = readSchema.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const selected = await target(parsed.data.sceneCode, false);
      const result = await service().settings(selected.key);
      await selected.recheck();
      return result;
    },
    readOperation: async (value: unknown) => {
      const parsed = readSchema.extend({ operationKey: code }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const { operationKey, sceneCode } = parsed.data, selected = await target(sceneCode, false);
      if (selected.context.actor.kind !== 'saas_admin' || !db.aiModelConfigurationOperation) throw new BudgetError('UNAVAILABLE');
      const actorId = selected.context.actor.userId, where = platformBudgetOperationWhere(selected.key, operationKey);
      const row = structuredClone(await db.aiModelConfigurationOperation.findUnique({ where: { scopeId_scopeKind_targetId_operationKey: where } }));
      await selected.recheck();
      const base = { scope: 'platform' as const, sceneCode, operationKey, admission: 'not_granted' as const, automaticRetry: false as const };
      // Match the original configuration receipt boundary: another manager
      // cannot learn whether this author's operation exists.
      if (!row || row.actorId !== actorId) return { ...base, state: 'unknown' as const };
      const detail = platformBudgetReceiptSchema.safeParse(row.result);
      if (!detail.success || row.workspaceId !== null || row.scopeId !== where.scopeId || row.scopeKind !== where.scopeKind
        || row.targetId !== where.targetId || row.operationKey !== operationKey || row.commandHash !== detail.data.commandHash
        || row.resultHash !== requestFingerprint(detail.data) || row.expectedRevision !== detail.data.expectedRevision
        || row.resultRevision !== detail.data.savedRevision || detail.data.scopeId !== where.scopeId || detail.data.actorId !== actorId
        || detail.data.sceneCode !== sceneCode || detail.data.operationKey !== operationKey
        || !(row.recordedAt instanceof Date) || !Number.isFinite(row.recordedAt.getTime())) throw new BudgetError('UNAVAILABLE');
      return { ...base, state: 'recorded' as const, action: 'platformSave' as const, expectedRevision: row.expectedRevision,
        savedRevision: row.resultRevision, commandHash: row.commandHash, recordedAt: row.recordedAt.toISOString() };
    },
    save: async (value: unknown) => {
      const parsed = writeSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const command = parsed.data;
      if (input.requireOperationKey && !command.operationKey) throw new BudgetError('INVALID');
      const selected = await target(command.sceneCode);
      const operation = command.operationKey && selected.context.actor.kind === 'saas_admin' ? {
        kind: 'platform' as const, action: 'platformSave' as const, operationKey: command.operationKey,
        actorId: selected.context.actor.userId, commandHash: requestFingerprint(command) } : undefined;
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
      if (selected.context.actor.kind !== 'saas_admin') throw new BudgetError('FORBIDDEN');
      const result = await service({ actorId: selected.context.actor.userId, scopeId: selected.key.scopeId, profileFingerprint: observed })
        .saveSettings(selected.key, settings, command.expectedRevision, revalidateConfiguration, operation);
      try { await selected.recheck(); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return result;
    }
  });
}
