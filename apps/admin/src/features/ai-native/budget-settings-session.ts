/** One current-scope policy editor. Unknown writes remain locked across reload;
 * a current policy read is not an immutable receipt for an earlier save. */
import type { AiBudgetLimitDraft, AiBudgetSettingsReadDraft, AiBudgetSettingsSummaryDraft,
  AiBudgetSettingsChangeDraft, AiBudgetSettingsInitializeDraft, AiBudgetSettingsRefreshConfigurationDraft } from '@rental-os/shared';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const code = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
const invalid = (): never => { throw Error('AI_INVALID_INPUT'); };
function limit(v: unknown): AiBudgetLimitDraft {
  if (!object(v)) return invalid();
  if (v.state === 'not_configured') return { state: v.state };
  if (!['zero', 'limited'].includes(String(v.state)) || !object(v.quantity)) return invalid();
  const q = v.quantity;
  if (q.unit === 'money') {
    if (typeof q.amount !== 'string' || !/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u.test(q.amount)
      || typeof q.currency !== 'string' || !/^[A-Z]{3}$/u.test(q.currency) || q.scale !== 6) return invalid();
    if ((v.state === 'zero') !== (q.amount === '0.000000')) return invalid();
    return v.state === 'zero' ? { state: 'zero', quantity: { unit: 'money', amount: '0.000000', currency: q.currency, scale: 6 } }
      : { state: 'limited', quantity: { unit: 'money', amount: q.amount, currency: q.currency, scale: 6 } };
  }
  if (!['tokens', 'calls'].includes(String(q.unit)) || !integer(q.value, 0, q.unit === 'calls' ? 4294967295 : Number.MAX_SAFE_INTEGER)
    || (v.state === 'zero') !== (q.value === 0)) return invalid();
  return v.state === 'zero' ? { state: 'zero', quantity: { unit: q.unit as 'tokens' | 'calls', value: 0 } }
    : { state: 'limited', quantity: { unit: q.unit as 'tokens' | 'calls', value: q.value } };
}
/** Select only existing shared display fields; never expose extension JSON. */
export function budgetSettingsSummary(value: unknown, selector: AiBudgetSettingsReadDraft): AiBudgetSettingsSummaryDraft {
  if (!object(value) || value.scope !== selector.scope || value.sceneCode !== selector.sceneCode || value.admission !== 'not_granted') return invalid();
  const base = { ...selector, admission: 'not_granted' as const };
  if (value.state === 'not_configured' && value.revision === null && value.settings === null && value.modelPolicy === null)
    return { ...base, state: 'not_configured', revision: null, settings: null, modelPolicy: null };
  if (value.state !== 'configured' || !integer(value.revision, 1, 4294967295) || !object(value.settings)
    || value.configurationMeaning !== 'saved_policy_reference_not_current_selection' || !object(value.modelPolicy)) return invalid();
  const s = value.settings;
  if (!object(s.gates) || !integer(s.maxConcurrent, 0, 10000) || !integer(s.maxCallsPerRun, 0, 10000)
    || !Array.isArray(s.allowedScenes) || s.allowedScenes.length > 100 || !s.allowedScenes.every(code)) return invalid();
  const gate = (key: string) => { const g = (s.gates as Record<string, unknown>)[key];
    if (!object(g) || typeof g.enabled !== 'boolean' || !integer(g.revision, 1, 4294967295)) return invalid();
    return { enabled: g.enabled, revision: g.revision }; };
  const m = value.modelPolicy;
  let modelPolicy: Extract<AiBudgetSettingsSummaryDraft, { state: 'configured' }>['modelPolicy'];
  if (m.mode === 'platform_managed' && m.serviceName === 'Rental OS AI' && m.selection === 'managed_by_platform')
    modelPolicy = { mode: m.mode, serviceName: 'Rental OS AI', selection: m.selection };
  else if (m.mode === 'tenant_managed' && Array.isArray(m.allowedModels) && m.allowedModels.length <= 100
    && m.allowedModels.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v)))
    modelPolicy = { mode: m.mode, allowedModels: [...m.allowedModels] as string[] };
  else return invalid();
  return { ...base, state: 'configured', revision: value.revision, modelPolicy,
    configurationMeaning: value.configurationMeaning, settings: { gates: { platform: gate('platform'), tenant: gate('tenant'), scene: gate('scene') },
      budget: limit(s.budget), allowedScenes: [...s.allowedScenes], maxConcurrent: s.maxConcurrent, maxCallsPerRun: s.maxCallsPerRun } };
}
export type BudgetForm = { state: 'not_configured' | 'zero' | 'limited'; unit: 'calls' | 'tokens' | 'money';
  amount: string; currency: string; concurrent: string; calls: string; enabled: boolean };
export function prepareBudgetFields(v: BudgetForm) {
  const natural = (s: string, max: number) => /^(0|[1-9][0-9]*)$/u.test(s) && integer(Number(s), 0, max) ? Number(s) : invalid();
  const budget = limit(v.state === 'not_configured' ? { state: v.state } : { state: v.state, quantity: v.unit === 'money'
    ? { unit: v.unit, amount: v.amount, currency: v.currency, scale: 6 }
    : { unit: v.unit, value: natural(v.amount, v.unit === 'calls' ? 4294967295 : Number.MAX_SAFE_INTEGER) } });
  if (typeof v.enabled !== 'boolean') return invalid();
  return { budget, maxConcurrent: natural(v.concurrent, 10000), maxCallsPerRun: natural(v.calls, 10000), enabled: v.enabled };
}
type Ports = { read(v: AiBudgetSettingsReadDraft, s: AbortSignal): Promise<unknown>;
  change(v: AiBudgetSettingsChangeDraft, s: AbortSignal): Promise<unknown>;
  initialize(v: AiBudgetSettingsInitializeDraft, s: AbortSignal): Promise<unknown>;
  refreshConfiguration(v: AiBudgetSettingsRefreshConfigurationDraft, s: AbortSignal): Promise<unknown> };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type BudgetEditorState = Readonly<{ busy: boolean; policy: AiBudgetSettingsSummaryDraft | null; locked: boolean;
  feedback: 'idle' | 'saved' | 'changed' | 'unknown' | 'conflict' | 'denied' | 'unavailable' | 'invalid' }>;
export class BudgetSettingsSession {
  private active = true; private request: AbortController | null = null; private listeners = new Set<() => void>();
  private state: BudgetEditorState;
  private readonly selector: AiBudgetSettingsReadDraft;
  constructor(selector: AiBudgetSettingsReadDraft, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Storage | undefined, private readonly key: string) {
    if (!['tenant', 'workspace'].includes(selector.scope) || !code(selector.sceneCode)) invalid();
    this.selector = Object.freeze(structuredClone(selector));
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* no safe unknown recovery */ }
    this.state = { busy: false, policy: null, locked, feedback: locked ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate() { this.active = true; }
  dispose() { this.active = false; this.request?.abort(); }
  private publish(patch: Partial<BudgetEditorState>) { this.state = Object.freeze({ ...this.state, ...patch }); for (const l of this.listeners) l(); }
  private check(signal?: AbortSignal) { if (!this.active || !this.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); }
  read = () => this.run();
  save = (fields: BudgetForm) => this.run(structuredClone(fields));
  refresh = () => this.run('refresh');
  private async run(change?: BudgetForm | 'refresh') {
    this.check(); if (this.request) throw Error('AI_BUSY');
    const controller = new AbortController(); this.request = controller;
    const old = structuredClone(this.state.policy); let attempted = false;
    this.publish({ busy: true, feedback: this.state.locked ? 'unknown' : 'idle', ...(change ? {} : { policy: null }) });
    try {
      if (!change) {
        const policy = budgetSettingsSummary(structuredClone(await this.ports.read(this.selector, controller.signal)), this.selector);
        this.check(controller.signal); this.publish({ policy }); return policy;
      }
      if (this.state.locked || !old || !this.storage) throw Error('AI_RESULT_UNKNOWN');
      if (this.storage.getItem(this.key) !== null) { this.publish({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
      if (change === 'refresh' && old.state !== 'configured') return invalid();
      const expectedRevision = old.revision ?? 0;
      const fields = change === 'refresh' ? null : prepareBudgetFields(change);
      if (old.state === 'not_configured' && fields?.enabled) return invalid();
      const marker = JSON.stringify({ ...this.selector, expectedRevision, operation: change === 'refresh' ? 'refresh' : old.state === 'configured' ? 'change' : 'initialize' });
      this.storage.setItem(this.key, marker); if (this.storage.getItem(this.key) !== marker) throw Error('AI_RESOURCE_UNAVAILABLE');
      this.publish({ locked: true }); this.check(controller.signal); attempted = true;
      const raw = structuredClone(await (change === 'refresh'
        ? this.ports.refreshConfiguration({ ...this.selector, expectedRevision, confirmCurrentConfiguration: true }, controller.signal)
        : old.state === 'not_configured' ? this.ports.initialize({ ...this.selector, expectedRevision: 0, ...fields! }, controller.signal)
          : this.ports.change({ ...this.selector, expectedRevision, changes: fields! }, controller.signal)));
      this.check(controller.signal);
      if (!object(raw) || raw.savedRevision !== expectedRevision + 1 || !['same_revision', 'changed_after_save'].includes(String(raw.observation))) throw Error('AI_RESULT_UNKNOWN');
      const policy = budgetSettingsSummary(raw.policy, this.selector);
      if (policy.state !== 'configured' || (raw.observation === 'same_revision' ? policy.revision !== raw.savedRevision : policy.revision <= raw.savedRevision)) throw Error('AI_RESULT_UNKNOWN');
      this.storage.removeItem(this.key);
      if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ locked: false, policy: raw.observation === 'same_revision' ? policy : null,
        feedback: raw.observation === 'same_revision' ? 'saved' : 'changed' }); return raw;
    } catch (error) {
      const e = error as { message?: string; response?: { status?: number; data?: { code?: string } } };
      if (this.active && !controller.signal.aborted) {
        const denied = !this.current() || [401, 403].includes(e.response?.status ?? 0);
        const known = attempted && ['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(e.response?.data?.code ?? '');
        let cleared = false;
        if (known) { try { this.storage?.removeItem(this.key); cleared = this.storage?.getItem(this.key) === null; } catch { /* remain locked */ } }
        const locked = known ? !cleared : attempted || this.state.locked;
        this.publish({ locked, policy: denied || attempted ? null : this.state.policy,
          feedback: denied ? 'denied' : attempted && !known ? 'unknown' : e.response?.data?.code === 'AI_REVISION_CONFLICT' ? 'conflict'
            : e.message === 'AI_INVALID_INPUT' || e.response?.data?.code === 'AI_INVALID_INPUT' ? 'invalid' : 'unavailable' });
      }
      throw error;
    } finally { if (this.request === controller) this.request = null; if (this.active) this.publish({ busy: false }); }
  }
}
