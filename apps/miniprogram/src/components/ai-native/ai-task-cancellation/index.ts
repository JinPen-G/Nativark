/** Original customer stop controls. Host callbacks stay private; hide/logout
 * clear display while original cancellation selectors remain recoverable. */
import { clientTaskCancellationApi } from '../../../api/ai-task-cancellation';
import { createClientTaskCancellationSession, clientTaskCancellationStorageKey,
  type ClientTaskCancellationOrigin, type ClientTaskCancellationView } from '../client-task-cancellation-session';
import type { ClientTaskContext } from '../client-task-session';

export interface NativeClientTaskCancellationHost { context: ClientTaskContext; origin: ClientTaskCancellationOrigin }
interface Runtime {
  alive: boolean; shown: boolean; epoch: number; pending: boolean; observed: string;
  host: NativeClientTaskCancellationHost | null;
  session: ReturnType<typeof createClientTaskCancellationSession> | null;
}
const instances = new WeakMap<object, Runtime>();
const blank = { ready: false, pending: false, status: 'closed', canRequest: false, canRead: false, canSettle: false, statusLabel: '' };
const state = (instance: object) => { const value = instances.get(instance); if (!value) throw Error('client_cancellation_unavailable'); return value; };
function label(status: ClientTaskCancellationView['status'], english: boolean) {
  switch (status) {
    case 'checking': return english ? 'Checking the original task…' : '正在核对原任务…';
    case 'requested': return english ? 'Stop requested; completion still needs checking.' : '停止申请已记录，尚未确认完成。';
    case 'settled': return english ? 'This explanation task has stopped.' : '本次解释任务已停止。';
    case 'finished': return english ? 'This explanation task has ended.' : '解释任务已结束。';
    case 'unknown': return english ? 'The stop result needs checking against the original record.' : '停止结果待核对，请读取原记录。';
    case 'unavailable': return english ? 'The stop record is unavailable. Check the original record later.' : '暂时无法核对停止状态，请稍后读取原记录。';
    default: return '';
  }
}
Component({
  properties: { english: { type: Boolean, value: false } },
  data: { ...blank },
  lifetimes: {
    created() { instances.set(this, { alive: true, shown: false, epoch: 0, pending: false, observed: '', host: null, session: null }); },
    detached() { this.detachHost(); state(this).alive = false; },
  },
  methods: {
    attachHost(host: NativeClientTaskCancellationHost): void {
      const r = state(this); if (!r.alive) return;
      this.detachHost();
      if (!host?.context || host.context.surface !== 'client_miniprogram' || typeof host.context.current !== 'function'
        || !host.context.tenantCode || !host.context.serviceCode || !host.context.customerId || !host.context.orderId || !host.origin) return;
      r.host = { context: { ...host.context }, origin: { taskId: host.origin.taskId, reference: { ...host.origin.reference } } };
    },
    detachHost(): void {
      const r = state(this); r.epoch++; r.shown = false; r.pending = false; r.observed = '';
      r.session?.dispose(); r.session = null; r.host = null;
      if (r.alive) this.setData({ ...blank });
    },
    hostShow(): void {
      const r = state(this); if (!r.alive || r.shown || !r.host || !r.host.context.current()) return;
      r.shown = true; this.setData({ ...blank, ready: true });
    },
    hostHide(): void {
      const r = state(this); r.epoch++; r.shown = false; r.pending = false; r.observed = '';
      r.session?.dispose(); r.session = null;
      if (r.alive) this.setData({ ...blank });
    },
    hostLogout(): void { this.detachHost(); },
    async work(kind: 'request' | 'read' | 'finish'): Promise<void> {
      const r = state(this), host = r.host;
      if (!r.alive || !r.shown || !host || r.pending || !host.context.current()) return;
      const epoch = r.epoch, current = () => r.alive && r.shown && r.epoch === epoch && r.host === host && host.context.current();
      r.pending = true; this.setData({ pending: true });
      try {
        if (!r.session) {
          const context = { ...host.context, current }, key = clientTaskCancellationStorageKey(context, host.origin);
          r.session = createClientTaskCancellationSession({ context, origin: host.origin, api: clientTaskCancellationApi,
            storage: { read: () => { const value: unknown = wx.getStorageSync(key); return value === '' ? undefined : value; },
              write: value => wx.setStorageSync(key, value) },
            changed: view => {
              if (!current()) return;
              this.setData({ ready: true, status: view.status, canRequest: view.canRequest, canRead: view.canRead,
                canSettle: view.canSettle, statusLabel: label(view.status, this.data.english === true) });
              if (view.observation) {
                const signature = JSON.stringify(view.observation);
                if (r.observed !== signature) { r.observed = signature; this.triggerEvent('observed', view.observation); }
              }
            } });
        }
        if (kind === 'request') await r.session.requestCancellation();
        else if (kind === 'finish') await r.session.finishCancellation();
        else await r.session.refresh();
      } catch { if (current()) this.setData({ status: 'unavailable', statusLabel: label('unavailable', this.data.english === true) }); }
      finally { if (current()) { r.pending = false; this.setData({ pending: false }); } }
    },
    onRequest(): void { void this.work('request'); },
    onRead(): void { void this.work('read'); },
    onFinish(): void { void this.work('finish'); },
  },
});
