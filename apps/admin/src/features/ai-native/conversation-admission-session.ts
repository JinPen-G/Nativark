/** Typed order/setup admission only, not Task creation or model execution. Persist
 * only the original turn key/hash before sending; the body stays in memory.
 * Reload/absence/abort can only reconcile that key, never reconstruct or resend. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationObservationDraft, validateAiConversationOperationDraft,
  type AiConversationReferenceDraft,
  type AiConversationObservationDraft, type AiConversationTurnAdmissionDraft, type AiConversationTurnReferenceDraft,
  type AiConversationAdmissionResponseDraft } from '@rental-os/shared';
import { commandHash } from './budget-settings-session';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Rotation = { operationKey: string; turnId: string; originalInputRef: string; expectedRevision: number };
type Capability = 'order_explanation' | 'opening_diagnosis';
type Marker = AiConversationTurnReferenceDraft & { expectedRevision: number; requestHash: string; capabilityCode: Capability; rotation?: Rotation };
type Ports = { admit(command: AiConversationTurnAdmissionDraft, signal: AbortSignal): Promise<unknown>;
  admission(command: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown> };
export type ConversationAdmissionState = Readonly<{ busy: boolean; locked: boolean; prepared: boolean;
  reviewedInput: { orderId: string; question: 'status' | 'fees' | 'payments' | 'next_steps' } | null;
  reviewedSections: readonly string[] | null;
  rotationPending: boolean;
  observation: AiConversationAdmissionResponseDraft | null; feedback: 'idle' | 'prepared' | 'admitted' | 'unknown' | 'unavailable' }>;
const JOURNAL_MAX_LENGTH = 2048;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
function marker(value: unknown, conversationId: string): value is Marker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const rotating = row.rotation !== undefined;
  if (Object.keys(row).length !== (rotating ? 7 : 6) || Object.keys(row).some(key => !['draftVersion', 'conversationId', 'admissionKey', 'expectedRevision', 'requestHash', 'capabilityCode', ...(rotating ? ['rotation'] : [])].includes(key))) return false;
  if (rotating) {
    const rotation = row.rotation as Record<string, unknown> | null;
    if (!rotation || typeof rotation !== 'object' || Array.isArray(rotation) || Object.keys(rotation).length !== 4
      || Object.keys(rotation).some(key => !['operationKey', 'turnId', 'originalInputRef', 'expectedRevision'].includes(key))
      || !id(rotation.operationKey) || rotation.operationKey.length > 128 || !id(rotation.turnId) || !id(rotation.originalInputRef)
      || !Number.isSafeInteger(rotation.expectedRevision) || rotation.expectedRevision !== (row.expectedRevision as number) + 1) return false;
  }
  return row.draftVersion === AI_CONVERSATION_DRAFT_VERSION && row.conversationId === conversationId
    && id(row.admissionKey) && row.admissionKey.length <= 128 && Number.isSafeInteger(row.expectedRevision)
    && (row.expectedRevision as number) >= 1 && (row.expectedRevision as number) < 4294967294
    && typeof row.requestHash === 'string' && /^[a-f0-9]{64}$/u.test(row.requestHash) && ['order_explanation', 'opening_diagnosis'].includes(row.capabilityCode as string);
}
export class ConversationAdmissionSession {
  private active = true; private request: AbortController | null = null; private listeners = new Set<() => void>();
  private command: AiConversationTurnAdmissionDraft | null = null; private state: ConversationAdmissionState;
  constructor(private readonly conversationId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Storage | undefined, private readonly key: string, private readonly newKey = () => globalThis.crypto.randomUUID()) {
    let locked = true, rotationPending = false;
    try { const raw = storage?.getItem(key); locked = !storage || raw !== null;
      if (raw && raw.length <= JOURNAL_MAX_LENGTH) { const parsed: unknown = JSON.parse(raw); rotationPending = marker(parsed, conversationId) && !!parsed.rotation; }
    } catch { /* unreadable journal cannot authorize sends */ }
    this.state = Object.freeze({ busy: false, locked, prepared: false, reviewedInput: null, reviewedSections: null, rotationPending, observation: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.command = null; this.request?.abort(); this.publish({ prepared: false, reviewedInput: null, reviewedSections: null, observation: null, feedback: this.state.locked ? 'unknown' : 'idle' }); }
  dispose() { this.active = false; this.command = null; this.request?.abort(); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  private publish(patch: Partial<ConversationAdmissionState>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) listener(); }
  prepare = (observation: AiConversationObservationDraft, orderId: string, question: 'status' | 'fees' | 'payments' | 'next_steps') =>
    this.prepareRequest(observation, { sceneCode: 'order_explanation', input: { orderId, question } });
  prepareOpening = (observation: AiConversationObservationDraft, sections: string[]) =>
    this.prepareRequest(observation, { sceneCode: 'opening_diagnosis', input: { sections: [...sections].sort() } });
  private async prepareRequest(observation: AiConversationObservationDraft, request: AiConversationTurnAdmissionDraft['request']) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    if (this.state.locked || !this.storage) throw Error('AI_RESULT_UNKNOWN');
    if (!validateAiConversationObservationDraft(observation, { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId })
      || observation.capabilityCode !== request.sceneCode || observation.status !== 'active' || observation.currentTurn !== null
      || (request.sceneCode === 'order_explanation' ? !id(request.input.orderId) || !['status', 'fees', 'payments', 'next_steps'].includes(request.input.question)
        : request.sceneCode !== 'opening_diagnosis' || !request.input.sections.length || request.input.sections.length > 9
          || request.input.sections.some(section => !id(section)) || new Set(request.input.sections).size !== request.input.sections.length)) throw Error('AI_INVALID_INPUT');
    const controller = new AbortController(); this.request = controller; this.publish({ busy: true, observation: null });
    try {
      if (this.storage.getItem(this.key) !== null) { this.publish({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
      const command: AiConversationTurnAdmissionDraft = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId,
        admissionKey: this.newKey(), expectedRevision: observation.revision, request: structuredClone(request) };
      const original: Marker = { draftVersion: command.draftVersion, conversationId: this.conversationId, admissionKey: command.admissionKey,
        expectedRevision: command.expectedRevision, capabilityCode: request.sceneCode as Capability, requestHash: await commandHash(command.request) };
      this.check(controller.signal); if (!marker(original, this.conversationId)) throw Error('AI_INVALID_INPUT');
      if (this.storage.getItem(this.key) !== null) { this.publish({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
      const saved = JSON.stringify(original); if (saved.length > JOURNAL_MAX_LENGTH) throw Error('AI_INVALID_INPUT');
      this.publish({ locked: true });
      this.storage.setItem(this.key, saved); if (this.storage.getItem(this.key) !== saved) throw Error('AI_RESOURCE_UNAVAILABLE');
      this.command = structuredClone(command); this.publish({ prepared: true,
        reviewedInput: request.sceneCode === 'order_explanation' ? structuredClone(request.input) : null,
        reviewedSections: request.sceneCode === 'opening_diagnosis' ? [...request.input.sections] : null, feedback: 'prepared' });
    } catch (failure) { if (this.active) this.publish({ prepared: false, feedback: this.state.locked ? 'unknown' : 'unavailable' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
  private original(): Marker {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > JOURNAL_MAX_LENGTH) throw Error('AI_RESULT_UNKNOWN');
    const value: unknown = JSON.parse(raw); if (!marker(value, this.conversationId)) throw Error('AI_RESULT_UNKNOWN');
    return value;
  }
  private observed(value: unknown, original: Marker) {
    if (!validateAiConversationAdmissionDraft(value, original) || !value.result || value.result.capabilityCode !== original.capabilityCode
      || value.result.requestHash !== original.requestHash) throw Error('AI_RESULT_UNKNOWN');
    return structuredClone(value);
  }
  /** A historical turn without this local admission marker cannot participate
   * in two-journal closure. Refuse before creating an unrecoverable close key. */
  assertClosure = (observation: AiConversationObservationDraft) => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const original = this.original(), turn = observation.currentTurn;
    if (this.state.prepared || this.command || original.rotation
      || !validateAiConversationObservationDraft(observation, { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId })
      || observation.status !== 'active' || observation.capabilityCode !== original.capabilityCode || !turn
      || observation.revision !== original.expectedRevision + 1 || turn.admissionKey !== original.admissionKey
      || turn.requestHash !== original.requestHash || turn.capabilityCode !== original.capabilityCode) throw Error('AI_RESULT_UNKNOWN');
  };
  canClose = (observation: AiConversationObservationDraft | null) => {
    if (!observation) return false;
    try { this.assertClosure(observation); return true; } catch { return false; }
  };
  /** A server operation receipt plus fresh empty-head read closes the old local
   * marker. The receipt alone cannot prove this head is still free. Neither
   * absent admission nor TTL can rotate the old key. No network send here. */
  rotate = async (reads: { operation(query: { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION; operationKey: string }, signal: AbortSignal): Promise<unknown>;
    read(query: AiConversationReferenceDraft, signal: AbortSignal): Promise<unknown> }, closureKey: string, binding: { turnId: string; originalInputRef: string; expectedRevision: number },
    acknowledge: () => void) => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    if (!this.storage || !id(closureKey) || typeof acknowledge !== 'function') throw Error('AI_RESULT_UNKNOWN');
    const controller = new AbortController(); this.request = controller; this.publish({ busy: true, observation: null });
    try {
      const original = this.original(), query = { draftVersion: original.draftVersion, conversationId: original.conversationId, admissionKey: original.admissionKey };
      const admitted = await this.ports.admission(query, controller.signal); this.check(controller.signal);
      const turn = this.observed(admitted, original).result!;
      if (turn.turnId !== binding.turnId || turn.original.inputRef !== binding.originalInputRef) throw Error('AI_RESULT_UNKNOWN');
      const receipt = await reads.operation({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, operationKey: closureKey }, controller.signal); this.check(controller.signal);
      if (!validateAiConversationOperationDraft(receipt, closureKey) || receipt.status !== 'observed' || receipt.conversationId !== this.conversationId
        || !['release_turn', 'close_unstarted'].includes(receipt.operation) || binding.expectedRevision !== original.expectedRevision + 1
        || receipt.revision !== binding.expectedRevision + 1
        || receipt.operation === 'close_unstarted' && (!('creation' in turn) || turn.closeOperationKey !== closureKey)) throw Error('AI_RESULT_UNKNOWN');
      const head = await reads.read({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId }, controller.signal); this.check(controller.signal);
      if (!validateAiConversationObservationDraft(head, { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId })
        || head.status !== 'active' || head.capabilityCode !== original.capabilityCode || head.currentTurn !== null || head.revision !== receipt.revision
        || JSON.stringify(this.original()) !== JSON.stringify(original)) throw Error('AI_RESULT_UNKNOWN');
      const expectedRotation: Rotation = { operationKey: closureKey, ...binding };
      if (original.rotation && JSON.stringify(original.rotation) !== JSON.stringify(expectedRotation)) throw Error('AI_RESULT_UNKNOWN');
      const rotating = { ...original, rotation: expectedRotation }, serialized = JSON.stringify(rotating);
      if (serialized.length > JOURNAL_MAX_LENGTH) throw Error('AI_RESULT_UNKNOWN');
      // This tombstone keeps the old admission recoverable until the closure
      // journal is cleared. An interruption at either write resumes read-only.
      this.storage.setItem(this.key, serialized);
      if (this.storage.getItem(this.key) !== serialized) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ locked: true, rotationPending: true, prepared: false, reviewedInput: null, reviewedSections: null });
      this.check(controller.signal); acknowledge(); this.check(controller.signal);
      if (this.storage.getItem(this.key) !== serialized) throw Error('AI_RESULT_UNKNOWN');
      this.storage.removeItem(this.key); if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      this.command = null; this.publish({ locked: false, rotationPending: false, prepared: false, reviewedInput: null, reviewedSections: null, observation: null, feedback: 'idle' });
    } catch (failure) { if (this.active) this.publish({ locked: true, prepared: false, reviewedInput: null, reviewedSections: null, observation: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
  resumeRotation = async (reads: Parameters<ConversationAdmissionSession['rotate']>[0], closureJournalCleared: () => boolean) => {
    this.check(); const original = this.original();
    if (!original.rotation || !closureJournalCleared()) throw Error('AI_RESULT_UNKNOWN');
    const { operationKey, ...binding } = original.rotation;
    return this.rotate(reads, operationKey, binding, () => { if (!closureJournalCleared()) throw Error('AI_RESULT_UNKNOWN'); });
  };
  send = () => this.run(true);
  reconcile = () => this.run(false);
  private async run(send: boolean) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const original = this.original(), command = this.command && structuredClone(this.command);
    if (send && (original.rotation || !command || !this.state.prepared || command.admissionKey !== original.admissionKey)) throw Error('AI_RESULT_UNKNOWN');
    const controller = new AbortController(); this.request = controller;
    // Once a send is attempted, even an invalid/unknown reply cannot resend it.
    this.command = null; this.publish({ busy: true, locked: true, prepared: false, reviewedInput: null, reviewedSections: null, observation: null });
    try {
      if (send && (command!.conversationId !== original.conversationId || command!.expectedRevision !== original.expectedRevision
        || command!.request.sceneCode !== original.capabilityCode || await commandHash(command!.request) !== original.requestHash)) throw Error('AI_RESULT_UNKNOWN');
      this.check(controller.signal);
      const value = await (send ? this.ports.admit(command!, controller.signal) : this.ports.admission({ draftVersion: original.draftVersion,
        conversationId: original.conversationId, admissionKey: original.admissionKey }, controller.signal));
      this.check(controller.signal); const observation = this.observed(value, original);
      if (JSON.stringify(this.original()) !== JSON.stringify(original)) throw Error('AI_RESULT_UNKNOWN');
      // Keep the locator after success: a later reload must not prepare a new
      // round from a stale empty-conversation observation. Release is separate.
      this.publish({ observation, feedback: 'admitted' }); return observation;
    } catch (failure) { if (this.active) this.publish({ observation: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
}
