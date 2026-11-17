/** Owns only the current employee page's navigation observation. Full signed
 * Actions stay in memory; expiry, hiding and page/session changes retire them.
 * Opening a fixed destination rechecks the original Action, never dispatches
 * allocation, payment, Task or model execution. */
import type { AiRegisteredEntryAction, AiRegisteredEntryActionObservation } from '@rental-os/shared';
import { captureStaffEntryActionContext, createStaffEntryActionApi, type StaffEntryActionApi,
  type StaffOrderEntryCode } from '../../api/ai-entry-actions';
import { can, canTenant } from '../../core/session';
import { serverNow } from '../../core/clock';
import { ROUTES, buildUrl, navigate } from '../../core/ui';

export interface StaffEntryActionRow { actionId: string; title: string; label: string; destination: string }
export interface StaffEntryActionView {
  phase: 'idle' | 'reading' | 'ready' | 'revalidating' | 'unavailable' | 'expired' | 'hidden';
  busy: boolean; rows: StaffEntryActionRow[]; observedAt: string; message: string;
}
export interface StaffEntryActionSessionOptions {
  orderId: string; isCurrent(): boolean; changed(view: StaffEntryActionView): void;
  api?: StaffEntryActionApi; openDestination?(url: string): void;
}
const titles: Record<StaffOrderEntryCode, string> = {
  OPEN_ORDER: '查看原订单', OPEN_CUSTOMER: '查看原客户', OPEN_PRODUCT: '查看原商品', OPEN_DISPATCH: '打开配货页',
};
function permitted(action: AiRegisteredEntryAction): boolean {
  if (!can('rental-os:order:view')) return false;
  switch (action.actionCode) {
    case 'OPEN_ORDER': return true;
    case 'OPEN_CUSTOMER': return canTenant('rental-os:member:view', 'rental-os:member:manage');
    case 'OPEN_PRODUCT': return can('rental-core:catalog:view', 'rental-core:catalog:manage');
    case 'OPEN_DISPATCH': return can('rental-os:order:operate');
    default: return false;
  }
}
function destination(action: AiRegisteredEntryAction): string {
  switch (action.actionCode) {
    case 'OPEN_ORDER': return buildUrl(ROUTES.order, { id: action.resource.id });
    case 'OPEN_CUSTOMER': return buildUrl(ROUTES.customer, { id: action.resource.id });
    case 'OPEN_PRODUCT': return buildUrl(ROUTES.product, { itemGroupId: action.resource.id });
    case 'OPEN_DISPATCH': return buildUrl(ROUTES.allocate, { id: action.resource.id });
    default: throw Error('原目标页当前不可用。');
  }
}
function row(value: AiRegisteredEntryActionObservation): StaffEntryActionRow {
  const code = value.action.actionCode as StaffOrderEntryCode;
  return { actionId: value.action.actionId, title: titles[code], label: value.label,
    destination: code === 'OPEN_CUSTOMER' ? value.action.resource.customerType === 'corporate' ? '企业客户' : '个人客户'
      : code === 'OPEN_DISPATCH' ? '配货由原页面另行确认' : code === 'OPEN_PRODUCT' ? '原商品资料' : '原订单详情' };
}

export function createStaffEntryActionSession(options: StaffEntryActionSessionOptions) {
  const api = options.api ?? createStaffEntryActionApi(), openDestination = options.openDestination ?? navigate;
  let epoch = 0, disposed = false, actions: AiRegisteredEntryActionObservation[] = [],
    context: ReturnType<typeof captureStaffEntryActionContext> | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let view: StaffEntryActionView = { phase: 'idle', busy: false, rows: [], observedAt: '', message: '' };
  const publish = () => options.changed({ ...view, rows: view.rows.map(value => ({ ...value })) });
  const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const current = () => !disposed && options.isCurrent() && context?.current() === true;
  const clear = (phase: StaffEntryActionView['phase'], message = '') => {
    epoch++; clearTimer(); actions = []; context = null;
    view = { phase, message, busy: false, rows: [], observedAt: '' };
    if (!disposed) publish();
  };
  const fail = () => clear('unavailable', '当前入口无法核对，请刷新订单后重新读取；原页面仍按各自权限办理。');
  const armExpiry = (generation: number) => {
    clearTimer();
    const deadline = Math.min(...actions.map(value => Date.parse(value.action.expiresAt))), remaining = deadline - serverNow();
    if (!(remaining > 0)) { clear('expired', '入口观察已到期，请重新读取。'); return; }
    timer = setTimeout(() => {
      if (disposed || epoch !== generation) return;
      clear('expired', '入口观察已到期，请重新读取。');
    }, remaining);
  };
  return Object.freeze({
    snapshot(): StaffEntryActionView { return { ...view, rows: view.rows.map(value => ({ ...value })) }; },
    withdraw() { clear('hidden'); },
    dispose() { disposed = true; clear('hidden'); },
    async read(): Promise<void> {
      if (disposed || view.busy || !options.isCurrent()) return;
      const generation = ++epoch; clearTimer(); actions = [];
      try { context = captureStaffEntryActionContext(); } catch { fail(); return; }
      view = { phase: 'reading', busy: true, rows: [], observedAt: '', message: '' }; publish();
      try {
        if (!current()) throw Error('original_page_changed');
        const result = await api.fromOrder({ orderId: options.orderId });
        if (epoch !== generation || disposed) return;
        if (!current()) { fail(); return; }
        actions = result.actions.filter(value => permitted(value.action));
        if (!actions.length || actions.some(value => Date.parse(value.action.expiresAt) <= serverNow())) throw Error('original_action_expired');
        view = { phase: 'ready', busy: false, rows: actions.map(row), observedAt: result.observedAt, message: '' };
        armExpiry(generation); if (epoch === generation) publish();
      } catch {
        if (!disposed && epoch === generation) fail();
      } finally {
        if (!disposed && epoch === generation && view.busy) { view = { ...view, busy: false }; publish(); }
      }
    },
    async open(actionId: string): Promise<void> {
      if (disposed || view.busy || view.phase !== 'ready') return;
      const selected = actions.find(value => value.action.actionId === actionId);
      if (!selected) return;
      if (!current() || !permitted(selected.action)) { fail(); return; }
      if (Date.parse(selected.action.expiresAt) <= serverNow()) { clear('expired', '入口观察已到期，请重新读取。'); return; }
      const generation = epoch, action = selected.action, target = destination(action);
      view = { ...view, phase: 'revalidating', busy: true, message: '' }; publish();
      try {
        if (!current() || !permitted(action)) throw Error('original_authority_changed');
        await api.revalidate({ action });
        if (disposed || epoch !== generation) return;
        if (!current() || !permitted(action) || !actions.includes(selected) || Date.parse(action.expiresAt) <= serverNow()) {
          fail(); return;
        }
        // No await or caller-supplied route occurs between the closing fence
        // and the fixed navigation. The destination still owns its own Guard.
        openDestination(target);
        if (!disposed && epoch === generation) clear('idle');
      } catch {
        if (!disposed && epoch === generation) fail();
      }
    },
  });
}
export type StaffEntryActionSession = ReturnType<typeof createStaffEntryActionSession>;
