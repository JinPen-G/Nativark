import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AiUsageAssociationDraft, AiUsageSettingsDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetError } from './budget.ports';
import { validateBudgetSettings } from './budget-settings';

/** Private namespace isolates BYOK counters from platform-money scene policies.
 * It contains configuration REFERENCES only, never an API key or endpoint. */
export function byokMeterScene(sceneCode: string, association: AiUsageAssociationDraft) {
  return `byok-meter:${requestFingerprint({ sceneCode, config: association.config, priceVersion: association.priceVersion }).slice(0, 48)}`;
}
/** Operational abuse limits, not a supplier fee or tenant money allowance.
 * These limits grant no tool, task, capability, subscription or dispatch rights. */
export const BYOK_METER_LIMITS = Object.freeze({ totalCalls: 4294967295, maxConcurrent: 4, maxCallsPerRun: 32 });
export async function ensureByokMeterPolicy(db: Pick<Prisma.TransactionClient, 'aiBudgetPolicy'>,
  key: { scopeId: string; scopeKind: 'PLATFORM' | 'TENANT' | 'WORKSPACE'; sceneCode: string },
  association: AiUsageAssociationDraft, sceneCode: string, entitled: boolean) {
  const config = association.config;
  if (!entitled || config.serviceMode !== 'tenant_managed' || !('tenantId' in config)
    || association.scope.kind === 'platform' || config.tenantId !== association.scope.tenantId
    || key.sceneCode !== byokMeterScene(sceneCode, association)) throw new BudgetError('FORBIDDEN');
  const settings: AiUsageSettingsDraft = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: config.tenantId },
    sceneCode, config: structuredClone(config), allowedModels: [config.model], allowedScenes: [sceneCode],
    gates: { platform: { enabled: entitled, revision: 1 }, tenant: { enabled: entitled, revision: 1 }, scene: { enabled: entitled, revision: 1 } },
    budget: { state: 'limited', quantity: { unit: 'calls', value: BYOK_METER_LIMITS.totalCalls } },
    maxConcurrent: BYOK_METER_LIMITS.maxConcurrent, maxCallsPerRun: BYOK_METER_LIMITS.maxCallsPerRun };
  validateBudgetSettings(settings);
  const find = () => db.aiBudgetPolicy.findFirst({ where: key });
  let row = await find();
  if (!row) {
    if (typeof db.aiBudgetPolicy.create !== 'function') throw new BudgetError('UNAVAILABLE');
    try { row = await db.aiBudgetPolicy.create({ data: { id: randomUUID(), ...key, enabled: true, configRevision: 1,
      allowedModels: settings.allowedModels, allowedScenes: settings.allowedScenes,
      settingsJson: JSON.parse(JSON.stringify(settings)), unitKind: 'calls', callLimit: BYOK_METER_LIMITS.totalCalls,
      maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: association.priceVersion } }); }
    catch { row = await find(); } // exact immutable metadata read, NEVER a financial/dispatch grant
  }
  if (!row || row.scopeId !== key.scopeId || row.scopeKind !== key.scopeKind || row.sceneCode !== key.sceneCode
    || row.enabled !== true || row.unitKind !== 'calls' || row.priceVersion !== association.priceVersion
    || requestFingerprint(row.settingsJson) !== requestFingerprint(settings)) throw new BudgetError('UNAVAILABLE');
  return row;
}
