/** Human reprepare uses an already-selected original task, not editable internal
 * step/plan references. Retain only the original operation before dispatch;
 * an uncertain reply permits receipt reads and never a second reprepare. */
import { AI_PROPOSAL_DRAFT_VERSION, validateAiQuoteSelectionHttpValue, type AiQuoteSelectionProofDraft,
  type AiApprovalApplicationReferenceDraft, type AiHumanQuoteOrderRepreparePreparationInputDraft,
  type AiHumanQuoteOrderRepreparePreparationDraft, type AiHumanQuoteOrderReprepareRequestDraft,
  type AiHumanQuoteOrderReprepareResponseDraft, type AiTaskMetadataPageDraft } from '@rental-os/shared';
import { commandHash } from './budget-settings-session';

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
  inspect = (replacementTaskId: string) => this.run(async signal => {
    if (this.state.locked || !this.state.items.some(row => row.taskId === replacementTaskId)) throw Error('AI_RESOURCE_UNAVAILABLE');
    const original = this.original(); if (!original) throw Error('AI_RESOURCE_UNAVAILABLE');
    this.clearPreparation();
    const input: AiHumanQuoteOrderRepreparePreparationInputDraft = { selection: this.selection, original: structuredClone(original), replacementTaskId,
      operationKey: this.operationKey, intent: 'inspect' };
    const value = await this.read(input, signal), signature = await commandHash(value); this.check(signal, original);
    this.prepared = { input, signature }; this.publish({ preparation: value, ready: true, feedback: 'observed' });
  });
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
