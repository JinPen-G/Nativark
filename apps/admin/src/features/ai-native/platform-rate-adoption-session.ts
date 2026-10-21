/** One current-workspace adoption of an immutable platform rate. Unknown
 * observes its original reference only, never a new version or model call. */
import type { AiGatewayPlatformPriceAdoptionReadDraft, AiGatewayPlatformPriceAdoptionDraft,
  AiGatewayPlatformPricePreviewDraft } from '@rental-os/shared';
import { reviewedPriceBilling } from './platform-price-review-session';
import { formSnapshotFingerprint } from '../../app/serverFormSnapshot';

const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const code = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v);
const time = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const invalid = (): never => { throw Error('AI_INVALID_INPUT'); };
type RateFacts = Omit<AiGatewayPlatformPricePreviewDraft, 'state' | 'persisted'>;
function selector(v: AiGatewayPlatformPriceAdoptionReadDraft) {
  if (!code(v.sceneCode) || !hash(v.priceId)) return invalid();
  return { sceneCode: v.sceneCode, priceId: v.priceId };
}
function price(v: unknown, selected: AiGatewayPlatformPriceAdoptionReadDraft, historical: boolean) {
  if (!row(v) || !hash(v.evidenceHash) || !code(v.priceVersion, 64) || !time(v.validFrom) || !time(v.expiresAt)
    || Date.parse(v.validFrom) >= Date.parse(v.expiresAt) || v.executionPermission !== false
    || v.inputCounting !== 'not_certified_by_rate_review' || v.rateAuthority !== 'platform_reviewed_budget_rate_not_provider_invoice') return invalid();
  if (historical ? v.state !== 'recorded' || v.operationKey !== `platform-rate:${selected.priceId}` || !hash(v.id)
    : v.state !== 'available_for_review' || v.sceneCode !== selected.sceneCode || v.priceId !== selected.priceId || v.persisted !== false) return invalid();
  // Historical transport has internal configuration references. They are not
  // needed here: return only the existing safe offer fields, never spread JSON.
  return { ...selected, evidenceHash: v.evidenceHash, priceVersion: v.priceVersion,
    validFrom: v.validFrom, expiresAt: v.expiresAt, billing: reviewedPriceBilling(v.billing),
    rateAuthority: 'platform_reviewed_budget_rate_not_provider_invoice' as const,
    inputCounting: 'not_certified_by_rate_review' as const, executionPermission: false as const };
}
type Pending = AiGatewayPlatformPriceAdoptionReadDraft & { evidenceHash: string };
type Ports = { previewPlatformPrice(v: AiGatewayPlatformPriceAdoptionReadDraft, s: AbortSignal): Promise<unknown>;
  adoptPlatformPrice(v: AiGatewayPlatformPriceAdoptionDraft, s: AbortSignal): Promise<unknown>;
  readPlatformPriceAdoption(v: AiGatewayPlatformPriceAdoptionReadDraft, s: AbortSignal): Promise<unknown> };
type State = Readonly<{ busy: boolean; locked: boolean; pending: Pending | null;
  preview: RateFacts | null; recorded: RateFacts | null;
  feedback: 'idle' | 'preview' | 'recorded' | 'unknown' | 'denied' | 'unavailable' | 'invalid' }>;
export class PlatformRateAdoptionSession {
  private active = true; private generation = 0; private flight: AbortController | null = null;
  private listeners = new Set<() => void>(); private state: State;
  constructor(private readonly ports: Ports, private readonly current: () => boolean,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, private readonly storageKey: string) {
    let locked = true, pending: Pending | null = null;
    try { const raw = storage?.getItem(storageKey); locked = !storage || raw !== null;
      const v: unknown = raw && JSON.parse(raw);
      if (row(v) && code(v.sceneCode) && hash(v.priceId) && hash(v.evidenceHash) && Object.keys(v).length === 3)
        pending = Object.freeze({ sceneCode: v.sceneCode, priceId: v.priceId, evidenceHash: v.evidenceHash });
    } catch { /* Corrupt/absent storage must not forget an original unknown. */ }
    this.state = { busy: false, locked, pending, preview: null, recorded: null, feedback: locked ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  activate() { if (!this.active) { this.active = true; this.update({ busy: false }); } }
  dispose() { this.active = false; this.generation++; this.flight?.abort(); this.flight = null; }
  private update(p: Partial<State>) { this.state = Object.freeze({ ...this.state, ...p }); this.listeners.forEach(f => f()); }
  private check(s: AbortSignal, generation: number) { if (!this.active || !this.current() || s.aborted || generation !== this.generation) throw Error('AI_SCOPE_CHANGED'); }
  clearPreview() { if (!this.flight) this.update({ preview: null, recorded: null }); }
  preview = (v: AiGatewayPlatformPriceAdoptionReadDraft) => this.run('preview', structuredClone(v));
  adopt = () => this.run('adopt');
  reconcile = () => this.run('receipt');
  private async run(action: 'preview' | 'adopt' | 'receipt', value?: AiGatewayPlatformPriceAdoptionReadDraft) {
    if (this.flight) throw Error('AI_BUSY');
    const controller = new AbortController(), generation = this.generation;
    this.check(controller.signal, generation); this.flight = controller;
    const offered = structuredClone(this.state.preview);
    this.update({ busy: true, recorded: null, ...(action === 'preview' ? { preview: null } : {}) });
    try {
      if (action === 'preview') {
        const selected = selector(value!);
        const result = price(structuredClone(await this.ports.previewPlatformPrice(selected, controller.signal)), selected, false);
        this.check(controller.signal, generation); this.update({ preview: result, feedback: 'preview' }); return result;
      }
      let pending = this.state.pending, marker = this.storage?.getItem(this.storageKey);
      if (action === 'adopt') {
        if (!offered || !this.storage || this.state.locked || marker !== null) throw Error('AI_RESULT_UNKNOWN');
        pending = Object.freeze({ sceneCode: offered.sceneCode, priceId: offered.priceId, evidenceHash: offered.evidenceHash });
        marker = JSON.stringify(pending); this.update({ locked: true, pending, preview: null });
        this.storage.setItem(this.storageKey, marker);
        if (this.storage.getItem(this.storageKey) !== marker) throw Error('AI_RESULT_UNKNOWN');
      }
      if (!pending || !marker || formSnapshotFingerprint(JSON.parse(marker)) !== formSnapshotFingerprint(pending)) throw Error('AI_RESULT_UNKNOWN');
      const selected = selector(pending); this.check(controller.signal, generation);
      const raw = await (action === 'adopt' ? this.ports.adoptPlatformPrice({ ...selected, confirmPlatformRate: true }, controller.signal)
        : this.ports.readPlatformPriceAdoption(selected, controller.signal));
      this.check(controller.signal, generation);
      const result = price(structuredClone(raw), selected, true);
      if (result.evidenceHash !== pending.evidenceHash || action === 'adopt' && offered
        && formSnapshotFingerprint(result) !== formSnapshotFingerprint(offered)) throw Error('AI_RESULT_UNKNOWN');
      if (!this.storage || this.storage.getItem(this.storageKey) !== marker) throw Error('AI_RESULT_UNKNOWN');
      this.storage.removeItem(this.storageKey); if (this.storage.getItem(this.storageKey) !== null) throw Error('AI_RESULT_UNKNOWN');
      this.update({ locked: false, pending: null, preview: null, recorded: result, feedback: 'recorded' }); return result;
    } catch (error) {
      if (this.active && generation === this.generation && !controller.signal.aborted) {
        const e = error as { message?: string; response?: { status?: number } };
        const denied = !this.current() || e.message === 'AI_SCOPE_CHANGED' || [401, 403].includes(e.response?.status ?? 0);
        // Any attempted adoption remains observation-only, including failures.
        // The API never proves a missing receipt is evidence of no write.
        this.update({ preview: null, recorded: null, feedback: denied ? 'denied' : this.state.locked ? 'unknown'
          : e.message === 'AI_INVALID_INPUT' ? 'invalid' : 'unavailable' });
      }
      throw error;
    } finally { if (this.flight === controller) this.flight = null;
      if (this.active && generation === this.generation) this.update({ busy: false }); }
  }
}
