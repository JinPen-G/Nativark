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
/** Versioned policy metadata must not version away original capacity. Admission
 * holds this canonical tenant lock inside its existing financial transaction;
 * counts use original scene/Run attribution, not a config/price namespace.
 * These are invocation counts, never a sum of money, tokens or task resources. */
export async function assertByokMeterLimits(tx: Pick<Prisma.TransactionClient, 'aiScope' | '$queryRaw' | 'aiBudgetReservation'>,
  input: { tenantScopeId: string; tenantId: string; sceneCode: string; runId: string }) {
  const scope = await tx.aiScope.findUnique({ where: { id: input.tenantScopeId },
    select: { id: true, kind: true, tenantId: true, workspaceId: true } });
  if (!scope || scope.id !== input.tenantScopeId || scope.kind !== 'TENANT'
    || scope.tenantId !== input.tenantId || scope.workspaceId !== null) throw new BudgetError('FORBIDDEN');
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${input.tenantScopeId} FOR UPDATE`);
  const where = { tenantId: input.tenantId, sceneCode: input.sceneCode,
    status: { in: ['reserved', 'pending_reconciliation', 'settled'] } };
  // Expiry, profile rotation and mode changes do not prove non-consumption.
  // Old monetary reservations also occupy an invocation slot, without turning
  // their amounts into a BYOK fee. Only proven released calls leave capacity.
  const [total, concurrent, runCalls] = await Promise.all([
    tx.aiBudgetReservation.count({ where }),
    tx.aiBudgetReservation.count({ where: { ...where, status: { in: ['reserved', 'pending_reconciliation'] } } }),
    tx.aiBudgetReservation.count({ where: { ...where, runId: input.runId } })
  ]);
  if (![total, concurrent, runCalls].every(value => Number.isSafeInteger(value) && value >= 0)) throw new BudgetError('UNAVAILABLE');
  if (total >= BYOK_METER_LIMITS.totalCalls || concurrent >= BYOK_METER_LIMITS.maxConcurrent
    || runCalls >= BYOK_METER_LIMITS.maxCallsPerRun) throw new BudgetError('EXHAUSTED');
}
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
