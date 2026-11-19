/** Explicit customer scene-directory observation through the original HTTP
 * client. Mount, show and local recovery never read it. Session/service changes,
 * hide and expiry withdraw metadata; rows provide no object or Task authority. */
import type { AiEntrySceneCatalogEntry, AiEntrySceneCatalogResponse } from '@rental-os/shared';
import { AI_ENTRY_SCENE_CATALOG_HTTP, entrySceneAvailabilityLabel, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse } from '../scene-catalog-runtime';
import { request } from '../../../core/http';
import { currentSession, contextVersion, sessionEvents } from '../../../core/session';
import { serverNow } from '../../../core/clock';
import { createRentalMiniProgramSceneCatalogApi } from "@rental-os/rental-core/clients/miniprogram";

const sceneCatalogApi = createRentalMiniProgramSceneCatalogApi({
  request, currentSession, contextVersion, serverNow,
  contracts: { AI_ENTRY_SCENE_CATALOG_HTTP, isAiEntrySceneCatalogRequest, isAiEntrySceneCatalogResponse },
});

interface Row {
  id: string; title: string; goal: string; status: string; risk: string; confirmation: string;
  tools: string; permissions: string; results: number; source: string; manual: string; redaction: string; details: boolean;
}
type State = { epoch: number; busy: boolean; page: AiEntrySceneCatalogResponse | null; cursors: Array<string | null>;
  current: (() => boolean) | null; timer: ReturnType<typeof setTimeout> | null };
const states = new WeakMap<object, State>(), shown = new WeakSet<object>(), subscriptions = new WeakMap<object, () => void>();
const stateFor = (instance: object) => {
  let state = states.get(instance);
  if (!state) { state = { epoch: 0, busy: false, page: null, cursors: [null], current: null, timer: null }; states.set(instance, state); }
  return state;
};

const statuses = { available: '已观察原入口', manual_only: '保留人工路径', unavailable: '当前不可用' };
const confirmations = { read_only: '只读', explicit_prepare_or_save: '明确准备或保存',
  review_approval_and_original_submit: '审核批准后在原入口提交', original_human_submit: '人工在原入口提交' };
function project(entry: AiEntrySceneCatalogEntry): Row {
  const { state, reason } = entry.availability;
  return { id: entry.entryId, title: entry.title, goal: entry.goal, status: state === 'available' ? statuses[state] : `${statuses[state]} · ${entrySceneAvailabilityLabel(reason)}`, risk: entry.riskLevel,
    confirmation: confirmations[entry.confirmation], tools: entry.tools.map(tool => tool.code).join(' · ') || '沿原人工入口',
    permissions: entry.requiredPermissions.join(' · ') || '原入口核对本人及资源范围', results: entry.output.maxResults,
    source: entry.availability.source ? `${entry.availability.source.reference} / ${entry.availability.source.revision}` : '未观察到',
    manual: entry.manualExit, redaction: entry.redaction.join(' · '), details: false };
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { serviceCode: { type: String, value: '' } },
  data: { open: false, busy: false, message: '', rows: [] as Row[], observedAt: '', pageIndex: 0, hasPrevious: false, hasNext: false },
  lifetimes: {
    attached() { shown.add(this); stateFor(this); subscriptions.set(this, sessionEvents.on(() => this.clearCatalog())); },
    detached() { shown.delete(this); this.clearCatalog(); subscriptions.get(this)?.(); subscriptions.delete(this); states.delete(this); },
  },
  pageLifetimes: { show() { shown.add(this); }, hide() { shown.delete(this); this.clearCatalog(); } },
  observers: { serviceCode() { this.clearCatalog(); } },
  methods: {
    clearCatalog() {
      const state = stateFor(this); state.epoch++; state.busy = false; state.page = null; state.cursors = [null]; state.current = null;
      if (state.timer !== null) clearTimeout(state.timer); state.timer = null;
      this.setData({ open: false, busy: false, message: '', rows: [], observedAt: '', pageIndex: 0, hasPrevious: false, hasNext: false });
    },
    async readPage(index = 0, paginate = false) {
      const state = stateFor(this), service = this.data.serviceCode;
      let epoch = state.epoch;
      const context = sceneCatalogApi.captureContext({ serviceCode: service,
        current: () => shown.has(this) && states.get(this) === state && state.epoch === epoch
          && this.data.serviceCode === service,
      });
      if (state.busy || !shown.has(this)) return;
      if (!context) {
        this.clearCatalog(); this.setData({ message: '请登录当前服务后核对场景；普通选品和预约仍可继续。' }); return;
      }
      if (paginate && (!state.page || !state.current?.() || Date.parse(state.page.expiresAt) <= serverNow())) {
        this.clearCatalog(); this.setData({ message: '场景观察已失效，请重新核对；原人工路径仍可使用。' }); return;
      }
      if (!Number.isInteger(index) || index < 0 || index > this.data.pageIndex + 1) return;
      const after = index > this.data.pageIndex ? state.page?.nextAfter : state.cursors[index];
      if (index > 0 && (!after || !state.current?.())) { this.clearCatalog(); return; }
      const previousScope = paginate ? state.page?.scope : undefined;
      epoch = ++state.epoch;
      const current = context.current;
      state.current = current; state.busy = true; state.page = null;
      if (state.timer !== null) clearTimeout(state.timer); state.timer = null;
      this.setData({ open: true, busy: true, message: '', rows: [], observedAt: '', hasPrevious: false, hasNext: false });
      try {
        const command = { limit: 20, ...(after ? { after } : {}) };
        const observation = await context.readPage(command, previousScope);
        if (!observation) return;
        const { page: value, remaining } = observation;
        state.page = value; state.cursors = [...state.cursors.slice(0, index), after ?? null];
        this.setData({ open: true, rows: value.entries.map(project), observedAt: value.observedAt, pageIndex: index,
          hasPrevious: index > 0, hasNext: value.nextAfter !== null });
        state.timer = setTimeout(() => {
          if (states.get(this) !== state || state.epoch !== epoch) return;
          this.clearCatalog(); this.setData({ message: '场景观察已到期，请重新核对；原人工路径仍可使用。' });
        }, remaining);
      } catch {
        if (current()) { state.page = null; state.cursors = [null]; this.setData({ rows: [], observedAt: '', hasPrevious: false, hasNext: false,
          pageIndex: 0, message: '场景目录当前不可读取；请继续使用原人工入口。' }); }
      } finally {
        if (current()) { state.busy = false; this.setData({ busy: false }); }
        else if (shown.has(this) && states.get(this) === state && state.epoch === epoch) this.clearCatalog();
      }
    },
    onOpen() { return this.readPage(); },
    onClose() { this.clearCatalog(); },
    onPrevious() { return this.readPage(this.data.pageIndex - 1, true); },
    onNext() { return this.readPage(this.data.pageIndex + 1, true); },
    onDetails(event: WechatMiniprogram.TouchEvent) {
      const state = states.get(this);
      if (!state?.page || !state.current?.() || Date.parse(state.page.expiresAt) <= serverNow()) { this.clearCatalog(); return; }
      const id = String(event.currentTarget.dataset.id ?? '');
      this.setData({ rows: this.data.rows.map(row => row.id === id ? { ...row, details: !row.details } : row) });
    },
  },
});
