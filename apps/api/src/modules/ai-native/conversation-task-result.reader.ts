/** Current conversation result selection, including receipt-proven successors.
 * The admission Run stays immutable. Reads use original Task/plan/answer/control
 * evidence and the TaskCenter result port; no host, lease or model is started. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, validateAiConversationTaskResultDraft,
  type AiConversationTaskResultDraft, type AiConversationTurnReferenceDraft } from '@rental-os/shared';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { AiConversationRepository } from './conversation.repository';
import { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import { composePersistedTaskAuthorization } from './task-authorization.composition';
import { AiTaskRepositoryError } from './ai-task.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import { aiTaskRunPlanSchema } from './runner/prisma-task-run-evidence.repository';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { WorkbenchModelControlOrigin } from './workbench-model-control.contract';
import { readConversationQuoteWaitingResult } from './conversation-quote-result.reader';

export interface ConversationTaskResultPorts {
  result(value: { taskId: string; resultId: string }): Promise<unknown>;
  lineage(value: { taskId: string; runId: string; originRunId: string }): Promise<unknown>;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);

export async function readConversationTaskResult(input: AiOriginalSceneDependencies,
  reference: AiConversationTurnReferenceDraft, ports: ConversationTaskResultPorts): Promise<AiConversationTaskResultDraft> {
  const scenes = composeAiOriginalScenes(input), conversations = new AiConversationRepository(input, scenes.requests);
  const authorization = composePersistedTaskAuthorization(input), first = await conversations.readAdmission(reference), turn = first.result;
  if (!turn) throw unavailable();
  const base = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: reference.conversationId,
    admissionKey: reference.admissionKey, turn, execution: 'read_only_no_start_no_dispatch' as const };
  const finish = async (value: AiConversationTaskResultDraft) => {
    if (!same(first, await conversations.readAdmission(reference))) throw changed();
    if (!validateAiConversationTaskResultDraft(value, reference, turn)) throw unavailable();
    return structuredClone(value);
  };
  if (turn.material === 'erased') return finish({ ...base, status: 'material_erased', result: null, lineage: null });
  if (!turn.task) return finish({ ...base, status: 'no_task_observed', result: null, lineage: null });
  const original = turn.task;
  const locate = async () => {
    const access = await authorization.tasks.resolveAccess(original.taskId, 'read_step_terminal');
    const task = await input.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== original.taskId || task.audience !== 'OPERATOR' || task.ownerKind !== 'USER'
      || task.ownerId !== access.actorId || task.archivedAt !== null || task.sceneCode !== turn.capabilityCode
      || task.sceneVersion !== turn.capabilityVersion || task.inputRef !== turn.original.inputRef) throw denied();
    const provenance = await readOriginalTaskModelProvenance(input.db, task);
    if (provenance.inputRef !== turn.original.inputRef) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id };
    const runs = await input.db.aiRun.findMany({ where: key, orderBy: { sequence: 'desc' }, take: 2 });
    let run = runs[0];
    if (!run || run.scopeId !== key.scopeId || run.taskId !== task.id || run.actorKind !== access.actorKind
      || run.actorId !== access.actorId || runs[1]?.sequence === run.sequence || !Number.isSafeInteger(run.sequence)
      || run.sequence < 1 || run.sequence > 4294967294) throw denied();
    let lineage: WorkbenchModelControlOrigin | null = null;
    if (run.id === original.runId) {
      if (run.sequence !== 1 || run.inputReceiptId !== null || run.resourceOriginRunId !== null) throw denied();
    } else {
      if (run.sequence < 2 || run.resourceOriginRunId !== original.runId) throw denied();
      lineage = await ports.lineage({ taskId: task.id, runId: run.id, originRunId: original.runId }) as WorkbenchModelControlOrigin;
      if (!lineage || typeof lineage.registrationRef !== 'string') throw denied();
      if (lineage.control ? lineage.control.operationLogId !== run.id
          || lineage.control.resourceOriginRunId !== original.runId || lineage.control.presentationRevision !== run.sequence
          : !lineage.continuation || !lineage.history.length) throw denied();
    }
    const executionRun = run, runKey = { ...key, runId: run.id };
    let [steps, inputs, stored] = await Promise.all([
      input.db.aiStep.findMany({ where: runKey, orderBy: { sequence: 'asc' }, take: 4 }),
      input.db.aiTaskActionInput.findMany({ where: runKey, take: 4 }),
      input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: runKey } }),
    ]);
    if (steps.length > 3 || inputs.length > 3) throw unavailable();
    let plan = stored ? aiTaskRunPlanSchema.parse(stored.payload) : null;
    if (stored && (!plan || stored.scopeId !== key.scopeId || stored.taskId !== task.id || stored.runId !== run.id
      || plan.taskId !== task.id || plan.runId !== run.id || plan.taskRevision > task.revision
      || stored.planHash !== requestFingerprint(plan))) throw denied();
    let quoteWait: Awaited<ReturnType<typeof readConversationQuoteWaitingResult>> | undefined;
    if (task.sceneCode === 'quote_clarification' && task.status === 'WAITING_CONFIRMATION') {
      if (!plan || !stored || !lineage) throw denied();
      quoteWait = await readConversationQuoteWaitingResult(input, scenes, authorization.tasks,
        { task, run, steps, inputs, plan, planHash: stored.planHash, originRunId: original.runId, lineage });
      run = quoteWait.run;
      lineage = run.id === original.runId ? null
        : await ports.lineage({ taskId: task.id, runId: run.id, originRunId: original.runId }) as WorkbenchModelControlOrigin;
      if (lineage && (!lineage.continuation || lineage.control || !lineage.history.length)) throw denied();
      const displayKey = { ...key, runId: run.id };
      [steps, inputs, stored] = await Promise.all([
        input.db.aiStep.findMany({ where: displayKey, orderBy: { sequence: 'asc' }, take: 2 }),
        input.db.aiTaskActionInput.findMany({ where: displayKey, take: 2 }),
        input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: displayKey } }),
      ]);
      plan = stored ? aiTaskRunPlanSchema.parse(stored.payload) : null;
      if (!stored || !plan || stored.scopeId !== task.scopeId || stored.taskId !== task.id || stored.runId !== run.id
        || plan.taskId !== task.id || plan.runId !== run.id || plan.taskRevision > task.revision
        || stored.planHash !== requestFingerprint(plan) || steps.length !== 1 || inputs.length !== 1) throw denied();
    }
    let resultId: string | null = null;
    if (plan) {
      if (steps.length > plan.steps.length || inputs.length > plan.steps.length
        || new Set(inputs.map(row => row.registrationRef)).size !== inputs.length
        || inputs.some(row => !plan.steps.some(planned => planned.registrationRef === row.registrationRef))) throw denied();
      const orderChain = plan.steps.length === 3 && run.id === original.runId && task.sceneCode === 'order_explanation';
      const registrationRef = orderChain ? `scene-answer:${task.inputRef}` : lineage?.registrationRef ?? `scene-model:${task.inputRef}`;
      if (orderChain) {
        const expected = [`scene-model:${task.inputRef}`, `scene-order:${task.inputRef}`, registrationRef].map((ref, index) => ({
          registrationRef: ref, toolCode: index === 1 ? 'rental.order.explain' : 'ai.model.text',
          toolVersion: AI_TOOL_DRAFT_VERSION, operation: index === 1 ? 'readonly' : 'external_unknown' }));
        if (!same(plan.steps, expected)) throw denied();
      } else if (plan.steps.length !== 1 || plan.steps[0].registrationRef !== registrationRef
        || plan.steps[0].toolCode !== 'ai.model.text' || plan.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || plan.steps[0].operation !== 'external_unknown') throw denied();
      const selected = inputs.filter(row => row.registrationRef === registrationRef);
      if (selected.length > 1) throw denied();
      const frozen = selected[0], matches = frozen ? steps.filter(step => step.inputRef === frozen.id) : [];
      if (matches.length > 1) throw denied();
      const step = matches[0];
      if (step) {
        if (step.scopeId !== task.scopeId || step.taskId !== task.id || step.runId !== run.id
          || frozen.scopeId !== task.scopeId || frozen.taskId !== task.id || frozen.runId !== run.id
          || frozen.fingerprint !== step.requestFingerprint || frozen.toolCode !== 'ai.model.text'
          || frozen.toolVersion !== AI_TOOL_DRAFT_VERSION || step.toolCode !== frozen.toolCode
          || step.toolVersion !== frozen.toolVersion || step.actionId !== aiStepActionId(access.scope, task.id, registrationRef)
          || step.sequence !== (orderChain ? 3 : 1)) throw denied();
        resultId = step.resultRef;
      }
      if (quoteWait && (!step || step.status !== 'SUCCEEDED' || step.id !== quoteWait.stepId
        || frozen.id !== quoteWait.inputId || resultId !== quoteWait.resultId)) throw denied();
    }
    const signature = requestFingerprint({ binding: access.bindingKey, provenance: provenance.bindingHash,
      task: { revision: task.revision, status: task.status, cursor: task.eventCursor.toString(), result: task.resultRef },
      run: { id: run.id, sequence: run.sequence, revision: run.revision, status: run.status, fence: run.fencingToken.toFixed(0),
        inputReceiptId: run.inputReceiptId, origin: run.resourceOriginRunId }, lineage,
      ...(quoteWait ? { executionRun: { id: executionRun.id, sequence: executionRun.sequence, revision: executionRun.revision,
        status: executionRun.status, fence: executionRun.fencingToken.toFixed(0), inputReceiptId: executionRun.inputReceiptId,
        origin: executionRun.resourceOriginRunId, holder: executionRun.leaseOwnerId, expiresAt: executionRun.leaseExpiresAt?.toISOString() ?? null },
        quoteWaitProof: quoteWait.proofHash } : {}),
      plan: stored?.planHash ?? null, inputs: inputs.map(row => ({ id: row.id, fingerprint: row.fingerprint })).sort((a, b) => a.id.localeCompare(b.id)),
      steps: steps.map(row => ({ id: row.id, revision: row.revision, sequence: row.sequence, inputRef: row.inputRef,
        actionId: row.actionId, fingerprint: row.requestFingerprint, status: row.status, resultRef: row.resultRef })) });
    if ((await authorization.tasks.resolveAccess(task.id, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
    return { task, run, resultId, signature, kind: lineage?.control ? 'model_control' as const
      : lineage?.continuation ? 'human_answer' as const : 'original_run' as const };
  };
  const before = await locate(), result = before.resultId ? await ports.result({ taskId: original.taskId, resultId: before.resultId }) : null;
  if ((await locate()).signature !== before.signature) throw changed();
  if (!result) return finish({ ...base, status: 'no_unique_result', result: null, lineage: null });
  const response = { ...base, status: 'observed' as const, result, lineage: { kind: before.kind,
    originRunId: original.runId, runId: before.run.id, runSequence: before.run.sequence, proofHash: before.signature } };
  if (!validateAiConversationTaskResultDraft(response, reference, turn) || response.result.resultId !== before.resultId) throw denied();
  return finish(response);
}
