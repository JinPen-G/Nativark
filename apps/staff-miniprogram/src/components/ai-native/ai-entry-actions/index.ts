/** Explicit original-order navigation controls. Signed Actions remain in the
 * private session; component data contains display rows only. Hiding, reloads
 * and current-principal changes invalidate every pending delivery. */
import { createStaffEntryActionSession, type StaffEntryActionSession, type StaffEntryActionView } from '../entry-action-session';
import { sessionEvents } from '../../../core/session';

const states = new WeakMap<object, { session: StaffEntryActionSession | null; enabled: boolean }>(), shown = new WeakSet<object>(),
  subscriptions = new WeakMap<object, () => void>();
const blank: StaffEntryActionView = { phase: 'idle', busy: false, rows: [], observedAt: '', message: '' };

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { orderId: { type: String, value: '' }, contextKey: { type: String, value: '' }, available: { type: Boolean, value: false } },
  data: { ...blank },
  lifetimes: {
    attached() {
      shown.add(this); states.set(this, { session: null,
        enabled: this.data.available === true && !!this.data.orderId && !!this.data.contextKey });
      subscriptions.set(this, sessionEvents.on(() => this.withdraw()));
    },
    detached() {
      shown.delete(this); states.get(this)?.session?.dispose(); states.delete(this);
      subscriptions.get(this)?.(); subscriptions.delete(this);
    },
  },
  pageLifetimes: { show() { shown.add(this); }, hide() { shown.delete(this); this.withdraw(); } },
  observers: { 'orderId,contextKey,available'() {
    this.withdraw();
    const state = states.get(this);
    if (state) state.enabled = this.data.available === true && !!this.data.orderId && !!this.data.contextKey;
  } },
  methods: {
    withdraw() {
      const state = states.get(this); state?.session?.dispose();
      // The host can retire a page before new properties reach this child.
      // Keep it suspended until a subsequent coherent property update.
      if (state) { state.session = null; state.enabled = false; }
      if (states.has(this)) this.setData({ ...blank, rows: [] });
    },
    async onRead(): Promise<void> {
      const state = states.get(this), orderId = this.data.orderId, contextKey = this.data.contextKey;
      if (!state?.enabled || !shown.has(this) || this.data.available !== true || !orderId || !contextKey || state.session?.snapshot().busy) return;
      if (!state.session) {
        state.session = createStaffEntryActionSession({ orderId,
          isCurrent: () => states.get(this) === state && state.enabled && shown.has(this) && this.data.available === true
            && this.data.orderId === orderId && this.data.contextKey === contextKey,
          changed: value => {
            if (states.get(this) === state && shown.has(this) && this.data.orderId === orderId && this.data.contextKey === contextKey)
              this.setData({ ...value });
          },
        });
      }
      await state.session.read();
    },
    async onOpen(event: WechatMiniprogram.TouchEvent): Promise<void> {
      const actionId: unknown = event.currentTarget.dataset.actionId;
      if (!states.get(this)?.enabled || !shown.has(this) || this.data.available !== true || typeof actionId !== 'string') return;
      await states.get(this)?.session?.open(actionId);
    },
  },
});
