import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AI_APPROVAL_APPLICATION_DRAFT_VERSION, type AiApprovalReprepareCommandDraft, type AiApprovalReprepareReceiptDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { approvalApplicationContract } from './approval-application-contracts';
import { ApprovedOrderHumanAuthority } from './approved-order-human.authority';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import { PrismaApprovedOrderReprepareRepository, type ApprovedOrderReprepareRow } from './prisma-approved-order-reprepare.repository';
import { approvedOrderCommandSchema, deniedOrder, orderContextHash } from './prisma-approved-order.source';
import { AiApprovedOrderResultUnknownError } from './approved-order.errors';
import type { ApprovedOrderReprepareApplication, ApprovedOrderReprepareServices } from './approved-order-reprepare.ports';
import { callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
export class AiApprovalReprepareResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'read_reprepare_receipt';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

function transactionDependencies(d: ControlledApprovedOrderDependencies, tx: Prisma.TransactionClient): ControlledApprovedOrderDependencies {
  const db = new Proxy(d.db, { get(target, property) {
    if (property === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
    const owner = property in tx ? tx : target, value = Reflect.get(owner, property);
    return typeof value === 'function' ? value.bind(owner) : value;
  } });
  return { ...d, db, quoteFacts: { findQuote: (tenant, id, supplied) => d.quoteFacts.findQuote(tenant, id, supplied ?? tx) } };
}

export function composeApprovedOrderReprepare(d: ControlledApprovedOrderDependencies): ApprovedOrderReprepareApplication {
  const human = new ApprovedOrderHumanAuthority(d), ledger = new PrismaApprovedOrderReprepareRepository(d.db);
  const clock = d.clock ?? (() => new Date());
  // A native four-pass history read alone exceeded 5s. Full provenance and
  // confirmation-witness rechecks need one bounded preparation window, not
  // repeated 5s/10s windows; this never resets resources or permits a retry.
  const preparationWindowMs = 60000;
  const parse = (value: unknown) => {
    const command = approvalApplicationContract('AiApprovalReprepareCommandDraft', value);
    if (command.originalTaskId === command.replacement.taskId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return command;
  };
  const readers = async (command: AiApprovalReprepareCommandDraft, deps = d) => {
    const policy = new ApprovedOrderHumanAuthority(deps).policy;
    const original = await policy.authorizeRead(command.originalTaskId), replacement = await policy.authorizeRead(command.replacement.taskId);
    if (original.scopeId !== replacement.scopeId || orderContextHash(original.context) !== orderContextHash(replacement.context)
      || original.context.actor.kind !== 'user' || original.context.scope.kind !== 'workspace') throw deniedOrder();
    return { scopeId: original.scopeId, context: original.context, actorId: original.context.actor.userId };
  };
  const receipt = (command: AiApprovalReprepareCommandDraft, scopeId: string, row: ApprovedOrderReprepareRow | null): AiApprovalReprepareReceiptDraft => {
    const base = { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, operationKey: command.operationKey,
      receiptId: row?.id ?? `ar-${requestFingerprint([scopeId, command.operationKey]).slice(0, 32)}`,
      originalTaskId: command.originalTaskId, original: command.original, replacementTaskId: command.replacement.taskId };
    return approvalApplicationContract('AiApprovalReprepareReceiptDraft', row ? { ...base, state: 'prepared',
      proposal: { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: row.replacementProposalId,
        proposalRevision: row.replacementRevision, reviewedPayloadHash: row.replacementPayloadHash }, nextAction: 'review_and_decide'
    } : { ...base, state: 'unknown', retryable: false, nextAction: 'read_reprepare_receipt' }, true);
  };
  const readReceipt = async (value: unknown): Promise<AiApprovalReprepareReceiptDraft> => {
    const command = parse(value);
    try {
      const before = await readers(command), row = await ledger.find(before.scopeId, command.operationKey);
      if (row) {
        if (row.commandHash !== requestFingerprint(command) || row.actorId !== before.actorId || row.audience !== before.context.audience
          || row.originalTaskId !== command.originalTaskId || row.originalProposalId !== command.original.proposalId
          || row.originalRevision !== command.original.proposalRevision || row.originalPayloadHash !== command.original.reviewedPayloadHash
          || row.replacementTaskId !== command.replacement.taskId) throw conflict();
        const app = composeControlledApprovedOrder(d);
        const original = await app.application.readReprepareEligibility(command.originalTaskId, {
          draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: command.original, intent: 'inspect'
        });
        if (original.state !== 'superseded') throw new AiApprovalReprepareResultUnknownError();
        const view = await app.approvals.readOriginal(row.replacementTaskId, { contractVersion: AI_PROPOSAL_DRAFT_VERSION,
          proposalId: row.replacementProposalId, proposalRevision: row.replacementRevision, reviewedPayloadHash: row.replacementPayloadHash });
        if (view.proposal.payload.actions[0].actionId !== row.replacementActionId
          || view.proposal.payload.actions[0].input.contentHash !== row.replacementFingerprint) throw conflict();
      }
      const after = await readers(command), latest = await ledger.find(after.scopeId, command.operationKey);
      if (before.scopeId !== after.scopeId || orderContextHash(before.context) !== orderContextHash(after.context)) throw deniedOrder();
      if (requestFingerprint(row) !== requestFingerprint(latest)) throw new AiApprovalReprepareResultUnknownError();
      return receipt(command, before.scopeId, row);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError || error instanceof AiApprovalReprepareResultUnknownError) throw error;
      throw new AiApprovalReprepareResultUnknownError();
    }
  };
  const materials = async (command: AiApprovalReprepareCommandDraft, services: ApprovedOrderReprepareServices,
    deps: ControlledApprovedOrderDependencies, tx: Prisma.TransactionClient) => {
    const r = command.replacement, current = await readers(command, deps);
    const proof = await services.selection.readAuthorized({ draftVersion: 'ain-quote-selection-draft-1', originalInputRef: r.originalInputRef,
      selectionId: r.quoteSelectionRef, taskId: r.taskId, runId: r.runId, inputHash: r.fingerprint }, tx);
    if (!proof || !isAiStepExecutionContext(proof.context) || orderContextHash(proof.context) !== orderContextHash(current.context)
      || proof.scopeId !== current.scopeId || proof.taskId !== r.taskId || proof.runId !== r.runId || proof.originalInputRef !== r.originalInputRef
      || proof.selectionId !== r.quoteSelectionRef || proof.inputHash !== r.fingerprint || requestFingerprint(proof.body) !== r.fingerprint
      || !hash.safeParse(proof.bindingHash).success || !hash.safeParse(proof.quoteHash).success || !hash.safeParse(proof.originalInputHash).success
      || !Number.isSafeInteger(proof.selectionRevision) || proof.selectionRevision < 1 || proof.body.quoteId !== proof.quoteId
      || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= clock().getTime()) throw unavailable();
    const task = await tx.aiTask.findFirst({ where: { scopeId: current.scopeId, id: r.taskId } });
    const originalTask = await tx.aiTask.findFirst({ where: { scopeId: current.scopeId, id: command.originalTaskId } });
    const step = await tx.aiStep.findFirst({ where: { scopeId: current.scopeId, taskId: r.taskId, runId: r.runId, id: r.stepId } });
    const input = await tx.aiTaskActionInput.findFirst({ where: { scopeId: current.scopeId, taskId: r.taskId, runId: r.runId, id: r.inputRef } });
    const plan = await tx.aiTaskRunPlan.findFirst({ where: { scopeId: current.scopeId, taskId: r.taskId, runId: r.runId } });
    if (!task || task.inputRef !== r.originalInputRef || task.inputHash !== proof.originalInputHash || task.inputRef === originalTask?.inputRef
      || !step || step.actionId !== r.actionId || step.inputRef !== r.inputRef || step.requestFingerprint !== r.fingerprint
      || task.cancelRequestedAt !== null || step.status !== 'RUNNING' || step.resultRef
      || step.toolCode !== 'rental.order.commit' || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || !input || input.fingerprint !== r.fingerprint || requestFingerprint(input.payload) !== r.fingerprint
      || !plan || plan.planHash !== r.planHash || requestFingerprint(plan.payload) !== r.planHash
      || !(input.expiresAt instanceof Date) || input.expiresAt <= clock()) throw unavailable();
    let lease: z.infer<typeof approvedOrderCommandSchema.shape.lease> | null = null;
    let prepared: { proposalId: string; proposalRevision: number; reviewedPayloadHash: string } | null = null;
    let confirmationHash: string | null = null;
    if (task.status === 'WAITING_CONFIRMATION' && step.effect === 'POSSIBLE') {
      // The normal runner has already frozen the new proposal and released its
      // lease. Reuse that exact confirmation, not a fabricated RUNNING/NONE
      // state or a second proposal. This grants metadata supersession only.
      const phaseKey = { scopeId: current.scopeId, taskId: r.taskId, runId: r.runId, stepId: r.stepId };
      const phases = await taskExecutionPhaseStore(tx).readReceipts(phaseKey);
      if (phases.length !== 1) throw unavailable();
      const phase = phases[0];
      if (phase.kind !== 'confirmation' || !phase.proposalId || !phase.proposalRevision || !phase.reviewedPayloadHash
        || requestFingerprint(phase.payload) !== phase.contentHash) throw unavailable();
      const original = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: phase.proposalId,
        proposalRevision: phase.proposalRevision, reviewedPayloadHash: phase.reviewedPayloadHash };
      const app = composeControlledApprovedOrder(deps);
      const eligibility = await app.application.readReprepareEligibility(r.taskId, {
        draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original, intent: 'inspect'
      });
      // Eligibility verifies the unique start/receipt/artifact and original
      // input/plan/lease hashes plus absence of approval/Core submission. A
      // later phase, unknown decision or an approved replacement cannot reuse it.
      if (eligibility.state !== 'pending') throw unavailable();
      const view = await app.approvals.readOriginal(r.taskId, original);
      if (view.proposal.payload.actions[0].actionId !== r.actionId
        || view.proposal.payload.actions[0].input.contentHash !== r.fingerprint) throw conflict();
      prepared = { proposalId: original.proposalId, proposalRevision: original.proposalRevision,
        reviewedPayloadHash: original.reviewedPayloadHash };
      confirmationHash = requestFingerprint({ phaseId: phase.phaseId, contentHash: phase.contentHash, prepared,
        taskRevision: task.revision, stepRevision: step.revision });
    } else {
      if (task.status !== 'RUNNING' || step.effect !== 'NONE') throw unavailable();
      const held = approvedOrderCommandSchema.shape.lease.safeParse(await services.lease.current(r, tx));
      if (!held.success || held.data.runId !== r.runId) throw unavailable();
      lease = held.data;
    }
    const expiresAt = new Date(Math.min(input.expiresAt.getTime(), Date.parse(proof.expiresAt))).toISOString();
    const proofHash = requestFingerprint({ selection: proof.bindingHash, originalInputHash: proof.originalInputHash,
      quoteHash: proof.quoteHash, inputHash: r.fingerprint, planHash: r.planHash, inputRef: r.inputRef, confirmationHash });
    return { current, proof, proofHash, expiresAt, lease, prepared };
  };
  const reprepare = async (value: unknown): Promise<AiApprovalReprepareReceiptDraft> => {
    const command = parse(value);
    let submitted = false, committed = false;
    const attempt = async (signal: AbortSignal) => {
      const assertActive = () => { if (signal.aborted) throw new AiApprovalReprepareResultUnknownError(); };
      const current = await readers(command);
      assertActive();
      if (await ledger.find(current.scopeId, command.operationKey)) return readReceipt(command);
      if (!d.reprepareServices) throw unavailable();
      const grant = await human.resolve(command.originalTaskId, undefined, 'reprepare_approval');
      if (grant.principal.scopeId !== current.scopeId || orderContextHash(grant.context) !== orderContextHash(current.context)) throw deniedOrder();
      assertActive();
      submitted = true;
      await d.db.$transaction(async tx => {
        assertActive();
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${current.scopeId} AND id IN (${Prisma.join([command.originalTaskId, command.replacement.taskId].sort())}) ORDER BY id FOR UPDATE`);
        assertActive();
        if (await ledger.find(current.scopeId, command.operationKey, tx)) return;
        const deps = transactionDependencies(d, tx), app = composeControlledApprovedOrder(deps), authority = new ApprovedOrderHumanAuthority(deps);
        const services = d.reprepareServices!(deps);
        if (typeof services?.selection?.readAuthorized !== 'function' || typeof services?.lease?.current !== 'function') throw unavailable();
        const recheck = async () => {
          assertActive();
          const now = await authority.resolve(command.originalTaskId, tx, 'reprepare_approval');
          if (now.bindingHash !== grant.bindingHash) throw deniedOrder();
          const eligibility = await app.application.readReprepareEligibility(command.originalTaskId, {
            draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: command.original, intent: command.reason === 'change_plan' ? 'change_plan' : 'inspect'
          });
          if (['unknown', 'committed', 'approved_uncommitted'].includes(eligibility.state)) throw new AiApprovedOrderResultUnknownError();
          if (!eligibility.canRequestReprepare || eligibility.state !== (command.reason === 'change_plan' ? 'change_requested' : command.reason)) throw conflict();
          assertActive();
        };
        await recheck();
        const original = await app.approvals.readOriginal(command.originalTaskId, command.original), action = original.proposal.payload.actions[0];
        const head = await tx.aiProposal.findFirst({ where: { scopeId: current.scopeId, taskId: command.originalTaskId, id: command.original.proposalId } });
        if (!head) throw conflict();
        const first = await materials(command, services, deps, tx), r = command.replacement;
        if (!first.prepared && await tx.aiProposal.findFirst({ where: { scopeId: current.scopeId, taskId: r.taskId } })
          || await tx.aiApprovalConsumption.findFirst({ where: { scopeId: current.scopeId, taskId: r.taskId, actionId: r.actionId } })) throw conflict();
        if (original.facts.input.payload.quoteId === first.proof.quoteId || action.input.contentHash === r.fingerprint) throw conflict();
        assertActive();
        let saved = first.prepared;
        if (!saved) {
          if (!first.lease) throw unavailable();
          saved = await app.prepare({ taskId: r.taskId, proposalId: `rp-${requestFingerprint([current.scopeId, command.operationKey]).slice(0, 32)}`,
            proposalRevision: 1, actionId: r.actionId, expiresAt: first.expiresAt, lease: first.lease }).catch(error => {
            if (error instanceof AiApprovedOrderResultUnknownError || error instanceof AiTaskRepositoryError
              && ['AI_RESOURCE_UNAVAILABLE', 'AI_STORAGE_UNAVAILABLE'].includes(error.code)) throw new AiApprovalReprepareResultUnknownError();
            throw error;
          });
        }
        const prepared = await app.approvals.readProposal(r.taskId, { contractVersion: AI_PROPOSAL_DRAFT_VERSION,
          proposalId: saved.proposalId, proposalRevision: saved.proposalRevision, reviewedPayloadHash: saved.reviewedPayloadHash });
        const { consumedAt: _at, consumedOrderId: _order, ...quote } = prepared.facts.preview.payload;
        if (requestFingerprint(quote) !== first.proof.quoteHash || prepared.proposal.payload.actions[0].input.contentHash !== r.fingerprint) throw conflict();
        await recheck();
        const latest = await materials(command, services, deps, tx);
        if (latest.proofHash !== first.proofHash || latest.expiresAt !== first.expiresAt
          || requestFingerprint(latest.lease) !== requestFingerprint(first.lease)) throw conflict();
        assertActive();
        const changed = await tx.aiProposal.updateMany({ where: { scopeId: current.scopeId, taskId: command.originalTaskId,
          id: command.original.proposalId, stateRevision: head.stateRevision, status: head.status, currentRevision: head.currentRevision },
        data: { status: 'SUPERSEDED', currentRevision: command.original.proposalRevision, stateRevision: { increment: 1 } } });
        if (changed.count !== 1) throw conflict();
        await ledger.insert({ id: `ar-${requestFingerprint([current.scopeId, command.operationKey]).slice(0, 32)}`, scopeId: current.scopeId,
          operationKey: command.operationKey, commandHash: requestFingerprint(command), actorId: current.actorId,
          audience: current.context.audience as 'operator' | 'staff', originalTaskId: command.originalTaskId, originalProposalId: command.original.proposalId,
          originalRevision: command.original.proposalRevision, originalPayloadHash: command.original.reviewedPayloadHash,
          originalActionId: action.actionId, originalFingerprint: action.input.contentHash, replacementTaskId: r.taskId,
          replacementRunId: r.runId, replacementActionId: r.actionId, replacementFingerprint: r.fingerprint, replacementInputRef: r.inputRef,
          originalInputRef: r.originalInputRef, quoteSelectionRef: r.quoteSelectionRef, planHash: r.planHash, proofHash: first.proofHash,
          replacementProposalId: saved.proposalId, replacementRevision: saved.proposalRevision, replacementPayloadHash: saved.reviewedPayloadHash, createdAt: clock() }, tx);
        if ((await authority.resolve(command.originalTaskId, tx, 'reprepare_approval')).bindingHash !== grant.bindingHash) throw deniedOrder();
        const final = await materials(command, services, deps, tx);
        if (final.proofHash !== first.proofHash || final.expiresAt !== first.expiresAt
          || requestFingerprint(final.lease) !== requestFingerprint(first.lease)) throw conflict();
        // The new proposal, old-head supersession and operation receipt are
        // one transaction. A stopped callback must not commit any subset;
        // uncertainty after COMMIT is resolved only by the original receipt.
        assertActive();
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: preparationWindowMs });
      committed = true;
      return await readReceipt(command);
    };
    try {
      return await callAiTaskRunnerDependency(attempt, preparationWindowMs, 'approval_reprepare', undefined, d.runnerClock);
    } catch (error) {
      if (committed && !(error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED')) {
        throw new AiApprovalReprepareResultUnknownError();
      }
      if (error instanceof AiTaskRepositoryError || error instanceof AiApprovedOrderResultUnknownError || error instanceof AiApprovalReprepareResultUnknownError) throw error;
      if (submitted) throw new AiApprovalReprepareResultUnknownError();
      throw unavailable();
    }
  };
  return Object.freeze({ reprepare, readReceipt: async (value: unknown) => {
    const command = parse(value);
    try { return await callAiTaskRunnerDependency(() => readReceipt(command), 15000, 'approval_reprepare_receipt', undefined, d.runnerClock); }
    catch (error) {
      if (error instanceof AiTaskRepositoryError || error instanceof AiApprovalReprepareResultUnknownError) throw error;
      throw new AiApprovalReprepareResultUnknownError();
    }
  } });
}
