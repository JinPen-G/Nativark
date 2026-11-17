/** Explicit customer links from the loaded original order. Full Actions stay
 * in private memory; component data contains display rows only. Navigation
 * rechecks original authority and never opens the automatic payment-refresh page. */
import type { AiRegisteredEntryActionObservation } from '@rental-os/shared';
import { captureClientEntryActionContext, createClientEntryActionApi } from '../../../api/ai-entry-actions';
import { sessionEvents } from '../../../core/session';
import { serverNow } from '../../../core/clock';
import { ROUTES, buildUrl, navigate } from '../../../core/ui';

interface Row { actionId: string; title: string; label: string }
interface State { epoch: number; enabled: boolean; busy: boolean; actions: AiRegisteredEntryActionObservation[];
  context: ReturnType<typeof captureClientEntryActionContext> | null; timer: ReturnType<typeof setTimeout> | null }
const states = new WeakMap<object, State>(), shown = new WeakSet<object>(), subscriptions = new WeakMap<object, () => void>();
const blank = { busy: false, rows: [] as Row[], observedAt: '', message: '' };
const safeText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '');
const title = (code: string) => code === 'OPEN_PROFILE' ? '查看本人资料' : code === 'OPEN_PRODUCT' ? '查看原商品' : '查看原支付记录';
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { orderId: { type: String, value: '' }, contextKey: { type: String, value: '' }, available: { type: Boolean, value: false } },
  data: { ...blank },
  lifetimes: {
    attached() {
      shown.add(this); states.set(this, { epoch: 0, enabled: this.data.available === true && !!this.data.orderId && !!this.data.contextKey,
        busy: false, actions: [], context: null, timer: null });
      subscriptions.set(this, sessionEvents.on(() => this.withdraw()));
    },
    detached() { shown.delete(this); this.withdraw(); subscriptions.get(this)?.(); subscriptions.delete(this); states.delete(this); },
  },
  pageLifetimes: { show() { shown.add(this); }, hide() { shown.delete(this); this.withdraw(); } },
  observers: { 'orderId,contextKey,available'() {
    this.withdraw(); const state = states.get(this);
    if (state) state.enabled = this.data.available === true && !!this.data.orderId && !!this.data.contextKey;
  } },
  methods: {
    withdraw() {
      const state = states.get(this);
      if (state) { state.epoch++; state.enabled = false; state.busy = false; state.actions = []; state.context = null;
        if (state.timer !== null) clearTimeout(state.timer); state.timer = null; this.setData({ ...blank, rows: [] }); }
    },
    expireObservation() {
      const state = states.get(this); if (!state) return;
      state.epoch++; state.busy = false; state.actions = []; state.context = null;
      if (state.timer !== null) clearTimeout(state.timer); state.timer = null;
      this.setData({ ...blank, rows: [], message: '入口观察已到期，请重新读取。' });
    },
    async onRead(): Promise<void> {
      const state = states.get(this), orderId = this.data.orderId, contextKey = this.data.contextKey;
      if (!state?.enabled || state.busy || !shown.has(this) || this.data.available !== true || !orderId || !contextKey) return;
      let context: ReturnType<typeof captureClientEntryActionContext>;
      try { context = captureClientEntryActionContext(); } catch { this.withdraw(); return; }
      const epoch = ++state.epoch, current = () => states.get(this) === state && state.enabled && state.epoch === epoch
        && shown.has(this) && this.data.available === true && this.data.orderId === orderId && this.data.contextKey === contextKey && context.current();
      state.context = context; state.actions = []; state.busy = true;
      if (state.timer !== null) clearTimeout(state.timer); state.timer = null; this.setData({ ...blank, rows: [], busy: true });
      try {
        const result = await createClientEntryActionApi({ orderId, current }).fromOrder();
        if (!current()) return;
        state.actions = result.actions.filter(row => row.action.actionCode !== 'OPEN_ORDER');
        this.setData({ busy: false, observedAt: result.observedAt, rows: state.actions.map(row => ({ actionId: row.action.actionId,
          title: title(row.action.actionCode), label: safeText(row.label) })), message: state.actions.length ? '' : '当前没有其他可核验的关联入口。' });
        if (state.actions.length) state.timer = setTimeout(() => {
          if (states.get(this) !== state || state.epoch !== epoch) return;
          if (!current()) this.withdraw(); else this.expireObservation();
        }, Math.min(120000, Math.max(0, Math.min(...state.actions.map(row => Date.parse(row.action.expiresAt))) - serverNow())));
      } catch {
        if (current()) { state.actions = []; this.setData({ ...blank, rows: [], message: '当前入口无法核对，可继续使用原订单和人工办理入口。' }); }
      } finally {
        if (states.get(this) === state && state.epoch === epoch) {
          if (!current()) this.withdraw(); else { state.busy = false; this.setData({ busy: false }); }
        }
      }
    },
    async onOpen(event: WechatMiniprogram.TouchEvent): Promise<void> {
      const state = states.get(this), actionId: unknown = event.currentTarget.dataset.actionId,
        orderId = this.data.orderId, contextKey = this.data.contextKey;
      if (!state?.enabled || state.busy || !shown.has(this) || this.data.available !== true || typeof actionId !== 'string') return;
      const selected = state.actions.find(row => row.action.actionId === actionId), context = state.context;
      if (!selected) return;
      if (!context?.current()) { this.withdraw(); return; }
      if (Date.parse(selected.action.expiresAt) <= serverNow()) { this.expireObservation(); return; }
      const epoch = state.epoch, current = () => states.get(this) === state && state.enabled && state.epoch === epoch
        && shown.has(this) && this.data.available === true && this.data.orderId === orderId && this.data.contextKey === contextKey && context.current();
      state.busy = true; this.setData({ busy: true, message: '' });
      try {
        const action = selected.action;
        await createClientEntryActionApi({ orderId, current }).revalidate(action);
        if (!current()) return;
        if (!state.actions.includes(selected) || Date.parse(action.expiresAt) <= serverNow()) { this.expireObservation(); return; }
        const target = action.actionCode === 'OPEN_PROFILE' ? buildUrl(ROUTES.profile)
          : action.actionCode === 'OPEN_PRODUCT' ? buildUrl(ROUTES.item, { id: action.resource.id, service: context.serviceCode })
            : buildUrl(ROUTES.order, { id: orderId, service: context.serviceCode, paymentIntentId: action.resource.id });
        navigate(target); this.withdraw();
      } catch {
        if (current()) { state.actions = []; this.setData({ ...blank, rows: [], message: '原资料或权限已变化，请重新核对；原人工入口仍可使用。' }); }
      } finally {
        if (states.get(this) === state && state.epoch === epoch) {
          if (!current()) this.withdraw(); else { state.busy = false; this.setData({ busy: false }); }
        }
      }
    },
  },
});
