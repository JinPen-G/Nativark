/** Human-reviewed rates over the original pricing API. No supplier request,
 * input counting, financial admission or execution. Unknown retains its key. */
import type { AiGatewayPriceReviewDraft, AiGatewayPriceReviewReadDraft, AiGatewayPriceReviewResponseDraft,
  AiGatewayReviewedPriceBillingDraft } from '@rental-os/shared';
import { formSnapshotFingerprint } from '../../app/serverFormSnapshot';

const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const code = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const rev = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4294967295;
const amount = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u.test(v);
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(v) && Number.isFinite(Date.parse(v));
const invalid = (): never => { throw Error('AI_INVALID_INPUT'); };
function billing(v: unknown): AiGatewayReviewedPriceBillingDraft {
  if (!row(v)) return invalid();
  if (v.unit === 'tokens' && v.metric === 'input_plus_output' && v.scale === 0 && v.rounding === 'exact')
    return { unit: 'tokens', metric: 'input_plus_output', scale: 0, rounding: 'exact' };
  if (v.unit !== 'money' || typeof v.currency !== 'string' || !/^[A-Z]{3}$/u.test(v.currency) || v.scale !== 6
    || !amount(v.inputPerMillion) || !amount(v.outputPerMillion) || v.rounding !== 'ceil_total_micro_units') return invalid();
  if (v.inputCache !== undefined && (!row(v.inputCache) || !amount(v.inputCache.readPerMillion) || !amount(v.inputCache.writePerMillion))) return invalid();
  return { unit: 'money', currency: v.currency, scale: 6, inputPerMillion: v.inputPerMillion, outputPerMillion: v.outputPerMillion,
    rounding: 'ceil_total_micro_units', ...(row(v.inputCache) ? { inputCache: { readPerMillion: v.inputCache.readPerMillion as string,
      writePerMillion: v.inputCache.writePerMillion as string } } : {}) };
}
export type PlatformPriceForm = { sceneCode: string; priceVersion: string; validFrom: string; expiresAt: string;
  unit: 'tokens' | 'money'; currency: string; inputPerMillion: string; outputPerMillion: string;
  includeCache: boolean; readPerMillion: string; writePerMillion: string; confirmReviewedRate: boolean };
export function preparePlatformPrice(v: PlatformPriceForm): Pick<AiGatewayPriceReviewDraft, 'sceneCode' | 'priceVersion' | 'validFrom' | 'expiresAt' | 'billing' | 'confirmReviewedRate'> {
  if (!code(v.sceneCode) || !code(v.priceVersion, 64) || !time(v.validFrom) || !time(v.expiresAt)
    || Date.parse(v.expiresAt) <= Date.parse(v.validFrom) || v.confirmReviewedRate !== true
    || typeof v.includeCache !== 'boolean' || !['tokens', 'money'].includes(v.unit)) return invalid();
  return { sceneCode: v.sceneCode, priceVersion: v.priceVersion, validFrom: v.validFrom, expiresAt: v.expiresAt,
    confirmReviewedRate: true, billing: billing(v.unit === 'tokens'
      ? { unit: 'tokens', metric: 'input_plus_output', scale: 0, rounding: 'exact' }
      : { unit: 'money', currency: v.currency, scale: 6, inputPerMillion: v.inputPerMillion, outputPerMillion: v.outputPerMillion,
          rounding: 'ceil_total_micro_units', ...(v.includeCache ? { inputCache: { readPerMillion: v.readPerMillion, writePerMillion: v.writePerMillion } } : {}) }) };
}
function receipt(v: unknown, key: string, profileId: string): AiGatewayPriceReviewResponseDraft {
  if (!row(v) || v.state !== 'recorded' || v.operationKey !== key || v.configId !== profileId || !rev(v.configRevision)
    || !hash(v.id) || !hash(v.evidenceHash) || !hash(v.configurationHash) || !code(v.priceVersion, 64)
    || !time(v.validFrom) || !time(v.expiresAt) || Date.parse(v.validFrom) >= Date.parse(v.expiresAt)
    || v.rateAuthority !== 'platform_reviewed_budget_rate_not_provider_invoice'
    || v.inputCounting !== 'not_certified_by_rate_review' || v.executionPermission !== false) return invalid();
  return { state: 'recorded', operationKey: key, id: v.id, evidenceHash: v.evidenceHash, configurationHash: v.configurationHash,
    configId: profileId, configRevision: v.configRevision, priceVersion: v.priceVersion, validFrom: v.validFrom, expiresAt: v.expiresAt,
    billing: billing(v.billing), rateAuthority: v.rateAuthority, inputCounting: v.inputCounting, executionPermission: false };
}
const content = (v: AiGatewayPriceReviewResponseDraft | AiGatewayPriceReviewDraft) => ({ configId: v.configId,
  revision: 'configRevision' in v ? v.configRevision : v.expectedConfigRevision, priceVersion: v.priceVersion,
  validFrom: v.validFrom, expiresAt: v.expiresAt, billing: v.billing });
const digest = async (v: unknown) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(formSnapshotFingerprint(v)))), n => n.toString(16).padStart(2, '0')).join('');
type Pending = { operationKey: string; sceneCode: string; fingerprint: string };
type Ports = { platformReviewPrice(v: AiGatewayPriceReviewDraft, s: AbortSignal): Promise<unknown>;
  platformPriceReviewReceipt(v: AiGatewayPriceReviewReadDraft, s: AbortSignal): Promise<unknown> };
type Profile = { profileId: string; revision: number };
type State = Readonly<{ busy: boolean; locked: boolean; pending: Pending | null; result: AiGatewayPriceReviewResponseDraft | null;
  feedback: 'idle' | 'recorded' | 'unknown' | 'denied' | 'invalid' | 'conflict' | 'unavailable' }>;
export class PlatformPriceReviewSession {
  private state: State; private active = true; private flight: AbortController | null = null; private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly profileId: string, private readonly ports: Ports, private readonly current: () => boolean,
    private readonly canManage: () => boolean, private readonly profile: () => Profile | null,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, private readonly storageKey: string,
    private readonly newKey = () => globalThis.crypto.randomUUID()) {
    if (!code(profileId, 36)) invalid();
    let locked = true, pending: Pending | null = null;
    try { const raw = storage?.getItem(storageKey); locked = !storage || raw !== null;
      const p: unknown = raw && JSON.parse(raw);
      if (row(p) && code(p.operationKey) && code(p.sceneCode) && hash(p.fingerprint))
        pending = Object.freeze({ operationKey: p.operationKey, sceneCode: p.sceneCode, fingerprint: p.fingerprint });
    } catch { /* Invalid/absent storage is not permission to forget unknown. */ }
    this.state = { busy: false, locked, pending, result: null, feedback: locked ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  activate() { if (!this.active) { this.active = true; this.update({ busy: false }); } }
  dispose() { this.active = false; this.generation++; this.flight?.abort(); this.flight = null; }
  private check(signal: AbortSignal, generation: number) {
    if (!this.active || !this.current() || signal.aborted || generation !== this.generation) throw Error('AI_SCOPE_CHANGED');
  }
  private update(p: Partial<State>) { this.state = Object.freeze({ ...this.state, ...p }); this.listeners.forEach(f => f()); }
  save = (v: PlatformPriceForm) => this.run(structuredClone(v));
  reconcile = () => this.run();
  private async run(v?: PlatformPriceForm) {
    if (this.flight) throw Error('AI_BUSY');
    const controller = new AbortController(), generation = this.generation;
    this.check(controller.signal, generation); this.flight = controller; this.update({ busy: true, result: null });
    let attempted = false, marker: string | null | undefined;
    try {
      let pending = this.state.pending; marker = this.storage?.getItem(this.storageKey);
      let result: unknown;
      if (v) {
        if (!this.canManage()) throw Error('AI_ACCESS_DENIED');
        if (this.state.locked || !this.storage || marker !== null) { this.update({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
        const profile = structuredClone(this.profile());
        if (!profile || profile.profileId !== this.profileId || !rev(profile.revision)) throw Error('AI_RESOURCE_UNAVAILABLE');
        const prepared = preparePlatformPrice(v), operationKey = this.newKey(); if (!code(operationKey)) invalid();
        const command: AiGatewayPriceReviewDraft = { ...prepared, configId: profile.profileId, expectedConfigRevision: profile.revision, operationKey };
        pending = Object.freeze({ sceneCode: command.sceneCode, operationKey, fingerprint: await digest(content(command)) });
        this.check(controller.signal, generation);
        if (!this.canManage() || formSnapshotFingerprint(this.profile()) !== formSnapshotFingerprint(profile)) throw Error('AI_SCOPE_CHANGED');
        if (this.storage.getItem(this.storageKey) !== null) { this.update({ locked: true }); throw Error('AI_RESULT_UNKNOWN'); }
        marker = JSON.stringify(pending); this.update({ pending, locked: true }); this.storage.setItem(this.storageKey, marker);
        if (this.storage.getItem(this.storageKey) !== marker) throw Error('AI_RESULT_UNKNOWN');
        this.update({ pending, locked: true }); this.check(controller.signal, generation); attempted = true;
        result = await this.ports.platformReviewPrice(command, controller.signal);
      } else {
        if (!pending || !marker || formSnapshotFingerprint(JSON.parse(marker)) !== formSnapshotFingerprint(pending)) throw Error('AI_RESULT_UNKNOWN');
        result = await this.ports.platformPriceReviewReceipt({ operationKey: pending.operationKey, sceneCode: pending.sceneCode }, controller.signal);
      }
      this.check(controller.signal, generation);
      if (!pending) throw Error('AI_RESULT_UNKNOWN');
      const recorded = receipt(structuredClone(result), pending.operationKey, this.profileId);
      if (await digest(content(recorded)) !== pending.fingerprint) throw Error('AI_RESULT_UNKNOWN');
      this.check(controller.signal, generation);
      if (!this.storage || this.storage.getItem(this.storageKey) !== marker) throw Error('AI_RESULT_UNKNOWN');
      this.storage.removeItem(this.storageKey); if (this.storage.getItem(this.storageKey) !== null) throw Error('AI_RESULT_UNKNOWN');
      this.update({ pending: null, locked: false, result: recorded, feedback: 'recorded' }); return recorded;
    } catch (error) {
      if (this.active && generation === this.generation && !controller.signal.aborted) {
        const e = error as { message?: string; response?: { status?: number; data?: { code?: string } } };
        const denied = !this.current() || [401, 403].includes(e.response?.status ?? 0) || e.message === 'AI_ACCESS_DENIED' || e.message === 'AI_SCOPE_CHANGED';
        const known = attempted && ['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(e.response?.data?.code ?? '');
        let cleared = false;
        if (known) { try { if (this.storage && this.storage.getItem(this.storageKey) === marker) this.storage.removeItem(this.storageKey);
          cleared = this.storage?.getItem(this.storageKey) === null; } catch { /* keep lock */ } }
        this.update({ result: null, ...(known && cleared ? { locked: false, pending: null } : {}),
          feedback: denied ? 'denied' : this.state.locked && !known ? 'unknown' : e.response?.data?.code === 'AI_REVISION_CONFLICT'
            ? 'conflict' : e.message === 'AI_INVALID_INPUT' || e.response?.data?.code === 'AI_INVALID_INPUT' ? 'invalid' : 'unavailable' });
      }
      throw error;
    } finally { if (this.flight === controller) this.flight = null;
      if (this.active && generation === this.generation) this.update({ busy: false }); }
  }
}
