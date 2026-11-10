/** One live host window, not a telemetry store or business authority. Only an
 * explicit original action arms it; reopening never restores timing state. */
import type { AiTaskClientVisibleReportDraft, AiTaskClientVisibleSourceDraft } from '@rental-os/shared';

export interface VisibleOrigin {
  taskId: string; runId?: string; trigger: 'original_model_start' | 'original_input_resume'; originKey: string;
  conversationId?: string; turnId?: string;
}
export interface VisibleSourceReference { taskId: string; runId: string; source: AiTaskClientVisibleSourceDraft }
export interface VisibleObservationDriver {
  available(): boolean; current(): boolean; epoch(): number; now(): number; uuid(): string;
  viewport(): 'compact_viewport' | 'wide_viewport';
  report(value: AiTaskClientVisibleReportDraft): Promise<void>;
}
const id = (value: unknown, max = 36): value is string => typeof value === 'string'
  && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const sourceKey = (value: VisibleSourceReference) => JSON.stringify([value.taskId, value.runId, value.source]);

export class LiveVisibleObservationSession {
  private generation = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly seen = new Set<string>();
  private window: { key: string; origin: VisibleOrigin; epoch: number; started: number; documentId: string;
    generation: number; baseline: Set<string>; attempted: Set<'text' | 'card'> } | null = null;
  constructor(private readonly surface: AiTaskClientVisibleReportDraft['surface'], private readonly driver: VisibleObservationDriver,
    private readonly expected: { taskId?: string; conversationId?: string } = {}) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.revision;
  private notify() { this.revision++; this.listeners.forEach(fn => fn()); }
  invalidate = () => { this.generation++; this.window = null; this.notify(); };
  dispose = () => { this.invalidate(); this.seen.clear(); this.listeners.clear(); };

  /** Measurement failure cannot prevent the original authorized action. */
  begin(originValue: VisibleOrigin): string | null {
    this.invalidate();
    try {
      const origin = structuredClone(originValue), started = this.driver.now(), epoch = this.driver.epoch();
      if (!this.driver.available() || !this.driver.current() || !Number.isFinite(started)
        || !Number.isSafeInteger(epoch) || epoch < 0 || !id(origin.taskId) || origin.runId !== undefined && !id(origin.runId)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(origin.originKey)
        || !['original_model_start', 'original_input_resume'].includes(origin.trigger)
        || this.expected.taskId !== undefined && origin.taskId !== this.expected.taskId
        || this.expected.conversationId !== undefined && origin.conversationId !== this.expected.conversationId
        || origin.conversationId !== undefined && !id(origin.conversationId, 191)
        || origin.turnId !== undefined && !id(origin.turnId, 191)) return null;
      const key = this.driver.uuid(), documentId = this.driver.uuid();
      if (!/^[0-9a-f-]{36}$/iu.test(key) || !/^[0-9a-f-]{36}$/iu.test(documentId)) return null;
      this.window = { key, origin, epoch, started, documentId, generation: this.generation,
        baseline: new Set(this.seen), attempted: new Set() };
      this.notify(); return key;
    } catch { return null; }
  }
  private active() {
    const window = this.window;
    try {
      const elapsed = window ? this.driver.now() - window.started : NaN;
      if (!window || window.generation !== this.generation || !this.driver.current() || !this.driver.available()
        || this.driver.epoch() !== window.epoch || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 600000) return null;
      return window;
    } catch { return null; }
  }
  bindRun(key: string | null, runId: string) {
    const window = this.active();
    if (!window || key !== window.key || !id(runId)) return false;
    if (window.origin.runId !== undefined && window.origin.runId !== runId) { this.invalidate(); return false; }
    window.origin.runId = runId; this.notify(); return true;
  }
  cancel(key: string | null) { if (key && this.window?.key === key) this.invalidate(); }
  cancelTask(taskId: string) { if (this.window?.origin.taskId === taskId) this.invalidate(); }

  /** Called only after the real boundary has checked viewport/paint/current
   * state. Historical visible sources are remembered without arming a sample. */
  visible(value: VisibleSourceReference, kind: 'text' | 'card'): boolean {
    try {
      const reference = structuredClone(value), key = sourceKey(reference), window = this.active();
      if (!id(reference.taskId) || !id(reference.runId)
        || (kind === 'text' ? reference.source.kind !== 'model_result' || !id(reference.source.resultId)
          : reference.source.kind !== 'approval_card' || !id(reference.source.stepId) || !id(reference.source.proposalId)
            || !Number.isSafeInteger(reference.source.proposalRevision) || reference.source.proposalRevision < 1)) return false;
      if (this.seen.size >= 50 && !this.seen.has(key)) return false;
      this.seen.add(key);
      if (!window || !window.origin.runId || window.origin.taskId !== reference.taskId
        || window.origin.runId !== reference.runId || window.baseline.has(key) || window.attempted.has(kind)) return false;
      const elapsedMs = Math.floor(this.driver.now() - window.started);
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 600000 || this.active() !== window) return false;
      const report: AiTaskClientVisibleReportDraft = { version: 'client-visible-1', observationId: this.driver.uuid(),
        documentId: window.documentId, taskId: reference.taskId, runId: reference.runId, kind,
        source: reference.source, surface: this.surface, trigger: window.origin.trigger, originKey: window.origin.originKey,
        ...(window.origin.conversationId ? { conversationId: window.origin.conversationId } : {}),
        ...(window.origin.turnId ? { turnId: window.origin.turnId } : {}), clientEpoch: window.epoch, elapsedMs,
        viewport: this.driver.viewport(), sampleSize: 1, basis: 'viewport_intersection_after_two_frames',
        provenance: 'client_reported_not_business_fact' };
      // Mark before any asynchronous delivery. A missing acknowledgement does
      // not authorize re-sending, a new measurement ID or any business action.
      window.attempted.add(kind); this.notify();
      void Promise.resolve().then(() => {
        if (this.active() !== window) return;
        return this.driver.report(structuredClone(report));
      }).catch(() => { /* observational delivery stays unknown; never retry */ });
      return true;
    } catch { return false; }
  }
}
