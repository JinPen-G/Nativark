/** Explicit Core quotation from an observed original human answer. The journal
 * precedes dispatch; reload/unknown reads that exact operation. Preparation,
 * model output and this local journal never grant order approval or authority. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestReceiptDraft, validateAiSceneQuoteHttpResponse,
  type AiConversationTurnObservationDraft, type AiConversationTurnReferenceDraft, type AiSceneModelAnswerQueryDraft,
  type AiSceneModelQuoteConfirmDraft, type AiSceneModelQuotePreparationResponseDraft, type AiSceneModelQuoteConfirmResponseDraft,
  type AiSceneModelQuoteReceiptResponseDraft, type AiTaskInputReceiptReferenceDraft, type AiWorkspaceScope } from '@rental-os/shared';
import { commandHash } from './budget-settings-session';

export type QuoteAnswerReference = { reference: AiTaskInputReceiptReferenceDraft; receiptId: string };
export type ConfirmedQuoteSource = { answer: QuoteAnswerReference; quoteId: string; runId: string };
type Observed = Extract<AiSceneModelQuotePreparationResponseDraft, { original: unknown }>;
type Ready = Observed & { preparation: Extract<Observed['preparation'], { status: 'ready' }>;
  sources: Extract<Observed['sources'], { status: 'prepared_input_sources' }> };
type Result = Extract<AiSceneModelQuoteReceiptResponseDraft, { result: unknown }>['result'];
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Ports = {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  quotePreparation(query: AiSceneModelAnswerQueryDraft, signal: AbortSignal): Promise<unknown>;
  quoteConfirm(query: AiSceneModelQuoteConfirmDraft, signal: AbortSignal): Promise<unknown>;
  quoteReceipt(query: AiSceneModelAnswerQueryDraft, signal: AbortSignal): Promise<unknown>;
};
type Marker = { version: 1; turn: AiConversationTurnObservationDraft; answer: QuoteAnswerReference;
  contentHash: string; scope: AiWorkspaceScope; selectionRevision: string; inputFingerprint: string; projectionHash: string };
type Prepared = { marker: Marker; signature: string };
export type QuoteConfirmationState = Readonly<{ busy: boolean; locked: boolean; ready: boolean;
  preparation: Observed | null; result: Result | null; source: ConfirmedQuoteSource | null; feedback: 'idle' | 'observed' | 'unknown' }>;
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const code = (v: unknown, max = 191): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const answerKey = (v: QuoteAnswerReference) => [v.reference.taskId, v.reference.requestId, v.reference.expectedRevision, v.reference.submissionKey, v.receiptId];
const validAnswer = (v: QuoteAnswerReference) => !!v && !!v.reference && Object.keys(v).length === 2
  && Object.keys(v.reference).length === 4 && code(v.receiptId, 36) && code(v.reference.taskId, 36) && code(v.reference.requestId, 36)
  && code(v.reference.submissionKey) && Number.isInteger(v.reference.expectedRevision) && v.reference.expectedRevision >= 1 && v.reference.expectedRevision <= 4294967294;
const scopeEqual = (a: AiWorkspaceScope, b: AiWorkspaceScope) => a.tenantId === b.tenantId && a.workspaceId === b.workspaceId;
const projection = (request: Ready['preparation']['request']) => ({ period: { startAt: request.startAt, endAt: request.endAt }, lineUnits: request.lines });

export class ConversationQuoteConfirmationSession {
  private active = true; private request: AbortController | null = null; private prepared: Prepared | null = null;
  private listeners = new Set<() => void>(); private state: QuoteConfirmationState;
  constructor(private readonly conversationId: string, private readonly turn: AiConversationTurnObservationDraft,
    private readonly ports: Ports, private readonly current: () => boolean, private readonly selected: () => QuoteAnswerReference | null,
    private readonly storage: Storage | undefined, private readonly key: string) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* fail closed */ }
    this.state = Object.freeze({ busy: false, locked, ready: false, preparation: null, result: null, source: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.prepared = null; this.request?.abort(); this.publish({ ready: false, preparation: null, result: null, source: null }); }
  dispose() { this.active = false; this.prepared = null; this.request?.abort(); }
  private publish(patch: Partial<QuoteConfirmationState>) { this.state = Object.freeze({ ...this.state, ...patch }); this.listeners.forEach(fn => fn()); }
  private check(signal?: AbortSignal, answer?: QuoteAnswerReference) {
    if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
    const currentAnswer = this.selected();
    if (answer && (!currentAnswer || !same(answerKey(answer), answerKey(currentAnswer)))) throw Error('AI_REVISION_CONFLICT');
  }
  private query(answer: QuoteAnswerReference): AiSceneModelAnswerQueryDraft {
    if (!validAnswer(answer) || answer.reference.taskId !== this.turn.task?.taskId) throw Error('AI_RESULT_UNKNOWN');
    return { original: structuredClone(this.turn.original), reference: structuredClone(answer.reference) };
  }
  private async verifyTurn(signal: AbortSignal) {
    this.check(signal);
    if (!validateAiConversationTurnDraft(this.turn) || this.turn.capabilityCode !== 'quote_clarification'
      || this.turn.material !== 'retained' || !this.turn.task || 'creation' in this.turn) throw Error('AI_RESOURCE_UNAVAILABLE');
    const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId, admissionKey: this.turn.admissionKey };
    const packet = await this.ports.admission(query, signal); this.check(signal);
    if (!validateAiConversationAdmissionDraft(packet, query) || !packet.result || !same(packet.result, this.turn)) throw Error('AI_REVISION_CONFLICT');
  }
  private binding(value: { receipt: { taskId: string; requestId: string; receiptId: string }; original?: unknown }, answer: QuoteAnswerReference) {
    if (value.receipt.taskId !== answer.reference.taskId || value.receipt.requestId !== answer.reference.requestId
      || value.receipt.receiptId !== answer.receiptId || value.original !== undefined
        && !validateAiSceneRequestReceiptDraft(value.original, this.turn.original, this.turn)) throw Error('AI_RESULT_UNKNOWN');
  }
  private original(): Marker {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 4096) throw Error('AI_RESULT_UNKNOWN');
    const value = JSON.parse(raw) as Marker;
    if (!value || Object.keys(value).length !== 8 || value.version !== 1 || !same(value.turn, this.turn) || !validAnswer(value.answer)
      || !hash(value.contentHash) || !hash(value.selectionRevision) || !hash(value.inputFingerprint) || !hash(value.projectionHash)
      || !value.scope || Object.keys(value.scope).length !== 3 || value.scope.kind !== 'workspace'
      || !code(value.scope.tenantId) || !code(value.scope.workspaceId)) throw Error('AI_RESULT_UNKNOWN');
    this.query(value.answer); return value;
  }
  private async read(answer: QuoteAnswerReference, signal: AbortSignal): Promise<Observed | null> {
    this.check(signal, answer); await this.verifyTurn(signal);
    const value = await this.ports.quotePreparation(this.query(answer), signal); this.check(signal, answer);
    if (!validateAiSceneQuoteHttpResponse('AiSceneModelQuotePreparationResponseDraft', value)) throw Error('AI_RESULT_UNKNOWN');
    if (!('original' in value)) return null;
    this.binding(value, answer); await this.verifyTurn(signal); this.check(signal, answer); return structuredClone(value);
  }
  private async prepare(value: Observed, answer: QuoteAnswerReference): Promise<Prepared | null> {
    if (value.preparation.status !== 'ready' || value.sources.status !== 'prepared_input_sources') return null;
    const ready = value as Ready, p = ready.preparation, s = ready.sources, availability = p.availability;
    if (await commandHash(value.candidate) !== value.inputFingerprint || await commandHash(p.request) !== value.formalInputFingerprint
      || await commandHash(s.request) !== value.formalInputFingerprint || s.inputFingerprint !== value.formalInputFingerprint
      || s.selectionRevision !== p.selectionRevision || p.review.selectionRevision !== p.selectionRevision
      || p.review.configVersion !== p.configVersion || p.review.configurationFingerprint !== p.configurationFingerprint
      || p.review.availabilityObservedAt !== availability.observedAt || !availability.result.available
      || !scopeEqual(p.scope, availability.scope) || !scopeEqual(p.scope, availability.source.scope)
      || availability.audience !== p.audience || availability.result.locationId !== p.request.fulfillmentLocationId
      || availability.result.startAt !== p.request.startAt || availability.result.endAt !== p.request.endAt
      || !same(availability.source.request, { locationId: p.request.fulfillmentLocationId, startAt: p.request.startAt, endAt: p.request.endAt }))
      throw Error('AI_REVISION_CONFLICT');
    const fields = new Map(s.fields.map(field => [field.field, field.value]));
    const expected = { customerId: p.request.customerId, bookingIdentity: p.request.bookingIdentity, items: p.request.lines,
      startAt: p.request.startAt, endAt: p.request.endAt, fulfillmentMode: p.request.fulfillmentMode,
      fulfillmentLocationId: p.request.fulfillmentLocationId, returnLocationId: p.request.returnLocationId, deliveryAddressId: p.request.deliveryAddressId };
    if (fields.size !== s.fields.length || Object.entries(expected).some(([key, v]) => v !== undefined
      && (!fields.has(key as typeof s.fields[number]['field']) || !same(fields.get(key as typeof s.fields[number]['field']), v)))) throw Error('AI_REVISION_CONFLICT');
    const marker: Marker = { version: 1, turn: structuredClone(this.turn), answer: structuredClone(answer), contentHash: value.original.contentHash,
      scope: structuredClone(p.scope), selectionRevision: p.selectionRevision, inputFingerprint: value.formalInputFingerprint!, projectionHash: await commandHash(projection(p.request)) };
    // Read timestamps change on each request; compare the actual conditions,
    // versions, current stock and address evidence presented for confirmation.
    const signature = await commandHash({ candidate: value.candidate, request: p.request, scope: p.scope, audience: p.audience,
      selectionRevision: p.selectionRevision, configurationFingerprint: p.configurationFingerprint, configVersion: p.configVersion,
      addressFingerprint: p.addressFingerprint, timeZone: p.timeZone, availability: availability.result, contentHash: value.original.contentHash });
    return { marker, signature };
  }
  inspect = () => this.run('inspect');
  confirm = () => this.run('confirm');
  reconcile = () => this.run('receipt');
  private async run(action: 'inspect' | 'confirm' | 'receipt') {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const prior = this.prepared;
    if (action === 'confirm' && (!prior || !this.state.ready || this.state.locked)) throw Error('AI_RESULT_UNKNOWN');
    const controller = new AbortController(); this.request = controller; this.prepared = null;
    this.publish({ busy: true, ready: false, preparation: null, result: null, source: null });
    try {
      if (!this.storage) throw Error('AI_RESULT_UNKNOWN');
      if (action === 'receipt') {
        const marker = this.original(); await this.verifyTurn(controller.signal);
        const value = await this.ports.quoteReceipt(this.query(marker.answer), controller.signal); this.check(controller.signal);
        if (!validateAiSceneQuoteHttpResponse('AiSceneModelQuoteReceiptResponseDraft', value) || !('result' in value)) throw Error('AI_RESULT_UNKNOWN');
        this.binding(value, marker.answer); await this.verifyTurn(controller.signal);
        await this.result(value, marker); this.check(controller.signal);
        if (!same(this.original(), marker)) throw Error('AI_RESULT_UNKNOWN');
        this.publish({ locked: true, result: structuredClone(value.result), source: this.source(value, marker), feedback: 'observed' }); return value;
      }
      if (this.state.locked || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const answer = action === 'confirm' ? prior!.marker.answer : this.selected(); if (!answer) throw Error('AI_RESOURCE_UNAVAILABLE');
      const value = await this.read(answer, controller.signal);
      const prepared = value && await this.prepare(value, answer); this.check(controller.signal, answer);
      if (action === 'inspect') {
        if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
        this.prepared = prepared; this.publish({ ready: !!prepared, preparation: value, feedback: value ? 'observed' : 'unknown' }); return value;
      }
      if (!prepared || prepared.signature !== prior!.signature) throw Error('AI_REVISION_CONFLICT');
      const raw = JSON.stringify(prepared.marker); if (raw.length > 4096 || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ locked: true }); this.storage.setItem(this.key, raw);
      if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
      this.check(controller.signal, answer);
      const reply = await this.ports.quoteConfirm({ ...this.query(answer), selectionRevision: prepared.marker.selectionRevision,
        inputFingerprint: prepared.marker.inputFingerprint, confirmQuote: true }, controller.signal); this.check(controller.signal, answer);
      if (!validateAiSceneQuoteHttpResponse('AiSceneModelQuoteConfirmResponseDraft', reply)) throw Error('AI_RESULT_UNKNOWN');
      this.binding(reply, answer); await this.verifyTurn(controller.signal);
      if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
      if ('result' in reply) { await this.result(reply, prepared.marker); this.check(controller.signal); this.publish({ result: structuredClone(reply.result), source: this.source(reply, prepared.marker) }); }
      this.publish({ feedback: 'observed' }); return reply;
    } catch (error) { if (this.active) this.publish({ ready: false, preparation: null, result: null, source: null, feedback: 'unknown' }); throw error; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
  private async result(value: Extract<AiSceneModelQuoteConfirmResponseDraft | AiSceneModelQuoteReceiptResponseDraft, { result: unknown }>, marker: Marker) {
    if (value.original.contentHash !== marker.contentHash || !scopeEqual(value.result.scope, marker.scope)) throw Error('AI_RESULT_UNKNOWN');
    if (value.result.quote && await commandHash({ period: value.result.quote.period, lineUnits: value.result.quote.lineUnits }) !== marker.projectionHash)
      throw Error('AI_RESULT_UNKNOWN');
  }
  private source(value: Extract<AiSceneModelQuoteConfirmResponseDraft | AiSceneModelQuoteReceiptResponseDraft, { result: unknown }>, marker: Marker): ConfirmedQuoteSource | null {
    return value.result.status === 'quoted' && value.result.quote && value.receipt.state === 'observed'
      ? { answer: structuredClone(marker.answer), quoteId: value.result.quote.id, runId: value.receipt.runId } : null;
  }
}
