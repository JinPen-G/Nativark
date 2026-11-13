/** Locate a retained model result behind one original quote-selection wait.
 * Selection, answer, checkpoint and proposal readers supply the proof; a latest
 * model search cannot. This leaf reads only and never grants approval or retry. */
import type { AiRun, AiStep, AiTask, AiTaskActionInput } from '@prisma/client';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import type { AiOriginalSceneDependencies, composeAiOriginalScenes } from './scenes/original-scenes.composition';
import type { WorkbenchModelControlOrigin } from './workbench-model-control.contract';
import type { AiTaskRunnerPlan } from './runner/ai-task-runner.ports';
import { PrismaTaskApplication } from './runner/prisma-task-application';
import { taskExecutionPhaseStore } from './runner/task-execution-phase.store';
import { PrismaTaskInputRepository } from './task-input/prisma-task-input.repository';
import { PrismaQuoteSelectionRepository } from './task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof, validateQuoteSelectionResponse } from './task-request/quote-selection.validation';
import { originalIdentityHash } from './task-request/original-request.authority';
import { resolveTaskCenterBusinessTarget, readTaskCenterOrderSelection } from './task-center-business.reader';
import { composeApprovedOrderHumanApproval } from './approval-execution/approved-order-human.composition';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);
type Scenes = Pick<ReturnType<typeof composeAiOriginalScenes>, 'requests' | 'tools'>;
type Waiting = { task: AiTask; run: AiRun; steps: readonly AiStep[]; inputs: readonly AiTaskActionInput[];
  plan: AiTaskRunnerPlan; planHash: string; originRunId: string; lineage: WorkbenchModelControlOrigin };

export async function readConversationQuoteWaitingResult(input: AiOriginalSceneDependencies, scenes: Scenes,
  tasks: Pick<AiTaskRepository, 'resolveAccess'>, waiting: Waiting) {
  const { task, run, plan, lineage } = waiting, dependencies = input.historySelection, clock = input.clock ?? (() => new Date());
  if (!dependencies) throw unavailable();
  if (task.sceneCode !== 'quote_clarification' || task.status !== 'WAITING_CONFIRMATION' || task.cancelRequestedAt !== null
    || !task.inputRef || run.status !== 'RUNNING' || run.sequence < 2 || run.resourceOriginRunId !== waiting.originRunId
    || !run.inputReceiptId || !lineage.continuation || lineage.control || !lineage.history.length
    || waiting.steps.length !== 1 || waiting.inputs.length !== 1 || plan.steps.length !== 1) throw denied();
  const step = waiting.steps[0], frozen = waiting.inputs[0], planned = plan.steps[0];
  const query = { taskId: task.id, runId: run.id, stepId: step.id };
  const target = await resolveTaskCenterBusinessTarget({ db: input.db }, tasks, query);
  const selected = await readTaskCenterOrderSelection(input.db, target), proof = parseQuoteSelectionProof(selected.selection);
  if (target.task.revision !== task.revision || target.task.status !== task.status
    || target.access.actorId !== task.ownerId || planned.registrationRef !== `quote-selection:${proof.selectionId}`
    || planned.toolCode !== 'rental.order.commit' || planned.toolVersion !== AI_TOOL_DRAFT_VERSION || planned.operation !== 'idempotent'
    || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE' || step.sequence !== 1 || step.errorCode !== null
    || step.actionId !== aiStepActionId(target.access.scope, task.id, planned.registrationRef)
    || step.toolCode !== planned.toolCode || step.toolVersion !== planned.toolVersion || step.inputRef !== frozen.id
    || frozen.scopeId !== task.scopeId || frozen.taskId !== task.id || frozen.runId !== run.id
    || frozen.registrationRef !== planned.registrationRef || frozen.toolCode !== planned.toolCode || frozen.toolVersion !== planned.toolVersion
    || frozen.fingerprint !== step.requestFingerprint || frozen.fingerprint !== proof.inputHash
    || requestFingerprint(frozen.payload) !== frozen.fingerprint) throw denied();

  const original = await scenes.requests.readHistorical({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef });
  if (original.receipt.state === 'revoked' || original.receipt.contentHash !== task.inputHash
    || original.receipt.revision !== task.inputRevision || original.receipt.sceneCode !== task.sceneCode
    || original.receipt.sceneVersion !== task.sceneVersion) throw denied();
  const selections = new PrismaQuoteSelectionRepository({ ...input, ...dependencies, originals: scenes.requests });
  const selection = validateQuoteSelectionResponse('AiQuoteSelectionReceiptDraft', await selections.read({
    draftVersion: proof.draftVersion, originalInputRef: proof.originalInputRef, selectionId: proof.selectionId }));
  if (selection.state !== 'selected_not_approved' || selection.taskId !== task.id || selection.runId !== run.id
    || selection.originalInputRef !== task.inputRef || selection.selectionId !== proof.selectionId
    || selection.inputHash !== frozen.fingerprint || selection.quoteId !== selected.quoteId) throw denied();

  // The consumed question names the display parent exactly, including its
  // result/input. Neither a newer model nor another selected quote can replace it.
  const key = { scopeId: task.scopeId, taskId: task.id };
  const answer = await input.db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { ...key, id: run.inputReceiptId } } });
  const question = answer && await input.db.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { ...key, id: answer.requestId } } });
  if (!answer || !question || question.status !== 'CONSUMED' || answer.id !== lineage.continuation.receiptId
    || answer.id !== lineage.history.at(-1)?.receiptId || question.inputHash !== lineage.continuation.inputHash
    || !same(answer.answers, lineage.continuation.answers)) throw denied();
  const receipt = await PrismaTaskInputRepository.receiptReader(input.db, tasks, clock).readSubmissionReference({
    taskId: task.id, requestId: question.id, expectedRevision: question.revision - 1, submissionKey: answer.submissionKey });
  if (receipt.state !== 'observed' || receipt.receiptId !== answer.id || receipt.runId !== run.id) throw denied();
  const displayRun = await input.db.aiRun.findFirst({ where: { ...key, id: question.runId } });
  if (!displayRun || displayRun.scopeId !== task.scopeId || displayRun.taskId !== task.id || displayRun.status !== 'SUCCEEDED'
    || displayRun.actorKind !== run.actorKind || displayRun.actorId !== run.actorId
    || displayRun.sequence + 1 !== run.sequence) throw denied();

  const wait = await PrismaTaskApplication.readConfirmation({ db: input.db, tasks }, query);
  const approvals = composeApprovedOrderHumanApproval({ ...input, ...dependencies,
    scene: { code: task.sceneCode, version: task.sceneVersion } });
  const review = await approvals.readProposal(task.id, wait.proposal), proposal = review.proposal, action = proposal.payload.actions[0];
  if (wait.taskRevision !== task.revision || proposal.status !== 'pending_confirmation'
    || proposal.payload.actions.length !== 1 || action.actionId !== step.actionId || action.input.contentHash !== frozen.fingerprint
    || action.preview.contentHash !== selection.quoteHash || action.target.resourceId !== selection.quoteId
    || Date.parse(proposal.payload.expiresAt) <= clock().getTime() || Date.parse(review.deterministic.quoteExpiresAt) <= clock().getTime()) throw denied();
  const quote = await scenes.tools.quote.recoverOriginal(`scene-answer:${task.inputRef}:${answer.id}`, originalIdentityHash(original.context));
  if (quote.status !== 'quoted' || quote.quotePersistence !== 'saved' || !quote.quote
    || quote.quote.id !== selection.quoteId || !same(quote.scope, original.context.scope)
    || quote.quote.pricingPlanVersion !== action.target.version || quote.quote.currency !== review.deterministic.currency
    || quote.quote.expiresAt !== review.deterministic.quoteExpiresAt
    || Object.entries(review.deterministic.quoteAmounts).some(([field, amount]) => quote.quote![field as keyof typeof quote.quote] !== amount)) throw denied();

  // Only the first, unchanged wait is admissible. An attempted second phase or
  // uncertain business charge must not be disguised as a pending confirmation.
  const phaseHash = await input.db.$transaction(async tx => {
    const scope = { ...key, runId: run.id, stepId: step.id }, store = taskExecutionPhaseStore(tx);
    const starts = await store.readStarts(scope), receipts = await store.readReceipts(scope);
    const phase = starts[0], checkpoint = receipts[0];
    if (starts.length !== 1 || receipts.length !== 1 || !phase || !checkpoint || phase.sequence !== 1
      || phase.actionId !== step.actionId || phase.inputRef !== frozen.id || phase.stepFingerprint !== frozen.fingerprint
      || phase.planHash !== waiting.planHash || checkpoint.id !== wait.checkpointRef || checkpoint.phaseId !== phase.id
      || checkpoint.kind !== 'confirmation' || checkpoint.proposalId !== wait.proposal.proposalId
      || checkpoint.reviewedPayloadHash !== wait.proposal.reviewedPayloadHash) throw denied();
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: scope, take: 4 });
    const expected = { STEPS: phase.stepsChargeId, ACTIVE_MS: phase.activeMsChargeId, OUTPUT_BYTES: phase.outputBytesChargeId };
    if (charges.length !== 3 || new Set(charges.map(row => row.resource)).size !== 3
      || charges.some(row => !(row.resource in expected) || expected[row.resource as keyof typeof expected] !== row.chargeId
        || row.scopeId !== task.scopeId || row.taskId !== task.id || row.runId !== run.id || row.stepId !== step.id
        || row.actionId !== step.actionId || row.stepFingerprint !== frozen.fingerprint || row.status !== 'RESERVED'
        || row.gatewayInvocationId !== null || row.actualAmount !== null || row.outcomeFingerprint !== null || row.evidenceRef !== null
        || row.leaseOwnerId !== phase.leaseOwnerId || row.fencingToken.toFixed(0) !== phase.fencingToken)) throw denied();
    return requestFingerprint({ phase, checkpoint: { ...checkpoint, activeMs: checkpoint.activeMs.toString(), outputBytes: checkpoint.outputBytes.toString() },
      charges: charges.map(row => ({ id: row.chargeId, fingerprint: row.requestFingerprint, resource: row.resource,
        amount: row.amount.toString(), status: row.status, revision: row.revision })).sort((a, b) => a.id.localeCompare(b.id)) });
  }, { isolationLevel: 'RepeatableRead' });
  await selected.verify();
  if ((await tasks.resolveAccess(task.id, 'read_step_terminal')).bindingKey !== target.access.bindingKey) throw denied();
  return { run: displayRun, stepId: question.stepId, inputId: question.inputRef, resultId: question.basisResultRef,
    proofHash: requestFingerprint({ version: 'conversation-quote-wait-display-1', selection, receipt,
      execution: { planHash: waiting.planHash, stepId: step.id, stepRevision: step.revision, status: step.status,
        effect: step.effect, resultRef: step.resultRef, inputId: frozen.id, inputHash: frozen.fingerprint,
        policyRevision: frozen.policyRevision, expiresAt: frozen.expiresAt.toISOString() },
      question: { id: question.id, revision: question.revision, requestHash: question.requestHash, runId: question.runId,
        inputId: question.inputRef, inputHash: question.inputHash, resultId: question.basisResultRef },
      answerHash: answer.answerHash, wait, review, quote: quote.quote, phaseHash }) };
}
