/** Current-order adapter for the existing conversation and model sessions.
 * Only explicit submission writes. Recovery keeps the original journals and
 * reads their receipts. Page context supplies an order locator, never facts. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationOperationDraft, validateAiConversationAdmissionDraft, validateAiOrderReadFactsDraft,
  type AiConversationTurnObservationDraft, type AiOrderReadFactsDraft, type AiSceneRequestReadDraft, type AiTaskSnapshotDraft } from '@rental-os/shared';
import type { aiConversationsApi } from '@/api/aiConversations';
import { ConversationLifecycleSession } from '../ai-native/conversation-lifecycle-session';
import { ConversationAdmissionSession } from '../ai-native/conversation-admission-session';
import { ConversationOrderExecutionSession } from '../ai-native/conversation-order-execution-session';
import { ConversationTaskCreationSession } from '../ai-native/conversation-task-creation-session';
import { readConversationOrderResults } from '../ai-native/conversation-order-results-reader';
import { validateTaskCenterSnapshot } from '../ai-native/task-center-reader';
import { commandHash } from '../ai-native/budget-settings-session';
import type { LiveVisibleObservationSession, VisibleOrigin } from '../ai-native/visible-observation-session';

export type OrderQuestion = 'status' | 'fees' | 'payments' | 'next_steps';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Ports = Pick<typeof aiConversationsApi, 'create' | 'archive' | 'delete' | 'operation' | 'admit' | 'admission'
  | 'orderPreparation' | 'orderStart' | 'createTask' | 'recovery' | 'detail' | 'result' | 'orderFacts' | 'orderAnswer'>
  & { snapshot(taskId: string, signal: AbortSignal): Promise<AiTaskSnapshotDraft> };
type Locator = { version: 1; createKey: string; conversationId: string | null };
export type CopilotOrderTextSource = Readonly<{ conversationId: string; turnId: string; taskId: string; runId: string; resultId: string }>;
export type CopilotOrderState = Readonly<{
  phase: 'idle' | 'preparing' | 'running' | 'observed' | 'unknown' | 'unavailable';
  conversationId: string | null; taskId: string | null; runId: string | null;
  text: string; textSource: CopilotOrderTextSource | null; facts: AiOrderReadFactsDraft | null;
  steps: AiTaskSnapshotDraft['steps']; complete: boolean; hasOriginal: boolean;
}>;
const initial = (): CopilotOrderState => ({ phase: 'idle', conversationId: null, taskId: null, runId: null,
  text: '', textSource: null, facts: null, steps: [], complete: false, hasOriginal: false });
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(v);
function locator(raw: string): Locator {
  if (raw.length > 512) throw Error('AI_RESULT_UNKNOWN');
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== 'conversationId,createKey,version'
    || value.version !== 1 || !id(value.createKey) || value.createKey.length > 128
    || value.conversationId !== null && !id(value.conversationId)) throw Error('AI_RESULT_UNKNOWN');
  return value;
}

export class CopilotOrderSession {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private request: AbortController | null = null;
  private held: string | null = null;
  private completedReference: string | null = null;
  private lifecycle: ConversationLifecycleSession | null = null;
  private admission: ConversationAdmissionSession | null = null;
  private execution: ConversationOrderExecutionSession | null = null;
  private creation: ConversationTaskCreationSession | null = null;
  private visibleWindow: { host: LiveVisibleObservationSession; key: string } | null = null;
  private readonly key: string;
  constructor(private readonly ports: Ports, private readonly storage: StoragePort | null,
    private readonly identity: string, readonly orderId: string, private readonly current: () => boolean,
    private readonly newKey = () => crypto.randomUUID(),
    private readonly visibleHost: () => LiveVisibleObservationSession | null = () => null) {
    this.key = `ai-copilot-order:${identity}:${orderId}`;
    try {
      this.held = storage?.getItem(this.key) ?? null;
      if (this.held) {
        const saved = locator(this.held);
        this.state = { ...initial(), hasOriginal: true, conversationId: saved.conversationId };
      }
    } catch { this.state = { ...initial(), hasOriginal: true, phase: 'unknown' }; }
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<CopilotOrderState>) {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  activate = () => { this.active = true; };
  retract = () => {
    this.cancelVisible();
    this.active = false; this.generation++; this.request?.abort(); this.request = null;
    this.lifecycle?.retract(); this.admission?.retract(); this.creation?.retract(); this.execution?.retract();
    this.publish({ text: '', textSource: null, facts: null, steps: [], complete: false,
      phase: this.state.hasOriginal ? 'unknown' : 'idle' });
  };
  dispose = () => { this.retract(); };
  private check(signal?: AbortSignal) {
    if (!this.active || !this.current() || signal?.aborted || !id(this.orderId)) throw Error('AI_SCOPE_CHANGED');
    if (!this.storage || this.storage.getItem(this.key) !== this.held) throw Error('AI_RESULT_UNKNOWN');
  }
  observationCurrent = () => { try { this.check(); return true; } catch { return false; } };
  private cancelVisible() {
    const window = this.visibleWindow; this.visibleWindow = null;
    try { window?.host.cancel(window.key); } catch { /* observation has an independent lifetime */ }
  }
  private beginVisible(origin: VisibleOrigin) {
    this.cancelVisible();
    try {
      const host = this.visibleHost(), key = host?.begin(origin);
      if (host && key) this.visibleWindow = { host, key };
    } catch { /* browser observation cannot own the original execution */ }
  }
  private persist(value: Locator) {
    this.check(); const raw = JSON.stringify(value); locator(raw);
    // Once storage is attempted, a failed read-back must retain an unknown
    // original in this page even when the browser reports a storage failure.
    this.publish({ hasOriginal: true });
    this.storage!.setItem(this.key, raw);
    if (this.storage!.getItem(this.key) !== raw) throw Error('AI_RESULT_UNKNOWN');
    this.held = raw;
    this.publish({ hasOriginal: true, conversationId: value.conversationId });
  }
  private sessions(value: Locator) {
    const current = () => this.active && this.current() && this.storage?.getItem(this.key) === this.held;
    if (!this.lifecycle) this.lifecycle = new ConversationLifecycleSession(this.ports, current, this.storage ?? undefined,
      `ai-copilot-order-create:${this.identity}:${value.createKey}`, this.newKey, true);
    this.lifecycle.activate();
    if (value.conversationId && !this.admission) this.admission = new ConversationAdmissionSession(value.conversationId,
      this.ports, current, this.storage ?? undefined, `ai-conversation-admission:${this.identity}:${value.conversationId}`, this.newKey);
    this.admission?.activate();
  }
  private bindExecution(conversationId: string, turn: AiConversationTurnObservationDraft) {
    this.execution?.dispose();
    const bound = structuredClone(turn), start = this.ports.orderStart.bind(this.ports);
    const ports = { admission: this.ports.admission.bind(this.ports), recovery: this.ports.recovery.bind(this.ports),
      orderPreparation: this.ports.orderPreparation.bind(this.ports),
      orderStart: async (query: AiSceneRequestReadDraft, signal: AbortSignal) => {
        this.check(signal);
        // The original session has already stored and read back its start marker.
        if (bound.task && query.inputRef === bound.original.inputRef) this.beginVisible({ taskId: bound.task.taskId,
          runId: bound.task.runId, trigger: 'original_model_start', originKey: query.inputRef, conversationId, turnId: bound.turnId });
        try { return await start(query, signal); }
        catch (error) { this.cancelVisible(); throw error; }
      } };
    this.execution = new ConversationOrderExecutionSession(conversationId, ports,
      () => this.active && this.current() && this.storage?.getItem(this.key) === this.held, this.storage ?? undefined,
      `ai-conversation-order-start:${this.identity}:${conversationId}:${turn.admissionKey}`);
    this.execution.activate();
    return this.execution;
  }
  private async conversation(signal: AbortSignal) {
    this.check(signal);
    if (!this.held) throw Error('AI_RESULT_UNKNOWN');
    const value = locator(this.held);
    this.sessions(value);
    if (!value.conversationId) {
      await this.lifecycle!.reconcile(); this.check(signal);
      const receipt = this.lifecycle!.snapshot().receipt;
      if (!receipt || receipt.status !== 'observed' || receipt.operation !== 'create') throw Error('AI_RESULT_UNKNOWN');
      value.conversationId = receipt.conversationId; this.persist(value); this.sessions(value);
    }
    const detail = await this.ports.detail({ draftVersion: AI_CONVERSATION_DRAFT_VERSION,
      conversationId: value.conversationId!, limit: 20 }, 'order_explanation', signal, true);
    this.check(signal);
    if (detail.conversation.conversationId !== value.conversationId) throw Error('AI_RESOURCE_UNAVAILABLE');
    return detail.conversation;
  }
  private async observe(conversationId: string, turn: AiConversationTurnObservationDraft, signal: AbortSignal) {
    if (!turn.task || turn.material !== 'retained' || 'creation' in turn) throw Error('AI_RESOURCE_UNAVAILABLE');
    const result = await this.ports.result({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId,
      admissionKey: turn.admissionKey }, turn, signal); this.check(signal);
    if (result.status !== 'observed' || result.result.status !== 'available') throw Error('AI_RESULT_UNKNOWN');
    const { facts, answer } = await readConversationOrderResults(this.ports, conversationId, turn, signal,
      () => this.active && this.current()); this.check(signal);
    if (!validateAiOrderReadFactsDraft(facts, turn.original, turn) || facts.result.status !== 'available'
      || facts.result.facts.order.id !== this.orderId || answer.result.status !== 'available'
      || answer.result.resultId !== result.result.resultId) throw Error('AI_REVISION_CONFLICT');
    const task = validateTaskCenterSnapshot(await this.ports.snapshot(turn.task.taskId, signal), turn.task.taskId);
    this.check(signal);
    if (task.sceneCode !== 'order_explanation') throw Error('AI_RESOURCE_UNAVAILABLE');
    this.completedReference = task.status === 'succeeded' ? JSON.stringify([conversationId, turn.turnId, turn.task.runId]) : null;
    this.publish({ phase: 'observed', conversationId, taskId: turn.task.taskId, runId: result.result.runId,
      textSource: { conversationId, turnId: turn.turnId, taskId: turn.task.taskId, runId: result.result.runId,
        resultId: result.result.resultId },
      text: result.result.text!.value, facts: facts.result.facts, steps: task.steps.filter(step => step.runId === turn.task!.runId),
      complete: task.status === 'succeeded' });
  }
  private async run(work: (signal: AbortSignal) => Promise<void>) {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const controller = new AbortController(), generation = this.generation;
    this.completedReference = null;
    this.request = controller; this.publish({ phase: 'preparing', text: '', textSource: null, facts: null, steps: [], complete: false });
    try { await work(controller.signal); }
    catch (error) {
      this.cancelVisible();
      if (this.active && generation === this.generation && this.current()) this.publish({ text: '', textSource: null, facts: null, steps: [],
        phase: this.state.hasOriginal ? 'unknown' : 'unavailable', complete: false });
      throw error;
    } finally { if (this.request === controller) this.request = null; }
  }
  /** Confirmation authorizes this single original create/admit/start chain. */
  submit = (question: OrderQuestion) => this.run(async signal => {
    if (!['status', 'fees', 'payments', 'next_steps'].includes(question) || this.state.hasOriginal || this.held)
      throw Error('AI_RESULT_UNKNOWN');
    const value: Locator = { version: 1, createKey: this.newKey(), conversationId: null };
    this.persist(value); this.sessions(value);
    const receipt = await this.lifecycle!.create('order_explanation'); this.check(signal);
    if (!receipt || receipt.status !== 'observed' || receipt.operation !== 'create') throw Error('AI_RESULT_UNKNOWN');
    value.conversationId = receipt.conversationId; this.persist(value); this.sessions(value);
    const conversation = await this.conversation(signal);
    if (conversation.currentTurn) throw Error('AI_REVISION_CONFLICT');
    await this.admission!.prepare(conversation, this.orderId, question); this.check(signal);
    await this.admission!.send(); this.check(signal);
    let turn = this.admission!.snapshot().observation?.result;
    if (!turn) throw Error('AI_RESULT_UNKNOWN');
    if (!turn.task) {
      this.creation = new ConversationTaskCreationSession(value.conversationId!, this.ports,
        () => this.active && this.current() && this.storage?.getItem(this.key) === this.held, this.storage ?? undefined,
        `ai-conversation-task-creation:${this.identity}:${value.conversationId}:${turn.admissionKey}`);
      await this.creation.create(turn); this.check(signal);
      turn = (await this.conversation(signal)).currentTurn;
      if (!turn?.task) throw Error('AI_RESULT_UNKNOWN');
    }
    const execution = this.bindExecution(value.conversationId!, turn);
    await execution.inspect(turn); this.check(signal);
    if (!execution.snapshot().ready) throw Error('AI_RESOURCE_UNAVAILABLE');
    this.publish({ phase: 'running', taskId: turn.task!.taskId, runId: turn.task!.runId });
    await execution.start(); this.check(signal);
    if (!execution.snapshot().acknowledgement || execution.snapshot().feedback === 'unknown') this.cancelVisible();
    await this.observe(value.conversationId!, turn, signal);
  });
  /** Reads never call create, admit, createTask or orderStart. */
  read = () => {
    this.cancelVisible();
    return this.run(async signal => {
      const conversation = await this.conversation(signal), turn = conversation.currentTurn;
      if (!turn) {
        const proof = conversation.closedTurn;
        if (!proof || conversation.status !== 'active' || conversation.revision !== 3) throw Error('AI_RESULT_UNKNOWN');
        const hashes = await Promise.all(['status','fees','payments','next_steps'].map(question => commandHash({ sceneCode: 'order_explanation', input: { orderId: this.orderId, question } })));
        this.check(signal);
        if (!hashes.includes(proof.requestHash)) throw Error('AI_RESULT_UNKNOWN');
        const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: conversation.conversationId, admissionKey: proof.admissionKey };
        const admission = await this.ports.admission(query, signal); this.check(signal);
        const receipt = await this.ports.operation({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, operationKey: proof.operationKey }, signal); this.check(signal);
        if (!validateAiConversationAdmissionDraft(admission, query) || !admission.result || admission.result.capabilityCode !== 'order_explanation' || admission.result.turnId !== proof.turnId
          || admission.result.original.inputRef !== proof.originalInputRef || admission.result.requestHash !== proof.requestHash
          || !validateAiConversationOperationDraft(receipt, proof.operationKey) || receipt.status !== 'observed' || receipt.revision !== conversation.revision
          || receipt.conversationId !== conversation.conversationId || (receipt.operation === 'close_unstarted'
            ? !('creation' in admission.result) || admission.result.closeOperationKey !== proof.operationKey : receipt.operation !== 'release_turn' || !admission.result.task)) throw Error('AI_RESULT_UNKNOWN');
        if (JSON.stringify(await this.conversation(signal)) !== JSON.stringify(conversation)) throw Error('AI_REVISION_CONFLICT');
        this.completedReference = JSON.stringify([conversation.conversationId, proof.turnId, proof.operationKey]);
        this.publish({ phase: 'observed', complete: true, text: '', facts: null, steps: [], textSource: null, taskId: null, runId: null });
        return;
      }
      await this.observe(conversation.conversationId, turn, signal);
    });
  };
  newChat = async () => {
    this.check();
    if (this.request || this.state.hasOriginal && !this.state.complete) throw Error('AI_RESULT_UNKNOWN');
    if (this.state.hasOriginal) {
      const previous = this.completedReference;
      await this.read(); this.check();
      if (!previous || this.completedReference !== previous || !this.state.complete) throw Error('AI_RESULT_UNKNOWN');
    }
    this.cancelVisible();
    // Retain every previous journal. Only a completed view may release this locator.
    this.storage!.removeItem(this.key);
    if (this.storage!.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
    this.held = null;
    this.lifecycle?.dispose(); this.admission?.dispose(); this.creation?.dispose(); this.execution?.dispose();
    this.lifecycle = null; this.admission = null; this.execution = null;
    this.creation = null;
    this.publish(initial());
  };
}
