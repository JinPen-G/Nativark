/** Explicit recovery of an observed original Task/Run. The locator is a
 * required server dependency; local journals never supply execution authority.
 * An uncertain command keeps its original generation and permits reads only. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_ORDER_READ_HTTP_SCHEMAS,
  validateAiTaskCenterRecoveryValue, type AiTaskRecoveryHostDraft,
  type AiSceneRequestReadDraft, type AiSceneModelTakeoverReceiptReadDraft,
  type AiTaskRecoverySnapshot, type AiSceneModelExecutionDraft, type AiOrderReadTakeoverReceiptDraft } from '@rental-os/shared';

export type TaskRecoveryAction = 'recover' | 'takeover';
export type TaskRecoveryHost = AiTaskRecoveryHostDraft;
/** Feature-local adapter result, not a new wire DTO. The parent supplies this
 * after validating the public source/lineage/host locator. Actions are display
 * hints; the original server host still checks current permissions and CAS. */
export interface TaskRecoveryTarget {
  original: AiSceneRequestReadDraft;
  host: TaskRecoveryHost;
  snapshot: AiTaskRecoverySnapshot;
  actions: readonly TaskRecoveryAction[];
}
export type TaskRecoveryLocator = (taskId: string, signal: AbortSignal) => Promise<TaskRecoveryTarget>;
export interface TaskRecoveryOperation extends AiSceneModelTakeoverReceiptReadDraft {
  taskId: string;
  planHash: string;
  action: TaskRecoveryAction;
}
export interface TaskRecoveryPort {
  snapshot(original: AiSceneRequestReadDraft, taskId: string, runId: string, signal: AbortSignal): Promise<AiTaskRecoverySnapshot>;
  execute(action: TaskRecoveryAction, target: TaskRecoveryTarget, signal: AbortSignal): Promise<AiSceneModelExecutionDraft>;
  takeoverReceipt(original: TaskRecoveryOperation, signal: AbortSignal): Promise<AiOrderReadTakeoverReceiptDraft>;
}
export interface TaskRecoveryStore {
  read(): string | null;
  write(value: string): void;
  exclusive<T>(work: () => T | Promise<T>): Promise<T>;
}
export interface TaskRecoveryState {
  busy: 'inspect' | TaskRecoveryAction | 'read' | null;
  review: TaskRecoveryTarget | null;
  original: TaskRecoveryOperation | null;
  observation: AiTaskRecoverySnapshot | null;
  outcome: AiSceneModelExecutionDraft | null;
  takeoverReceipt: AiOrderReadTakeoverReceiptDraft | null;
  resolved: boolean;
  invalid: boolean;
  error: 'source_unavailable' | 'operation_unknown' | 'journal_unavailable' | 'access_denied' | null;
}
const VERSION = 'original-task-recovery-ui-1';
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const definitions = JSON.parse(JSON.stringify({ ...AI_TASK_RECOVERY_HTTP_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft,
  AiSceneRequestReceiptDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft,
}).replaceAll('#/components/schemas/', '#/$defs/'));
const validators = Object.fromEntries(['AiSceneRequestReadDraft', 'AiSceneModelExecutionDraft', 'AiTaskRecoverySnapshot']
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));
const receiptSchema = AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadTakeoverReceiptResponseDraft.properties!.receipt;
const receiptValidator = ajv.compile(receiptSchema);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const copy = (value: unknown, limit: number) => {
  const result: unknown = structuredClone(value);
  if (new TextEncoder().encode(JSON.stringify(result)).length > limit) throw Error('AI_RESOURCE_UNAVAILABLE');
  return result;
};
export function sameTaskRecovery(value: unknown, other: unknown): boolean {
  if (value === other) return true;
  if (!value || !other || typeof value !== 'object' || typeof other !== 'object') return false;
  if (Array.isArray(value) || Array.isArray(other)) return Array.isArray(value) && Array.isArray(other)
    && value.length === other.length && value.every((item, index) => sameTaskRecovery(item, other[index]));
  const left = value as Record<string, unknown>, right = other as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && sameTaskRecovery(left[key], right[key]));
}
export function parseTaskRecoveryOriginal(value: unknown): AiSceneRequestReadDraft {
  const result = copy(value, 1024);
  if (!validators.AiSceneRequestReadDraft(result)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return result as AiSceneRequestReadDraft;
}
export function parseTaskRecoverySnapshot(value: unknown, taskId: string, runId?: string): AiTaskRecoverySnapshot {
  const result = copy(value, 524288);
  if (!validators.AiTaskRecoverySnapshot(result)) throw Error('AI_RESOURCE_UNAVAILABLE');
  const snapshot = result as AiTaskRecoverySnapshot;
  if (snapshot.task.taskId !== taskId || runId !== undefined && snapshot.run.runId !== runId) throw Error('AI_SCOPE_CHANGED');
  const seen = new Set<string>();
  let previous = -1, artifacts = 0, charges = 0;
  const uint64 = (quantity: string) => BigInt(quantity) <= 18446744073709551615n;
  if (!uint64(snapshot.task.eventCursor)) throw Error('AI_RESOURCE_UNAVAILABLE');
  for (const step of snapshot.steps) {
    if (seen.has(step.stepId) || step.sequence <= previous) throw Error('AI_RESOURCE_UNAVAILABLE');
    seen.add(step.stepId); previous = step.sequence;
    artifacts += step.artifacts.length; charges += step.charges.length;
    if (new Set(step.artifacts.map(row => row.resultRef)).size !== step.artifacts.length
      || new Set(step.charges.map(row => row.chargeId)).size !== step.charges.length
      || step.artifacts.some(row => !uint64(row.outputBytes) || !uint64(row.activeMs))
      || step.charges.some(row => !uint64(row.amount) || row.actualAmount !== null && !uint64(row.actualAmount)
        || row.status === 'recorded' && (row.actualAmount === null || row.evidenceRef === null))) throw Error('AI_RESOURCE_UNAVAILABLE');
  }
  if (artifacts > 2000 || charges > 5000 || snapshot.resources && Object.values(snapshot.resources.counters)
    .some(row => !uint64(row.limit) || !uint64(row.reserved) || !uint64(row.consumed))) throw Error('AI_RESOURCE_UNAVAILABLE');
  return snapshot;
}
export function parseTaskRecoveryOutcome(value: unknown): AiSceneModelExecutionDraft {
  const result = copy(value, 4096);
  if (!validators.AiSceneModelExecutionDraft(result)) throw Error('AI_RESULT_UNKNOWN');
  return result as AiSceneModelExecutionDraft;
}
export function parseTaskTakeoverReceipt(value: unknown, original: TaskRecoveryOperation): AiOrderReadTakeoverReceiptDraft {
  const result = copy(value, 4096);
  if (!receiptValidator(result)) throw Error('AI_RESOURCE_UNAVAILABLE');
  const receipt = result as AiOrderReadTakeoverReceiptDraft;
  if (receipt.taskId !== original.taskId || receipt.runId !== original.runId) throw Error('AI_SCOPE_CHANGED');
  if (receipt.status === 'observed' && (receipt.recordedRunRevision !== original.expectedRunRevision + 1
    || receipt.recordedFencingToken !== (BigInt(original.expectedFencingToken) + 1n).toString())) throw Error('AI_REVISION_CONFLICT');
  return receipt;
}
export function parseTaskRecoveryOperation(value: unknown, taskId: string): TaskRecoveryOperation {
  const result = copy(value, 4096);
  if (!closed(result, ['taskId', 'runId', 'planHash', 'action', 'original', 'expectedTaskRevision', 'expectedRunRevision', 'expectedFencingToken'])
    || result.taskId !== taskId || !id(result.taskId) || !id(result.runId)
    || !['recover', 'takeover'].includes(result.action as string)) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  const { original, action: _action, ...reference } = result;
  parseTaskRecoveryOriginal(original);
  if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryCommandDraft', reference)
    || BigInt(reference.expectedFencingToken as string) >= 99999999999999999999n)
    throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  return result as unknown as TaskRecoveryOperation;
}
function target(value: TaskRecoveryTarget, taskId: string): TaskRecoveryTarget {
  if (!closed(value, ['original', 'host', 'snapshot', 'actions']) || !['order_read', 'opening_model', 'quote_model', 'opening_read', 'selected_quote_order'].includes(value.host as string)
    || !Array.isArray(value.actions) || value.actions.length > 2 || new Set(value.actions).size !== value.actions.length
    || value.actions.some(action => !['recover', 'takeover'].includes(action))
    || value.host === 'opening_read' && value.actions.length !== 0) throw Error('AI_RESOURCE_UNAVAILABLE');
  return { original: parseTaskRecoveryOriginal(value.original), host: value.host as TaskRecoveryHost,
    snapshot: parseTaskRecoverySnapshot(value.snapshot, taskId), actions: [...value.actions] as TaskRecoveryAction[] };
}
const initial = (): TaskRecoveryState => ({ busy: null, review: null, original: null, observation: null, outcome: null,
  takeoverReceipt: null, resolved: false, invalid: false, error: null });
function journal(raw: string, taskId: string): TaskRecoveryOperation {
  if (raw.length > 4096) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  const value: unknown = JSON.parse(raw);
  if (!closed(value, ['version', 'operation']) || value.version !== VERSION) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  return parseTaskRecoveryOperation(value.operation, taskId);
}
function terminalObservation(snapshot: AiTaskRecoverySnapshot): boolean {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED', 'succeeded', 'failed', 'cancelled'].includes(snapshot.run.status)
    && snapshot.steps.every(step => !['running', 'unknown'].includes(step.status) && step.effect !== 'possible'
      && step.charges.every(charge => charge.status === 'recorded'));
}
export function taskRecoveryStorageKey(owner: { tenantId: string; workspaceId: string; userId: string; taskId: string }) {
  return `ai-original-task-recovery:${encodeURIComponent(JSON.stringify([owner.tenantId, owner.workspaceId, owner.userId, owner.taskId]))}`;
}

export class TaskRecoverySession {
  private active = false;
  private generation = 0;
  private request: AbortController | null = null;
  private held: string | null = null;
  private state = initial();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly input: { taskId: string; locate: TaskRecoveryLocator | null; port: TaskRecoveryPort;
    store: TaskRecoveryStore; current(): boolean; onAccessDenied?(): void }) {
    if (!id(input.taskId)) throw Error('AI_INVALID_INPUT');
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<TaskRecoveryState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private check(signal?: AbortSignal, generation = this.generation) {
    if (!this.active || generation !== this.generation || signal?.aborted || !this.input.current()) throw Error('AI_SCOPE_CHANGED');
  }
  private restore() {
    const pending = this.state.original && !this.state.resolved ? this.state.original : null;
    try {
      const raw = this.input.store.read(), original = raw === null ? null : journal(raw, this.input.taskId);
      if (pending && !sameTaskRecovery(original, pending)) {
        this.publish({ invalid: true, review: null, error: 'journal_unavailable' }); return pending;
      }
      const changed = raw !== this.held; this.held = raw;
      this.publish({ original, invalid: false, ...(changed ? { review: null, observation: null, outcome: null,
        takeoverReceipt: null, resolved: false, error: null } : {}) });
      return original;
    } catch (error) {
      this.publish({ invalid: true, review: null, error: 'journal_unavailable' });
      if (pending) return pending; throw error;
    }
  }
  private unchanged() {
    let unchanged = false;
    try { unchanged = this.input.store.read() === this.held; } catch { /* A failed storage read never permits dispatch. */ }
    if (!unchanged) { this.publish({ invalid: true, review: null, error: 'journal_unavailable' }); throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }
  }
  activate() { this.active = true; try { this.restore(); } catch { /* The invalid journal is shown and blocks writes. */ } }
  suspend() { this.generation++; this.request?.abort(); this.request = null;
    this.publish({ busy: null, review: null, observation: null, outcome: null, takeoverReceipt: null, error: null }); }
  dispose() { this.active = false; this.suspend(); }
  private async perform(kind: NonNullable<TaskRecoveryState['busy']>, work: (signal: AbortSignal) => Promise<void>) {
    this.check(); if (this.request) throw Error('AI_OPERATION_IN_PROGRESS');
    const request = new AbortController(), generation = this.generation; this.request = request; this.publish({ busy: kind, error: null });
    try { await work(request.signal); this.check(request.signal, generation); }
    catch (error) {
      if (this.active && generation === this.generation && this.input.current()) {
        const failure = error as { response?: { status?: number; data?: { code?: string } }; message?: string };
        const denied = [401, 403].includes(failure.response?.status ?? 0) || ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(failure.message ?? '');
        this.publish({ review: null, ...(denied ? { observation: null, outcome: null, takeoverReceipt: null } : {}),
          error: denied ? 'access_denied' : this.state.invalid ? 'journal_unavailable'
            : this.state.original && !this.state.resolved ? 'operation_unknown' : 'source_unavailable' });
        if (denied) this.input.onAccessDenied?.();
      }
      throw error;
    } finally { if (this.request === request) { this.request = null; this.publish({ busy: null }); } }
  }
  async inspect() {
    return this.perform('inspect', async signal => {
      this.restore();
      if (this.state.invalid || this.state.original && !this.state.resolved) throw Error('AI_RESULT_UNKNOWN');
      if (!this.input.locate) throw Error('AI_RESOURCE_UNAVAILABLE');
      this.publish({ review: null, observation: null, outcome: this.state.resolved && this.state.outcome?.kind === 'not_started'
        ? this.state.outcome : null, takeoverReceipt: null });
      const review = target(await this.input.locate(this.input.taskId, signal), this.input.taskId); this.check(signal); this.restore();
      if (this.state.invalid || this.state.original && !this.state.resolved) throw Error('AI_RESULT_UNKNOWN');
      this.publish({ review, observation: review.snapshot });
    });
  }
  async execute(action: TaskRecoveryAction) {
    return this.perform(action, async signal => {
      const review = this.state.review; this.restore();
      if (!review || !this.input.locate || this.state.invalid || this.state.original && !this.state.resolved
        || !review.actions.includes(action)) throw Error('AI_RESOURCE_UNAVAILABLE');
      const fresh = target(await this.input.locate(this.input.taskId, signal), this.input.taskId); this.check(signal);
      if (!sameTaskRecovery(review, fresh) || !fresh.actions.includes(action) || !fresh.snapshot.plan)
        throw Error('AI_REVISION_CONFLICT');
      const operation = parseTaskRecoveryOperation({ taskId: this.input.taskId, runId: fresh.snapshot.run.runId,
        planHash: fresh.snapshot.plan.planHash, original: fresh.original, action, expectedTaskRevision: fresh.snapshot.task.revision,
        expectedRunRevision: fresh.snapshot.run.revision, expectedFencingToken: fresh.snapshot.run.fencingToken }, this.input.taskId);
      await this.input.store.exclusive(() => {
        this.check(signal); this.restore();
        const sameOriginal = this.state.original && sameTaskRecovery(this.state.original, operation);
        const knownUnstarted = sameOriginal && this.state.resolved && this.state.outcome?.kind === 'not_started';
        if (this.state.invalid || this.state.original && (!this.state.resolved || sameOriginal && !knownUnstarted))
          throw Error('AI_RESULT_UNKNOWN');
        this.unchanged();
        if (knownUnstarted) {
          // A trusted not-started reply can be reviewed again. Keep exactly
          // the same stored operation; this exception never survives unknown,
          // storage replacement or reopening without the original receipt.
          this.publish({ review: null, observation: null, outcome: null, takeoverReceipt: null, resolved: false });
          return;
        }
        const raw = JSON.stringify({ version: VERSION, operation });
        // Remember before write/readback. Storage failure is not permission to
        // overwrite an uncertain command or send it without its original locator.
        this.publish({ original: operation, review: null, observation: null, outcome: null, takeoverReceipt: null, resolved: false, invalid: true });
        this.input.store.write(raw);
        if (this.input.store.read() !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        this.held = raw; this.publish({ invalid: false });
      });
      this.check(signal); this.unchanged();
      const outcome = parseTaskRecoveryOutcome(await this.input.port.execute(action, fresh, signal)); this.check(signal);
      this.unchanged();
      this.publish({ outcome, resolved: outcome.kind === 'not_started' || !['unknown', 'unavailable'].includes(outcome.outcome.status) });
      // A returned runner status is still not a Core receipt. An ambiguous
      // outcome must remain on the original operation reader, including retries
      // offered by the visual confirmation component.
      if (!this.state.resolved) throw Error('AI_RESULT_UNKNOWN');
    });
  }
  async read() {
    return this.perform('read', async signal => {
      const original = this.restore();
      if (!original) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      this.publish({ review: null, observation: null, takeoverReceipt: null });
      const receipt = original.action === 'takeover' ? parseTaskTakeoverReceipt(
        await this.input.port.takeoverReceipt(structuredClone(original), signal), original) : null;
      this.check(signal);
      this.publish({ takeoverReceipt: receipt });
      const observation = parseTaskRecoverySnapshot(await this.input.port.snapshot(original.original, original.taskId, original.runId, signal),
        original.taskId, original.runId); this.check(signal);
      const resolved = terminalObservation(observation) || this.state.resolved;
      this.publish({ observation, takeoverReceipt: receipt, resolved });
      // Reading the held original remains legal after a competing journal
      // change. That change never grants dispatch or removes the other tab's key.
      try { this.unchanged(); } catch { /* Keep the read-only original evidence visible. */ }
    });
  }
}
