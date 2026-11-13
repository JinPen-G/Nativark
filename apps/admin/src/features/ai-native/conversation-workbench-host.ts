/** Bind the shared display/review ports to one original conversation admission.
 * The result packet carries its proven successor Run separately from the
 * unchanged admission. Frame values can only open the original human review; this
 * adapter never submits an answer, approves, continues or calls a model. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationTurnDraft, validateAiConversationTaskResultDraft,
  type AiConversationTurnObservationDraft, type AiConversationTaskResultDraft, type AiTaskReviewQueryDraft,
  type AiApprovalApplicationReferenceDraft } from '@rental-os/shared';
import { createAiWorkbenchDisplayPort } from '@/api/aiWorkbenchDisplays';
import type { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { validateTaskCenterSnapshot } from './task-center-reader';
import { WorkbenchInputReviewSession, type WorkbenchQuoteParameterReview } from './workbench-input-review-session';
import { displaySame, type WorkbenchDisplayPort } from './workbench-display-host';

export type ConversationWorkbenchSource = Extract<AiConversationTaskResultDraft, { status: 'observed' }>;
export type ConversationRequestedProposal = AiTaskReviewQueryDraft & { proposal: AiApprovalApplicationReferenceDraft };
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');
const changed = () => Error('AI_SCOPE_CHANGED');
const admissionBinding = (turn: AiConversationTurnObservationDraft) => ({ turnId: turn.turnId, admissionKey: turn.admissionKey,
  originalRequestKey: turn.originalRequestKey, requestHash: turn.requestHash, capabilityCode: turn.capabilityCode,
  capabilityVersion: turn.capabilityVersion, createdAt: turn.createdAt, original: turn.original, material: turn.material,
  taskId: turn.task?.taskId ?? null, runId: turn.task?.runId ?? null,
  creation: 'creation' in turn ? turn.creation : null, closeOperationKey: 'closeOperationKey' in turn ? turn.closeOperationKey : null });

export function createConversationWorkbenchHost(input: {
  conversationId: string; turn: AiConversationTurnObservationDraft; tenantId: string; workspaceId: string;
  current(): boolean; source(): ConversationWorkbenchSource | null;
  admission(query: { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION; conversationId: string; admissionKey: string },
    signal: AbortSignal): Promise<unknown>;
  tasks: Pick<typeof aiTaskCenterApi, 'input' | 'snapshot' | 'review'>;
  onReview(section: 'input' | 'approval'): void;
  onConfirmation(reference: ConversationRequestedProposal): void;
}) {
  const turn = structuredClone(input.turn), query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION,
    conversationId: input.conversationId, admissionKey: turn.admissionKey };
  if (!validateAiConversationTurnDraft(turn) || !turn.task || turn.material !== 'retained' || 'creation' in turn) throw unavailable();
  let active = false, retained: ConversationWorkbenchSource | null = null, reviewed: ConversationWorkbenchSource | null = null;
  const check = (source: ConversationWorkbenchSource | null, signal: AbortSignal) => {
    if (!active || !source || signal.aborted || !input.current() || input.source() !== source) throw changed();
    if (!validateAiConversationTaskResultDraft(source, query, turn) || source.result.status !== 'available') throw unavailable();
    return source;
  };
  const admission = async (source: ConversationWorkbenchSource, signal: AbortSignal) => {
    check(source, signal);
    const value = await input.admission(structuredClone(query), signal);
    check(source, signal);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    const result = value as Record<string, unknown>;
    if (Object.keys(result).sort().join(',') !== 'absence,admissionKey,conversationId,draftVersion,result,retryable'
      || result.draftVersion !== query.draftVersion || result.conversationId !== query.conversationId
      || result.admissionKey !== query.admissionKey || result.absence !== 'not_proof_of_no_commit' || result.retryable !== false
      || !validateAiConversationTurnDraft(result.result) || !displaySame(admissionBinding(result.result), admissionBinding(turn)))
      throw Error('AI_REVISION_CONFLICT');
  };
  const binding = (value: { conversationId: string; turnId: string; taskId: string; capabilityCode: string;
    capabilityVersion: string; original: unknown }, source: ConversationWorkbenchSource) => {
    if (value.conversationId !== input.conversationId || value.turnId !== turn.turnId || value.taskId !== source.result.taskId
      || value.capabilityCode !== turn.capabilityCode || value.capabilityVersion !== turn.capabilityVersion
      || !displaySame(value.original, turn.original)) throw unavailable();
  };
  const review = new WorkbenchInputReviewSession({ readQuestion: input.tasks.input },
    () => active && input.current() && retained !== null && input.source() === retained);
  const original = createAiWorkbenchDisplayPort({ tenantId: input.tenantId, workspaceId: input.workspaceId,
    current: () => active && input.current() && input.source() !== null,
    reviewCandidate: async (candidate, fields, signal) => {
      const source = check(retained, signal); binding(candidate.binding, source); reviewed = null;
      try {
        await admission(source, signal);
        const value = await review.reviewCandidate(candidate, fields, signal);
        check(source, signal); await admission(source, signal); check(source, signal);
        reviewed = source; input.onReview('kind' in value ? 'approval' : 'input');
      } catch (error) { reviewed = null; review.clear(); throw error; }
    },
    openConfirmation: async (material, proposal, signal) => {
      const source = check(retained, signal); binding(material, source); await admission(source, signal);
      const snapshot = validateTaskCenterSnapshot(await input.tasks.snapshot(material.taskId, signal), material.taskId);
      check(source, signal);
      if (snapshot.sceneCode !== turn.capabilityCode || snapshot.status !== 'waiting_confirmation') throw Error('AI_REVISION_CONFLICT');
      const steps = snapshot.steps.filter(step => step.kind === 'confirmation' && step.status === 'running');
      if (steps.length !== 1) throw unavailable();
      const target = { taskId: material.taskId, runId: steps[0].runId, stepId: steps[0].stepId };
      const value = await input.tasks.review(target, signal), actual = value.review.proposal;
      check(source, signal);
      if (value.taskId !== target.taskId || value.runId !== target.runId || value.stepId !== target.stepId
        || value.taskRevision !== snapshot.revision || value.businessExecution !== 'not_attested'
        || actual.payload.taskId !== material.taskId || actual.status !== 'pending_confirmation'
        || actual.payload.scope.kind !== 'workspace' || actual.payload.scope.tenantId !== input.tenantId
        || actual.payload.scope.workspaceId !== input.workspaceId || !displaySame(proposal, {
          contractVersion: actual.payload.contractVersion, proposalId: actual.payload.proposalId,
          proposalRevision: actual.payload.revision, reviewedPayloadHash: actual.payloadHash })) throw Error('AI_REVISION_CONFLICT');
      await admission(source, signal); check(source, signal);
      input.onConfirmation({ ...target, proposal: structuredClone(proposal) });
    },
  });
  const suspend = () => { retained = null; reviewed = null; review.clear(); original.dispose(); };
  async function guarded<T>(read: () => Promise<T>): Promise<T> {
    try { return await read(); } catch (error) { suspend(); throw error; }
  }
  const port: WorkbenchDisplayPort & { activate(): void; suspend(): void; dispose(): void } = {
    activate() { active = true; original.activate(); review.activate(); },
    suspend,
    dispose() { active = false; suspend(); review.dispose(); },
    read: (taskId, signal) => guarded(async () => {
      const source = check(input.source(), signal);
      if (taskId !== source.result.taskId) throw unavailable();
      retained = null; reviewed = null; review.clear(); original.activate();
      await admission(source, signal);
      const value = await original.read(taskId, signal); check(source, signal); binding(value.presentation.binding, source);
      if (value.presentation.generation.runId !== source.result.runId || value.presentation.generation.resultId !== source.result.resultId) throw unavailable();
      await admission(source, signal); check(source, signal); retained = source; return value;
    }),
    revalidate: (lease, signal) => guarded(async () => {
      const source = check(retained, signal); binding(lease.binding, source); await admission(source, signal);
      const value = await original.revalidate(lease, signal); check(source, signal); binding(value.binding, source);
      await admission(source, signal); check(source, signal); return value;
    }),
    readSource: (material, sourceId, signal) => guarded(async () => {
      const source = check(retained, signal); binding(material, source); await admission(source, signal);
      const value = await original.readSource!(material, sourceId, signal); check(source, signal);
      await admission(source, signal); check(source, signal); return value;
    }),
    reviewCandidate: (candidate, signal) => guarded(async () => {
      const source = check(retained, signal); binding(candidate.binding, source);
      await original.reviewCandidate!(candidate, signal); check(source, signal);
    }),
    openConfirmation: (material, proposal, signal) => guarded(async () => {
      const source = check(retained, signal); binding(material, source);
      await original.openConfirmation!(material, proposal, signal); check(source, signal);
    }),
  };
  const reviewCurrent = () => active && reviewed !== null && input.current() && reviewed === retained && input.source() === reviewed;
  return Object.freeze({ port, inputReview: review, reviewCurrent,
    async revalidateParameters(value: WorkbenchQuoteParameterReview, signal: AbortSignal) {
      if (!reviewCurrent() || !displaySame(review.snapshot().parameters, value)) throw changed();
      await port.reviewCandidate!(structuredClone(value.candidate), signal);
      const current = review.snapshot().parameters;
      if (!reviewCurrent() || !current || !displaySame(current, value)) throw changed();
      return structuredClone(current.fieldMaterial);
    },
  });
}
