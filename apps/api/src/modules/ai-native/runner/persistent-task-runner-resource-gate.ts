import type { AiTaskExecutionBudgetPort, AiTaskExecutionChargeRequest, AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import type { AiTaskRunnerLease, AiTaskRunnerResourcePort, AiTaskRunnerResourceTicket, AiTaskRunnerStepRef } from './ai-task-runner.ports';

/** Only a server composition may implement this source. It reads persisted
 * step/action/invocation and resource measurement references, not model text.
 * No default implementation fabricates a plan, charge ID or usage evidence.
 */
export interface AiTaskRunnerResourceEvidenceSource {
  charges(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<{ modelCall: boolean; deferredModelCall?: true; requests: readonly AiTaskExecutionChargeRequest[] }>;
  modelCharge?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskExecutionChargeRequest>;
  settlements(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<readonly AiTaskExecutionSettlementRequest[]>;
  recoverTicket?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerResourceTicket>;
}

export class PersistentTaskRunnerResourceGate implements AiTaskRunnerResourcePort {
  constructor(private readonly budget: AiTaskExecutionBudgetPort, private readonly source: AiTaskRunnerResourceEvidenceSource) {
    for (const name of ['initialize', 'load', 'reserve', 'record', 'reconcile', 'markUnknown'] as const) {
      if (typeof budget?.[name] !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    }
    if (typeof source?.charges !== 'function' || typeof source?.settlements !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  }

  async open(lease: AiTaskRunnerLease, recovery: boolean) {
    lease = structuredClone(lease);
    if (recovery) await this.budget.load(lease.taskId, lease);
    else await this.budget.initialize(lease.taskId, lease);
  }

  async reserve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    step = structuredClone(step); lease = structuredClone(lease);
    const plan = structuredClone(await this.source.charges(step, lease));
    if (plan.deferredModelCall && (plan.modelCall !== true || typeof this.source.modelCharge !== 'function')) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const required = plan?.modelCall === true && !plan.deferredModelCall ? ['steps', 'active_ms', 'output_bytes', 'calls'] : ['steps', 'active_ms', 'output_bytes'];
    if (typeof plan?.modelCall !== 'boolean' || !Array.isArray(plan.requests) || plan.requests.length !== required.length
      || new Set(plan.requests.map(request => request.resource)).size !== required.length
      || new Set(plan.requests.map(request => request.chargeId)).size !== required.length) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    for (const request of plan.requests) {
      if (!required.includes(request.resource) || request.taskId !== lease.taskId || request.lease.taskId !== lease.taskId
        || request.lease.runId !== lease.runId || request.lease.holderId !== lease.holderId || request.lease.revision !== lease.revision
        || request.lease.fencingToken !== lease.fencingToken || request.target.kind !== 'step' || request.target.stepId !== step.registered.stepId
        || (request.resource === 'steps' && request.amount !== 1n)
        || (request.resource === 'calls' && !request.target.gatewayInvocationId)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    }
    const chargeIds: string[] = [];
    try {
      for (const request of plan.requests) {
        // Include the attempted ID even when its commit acknowledgement is lost.
        chargeIds.push(request.chargeId);
        const receipt = await this.budget.reserve(request);
        if (receipt.replayed) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      }
    } catch (error) {
      // No refund and no dispatch following a partial/uncertain reservation.
      await this.markUnknown({ chargeIds }, lease).catch(() => {});
      throw error;
    }
    return { chargeIds, ...(plan.deferredModelCall ? { modelPending: true as const } : {}) };
  }

  async beforeExecute(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    ticket = structuredClone(ticket); step = structuredClone(step); lease = structuredClone(lease);
    if (!ticket.modelPending) return ticket;
    if (!this.source.modelCharge || ticket.chargeIds.length !== 3) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const request = structuredClone(await this.source.modelCharge(step, lease));
    if (request.resource !== 'calls' || request.amount !== 1n || request.taskId !== lease.taskId
      || request.lease.taskId !== lease.taskId || request.lease.runId !== lease.runId || request.lease.holderId !== lease.holderId
      || request.lease.revision !== lease.revision || request.lease.fencingToken !== lease.fencingToken
      || request.target.kind !== 'step' || request.target.stepId !== step.registered.stepId || !request.target.gatewayInvocationId
      || ticket.chargeIds.includes(request.chargeId)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const complete = { chargeIds: [...ticket.chargeIds, request.chargeId] };
    try {
      if ((await this.budget.reserve(request)).replayed) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    } catch (error) { await this.markUnknown(complete, lease).catch(() => {}); throw error; }
    return complete;
  }

  async record(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, reconcile: boolean) {
    ticket = structuredClone(ticket); step = structuredClone(step); lease = structuredClone(lease);
    const refs = structuredClone(await this.source.settlements(ticket, step, lease));
    if (!Array.isArray(refs) || refs.length !== ticket.chargeIds.length || new Set(refs.map(ref => ref.chargeId)).size !== refs.length) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    for (const ref of refs) {
      if (!ticket.chargeIds.includes(ref.chargeId) || ref.taskId !== lease.taskId || ref.lease.runId !== lease.runId
        || ref.lease.taskId !== lease.taskId || ref.lease.holderId !== lease.holderId || ref.lease.fencingToken !== lease.fencingToken
        || ref.lease.revision !== lease.revision) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    }
    for (const ref of refs) await (reconcile ? this.budget.reconcile(ref) : this.budget.record(ref));
  }

  async recover(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    if (typeof this.source.recoverTicket !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    step = structuredClone(step); lease = structuredClone(lease);
    await this.budget.load(lease.taskId, lease);
    const ticket = structuredClone(await this.source.recoverTicket(step, lease));
    if (!ticket || !Array.isArray(ticket.chargeIds) || ticket.chargeIds.length < 3 || ticket.chargeIds.length > 4
      || new Set(ticket.chargeIds).size !== ticket.chargeIds.length || ticket.chargeIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(id))) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    return ticket;
  }

  async markUnknown(ticket: AiTaskRunnerResourceTicket, lease: AiTaskRunnerLease) {
    ticket = structuredClone(ticket); lease = structuredClone(lease);
    let failed = false;
    for (const chargeId of ticket.chargeIds) {
      try { await this.budget.markUnknown({ taskId: lease.taskId, lease, chargeId, reason: 'runner_outcome_uncertain' }); }
      catch { failed = true; }
    }
    if (failed) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
  }
}
