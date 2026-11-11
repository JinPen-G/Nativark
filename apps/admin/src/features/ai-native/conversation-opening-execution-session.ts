/** Explicit first opening/quote model start on the admitted original Task/Run.
 * The minimal marker is saved before dispatch. Reopening/unknown only observes
 * the original receipt; neither local state nor metadata grants execution. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestReceiptDraft, validateAiSceneRequestRecoveryDraft, validateAiSceneModelStartDraft,
  type AiConversationTurnObservationDraft, type AiConversationTurnReferenceDraft, type AiSceneRequestReadDraft,
  type AiSceneRequestReceiptDraft, type AiTaskSceneReadDraft, type AiTaskSceneObservationDraft,
  type AiSceneRequestRecoveryDraft, type AiSceneModelStartResponseDraft } from '@rental-os/shared';
import { validateTaskCenterSnapshot } from './task-center-reader';

type Ports = {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  originalReceipt(query: Extract<AiTaskSceneReadDraft, { kind: 'original' }>, signal: AbortSignal): Promise<unknown>;
  recovery(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  openingStart?(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  quoteStart?(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
};
type Marker = AiConversationTurnReferenceDraft & { turnId: string; requestHash: string; originalRequestKey: string;
  capabilityCode: 'opening_diagnosis' | 'quote_clarification'; capabilityVersion: string; original: AiSceneRequestReadDraft;
  task: { taskId: string; runId: string } };
type Observation = { source: Pick<Extract<AiTaskSceneObservationDraft, { kind: 'original' }>, 'kind' | 'task' | 'snapshot'>; receipt: AiSceneRequestReceiptDraft;
  recovery: Extract<AiSceneRequestRecoveryDraft, { steps: unknown }> };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export type ConversationOpeningExecutionState = Readonly<{ busy: boolean; locked: boolean; ready: boolean;
  observation: Observation | null; acknowledgement: AiSceneModelStartResponseDraft | null; feedback: 'idle' | 'observed' | 'unknown' }>;
const signature = (value: unknown) => JSON.stringify(value);
const firstStart = (value: Observation, now: number) => value.receipt.state === 'stored'
  && Date.parse(value.receipt.expiresAt) > now && value.recovery.task.status === 'queued'
  && value.recovery.task.revision === 1 && value.recovery.task.plan === 'not_observed' && !value.recovery.task.resultAvailable
  && !value.recovery.hasMore && !value.recovery.steps.length && value.source.snapshot.availability === 'available'
  && !value.source.snapshot.value.steps.length;

export class ConversationSceneExecutionSession {
  private active = true; private request: AbortController | null = null; private prepared: Marker | null = null;
  private listeners = new Set<() => void>(); private state: ConversationOpeningExecutionState;
  constructor(private readonly conversationId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Storage | undefined, private readonly key: string, private readonly now = () => Date.now(),
    private readonly capabilityCode: Marker['capabilityCode'] = 'opening_diagnosis') {
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* no reliable original key means no start */ }
    this.state = Object.freeze({ busy: false, locked, ready: false, observation: null, acknowledgement: null, feedback: locked ? 'unknown' : 'idle' });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  retract() { this.prepared = null; this.request?.abort(); this.publish({ ready: false, observation: null, acknowledgement: null }); }
  dispose() { this.active = false; this.prepared = null; this.request?.abort(); }
  private publish(patch: Partial<ConversationOpeningExecutionState>) { this.state = Object.freeze({ ...this.state, ...patch }); this.listeners.forEach(fn => fn()); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  private binding(turn: AiConversationTurnObservationDraft): Marker {
    if (!validateAiConversationTurnDraft(turn) || turn.capabilityCode !== this.capabilityCode || turn.material !== 'retained'
      || !turn.task || 'creation' in turn) throw Error('AI_RESOURCE_UNAVAILABLE');
    return { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: this.conversationId, admissionKey: turn.admissionKey,
      turnId: turn.turnId, requestHash: turn.requestHash, originalRequestKey: turn.originalRequestKey,
      capabilityCode: this.capabilityCode, capabilityVersion: turn.capabilityVersion, original: structuredClone(turn.original), task: structuredClone(turn.task) };
  }
  private original(): Marker {
    const raw = this.storage?.getItem(this.key); if (!raw || raw.length > 2048) throw Error('AI_RESULT_UNKNOWN');
    const value: unknown = JSON.parse(raw), keys = ['draftVersion', 'conversationId', 'admissionKey', 'turnId', 'requestHash',
      'originalRequestKey', 'capabilityCode', 'capabilityVersion', 'original', 'task'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
      || !Object.keys(value).every(key => keys.includes(key))) throw Error('AI_RESULT_UNKNOWN');
    const marker = value as Marker;
    if (marker.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || marker.conversationId !== this.conversationId
      || marker.capabilityCode !== this.capabilityCode) throw Error('AI_RESULT_UNKNOWN');
    return marker;
  }
  private async turn(marker: Marker, signal: AbortSignal) {
    this.check(signal); const query = { draftVersion: marker.draftVersion, conversationId: this.conversationId, admissionKey: marker.admissionKey };
    const packet = await this.ports.admission(query, signal); this.check(signal);
    if (!validateAiConversationAdmissionDraft(packet, query) || !packet.result || signature(this.binding(packet.result)) !== signature(marker))
      throw Error('AI_REVISION_CONFLICT');
    return packet.result;
  }
  private source(value: unknown, marker: Marker): Observation {
    const source = value as Extract<AiTaskSceneObservationDraft, { kind: 'original' }>;
    if (!source || source.kind !== 'original' || source.taskId !== marker.task.taskId || source.runId !== marker.task.runId
      || source.originRunId !== marker.task.runId || !source.originalInput || !source.task || !source.snapshot
      || source.snapshot.availability !== 'available' || source.consistency !== 'independent_authorized_reads'
      || source.execution !== 'read_only_no_start_no_reconnect_side_effect') throw Error('AI_RESOURCE_UNAVAILABLE');
    const receipt = source.originalInput.receipt, original = source.task.original;
    if (!validateAiSceneRequestReceiptDraft(receipt, marker.original, marker) || receipt.state === 'revoked'
      || !original || typeof original !== 'object' || !('receipt' in original)
      || !validateAiSceneRequestReceiptDraft(original.receipt, marker.original, marker)
      || signature(original.receipt) !== signature(receipt) || original.inputRef !== marker.original.inputRef
      || original.inputHash !== receipt.contentHash || original.inputRevision !== receipt.revision
      || original.sceneCode !== marker.capabilityCode || original.sceneVersion !== marker.capabilityVersion || original.audience !== 'operator'
      || original.scope?.kind !== 'workspace' || !original.scope.tenantId || !original.scope.workspaceId
      || !('result' in source.task) || source.task.execution !== 'read_only_no_start_no_reconnect_side_effect'
      || source.task.result.execution !== 'not_inferred_from_metadata') throw Error('AI_RESOURCE_UNAVAILABLE');
    const recovery = source.task.recovery;
    if (!validateAiSceneRequestRecoveryDraft(recovery) || recovery.task.state !== 'observed' || !('steps' in recovery)
      || recovery.task.taskId !== marker.task.taskId || recovery.task.runId !== marker.task.runId
      || signature(source.task.task) !== signature(recovery.task)
      || source.task.result.status !== (recovery.task.resultAvailable ? 'available_to_authorized_result_reader' : 'not_available')) throw Error('AI_RESOURCE_UNAVAILABLE');
    const snapshot = validateTaskCenterSnapshot(source.snapshot.value, marker.task.taskId);
    if (snapshot.sceneCode !== marker.capabilityCode || snapshot.sceneVersion !== marker.capabilityVersion
      || snapshot.revision !== recovery.task.revision || snapshot.status !== recovery.task.status
      || recovery.steps.some(step => !snapshot.steps.some(row => row.stepId === step.stepId && row.runId === step.runId && row.status === step.status))) throw Error('AI_REVISION_CONFLICT');
    // The source also returns the admitted body. This execution control needs
    // only its validated provenance and watermarks, never a retained body.
    return { source: { kind: source.kind, task: source.task, snapshot: source.snapshot }, receipt, recovery };
  }
  private sourceBinding(value: Observation) {
    // Source request IDs and observation times may change between reads. The
    // original binding and persisted Task/step watermarks must remain stable.
    return signature({ receipt: value.receipt, original: value.source.task.original,
      task: value.source.task.task, snapshot: value.source.snapshot, recovery: value.recovery });
  }
  private async observe(marker: Marker, signal: AbortSignal): Promise<Observation> {
    await this.turn(marker, signal);
    const query = { kind: 'original' as const, ...structuredClone(marker.task), original: structuredClone(marker.original) };
    const source = this.source(await this.ports.originalReceipt(query, signal), marker); this.check(signal);
    const recovery = await this.ports.recovery(structuredClone(marker.original), signal); this.check(signal);
    if (!validateAiSceneRequestRecoveryDraft(recovery) || recovery.task.state !== 'observed' || !('steps' in recovery)
      || recovery.task.taskId !== marker.task.taskId || recovery.task.runId !== marker.task.runId
      || signature(source.recovery) !== signature(recovery)) throw Error('AI_RESOURCE_UNAVAILABLE');
    await this.turn(marker, signal);
    const closing = this.source(await this.ports.originalReceipt(query, signal), marker); this.check(signal);
    if (this.sourceBinding(closing) !== this.sourceBinding(source)) throw Error('AI_REVISION_CONFLICT');
    await this.turn(marker, signal); this.check(signal);
    return structuredClone(source);
  }
  inspect = (turn: AiConversationTurnObservationDraft) => this.run(false, this.binding(turn));
  reconcile = () => this.run(false, this.original());
  start = async () => {
    if (!this.prepared || !this.state.ready || this.state.locked) throw Error('AI_RESULT_UNKNOWN');
    return this.run(true, structuredClone(this.prepared));
  };
  private async run(start: boolean, marker: Marker) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const controller = new AbortController(); this.request = controller; this.prepared = null;
    this.publish({ busy: true, ready: false, observation: null, acknowledgement: null });
    try {
      const stored = this.storage?.getItem(this.key);
      if (!this.storage || start && stored !== null || stored !== null && signature(this.original()) !== signature(marker)) throw Error('AI_RESULT_UNKNOWN');
      const observation = await this.observe(marker, controller.signal);
      if (start) {
        if (!firstStart(observation, this.now()) || this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
        const execute = this.capabilityCode === 'opening_diagnosis' ? this.ports.openingStart : this.ports.quoteStart;
        if (typeof execute !== 'function') throw Error('AI_RESOURCE_UNAVAILABLE');
        const raw = signature(marker); if (raw.length > 2048) throw Error('AI_INVALID_INPUT');
        this.publish({ locked: true }); this.storage.setItem(this.key, raw);
        if (this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
        this.check(controller.signal);
        const reply = await execute.call(this.ports, structuredClone(marker.original), controller.signal); this.check(controller.signal);
        const turn = await this.turn(marker, controller.signal);
        if (!validateAiSceneModelStartDraft(reply, marker.original, turn)
          || signature(reply.original) !== signature(observation.receipt) || this.storage.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
        this.publish({ acknowledgement: structuredClone(reply), feedback: 'observed' }); return reply;
      }
      if (this.storage.getItem(this.key) !== stored) throw Error('AI_RESULT_UNKNOWN');
      const ready = stored === null && !this.state.locked && firstStart(observation, this.now()); this.prepared = ready ? marker : null;
      this.publish({ locked: stored !== null || this.state.locked, ready, observation, feedback: 'observed' }); return observation;
    } catch (error) { if (this.active) this.publish({ ready: false, observation: null, acknowledgement: null, feedback: 'unknown' }); throw error; }
    finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
}
/** Compatibility name for the existing opening consumer and its journals. */
export { ConversationSceneExecutionSession as ConversationOpeningExecutionSession };
