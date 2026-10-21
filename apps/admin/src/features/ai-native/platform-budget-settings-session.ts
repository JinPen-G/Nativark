/** SaaS policy editing over the original budget service. One durable original
 * key/hash across unknown replies; current policy is never the old receipt. */
import type { AiPlatformBudgetSettingsReadDraft, AiPlatformBudgetSettingsSaveDraft, AiPlatformBudgetSettingsSummaryDraft,
  AiPlatformBudgetSettingsOperationReadDraft } from '@rental-os/shared';
import { budgetPolicyFields, commandHash, prepareBudgetFields, type BudgetForm } from './budget-settings-session';

const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const code = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
const rev = (v: unknown, min = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 4294967295;
const invalid = (): never => { throw Error('AI_INVALID_INPUT'); };
export function platformBudgetSummary(v: unknown, sceneCode: string): AiPlatformBudgetSettingsSummaryDraft {
  if (!row(v) || v.scope !== 'platform' || v.sceneCode !== sceneCode || v.admission !== 'not_granted') return invalid();
  const base = { scope: 'platform' as const, sceneCode, admission: 'not_granted' as const };
  if (v.state === 'not_configured' && v.revision === null && v.settings === null) return { ...base, state: v.state, revision: null, settings: null };
  if (v.state !== 'configured' || !rev(v.revision) || !row(v.settings) || !Array.isArray(v.settings.allowedModels)
    || v.settings.allowedModels.length > 100 || !v.settings.allowedModels.every(m => typeof m === 'string'
      && m.length > 0 && m.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(m))) return invalid();
  return { ...base, state: 'configured', revision: v.revision,
    settings: { ...budgetPolicyFields(v.settings), allowedModels: [...v.settings.allowedModels] as string[] } };
}
export type PlatformBudgetForm = Omit<BudgetForm, 'enabled'> & { allowedModels: string; allowedScenes: string;
  platformEnabled: boolean; tenantEnabled: boolean; sceneEnabled: boolean; confirmed: boolean };
const entries = (text: string, model = false) => {
  if (typeof text !== 'string' || text.length > 25700) return invalid();
  const values = text === '' ? [] : text.split('\n');
  if (values.length > 100 || new Set(values).size !== values.length || !values.every(v => model
    ? v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v) : code(v))) return invalid();
  return values;
};
type Ports = { platformRead(v: AiPlatformBudgetSettingsReadDraft, s: AbortSignal): Promise<unknown>;
  platformSave(v: AiPlatformBudgetSettingsSaveDraft, s: AbortSignal): Promise<unknown>;
  platformReadOperation(v: AiPlatformBudgetSettingsOperationReadDraft, s: AbortSignal): Promise<unknown> };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type State = Readonly<{ busy: boolean; locked: boolean; policy: AiPlatformBudgetSettingsSummaryDraft | null;
  feedback: 'idle' | 'saved' | 'recorded' | 'unknown' | 'conflict' | 'denied' | 'invalid' | 'unavailable' }>;
export class PlatformBudgetSettingsSession {
  private state: State; private active = true; private generation = 0; private flight: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly sceneCode: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly canManage: () => boolean, private readonly storage: Storage | undefined, private readonly key: string,
    private readonly newKey = () => globalThis.crypto.randomUUID()) {
    if (!code(sceneCode)) invalid();
    let locked = true; try { locked = !storage || storage.getItem(key) !== null; } catch { /* unknown remains closed */ }
    this.state = { busy: false, locked, policy: null, feedback: locked ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  activate() { this.active = true; }
  dispose() { this.active = false; this.generation++; this.flight?.abort(); this.flight = null; }
  private update(v: Partial<State>) { this.state = Object.freeze({ ...this.state, ...v }); this.listeners.forEach(f => f()); }
  private check(s: AbortSignal, g: number) { if (!this.active || s.aborted || !this.current() || g !== this.generation) throw Error('AI_SCOPE_CHANGED'); }
  read = () => this.run('read');
  save = (form: PlatformBudgetForm) => this.run('save', structuredClone(form));
  reconcile = () => this.run('receipt');
  private async run(action: 'read' | 'save' | 'receipt', form?: PlatformBudgetForm) {
    if (this.flight) throw Error('AI_BUSY');
    const c = new AbortController(), g = this.generation; this.check(c.signal, g); this.flight = c;
    const old = structuredClone(this.state.policy); let attempted = false, marker: string | null | undefined;
    this.update({ busy: true, policy: null });
    try {
      marker = this.storage?.getItem(this.key);
      if (action === 'read') {
        const policy = platformBudgetSummary(structuredClone(await this.ports.platformRead({ sceneCode: this.sceneCode }, c.signal)), this.sceneCode);
        this.check(c.signal, g); this.update({ policy, feedback: this.state.locked ? 'unknown' : 'idle' }); return policy;
      }
      if (!this.storage) throw Error('AI_RESOURCE_UNAVAILABLE');
      if (action === 'receipt') {
        if (!marker || marker.length > 1024) throw Error('AI_RESULT_UNKNOWN');
        const pending: unknown = JSON.parse(marker);
        if (!row(pending) || !code(pending.operationKey) || pending.sceneCode !== this.sceneCode || !rev(pending.expectedRevision, 0)
          || typeof pending.commandHash !== 'string' || !/^[a-f0-9]{64}$/u.test(pending.commandHash)) throw Error('AI_RESULT_UNKNOWN');
        const receipt = structuredClone(await this.ports.platformReadOperation({ sceneCode: this.sceneCode, operationKey: pending.operationKey }, c.signal));
        this.check(c.signal, g);
        if (!row(receipt) || receipt.state !== 'recorded' || receipt.scope !== 'platform' || receipt.sceneCode !== this.sceneCode
          || receipt.operationKey !== pending.operationKey || receipt.action !== 'platformSave' || receipt.admission !== 'not_granted'
          || receipt.automaticRetry !== false || receipt.commandHash !== pending.commandHash || receipt.expectedRevision !== pending.expectedRevision
          || receipt.savedRevision !== pending.expectedRevision + 1 || typeof receipt.recordedAt !== 'string'
          || !Number.isFinite(Date.parse(receipt.recordedAt))) throw Error('AI_RESULT_UNKNOWN');
        this.clear(marker); this.update({ locked: false, feedback: 'recorded' }); return receipt;
      }
      if (!this.canManage()) throw Error('AI_ACCESS_DENIED');
      if (marker !== null || this.state.locked || !old || !form) throw Error('AI_RESULT_UNKNOWN');
      if (form.confirmed !== true) return invalid();
      const fields = prepareBudgetFields({ ...form, enabled: false }), names = ['platform', 'tenant', 'scene'] as const;
      const gates = Object.fromEntries(names.map(name => {
        const enabled = form[`${name}Enabled`], previous = old.settings?.gates[name];
        if (typeof enabled !== 'boolean' || (!old.settings && enabled)) return invalid();
        const revision = previous ? previous.revision + (enabled === previous.enabled ? 0 : 1) : 1;
        if (!rev(revision)) return invalid(); return [name, { enabled, revision }];
      })) as AiPlatformBudgetSettingsSaveDraft['settings']['gates'];
      const command: AiPlatformBudgetSettingsSaveDraft = { sceneCode: this.sceneCode, operationKey: this.newKey(), expectedRevision: old.revision ?? 0,
        settings: { budget: fields.budget, maxConcurrent: fields.maxConcurrent, maxCallsPerRun: fields.maxCallsPerRun, gates,
          allowedModels: entries(form.allowedModels, true), allowedScenes: entries(form.allowedScenes) } };
      if (!code(command.operationKey) || command.expectedRevision >= 4294967295) return invalid();
      const fingerprint = await commandHash(command); this.check(c.signal, g);
      if (!this.canManage()) throw Error('AI_ACCESS_DENIED');
      if (this.storage.getItem(this.key) !== null) { this.update({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
      marker = JSON.stringify({ sceneCode: this.sceneCode, operationKey: command.operationKey, expectedRevision: command.expectedRevision, commandHash: fingerprint });
      this.storage.setItem(this.key, marker); this.update({ locked: true });
      if (this.storage.getItem(this.key) !== marker) throw Error('AI_RESULT_UNKNOWN');
      this.check(c.signal, g); attempted = true;
      const policy = platformBudgetSummary(structuredClone(await this.ports.platformSave(command, c.signal)), this.sceneCode);
      this.check(c.signal, g);
      if (policy.state !== 'configured' || policy.revision !== command.expectedRevision + 1
        || await commandHash(policy.settings) !== await commandHash(command.settings)) throw Error('AI_RESULT_UNKNOWN');
      this.check(c.signal, g); this.clear(marker); this.update({ locked: false, policy, feedback: 'saved' }); return policy;
    } catch (error) {
      if (this.active && !c.signal.aborted && g === this.generation) {
        const e = error as { message?: string; response?: { status?: number; data?: { code?: string } } };
        const denied = !this.current() || e.message === 'AI_ACCESS_DENIED' || [401, 403].includes(e.response?.status ?? 0);
        const known = attempted && ['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(e.response?.data?.code ?? '');
        if (known && marker) { try { this.clear(marker); this.update({ locked: false }); } catch { /* no unsafe unlock */ } }
        this.update({ policy: null, feedback: denied ? 'denied' : this.state.locked ? 'unknown'
          : e.response?.data?.code === 'AI_REVISION_CONFLICT' ? 'conflict'
            : e.message === 'AI_INVALID_INPUT' || e.response?.data?.code === 'AI_INVALID_INPUT' ? 'invalid' : 'unavailable' });
      }
      throw error;
    } finally { if (this.flight === c) this.flight = null; if (this.active && g === this.generation) this.update({ busy: false }); }
  }
  private clear(marker: string) {
    if (!this.storage || this.storage.getItem(this.key) !== marker) throw Error('AI_RESULT_UNKNOWN');
    this.storage.removeItem(this.key); if (this.storage.getItem(this.key) !== null) throw Error('AI_RESULT_UNKNOWN');
  }
}
