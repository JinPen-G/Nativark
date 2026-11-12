/** Candidate handoff to the original trusted question, never answer submission.
 * Full original contracts remain on this host; the sandbox's safe projection
 * cannot attest a human choice, replace a question or create an input receipt. */
import { AI_WORKBENCH_CONTEXT_DRAFT_VERSION, isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft,
  type AiTaskClarificationObservationDraft, type AiTaskInputAnswerDraft,
  type AiWorkbenchFieldMaterialDraft, type AiWorkbenchHostDraft } from '@rental-os/shared';
import { displayPartialAnswers, displaySame } from './workbench-display-host';

export type WorkbenchInputQuestion = NonNullable<AiTaskClarificationObservationDraft['input']>;
export interface WorkbenchInputCandidateReview {
  status: 'ready' | 'conflict';
  reason: 'no_original_question' | 'contract_changed' | 'field_changed' | null;
  contractRelationship: 'exact' | 'projection' | 'conflict';
  candidate: AiWorkbenchHostDraft;
  fieldMaterial: AiWorkbenchFieldMaterialDraft;
  /** Complete original question, not a new contract synthesized from the frame. */
  question: WorkbenchInputQuestion | null;
  expiresAt: string;
  humanChoice: 'not_attested';
  preparation: 'not_attempted';
  approval: 'not_granted';
}
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');
const invalid = () => Error('AI_INVALID_INPUT');
const safeFields = new Set(['quantity', 'starts_at', 'ends_at', 'pickup_location', 'return_location']);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 4294967294;

export function inspectWorkbenchInputQuestion(value: unknown, taskId: string, now = Date.now()): WorkbenchInputQuestion | null {
  const observation = structuredClone(value) as AiTaskClarificationObservationDraft;
  if (observation?.taskId !== taskId || observation.execution !== 'read_only_no_start_no_reconnect_side_effect') throw unavailable();
  if (observation.input === null) return null;
  const input = observation.input;
  if (!input || !id(input.requestId) || input.requestId.length > 36 || !revision(input.revision)
    || !Number.isFinite(now) || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now
    || !isAiTaskInputContractDraft(input.contract)) throw unavailable();
  return input;
}

/** The display may be a safe subset; matching that subset does not rename it
 * to the complete question. Every supplied field keeps the original definition. */
export function inspectWorkbenchInputCandidate(candidate: AiWorkbenchHostDraft, fieldMaterial: AiWorkbenchFieldMaterialDraft,
  question: WorkbenchInputQuestion | null, now = Date.now()): WorkbenchInputCandidateReview {
  const draft = structuredClone(candidate), material = structuredClone(fieldMaterial), actual = structuredClone(question);
  if (!draft || Object.keys(draft).sort().join(',') !== 'answers,approval,binding,draftId,draftVersion,fieldRevision,inputOrigin,preparation,revision,status'
    || draft.draftVersion !== AI_WORKBENCH_CONTEXT_DRAFT_VERSION || !id(draft.draftId) || !revision(draft.revision)
    || draft.inputOrigin?.kind !== 'candidate' || draft.inputOrigin.humanChoice !== 'not_attested'
    || Object.keys(draft.inputOrigin).sort().join(',') !== 'humanChoice,kind' || draft.status !== 'unsubmitted'
    || draft.preparation !== 'not_attempted' || draft.approval !== 'not_granted'
    || material?.draftVersion !== AI_WORKBENCH_CONTEXT_DRAFT_VERSION || material.authority !== 'original_business_rules_not_model_rules'
    || !displaySame(draft.binding, material.binding) || draft.fieldRevision !== material.fieldRevision
    || !material.contract || !isAiTaskInputContractDraft(material.contract)
    || material.contract.fields.some(field => !safeFields.has(field.fieldId))
    || !displayPartialAnswers(material, draft.answers)
    || new TextEncoder().encode(JSON.stringify({ draft, material })).byteLength > 131072
    || !Number.isFinite(now) || !Number.isFinite(Date.parse(material.retention.expiresAt)) || Date.parse(material.retention.expiresAt) <= now) throw invalid();
  if (actual) inspectWorkbenchInputQuestion({ taskId: draft.binding.taskId, input: actual,
    execution: 'read_only_no_start_no_reconnect_side_effect' }, draft.binding.taskId, now);
  const reason: WorkbenchInputCandidateReview['reason'] = !actual ? 'no_original_question'
    : material.contract.code !== actual.contract.code || material.contract.version !== actual.contract.version ? 'contract_changed'
      : material.contract.fields.some(field => !actual.contract.fields.some(original => displaySame(original, field)))
        || !validateAiTaskInputAnswersDraft({ ...actual.contract,
          fields: actual.contract.fields.map(field => ({ ...field, required: false })) }, draft.answers) ? 'field_changed' : null;
  return {
    status: reason ? 'conflict' : 'ready', reason,
    contractRelationship: reason ? 'conflict' : displaySame(material.contract, actual!.contract) ? 'exact' : 'projection',
    candidate: draft, fieldMaterial: material, question: actual,
    expiresAt: new Date(Math.min(Date.parse(material.retention.expiresAt), actual ? Date.parse(actual.expiresAt) : Infinity)).toISOString(),
    humanChoice: 'not_attested', preparation: 'not_attempted', approval: 'not_granted',
  };
}

/** Preserve values which still match the new original rules; never silently
 * merge a different candidate over a human's existing legal edits. */
export function preserveWorkbenchQuestionDraft(question: WorkbenchInputQuestion | null, previous: Readonly<Record<string, string>>,
  offered: readonly AiTaskInputAnswerDraft[] = []) {
  const draft: Record<string, string> = {}, rejected: string[] = [], conflicts: string[] = [];
  for (const [fieldId, text] of Object.entries(previous)) {
    if (!text) continue;
    const field = question?.contract.fields.find(field => field.fieldId === fieldId);
    const value = field?.kind === 'integer' && /^[1-9][0-9]*$/u.test(text) ? Number(text) : text;
    if (field && validateAiTaskInputAnswersDraft({ ...question!.contract, fields: [{ ...field, required: false }] }, [{ fieldId, value }])) draft[fieldId] = text;
    else rejected.push(fieldId);
  }
  for (const answer of offered) {
    const field = question?.contract.fields.find(field => field.fieldId === answer.fieldId);
    if (!field || !validateAiTaskInputAnswersDraft({ ...question!.contract, fields: [{ ...field, required: false }] }, [answer])) { rejected.push(answer.fieldId); continue; }
    const text = String(answer.value);
    if (draft[answer.fieldId] !== undefined && draft[answer.fieldId] !== text) conflicts.push(answer.fieldId);
    else draft[answer.fieldId] = text;
  }
  return { draft, rejected, conflicts };
}

export class WorkbenchInputReviewSession {
  private active = true;
  private generation = 0;
  private request: AbortController | null = null;
  private state: { busy: boolean; review: WorkbenchInputCandidateReview | null; unavailable: boolean } = { busy: false, review: null, unavailable: false };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly port: { readQuestion(taskId: string, signal: AbortSignal): Promise<AiTaskClarificationObservationDraft> },
    private readonly current: () => boolean, private readonly at: () => number = Date.now) {
    if (typeof port?.readQuestion !== 'function' || typeof current !== 'function' || typeof at !== 'function') throw unavailable();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  activate() { this.active = true; }
  clear() { this.generation++; this.request?.abort(); this.request = null; this.update({ busy: false, review: null, unavailable: false }); }
  dispose() { this.active = false; this.clear(); }
  async reviewCandidate(candidate: AiWorkbenchHostDraft, material: AiWorkbenchFieldMaterialDraft, signal?: AbortSignal): Promise<WorkbenchInputCandidateReview> {
    if (!this.active || !this.current() || signal?.aborted) { this.clear(); throw Error('AI_SCOPE_CHANGED'); }
    if (this.request) throw Error('AI_OPERATION_BUSY');
    // Check the candidate before reading sensitive original fields. A caller's
    // source marker can never promote a sandbox packet to a human receipt.
    inspectWorkbenchInputCandidate(candidate, material, null, this.at());
    const draft = structuredClone(candidate), fields = structuredClone(material), generation = ++this.generation;
    const controller = new AbortController(); this.request = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 5000);
    const check = () => { if (!this.active || !this.current() || controller.signal.aborted || generation !== this.generation) throw Error('AI_SCOPE_CHANGED'); };
    this.update({ busy: true, review: null, unavailable: false });
    try {
      check();
      const question = inspectWorkbenchInputQuestion(await this.port.readQuestion(draft.binding.taskId, controller.signal), draft.binding.taskId, this.at());
      check();
      const review = inspectWorkbenchInputCandidate(draft, fields, question, this.at());
      check(); this.update({ review }); return structuredClone(review);
    } catch (error) {
      if (generation === this.generation) this.update({ review: null, unavailable: true });
      throw error;
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (this.request === controller) this.request = null;
      if (generation === this.generation) this.update({ busy: false });
    }
  }
}
