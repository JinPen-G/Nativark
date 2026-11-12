/** Explicit model controls in one original Task. Only reference metadata is
 * retained before dispatch; an uncertain operation can only be read again.
 * Business preparation, approval and execution remain in their original flows. */
import Ajv from 'ajv';
import { AI_TASK_DRAFT_VERSION, AI_WORKBENCH_MODEL_CONTROL_VERSION, AI_WORKBENCH_MODEL_CONTROL_SCHEMAS,
  AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS, type AiWorkbenchModelControlCommand, type AiWorkbenchModelControlKind,
  type AiWorkbenchModelControlPreparation, type AiWorkbenchModelControlReference, type AiWorkbenchModelControlObservation,
  type AiTaskModelObservationDraft, type AiTaskSnapshotDraft } from '@rental-os/shared';
import { validateTaskCenterSnapshot } from './task-center-reader';

type Values = {
  AiWorkbenchDisplayReadDraft: { taskId: string };
  AiWorkbenchModelControlCommand: AiWorkbenchModelControlCommand;
  AiWorkbenchModelControlReference: AiWorkbenchModelControlReference;
  AiWorkbenchModelControlPreparation: AiWorkbenchModelControlPreparation;
  AiWorkbenchModelControlObservation: AiWorkbenchModelControlObservation;
};
const schemas = { ...AI_WORKBENCH_MODEL_CONTROL_SCHEMAS,
  AiWorkbenchDisplayReadDraft: AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS.AiWorkbenchDisplayReadDraft };
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));
export function parseWorkbenchModelControl<K extends keyof Values>(name: K, value: unknown): Values[K] {
  const copy: unknown = structuredClone(value);
  if (new TextEncoder().encode(JSON.stringify(copy)).length > 4096 || !validators[name](copy)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return copy as Values[K];
}

export interface WorkbenchModelControlPort {
  prepare(value: { taskId: string }, signal: AbortSignal): Promise<unknown>;
  execute(value: AiWorkbenchModelControlCommand, signal: AbortSignal): Promise<unknown>;
  read(value: AiWorkbenchModelControlReference, signal: AbortSignal): Promise<unknown>;
}
export interface WorkbenchModelControlStore {
  read(): string | null;
  write(value: string): void;
  /** The browser adapter serializes read/compare/write across tabs. */
  exclusive<T>(work: () => T | Promise<T>): Promise<T>;
}
export interface WorkbenchModelControlState {
  busy: 'prepare' | 'execute' | 'read' | 'refresh' | null;
  preparation: AiWorkbenchModelControlPreparation | null;
  original: AiWorkbenchModelControlCommand | null;
  observation: AiWorkbenchModelControlObservation | null;
  error: 'source_unavailable' | 'operation_unknown' | 'journal_unavailable' | 'result_unavailable' | null;
  invalid: boolean;
}
const initial = (): WorkbenchModelControlState => ({ busy: null, preparation: null, original: null,
  observation: null, error: null, invalid: false });
const terminal = (value: AiWorkbenchModelControlObservation | null) => value?.status === 'available' || value?.status === 'failed';
export function workbenchModelControlStorageKey(owner: { tenantId: string; workspaceId: string; userId: string; taskId: string }): string {
  return `rental-ai:workbench-model-control:${encodeURIComponent(JSON.stringify([owner.tenantId, owner.workspaceId, owner.userId, owner.taskId]))}`;
}
function journal(raw: string, taskId: string): AiWorkbenchModelControlCommand {
  if (raw.length > 4096) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'command,version'
    || value.version !== AI_WORKBENCH_MODEL_CONTROL_VERSION) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  const command = parseWorkbenchModelControl('AiWorkbenchModelControlCommand', value.command);
  if (command.taskId !== taskId) throw Error('AI_SCOPE_CHANGED');
  return command;
}

export class WorkbenchModelControlSession {
  private active = false;
  private generation = 0;
  private request: AbortController | null = null;
  private held: string | null = null;
  private state = initial();
  private applied: string | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly input: { taskId: string; port: WorkbenchModelControlPort; store: WorkbenchModelControlStore;
    current(): boolean; sourceEnabled(): boolean; newKey(): string;
    onAvailable(value: AiWorkbenchModelControlObservation, signal: AbortSignal): Promise<void> }) {
    parseWorkbenchModelControl('AiWorkbenchDisplayReadDraft', { taskId: input.taskId });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<WorkbenchModelControlState>) {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private check(signal?: AbortSignal, generation = this.generation) {
    if (!this.active || generation !== this.generation || signal?.aborted || !this.input.current()) throw Error('AI_SCOPE_CHANGED');
  }
  private restore() {
    const pending = this.state.original && !terminal(this.state.observation) ? this.state.original : null;
    try {
      const raw = this.input.store.read();
      const original = raw === null ? null : journal(raw, this.input.taskId);
      // A competing or removed journal cannot erase this page's uncertain
      // operation. First read that original receipt before adopting another.
      if (pending && JSON.stringify(original) !== JSON.stringify(pending)) {
        this.publish({ invalid: true, preparation: null, error: 'journal_unavailable' });
        return pending;
      }
      const changed = raw !== this.held;
      this.held = raw;
      this.publish({ original, invalid: false, ...(changed ? { preparation: null, observation: null, error: null } : {}) });
      return original;
    } catch (error) {
      this.publish({ invalid: true, preparation: null, error: 'journal_unavailable' });
      if (pending) return pending;
      throw error;
    }
  }
  private unchanged() {
    let unchanged = false;
    try { unchanged = this.input.store.read() === this.held; } catch { /* Storage must be readable before dispatch or result application. */ }
    if (!unchanged) {
      this.publish({ invalid: true, preparation: null, error: 'journal_unavailable' });
      throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    }
  }
  activate() {
    this.active = true;
    try { this.restore(); } catch { this.publish({ invalid: true, preparation: null, error: 'journal_unavailable' }); }
  }
  clearPreparation() { this.publish({ preparation: null }); }
  suspend() {
    this.generation++; this.request?.abort(); this.request = null;
    this.applied = null;
    this.publish({ busy: null, preparation: null, observation: null, error: null });
  }
  dispose() { this.active = false; this.suspend(); }
  private async perform(kind: NonNullable<WorkbenchModelControlState['busy']>, work: (signal: AbortSignal) => Promise<void>) {
    this.check();
    if (this.request) throw Error('AI_OPERATION_IN_PROGRESS');
    const generation = this.generation, request = new AbortController(); this.request = request;
    this.publish({ busy: kind, error: null });
    try { await work(request.signal); this.check(request.signal, generation); }
    catch (error) {
      if (this.active && generation === this.generation && this.input.current()) {
        const resultUnavailable = this.state.error === 'result_unavailable';
        this.publish({ preparation: null, ...(kind === 'read' && !resultUnavailable && !this.state.invalid ? { observation: null } : {}),
          error: this.state.invalid ? 'journal_unavailable' : resultUnavailable ? 'result_unavailable'
            : kind === 'prepare' ? 'source_unavailable' : 'operation_unknown' });
      }
      throw error;
    } finally { if (this.request === request) { this.request = null;
      if (this.active && generation === this.generation && this.input.current()) this.publish({ busy: null }); } }
  }
  private accept(value: unknown, command: AiWorkbenchModelControlCommand) {
    const observation = parseWorkbenchModelControl('AiWorkbenchModelControlObservation', value), previous = this.state.observation;
    if (observation.taskId !== command.taskId || observation.operationId !== command.operationId
      || observation.kind !== undefined && observation.kind !== command.kind
      || observation.sourceRunId !== undefined && observation.sourceRunId !== command.sourceRunId
      || observation.sourceResultId !== undefined && observation.sourceResultId !== command.sourceResultId
      || observation.runId !== undefined && observation.runId === command.sourceRunId
      || observation.resultId !== undefined && observation.resultId === command.sourceResultId
      || observation.presentationRevision !== undefined && observation.presentationRevision <= command.expectedPresentationRevision
      || previous?.operationId === command.operationId && (previous.runId !== undefined && observation.runId !== previous.runId
        || previous.operationLogId !== undefined && observation.operationLogId !== previous.operationLogId
        || previous.resultId !== undefined && observation.resultId !== previous.resultId
        || previous.presentationRevision !== undefined && observation.presentationRevision !== previous.presentationRevision
        || previous.sourceRunId !== undefined && observation.sourceRunId !== previous.sourceRunId
        || previous.sourceResultId !== undefined && observation.sourceResultId !== previous.sourceResultId)) throw Error('AI_REVISION_CONFLICT');
    this.publish({ preparation: null, observation });
    return observation;
  }
  private async apply(observation: AiWorkbenchModelControlObservation, signal: AbortSignal, force = false) {
    if (observation.status !== 'available') return;
    const signature = JSON.stringify([observation.taskId, observation.operationId, observation.runId,
      observation.resultId, observation.presentationRevision]);
    if (!force && signature === this.applied) return;
    this.check(signal);
    try { await this.input.onAvailable(structuredClone(observation), signal); }
    catch (error) { if (this.active && !signal.aborted && this.input.current()) this.publish({ error: 'result_unavailable' }); throw error; }
    this.check(signal); this.unchanged(); this.applied = signature;
  }
  async prepare() {
    return this.perform('prepare', async signal => {
      this.unchanged();
      if (!this.input.sourceEnabled() || this.state.invalid || this.state.original && !terminal(this.state.observation)) throw Error('AI_RESULT_UNKNOWN');
      const value = await this.input.port.prepare({ taskId: this.input.taskId }, signal); this.check(signal); this.unchanged();
      const preparation = parseWorkbenchModelControl('AiWorkbenchModelControlPreparation', value);
      if (preparation.taskId !== this.input.taskId || !this.input.sourceEnabled()) throw Error('AI_SCOPE_CHANGED');
      this.publish({ preparation });
    });
  }
  async execute(kind: AiWorkbenchModelControlKind) {
    const preparation = this.state.preparation;
    if (!preparation || !preparation.kinds.includes(kind) || this.state.invalid || !this.input.sourceEnabled()
      || this.state.original && !terminal(this.state.observation)) throw Error('AI_RESOURCE_UNAVAILABLE');
    return this.perform('execute', async signal => {
      const command = await this.input.store.exclusive(() => {
        this.check(signal); this.unchanged();
        if (this.state.preparation !== preparation || !this.input.sourceEnabled()) throw Error('AI_REVISION_CONFLICT');
        const command = parseWorkbenchModelControl('AiWorkbenchModelControlCommand', { taskId: preparation.taskId,
          operationId: this.input.newKey(), kind, expectedTaskRevision: preparation.expectedTaskRevision,
          sourceRunId: preparation.sourceRunId, sourceResultId: preparation.sourceResultId,
          expectedPresentationRevision: preparation.expectedPresentationRevision });
        const raw = JSON.stringify({ version: AI_WORKBENCH_MODEL_CONTROL_VERSION, command });
        // Remember before attempting the write. A lost storage acknowledgement
        // is not permission to send or replace the original operation.
        this.publish({ original: command, preparation: null, observation: null });
        this.publish({ invalid: true });
        this.input.store.write(raw);
        if (this.input.store.read() !== raw) { this.publish({ invalid: true }); throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }
        this.held = raw; this.publish({ invalid: false }); this.check(signal);
        return command;
      });
      const value = await this.input.port.execute(structuredClone(command), signal); this.check(signal); this.unchanged();
      await this.apply(this.accept(value, command), signal);
    });
  }
  async read() {
    return this.perform('read', async signal => {
      const command = this.restore();
      if (!command) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const value = await this.input.port.read({ taskId: command.taskId, operationId: command.operationId }, signal);
      this.check(signal);
      const observation = this.accept(value, command);
      this.unchanged(); await this.apply(observation, signal);
    });
  }
  async refreshResult() {
    return this.perform('refresh', async signal => {
      this.unchanged();
      if (this.state.observation?.status !== 'available') throw Error('AI_RESOURCE_UNAVAILABLE');
      await this.apply(this.state.observation, signal, true);
    });
  }
}

/** The control receipt supplies the exact result locator. Event-page order is
 * not used to choose a replacement result; current server source checks remain. */
export async function readWorkbenchControlResult(reads: {
  snapshot(taskId: string, signal: AbortSignal): Promise<AiTaskSnapshotDraft>;
  result(taskId: string, resultId: string, signal: AbortSignal): Promise<AiTaskModelObservationDraft>;
}, value: AiWorkbenchModelControlObservation, signal: AbortSignal, current: () => boolean) {
  const original = parseWorkbenchModelControl('AiWorkbenchModelControlObservation', value);
  if (original.status !== 'available' || !original.runId || !original.resultId) throw Error('AI_RESOURCE_UNAVAILABLE');
  const check = () => { if (signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED'); };
  const snapshot = async () => { check(); const row = validateTaskCenterSnapshot(await reads.snapshot(original.taskId, signal), original.taskId); check(); return row; };
  const first = await snapshot();
  const steps = first.steps.filter(step => step.resultId === original.resultId);
  if (steps.length !== 1 || steps[0].runId !== original.runId || steps[0].kind !== 'model'
    || steps[0].status !== 'succeeded') throw Error('AI_RESOURCE_UNAVAILABLE');
  const result = await reads.result(original.taskId, original.resultId, signal); check();
  const keys = ['contractVersion','taskId','runId','resultId','sceneCode','status','text','sources','observedAt','businessExecution','execution'];
  if (!result || Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))
    || result.contractVersion !== AI_TASK_DRAFT_VERSION || result.taskId !== original.taskId || result.runId !== original.runId
    || result.resultId !== original.resultId || result.sceneCode !== first.sceneCode
    || !['order_explanation','opening_diagnosis','quote_clarification'].includes(result.sceneCode)
    || !['available','stale','unknown','failed'].includes(result.status) || !Number.isFinite(Date.parse(result.observedAt))
    || result.businessExecution !== 'not_inferred_from_model_result' || result.execution !== 'read_only_no_start_no_reconnect_side_effect'
    || !Array.isArray(result.sources) || result.sources.length > 9
    || result.sources.some(source => !source || Object.keys(source).sort().join(',') !== 'index,kind,referenceHash'
      || !['order','knowledge'].includes(source.kind) || !Number.isSafeInteger(source.index)
      || source.index < 0 || source.index > (source.kind === 'order' ? 4 : 3) || !/^[a-f0-9]{64}$/u.test(source.referenceHash))
    || new Set(result.sources.map(source => `${source.kind}:${source.index}`)).size !== result.sources.length
    || result.status !== 'available' && (result.text !== null || result.sources.length !== 0)
    || result.status === 'available' && (!result.text || Object.keys(result.text).sort().join(',') !== 'trust,value'
      || typeof result.text.value !== 'string' || new TextEncoder().encode(result.text.value).length > 131072
      || result.text.trust !== 'unverified_model_text_not_execution_evidence')) throw Error('AI_RESOURCE_UNAVAILABLE');
  const latest = await snapshot();
  if (first.revision !== latest.revision || first.cursor !== latest.cursor || first.status !== latest.status
    || first.sceneCode !== latest.sceneCode || first.updatedAt !== latest.updatedAt
    || JSON.stringify(first.steps) !== JSON.stringify(latest.steps)) throw Error('AI_REVISION_CONFLICT');
  return { snapshot: latest, result: structuredClone(result), coverage: 'original_control_reference' as const };
}
