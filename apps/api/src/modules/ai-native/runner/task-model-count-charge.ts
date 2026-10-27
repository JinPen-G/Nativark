import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionBudgetPort, type AiTaskExecutionLease } from '../task-execution-budget.ports';

/** A second real request inside one model step. The original invocation stays
 * the anchor; this stable task-resource key is not a provider dispatch grant. */
export function taskModelCountChargeId(value: { scopeId: string; taskId: string; runId: string;
  stepId: string; actionId: string; stepFingerprint: string; gatewayInvocationId: string }) {
  const digest = requestFingerprint({ version: 'task-model-count-charge-1', ...value });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
/** Reconcile only the original count charge. This cannot settle generation or
 * base resources, clear a step result, reserve again, or resend a provider call. */
export async function reconcileTaskModelCountCharge(budget: AiTaskExecutionBudgetPort,
  lease: AiTaskExecutionLease, charge: Parameters<typeof isTaskModelCountCharge>[0]) {
  if (!isTaskModelCountCharge(charge) || charge.taskId !== lease.taskId || charge.runId !== lease.runId)
    throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
  return budget.reconcile({ taskId: lease.taskId, lease, chargeId: charge.chargeId,
    evidenceRef: `count:${charge.gatewayInvocationId}` });
}
export function isTaskModelCountCharge(row: { scopeId: string; taskId: string; runId: string; chargeId: string;
  stepId: string | null; actionId: string | null; stepFingerprint: string | null; gatewayInvocationId: string | null; resource: string }) {
  return row.resource === 'CALLS' && row.stepId !== null && row.actionId !== null
    && row.stepFingerprint !== null && row.gatewayInvocationId !== null && row.chargeId === taskModelCountChargeId({
      scopeId: row.scopeId, taskId: row.taskId, runId: row.runId, stepId: row.stepId, actionId: row.actionId,
      stepFingerprint: row.stepFingerprint, gatewayInvocationId: row.gatewayInvocationId });
}
/** Exactly three base resources and at most one generation plus its one count.
 * A second arbitrary CALLS row never becomes valid just by widening a bound. */
export function taskStepChargesValid(rows: Array<{ scopeId: string; taskId: string; runId: string; chargeId: string;
  stepId: string | null; actionId: string | null; stepFingerprint: string | null; gatewayInvocationId: string | null;
  resource: string; status?: string }>, modelRequired = false) {
  const count = rows.filter(isTaskModelCountCharge), regular = rows.filter(row => !isTaskModelCountCharge(row));
  return rows.length >= 3 && rows.length <= 5 && count.length <= 1
    && regular.length === (modelRequired ? 4 : regular.some(row => row.resource === 'CALLS') ? 4 : 3)
    && new Set(regular.map(row => row.resource)).size === regular.length
    && ['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(kind => regular.some(row => row.resource === kind))
    && rows.every(row => row.resource !== 'CALLS' || row.gatewayInvocationId !== null)
    && (!count.length || regular.some(row => row.resource === 'CALLS'
      && row.gatewayInvocationId === count[0].gatewayInvocationId));
}
