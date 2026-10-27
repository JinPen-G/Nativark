import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AiUsageAssociationDraft, AiUsageSettingsDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetError, type BudgetPolicyKey } from './budget.ports';
import { creditAllocations } from './platform-credit-limit';

export const platformCreditScene = (sceneCode: string, association: AiUsageAssociationDraft) =>
  `platform-credit:${requestFingerprint({ sceneCode, config: association.config, priceVersion: association.priceVersion }).slice(0, 48)}`;

/** Internal ledger intersection, not another grant or a tenant-authored rate.
 * SaaS scene policy remains the PLATFORM member. The shared allowance lock in
 * reserve() enforces the actual current tenant/space money ceilings, including
 * old unknown holds across scenes and configuration versions. */
export async function ensurePlatformCreditPolicy(db: Pick<PrismaClient, 'aiBudgetPolicy' | 'aiTenantAiAllowance'>,
  key: BudgetPolicyKey, association: AiUsageAssociationDraft, sceneCode: string, currency: string, entitled: boolean) {
  if (!entitled || association.config.serviceMode !== 'platform_managed' || association.scope.kind !== 'workspace'
    || !['TENANT', 'WORKSPACE'].includes(key.scopeKind) || key.sceneCode !== platformCreditScene(sceneCode, association)
    || !/^[A-Z]{3}$/u.test(currency)) throw new BudgetError('FORBIDDEN');
  const account = await db.aiTenantAiAllowance.findUnique({ where: { tenantId_currency: { tenantId: association.scope.tenantId, currency } } });
  if (!account || account.grantedAmount.lte(0)
    || new Prisma.Decimal(creditAllocations(account.allocationsJson)[association.scope.workspaceId] ?? 0).lte(0)) throw new BudgetError('EXHAUSTED');
  const settings: AiUsageSettingsDraft = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: association.scope.tenantId },
    sceneCode, config: structuredClone(association.config), allowedModels: [association.config.model], allowedScenes: [sceneCode],
    gates: { platform: { enabled: entitled, revision: 1 }, tenant: { enabled: entitled, revision: 1 }, scene: { enabled: entitled, revision: 1 } },
    budget: { state: 'limited', quantity: { unit: 'money', amount: '999999999999999999.999999', currency, scale: 6 } },
    maxConcurrent: 4, maxCallsPerRun: 32 };
  const find = () => db.aiBudgetPolicy.findFirst({ where: key });
  let row = await find();
  if (!row) {
    try { row = await db.aiBudgetPolicy.create({ data: { id: randomUUID(), ...key, enabled: true, configRevision: 1,
      allowedModels: settings.allowedModels, allowedScenes: settings.allowedScenes, settingsJson: JSON.parse(JSON.stringify(settings)),
      unitKind: 'money', moneyLimit: '999999999999999999.999999', moneyCurrency: currency,
      maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: association.priceVersion } }); }
    catch { row = await find(); } // Metadata only; no financial reservation/dispatch is retried.
  }
  if (!row || row.scopeId !== key.scopeId || row.scopeKind !== key.scopeKind || row.sceneCode !== key.sceneCode
    || !row.enabled || row.unitKind !== 'money' || row.moneyCurrency !== currency || row.priceVersion !== association.priceVersion
    || requestFingerprint(row.settingsJson) !== requestFingerprint(settings)) throw new BudgetError('UNAVAILABLE');
  return row;
}
