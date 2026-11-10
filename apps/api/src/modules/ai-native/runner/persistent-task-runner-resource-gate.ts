import type { AiTaskExecutionBudgetPort, AiTaskExecutionChargeRequest, AiTaskExecutionMutation, AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import { AiTaskExecutionBudgetError, AiTaskExecutionPreReservationLimitError } from '../task-execution-budget.ports';
import { AiTaskRunnerPreReservationLimitError } from './ai-task-runner.service';
import type { AiTaskRunnerLease, AiTaskRunnerResourcePort, AiTaskRunnerResourceTicket, AiTaskRunnerStepRef } from './ai-task-runner.ports';

/** Only a server composition may implement this source. It reads persisted
 * step/action/invocation and resource measurement references, not model text.
 * No default implementation fabricates a plan, charge ID or usage evidence.
 */
export interface AiTaskRunnerResourceEvidenceSource {
  charges(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<{ modelCall: boolean; deferredModelCall?: true; requests: readonly AiTaskExecutionChargeRequest[] }>;
  modelCharge?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal): Promise<AiTaskExecutionChargeRequest>;
  prepareModelDispatch?(request: AiTaskExecutionChargeRequest, budget: AiTaskExecutionBudgetPort, signal?: AbortSignal): Promise<readonly string[]>;
  settlements(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<readonly AiTaskExecutionSettlementRequest[]>;
  recoverTicket?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, budget?: AiTaskExecutionBudgetPort): Promise<AiTaskRunnerResourceTicket>;
}

function freshReservation(receipt: AiTaskExecutionMutation | null | undefined, request: AiTaskExecutionChargeRequest) {
  return receipt?.replayed === false && receipt.charge?.chargeId === request.chargeId
    && receipt.charge.resource === request.resource && receipt.charge.amount === request.amount
    && receipt.charge.status === 'reserved' && receipt.charge.actualAmount === null;
}

export class PersistentTaskRunnerResourceGate implements AiTaskRunnerResourcePort {
  readonly preparation?: import('./task-run-preparation.ports').AiTaskPreparationResources;
  readonly overhead?: import('./ai-task-runner.ports').AiTaskRunnerOverheadPort;
  constructor(private readonly budget: AiTaskExecutionBudgetPort, private readonly source: AiTaskRunnerResourceEvidenceSource,
    preparation?: import('./prisma-task-run-preparation').PrismaTaskRunPreparation,
    overhead?: import('./prisma-task-run-overhead').PrismaTaskRunOverhead) {
    if (overhead) this.overhead = {
      includesEffectInterval: true,
      opensBudget: true,
      rotate: async (ticket, lease, segment, maximumMs, retainStepAllowance) => {
        try { return await overhead.rotate(ticket, lease, segment, maximumMs, retainStepAllowance, budget); }
        catch (error) {
          if (error instanceof AiTaskExecutionBudgetError && error.code === 'AI_RUN_LIMIT') throw new AiTaskRunnerPreReservationLimitError();
          throw error;
        }
      },
      remaining: (ticket, lease) => overhead.remaining(ticket, lease),
      begin: async (lease, segment, maximumMs, retainStepAllowance, recovery, pendingStart) => {
        try { return await overhead.begin(lease, segment, maximumMs, retainStepAllowance, recovery, budget, pendingStart); }
        catch (error) {
          if (error instanceof AiTaskExecutionBudgetError && error.code === 'AI_RUN_LIMIT') throw new AiTaskRunnerPreReservationLimitError();
          throw error;
        }
      },
      complete: (ticket, lease) => overhead.complete(ticket, lease, budget),
      completeAfterRelease: (ticket, lease, receipt) => overhead.completeAfterRelease(ticket, lease, receipt, budget),
      abandon: (ticket, lease) => overhead.abandon(ticket, lease, budget)
    };
    if (preparation) this.preparation = {
      begin: (lease, definition, maximumMs, signal) => preparation.begin(lease, definition, maximumMs, budget, signal),
      complete: (ticket, lease) => preparation.complete(ticket, lease, budget),
      ...(overhead ? { handoff: (ticket: import('./task-run-preparation.ports').AiTaskPreparationTicket,
        lease: AiTaskRunnerLease, recovery: boolean, retainStepAllowance: boolean) =>
        preparation.handoff(ticket, lease, overhead, budget, recovery, retainStepAllowance) } : {}),
      abandon: (ticket, lease) => preparation.abandon(ticket, lease, budget)
    };
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
    let plan: Awaited<ReturnType<AiTaskRunnerResourceEvidenceSource['charges']>>;
    try { plan = structuredClone(await this.source.charges(step, lease)); }
    catch (error) {
      // This is read-only preparation, before any charge or effect was attempted.
      // Use the runner's existing terminal path for a known cumulative limit;
      // never apply this mapping to reserve/dispatch/settlement uncertainty.
      if (error instanceof AiTaskExecutionBudgetError && error.code === 'AI_RUN_LIMIT') throw new AiTaskRunnerPreReservationLimitError();
      throw error;
    }
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
    const reserveStep = required.length === 3 ? this.budget.reserveStep?.bind(this.budget) : undefined;
    try {
      if (reserveStep) {
        // Same original amounts and IDs, one fenced transaction. Until the whole
        // acknowledgement is valid, these IDs are not an issued resource ticket.
        chargeIds.push(...plan.requests.map(request => request.chargeId));
        const receipts = await reserveStep(plan.requests);
        if (!Array.isArray(receipts) || receipts.length !== chargeIds.length
          || receipts.some((receipt, index) => !freshReservation(receipt, plan.requests[index]))) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      } else {
        for (const request of plan.requests) {
          const receipt = await this.budget.reserve(request);
          if (!freshReservation(receipt, request)) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
          chargeIds.push(request.chargeId);
        }
      }
    } catch (error) {
      if (reserveStep && error instanceof AiTaskExecutionPreReservationLimitError) throw new AiTaskRunnerPreReservationLimitError();
      // No complete ticket was issued, even on the sequential compatibility path.
      // Attempted IDs may name older rows; never mutate them or infer rollback.
      // Preserve all occupancy and keep the Runner from releasing an uncertain Run.
      throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    }
    return { chargeIds, ...(plan.deferredModelCall ? { modelPending: true as const } : {}) };
  }

  async beforeExecute(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal) {
    ticket = structuredClone(ticket); step = structuredClone(step); lease = structuredClone(lease);
    if (!ticket.modelPending) return ticket;
    if (!this.source.modelCharge || ticket.chargeIds.length !== 3) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const request = structuredClone(await this.source.modelCharge(step, lease, signal));
    if (request.resource !== 'calls' || request.amount !== 1n || request.taskId !== lease.taskId
      || request.lease.taskId !== lease.taskId || request.lease.runId !== lease.runId || request.lease.holderId !== lease.holderId
      || request.lease.revision !== lease.revision || request.lease.fencingToken !== lease.fencingToken
      || request.target.kind !== 'step' || request.target.stepId !== step.registered.stepId || !request.target.gatewayInvocationId
      || ticket.chargeIds.includes(request.chargeId)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    // The base ticket is already issued. Only a fresh valid call acknowledgement
    // may extend it; a attempted/replayed call ID is not cleanup authority.
    const complete = { chargeIds: [...ticket.chargeIds] };
    try {
      if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      let receipt: AiTaskExecutionMutation;
      try { receipt = await this.budget.reserve(request); }
      catch { throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN'); }
      if (!freshReservation(receipt, request)) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      complete.chargeIds.push(request.chargeId);
      // Generation and count each reserve before any count POST. This stage
      // owns the original working deadline, not a fresh decorator allowance.
      const additional = await this.source.prepareModelDispatch?.(request, this.budget, signal) ?? [];
      if (additional.length > 1 || additional.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(id)
        || complete.chargeIds.includes(id))) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      complete.chargeIds.push(...additional);
      if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
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
    const ticket = structuredClone(await this.source.recoverTicket(step, lease, this.budget));
    if (!ticket || !Array.isArray(ticket.chargeIds) || ticket.chargeIds.length < 3 || ticket.chargeIds.length > 5
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
    // Some original charges may already be marked; loss of cleanup authority
    // proves neither rollback nor a safe retry. Keep the caller on original
    // reconciliation, rather than masking an uncertain outcome as storage failure.
    if (failed) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
  }
}
