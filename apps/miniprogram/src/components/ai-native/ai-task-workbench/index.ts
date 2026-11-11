import { AiPollingController, AiPollingLoop, type AiPollClock, type AiPollPage, type AiCancelSignal } from "../polling-controller";
import { consumeCursorPage } from "../cursor-page";
import type { AiCursorState, AiCursorEvent } from "../cursor-adapter";
import type { AiReadContext } from "../types";
import type { NativeClientTaskCancellationHost } from "../ai-task-cancellation/index";

/** Feature-local authorized display input, not a public HTTP DTO. */
export interface NativeAiSnapshot {
  modelText?: string | null;
  modelStatus?: string;
  continueAvailable?: boolean;
  steps?: readonly unknown[];
  fields?: readonly unknown[];
  inputRevision?: string;
  proposal?: { id: string; revision: string };
  proposalAvailable?: boolean;
  proposalExpired?: boolean;
  sources?: readonly unknown[];
  memories?: readonly unknown[];
  inspection?: readonly unknown[];
  order?: Record<string, unknown>;
  actionState?: string;
  cursorState?: AiCursorState;
  observationGeneration?: number;
  observeEvents?: boolean;
}
export interface NativeAiHost {
  clientModel?: boolean;
  clientCancellation?: () => NativeClientTaskCancellationHost | null;
  readAfterObservation?: (context: AiReadContext) => Promise<void>;
  context: AiReadContext;
  readDetail?: (context: AiReadContext) => Promise<NativeAiSnapshot>;
  readPage?: (context: AiReadContext, signal: AiCancelSignal, after?: string) => Promise<AiPollPage & { hasMore?: boolean }>;
  clock?: AiPollClock;
  knownEventTypes?: readonly string[];
  submitInput?: (context: AiReadContext, input: unknown) => Promise<void>;
  confirmProposal?: (context: AiReadContext, input: unknown) => Promise<void>;
  openSource?: (context: AiReadContext, input: unknown) => Promise<void>;
  cancel?: (context: AiReadContext) => Promise<void>;
  reconcile?: (context: AiReadContext) => Promise<void>;
  continueInput?: (context: AiReadContext) => Promise<void>;
  inspectionDraft?: (context: AiReadContext, input: unknown) => Promise<void>;
}
interface Runtime {
  host: NativeAiHost | null;
  context: AiReadContext | null;
  epoch: number;
  alive: boolean;
  shown: boolean;
  enabled: boolean;
  pending: boolean;
  loop: AiPollingLoop | null;
  snapshot: NativeAiSnapshot | null;
  cancellationKey: string;
  observationKey: string;
}
const instances = new WeakMap<object, Runtime>();
function state(instance: object): Runtime {
  const value = instances.get(instance);
  if (!value) throw new Error("组件实例不可用");
  return value;
}
function rows(value: unknown): unknown[] { return Array.isArray(value) ? value.slice(0, 50) : []; }
// Only known serializable display fields enter setData. Callback objects remain private.
function serial(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 50).map(serial);
  return null;
}
function projectRows(value: unknown, keys: readonly string[]): unknown[] {
  return rows(value).filter(row => row && typeof row === "object").map(row => {
    const input = row as Record<string, unknown>;
    return Object.fromEntries(keys.map(key => [key, serial(input[key])]));
  });
}
const blank = {
  clientModel: false, modelText: '', modelStatus: '', continueAvailable: false, cancellationAvailable: false,
  steps: [] as unknown[], fields: [] as unknown[], proposal: null as { id: string; revision: string } | null,
  sources: [] as unknown[], memories: [] as unknown[], inspection: [] as unknown[], order: null as Record<string, unknown> | null,
  inputRevision: "", ready: false, proposalEnabled: false, proposalExpired: true,
  actionState: "unavailable", errorLabel: "", pending: false,
  inputEnabled: false, manualEnabled: false, inspectionEnabled: false,
};
Component({
  options: { multipleSlots: true },
  properties: { tasks: { type: Array, value: [] } },
  data: { ...blank, taskListAvailable: false, selectedTaskId: "", phase: "no_host" },
  lifetimes: {
    created() { instances.set(this, { host: null, context: null, epoch: 0, alive: true, shown: false, enabled: false, pending: false, loop: null, snapshot: null, cancellationKey: '', observationKey: '' }); },
    detached() { this.detachHost(); state(this).alive = false; },
  },
  methods: {
    attachHost(host: NativeAiHost): void {
      const r = state(this);
      if (!r.alive) return;
      this.detachHost();
      if (!host || !host.context || typeof host.context.audience !== "string" || !host.context.audience || typeof host.context.tenantId !== "string" || !host.context.tenantId) {
        this.setData({ ...blank, phase: "unavailable" }); return;
      }
      r.host = host;
      r.context = { audience: host.context.audience, tenantId: host.context.tenantId, workspaceId: host.context.workspaceId };
      this.setData({ ...blank, selectedTaskId: "", phase: "paused", clientModel: host.clientModel === true });
    },
    detachHost(): void {
      const r = state(this);
      r.epoch += 1;
      r.shown = false; r.enabled = false; r.pending = false; r.snapshot = null;
      const loop = r.loop; r.loop = null; r.host = null; r.context = null;
      r.observationKey = '';
      try { loop?.destroy(); } catch { /* Local cleanup must not restore stale display. */ }
      r.cancellationKey = '';
      for (const id of ["#clarification", "#confirmation", "#sources", "#cancellation"]) this.selectComponent?.(id)?.detachHost?.();
      if (r.alive) this.setData({ ...blank, taskListAvailable: false, selectedTaskId: "", phase: "no_host" });
    },
    hostShow(enabled = false): void {
      const r = state(this);
      if (!r.alive || !r.host) return;
      r.shown = true; r.enabled = enabled === true;
      if (!r.enabled) { this.hostHide(); return; }
      this.setData({ taskListAvailable: true, phase: this.data.selectedTaskId ? "unsynced" : "no_task" });
      // Showing does not reuse old authorization or restart a loop without a snapshot.
    },
    hostHide(): void {
      const r = state(this); r.epoch += 1; r.shown = false; r.snapshot = null; r.pending = false;
      try { r.loop?.destroy(); } catch { /* Still clear private state. */ } r.loop = null;
      r.observationKey = '';
      r.cancellationKey = '';
      for (const id of ["#clarification", "#confirmation", "#sources", "#cancellation"]) this.selectComponent?.(id)?.detachHost?.();
      if (r.alive) this.setData({ ...blank, taskListAvailable: false, phase: "hidden" });
    },
    hostLogout(): void { this.detachHost(); },
    receiveClientSnapshot(result: NativeAiSnapshot, taskId: string): void {
      const r = state(this), host = r.host;
      if (!r.alive || !r.shown || !r.enabled || !host?.clientModel || !r.context || taskId !== host.context.taskId) return;
      r.context = { ...r.context, taskId };
      const text = result.modelText;
      if (text !== null && text !== undefined && (typeof text !== 'string' || text.length > 32768)) {
        r.snapshot = null; r.cancellationKey = ''; r.observationKey = '';
        r.loop?.destroy(); r.loop = null; this.selectComponent?.('#cancellation')?.detachHost?.();
        this.setData({ ...blank, clientModel: true, phase: 'unavailable' }); return;
      }
      r.snapshot = result;
      const inputRevision = typeof result.inputRevision === 'string' ? result.inputRevision : '';
      const cancellation = host.clientCancellation?.();
      this.setData({ clientModel: true, selectedTaskId: taskId, taskListAvailable: true, ready: true, phase: 'customer_model',
        cancellationAvailable: cancellation?.origin.taskId === taskId && typeof host.readAfterObservation === 'function',
        modelText: text ?? '', modelStatus: typeof result.modelStatus === 'string' ? result.modelStatus : '',
        continueAvailable: result.continueAvailable === true && typeof host.continueInput === 'function',
        inputRevision, fields: projectRows(result.fields,['key','label','value','error','readonly','required','maxLength']),
        inputEnabled: Boolean(inputRevision && typeof host.submitInput === 'function' && rows(result.fields).some(field => field
          && typeof field === 'object' && (field as { readonly?: boolean }).readonly !== true)),
        manualEnabled: typeof host.reconcile === 'function', pending: r.pending,
      }, () => {
        if (!r.alive || !r.shown || r.host !== host) return;
        const cancelChild = this.selectComponent?.('#cancellation'), cancelHost = host.clientCancellation?.();
        if (cancelHost?.origin.taskId === taskId && typeof host.readAfterObservation === 'function' && cancelHost.context.current()) {
          const key = JSON.stringify([cancelHost.context.tenantCode, cancelHost.context.serviceCode, cancelHost.context.customerId,
            cancelHost.context.orderId, cancelHost.origin.reference.materialRef, cancelHost.origin.reference.creationKey, taskId]);
          // Keep the same child session while the model snapshot refreshes.
          // In particular, a lost stop ACK must not create a second selector.
          if (cancelChild && key !== r.cancellationKey) { cancelChild.attachHost?.(cancelHost); r.cancellationKey = key; }
          cancelChild?.hostShow?.();
        } else {
          r.cancellationKey = ''; cancelChild?.detachHost?.(); this.setData({ cancellationAvailable: false });
        }
        const child = this.selectComponent?.('#clarification');
        if (inputRevision && typeof host.submitInput === 'function') {
          const epoch = r.epoch;
          child?.attachHost?.((input: unknown) => {
            if (!r.alive || !r.shown || r.epoch !== epoch || r.host !== host) return Promise.reject(Error('宿主连接已失效'));
            return this.runHostAction('submitInput',input);
          });
        } else child?.detachHost?.();
      });
      this.startCursorObservation(result);
    },
    async onCancellationObserved(event: WechatMiniprogram.CustomEvent): Promise<void> {
      const r = state(this), host = r.host, value = event?.detail;
      if (!r.alive || !r.shown || !r.enabled || !host?.clientModel || !r.context || !host.readAfterObservation
        || !value || (value.cancellation !== 'requested' && value.cancellation !== 'settled')
        || value.taskId !== r.context.taskId || host.clientCancellation?.()?.origin.taskId !== value.taskId) return;
      const epoch = r.epoch;
      try { await host.readAfterObservation({ ...r.context }); }
      catch { if (r.alive && r.shown && r.epoch === epoch && r.host === host) this.setData({ errorLabel: '停止后的原任务待核对' }); }
    },
    startCursorObservation(result: NativeAiSnapshot): void {
      const r = state(this), host = r.host, context = r.context, cursor = result.cursorState;
      if (!r.alive || !r.shown || !r.enabled || !host || !context?.taskId) return;
      if (result.observeEvents === false || !host.readPage || !host.clock || !cursor || cursor.taskId !== context.taskId
        || cursor.sync !== 'synced' || typeof cursor.version !== 'string' || !cursor.version || typeof cursor.cursor !== 'string'
        || !/^(0|[1-9]\d*)$/u.test(cursor.cursor) || cursor.cursor.length > 128) {
        r.loop?.destroy(); r.loop = null; r.observationKey = ''; this.setData({ phase: 'snapshot_only' }); return;
      }
      const key = JSON.stringify([context, cursor.version, cursor.cursor, result.observationGeneration ?? 0]);
      if (r.loop && r.observationKey === key) return;
      r.loop?.destroy(); r.observationKey = key;
      const epoch = r.epoch, current = () => r.alive && r.shown && r.enabled && r.epoch === epoch && r.host === host && r.observationKey === key;
      const unavailable = () => {
        if (!current()) return;
        r.snapshot = null;
        if (host.clientModel) {
          // Stop/receipt controls use their separate original task read. A
          // broken event stream must not reopen model/input execution controls.
          this.setData({ ready: false, inputEnabled: false, continueAvailable: false, modelText: '', phase: 'unsynced',
            modelStatus: '原任务变化待核对', errorLabel: '请读取原任务核对' });
        } else this.setData({ ...blank, phase: 'unsynced' });
        for (const id of ['#clarification', '#confirmation', '#sources']) this.selectComponent?.(id)?.detachHost?.();
      };
      let cursorState = { ...cursor, events: [] as readonly AiCursorEvent[] };
      let needsOriginalRead = false;
      const controller = new AiPollingController((ctx, signal) => host.readPage!({ ...ctx }, signal, cursorState.cursor!), page => {
        if (!current()) return { sync: 'unsynced' };
        const more = (page as AiPollPage & { hasMore?: boolean }).hasMore;
        const batch = consumeCursorPage(cursorState, page.events as readonly AiCursorEvent[], more ?? false, host.knownEventTypes ?? []);
        if (host.clientModel && typeof more !== 'boolean' || page.version !== cursorState.version
          || batch.state.sync !== 'synced' || page.cursor !== batch.state.cursor) {
          unavailable(); return { sync: 'unsynced' };
        }
        cursorState = batch.state; needsOriginalRead ||= page.events.length > 0;
        this.setData({ phase: more ? 'catching_up' : 'synced' });
        if (host.clientModel && more) this.setData({ inputEnabled: false, continueAvailable: false });
        // Events only wake an original source read after the held pages drain.
        // Their data never supplies an answer, approval, accounting or Core fact.
        if (host.clientModel && !more && needsOriginalRead && host.readAfterObservation) {
          needsOriginalRead = false;
          try { void host.readAfterObservation({ ...context }).catch(() => { if (current()) { unavailable(); r.loop?.pause(); } }); }
          catch { unavailable(); r.loop?.pause(); }
        }
        return { sync: 'synced' };
      });
      r.loop = new AiPollingLoop(controller, host.clock, 2000, { classify: () => 'unknown', notify: phase => {
        if (!current()) return;
        if (phase !== 'synced') unavailable(); else this.setData({ phase });
      } });
      this.setData({ errorLabel: '' }); r.loop.start({ ...context });
    },
    async selectTask(event: WechatMiniprogram.CustomEvent): Promise<void> {
      const r = state(this); const taskId = event?.detail?.taskId;
      if (!r.alive || !r.host || !r.context || !r.shown || !r.enabled || typeof taskId !== "string" || !taskId || taskId.length > 128) return;
      r.epoch += 1; r.snapshot = null;
      try { r.loop?.destroy(); } catch { /* Clear stale view regardless. */ } r.loop = null;
      r.observationKey = '';
      r.context = { ...r.context, taskId };
      this.setData({ ...blank, selectedTaskId: taskId, phase: "loading" });
      await this.readSnapshot();
    },
    async readSnapshot(): Promise<void> {
      const r = state(this); const host = r.host; const context = r.context;
      if (!r.alive || !r.shown || !r.enabled || !host || !context?.taskId) return;
      const epoch = ++r.epoch; r.snapshot = null;
      try { r.loop?.destroy(); } catch { /* Clear stale view regardless. */ } r.loop = null;
      this.setData({ ...blank, phase: "loading" });
      if (typeof host.readDetail !== "function") { this.setData({ phase: "unavailable" }); return; }
      try {
        const result = await host.readDetail({ ...context });
        if (!r.alive || !r.shown || epoch !== r.epoch || r.host !== host) return;
        if (!result || typeof result !== "object") { this.setData({ phase: "unavailable" }); return; }
        if (host.clientModel) { this.receiveClientSnapshot(result,context.taskId); return; }
        r.snapshot = result;
        const proposal = result.proposal && typeof result.proposal.id === "string" && typeof result.proposal.revision === "string"
          ? { id: result.proposal.id, revision: result.proposal.revision } : null;
        const order = result.order ? Object.fromEntries(["title", "receivable", "paid", "deposit", "preAuth", "refundStatus", "availabilityLabel"].map(key => [key, serial(result.order?.[key])])) : null;
        this.setData({
          ready: true, phase: "ready",
          inputEnabled: typeof host.submitInput === "function" && typeof result.inputRevision === "string" && Boolean(result.inputRevision),
          manualEnabled: typeof host.reconcile === "function",
          inspectionEnabled: typeof host.inspectionDraft === "function",
          steps: projectRows(result.steps, ["id", "taskId", "ordinal", "label", "status", "sourceLabel"]),
          fields: projectRows(result.fields, ["key", "label", "value", "error", "readonly", "required", "maxLength"]),
          inputRevision: typeof result.inputRevision === "string" ? result.inputRevision : "",
          proposal, proposalEnabled: result.proposalAvailable === true && typeof host.confirmProposal === "function", proposalExpired: result.proposalExpired !== false,
          sources: projectRows(result.sources, ["id", "version", "title", "location", "status"]),
          memories: projectRows(result.memories, ["id", "revision", "label", "value", "status", "actorKind", "expiresAt"]),
          inspection: projectRows(result.inspection, ["key", "label", "candidate", "humanValue", "sourceLabel"]), order,
          actionState: typeof result.actionState === "string" ? result.actionState : "unavailable",
        }, () => {
          if (!r.alive || !r.shown || r.epoch !== epoch) return;
          const actions = [["#clarification", "submitInput"], ["#confirmation", "confirmProposal"], ["#sources", "openSource"]] as const;
          for (const [id, action] of actions) {
            const child = this.selectComponent?.(id);
            if (typeof host[action] === "function") child?.attachHost?.((input: unknown) => {
              if (!r.alive || !r.shown || r.epoch !== epoch || r.host !== host) return Promise.reject(new Error("宿主连接已失效"));
              return this.runHostAction(action, input);
            });
            else child?.detachHost?.();
          }
        });
        this.startCursorObservation(result);
      } catch {
        if (r.alive && r.shown && epoch === r.epoch) this.setData({ ...blank, phase: "failed", errorLabel: "读取失败，请由宿主重新核对" });
      }
    },
    async runHostAction(action: "submitInput" | "confirmProposal" | "openSource" | "inspectionDraft", input: unknown): Promise<void> {
      const r = state(this); const host = r.host; const callback = host?.[action]; const context = r.context;
      if (!r.alive || !r.shown || !r.enabled || !r.snapshot || r.pending || !context || typeof callback !== "function") throw new Error("宿主动作不可用");
      const reference = input as Record<string, unknown> | null;
      if (action === "submitInput" && (!reference || reference.taskId !== context.taskId || reference.inputRevision !== r.snapshot.inputRevision)) throw new Error("输入引用已失效");
      if (action === "confirmProposal" && (!reference || !r.snapshot.proposalAvailable || r.snapshot.proposalExpired !== false || reference.proposalId !== r.snapshot.proposal?.id || reference.revision !== r.snapshot.proposal?.revision)) throw new Error("提案引用已失效");
      const epoch = r.epoch; r.pending = true; this.setData({ pending: true, errorLabel: "" });
      try { await callback({ ...context }, input); }
      catch { if (r.alive && r.shown && r.epoch === epoch) this.setData({ errorLabel: "操作请求失败，请人工核对" }); throw new Error("操作请求失败"); }
      finally { if (r.alive && r.epoch === epoch) { r.pending = false; this.setData({ pending: false }); } }
      // Callback completion does not advance task status or issue approval evidence.
    },
    async onInspectionDraft(event: WechatMiniprogram.CustomEvent): Promise<void> {
      try { await this.runHostAction("inspectionDraft", { key: event?.detail?.key, humanValue: event?.detail?.humanValue }); } catch { /* Visible generic error is handled by runHostAction. */ }
    },
    async onManual(): Promise<void> {
      const r = state(this); const host = r.host; const context = r.context;
      if (!r.alive || !r.shown || !r.enabled || !host || !context || r.pending || typeof host.reconcile !== "function") return;
      const epoch = r.epoch; r.pending = true; this.setData({ pending: true });
      try { await host.reconcile({ ...context }); }
      catch { if (r.alive && r.epoch === epoch) this.setData({ errorLabel: "核对请求失败" }); }
      finally { if (r.alive && r.epoch === epoch) { r.pending = false; this.setData({ pending: false }); } }
    },
    async onContinue(): Promise<void> {
      const r = state(this), host = r.host, context = r.context;
      if (!r.alive || !r.shown || !r.enabled || !host?.clientModel || !context || r.pending
        || r.snapshot?.continueAvailable !== true || typeof host.continueInput !== 'function') return;
      const epoch = r.epoch; r.pending = true; this.setData({ pending: true, errorLabel: '' });
      try { await host.continueInput({ ...context }); }
      catch { if (r.alive && r.epoch === epoch) this.setData({ errorLabel: '原回答待核对，不重复调用模型' }); }
      finally { if (r.alive && r.epoch === epoch) { r.pending = false; this.setData({ pending: false }); } }
    },
  },
});
