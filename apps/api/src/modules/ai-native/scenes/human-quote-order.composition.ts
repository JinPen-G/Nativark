import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_TASK_TERMINAL_STATUSES_DRAFT,
  AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION, AI_APPROVAL_APPLICATION_DRAFT_VERSION,
  type AiHumanQuoteOrderRepreparePreparationInputDraft, type AiHumanQuoteOrderRepreparePreparationDraft } from '@rental-os/shared';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { approvedOrderCommandSchema, orderContextHash } from '../approval-execution/prisma-approved-order.source';
import { approvalApplicationContract } from '../approval-execution/approval-application-contracts';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof, validateQuoteSelectionHttpRequest } from '../task-request/quote-selection.validation';
import { PersistedApprovedOrderPolicyAuthority } from '../approval-execution/persisted-approved-order-policy.authority';
import { PrismaTaskApplication } from '../runner/prisma-task-application';
import type { AiTaskRunnerLease } from '../runner/ai-task-runner.ports';
import { composeTaskOrderHost, type TaskOrderHostDependencies } from '../runner/order-task-host.composition';
import { taskExecutionPhaseStore } from '../runner/task-execution-phase.store';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { AiApprovedOrderResultUnknownError } from '../approval-execution/approved-order.errors';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { AiTaskRunnerError, callAiTaskRunnerDependency, snapshotAiTaskRunnerClaimLease } from '../runner/ai-task-runner.service';
import type { AiTaskRunnerClock } from '../runner/ai-task-runner.ports';

export type HumanQuoteOrderDependencies = ControlledApprovedOrderDependencies &
  Pick<HumanQuoteSelectionDependencies, 'originals'>;
export type SelectedQuoteTaskHostDependencies = HumanQuoteOrderDependencies & {
  host: TaskOrderHostDependencies['host'];
  task: Omit<TaskOrderHostDependencies['task'], 'order' | 'registrationRef'> & { selection: unknown };
  monotonic?: () => number;
  runnerClock?: AiTaskRunnerClock;
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
const decisionCommand = z.object({ selection: z.unknown(), proposal: reviewReference.extend({ decision: z.enum(['approve', 'reject']),
  reviewVersion: z.literal(AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION).optional() }) }).strict();
const executionCommand = z.object({ selection: z.unknown(), command: approvedOrderCommandSchema }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
// New effects need a current independent payer authority, which this host does
// not have. Historical selected receipts and original-order recovery stay readable.
const assertPayerSupported = (body: { bookingIdentity?: { enterpriseContractAndPayer?: boolean } }) => {
  if (body.bookingIdentity?.enterpriseContractAndPayer === true) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
};

// Publication and preparation are separate transactions; only explicit submit can create an order.
export function composeHumanQuoteOrder(dependencies: HumanQuoteOrderDependencies) {
  const selections = new PrismaQuoteSelectionRepository(dependencies);
  const controlled = composeControlledApprovedOrder(dependencies);
  const registrationRef = (selectionId: string) => `quote-selection:${selectionId}`;
  const fresh = async (reference: unknown, bindingHash: string) => {
    const current = await selections.readAuthorized(reference);
    assertPayerSupported(current.body);
    if (current.bindingHash !== bindingHash) throw denied();
    return current;
  };
  const selectedReview = async (value: unknown, reference: z.infer<typeof reviewReference>) => {
    const ref = parseQuoteSelectionProof(value);
    const readSelection = () => selections.read({ draftVersion: ref.draftVersion, originalInputRef: ref.originalInputRef, selectionId: ref.selectionId });
    const selected = await readSelection();
    if (selected.taskId !== ref.taskId || selected.runId !== ref.runId || selected.inputHash !== ref.inputHash) throw denied();
    const review = await controlled.approvals.readOriginal(ref.taskId, reference);
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
    if (operation === 'submit') assertPayerSupported((await selections.readAuthorized(ref)).body);
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
    if (operation === 'reprepare') assertPayerSupported((await selections.readAuthorized(replacementSelection)).body);
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
    /** Only locate a new already-selected normal-run wait. The original
     * reprepare transaction still owns supersession and revalidates all refs. */
    async readSelectedRepreparePreparation(value: unknown): Promise<AiHumanQuoteOrderRepreparePreparationDraft> {
      const input = validateQuoteSelectionHttpRequest('AiHumanQuoteOrderRepreparePreparationInputDraft', value) as AiHumanQuoteOrderRepreparePreparationInputDraft;
      const old = await selectedReview(input.selection, input.original);
      if (input.replacementTaskId === old.ref.taskId) throw denied();
      const policy = new PersistedApprovedOrderPolicyAuthority({ ...dependencies, toolVersion: AI_TOOL_DRAFT_VERSION });
      const identities = async () => {
        const first = await policy.authorizeRead(old.ref.taskId), second = await policy.authorizeRead(input.replacementTaskId);
        if (first.scopeId !== second.scopeId || orderContextHash(first.context) !== orderContextHash(second.context)) throw denied();
        return { scopeId: first.scopeId, identity: orderContextHash(first.context) };
      };
      const identity = await identities();
      const candidateTask = await dependencies.db.aiTask.findFirst({ where: { id: input.replacementTaskId, scopeId: identity.scopeId } });
      const candidateRun = await dependencies.db.aiRun.findFirst({ where: { taskId: input.replacementTaskId, scopeId: identity.scopeId }, orderBy: { sequence: 'desc' } });
      if (!candidateTask || candidateTask.id !== input.replacementTaskId || candidateTask.inputRef === old.ref.originalInputRef
        || candidateTask.sceneCode !== 'quote_clarification' || candidateTask.status !== 'WAITING_CONFIRMATION' || !candidateRun
        || candidateRun.scopeId !== identity.scopeId || candidateRun.taskId !== candidateTask.id) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const candidates = await dependencies.db.aiTaskQuoteSelection.findMany({ where: { scopeId: identity.scopeId,
        taskId: candidateTask.id, runId: candidateRun.id, supersededAt: null }, take: 2 });
      if (candidates.length !== 1 || candidates[0].originalRequestId !== candidateTask.inputRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const next = parseQuoteSelectionProof({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: candidateTask.inputRef,
        taskId: candidateTask.id, runId: candidateRun.id, selectionId: candidates[0].id, inputHash: candidates[0].inputHash });
      const eligible = () => controlled.application.readReprepareEligibility(old.ref.taskId,
        { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: input.original, intent: input.intent });
      const eligibility = await eligible();
      if (!eligibility.canRequestReprepare || !['rejected', 'expired', 'change_requested'].includes(eligibility.state))
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const selection = await selections.readAuthorized(next); assertPayerSupported(selection.body);
      if (selection.scopeId !== identity.scopeId || orderContextHash(selection.context) !== identity.identity) throw denied();
      const readRows = async () => {
        const key = { scopeId: identity.scopeId, taskId: next.taskId, runId: next.runId };
        const task = await dependencies.db.aiTask.findFirst({ where: { id: next.taskId, scopeId: key.scopeId } });
        const steps = await dependencies.db.aiStep.findMany({ where: { ...key, toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }, take: 2 });
        const step = steps[0];
        if (!task || task.id !== next.taskId || task.scopeId !== key.scopeId || task.inputRef !== next.originalInputRef || task.inputHash !== selection.originalInputHash
          || task.status !== 'WAITING_CONFIRMATION' || task.cancelRequestedAt !== null || steps.length !== 1 || !step
          || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
          || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE' || step.resultRef !== null || !step.inputRef
          || step.requestFingerprint !== next.inputHash) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const input = await dependencies.db.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
        const plan = await dependencies.db.aiTaskRunPlan.findFirst({ where: key });
        if (!input || input.scopeId !== key.scopeId || input.taskId !== key.taskId || input.runId !== key.runId || input.id !== step.inputRef
          || input.fingerprint !== next.inputHash || requestFingerprint(input.payload) !== next.inputHash
          || input.registrationRef !== registrationRef(next.selectionId) || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion
          || !plan || plan.scopeId !== key.scopeId || plan.taskId !== key.taskId || plan.runId !== key.runId
          || requestFingerprint(plan.payload) !== plan.planHash) throw denied();
        return { task, step, input, plan };
      };
      const rows = await readRows();
      const wait = await PrismaTaskApplication.readConfirmation({ db: dependencies.db, tasks: controlled.tasks, clock: dependencies.runnerClock },
        { taskId: next.taskId, runId: next.runId, stepId: rows.step.id });
      const newEligibility = await controlled.application.readReprepareEligibility(next.taskId,
        { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: wait.proposal, intent: 'inspect' });
      if (newEligibility.state !== 'pending') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      await selectedReview(next, wait.proposal);
      const originalReview = await controlled.application.readProposal(old.ref.taskId, input.original);
      const replacementReview = await controlled.application.readProposal(next.taskId, wait.proposal);
      const closingNewEligibility = await controlled.application.readReprepareEligibility(next.taskId,
        { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: wait.proposal, intent: 'inspect' });
      const latest = await selections.readAuthorized(next);
      if (closingNewEligibility.state !== 'pending' || latest.bindingHash !== selection.bindingHash
        || requestFingerprint(await readRows()) !== requestFingerprint(rows) || requestFingerprint(await eligible()) !== requestFingerprint(eligibility)
        || requestFingerprint(await identities()) !== requestFingerprint(identity)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const reason = eligibility.state === 'rejected' ? 'rejected' : eligibility.state === 'expired' ? 'expired' : 'change_plan';
      return freezeOriginalInput({ selection: old.ref, replacement: next,
        command: { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, operationKey: input.operationKey, originalTaskId: old.ref.taskId,
          original: input.original, reason, replacement: { taskId: next.taskId, runId: next.runId, stepId: rows.step.id, actionId: rows.step.actionId,
            inputRef: rows.input.id, fingerprint: next.inputHash, originalInputRef: next.originalInputRef, quoteSelectionRef: next.selectionId,
            planHash: rows.plan.planHash } }, originalReview, replacementReview,
        state: 'read_only' as const, supersession: 'not_attempted' as const, approval: 'not_granted' as const, order: 'not_created' as const });
    },
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
      const { decision, reviewVersion, ...reference } = parsed.data.proposal;
      const { ref } = await selectedReview(parsed.data.selection, reference);
      const selected = await selections.readAuthorized(ref);
      if (decision === 'approve') assertPayerSupported(selected.body);
      const receipt = await controlled.application.decide(ref.taskId, { ...reference, decision, ...(reviewVersion ? { reviewVersion } : {}) });
      if (receipt.kind !== 'recorded') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return freezeOriginalInput({ approval: receipt.record, order: 'not_created_by_decision' as const });
    },
    async readSelectedDecisionReceipt(value: unknown) {
      const parsed = decisionCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const { decision, reviewVersion, ...reference } = parsed.data.proposal;
      const { ref } = await selectedReview(parsed.data.selection, reference);
      return freezeOriginalInput(await controlled.application.readReceipt(ref.taskId, { ...reference, decision, ...(reviewVersion ? { reviewVersion } : {}) }));
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
      assertPayerSupported(proof.body);
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
          assertPayerSupported(current.body);
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
  const proof = parseQuoteSelectionProof(selection);
  if (task.taskId !== proof.taskId || task.runId !== proof.runId) throw denied();
  const selected = composeHumanQuoteOrder(input).selectedOrderSource(proof);
  return composeTaskOrderHost({ ...input, task: { ...task, registrationRef: `quote-selection:${proof.selectionId}` }, selectedOrder: selected });
}

export type SelectedQuoteTaskConfiguration = {
  host: TaskOrderHostDependencies['host'];
  limits: TaskOrderHostDependencies['task']['limits'];
  monotonic?: () => number;
  runnerClock?: AiTaskRunnerClock;
};
const selectedTaskRequest = z.object({ selection: z.unknown() }).strict();
const selectedTaskWait = selectedTaskRequest.extend({ stepId: z.string().uuid() });
const selectedTaskContinue = selectedTaskRequest.extend({ checkpointRef: z.string().uuid() });
const selectedTaskCancel = selectedTaskRequest.extend({ expectedRevision: revision });

export function composeSelectedQuoteTaskApplication(dependencies: HumanQuoteOrderDependencies, configuration: SelectedQuoteTaskConfiguration) {
  const host = z.object({ holderId: id, leaseMs: z.number().int().min(1).max(120000) }).strict().parse(structuredClone(configuration.host));
  const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(configuration.limits));
  const selections = new PrismaQuoteSelectionRepository(dependencies), orders = composeHumanQuoteOrder(dependencies);
  const observe = <T>(operation: () => Promise<T>, signal?: AbortSignal, afterMutation = false) =>
    waitForTaskApplicationDependency(operation, afterMutation, signal, configuration.runnerClock);
  const resolve = async (selection: unknown, active: boolean, requirePlan: boolean) => {
    const proof = parseQuoteSelectionProof(selection);
    const read = () => selections.read({ draftVersion: proof.draftVersion, originalInputRef: proof.originalInputRef, selectionId: proof.selectionId });
    const selected = await read();
    if (selected.taskId !== proof.taskId || selected.runId !== proof.runId || selected.inputHash !== proof.inputHash) throw denied();
    if (active) assertPayerSupported((await selections.readAuthorized(proof)).body);
    const root = composeSelectedQuoteTaskHost({ ...dependencies, host, monotonic: configuration.monotonic, runnerClock: configuration.runnerClock,
      task: { taskId: proof.taskId, runId: proof.runId, selection: proof, limits } });
    const before = await root.authorization.tasks.resolveAccess(proof.taskId, 'read_metadata');
    const task = await dependencies.db.aiTask.findFirst({ where: before.where });
    if (!task || task.id !== proof.taskId || task.inputRef !== proof.originalInputRef) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id, runId: proof.runId };
    const saved = await dependencies.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (requirePlan && !saved) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (saved) {
      const plan = aiTaskRunPlanSchema.parse(saved.payload), registrationRef = `quote-selection:${proof.selectionId}`;
      if (saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
        || plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash
        || plan.steps.length !== 1 || plan.steps[0].registrationRef !== registrationRef
        || plan.steps[0].toolCode !== 'rental.order.commit' || plan.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || plan.steps[0].operation !== 'idempotent') throw denied();
      const input = await dependencies.db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef, toolCode: 'rental.order.commit' } });
      if (!input || input.fingerprint !== proof.inputHash || requestFingerprint(input.payload) !== proof.inputHash) throw denied();
    }
    const verify = async () => {
      const after = await root.authorization.tasks.resolveAccess(proof.taskId, 'read_metadata');
      if (after.bindingKey !== before.bindingKey || requestFingerprint(await read()) !== requestFingerprint(selected)) throw denied();
    };
    await verify();
    return { proof, root, key, verify, planHash: saved?.planHash, taskStatus: task.status };
  };
  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return parsed.data;
  };
  const recover = async (value: unknown, continuing: boolean, signal?: AbortSignal) => {
    const command = continuing ? parse(selectedTaskContinue, value) : parse(selectedTaskRequest, value);
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    const resolved = await observe(() => resolve(command.selection, continuing, true), signal), { root, proof, key } = resolved;
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    if (!continuing) {
      const snapshot = await root.application.inspect({ taskId: proof.taskId, runId: proof.runId });
      if (AI_TASK_TERMINAL_STATUSES_DRAFT.includes(snapshot.task.status)) {
        // Finished aggregates confer no execution lease. Reuse the existing
        // original Core/approval-consumption reader, including its unknown and
        // not-observed semantics; never infer an order from task success alone.
        const result = await readResult(command);
        const latest = await root.application.inspect({ taskId: proof.taskId, runId: proof.runId });
        await observe(resolved.verify, signal);
        if (requestFingerprint(snapshot) !== requestFingerprint(latest)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return result;
      }
    }
    if ('checkpointRef' in command) {
      const step = await observe(() => dependencies.db.aiStep.findFirst({ where: { ...key, toolCode: 'rental.order.commit' } }), signal);
      if (!step) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const waiting = await root.application.readConfirmation({ taskId: proof.taskId, runId: proof.runId, stepId: step.id });
      if (waiting.checkpointRef !== command.checkpointRef) throw denied();
      const review = await observe(() => orders.readSelectedProposal({ selection: proof, proposal: waiting.proposal }), signal);
      const receipt = await observe(() => orders.readSelectedDecisionReceipt({ selection: proof, proposal: { ...waiting.proposal,
        decision: review.proposal.status === 'cancelled' ? 'reject' : 'approve' } }), signal);
      if (receipt.kind !== 'recorded') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const access = await observe(() => root.authorization.tasks.resolveAccess(proof.taskId, 'claim_recovery_run'), signal);
    const task = await observe(() => dependencies.db.aiTask.findFirst({ where: access.where }), signal);
    const run = await observe(() => dependencies.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } }), signal);
    if (!task || !run || run.actorKind !== access.actorKind || run.actorId !== access.actorId) throw denied();
    await observe(resolved.verify, signal);
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    const claim = { taskId: proof.taskId, runId: proof.runId, ...host,
      expectedTaskRevision: task.revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
    const received = await observe(() => root.authorization.tasks.claimRecoveryRun(structuredClone(claim)), signal, true).catch(error => {
      // The CAS may already be durable. A failed response cannot authorize a
      // holder lookup, another claim, release, dispatch or resource refund.
      if (error instanceof AiTaskRepositoryError && error.code === 'AI_STORAGE_UNAVAILABLE') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      throw error;
    });
    let lease: AiTaskRunnerLease & { purpose: 'recovery_only' };
    try {
      const acknowledged = structuredClone(received);
      if (acknowledged?.purpose !== 'recovery_only') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      lease = { ...snapshotAiTaskRunnerClaimLease(claim, acknowledged), purpose: acknowledged.purpose };
    } catch {
      // Cleanup is reachable only after the original positive ACK is verified.
      // A stored held lease must never repair a missing or mismatched ACK.
      throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }
    let cleanupSafe = true, failed = false;
    try {
      await observe(resolved.verify, signal);
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      // After delegation, an unchanged lease is not proof that the runner's
      // in-flight confirmation/Core write cannot commit. Only it owns cleanup.
      cleanupSafe = false;
      const result = 'checkpointRef' in command
        ? await root.application.continueConfirmation({ taskId: proof.taskId, runId: proof.runId, checkpointRef: command.checkpointRef }, signal)
        : { kind: 'run_outcome' as const, outcome: await root.runner.recover(lease, signal) };
      cleanupSafe = result.kind === 'not_started';
      await observe(resolved.verify, undefined, true);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (cleanupSafe) {
        try {
          await callAiTaskRunnerDependency(async child => {
            const held = await dependencies.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
              leaseOwnerId: host.holderId, fencingToken: lease.fencingToken, revision: lease.revision } });
            if (child.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            if (held) {
              const current = await root.authorization.tasks.readMetadata(proof.taskId);
              if (child.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
              await root.authorization.tasks.releaseRun({ taskId: proof.taskId, runId: proof.runId, holderId: host.holderId,
                expectedTaskRevision: current.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
            }
          }, 5000, 'selected_order_cleanup', undefined, configuration.runnerClock);
        } catch {
          if (!failed) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        }
      }
    }
  };
  const readResult = async (value: unknown) => {
      const command = parse(selectedTaskRequest, value), { proof, key, verify, planHash } = await observe(() => resolve(command.selection, false, true));
      const reference = await observe(() => dependencies.db.$transaction(async tx => {
        const steps = await tx.aiStep.findMany({ where: { ...key, toolCode: 'rental.order.commit' }, take: 2 });
        if (steps.length !== 1 || !steps[0].inputRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const step = steps[0], phaseKey = { ...key, stepId: step.id };
        const input = await tx.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef!,
          registrationRef: `quote-selection:${proof.selectionId}`, toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION } });
        if (Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
          || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.requestFingerprint !== proof.inputHash
          || !input || input.fingerprint !== proof.inputHash || requestFingerprint(input.payload) !== proof.inputHash) throw denied();
        const phases = taskExecutionPhaseStore(tx), starts = await phases.readStarts(phaseKey);
        for (const [index, start] of starts.entries()) {
          if (start.sequence !== index + 1 || Object.entries(phaseKey).some(([k, v]) => start[k as keyof typeof start] !== v)
            || start.inputRef !== step.inputRef || start.actionId !== step.actionId || start.stepFingerprint !== proof.inputHash
            || start.planHash !== planHash || start.originalArtifactId !== starts[0].originalArtifactId) throw denied();
        }
        const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: step.actionId } });
        if (consumption && (consumption.scopeId !== key.scopeId || consumption.taskId !== key.taskId || consumption.actionId !== step.actionId
          || consumption.actionFingerprint !== proof.inputHash)) throw denied();
        if (!consumption || consumption.status !== 'COMMITTED') {
          // A missing receipt is not proof that the original Core operation
          // never happened. Preserve persisted execution uncertainty; an
          // initial confirmation wait alone still attests no submission.
          return step.status === 'UNKNOWN' || step.effect === 'COMMITTED'
            ? 'unresolved_execution' as const : null;
        }
        const executed = starts[starts.length - 1];
        if (!executed || !consumption.resultRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const approval = await tx.aiApproval.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
          id: consumption.approvalId, proposalId: consumption.proposalId, proposalRevision: consumption.proposalRevision } });
        if (!approval || approval.decision !== 'APPROVED') throw denied();
        if (executed.sequence === 2) {
          const previous = await phases.readReceipt({ ...phaseKey, id: executed.previousReceiptId! });
          if (executed.decisionRef !== approval.id || !previous || previous.phaseId !== starts[0].id || previous.kind !== 'confirmation'
            || requestFingerprint(previous.payload) !== previous.contentHash || previous.proposalId !== consumption.proposalId
            || previous.proposalRevision !== consumption.proposalRevision || previous.reviewedPayloadHash !== approval.payloadHash) throw denied();
        }
        // Core can commit before the phase receipt is saved; the phase start still binds the original invocation.
        return approvedOrderCommandSchema.parse({ taskId: key.taskId, proposalId: consumption.proposalId,
          proposalRevision: consumption.proposalRevision, reviewedPayloadHash: approval.payloadHash, approvalId: consumption.approvalId,
          actionId: step.actionId, lease: { runId: key.runId, holderId: executed.leaseOwnerId, revision: executed.runRevision,
            fencingToken: executed.fencingToken } });
      }, { isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 }));
      await observe(verify);
      if (reference === 'unresolved_execution') return freezeOriginalInput({ status: 'unknown' as const,
        errorCode: 'AI_RESULT_UNKNOWN' as const, retryable: false as const,
        nextAction: 'read_selected_order_result' as const, sideEffect: 'may_have_committed' as const });
      if (!reference) return freezeOriginalInput({ status: 'not_observed' as const, retryable: false as const,
        nextAction: 'read_selected_order_result' as const, sideEffect: 'not_attested' as const,
        taskOutcome: 'owned_by_runner' as const, payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const });
      const result = await observe(() => orders.readSelectedOrderResult({ selection: proof, command: reference }));
      await observe(verify);
      return result;
  };
  const cancellationReceipt = async (value: unknown, mode: 'settle_unstarted' | 'read_request' | 'read_settlement') => {
    const command = parse(selectedTaskCancel, value);
    // Cleanup locates the retained human selection, not today's executable
    // quote or plan. The original repository alone proves unstarted work.
    const { proof, root, verify } = await observe(() => resolve(command.selection, false, false));
    const reference = { taskId: proof.taskId, expectedRevision: command.expectedRevision };
    const mutating = mode === 'settle_unstarted';
    if (mutating) {
      await observe(() => root.authorization.tasks.resolveAccess(proof.taskId, 'transition_task'));
      await observe(verify);
    }
    let receipt;
    try {
      receipt = mode === 'settle_unstarted'
        ? await observe(() => root.taskTransitions.settleUnstartedCancellation({ ...reference,
            to: 'cancelled', reason: 'cancel_settled' }, proof.runId), undefined, true)
        : mode === 'read_request'
          ? await observe(() => root.taskTransitions.readCancellationReceipt(reference))
          : await observe(() => root.taskTransitions.readCancellationSettlementReceipt(reference));
    } catch (error) {
      if (mutating && error instanceof AiTaskRepositoryError && error.code === 'AI_STORAGE_UNAVAILABLE')
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      throw error;
    }
    if (mutating) {
      try { await observe(verify); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    } else await observe(verify);
    return freezeOriginalInput({ receipt, cancellation: 'not_business_rollback' as const,
      automaticRetry: false as const, execution: 'no_lease_claim_or_business_dispatch' as const });
  };
  return Object.freeze({
    // Server-only consumers of the existing cancellation command/receipts.
    // This composition registers no public transport or new cancellation grant.
    settleUnstartedCancellation: (value: unknown) => cancellationReceipt(value, 'settle_unstarted'),
    readCancellation: (value: unknown) => cancellationReceipt(value, 'read_request'),
    readCancellationSettlement: (value: unknown) => cancellationReceipt(value, 'read_settlement'),
    async start(value: unknown, signal?: AbortSignal) {
      const command = parse(selectedTaskRequest, value);
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      const { proof, root, verify } = await observe(() => resolve(command.selection, true, false), signal);
      const result = await root.application.start({ taskId: proof.taskId, runId: proof.runId }, signal);
      await observe(verify, undefined, true);
      return result;
    },
    async readConfirmation(value: unknown) {
      const command = parse(selectedTaskWait, value), { proof, root, verify, taskStatus } = await observe(() => resolve(command.selection, false, true));
      const original = { taskId: proof.taskId, runId: proof.runId, stepId: command.stepId };
      if (taskStatus !== 'WAITING_CONFIRMATION') {
        const history = await root.application.readConfirmationHistory(original);
        if (history.task.status === 'waiting_confirmation') throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await observe(verify);
        return freezeOriginalInput({ state: 'not_waiting' as const, history,
          execution: 'not_attested' as const, continuation: 'not_invoked' as const });
      }
      const waiting = await root.application.readConfirmation(original);
      await observe(() => orders.readSelectedProposal({ selection: proof, proposal: waiting.proposal }));
      await observe(verify);
      return waiting;
    },
    continueConfirmation: (value: unknown, signal?: AbortSignal) => recover(value, true, signal),
    reconcile: (value: unknown, signal?: AbortSignal) => recover(value, false, signal),
    readResult,
    async requestCancel(value: unknown) {
      const command = parse(selectedTaskCancel, value), { proof, root, verify } = await observe(() => resolve(command.selection, false, false));
      const receipt = await observe(() => root.taskTransitions.transition({ taskId: proof.taskId, expectedRevision: command.expectedRevision,
        to: 'cancel_requested', reason: 'cancel_requested' }), undefined, true);
      await observe(verify, undefined, true);
      return { receipt, cancellation: 'requested_not_rollback' as const };
    }
  });
}
