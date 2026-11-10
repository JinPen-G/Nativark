/** Explicit original Task metadata creation, never plan/model dispatch. Journal
 * the admitted reference before sending; uncertainty only reads that reference.
 * Neither an absent Task nor a local marker permits replay or a new key. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneCreatedTaskDraft, validateAiSceneRequestRecoveryDraft,
  type AiConversationTurnReferenceDraft, type AiConversationTurnObservationDraft,
  type AiSceneRequestReadDraft, type AiSceneRequestRecoveryDraft } from '@rental-os/shared';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Marker = AiConversationTurnReferenceDraft & { turnId: string; requestHash: string; original: AiSceneRequestReadDraft;
  capabilityCode?: 'order_explanation' | 'opening_diagnosis' | 'quote_clarification'; capabilityVersion?: string };
type Ports = {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  createTask(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  recovery(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
};
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
function marker(value: unknown, conversationId: string): value is Marker {
  const scoped = !!value && typeof value === 'object' && Object.hasOwn(value, 'capabilityCode');
  // Legacy journals belong to orders only. New setup journals pin capability
  // and version so a reload cannot cross into another scene's Task creation.
  return closed(value, ['draftVersion', 'conversationId', 'admissionKey', 'turnId', 'requestHash', 'original',
    ...(scoped ? ['capabilityCode', 'capabilityVersion'] : [])])
    && (!scoped || ['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(value.capabilityCode as string) && id(value.capabilityVersion))
    && value.draftVersion === AI_CONVERSATION_DRAFT_VERSION && value.conversationId === conversationId
    && id(value.admissionKey) && (value.admissionKey as string).length <= 128 && id(value.turnId)
    && typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/u.test(value.requestHash)
    && closed(value.original, ['draftVersion', 'inputRef']) && value.original.draftVersion === AI_SCENE_REQUEST_DRAFT_VERSION
    && typeof value.original.inputRef === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value.original.inputRef);
}
export type ConversationTaskCreationState = Readonly<{ busy: boolean; locked: boolean;
  recovery: AiSceneRequestRecoveryDraft | null; feedback: 'idle' | 'unknown' | 'observed' }>;
export class ConversationTaskCreationSession {
  private active = true; private request: AbortController | null = null; private listeners = new Set<() => void>();
  private state: ConversationTaskCreationState;
  constructor(private readonly conversationId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Storage | undefined, private readonly key: string) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* fail closed */ }
    this.state = Object.freeze({ busy: false, locked, recovery: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.request?.abort(); this.publish({ recovery: null }); }
  dispose() { this.active = false; this.request?.abort(); }
  private publish(patch: Partial<ConversationTaskCreationState>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) listener(); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  private original() {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
    const value: unknown = JSON.parse(raw); if (!marker(value, this.conversationId)) throw Error('AI_RESULT_UNKNOWN');
    return { value, raw };
  }
  private async turn(original: Marker, signal: AbortSignal) {
    const query = { draftVersion: original.draftVersion, conversationId: original.conversationId, admissionKey: original.admissionKey };
    const value = await this.ports.admission(structuredClone(query), signal); this.check(signal);
    if (!validateAiConversationAdmissionDraft(value, query) || !value.result || value.result.turnId !== original.turnId
      || value.result.requestHash !== original.requestHash || value.result.original.inputRef !== original.original.inputRef
      || value.result.capabilityCode !== (original.capabilityCode ?? 'order_explanation')
      || original.capabilityVersion !== undefined && value.result.capabilityVersion !== original.capabilityVersion) throw Error('AI_RESULT_UNKNOWN');
    return value.result;
  }
  private async observe(original: Marker, signal: AbortSignal) {
    await this.turn(original, signal);
    const value = await this.ports.recovery(structuredClone(original.original), signal); this.check(signal);
    if (!validateAiSceneRequestRecoveryDraft(value)) throw Error('AI_RESULT_UNKNOWN');
    const turn = await this.turn(original, signal);
    if (value.task.state === 'observed' ? !turn.task || turn.task.taskId !== value.task.taskId || turn.task.runId !== value.task.runId : turn.task !== null)
      throw Error('AI_RESULT_UNKNOWN');
    if (JSON.stringify(this.original().value) !== JSON.stringify(original)) throw Error('AI_RESULT_UNKNOWN');
    return structuredClone(value);
  }
  create = async (selected: AiConversationTurnObservationDraft) => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    if (this.state.locked || !this.storage || !validateAiConversationTurnDraft(selected) || !['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(selected.capabilityCode)
      || selected.material !== 'retained' || selected.task || 'creation' in selected) throw Error('AI_RESULT_UNKNOWN');
    const original: Marker = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId,
      admissionKey: selected.admissionKey, turnId: selected.turnId, requestHash: selected.requestHash, original: structuredClone(selected.original),
      capabilityCode: selected.capabilityCode as Marker['capabilityCode'], capabilityVersion: selected.capabilityVersion };
    if (!marker(original, this.conversationId)) throw Error('AI_INVALID_INPUT');
    const controller = new AbortController(); this.request = controller; this.publish({ busy: true, recovery: null });
    try {
      if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const current = await this.turn(original, controller.signal);
      if (current.material !== 'retained' || current.task || 'creation' in current) throw Error('AI_RESULT_UNKNOWN');
      if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = JSON.stringify(original); if (raw.length > 2048) throw Error('AI_INVALID_INPUT');
      this.publish({ locked: true }); this.storage.setItem(this.key, raw);
      if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
      this.check(controller.signal);
      const created = await this.ports.createTask(structuredClone(original.original), controller.signal); this.check(controller.signal);
      if (!validateAiSceneCreatedTaskDraft(created)) throw Error('AI_RESULT_UNKNOWN');
      const recovery = await this.observe(original, controller.signal);
      if (recovery.task.state !== 'observed' || recovery.task.taskId !== created.taskId || recovery.task.runId !== created.runId) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ recovery, feedback: 'observed' }); return recovery;
    } catch (failure) { if (this.active) this.publish({ recovery: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
  reconcile = async () => {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const controller = new AbortController(); this.request = controller; this.publish({ busy: true, recovery: null });
    try {
      const { value } = this.original(), recovery = await this.observe(value, controller.signal);
      this.publish({ locked: true, recovery, feedback: recovery.task.state === 'observed' ? 'observed' : 'unknown' }); return recovery;
    } catch (failure) { if (this.active) this.publish({ locked: true, recovery: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  };
}
