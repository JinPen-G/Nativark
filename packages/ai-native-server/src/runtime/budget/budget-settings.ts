import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { z } from 'zod';
import { BudgetError } from './budget.ports';
import { assertPositiveQuantity, quantityAtoms } from './budget-quantity';

export const taskMoneyLimitSchema = z.object({ unit: z.literal('money'),
  amount: z.string().regex(/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u),
  currency: z.string().regex(/^[A-Z]{3}$/u), scale: z.literal(6) }).strict();

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
  if (value.maxMoneyPerTask !== undefined) {
    if (!taskMoneyLimitSchema.safeParse(value.maxMoneyPerTask).success) throw new BudgetError('INVALID');
    quantityAtoms(value.maxMoneyPerTask);
    if (value.budget.state !== 'not_configured' && value.budget.quantity.unit === 'money'
      && value.budget.quantity.currency !== value.maxMoneyPerTask.currency) throw new BudgetError('INVALID');
  }
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
  const taskLimit = value.maxMoneyPerTask;
  return { budget, gates, allowedScenes: [...value.allowedScenes],
    maxConcurrent: value.maxConcurrent, maxCallsPerRun: value.maxCallsPerRun,
    ...(taskLimit === undefined ? {} : { maxMoneyPerTask: { unit: taskLimit.unit,
      amount: taskLimit.amount, currency: taskLimit.currency, scale: taskLimit.scale } }) };
}
/** Save accepts a disabled/zero policy; admission never interprets it as unlimited. */
export function assertBudgetSettingsPermit(value: AiUsageSettingsDraft, model: string, scene: string): void {
  validateBudgetSettings(value);
  if (!Object.values(value.gates).every(gate => gate.enabled) || value.budget.state !== 'limited' || value.maxConcurrent === 0 || value.maxCallsPerRun === 0
    || !value.allowedModels.includes(model) || !value.allowedScenes.includes(scene)) throw new BudgetError('EXHAUSTED');
}
