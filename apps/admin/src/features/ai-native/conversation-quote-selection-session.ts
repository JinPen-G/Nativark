/** Original clarified quote -> explicit selection -> explicit original host.
 * Persist only operation locators before dispatch. Unknown/reload performs
 * original reads; neither preparation nor the journal grants approval. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION,
  validateAiConversationAdmissionDraft, validateAiQuoteSelectionHttpValue,
  type AiConversationTurnObservationDraft, type AiConversationTurnReferenceDraft,
  type AiClarifiedQuoteSelectionPreparationInputDraft, type AiClarifiedQuoteSelectionPreparationDraft,
  type AiClarifiedQuoteSelectionRequestDraft, type AiClarifiedQuoteSelectionOriginalOperationReadDraft,
  type AiQuoteSelectionReceiptDraft, type AiQuoteSelectionProofDraft, type AiSelectedQuoteTaskRequestDraft,
  type AiSelectedQuoteTaskResultDraft, type AiSelectedQuoteTaskRunDraft } from '@rental-os/shared';
import type { ConfirmedQuoteSource } from './conversation-quote-confirmation-session';
import { commandHash } from './budget-settings-session';

type Ports = {
  admission(input: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  prepare(input: AiClarifiedQuoteSelectionPreparationInputDraft, signal: AbortSignal): Promise<unknown>;
  select(input: AiClarifiedQuoteSelectionRequestDraft, signal: AbortSignal): Promise<unknown>;
  operation(input: AiClarifiedQuoteSelectionOriginalOperationReadDraft, signal: AbortSignal): Promise<unknown>;
  start(input: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal): Promise<unknown>;
  result(input: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal): Promise<unknown>;
};
type Journal = { version: 1; command: AiClarifiedQuoteSelectionOriginalOperationReadDraft; phase: 'selected' | 'start_requested' };
export type QuoteSelectionState = Readonly<{ busy: boolean; locked: boolean; ready: boolean; startRequested: boolean;
  preparation: AiClarifiedQuoteSelectionPreparationDraft | null; receipt: AiQuoteSelectionReceiptDraft | null;
  run: AiSelectedQuoteTaskRunDraft | null; result: AiSelectedQuoteTaskResultDraft | null; feedback: 'idle' | 'observed' | 'unknown' }>;
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized((value as Record<string, unknown>)[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

export class ConversationQuoteSelectionSession {
  private active = true; private request: AbortController | null = null;
  private prepared: { value: AiClarifiedQuoteSelectionPreparationDraft; signature: string; source: ConfirmedQuoteSource } | null = null;
  private readonly selectionKey = crypto.randomUUID(); private readonly listeners = new Set<() => void>();
  private state: QuoteSelectionState;
  constructor(private readonly conversationId: string, private readonly turn: AiConversationTurnObservationDraft,
    private readonly ports: Ports, private readonly current: () => boolean, private readonly source: () => ConfirmedQuoteSource | null,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, private readonly key: string) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* unavailable storage cannot dispatch */ }
    this.state = Object.freeze({ busy: false, locked, ready: false, startRequested: false, preparation: null,
      receipt: null, run: null, result: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.prepared = null; this.request?.abort(); this.publish({ ready: false, preparation: null, receipt: null, run: null, result: null }); }
  dispose() { this.active = false; this.request?.abort(); this.prepared = null; }
  private publish(patch: Partial<QuoteSelectionState>) { this.state = Object.freeze({ ...this.state, ...patch }); this.listeners.forEach(fn => fn()); }
  private check(signal?: AbortSignal, source?: ConfirmedQuoteSource) {
    if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
    if (source && !same(this.source(), source)) throw Error('AI_REVISION_CONFLICT');
  }
  private async verifyTurn(signal: AbortSignal) {
    this.check(signal);
    if (this.turn.capabilityCode !== 'quote_clarification' || this.turn.material !== 'retained' || !this.turn.task || 'creation' in this.turn)
      throw Error('AI_RESOURCE_UNAVAILABLE');
    const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId, admissionKey: this.turn.admissionKey };
    const response = await this.ports.admission(query, signal); this.check(signal);
    if (!validateAiConversationAdmissionDraft(response, query) || !same(response.result, this.turn)) throw Error('AI_REVISION_CONFLICT');
  }
  private original(): Journal {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 4096) throw Error('AI_RESULT_UNKNOWN');
    const journal = JSON.parse(raw) as Journal;
    if (!journal || Object.keys(journal).length !== 3 || journal.version !== 1 || !['selected', 'start_requested'].includes(journal.phase)
      || !validateAiQuoteSelectionHttpValue('AiClarifiedQuoteSelectionOriginalOperationReadDraft', journal.command)) throw Error('AI_RESULT_UNKNOWN');
    const { selection, clarification } = journal.command;
    if (selection.originalInputRef !== this.turn.original.inputRef || clarification.original.inputRef !== this.turn.original.inputRef
      || selection.taskId !== this.turn.task?.taskId || !clarification.reference || clarification.reference.taskId !== selection.taskId)
      throw Error('AI_RESULT_UNKNOWN');
    return journal;
  }
  private save(journal: Journal, expected: string | null) {
    if (!this.storage || this.storage.getItem(this.key) !== expected) throw Error('AI_RESULT_UNKNOWN');
    const raw = JSON.stringify(journal); if (raw.length > 4096) throw Error('AI_RESULT_UNKNOWN');
    this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
  }
  private bindReceipt(receipt: AiQuoteSelectionReceiptDraft, journal: Journal) {
    const original = journal.command.selection;
    if (receipt.draftVersion !== original.draftVersion || receipt.originalInputRef !== original.originalInputRef
      || receipt.selectionKey !== original.selectionKey || receipt.taskId !== original.taskId || receipt.runId !== original.runId
      || receipt.quoteId !== original.quoteId || receipt.revision !== original.expectedSelectionRevision + 1) throw Error('AI_RESULT_UNKNOWN');
  }
  private proof(receipt: AiQuoteSelectionReceiptDraft): AiQuoteSelectionProofDraft {
    return { draftVersion: receipt.draftVersion, originalInputRef: receipt.originalInputRef, selectionId: receipt.selectionId,
      taskId: receipt.taskId, runId: receipt.runId, inputHash: receipt.inputHash };
  }
  private async preparation(source: ConfirmedQuoteSource, signal: AbortSignal) {
    this.check(signal, source); await this.verifyTurn(signal);
    const query: AiClarifiedQuoteSelectionPreparationInputDraft = { selectionKey: this.selectionKey, expectedSelectionRevision: 0,
      clarification: { original: structuredClone(this.turn.original), reference: structuredClone(source.answer.reference) } };
    const value = await this.ports.prepare(query, signal); this.check(signal, source); await this.verifyTurn(signal);
    if (!validateAiQuoteSelectionHttpValue('AiClarifiedQuoteSelectionPreparationDraft', value)
      || !same(value.clarification, query.clarification) || value.selection.originalInputRef !== query.clarification.original.inputRef
      || value.selection.taskId !== this.turn.task?.taskId || value.selection.taskId !== source.answer.reference.taskId
      || value.selection.runId !== source.runId || value.selection.selectionKey !== query.selectionKey
      || value.selection.expectedSelectionRevision !== 0 || value.selection.order.quoteId !== source.quoteId || value.quote.id !== source.quoteId)
      throw Error('AI_RESULT_UNKNOWN');
    return { value: structuredClone(value), signature: await commandHash(value), source: structuredClone(source) };
  }
  inspect = () => this.run('inspect');
  select = () => this.run('select');
  reconcile = () => this.run('operation');
  start = () => this.run('start');
  readResult = () => this.run('result');
  private async run(action: 'inspect' | 'select' | 'operation' | 'start' | 'result') {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const previous = this.prepared;
    if (action === 'select' && (!previous || !this.state.ready || this.state.locked)) throw Error('AI_RESULT_UNKNOWN');
    if (action === 'start' && (this.state.startRequested || !this.state.receipt)) throw Error('AI_RESULT_UNKNOWN');
    const controller = new AbortController(); this.request = controller; this.prepared = null;
    this.publish({ busy: true, ready: false, preparation: null, result: null });
    try {
      if (!this.storage) throw Error('AI_RESULT_UNKNOWN');
      if (action === 'inspect' || action === 'select') {
        if (this.state.locked || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
        const source = action === 'select' ? previous!.source : this.source(); if (!source) throw Error('AI_RESOURCE_UNAVAILABLE');
        const prepared = await this.preparation(source, controller.signal); this.check(controller.signal, source);
        if (action === 'inspect') { this.prepared = prepared; this.publish({ ready: true, preparation: structuredClone(prepared.value), feedback: 'observed' }); return; }
        if (prepared.signature !== previous!.signature) throw Error('AI_REVISION_CONFLICT');
        const s = prepared.value.selection;
        const journal: Journal = { version: 1, phase: 'selected', command: { clarification: prepared.value.clarification,
          selection: { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: s.originalInputRef, taskId: s.taskId,
            runId: s.runId, selectionKey: s.selectionKey, expectedSelectionRevision: s.expectedSelectionRevision, quoteId: s.order.quoteId } } };
        this.publish({ locked: true }); this.save(journal, null); this.check(controller.signal, source);
        const response = await this.ports.select({ selection: s, clarification: prepared.value.clarification }, controller.signal);
        this.check(controller.signal, source); await this.verifyTurn(controller.signal);
        if (!validateAiQuoteSelectionHttpValue('AiQuoteSelectionSelectResponseDraft', response)) throw Error('AI_RESULT_UNKNOWN');
        this.bindReceipt(response.receipt, journal); if (!same(this.original(), journal)) throw Error('AI_RESULT_UNKNOWN');
        this.publish({ receipt: structuredClone(response.receipt), feedback: 'observed' }); return;
      }
      const journal = this.original(); await this.verifyTurn(controller.signal);
      const observed = await this.ports.operation(journal.command, controller.signal); this.check(controller.signal); await this.verifyTurn(controller.signal);
      if (!validateAiQuoteSelectionHttpValue('AiQuoteSelectionReconcileResponseDraft', observed) || !same(this.original(), journal)) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ locked: true, startRequested: journal.phase === 'start_requested', receipt: null, feedback: 'unknown' });
      if (observed.state === 'not_observed') return;
      this.bindReceipt(observed.receipt, journal); this.publish({ receipt: structuredClone(observed.receipt), feedback: 'observed' });
      if (action === 'operation') return;
      const selection = this.proof(observed.receipt);
      if (action === 'start') {
        if (journal.phase !== 'selected' || observed.receipt.state !== 'selected_not_approved') throw Error('AI_RESULT_UNKNOWN');
        const next: Journal = { ...journal, phase: 'start_requested' };
        this.save(next, JSON.stringify(journal)); this.publish({ startRequested: true }); this.check(controller.signal);
        const run = await this.ports.start({ selection }, controller.signal); this.check(controller.signal); await this.verifyTurn(controller.signal);
        if (!validateAiQuoteSelectionHttpValue('AiSelectedQuoteTaskRunDraft', run) || !same(this.original(), next)) throw Error('AI_RESULT_UNKNOWN');
        this.publish({ run: structuredClone(run), feedback: 'observed' }); return;
      }
      const result = await this.ports.result({ selection }, controller.signal); this.check(controller.signal); await this.verifyTurn(controller.signal);
      if (!validateAiQuoteSelectionHttpValue('AiSelectedQuoteTaskResultDraft', result) || !same(this.original(), journal)
        || result.status === 'committed' && (result.order.quoteId !== observed.receipt.quoteId || result.source.resourceId !== result.order.id))
        throw Error('AI_RESULT_UNKNOWN');
      this.publish({ result: structuredClone(result), feedback: 'observed' });
    } catch (error) { if (this.active) this.publish({ ready: false, preparation: null, receipt: null, run: null, result: null, feedback: 'unknown' }); throw error; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
}
