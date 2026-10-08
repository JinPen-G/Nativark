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
/** Save accepts a disabled/zero policy; admission never interprets it as unlimited. */
export function assertBudgetSettingsPermit(value: AiUsageSettingsDraft, model: string, scene: string): void {
  validateBudgetSettings(value);
  if (!Object.values(value.gates).every(gate => gate.enabled) || value.budget.state !== 'limited' || value.maxConcurrent === 0 || value.maxCallsPerRun === 0
    || !value.allowedModels.includes(model) || !value.allowedScenes.includes(scene)) throw new BudgetError('EXHAUSTED');
}
