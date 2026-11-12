/** Original staff recognition Task controls beside the existing inspection
 * draft. Host callbacks remain private; result references only open the
 * existing candidate review and never submit a Core inspection. */
import { createStaffInspectionTaskApi } from '../../../api/ai-inspection-tasks';
import { serverNow } from '../../../core/clock';
import { readStorage, writeStorage } from '../../../core/storage';
import { AiPollingController, AiPollingLoop } from '../polling-controller';
import { createStaffInspectionTaskSession, staffInspectionTaskStorageKey,
  type StaffInspectionTaskContext, type StaffInspectionTaskView } from '../inspection-task-session';
import { chooseInspectionHistoryItem } from '../inspection-page-binding';

export interface StaffInspectionTaskHost { context: StaffInspectionTaskContext }
interface Runtime {
  alive: boolean; shown: boolean; epoch: number; pending: boolean; inputSignature: string;
  host: StaffInspectionTaskHost | null; owner: ReturnType<typeof createStaffInspectionTaskSession> | null;
  view: StaffInspectionTaskView | null; loop: AiPollingLoop | null;
}
const instances = new WeakMap<object, Runtime>();
const state = (instance: object) => { const value = instances.get(instance); if (!value) throw Error('staff_inspection_task_unavailable'); return value; };
const blank = { statusLabel: '', currentTask: null as Record<string, unknown> | null, canBegin: false, canStart: false,
  canRead: false, canSubmit: false, canContinue: false, pending: false, resultAvailable: false, taskId: '', inputRevision: '', fields: [] as unknown[], errorLabel: '' };
function label(status: StaffInspectionTaskView['status']): string {
  switch (status) {
    case 'working': return '正在处理原检查任务';
    case 'ready': return '检查任务已准备';
    case 'running': return '原识别任务进行中';
    case 'waiting_input': return '请补充原任务所需信息';
    case 'answer_saved': return '原补充已保存，等待明确继续';
    case 'result_reference': return '已找到原识别结果，可逐项审阅';
    case 'ended': return '原识别任务已结束，可继续原人工检查';
    case 'unknown': return '原任务结果待核对，不重复执行识别';
    case 'unavailable': return '任务暂不可用，可继续原人工检查';
    default: return '';
  }
}
Component({
  data: { ...blank },
  lifetimes: {
    created() { instances.set(this, { alive: true, shown: false, epoch: 0, pending: false, inputSignature: '', host: null, owner: null, view: null, loop: null }); },
    detached() { this.detachHost(); state(this).alive = false; },
  },
  methods: {
    attachHost(host: StaffInspectionTaskHost): void {
      const r = state(this); if (!r.alive) return;
      this.detachHost();
      if (!host?.context || !host.context.tenantId || !host.context.workspaceId || !host.context.ownerId
        || !host.context.source || typeof host.context.current !== 'function') return;
      r.host = { context: { ...host.context, source: { ...host.context.source } } };
    },
    detachHost(): void {
      const r = state(this); r.epoch++; r.shown = false; r.pending = false; r.inputSignature = '';
      r.loop?.destroy(); r.loop = null; r.owner?.dispose(); r.owner = null; r.host = null; r.view = null;
      this.selectComponent?.('#task-input')?.detachHost?.();
      if (r.alive) this.setData({ ...blank });
    },
    hostHide(): void {
      const r = state(this); r.epoch++; r.shown = false; r.pending = false; r.inputSignature = '';
      r.loop?.destroy(); r.loop = null; r.owner?.dispose(); r.owner = null; r.view = null;
      this.selectComponent?.('#task-input')?.detachHost?.();
      if (r.alive) this.setData({ ...blank });
    },
    hostLogout(): void { this.detachHost(); },
    async hostShow(): Promise<void> {
      const r = state(this); if (!r.alive || r.shown || !r.host?.context.current()) return;
      r.shown = true;
      await this.work('read');
    },
    async work(kind: 'begin' | 'start' | 'continue' | 'read'): Promise<void> {
      const r = state(this), host = r.host;
      if (!r.alive || !r.shown || !host || !host.context.current() || r.pending && kind !== 'read') return;
      const epoch = r.epoch, current = () => r.alive && r.shown && r.epoch === epoch && r.host === host && host.context.current();
      const api = createStaffInspectionTaskApi({ current });
      let ownsPending = false;
      try {
        if (!r.owner) {
          const context = { ...host.context, current }, key = staffInspectionTaskStorageKey(context);
          r.owner = createStaffInspectionTaskSession({ context, api, now: serverNow,
            newKey: () => `staff-inspection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
            storage: { read: () => readStorage(key), write: value => writeStorage(key,value) },
            changed: view => { if (current()) this.receiveView(view); } });
          await r.owner.open();
        }
        if (kind === 'read' && r.pending) { await r.owner.observe(); return; }
        ownsPending = true; r.pending = true; this.setData({ pending: true, errorLabel: '' });
        if (kind === 'begin') {
          let inputId: string | undefined;
          if (!r.owner.hasOriginal()) {
            const draft = await api.readDraft(host.context.source); if (!current()) return;
            const inputs = draft.state.recognitionInputs ?? [];
            if (inputs.length > 1) {
              const index = await chooseInspectionHistoryItem(inputs.map(row => `原输入 ${row.inputId.slice(-12)} · 模板 ${row.template.version}`),current);
              if (index === null || !current()) return; inputId = inputs[index].inputId;
            }
          }
          await r.owner.begin(inputId);
        } else if (kind === 'start') await r.owner.start();
        else if (kind === 'continue') await r.owner.continueAnswer();
        else await r.owner.refresh();
        if (current()) this.startReads();
      } catch { if (current()) { r.loop?.pause(); this.selectComponent?.('#task-input')?.detachHost?.(); r.inputSignature = '';
        this.setData({ errorLabel: '原任务暂不可核对，请使用原人工检查', currentTask: null, fields: [], canSubmit: false, canContinue: false, canStart: false, resultAvailable: false }); } }
      finally { if (current() && ownsPending) { r.pending = false; this.setData({ pending: false }); } }
    },
    receiveView(view: StaffInspectionTaskView): void {
      const r = state(this); if (!r.alive || !r.shown || !r.host?.context.current()) return;
      r.view = view;
      const epoch = r.epoch, owner = r.owner, host = r.host;
      const question = view.question, taskId = view.task?.taskId,
        signature = question ? JSON.stringify([taskId,question.requestId,question.revision,question.contract]) : '';
      const changed = signature !== r.inputSignature;
      this.setData({ statusLabel: label(view.status), canBegin: view.canBegin, canStart: view.canStart, canRead: view.canRead,
        canSubmit: view.canSubmit, canContinue: view.canContinue, resultAvailable: Boolean(view.result), taskId: view.task?.taskId ?? '',
        currentTask: view.task ? { id: view.task.taskId, title: '本次检查识别', status: view.task.status, statusLabel: label(view.status),
          updatedLabel: '', summary: '候选由员工核实，任务不提交检查', availabilityLabel: '原受权任务', partial: false } : null,
        ...(changed ? { inputRevision: question ? `${question.requestId}:${question.revision}` : '', fields: question?.contract.fields.map(field => ({
          key: field.fieldId, label: field.label, required: field.required, readonly: !view.canSubmit, kind: field.kind,
          ...(field.kind === 'text' ? { maxLength: field.maxLength } : field.kind === 'integer' ? { minimum: field.minimum, maximum: field.maximum } : { options: field.options })
        })) ?? [] } : {})
      }, () => {
        if (!r.alive || !r.shown || r.epoch !== epoch || r.owner !== owner || r.host !== host
          || r.view !== view || !host.context.current()) return;
        const child = this.selectComponent?.('#task-input');
        if (!view.canSubmit || !question || !owner) { child?.detachHost?.(); r.inputSignature = ''; return; }
        if (changed) {
          child?.attachHost?.(async (value: unknown) => {
            const input = value as { taskId?: unknown; inputRevision?: unknown; draft?: Record<string, unknown> } | null;
            if (!r.alive || !r.shown || r.epoch !== epoch || r.owner !== owner || r.host !== host || !host.context.current()
              || !input || input.taskId !== taskId || input.inputRevision !== `${question.requestId}:${question.revision}` || !input.draft) throw Error('staff_inspection_question_changed');
            r.pending = true; this.setData({ pending: true });
            try { await owner.submitAndContinue(input.draft); }
            finally { if (r.alive && r.shown && r.epoch === epoch) { r.pending = false; this.setData({ pending: false }); this.startReads(); } }
          });
          r.inputSignature = signature;
        }
      });
      if (view.task && ['succeeded','partially_succeeded','failed','cancelled'].includes(view.task.status)) {
        r.loop?.destroy(); r.loop = null;
      } else if (view.task && !r.loop) this.startReads();
    },
    startReads(): void {
      const r = state(this), host = r.host, owner = r.owner;
      r.loop?.destroy(); r.loop = null;
      if (!r.alive || !r.shown || !host?.context.current() || !owner || !r.view?.task
        || ['succeeded','partially_succeeded','failed','cancelled'].includes(r.view.task.status)) return;
      const epoch = r.epoch, current = () => r.alive && r.shown && r.epoch === epoch && r.host === host && r.owner === owner && host.context.current();
      const controller = new AiPollingController(async (_context,signal) => {
        if (!current() || signal.aborted) throw Error('staff_inspection_context_changed');
        await owner.observe();
        if (!current() || signal.aborted) throw Error('staff_inspection_context_changed');
        // Local metadata-read acknowledgement only; no event cursor or event
        // continuity is invented for the snapshot-only original interface.
        return { events: [], cursor: null, version: 'staff-original-inspection-read-1' };
      }, () => current() ? { sync: 'synced' } : { sync: 'unsynced' });
      r.loop = new AiPollingLoop(controller, { schedule: (fn,delay) => setTimeout(fn,delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },2000,
        { classify: () => 'unknown', notify: status => { if (current() && status !== 'synced') {
          this.selectComponent?.('#task-input')?.detachHost?.(); r.inputSignature = '';
          this.setData({ currentTask: null, fields: [], canSubmit: false, canContinue: false, canStart: false, resultAvailable: false, errorLabel: '原任务状态待核对，请明确读取原记录' });
        } } });
      r.loop.start({ audience: 'staff', tenantId: host.context.tenantId, workspaceId: host.context.workspaceId, taskId: r.view.task.taskId });
    },
    onBegin(): void { void this.work('begin'); },
    onStart(): void { void this.work('start'); },
    onContinue(): void { void this.work('continue'); },
    onRead(): void { void this.work('read'); },
    originalResultReference() {
      const r = state(this); return r.alive && r.shown && this.data.resultAvailable && r.host?.context.current() && r.view?.result ? { ...r.view.result } : null;
    },
    onReviewResult(): void {
      const r = state(this); if (!r.alive || !r.shown || !this.data.resultAvailable || !r.host?.context.current() || !r.view?.result) return;
      this.triggerEvent('result', { reference: { ...r.view.result } });
    },
  },
});
