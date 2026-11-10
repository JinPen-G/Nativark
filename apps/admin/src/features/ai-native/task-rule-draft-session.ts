/** One human rule-draft interaction. Only original ids persist before save;
 * unknown saves can only be observed, never retried or cleared by absence.
 * Scope/hide/unmount drops buffered facts and interrupts late delivery. */
import { aiTaskRuleDraftReference, type AiTaskRuleDraftReference, type AiTaskRuleDraftReviewInput, type AiTaskRuleDraftSaveInput,
  aiTaskRuleDraftPreparationReference, AI_TASK_RULE_DRAFT_FIELDS,
  type AiTaskRuleDraftListResponse, type AiTaskRuleDraftReviewResponse, type AiTaskRuleDraftOperationResponse,
  type AiTaskRuleDraftPreparationResponse, type AiTaskRuleDraftPreparationPreviewInput, type AiTaskRuleDraftPreparationPreviewResponse,
  type AiTaskRuleDraftPrepareInput, type AiTaskRuleDraftPreparationReference, type AiTaskRuleDraftPreparationOperationResponse } from '@rental-os/shared';

export interface TaskRuleDraftApi {
  list(taskId: string, signal: AbortSignal): Promise<AiTaskRuleDraftListResponse>;
  review(value: AiTaskRuleDraftReviewInput, signal: AbortSignal): Promise<AiTaskRuleDraftReviewResponse>;
  save(value: AiTaskRuleDraftSaveInput, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
  operation(value: AiTaskRuleDraftReference, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
}

/** A preparation locator holds the original operation even after a successful
 * R1 receipt, so reopening can locate its new Task without replaying prepare. */
export function taskRuleDraftPreparationStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  return { read(): AiTaskRuleDraftPreparationReference | null {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const raw = storage.getItem(key);
    if (raw === null) return null; if (!raw || raw.length > 512) throw Error('AI_RESULT_UNKNOWN');
    return aiTaskRuleDraftPreparationReference.parse(JSON.parse(raw));
  }, write(value: AiTaskRuleDraftPreparationReference) {
    if (!storage || storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
    const raw = JSON.stringify(aiTaskRuleDraftPreparationReference.parse(value)); storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  } };
}
type PreparationApi = {
  preparation(taskId: string, signal: AbortSignal): Promise<AiTaskRuleDraftPreparationResponse>;
  previewPreparation(value: AiTaskRuleDraftPreparationPreviewInput, signal: AbortSignal): Promise<AiTaskRuleDraftPreparationPreviewResponse>;
  prepareProposal(value: AiTaskRuleDraftPrepareInput, signal: AbortSignal): Promise<AiTaskRuleDraftPreparationOperationResponse>;
  preparationOperation(value: AiTaskRuleDraftPreparationReference, signal: AbortSignal): Promise<AiTaskRuleDraftPreparationOperationResponse>;
};
type PreparationView = {
  preparation: AiTaskRuleDraftPreparationResponse | null; targetId: string | null;
  values: AiTaskRuleDraftPreparationPreviewInput['values'] | null; preview: AiTaskRuleDraftPreparationPreviewResponse | null;
  pending: AiTaskRuleDraftPreparationReference | null; operation: AiTaskRuleDraftPreparationOperationResponse | null;
  invalid: boolean; busy: 'read' | 'preview' | 'prepare' | 'operation' | null; error: unknown;
};
export function createTaskRuleDraftPreparationSession(input: { taskId: string; tenantId: string; workspaceId: string;
  current(): boolean; changed(): void; api: PreparationApi; store: ReturnType<typeof taskRuleDraftPreparationStore> }) {
  let active = true, request: AbortController | null = null;
  let pending: AiTaskRuleDraftPreparationReference | null = null, invalid = false;
  try { pending = input.store.read(); if (pending && pending.taskId !== input.taskId) { pending = null; invalid = true; } } catch { invalid = true; }
  let view: PreparationView = { preparation: null, targetId: null, values: null, preview: null, pending, operation: null, invalid, busy: null, error: null };
  const check = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (value: Partial<PreparationView>) => { if (active && input.current()) { view = { ...view, ...value }; input.changed(); } };
  const validateScope = (scope: { tenantId: string; workspaceId: string }) => {
    if (scope.tenantId !== input.tenantId || scope.workspaceId !== input.workspaceId) throw Error('AI_SCOPE_CHANGED');
  };
  const restore = () => {
    try { const value = input.store.read();
      if (value && value.taskId !== input.taskId || view.pending && (!value || value.operationKey !== view.pending.operationKey)) {
        view = { ...view, invalid: true }; return;
      }
      view = { ...view, pending: value, invalid: false };
    } catch { view = { ...view, invalid: true }; }
  };
  const run = async (kind: NonNullable<PreparationView['busy']>, work: (signal: AbortSignal) => Promise<void>) => {
    check(); if (request) throw Error('AI_OPERATION_BUSY'); const controller = new AbortController(); request = controller;
    publish({ busy: kind, error: null });
    try { await work(controller.signal); check(controller.signal); }
    catch (error) { if (request === controller && !controller.signal.aborted) publish({ preview: null, error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: null }); } }
  };
  const observe = (value: AiTaskRuleDraftPreparationOperationResponse, reference: AiTaskRuleDraftPreparationReference) => {
    validateScope(value.scope);
    if (value.reference.taskId !== input.taskId || value.reference.operationKey !== reference.operationKey) throw Error('AI_SCOPE_CHANGED');
    publish({ operation: value, preview: null });
  };
  return Object.freeze({ get view() { return view; },
    async read() { check(); restore(); if (view.pending || view.invalid) { input.changed(); throw Error('AI_RESULT_UNKNOWN'); }
      return run('read', async signal => { publish({ preparation: null, targetId: null, values: null, preview: null });
        const value = await input.api.preparation(input.taskId, signal); check(signal); validateScope(value.scope);
        if (value.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED'); restore();
        if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); publish({ preparation: value }); });
    },
    select(targetId: string) { check(); if (view.busy || view.pending || view.invalid) throw Error('AI_OPERATION_BUSY');
      const selected = view.preparation?.targets.find(target => target.id === targetId); if (!selected) throw Error('AI_RESOURCE_UNAVAILABLE');
      publish({ targetId, values: structuredClone(selected.values), preview: null, error: null });
    },
    edit(field: typeof AI_TASK_RULE_DRAFT_FIELDS[number], value: boolean) {
      check(); if (!view.values || view.busy || view.pending || view.invalid || !AI_TASK_RULE_DRAFT_FIELDS.includes(field) || typeof value !== 'boolean') throw Error('AI_INVALID_INPUT');
      publish({ values: { ...view.values, [field]: value }, preview: null });
    },
    async preview() { check(); const target = view.preparation?.targets.find(target => target.id === view.targetId), values = view.values && structuredClone(view.values);
      if (!target || !values || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('preview', async signal => { const value = await input.api.previewPreparation({ taskId: input.taskId, targetId: target.id, version: target.version, values }, signal);
        check(signal); validateScope(value.scope);
        if (value.taskId !== input.taskId || value.target.id !== target.id || value.target.version !== target.version
          || AI_TASK_RULE_DRAFT_FIELDS.some(field => value.values[field] !== values[field])) throw Error('AI_REVISION_CONFLICT');
        publish({ preview: value }); });
    },
    async prepare(operationKey: string) { check(); const preview = view.preview; restore();
      if (!preview || preview.status !== 'difference_ready' || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('prepare', async signal => { const reference = aiTaskRuleDraftPreparationReference.parse({ taskId: input.taskId, operationKey });
        view = { ...view, pending: reference, preview: null }; input.changed(); input.store.write(reference);
        const stored = input.store.read(); if (!stored || stored.taskId !== reference.taskId || stored.operationKey !== operationKey) { view = { ...view, invalid: true }; throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }
        check(signal); const value = await input.api.prepareProposal({ taskId: input.taskId, targetId: preview.target.id, version: preview.target.version,
          values: preview.values, operationKey, reviewHash: preview.reviewHash, expiresAt: preview.expiresAt, decision: 'prepare_new_rule_ai_proposal' }, signal);
        check(signal); observe(value, reference);
      });
    },
    async operation() { check(); const reference = view.pending; if (!reference) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      return run('operation', async signal => { const value = await input.api.preparationOperation(reference, signal); check(signal); observe(value, reference); });
    },
    activate() { active = true; restore(); input.changed(); },
    clear() { request?.abort(); request = null; view = { ...view, preparation: null, targetId: null, values: null, preview: null, operation: null, busy: null, error: null }; if (active && input.current()) input.changed(); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, preparation: null, targetId: null, values: null, preview: null, operation: null, busy: null, error: null }; }
  });
}
export interface TaskRuleDraftStore { read(): AiTaskRuleDraftReference | null; write(value: AiTaskRuleDraftReference): void; clear(): void; }
export function taskRuleDraftStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): TaskRuleDraftStore {
  return { read() {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const text = storage.getItem(key); if (text === null) return null;
    if (!text || text.length > 512) throw Error('AI_RESULT_UNKNOWN');
    const parsed = aiTaskRuleDraftReference.safeParse(JSON.parse(text)); if (!parsed.success) throw Error('AI_RESULT_UNKNOWN');
    return parsed.data; },
    write(value) { if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const checked = aiTaskRuleDraftReference.parse(value);
      if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = JSON.stringify(checked); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }, clear() { storage?.removeItem(key); } };
}
export interface TaskRuleDraftView {
  items: AiTaskRuleDraftListResponse['items']; loaded: boolean; saveEnabled: boolean; review: AiTaskRuleDraftReviewResponse | null;
  operation: AiTaskRuleDraftOperationResponse | null; pending: AiTaskRuleDraftReference | null;
  locatorInvalid: boolean; busy: 'list' | 'review' | 'save' | 'operation' | null; error: unknown;
}
const same = (a: AiTaskRuleDraftReference, b: AiTaskRuleDraftReference) => a.taskId === b.taskId && a.runId === b.runId && a.stepId === b.stepId;
export function createTaskRuleDraftSession(input: { taskId: string; current(): boolean; api: TaskRuleDraftApi; store: TaskRuleDraftStore; changed(): void }) {
  let saved: AiTaskRuleDraftReference | null = null, locatorInvalid = false;
  try { saved = input.store.read(); locatorInvalid = !!saved && saved.taskId !== input.taskId; }
  catch { locatorInvalid = true; }
  let active = true, request: AbortController | null = null;
  let view: TaskRuleDraftView = { items: [], loaded: false, saveEnabled: false, review: null, operation: null,
    pending: saved?.taskId === input.taskId ? saved : null, locatorInvalid, busy: null, error: null };
  const publish = (update: Partial<TaskRuleDraftView>) => { if (!active || !input.current()) return; view = { ...view, ...update }; input.changed(); };
  const assert = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const assertReference = (value: AiTaskRuleDraftReference) => { assert(); aiTaskRuleDraftReference.parse(value);
    if (value.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED'); };
  const run = async <T>(kind: NonNullable<TaskRuleDraftView['busy']>, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: kind, error: null });
    try { const result = await action(owner.signal); assert(); if (owner.signal.aborted) throw Error('AI_SCOPE_CHANGED'); return result; }
    catch (error) { if (request === owner && !owner.signal.aborted) publish({ error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  return Object.freeze({ get view() { return view; },
    async list() { return run('list', async signal => { const value = await input.api.list(input.taskId, signal);
      assert(signal); if (value.taskId !== input.taskId || value.items.some(item => item.reference.taskId !== input.taskId)) throw Error('AI_SCOPE_CHANGED');
      publish({ items: value.items, loaded: true, saveEnabled: value.saveEnabled && !view.locatorInvalid, review: null }); }); },
    async review(reference: AiTaskRuleDraftReference, changeReason: string) {
      assertReference(reference);
      if (view.pending) throw Error('AI_RESULT_UNKNOWN');
      return run('review', async signal => { const value = await input.api.review({ ...reference, changeReason }, signal);
        assert(signal); if (!same(value.reference, reference)) throw Error('AI_SCOPE_CHANGED'); publish({ review: value, operation: null }); });
    },
    async save() {
      assert(); const reviewed = view.review;
      if (!reviewed || !view.saveEnabled || view.pending || view.locatorInvalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('save', async signal => {
        // Refuse dispatch if the original locator cannot be preserved. No
        // fields, reason, hash, raw settings or token are written to storage.
        input.store.write(reviewed.reference);
        const persisted = input.store.read();
        if (!persisted || !same(persisted, reviewed.reference)) {
          publish({ locatorInvalid: true, saveEnabled: false }); throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        }
        publish({ pending: reviewed.reference, review: null });
        try { const value = await input.api.save({ ...reviewed.reference, changeReason: reviewed.changeReason,
          reviewHash: reviewed.reviewHash, decision: 'save_original_business_draft' }, signal);
          assert(signal); if (!same(value.reference, reviewed.reference) || value.operation.state !== 'committed') throw Error('AI_RESULT_UNKNOWN');
          input.store.clear(); publish({ operation: value, pending: null });
        } catch (error) { if (!signal.aborted) publish({ review: null }); throw error; }
      });
    },
    async operation(reference: AiTaskRuleDraftReference) {
      assertReference(reference);
      return run('operation', async signal => { const value = await input.api.operation(reference, signal);
        assert(signal); if (!same(value.reference, reference)) throw Error('AI_SCOPE_CHANGED');
        if (value.operation.state === 'committed' && view.pending && same(view.pending, reference)) { input.store.clear(); publish({ pending: null }); }
        // not_observed does not clear unknown or permit another save.
        publish({ operation: value, review: null });
      });
    },
    clearReview() { publish({ review: null }); },
    activate() { active = true; view = { ...view, items: [], loaded: false, saveEnabled: false, review: null, operation: null, busy: null, error: null }; input.changed(); },
    clear() { request?.abort(); request = null; view = { ...view, items: [], loaded: false, saveEnabled: false, review: null, operation: null, busy: null, error: null }; if (active && input.current()) input.changed(); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, items: [], review: null, operation: null, busy: null, error: null }; }
  });
}
