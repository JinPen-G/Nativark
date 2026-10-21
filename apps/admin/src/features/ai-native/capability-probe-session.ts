/** Human-operated consumer of the original persistent probe workflow, not a
 * second runner. A durable request locator survives uncertainty; start is never
 * retried. History is read-only, while receipt reconciliation can record evidence. */
import type { AiTextCapabilityPrepareRequestDraft, AiTextCapabilityHttpResponsesDraft } from '@rental-os/shared';
import type { CapabilityProbeAction, aiCapabilityProbeApi } from '@/api/aiCapabilityProbe';

type Capability = NonNullable<AiTextCapabilityPrepareRequestDraft['capability']>;
type Write = 'publish' | 'createTask' | 'start' | 'cancel' | 'reconcile' | 'readCapabilityReceipt' | 'configureTaskAction';
type PolicyWrite = { taskId: string; operation: string; expectedRevision: number | null };
type Journal = { requestKey: string; capability: Capability; started: boolean; uncertain: Write | null; policyWrite?: PolicyWrite };
type Task = { taskId: string; runId?: string; revision: number; status: string };
type Observation = { status: 'supported' | 'unsupported' | 'unverified'; capability: Capability; mode: 'mock' | 'live' | null;
  checkedAt: string | null; expiresAt: string | null; configurationRevision: number | null };
type State = Readonly<{ busy: boolean; journal: Journal | null; locked: boolean;
  prepared: { configurationRevision: number; methodVersion: string } | null; published: boolean; task: Task | null;
  policy: { operation: string; revision: number | null } | null; receipt: Observation | null;
  policyReceipt: { revision: number; expiresAt: string } | null;
  preflight: { allowed: boolean; missing: boolean; stale: boolean } | null;
  history: { state: 'historical' | 'not_observed'; originalValidity: string; taskStatus: string; resultObserved: boolean } | null;
  feedback: 'idle' | 'observed' | 'unknown' | 'denied' | 'invalid' | 'unavailable' }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const code = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v);
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4294967295;
const time = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));
export const PROBE_CAPABILITIES = ['text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'] as const;
const writes: readonly Write[] = ['publish', 'createTask', 'start', 'cancel', 'reconcile', 'readCapabilityReceipt', 'configureTaskAction'];
const invalid = (): never => { throw Error('AI_INVALID_INPUT'); };
const task = (v: unknown): Task => {
  if (!object(v) || !code(v.taskId) || !revision(v.revision) || !code(v.status, 64)
    || v.runId !== undefined && !code(v.runId)) return invalid();
  return { taskId: v.taskId, revision: v.revision, status: v.status, ...(typeof v.runId === 'string' ? { runId: v.runId } : {}) };
};
export class CapabilityProbeSession {
  private state: State; private active = true; private generation = 0; private flight: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly ports: Pick<typeof aiCapabilityProbeApi, 'call'>, private readonly current: () => boolean,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, private readonly storageKey: string,
    private readonly newKey = () => globalThis.crypto.randomUUID()) {
    let journal: Journal | null = null, locked = true;
    try { const raw = storage?.getItem(storageKey); locked = !storage || raw !== null;
      const v: unknown = raw && raw.length <= 1024 ? JSON.parse(raw) : null;
      if (object(v) && code(v.requestKey) && PROBE_CAPABILITIES.includes(v.capability as Capability) && typeof v.started === 'boolean'
        && (v.uncertain === null || writes.includes(v.uncertain as Write)) && (v.policyWrite === undefined || object(v.policyWrite)
          && code(v.policyWrite.taskId) && code(v.policyWrite.operation, 64) && (v.policyWrite.expectedRevision === null
            || revision(v.policyWrite.expectedRevision) && v.policyWrite.expectedRevision <= 4294967293))) {
        journal = { requestKey: v.requestKey, capability: v.capability as Capability, started: v.started, uncertain: v.uncertain as Write | null,
          ...(v.policyWrite === undefined ? {} : { policyWrite: v.policyWrite as PolicyWrite }) }; locked = false;
      }
    } catch { /* Corrupt/absent original reference storage cannot authorize a fresh request. */ }
    this.state = { busy: false, journal, locked, prepared: null, published: false, task: null, policy: null,
      receipt: null, policyReceipt: null, preflight: null, history: null, feedback: locked || journal?.uncertain ? 'unknown' : 'idle' };
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  activate() { this.active = true; this.update({ busy: false }); }
  dispose() { this.active = false; this.generation++; this.flight?.abort(); this.flight = null; }
  private update(v: Partial<State>) { this.state = Object.freeze({ ...this.state, ...v }); this.listeners.forEach(f => f()); }
  private check(c: AbortController, g: number) { if (!this.active || c.signal.aborted || !this.current() || g !== this.generation) throw Error('AI_SCOPE_CHANGED'); }
  private persist(v: Journal) {
    if (!this.storage) throw Error('AI_RESOURCE_UNAVAILABLE');
    const marker = JSON.stringify(v); this.storage.setItem(this.storageKey, marker);
    if (this.storage.getItem(this.storageKey) !== marker) throw Error('AI_RESULT_UNKNOWN');
    this.update({ journal: Object.freeze(v) });
  }
  /** One original request per mounted journal. Never clear/replace an unknown
   * challenge from this screen; further fresh probes require explicit lifecycle support. */
  prepare = (capability: Capability) => this.run('prepare', capability);
  act = (action: Exclude<CapabilityProbeAction, 'prepare'>, operation?: string) => this.run(action, undefined, operation);
  private async run(action: CapabilityProbeAction, capability?: Capability, operation?: string) {
    if (this.flight) throw Error('AI_BUSY');
    const c = new AbortController(), g = this.generation; this.flight = c;
    let attempted = false;
    try {
      this.check(c, g);
      this.update({ busy: true, receipt: null, policyReceipt: null, preflight: null, history: null });
      if (this.state.locked) throw Error('AI_RESOURCE_UNAVAILABLE');
      let journal = structuredClone(this.state.journal);
      if (!journal) {
        if (action !== 'prepare' || !PROBE_CAPABILITIES.includes(capability as Capability)) return invalid();
        const requestKey = this.newKey(); if (!code(requestKey)) return invalid();
        if (this.storage?.getItem(this.storageKey) !== null) throw Error('AI_RESULT_UNKNOWN');
        journal = { requestKey, capability: capability!, started: false, uncertain: null }; this.persist(journal);
      }
      if (JSON.stringify(journal) !== this.storage?.getItem(this.storageKey)) throw Error('AI_RESULT_UNKNOWN');
      if (action === 'prepare' && capability !== journal.capability) return invalid();
      const write = writes.includes(action as Write);
      if (write && journal.uncertain && !(action === 'reconcile' && ['start', 'reconcile'].includes(journal.uncertain))
        && !(action === 'readCapabilityReceipt' && journal.uncertain === 'readCapabilityReceipt')) throw Error('AI_RESULT_UNKNOWN');
      if (action === 'publish' && !this.state.prepared || action === 'createTask' && !this.state.published
        || action === 'start' && (!this.state.task || journal.started) || action === 'cancel' && !this.state.task) return invalid();
      if (['readTaskAction', 'configureTaskAction'].includes(action) && (!code(operation, 64) || !this.state.task)) return invalid();
      if (action === 'configureTaskAction' && this.state.policy?.operation !== operation) return invalid();
      if (action === 'readTaskActionReceipt' && !journal.policyWrite) return invalid();
      const value = { requestKey: journal.requestKey,
        ...(['prepare', 'publish'].includes(action) ? { capability: journal.capability } : {}),
        ...(action === 'cancel' ? { expectedRevision: this.state.task!.revision } : {}),
        ...(['readTaskAction', 'configureTaskAction'].includes(action) ? { operation: operation! } : {}),
        ...(action === 'configureTaskAction' ? { expectedRevision: this.state.policy!.revision } : {}),
        ...(action === 'readTaskActionReceipt' ? { operation: journal.policyWrite!.operation, expectedRevision: journal.policyWrite!.expectedRevision } : {}) };
      if (action === 'configureTaskAction') journal = { ...journal, policyWrite: { taskId: this.state.task!.taskId,
        operation: operation!, expectedRevision: this.state.policy!.revision } };
      if (write) { journal = { ...journal, uncertain: action as Write, started: journal.started || action === 'start' || action === 'reconcile' }; this.persist(journal); }
      this.check(c, g); attempted = write;
      const raw: unknown = structuredClone(await this.ports.call(action, value, c.signal)); this.check(c, g);
      if (JSON.stringify(journal) !== this.storage?.getItem(this.storageKey)) throw Error('AI_RESULT_UNKNOWN');
      if (!object(raw) || raw.requestKey !== journal.requestKey || JSON.stringify(raw).length > 32768) throw Error('AI_RESULT_UNKNOWN');
      let cleared = false;
      if (action === 'prepare') {
        if (raw.state !== 'prepared' || raw.capability !== journal.capability || raw.execution !== 'not_started'
          || !revision(raw.configurationRevision) || !code(raw.methodVersion, 64)) return invalid();
        this.update({ prepared: { configurationRevision: raw.configurationRevision, methodVersion: raw.methodVersion } });
      } else if (action === 'publish' || action === 'readOriginal') {
        if (raw.state === 'stored' && code(raw.inputRef) && typeof raw.inputHash === 'string' && /^[a-f0-9]{64}$/u.test(raw.inputHash)
          && raw.retryable === false) { this.update({ published: true }); cleared = journal.uncertain === 'publish'; }
        else if (action !== 'readOriginal' || raw.state !== 'not_observed' || raw.retryable !== false) return invalid();
      } else if (action === 'createTask' || action === 'readTask') {
        if (action === 'createTask' || raw.state === 'observed') {
          const selected = task(action === 'createTask' ? raw : raw.task); if (this.state.task && selected.taskId !== this.state.task.taskId) return invalid();
          this.update({ task: selected }); cleared = journal.uncertain === 'createTask';
        } else if (!['unknown', 'not_observed'].includes(String(raw.state)) || raw.task !== null) return invalid();
      } else if (action === 'inspect') {
        if (raw.semantics !== 'task_outcome_not_capability_evidence') return invalid();
        const selected = task(raw.task); if (this.state.task && selected.taskId !== this.state.task.taskId) return invalid();
        this.update({ task: selected });
      } else if (action === 'readTaskAction' || action === 'configureTaskAction') {
        if (raw.semantics !== 'action_policy_not_dispatch_or_business_approval' || raw.retryable !== false) return invalid();
        if (raw.policy === null && raw.state === 'not_observed') this.update({ policy: { operation: operation!, revision: null } });
        else if (['observed', 'configured'].includes(String(raw.state)) && object(raw.policy) && raw.policy.operation === operation
          && raw.policy.taskId === this.state.task?.taskId && revision(raw.policy.revision)) this.update({ policy: { operation: operation!, revision: raw.policy.revision } });
        else return invalid();
      } else if (action === 'readTaskActionReceipt') {
        const original = journal.policyWrite!;
        if (raw.semantics !== 'original_action_policy_save_not_current_permission' || raw.retryable !== false
          || raw.operation !== original.operation || raw.expectedRevision !== original.expectedRevision) return invalid();
        if (raw.state === 'recorded' && object(raw.policy) && raw.policy.taskId === original.taskId
          && raw.policy.operation === original.operation && raw.policy.revision === (original.expectedRevision ?? 0) + 1 && time(raw.policy.expiresAt)) {
          this.update({ policy: null, policyReceipt: { revision: raw.policy.revision as number, expiresAt: raw.policy.expiresAt } });
          cleared = journal.uncertain === 'configureTaskAction';
        } else if (raw.state !== 'not_observed' || raw.policy !== null) return invalid();
      } else if (action === 'readCapabilityReceipt') {
        if (raw.semantics !== 'original_receipt_not_task_outcome' || raw.capability !== journal.capability
          || !['supported', 'unsupported', 'unverified'].includes(String(raw.status)) || raw.retryable !== false) return invalid();
        const o = raw.observation;
        if (o !== null && (!object(o) || !['mock', 'live'].includes(String(o.mode)) || !time(o.checkedAt) || !time(o.expiresAt)
          || !revision(o.configurationRevision) || !code(o.methodVersion, 64))) return invalid();
        if (raw.status === 'supported' && (!object(o) || o.mode !== 'live')) return invalid();
        this.update({ receipt: { capability: journal.capability, status: raw.status as Observation['status'],
          mode: object(o) ? o.mode as 'mock' | 'live' : null, checkedAt: object(o) ? o.checkedAt as string : null,
          expiresAt: object(o) ? o.expiresAt as string : null, configurationRevision: object(o) ? o.configurationRevision as number : null } });
      } else if (action === 'preflight') {
        if (raw.semantics !== 'current_preflight_not_dispatch_permission' || raw.capability !== journal.capability
          || typeof raw.allowed !== 'boolean' || typeof raw.missing !== 'boolean' || typeof raw.stale !== 'boolean') return invalid();
        this.update({ preflight: { allowed: raw.allowed, missing: raw.missing, stale: raw.stale } });
      } else if (action === 'readHistory') {
        if (!['historical', 'not_observed'].includes(String(raw.state)) || raw.applicability !== 'historical_only'
          || raw.currentCapability !== 'not_assessed' || typeof raw.resultObserved !== 'boolean' || raw.retryable !== false) return invalid();
        if (raw.task !== null) task(raw.task);
        this.update({ history: { state: raw.state as 'historical' | 'not_observed', originalValidity: object(raw.original)
          && ['expired', 'historical_only'].includes(String(raw.original.validity)) ? String(raw.original.validity) : 'not_observed',
          taskStatus: object(raw.task) ? String(raw.task.status) : 'not_observed', resultObserved: raw.resultObserved } });
      } else if (action === 'cancel') {
        if (raw.status !== 'cancel_requested' || !revision(raw.revision) || raw.retryable !== false) return invalid();
        this.update({ task: { ...this.state.task!, revision: raw.revision, status: 'cancel_requested' } });
      } else if (raw.semantics !== 'task_outcome_not_capability_evidence' || raw.retryable !== false
        || (raw.kind !== 'not_started' && (raw.kind !== 'run_outcome' || !object(raw.outcome) || !code(raw.outcome.status, 64)))) return invalid();
      if (write || cleared) this.persist({ ...journal, uncertain: null });
      this.update({ feedback: this.state.journal?.uncertain ? 'unknown' : 'observed' });
      return raw as AiTextCapabilityHttpResponsesDraft[CapabilityProbeAction];
    } catch (error) {
      if (this.active && !c.signal.aborted && g === this.generation) {
        const e = error as { message?: string; response?: { status?: number; data?: { code?: string } } };
        const denied = !this.current() || [401, 403].includes(e.response?.status ?? 0) || e.message === 'AI_SCOPE_CHANGED';
        this.update({ prepared: null, published: false, task: null, policy: null, receipt: null, policyReceipt: null, preflight: null, history: null,
          feedback: denied ? 'denied' : attempted || this.state.journal?.uncertain ? 'unknown'
            : e.message === 'AI_INVALID_INPUT' || e.response?.data?.code === 'AI_INVALID_INPUT' ? 'invalid' : 'unavailable' });
      }
      throw error;
    } finally { if (this.flight === c) this.flight = null; if (this.active && g === this.generation) this.update({ busy: false }); }
  }
}
