/** First explicit order-model start only. Read-only preparation does not grant
 * execution; the original host owns current policy, Gateway, budget and leases.
 * An attempted start stays journaled and can only be observed, never replayed. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestRecoveryDraft, validateAiOrderReadPreparationDraft, validateAiOrderReadStartDraft,
  type AiConversationTurnObservationDraft, type AiConversationTurnReferenceDraft, type AiSceneRequestReadDraft,
  type AiSceneRequestRecoveryDraft, type AiOrderReadPreparationResponseDraft, type AiOrderReadStartResponseDraft } from '@rental-os/shared';

type Ports = {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  recovery(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  orderPreparation(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  orderStart(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
};
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Marker = { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION; conversationId: string; admissionKey: string;
  turnId: string; requestHash: string; originalRequestKey: string; capabilityVersion: string;
  original: AiSceneRequestReadDraft; task: { taskId: string; runId: string } };
type Observation = { preparation: AiOrderReadPreparationResponseDraft; recovery: AiSceneRequestRecoveryDraft };
export type ConversationOrderExecutionState = Readonly<{ busy: boolean; locked: boolean; ready: boolean;
  observation: Observation | null; acknowledgement: AiOrderReadStartResponseDraft | null; feedback: 'idle' | 'unknown' | 'observed' }>;
const closed = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(v);
function marker(v: unknown, conversationId: string): v is Marker {
  return closed(v, ['draftVersion', 'conversationId', 'admissionKey', 'turnId', 'requestHash', 'originalRequestKey', 'capabilityVersion', 'original', 'task'])
    && v.draftVersion === AI_CONVERSATION_DRAFT_VERSION && v.conversationId === conversationId
    && id(v.admissionKey) && v.admissionKey.length <= 128 && id(v.turnId) && id(v.originalRequestKey) && v.originalRequestKey.length <= 128
    && id(v.capabilityVersion) && typeof v.requestHash === 'string' && /^[a-f0-9]{64}$/u.test(v.requestHash)
    && closed(v.original, ['draftVersion', 'inputRef']) && v.original.draftVersion === AI_SCENE_REQUEST_DRAFT_VERSION && id(v.original.inputRef)
    && closed(v.task, ['taskId', 'runId']) && id(v.task.taskId) && id(v.task.runId);
}
const firstStart = (value: Observation) => value.preparation.original.state === 'stored'
  && value.preparation.preparation.publishedInputs === 0 && !value.preparation.preparation.planPublished
  && 'steps' in value.recovery && value.recovery.task.state === 'observed' && value.recovery.task.status === 'queued' && value.recovery.task.revision === 1
  && value.recovery.task.plan === 'not_observed' && !value.recovery.task.resultAvailable && !value.recovery.hasMore && !value.recovery.steps.length;
export class ConversationOrderExecutionSession {
  private active = true; private request: AbortController | null = null; private listeners = new Set<() => void>();
  private prepared: Marker | null = null; private state: ConversationOrderExecutionState;
  constructor(private readonly conversationId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Storage | undefined, private readonly key: string) {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* unreadable marker cannot permit execution */ }
    this.state = Object.freeze({ busy: false, locked, ready: false, observation: null, acknowledgement: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  activate() { this.active = true; }
  retract() { this.prepared = null; this.request?.abort(); this.publish({ ready: false, observation: null, acknowledgement: null }); }
  dispose() { this.active = false; this.prepared = null; this.request?.abort(); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  private publish(patch: Partial<ConversationOrderExecutionState>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const fn of this.listeners) fn(); }
  private original() {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
    const value: unknown = JSON.parse(raw); if (!marker(value, this.conversationId)) throw Error('AI_RESULT_UNKNOWN'); return value;
  }
  private binding(turn: AiConversationTurnObservationDraft): Marker {
    if (!validateAiConversationTurnDraft(turn) || turn.capabilityCode !== 'order_explanation' || turn.material !== 'retained' || !turn.task || 'creation' in turn)
      throw Error('AI_RESOURCE_UNAVAILABLE');
    return { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId, admissionKey: turn.admissionKey,
      turnId: turn.turnId, requestHash: turn.requestHash, originalRequestKey: turn.originalRequestKey, capabilityVersion: turn.capabilityVersion,
      original: structuredClone(turn.original), task: structuredClone(turn.task) };
  }
  private async turn(original: Marker, signal: AbortSignal) {
    this.check(signal);
    const query = { draftVersion: original.draftVersion, conversationId: original.conversationId, admissionKey: original.admissionKey };
    const packet = await this.ports.admission(structuredClone(query), signal); this.check(signal);
    if (!validateAiConversationAdmissionDraft(packet, query) || !packet.result
      || JSON.stringify(this.binding(packet.result)) !== JSON.stringify(original)) throw Error('AI_REVISION_CONFLICT');
    return packet.result;
  }
  private async observe(original: Marker, signal: AbortSignal): Promise<Observation> {
    const turn = await this.turn(original, signal);
    const recovery = await this.ports.recovery(structuredClone(original.original), signal); this.check(signal);
    if (!validateAiSceneRequestRecoveryDraft(recovery) || recovery.task.state !== 'observed'
      || recovery.task.taskId !== original.task.taskId || recovery.task.runId !== original.task.runId) throw Error('AI_RESOURCE_UNAVAILABLE');
    const preparation = await this.ports.orderPreparation(structuredClone(original.original), signal); this.check(signal);
    if (!validateAiOrderReadPreparationDraft(preparation, original.original, turn)) throw Error('AI_RESOURCE_UNAVAILABLE');
    await this.turn(original, signal);
    const latest = await this.ports.recovery(structuredClone(original.original), signal); this.check(signal);
    if (!validateAiSceneRequestRecoveryDraft(latest) || JSON.stringify(latest) !== JSON.stringify(recovery)) throw Error('AI_REVISION_CONFLICT');
    return structuredClone({ preparation, recovery });
  }
  inspect = (selected: AiConversationTurnObservationDraft) => this.run(false, this.binding(selected));
  reconcile = () => this.run(false, this.original());
  start = async () => {
    if (!this.prepared || !this.state.ready || this.state.locked) throw Error('AI_RESULT_UNKNOWN');
    return this.run(true, structuredClone(this.prepared));
  };
  private async run(start: boolean, original: Marker) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    if (!marker(original, this.conversationId)) throw Error('AI_INVALID_INPUT');
    const controller = new AbortController(); this.request = controller;
    this.prepared = null; this.publish({ busy: true, ready: false, observation: null, acknowledgement: null });
    try {
      const stored = this.storage?.getItem(this.key);
      if (!this.storage || start && stored !== null || stored !== null && JSON.stringify(this.original()) !== JSON.stringify(original)) throw Error('AI_RESULT_UNKNOWN');
      const observation = await this.observe(original, controller.signal);
      if (start) {
        if (!firstStart(observation) || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
        const raw = JSON.stringify(original); if (raw.length > 2048) throw Error('AI_INVALID_INPUT');
        this.publish({ locked: true }); this.storage.setItem(this.key, raw);
        if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
        this.check(controller.signal);
        const value = await this.ports.orderStart(structuredClone(original.original), controller.signal); this.check(controller.signal);
        const turn = await this.turn(original, controller.signal);
        if (!validateAiOrderReadStartDraft(value, original.original, turn) || this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
        this.publish({ acknowledgement: structuredClone(value), feedback: 'observed' }); return value;
      }
      if (this.storage.getItem(this.key) !== stored) throw Error('AI_RESULT_UNKNOWN');
      const ready = stored === null && !this.state.locked && firstStart(observation);
      this.prepared = ready ? original : null;
      this.publish({ locked: stored !== null || this.state.locked, ready, observation, feedback: 'observed' }); return observation;
    } catch (failure) { if (this.active) this.publish({ ready: false, observation: null, acknowledgement: null, feedback: 'unknown' }); throw failure; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
}
