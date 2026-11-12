/** Human reprepare uses an already-selected original task, not editable internal
 * step/plan references. Retain only the original operation before dispatch;
 * an uncertain reply permits receipt reads and never a second reprepare. */
import { AI_PROPOSAL_DRAFT_VERSION, validateAiQuoteSelectionHttpValue, type AiQuoteSelectionProofDraft,
  type AiApprovalApplicationReferenceDraft, type AiHumanQuoteOrderRepreparePreparationInputDraft,
  type AiHumanQuoteOrderRepreparePreparationDraft, type AiHumanQuoteOrderReprepareRequestDraft,
  type AiHumanQuoteOrderReprepareResponseDraft, type AiTaskMetadataPageDraft, validateAiSceneQuoteCandidateDraft,
  type AiSceneQuoteCandidate, type AiSceneRequestReadDraft, type AiSceneQuoteConfirmDraft,
  type AiOriginalQuoteReviewResponseDraft, type AiOriginalQuoteConfirmResponseDraft, type AiOriginalQuoteReceiptResponseDraft,
  type AiQuoteRequestReissuePreparationInputDraft, type AiQuoteRequestReissuePreparationDraft,
  type AiQuoteRequestReissueReferenceDraft, type AiQuoteRequestReissueCreateDraft, type AiQuoteRequestReissueOperationDraft,
  type AiQuoteRequestReissueSelectionPreparationDraft, type AiQuoteRequestReissueSelectDraft,
  type AiQuoteRequestReissueSelectionOperationDraft, type AiSelectedQuoteTaskRequestDraft, type AiSelectedQuoteTaskRunDraft,
  type AiTaskInputFieldDraft, type AiWorkbenchFieldMaterialDraft } from '@rental-os/shared';
import { commandHash } from './budget-settings-session';
import { inspectWorkbenchQuoteParameterCandidate, type WorkbenchQuoteParameterReview } from './workbench-input-review-session';

type Ports = {
  list(input: { sceneCode: string; status: 'waiting_confirmation'; limit: number; cursor?: string }, signal: AbortSignal): Promise<AiTaskMetadataPageDraft>;
  repreparePreparation(input: AiHumanQuoteOrderRepreparePreparationInputDraft, signal: AbortSignal): Promise<unknown>;
  reprepare(input: AiHumanQuoteOrderReprepareRequestDraft, signal: AbortSignal): Promise<unknown>;
  reprepareReceipt(input: AiHumanQuoteOrderReprepareRequestDraft, signal: AbortSignal): Promise<unknown>;
};
export type QuoteReprepareState = Readonly<{ busy: boolean; locked: boolean; ready: boolean;
  items: AiTaskMetadataPageDraft['items']; nextCursor: string | null; listed: boolean;
  preparation: AiHumanQuoteOrderRepreparePreparationDraft | null;
  response: AiHumanQuoteOrderReprepareResponseDraft | null; feedback: 'idle' | 'observed' | 'unknown' }>;
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized((value as Record<string, unknown>)[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

function quoteParameterValue(candidate: AiSceneQuoteCandidate, field: AiTaskInputFieldDraft) {
  switch (field.fieldId) {
    case 'quantity': return candidate.items?.[field.target!.rowIndex]?.quantity;
    case 'starts_at': return candidate.start;
    case 'ends_at': return candidate.end;
    case 'pickup_location': return candidate.locationId;
    case 'return_location': return candidate.returnLocationId;
    default: throw Error('AI_INVALID_INPUT');
  }
}
function quoteParameterBasis(candidate: AiSceneQuoteCandidate, field: AiTaskInputFieldDraft) {
  if (field.fieldId === 'pickup_location') return [candidate.locationId, candidate.locationName];
  if (field.fieldId === 'return_location') return [candidate.returnLocationId, candidate.returnLocationName];
  return quoteParameterValue(candidate, field);
}

/** Fill only this explicitly adopted, current original projection. A row target
 * binds the pre-edit candidate; human edits are kept and reported as conflicts. */
export async function mergeWorkbenchQuoteParameters(review: WorkbenchQuoteParameterReview,
  source: AiSceneQuoteCandidate, current: AiSceneQuoteCandidate | null) {
  const checked = inspectWorkbenchQuoteParameterCandidate(review.candidate, review.fieldMaterial);
  if (!same(checked, review) || !validateAiSceneQuoteCandidateDraft(source)
    || current !== null && !validateAiSceneQuoteCandidateDraft(current)) throw Error('AI_INVALID_INPUT');
  const original = structuredClone(source), draft = structuredClone(current ?? source);
  const contract = checked.fieldMaterial.contract!, conflicts: string[] = [];
  const target = contract.fields.find(field => field.fieldId === 'quantity')?.target;
  if (target && (target.candidateInputFingerprint !== await commandHash(original)
    || !original.items?.[target.rowIndex])) throw Error('AI_REVISION_CONFLICT');
  for (const answer of checked.candidate.answers) {
    const field = contract.fields.find(field => field.fieldId === answer.fieldId)!;
    if (field.fieldId === 'quantity') {
      const row = draft.items?.[field.target!.rowIndex], sourceRow = original.items?.[field.target!.rowIndex];
      const { quantity: _sourceQuantity, ...sourceItem } = sourceRow!;
      const { quantity: _draftQuantity, ...draftItem } = row ?? {};
      if (!row || !same(sourceItem, draftItem)) { conflicts.push(field.fieldId); continue; }
    }
    if (!same(quoteParameterBasis(original, field), quoteParameterBasis(draft, field))) {
      if (quoteParameterValue(draft, field) !== answer.value) conflicts.push(field.fieldId);
      continue;
    }
    if (field.fieldId === 'quantity') draft.items![field.target!.rowIndex].quantity = Number(answer.value);
    else if (field.fieldId === 'starts_at') draft.start = String(answer.value);
    else if (field.fieldId === 'ends_at') draft.end = String(answer.value);
    else if (field.kind === 'choice') {
      const option = field.options.find(option => option.value === answer.value)!;
      if (field.fieldId === 'pickup_location') { draft.locationId = option.value; draft.locationName = option.label; }
      else { draft.returnLocationId = option.value; draft.returnLocationName = option.label; }
    }
  }
  if (!same(draft, current ?? source)) delete draft.selectionRevision;
  if (!validateAiSceneQuoteCandidateDraft(draft)) throw Error('AI_INVALID_INPUT');
  return { candidate: draft, conflicts };
}

/** The live wait may disappear after rejection. Retain only its reviewed
 * reference so the server can independently authorize the later historical read. */
export function readQuoteReprepareOriginal(storage: Pick<Storage, 'getItem'> | undefined, key: string,
  selection: AiQuoteSelectionProofDraft): AiApprovalApplicationReferenceDraft | null {
  if (!storage) return null;
  const raw = storage.getItem(key); if (raw === null) return null;
  if (raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
  const value = JSON.parse(raw), ref = value?.original;
  if (!value || Object.keys(value).length !== 2 || !same(value.selection, selection) || !ref
    || Object.keys(ref).sort().join(',') !== 'contractVersion,proposalId,proposalRevision,reviewedPayloadHash'
    || ref.contractVersion !== AI_PROPOSAL_DRAFT_VERSION || typeof ref.proposalId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(ref.proposalId)
    || !Number.isSafeInteger(ref.proposalRevision) || ref.proposalRevision < 1 || ref.proposalRevision > 4294967295
    || typeof ref.reviewedPayloadHash !== 'string' || !/^[a-f0-9]{64}$/u.test(ref.reviewedPayloadHash)) throw Error('AI_RESULT_UNKNOWN');
  return structuredClone(ref);
}
export function retainQuoteReprepareOriginal(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, key: string,
  selection: AiQuoteSelectionProofDraft, original: AiApprovalApplicationReferenceDraft) {
  if (!storage) throw Error('AI_RESULT_UNKNOWN');
  const previous = readQuoteReprepareOriginal(storage, key, selection);
  if (previous && !same(previous, original)) throw Error('AI_REVISION_CONFLICT');
  const raw = JSON.stringify({ selection, original });
  // Validate the exact journal shape before writing, and never overwrite an
  // unreadable or different original with a newly observed proposal.
  readQuoteReprepareOriginal({ getItem: () => raw }, key, selection);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw Error('AI_RESULT_UNKNOWN');
  return structuredClone(original);
}

export class QuoteReprepareSession {
  private active = false; private flight: AbortController | null = null;
  private readonly operationKey = crypto.randomUUID(); private readonly listeners = new Set<() => void>();
  private prepared: { input: AiHumanQuoteOrderRepreparePreparationInputDraft; signature: string } | null = null;
  private state: QuoteReprepareState;
  constructor(private readonly selection: AiQuoteSelectionProofDraft, private readonly ports: Ports,
    private readonly current: () => boolean, private readonly original: () => AiApprovalApplicationReferenceDraft | null,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, private readonly key: string) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* no durable locator, no dispatch */ }
    this.state = Object.freeze({ busy: false, locked, ready: false, items: [], nextCursor: null, listed: false,
      preparation: null, response: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  activate() { this.active = true; }
  retract() { this.prepared = null; this.flight?.abort(); this.publish({ ready: false, preparation: null, response: null, items: [], nextCursor: null, listed: false }); }
  dispose() { this.active = false; this.flight?.abort(); this.prepared = null; }
  clearPreparation() { this.prepared = null; this.publish({ ready: false, preparation: null, response: null }); }
  private publish(patch: Partial<QuoteReprepareState>) { this.state = Object.freeze({ ...this.state, ...patch }); this.listeners.forEach(fn => fn()); }
  private check(signal?: AbortSignal, original?: AiApprovalApplicationReferenceDraft) {
    if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
    if (original && !same(this.original(), original)) throw Error('AI_REVISION_CONFLICT');
  }
  private journal(): AiHumanQuoteOrderReprepareRequestDraft {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 5120) throw Error('AI_RESULT_UNKNOWN');
    const command = JSON.parse(raw);
    if (!validateAiQuoteSelectionHttpValue('AiHumanQuoteOrderReprepareRequestDraft', command)
      || !same(command.selection, this.selection) || command.command.originalTaskId !== this.selection.taskId
      || command.command.replacement.taskId === this.selection.taskId) throw Error('AI_RESULT_UNKNOWN');
    return command;
  }
  private async read(input: AiHumanQuoteOrderRepreparePreparationInputDraft, signal: AbortSignal) {
    this.check(signal, input.original);
    const value = await this.ports.repreparePreparation(input, signal); this.check(signal, input.original);
    if (!validateAiQuoteSelectionHttpValue('AiHumanQuoteOrderRepreparePreparationDraft', value)
      || !same(value.selection, this.selection) || !same(value.command.original, input.original)
      || value.command.operationKey !== input.operationKey || value.command.originalTaskId !== this.selection.taskId
      || value.replacement.taskId !== input.replacementTaskId || value.replacement.taskId === this.selection.taskId
      || value.command.replacement.taskId !== value.replacement.taskId || value.command.replacement.runId !== value.replacement.runId
      || value.command.replacement.originalInputRef !== value.replacement.originalInputRef
      || value.command.replacement.quoteSelectionRef !== value.replacement.selectionId || value.command.replacement.fingerprint !== value.replacement.inputHash
      || value.originalReview.proposal.payload.taskId !== this.selection.taskId
      || value.originalReview.proposal.payload.proposalId !== input.original.proposalId
      || value.originalReview.proposal.payload.revision !== input.original.proposalRevision
      || value.originalReview.proposal.payloadHash !== input.original.reviewedPayloadHash
      || value.replacementReview.proposal.payload.taskId !== value.replacement.taskId) throw Error('AI_RESULT_UNKNOWN');
    return structuredClone(value);
  }
  private observe(value: unknown, command: AiHumanQuoteOrderReprepareRequestDraft) {
    if (!validateAiQuoteSelectionHttpValue('AiHumanQuoteOrderReprepareResponseDraft', value)
      || !same(this.journal(), command) || value.receipt.originalTaskId !== this.selection.taskId
      || value.receipt.operationKey !== command.command.operationKey || !same(value.receipt.original, command.command.original)
      || value.receipt.replacementTaskId !== command.command.replacement.taskId) throw Error('AI_RESULT_UNKNOWN');
    if (value.receipt.state === 'prepared') {
      const next = value.replacement;
      if (!next || next.selection.taskId !== command.command.replacement.taskId || next.selection.runId !== command.command.replacement.runId
        || next.selection.selectionId !== command.command.replacement.quoteSelectionRef || next.selection.originalInputRef !== command.command.replacement.originalInputRef
        || next.selection.inputHash !== command.command.replacement.fingerprint || next.review.proposal.payload.taskId !== next.selection.taskId
        || next.review.proposal.payload.proposalId !== value.receipt.proposal.proposalId
        || next.review.proposal.payload.revision !== value.receipt.proposal.proposalRevision
        || next.review.proposal.payloadHash !== value.receipt.proposal.reviewedPayloadHash) throw Error('AI_RESULT_UNKNOWN');
    }
    this.publish({ response: structuredClone(value), feedback: value.receipt.state === 'prepared' ? 'observed' : 'unknown' });
  }
  private async run(work: (signal: AbortSignal) => Promise<void>) {
    this.check(); if (this.flight) throw Error('AI_BUSY');
    const controller = new AbortController(); this.flight = controller; this.publish({ busy: true, feedback: 'idle' });
    try { await work(controller.signal); this.check(controller.signal); }
    catch (error) { if (this.active) { this.prepared = null; this.publish({ ready: false, preparation: null, response: null, feedback: 'unknown' }); } throw error; }
    finally { if (this.flight === controller) this.flight = null; if (this.active) this.publish({ busy: false }); }
  }
  list = (cursor?: string) => this.run(async signal => {
    if (this.state.locked) throw Error('AI_RESULT_UNKNOWN'); this.clearPreparation();
    const page = await this.ports.list({ sceneCode: 'quote_clarification', status: 'waiting_confirmation', limit: 50, ...(cursor ? { cursor } : {}) }, signal);
    this.check(signal);
    if (!page || !Array.isArray(page.items) || page.items.length > 50 || page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length > 4096)
      || page.items.some(row => !/^[0-9a-f-]{36}$/iu.test(row.taskId) || row.sceneCode !== 'quote_clarification'
        || row.status !== 'waiting_confirmation' || row.cancelRequestedAt !== null || !Number.isSafeInteger(row.revision) || row.revision < 1)
      || new Set(page.items.map(row => row.taskId)).size !== page.items.length) throw Error('AI_RESOURCE_UNAVAILABLE');
    this.publish({ items: structuredClone(page.items.filter(row => row.taskId !== this.selection.taskId)), nextCursor: page.nextCursor, listed: true });
  });
  inspect = (replacementTaskId: string) => this.inspectReplacement(replacementTaskId);
  /** An explicitly selected linked quote is already identified by its original
   * receipt. The server still locates/rechecks its real wait and full material. */
  inspectLinked = (selection: AiQuoteSelectionProofDraft) => this.inspectReplacement(selection.taskId, selection);
  private inspectReplacement(replacementTaskId: string, linked?: AiQuoteSelectionProofDraft) { return this.run(async signal => {
    if (this.state.locked || (linked ? linked.taskId === this.selection.taskId || linked.originalInputRef === this.selection.originalInputRef
      : !this.state.items.some(row => row.taskId === replacementTaskId))) throw Error('AI_RESOURCE_UNAVAILABLE');
    const original = this.original(); if (!original) throw Error('AI_RESOURCE_UNAVAILABLE');
    this.clearPreparation();
    const input: AiHumanQuoteOrderRepreparePreparationInputDraft = { selection: this.selection, original: structuredClone(original), replacementTaskId,
      operationKey: this.operationKey, intent: 'inspect' };
    const value = await this.read(input, signal), signature = await commandHash(value); this.check(signal, original);
    if (linked && !same(value.replacement, linked)) throw Error('AI_REVISION_CONFLICT');
    this.prepared = { input, signature }; this.publish({ preparation: value, ready: true, feedback: 'observed' });
  }); }
  confirm = () => this.run(async signal => {
    const previous = this.prepared;
    if (this.state.locked || !this.state.ready || !previous || !this.storage || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
    this.prepared = null; this.publish({ ready: false, preparation: null });
    const value = await this.read(previous.input, signal);
    if (await commandHash(value) !== previous.signature) throw Error('AI_REVISION_CONFLICT');
    const command = { selection: this.selection, command: value.command }, raw = JSON.stringify(command);
    this.check(signal, previous.input.original);
    if (raw.length > 5120 || !validateAiQuoteSelectionHttpValue('AiHumanQuoteOrderReprepareRequestDraft', command)) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ locked: true }); this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
    this.check(signal, previous.input.original);
    const response = await this.ports.reprepare(command, signal); this.check(signal); this.observe(response, command);
  });
  reconcile = () => this.run(async signal => {
    this.clearPreparation(); const command = this.journal();
    const response = await this.ports.reprepareReceipt(command, signal); this.check(signal); this.observe(response, command);
  });
}

type ReissuePorts = {
  revalidateParameters?(review: WorkbenchQuoteParameterReview, signal: AbortSignal): Promise<AiWorkbenchFieldMaterialDraft>;
  reissuePreparation(input: AiQuoteRequestReissuePreparationInputDraft, signal: AbortSignal): Promise<AiQuoteRequestReissuePreparationDraft>;
  reissueRequest(input: AiQuoteRequestReissueCreateDraft, signal: AbortSignal): Promise<AiQuoteRequestReissueOperationDraft>;
  reissueOperation(input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal): Promise<AiQuoteRequestReissueOperationDraft>;
  reviewOriginalQuote(input: AiSceneRequestReadDraft, signal: AbortSignal): Promise<AiOriginalQuoteReviewResponseDraft>;
  confirmOriginalQuote(input: AiSceneQuoteConfirmDraft, signal: AbortSignal): Promise<AiOriginalQuoteConfirmResponseDraft>;
  originalQuoteReceipt(input: AiSceneRequestReadDraft, signal: AbortSignal): Promise<AiOriginalQuoteReceiptResponseDraft>;
  reissuedSelectionPreparation(input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal): Promise<AiQuoteRequestReissueSelectionPreparationDraft>;
  selectReissuedQuote(input: AiQuoteRequestReissueSelectDraft, signal: AbortSignal): Promise<AiQuoteRequestReissueSelectionOperationDraft>;
  reissuedSelectionOperation(input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal): Promise<AiQuoteRequestReissueSelectionOperationDraft>;
  start(input: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal): Promise<AiSelectedQuoteTaskRunDraft>;
};
type RequestPhase = 'request' | 'quote' | 'selection' | 'start';
type RequestMarker = { version: 1; reference: AiQuoteRequestReissueReferenceDraft; phase: RequestPhase };
export type QuoteRequestReissueState = Readonly<{ busy: boolean; invalid: boolean; phase: RequestPhase | null; unknown: boolean;
  parameterFeedback: 'adopted' | 'conflict' | null;
  candidate: AiSceneQuoteCandidate | null; preparation: AiQuoteRequestReissuePreparationDraft | null;
  operation: AiQuoteRequestReissueOperationDraft | null; quoteReview: AiOriginalQuoteReviewResponseDraft | null;
  quote: AiOriginalQuoteConfirmResponseDraft | AiOriginalQuoteReceiptResponseDraft | null;
  selectionPreparation: AiQuoteRequestReissueSelectionPreparationDraft | null; selection: AiQuoteRequestReissueSelectionOperationDraft | null }>;

/** One linked request, original Core quotation and original selection. Only
 * phase/locator metadata persists; unknown phases permit their original reads.
 * This session does not call a model, calculate money or grant a new approval. */
export class QuoteRequestReissueSession {
  private active = false; private flight: AbortController | null = null;
  private readonly listeners = new Set<() => void>(); private state: QuoteRequestReissueState;
  constructor(private readonly selection: AiQuoteSelectionProofDraft, private readonly ports: ReissuePorts,
    private readonly current: () => boolean, private readonly original: () => AiApprovalApplicationReferenceDraft | null,
    private readonly scope: { tenantId: string; workspaceId: string },
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, private readonly key: string) {
    let phase: RequestPhase | null = null, invalid = false;
    try { phase = this.marker()?.phase ?? null; } catch { invalid = true; }
    this.state = Object.freeze({ busy: false, invalid, phase, unknown: !!phase, parameterFeedback: null, candidate: null, preparation: null,
      operation: null, quoteReview: null, quote: null, selectionPreparation: null, selection: null });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<QuoteRequestReissueState>) {
    if (!this.active || !this.current()) return;
    this.state = Object.freeze({ ...this.state, ...patch }); this.listeners.forEach(listener => listener());
  }
  private check(signal?: AbortSignal, original?: AiApprovalApplicationReferenceDraft) {
    if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
    if (original && !same(original, this.original())) throw Error('AI_REVISION_CONFLICT');
  }
  private checkScope(scope: { tenantId: string; workspaceId: string }) {
    if (scope.tenantId !== this.scope.tenantId || scope.workspaceId !== this.scope.workspaceId) throw Error('AI_SCOPE_CHANGED');
  }
  private marker(): RequestMarker | null {
    if (!this.storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const raw = this.storage.getItem(this.key); if (raw === null) return null;
    if (!raw || raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'phase,reference,version' || value.version !== 1
      || !['request', 'quote', 'selection', 'start'].includes(value.phase)
      || !validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueReferenceDraft', value.reference)
      || !same(value.reference.selection, this.selection)) throw Error('AI_RESULT_UNKNOWN');
    return value;
  }
  private retain(value: RequestMarker, previous: RequestMarker | null) {
    if (!this.storage || !same(this.marker(), previous)) throw Error('AI_RESULT_UNKNOWN');
    const raw = JSON.stringify(value); if (raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
    this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ phase: value.phase, unknown: true });
  }
  activate() { this.active = true; }
  retract(preserveDraft = false) {
    this.flight?.abort(); this.flight = null;
    this.state = Object.freeze({ ...this.state, busy: false, unknown: !!this.state.phase,
      candidate: preserveDraft && !this.state.phase ? this.state.candidate : null, preparation: null, parameterFeedback: null,
      operation: null, quoteReview: null, quote: null, selectionPreparation: null, selection: null });
    if (this.active && this.current()) this.listeners.forEach(listener => listener());
  }
  dispose() { this.active = false; this.retract(); }
  clearConditionPreview() { this.publish({ preparation: null, parameterFeedback: null }); }
  private async run(work: (signal: AbortSignal) => Promise<void>) {
    this.check(); if (this.flight || this.state.invalid) throw Error('AI_OPERATION_BUSY');
    const controller = new AbortController(); this.flight = controller; this.publish({ busy: true });
    try { await work(controller.signal); this.check(controller.signal); }
    catch (error) { if (this.flight === controller && !controller.signal.aborted) this.publish({ unknown: !!this.state.phase,
      preparation: null, quoteReview: null, selectionPreparation: null }); throw error; }
    finally { if (this.flight === controller) { this.flight = null; this.publish({ busy: false }); } }
  }
  private input(candidate?: AiSceneQuoteCandidate): AiQuoteRequestReissuePreparationInputDraft {
    const original = this.original(); if (!original || this.state.phase || this.state.unknown || this.marker()) throw Error('AI_RESOURCE_UNAVAILABLE');
    return { selection: this.selection, original: structuredClone(original), intent: 'change_plan', ...(candidate ? { candidate } : {}) };
  }
  private async readConditions(input: AiQuoteRequestReissuePreparationInputDraft, signal: AbortSignal) {
    this.check(signal, input.original);
    const value = await this.ports.reissuePreparation(input, signal); this.check(signal, input.original);
    if (!validateAiQuoteSelectionHttpValue('AiQuoteRequestReissuePreparationDraft', value)
      || !same(value.selection, this.selection) || !same(value.original, input.original) || value.intent !== input.intent
      || input.candidate && !same(input.candidate, value.candidate)) throw Error('AI_REVISION_CONFLICT');
    this.checkScope(value.scope); this.checkScope(value.preparation.scope); return value;
  }
  prepareConditions = () => this.run(async signal => {
    const value = await this.readConditions(this.input(), signal);
    this.publish({ candidate: structuredClone(value.candidate), preparation: value, parameterFeedback: null });
  });
  adoptParameters = (review: WorkbenchQuoteParameterReview, currentReview: () => WorkbenchQuoteParameterReview | null) => this.run(async signal => {
    const checked = inspectWorkbenchQuoteParameterCandidate(review.candidate, review.fieldMaterial), current = this.state.candidate;
    const valid = () => {
      this.check(signal);
      if (!same(currentReview(), checked) || checked.candidate.binding.taskId !== this.selection.taskId
        || checked.candidate.binding.original.inputRef !== this.selection.originalInputRef
        || Date.parse(checked.expiresAt) <= Date.now()) throw Error('AI_REVISION_CONFLICT');
    };
    valid();
    if (!this.ports.revalidateParameters) throw Error('AI_RESOURCE_UNAVAILABLE');
    const source = await this.readConditions(this.input(), signal); valid();
    const material = await this.ports.revalidateParameters(checked, signal); valid();
    if (!same(material, checked.fieldMaterial)) throw Error('AI_REVISION_CONFLICT');
    const merged = await mergeWorkbenchQuoteParameters(checked, source.candidate, current); valid();
    this.publish({ candidate: merged.candidate, preparation: null,
      parameterFeedback: merged.conflicts.length ? 'conflict' : 'adopted' });
  });
  editConditions(value: AiSceneQuoteCandidate) {
    this.check(); if (this.marker() || this.state.busy) throw Error('AI_OPERATION_BUSY');
    this.publish({ candidate: structuredClone(value), preparation: null, parameterFeedback: null });
  }
  inspectConditions = () => this.run(async signal => {
    const candidate = this.state.candidate;
    if (!candidate || !validateAiSceneQuoteCandidateDraft(candidate)) throw Error('AI_INVALID_INPUT');
    const value = await this.readConditions(this.input(structuredClone(candidate)), signal); this.publish({ preparation: value });
  });
  private preparedSignature(value: AiQuoteRequestReissuePreparationDraft | AiOriginalQuoteReviewResponseDraft) {
    const p = 'facts' in value ? value.facts : value.preparation;
    return commandHash({ source: 'sourceHash' in value ? value.sourceHash : value.original.contentHash,
      candidate: 'candidate' in value ? value.candidate : undefined, status: p.status,
      ...('request' in p ? { request: p.request, selectionRevision: p.selectionRevision, configVersion: p.configVersion,
        configurationFingerprint: p.configurationFingerprint, addressFingerprint: p.addressFingerprint, availability: p.availability.result } : {}) });
  }
  createRequest = () => this.run(async signal => {
    const before = this.state.preparation; if (!before || before.preparation.status !== 'ready' || this.marker()) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = await this.readConditions(this.input(structuredClone(before.candidate)), signal);
    if (value.preparation.status !== 'ready' || await this.preparedSignature(before) !== await this.preparedSignature(value)) throw Error('AI_REVISION_CONFLICT');
    const reference: AiQuoteRequestReissueReferenceDraft = { selection: this.selection, original: value.original,
      intent: value.intent, operationKey: crypto.randomUUID() }, marker: RequestMarker = { version: 1, reference, phase: 'request' };
    this.check(signal, value.original); this.retain(marker, null); this.publish({ candidate: null, preparation: null });
    this.check(signal, value.original);
    const response = await this.ports.reissueRequest({ ...reference, candidate: value.candidate, sourceHash: value.sourceHash,
      decision: 'create_linked_quote_request' }, signal); this.check(signal); this.observeRequest(response, marker);
  });
  private observeRequest(value: AiQuoteRequestReissueOperationDraft, marker: RequestMarker) {
    this.checkScope(value.scope);
    if (!same(value.reference, marker.reference) || !same(this.marker(), marker)) throw Error('AI_RESULT_UNKNOWN');
    if (value.status === 'linked_request_recorded' && (value.original.inputRef === this.selection.originalInputRef
      || value.task.state === 'observed' && value.task.taskId === this.selection.taskId)) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ operation: value, unknown: value.status !== 'linked_request_recorded' });
  }
  private linked() {
    const marker = this.marker(), value = this.state.operation;
    if (!marker || !value || value.status !== 'linked_request_recorded' || value.task.state !== 'observed'
      || !same(marker.reference, value.reference)) throw Error('AI_RESOURCE_UNAVAILABLE');
    return { marker, original: value.original, task: value.task, admission: value.admission };
  }
  inspectQuote = () => this.run(async signal => {
    const linked = this.linked(); if (linked.marker.phase !== 'request' || this.state.unknown) throw Error('AI_RESULT_UNKNOWN');
    const value = await this.ports.reviewOriginalQuote(linked.original, signal); this.check(signal);
    if (value.original.inputRef !== linked.original.inputRef) throw Error('AI_SCOPE_CHANGED'); this.checkScope(value.facts.scope);
    this.publish({ quoteReview: value });
  });
  confirmQuote = () => this.run(async signal => {
    const linked = this.linked(), before = this.state.quoteReview;
    if (linked.marker.phase !== 'request' || this.state.unknown || !before || before.facts.status !== 'ready'
      || before.sources.status !== 'prepared_input_sources') throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = await this.ports.reviewOriginalQuote(linked.original, signal); this.check(signal);
    if (value.facts.status !== 'ready' || value.sources.status !== 'prepared_input_sources'
      || value.original.inputRef !== linked.original.inputRef || await this.preparedSignature(before) !== await this.preparedSignature(value)) throw Error('AI_REVISION_CONFLICT');
    const fingerprint = await commandHash(value.facts.request);
    if (fingerprint !== value.sources.inputFingerprint || value.sources.selectionRevision !== value.facts.selectionRevision) throw Error('AI_REVISION_CONFLICT');
    this.check(signal); this.retain({ ...linked.marker, phase: 'quote' }, linked.marker); this.publish({ quoteReview: null });
    const result = await this.ports.confirmOriginalQuote({ ...linked.original, selectionRevision: value.facts.selectionRevision,
      inputFingerprint: fingerprint, confirmQuote: true }, signal); this.check(signal);
    if (result.result.quote && (result.result.quote.period.startAt !== value.facts.request.startAt || result.result.quote.period.endAt !== value.facts.request.endAt)) throw Error('AI_RESULT_UNKNOWN');
    this.observeQuote(result, linked.original);
  });
  private observeQuote(value: AiOriginalQuoteConfirmResponseDraft | AiOriginalQuoteReceiptResponseDraft, original: AiSceneRequestReadDraft) {
    if (value.original.inputRef !== original.inputRef) throw Error('AI_SCOPE_CHANGED'); this.checkScope(value.result.scope);
    this.publish({ quote: value, unknown: !value.result.quote || !['quoted', 'expired'].includes(value.result.status) });
  }
  inspectSelection = () => this.run(async signal => {
    const linked = this.linked(); if (linked.marker.phase !== 'quote' || this.state.unknown || !this.state.quote?.result.quote) throw Error('AI_RESULT_UNKNOWN');
    const value = await this.ports.reissuedSelectionPreparation(linked.marker.reference, signal); this.check(signal); this.checkScope(value.scope);
    if (!same(value.reference, linked.marker.reference) || value.original.inputRef !== linked.original.inputRef
      || value.selection.taskId !== linked.task.taskId || value.selection.runId !== linked.task.runId
      || value.selection.order.quoteId !== this.state.quote.result.quote.id) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ selectionPreparation: value });
  });
  selectQuote = () => this.run(async signal => {
    const linked = this.linked(), before = this.state.selectionPreparation;
    if (linked.marker.phase !== 'quote' || this.state.unknown || !before) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = await this.ports.reissuedSelectionPreparation(linked.marker.reference, signal); this.check(signal);
    if (!same(value.reference, before.reference) || value.reviewHash !== before.reviewHash) throw Error('AI_REVISION_CONFLICT');
    this.retain({ ...linked.marker, phase: 'selection' }, linked.marker); this.publish({ selectionPreparation: null });
    const result = await this.ports.selectReissuedQuote({ ...linked.marker.reference, reviewHash: value.reviewHash,
      decision: 'select_reissued_quote' }, signal); this.check(signal); this.observeSelection(result);
  });
  private observeSelection(value: AiQuoteRequestReissueSelectionOperationDraft) {
    const linked = this.linked(); this.checkScope(value.scope);
    if (!same(value.reference, linked.marker.reference) || value.original.inputRef !== linked.original.inputRef
      || value.selection.state === 'observed' && (value.selection.receipt.originalInputRef !== linked.original.inputRef
        || value.selection.receipt.taskId !== linked.task.taskId || value.selection.receipt.runId !== linked.task.runId)) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ selection: value, unknown: value.selection.state !== 'observed' || linked.marker.phase === 'start' });
  }
  selectionProof(): AiQuoteSelectionProofDraft | null {
    const value = this.state.selection?.selection; if (!value || value.state !== 'observed') return null;
    const receipt = value.receipt;
    return { draftVersion: receipt.draftVersion, originalInputRef: receipt.originalInputRef, selectionId: receipt.selectionId,
      taskId: receipt.taskId, runId: receipt.runId, inputHash: receipt.inputHash };
  }
  startSelection = () => this.run(async signal => {
    const linked = this.linked(), selection = this.selectionProof();
    if (linked.marker.phase !== 'selection' || this.state.unknown || !selection || linked.admission !== 'current_policies_available'
      || this.state.selection?.selection.state !== 'observed' || this.state.selection.selection.receipt.state !== 'selected_not_approved') throw Error('AI_RESOURCE_UNAVAILABLE');
    this.retain({ ...linked.marker, phase: 'start' }, linked.marker);
    await this.ports.start({ selection }, signal); this.check(signal);
    // Only the existing server's new/old material read can attest a waiting
    // successor; a start acknowledgement cannot stand in for that evidence.
    this.publish({ unknown: true });
  });
  acknowledgePrepared(selection: AiQuoteSelectionProofDraft) {
    this.check(); if (this.state.phase !== 'start' || !same(selection, this.selectionProof())) throw Error('AI_RESULT_UNKNOWN');
    this.publish({ unknown: false });
  }
  reconcile = () => this.run(async signal => {
    const marker = this.marker(); if (!marker) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const request = await this.ports.reissueOperation(marker.reference, signal); this.check(signal); this.observeRequest(request, marker);
    if (request.status !== 'linked_request_recorded' || request.task.state !== 'observed') return;
    if (marker.phase === 'quote') { const quote = await this.ports.originalQuoteReceipt(request.original, signal); this.check(signal); this.observeQuote(quote, request.original); }
    if (marker.phase === 'selection' || marker.phase === 'start') {
      const selection = await this.ports.reissuedSelectionOperation(marker.reference, signal); this.check(signal); this.observeSelection(selection);
    }
  });
}
