import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { BudgetError } from './budget.ports';
import { assertPositiveQuantity, quantityAtoms } from './budget-quantity';

export function validateBudgetSettings(value: AiUsageSettingsDraft): void {
  if (!value || value.draftVersion !== 'ain-c07-draft-2' || !value.config || !Number.isSafeInteger(value.config.configRevision) || value.config.configRevision < 1
    || !value.scope || !['platform', 'tenant'].includes(value.scope.kind) || !value.sceneCode
    || !Array.isArray(value.allowedModels) || !Array.isArray(value.allowedScenes)
    || value.allowedModels.length > 100 || value.allowedScenes.length > 100
    || [...value.allowedModels, ...value.allowedScenes].some(item => typeof item !== 'string' || !item || item.length > 256)
    || !Number.isSafeInteger(value.maxConcurrent) || value.maxConcurrent < 0 || value.maxConcurrent > 10000
    || !Number.isSafeInteger(value.maxCallsPerRun) || value.maxCallsPerRun < 0 || value.maxCallsPerRun > 10000
    || !value.gates || ['platform', 'tenant', 'scene'].some(key => {
      const gate = value.gates[key as keyof typeof value.gates];
      return !gate || typeof gate.enabled !== 'boolean' || !Number.isSafeInteger(gate.revision) || gate.revision < 1;
    })) throw new BudgetError('INVALID');
  if (!value.budget || !['limited', 'zero', 'not_configured'].includes(value.budget.state)) throw new BudgetError('INVALID');
  if (value.budget.state === 'zero' && quantityAtoms(value.budget.quantity) !== 0n) throw new BudgetError('INVALID');
  if (value.budget.state === 'limited') assertPositiveQuantity(value.budget.quantity);
}
/** Closed management projection: old JSON extension keys are not public data.
 * Values and precision remain unchanged; this does not calculate admission. */
export function presentBudgetSettingsFields(value: AiUsageSettingsDraft) {
  validateBudgetSettings(value);
  const limit = value.budget;
  const budget = limit.state === 'not_configured' ? { state: limit.state } : {
    state: limit.state, quantity: limit.quantity.unit === 'money'
      ? { unit: limit.quantity.unit, amount: limit.quantity.amount, currency: limit.quantity.currency, scale: limit.quantity.scale }
      : { unit: limit.quantity.unit, value: limit.quantity.value }
  };
  const gates = {
    platform: { enabled: value.gates.platform.enabled, revision: value.gates.platform.revision },
    tenant: { enabled: value.gates.tenant.enabled, revision: value.gates.tenant.revision },
    scene: { enabled: value.gates.scene.enabled, revision: value.gates.scene.revision }
  };
  return { budget, gates, allowedScenes: [...value.allowedScenes],
    maxConcurrent: value.maxConcurrent, maxCallsPerRun: value.maxCallsPerRun };
}
/** Save accepts a disabled/zero policy; admission never interprets it as unlimited. */
export function assertBudgetSettingsPermit(value: AiUsageSettingsDraft, model: string, scene: string): void {
  validateBudgetSettings(value);
  if (!Object.values(value.gates).every(gate => gate.enabled) || value.budget.state !== 'limited' || value.maxConcurrent === 0 || value.maxCallsPerRun === 0
    || !value.allowedModels.includes(model) || !value.allowedScenes.includes(scene)) throw new BudgetError('EXHAUSTED');
}
