/** Headless bridge from an explicit console send to the original conversation,
 * admission, Task and model sessions. Stores locators only. Recovery/history
 * never replay a write; approvals and Core mutations remain in their own hosts. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_QUOTE_GOAL_DRAFT_VERSION, validateAiQuoteGoalInputDraft, validateAiConversationObservationDraft,
  type AiConversationTurnObservationDraft, type AiConversationTaskResultDraft, type AiTaskSnapshotDraft,
  type AiConversationObservationDraft } from '@rental-os/shared';
import type { aiConversationsApi } from '@/api/aiConversations';
import type { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { validateTaskCenterSnapshot } from '../ai-native/task-center-reader';
import type { AgentRunState } from './archive/agent-run/agent-run-state';
import { ConversationLifecycleSession } from '../ai-native/conversation-lifecycle-session';
import { ConversationAdmissionSession } from '../ai-native/conversation-admission-session';
import { ConversationTaskCreationSession } from '../ai-native/conversation-task-creation-session';
import { ConversationOrderExecutionSession } from '../ai-native/conversation-order-execution-session';
import { ConversationSceneExecutionSession } from '../ai-native/conversation-opening-execution-session';
import type { LiveVisibleObservationSession } from '../ai-native/visible-observation-session';

export type NativeScene = 'quote_clarification' | 'order_explanation' | 'opening_diagnosis';
export type NativeFrame = { conversationId: string; scene: NativeScene;
  turn: AiConversationTurnObservationDraft | null; result: AiConversationTaskResultDraft | null;
  phase: 'admission' | 'task' | 'model' | 'result' | 'unknown'; historical: boolean;
  snapshot?: AiTaskSnapshotDraft; observation?: AiConversationObservationDraft; readyForNext?: boolean };
export type NativeSend = { chatId: string; scene: NativeScene; text: string; orderId?: string;
  question?: 'status' | 'fees' | 'payments' | 'next_steps'; sections?: string[] };
type Locator = { chatId: string; scene: NativeScene; conversationId: string | null; pending: boolean };
type Options = { api: typeof aiConversationsApi; tasks: Pick<typeof aiTaskCenterApi, 'snapshot' | 'stop' | 'stopReceipt'>;
  storage: Storage | undefined; identity: string;
  current(): boolean; changed?(chatId: string, frame: NativeFrame): void };
const version = AI_CONVERSATION_DRAFT_VERSION;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(v);

export class NativeOperatorSession {
  private frames = new Map<string, NativeFrame>();
  private busy = false;
  constructor(private readonly d: Options) {}
  private key(suffix: string) { return `ai-native-console:${this.d.identity}:${suffix}`; }
  private check(signal: AbortSignal) { if (signal.aborted || !this.d.current()) throw Error('AI_SCOPE_CHANGED'); }
  private locators(): Locator[] {
    if (!this.d.storage) throw Error('AI_ORIGINAL_STORAGE_UNAVAILABLE');
    const raw = this.d.storage.getItem(this.key('locators'));
    if (raw === null) return [];
    if (raw.length > 32768) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED');
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !row || Object.keys(row).sort().join(',') !== 'chatId,conversationId,pending,scene'
      || !id(row.chatId) || !['quote_clarification', 'order_explanation', 'opening_diagnosis'].includes(row.scene)
      || row.conversationId !== null && !id(row.conversationId) || typeof row.pending !== 'boolean')
      || new Set(rows.map(row => row.chatId)).size !== rows.length) throw Error('AI_ORIGINAL_LOCATOR_DAMAGED');
    return rows;
  }
  private save(locator: Locator) {
    const rows = this.locators(), previous = rows.find(row => row.chatId === locator.chatId);
    if (previous && (previous.scene !== locator.scene || previous.conversationId !== null && previous.conversationId !== locator.conversationId))
      throw Error('AI_ORIGINAL_LOCATOR_CHANGED');
    const next = [...rows.filter(row => row.chatId !== locator.chatId), locator];
    if (next.length > 100) throw Error('AI_ORIGINAL_STORAGE_FULL');
    const raw = JSON.stringify(next); this.d.storage!.setItem(this.key('locators'), raw);
    if (this.d.storage!.getItem(this.key('locators')) !== raw) throw Error('AI_ORIGINAL_LOCATOR_CHANGED');
  }
  private publish(chatId: string, frame: NativeFrame, signal: AbortSignal) {
    this.check(signal); this.frames.set(chatId, frame); this.d.changed?.(chatId, structuredClone(frame));
  }
  frame(chatId: string) { return this.frames.get(chatId) ?? null; }
  locatorsSnapshot() { return structuredClone(this.locators()); }
  hasOriginal(chatId: string) { return this.locators().some(row => row.chatId === chatId); }
  retract() { this.frames.clear(); }
  private async metadata(locator: Locator, signal: AbortSignal) {
    this.check(signal); if (!locator.conversationId) throw Error('AI_RESULT_UNKNOWN');
    const query = { draftVersion: version, conversationId: locator.conversationId };
    const value = await this.d.api.read(query, signal); this.check(signal);
    if (!validateAiConversationObservationDraft(value, query) || value.capabilityCode !== locator.scene) throw Error('AI_SCOPE_CHANGED');
    return value;
  }
  async history(scene: NativeScene, signal: AbortSignal) {
    this.check(signal);
    const value = await this.d.api.list({ draftVersion: version, status: 'active', limit: 20, capabilityCode: scene }, signal);
    this.check(signal); return value;
  }
  async open(chatId: string, conversationId: string, scene: NativeScene, signal: AbortSignal) {
    if (!id(chatId) || !id(conversationId)) throw Error('AI_INVALID_INPUT');
    this.check(signal);
    const previousFrame = this.frames.get(chatId);
    this.frames.delete(chatId);
    const detail = await this.d.api.detail({ draftVersion: version, conversationId, limit: 20 }, scene, signal);
    this.check(signal);
    const previous = this.locators().find(row => row.chatId === chatId);
    const locator = { chatId, conversationId, scene, pending: previous?.pending ?? false };
    this.save(locator);
    const turn = detail.conversation.currentTurn ?? detail.turns.items[0] ?? null;
    const frame: NativeFrame = { conversationId, scene, turn, result: null, phase: 'unknown',
      historical: detail.conversation.status !== 'active' || detail.conversation.currentTurn === null,
      observation: detail.conversation };
    if (turn?.task) {
      frame.result = await this.d.api.currentResult({ draftVersion: version, conversationId, admissionKey: turn.admissionKey }, turn, signal);
      this.check(signal);
      frame.snapshot = validateTaskCenterSnapshot(await this.d.tasks.snapshot(turn.task.taskId, signal), turn.task.taskId);
      this.check(signal);
      if (frame.result.status === 'observed' && frame.result.result.status !== 'unknown') {
        frame.phase = 'result'; this.save({ ...locator, pending: false });
      }
    }
    // Reopening keeps the original close proof only after rechecking its empty head.
    if (previousFrame?.readyForNext && previousFrame.conversationId === conversationId && previousFrame.scene === scene
      && previousFrame.observation?.revision === detail.conversation.revision
      && detail.conversation.status === 'active' && detail.conversation.currentTurn === null) {
      if (JSON.stringify(await this.metadata(locator, signal)) !== JSON.stringify(detail.conversation)) throw Error('AI_REVISION_CONFLICT');
      frame.readyForNext = true;
    }
    this.publish(chatId, frame, signal); return frame;
  }
  async read(chatId: string, signal: AbortSignal) {
    this.check(signal);
    const locator = this.locators().find(row => row.chatId === chatId); if (!locator) throw Error('AI_ORIGINAL_LOCATOR_MISSING');
    const previous = this.frames.get(chatId);
    try {
      if (!locator.conversationId) {
        const lifecycle = new ConversationLifecycleSession(this.d.api, () => !signal.aborted && this.d.current(), this.d.storage,
          this.key(`create:${chatId}`), undefined, true);
        try {
          const receipt = await lifecycle.reconcile(); this.check(signal);
          if (receipt.status !== 'observed') throw Error('AI_RESULT_UNKNOWN');
          locator.conversationId = receipt.conversationId; this.save(locator);
        } finally { lifecycle.dispose(); }
      }
      const observed = await this.metadata(locator, signal), turn = observed.currentTurn;
      let selectedTurn = turn ?? previous?.turn ?? null;
      if (!selectedTurn) {
        const detail = await this.d.api.detail({ draftVersion: version, conversationId: locator.conversationId!, limit: 20 }, locator.scene, signal);
        this.check(signal);
        if (JSON.stringify(detail.conversation) !== JSON.stringify(observed)) throw Error('AI_REVISION_CONFLICT');
        selectedTurn = detail.turns.items[0] ?? null;
      }
      const frame: NativeFrame = { conversationId: locator.conversationId!, scene: locator.scene, turn: selectedTurn,
        result: null, phase: 'unknown', historical: observed.status !== 'active' || turn === null, observation: observed };
      if (frame.turn?.task) {
        const selected = frame.turn;
        frame.result = await this.d.api.currentResult({ draftVersion: version, conversationId: frame.conversationId, admissionKey: selected.admissionKey }, selected, signal);
        this.check(signal);
        frame.snapshot = validateTaskCenterSnapshot(await this.d.tasks.snapshot(selected.task!.taskId, signal), selected.task!.taskId);
        this.check(signal);
        if (frame.result.status === 'observed' && frame.result.result.status !== 'unknown') frame.phase = 'result';
      }
      if (JSON.stringify(await this.metadata(locator, signal)) !== JSON.stringify(observed)) throw Error('AI_REVISION_CONFLICT');
      const held = this.frames.get(chatId);
      // A receipt-proven empty revision stays ready across result refreshes.
      // A different head or a remount has no local permission to start a round.
      if (held?.readyForNext && held.conversationId === frame.conversationId && held.scene === frame.scene
        && held.observation?.revision === observed.revision && observed.status === 'active' && !turn)
        frame.readyForNext = true;
      if (frame.phase === 'result') this.save({ ...locator, pending: false });
      this.publish(chatId, frame, signal); return frame;
    } catch (error) {
      if (this.frames.get(chatId) === previous) this.frames.delete(chatId);
      throw error;
    }
  }
  async nextRound(chatId: string, proof: { expectedRevision: number; turnId: string; originalInputRef: string }, signal: AbortSignal) {
    this.check(signal); const locator = this.locators().find(row => row.chatId === chatId);
    if (!locator?.conversationId) throw Error('AI_RESULT_UNKNOWN');
    const observed = await this.metadata(locator, signal);
    if (observed.status !== 'active' || observed.currentTurn !== null || observed.revision !== proof.expectedRevision + 1
      || this.d.storage!.getItem(`ai-conversation-admission:${this.d.identity}:${locator.conversationId}`) !== null
      || this.d.storage!.getItem(`ai-conversation-closure:${this.d.identity}:${locator.conversationId}`) !== null) throw Error('AI_RESULT_UNKNOWN');
    const previous = this.frames.get(chatId);
    if (!previous || previous.conversationId !== locator.conversationId || previous.turn?.turnId !== proof.turnId
      || previous.turn.original.inputRef !== proof.originalInputRef) throw Error('AI_RESULT_UNKNOWN');
    this.save({ ...locator, pending: false });
    this.publish(chatId, { ...previous, historical: true, observation: observed, readyForNext: true }, signal);
  }
  async stop(chatId: string, signal: AbortSignal) {
    this.check(signal); const taskId = this.frames.get(chatId)?.turn?.task?.taskId;
    if (!taskId || !this.d.storage) throw Error('尚未取得原任务定位，请先核对原请求。');
    const key = `ai-task-stop:${this.d.identity}:${taskId}`, raw = this.d.storage.getItem(key);
    let query: { taskId: string; expectedRevision: number };
    if (raw !== null) {
      if (raw.length > 512) throw Error('AI_RESULT_UNKNOWN'); query = JSON.parse(raw);
      if (!query || Object.keys(query).sort().join(',') !== 'expectedRevision,taskId' || query.taskId !== taskId || !Number.isSafeInteger(query.expectedRevision) || query.expectedRevision < 1) throw Error('AI_RESULT_UNKNOWN');
    } else {
      const snapshot = validateTaskCenterSnapshot(await this.d.tasks.snapshot(taskId, signal), taskId); this.check(signal);
      query = { taskId, expectedRevision: snapshot.revision };
      if (this.d.storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const saved = JSON.stringify(query); this.d.storage.setItem(key, saved);
      if (this.d.storage.getItem(key) !== saved) throw Error('AI_RESULT_UNKNOWN');
    }
    this.check(signal);
    const value = await this.d.tasks[raw === null ? 'stop' : 'stopReceipt'](query, signal); this.check(signal);
    if (value.taskId !== taskId || value.expectedRevision !== query.expectedRevision || value.cancellation !== 'request_not_rollback'
      || value.automaticRetry !== false || value.remoteCancellation !== 'not_attested' || value.budgetRelease !== 'not_attempted') throw Error('AI_RESULT_UNKNOWN');
    return value;
  }
  async send(input: NativeSend, signal: AbortSignal, visible?: LiveVisibleObservationSession | null): Promise<NativeFrame> {
    this.check(signal); if (this.busy) throw Error('AI_BUSY');
    if (!id(input.chatId) || !['quote_clarification', 'order_explanation', 'opening_diagnosis'].includes(input.scene) || !input.text.trim()) throw Error('AI_INVALID_INPUT');
    if (input.scene === 'quote_clarification' && !validateAiQuoteGoalInputDraft({ kind: 'quote_goal',
      draftVersion: AI_QUOTE_GOAL_DRAFT_VERSION, goalText: input.text })) throw Error('AI_INVALID_INPUT');
    if (input.scene === 'order_explanation' && !id(input.orderId)) throw Error('请先填写真实订单编号，再发送订单解释请求。');
    if (input.scene === 'order_explanation' && !['status', 'fees', 'payments', 'next_steps'].includes(input.question ?? '')) throw Error('请明确选择本次订单问题。');
    if (input.scene === 'opening_diagnosis' && (!input.sections?.length || input.sections.length > 9
      || input.sections.some(section => !id(section)) || new Set(input.sections).size !== input.sections.length)) throw Error('请明确选择开业检查分区。');
    const existing = this.locators().find(row => row.chatId === input.chatId);
    // Only read()/open() reconcile a prior attempt. A new message is never
    // silently answered with an old result or used to rotate an unknown turn.
    if (existing && (!this.frames.get(input.chatId)?.readyForNext || existing.scene !== input.scene))
      throw Error('当前轮次已受理，新输入尚未发送。请先核对原结果并使用原补充信息入口。');
    if (this.locators().some(row => row.pending)) throw Error('原请求结果待核对，请先在最近对话读取原结果。');
    this.busy = true;
    const live = () => !signal.aborted && this.d.current(), resources: Array<{ dispose(): void }> = [];
    const locator: Locator = { chatId: input.chatId, scene: input.scene, conversationId: existing?.conversationId ?? null, pending: true };
    let frame: NativeFrame | null = null;
    try {
      this.save(locator);
      if (!locator.conversationId) {
        const lifecycle = new ConversationLifecycleSession(this.d.api, live, this.d.storage, this.key(`create:${input.chatId}`), undefined, true);
        resources.push(lifecycle);
        const receipt = await lifecycle.create(input.scene); this.check(signal);
        if (receipt.status !== 'observed') throw Error('AI_RESULT_UNKNOWN');
        locator.conversationId = receipt.conversationId; this.save(locator);
      }
      frame = { conversationId: locator.conversationId, scene: input.scene, turn: null, result: null, phase: 'admission', historical: false };
      this.publish(input.chatId, frame, signal);
      const observed = await this.metadata(locator, signal);
      const admission = new ConversationAdmissionSession(frame.conversationId, this.d.api, live, this.d.storage,
        `ai-conversation-admission:${this.d.identity}:${frame.conversationId}`); resources.push(admission);
      if (input.scene === 'quote_clarification') await admission.prepareQuoteGoal(observed, input.text);
      else if (input.scene === 'opening_diagnosis') await admission.prepareOpening(observed, input.sections!);
      else await admission.prepare(observed, input.orderId!, input.question!);
      this.check(signal); await admission.send(); this.check(signal);
      const turn = admission.snapshot().observation?.result;
      if (!turn) throw Error('AI_RESULT_UNKNOWN');
      frame = { ...frame, turn, phase: 'task' }; this.publish(input.chatId, frame, signal);
      const creation = new ConversationTaskCreationSession(frame.conversationId, this.d.api, live, this.d.storage,
        `ai-conversation-task-creation:${this.d.identity}:${frame.conversationId}:${turn.admissionKey}`); resources.push(creation);
      const recovery = await creation.create(turn); this.check(signal);
      if (recovery.task.state !== 'observed') throw Error('AI_RESULT_UNKNOWN');
      const bound = { ...turn, task: { taskId: recovery.task.taskId, runId: recovery.task.runId } };
      frame = { ...frame, turn: bound, phase: 'model' }; this.publish(input.chatId, frame, signal);
      let measurement: string | null = null;
      const executionPorts = { ...this.d.api };
      const method = input.scene === 'order_explanation' ? 'orderStart'
        : input.scene === 'opening_diagnosis' ? 'openingStart' : 'quoteStart';
      executionPorts[method] = (original, requestSignal) => {
        this.check(signal);
        measurement = visible?.begin({ taskId: bound.task.taskId, runId: bound.task.runId,
          trigger: 'original_model_start', originKey: bound.original.inputRef,
          conversationId: locator.conversationId!, turnId: bound.turnId }) ?? null;
        return this.d.api[method](original, requestSignal);
      };
      const execution = input.scene === 'order_explanation'
        ? new ConversationOrderExecutionSession(frame.conversationId, executionPorts, live, this.d.storage,
          `ai-conversation-order-start:${this.d.identity}:${frame.conversationId}:${turn.admissionKey}`)
        : new ConversationSceneExecutionSession(frame.conversationId, executionPorts, live, this.d.storage,
          `ai-conversation-${input.scene === 'opening_diagnosis' ? 'opening' : 'quote'}-start:${this.d.identity}:${frame.conversationId}:${turn.admissionKey}`, undefined, input.scene);
      resources.push(execution); await execution.inspect(bound); this.check(signal);
      if (!execution.snapshot().ready) throw Error('AI_RESOURCE_UNAVAILABLE');
      try {
        await execution.start(); this.check(signal);
        if (!execution.snapshot().acknowledgement || execution.snapshot().feedback === 'unknown') visible?.cancel(measurement);
      } catch (error) { visible?.cancel(measurement); throw error; }
      return await this.read(input.chatId, signal);
    } catch (error) {
      if (frame?.turn?.task) visible?.cancelTask(frame.turn.task.taskId);
      if (frame && live()) this.publish(input.chatId, { ...frame, phase: 'unknown' }, signal);
      throw error;
    } finally { resources.forEach(resource => resource.dispose()); this.busy = false; }
  }
}

/** Only persisted sequence/status enters the original run animation. No synthetic
 * tool names, elapsed execution timings or successful business results. */
export function nativeAgentRun(snapshot: AiTaskSnapshotDraft): AgentRunState {
  return { status: snapshot.status === 'succeeded' ? 'done' : ['failed', 'cancelled'].includes(snapshot.status) ? 'stopped'
    : ['paused', 'waiting_approval', 'waiting_input', 'waiting_external'].includes(snapshot.status) ? 'waiting' : 'working',
    elapsedMs: Math.max(0, Date.parse(snapshot.updatedAt) - Date.parse(snapshot.createdAt)),
    steps: [...snapshot.steps].sort((a, b) => a.sequence - b.sequence).map(step => ({ id: step.stepId,
      mark: step.kind === 'model' ? 'think' : step.kind === 'confirmation' ? 'review' : 'read',
      verb: step.kind === 'model' ? '模型步骤' : step.kind === 'confirmation' ? '原确认步骤' : '原业务步骤',
      doneVerb: '原步骤', target: `${step.sequence} · ${step.stepId}`, text: step.status,
      status: step.status === 'succeeded' ? 'done' : ['failed', 'cancelled', 'rejected'].includes(step.status) ? 'rejected'
        : ['pending', 'waiting_approval', 'waiting_external', 'waiting_input'].includes(step.status) ? 'waiting' : 'running' })) };
}

export function nativeResultText(frame: NativeFrame): string {
  const result = frame.result;
  if (result?.status === 'observed' && result.result.status === 'available' && result.result.text) return result.result.text.value;
  if (result?.status === 'material_erased') return '原输入已按保留规则清理，可从原任务核对收据。';
  if (result?.status === 'observed' && result.result.status === 'stale') return '事实已变化，请回原业务页面核对。';
  if (result?.status === 'observed' && result.result.status === 'failed') return '原任务失败，请核对原任务记录。';
  return '原结果待核对，请读取原结果。需要补充条件或业务确认时，请在右侧原任务入口办理。';
}
