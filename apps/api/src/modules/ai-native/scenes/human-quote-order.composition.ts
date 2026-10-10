import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { approvedOrderCommandSchema } from '../approval-execution/prisma-approved-order.source';
import { approvalApplicationContract } from '../approval-execution/approval-application-contracts';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof } from '../task-request/quote-selection.validation';
import type { AiTaskRunnerLease } from '../runner/ai-task-runner.ports';
import { composeTaskOrderHost, type TaskOrderHostDependencies } from '../runner/order-task-host.composition';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { AiApprovedOrderResultUnknownError } from '../approval-execution/approved-order.errors';

export type HumanQuoteOrderDependencies = ControlledApprovedOrderDependencies &
  Pick<HumanQuoteSelectionDependencies, 'originals'>;
export type SelectedQuoteTaskHostDependencies = HumanQuoteOrderDependencies & {
  host: TaskOrderHostDependencies['host'];
  task: Omit<TaskOrderHostDependencies['task'], 'order'> & { selection: unknown };
  monotonic?: () => number;
};
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const publication = z.object({ selection: z.unknown(), expectedTaskRevision: revision,
  lease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision,
    fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().max(40) }).strict() }).strict();
const preparation = z.object({ selection: z.unknown(), command: approvedOrderCommandSchema
  .omit({ approvalId: true, reviewedPayloadHash: true })
  .extend({ expiresAt: z.string().datetime({ offset: true }) }).strict() }).strict();
const reviewReference = approvedOrderCommandSchema.pick({ proposalId: true, proposalRevision: true, reviewedPayloadHash: true })
  .extend({ contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION) }).strict();
const reviewCommand = z.object({ selection: z.unknown(), proposal: reviewReference }).strict();
const decisionCommand = z.object({ selection: z.unknown(), proposal: reviewReference.extend({ decision: z.enum(['approve', 'reject']) }) }).strict();
const executionCommand = z.object({ selection: z.unknown(), command: approvedOrderCommandSchema }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

// Publication and preparation are separate transactions; only explicit submit can create an order.
export function composeHumanQuoteOrder(dependencies: HumanQuoteOrderDependencies) {
  const selections = new PrismaQuoteSelectionRepository(dependencies);
  const controlled = composeControlledApprovedOrder(dependencies);
  const registrationRef = (selectionId: string) => `quote-selection:${selectionId}`;
  const fresh = async (reference: unknown, bindingHash: string) => {
    const current = await selections.readAuthorized(reference);
    if (current.bindingHash !== bindingHash) throw denied();
    return current;
  };
  const selectedReview = async (value: unknown, reference: z.infer<typeof reviewReference>) => {
    const ref = parseQuoteSelectionProof(value);
    const readSelection = () => selections.read({ draftVersion: ref.draftVersion, originalInputRef: ref.originalInputRef, selectionId: ref.selectionId });
    const selected = await readSelection();
    if (selected.taskId !== ref.taskId || selected.runId !== ref.runId || selected.inputHash !== ref.inputHash) throw denied();
    const review = await controlled.approvals.readProposal(ref.taskId, reference);
    const access = await controlled.tasks.resolveAccess(ref.taskId, 'read_metadata');
    const task = await dependencies.db.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true, inputRef: true } });
    if (!task || task.id !== ref.taskId || task.inputRef !== ref.originalInputRef) throw denied();
    const action = review.proposal.payload.actions[0];
    const step = await dependencies.db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: ref.taskId,
      runId: ref.runId, actionId: action.actionId, toolCode: 'rental.order.commit' } });
    const input = step?.inputRef ? await dependencies.db.aiTaskActionInput.findFirst({ where: {
      scopeId: task.scopeId, taskId: ref.taskId, runId: ref.runId, id: step.inputRef,
      registrationRef: registrationRef(ref.selectionId), fingerprint: ref.inputHash, toolCode: 'rental.order.commit' } }) : null;
    if (!input || step?.requestFingerprint !== ref.inputHash || action.input.contentHash !== ref.inputHash
      || requestFingerprint(input.payload) !== ref.inputHash || requestFingerprint(review.facts.input.payload) !== ref.inputHash
      || action.target.resourceId !== selected.quoteId || requestFingerprint(selected) !== requestFingerprint(await readSelection())) throw denied();
    return { ref, review };
  };
  const orderOperation = async (value: unknown, operation: 'submit' | 'reconcile') => {
    const parsed = executionCommand.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const { command, selection } = parsed.data;
    const { ref, review } = await selectedReview(selection, { contractVersion: AI_PROPOSAL_DRAFT_VERSION,
      proposalId: command.proposalId, proposalRevision: command.proposalRevision, reviewedPayloadHash: command.reviewedPayloadHash });
    if (command.taskId !== ref.taskId || command.lease.runId !== ref.runId || command.actionId !== review.proposal.payload.actions[0].actionId) throw denied();
    return controlled[operation](command);
  };
  const reprepareOperation = async (value: unknown, operation: 'reprepare' | 'readReprepareReceipt') => {
    const parsed = z.object({ selection: z.unknown(), command: z.unknown() }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = approvalApplicationContract('AiApprovalReprepareCommandDraft', parsed.data.command);
    const { ref } = await selectedReview(parsed.data.selection, command.original);
    if (command.originalTaskId !== ref.taskId || command.replacement.taskId === ref.taskId
      || command.replacement.originalInputRef === ref.originalInputRef) throw denied();
    const replacementSelection = parseQuoteSelectionProof({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
      originalInputRef: command.replacement.originalInputRef, selectionId: command.replacement.quoteSelectionRef,
      taskId: command.replacement.taskId, runId: command.replacement.runId, inputHash: command.replacement.fingerprint });
    const receipt = await controlled.application[operation](ref.taskId, command);
    let replacement: { selection: ReturnType<typeof parseQuoteSelectionProof>;
      review: Awaited<ReturnType<typeof controlled.application.readProposal>> } | null = null;
    if (receipt.state === 'prepared') {
      await selectedReview(replacementSelection, receipt.proposal);
      const review = await controlled.application.readProposal(replacementSelection.taskId, receipt.proposal);
      replacement = { selection: replacementSelection, review };
    }
    await selectedReview(ref, command.original);
    return freezeOriginalInput({ receipt, replacement, order: 'not_created_by_reprepare' as const });
  };
  return Object.freeze({
    reprepareSelectedProposal: (value: unknown) => reprepareOperation(value, 'reprepare'),
    readSelectedReprepareReceipt: (value: unknown) => reprepareOperation(value, 'readReprepareReceipt'),
    async readSelectedProposal(value: unknown) {
      const parsed = reviewCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { ref } = await selectedReview(parsed.data.selection, parsed.data.proposal);
      return freezeOriginalInput(await controlled.application.readProposal(ref.taskId, parsed.data.proposal));
    },
    async decideSelectedProposal(value: unknown) {
      const parsed = decisionCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision, ...reference } = parsed.data.proposal;
      const { ref } = await selectedReview(parsed.data.selection, reference);
      await selections.readAuthorized(ref);
      const receipt = await controlled.application.decide(ref.taskId, { ...reference, decision });
      if (receipt.kind !== 'recorded') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return freezeOriginalInput({ approval: receipt.record, order: 'not_created_by_decision' as const });
    },
    async readSelectedDecisionReceipt(value: unknown) {
      const parsed = decisionCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision, ...reference } = parsed.data.proposal;
      const { ref } = await selectedReview(parsed.data.selection, reference);
      return freezeOriginalInput(await controlled.application.readReceipt(ref.taskId, { ...reference, decision }));
    },
    async readSelectedReprepareEligibility(value: unknown) {
      const parsed = z.object({ selection: z.unknown(), request: z.unknown() }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const request = approvalApplicationContract('AiApprovalReprepareEligibilityRequestDraft', parsed.data.request);
      const { ref } = await selectedReview(parsed.data.selection, request.original);
      return freezeOriginalInput(await controlled.application.readReprepareEligibility(ref.taskId, request));
    },
    submitSelectedOrder: (value: unknown) => orderOperation(value, 'submit'),
    reconcileSelectedOrder: (value: unknown) => orderOperation(value, 'reconcile'),
    /** Read the exact original action only. Never acquire a lease or submit an
     * order from a human request; the existing AIN-07 reconciler owns evidence. */
    async readSelectedOrderResult(value: unknown) {
      try {
        const result = await orderOperation(value, 'reconcile');
        return freezeOriginalInput({ status: 'committed' as const, replayed: result.replayed,
          order: { id: result.order.id, status: result.order.status, quoteId: result.order.quoteId },
          source: { resourceType: 'order' as const, resourceId: result.order.id },
          payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const,
          taskOutcome: 'owned_by_runner' as const });
      } catch (error) {
        if (!(error instanceof AiApprovedOrderResultUnknownError)) throw error;
        return freezeOriginalInput({ status: 'unknown' as const, errorCode: 'AI_RESULT_UNKNOWN' as const,
          retryable: false as const, nextAction: 'read_selected_order_result' as const,
          sideEffect: 'may_have_committed' as const });
      }
    },
    select: selections.select.bind(selections), read: selections.read.bind(selections),
    reconcile: selections.reconcile.bind(selections),
    /** Internal runner host only. Body and registration key derive from the
     * current persisted human choice, not a caller's proposed order body. */
    async publishSelectedInput(value: unknown) {
      const parsed = publication.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data, ref = parseQuoteSelectionProof(command.selection);
      const proof = await selections.readAuthorized(ref);
      if (command.lease.taskId !== proof.taskId || command.lease.runId !== proof.runId) throw denied();
      const input = await controlled.source.publishOrderInput({ taskId: proof.taskId,
        registrationRef: registrationRef(proof.selectionId), expectedTaskRevision: command.expectedTaskRevision,
        lease: command.lease as AiTaskRunnerLease, input: proof.body });
      await fresh(ref, proof.bindingHash);
      return freezeOriginalInput({ stage: 'original_input_published' as const, inputRef: input.id,
        replayed: input.replayed, registrationRef: registrationRef(proof.selectionId),
        inputHash: proof.inputHash, selectionId: proof.selectionId,
        approval: 'not_granted' as const, order: 'not_created' as const });
    },
    /** Server-owned runner adapter. It exposes only a re-authorized selected
     * order body to the existing order host; it never accepts a caller body
     * and does not publish, approve or submit anything by itself. */
    selectedOrderSource(value: unknown) {
      const proof = parseQuoteSelectionProof(value);
      return Object.freeze({
        taskId: proof.taskId,
        runId: proof.runId,
        read: async () => {
          const current = await selections.readAuthorized(proof);
          return structuredClone(current.body);
        }
      });
    },
    /** Caller supplies only the existing preparation command, never snapshots
     * or permission. The actual running step must point to this selected input. */
    async prepareSelectedProposal(value: unknown) {
      const parsed = preparation.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const ref = parseQuoteSelectionProof(parsed.data.selection), command = parsed.data.command;
      const proof = await selections.readAuthorized(ref);
      if (command.taskId !== proof.taskId || command.lease.runId !== proof.runId
        || Date.parse(command.expiresAt) > Date.parse(proof.expiresAt)) throw denied();
      const step = await dependencies.db.aiStep.findFirst({ where: { scopeId: proof.scopeId,
        taskId: proof.taskId, runId: proof.runId, actionId: command.actionId } });
      const original = step?.inputRef ? await dependencies.db.aiTaskActionInput.findFirst({ where: {
        scopeId: proof.scopeId, taskId: proof.taskId, runId: proof.runId, id: step.inputRef,
        registrationRef: registrationRef(proof.selectionId), fingerprint: proof.inputHash,
        toolCode: 'rental.order.commit' } }) : null;
      if (!original || step?.requestFingerprint !== proof.inputHash) throw denied();
      await fresh(ref, proof.bindingHash);
      const proposal = await controlled.prepare(command);
      await fresh(ref, proof.bindingHash);
      return freezeOriginalInput({ stage: 'pending_human_approval' as const, proposal,
        selectionId: proof.selectionId, inputHash: proof.inputHash, order: 'not_created' as const });
    }
  });
}

/** Build the existing persistent order runner from a durable human selection.
 * This is a server composition helper only: the selected proof is checked by
 * the existing selection repository, while lease/fencing, approval, budget
 * and Core execution remain owned by the existing runner host. */
export function composeSelectedQuoteTaskHost(input: SelectedQuoteTaskHostDependencies) {
  const { selection, ...task } = input.task;
  const selected = composeHumanQuoteOrder(input).selectedOrderSource(selection);
  return composeTaskOrderHost({ ...input, task, selectedOrder: selected });
}
