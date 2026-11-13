/** One human rule-draft interaction. Only original ids persist before save;
 * unknown saves can only be observed, never retried or cleared by absence.
 * Scope/hide/unmount drops buffered facts and interrupts late delivery. */
import { aiTaskRuleDraftReference, aiTaskRuleDraftOperationResponse, aiTaskRuleDraftPreparationOperationResponse,
  type AiTaskRuleDraftReference, type AiTaskRuleDraftReviewInput, type AiTaskRuleDraftSaveInput,
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
export function taskRuleDraftPreparationStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>) {
  return { read(): AiTaskRuleDraftPreparationReference | null {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const raw = storage.getItem(key);
    if (raw === null) return null; if (!raw || raw.length > 512) throw Error('AI_RESULT_UNKNOWN');
    return aiTaskRuleDraftPreparationReference.parse(JSON.parse(raw));
  }, write(value: AiTaskRuleDraftPreparationReference, completed?: AiTaskRuleDraftPreparationReference) {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const expected = completed ? JSON.stringify(aiTaskRuleDraftPreparationReference.parse(completed)) : null;
    if (storage.getItem(key) !== expected) throw Error('AI_RESULT_UNKNOWN');
    const raw = JSON.stringify(aiTaskRuleDraftPreparationReference.parse(value)); storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  }, clearCompleted(expected: AiTaskRuleDraftPreparationReference) {
    if (!storage?.removeItem) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const raw = storage.getItem(key);
    if (raw === null) return;
    if (raw !== JSON.stringify(aiTaskRuleDraftPreparationReference.parse(expected))) throw Error('AI_RESULT_UNKNOWN');
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  } };
}
type PreparationApi = {
  preparation(taskId: string, signal: AbortSignal, rejected?: AiTaskRuleDraftReference): Promise<AiTaskRuleDraftPreparationResponse>;
  operation?(reference: AiTaskRuleDraftReference, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
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
  current(): boolean; changed(): void; api: PreparationApi; store: ReturnType<typeof taskRuleDraftPreparationStore>;
  rejected?: AiTaskRuleDraftReference }) {
  const rejected = input.rejected && aiTaskRuleDraftReference.parse(structuredClone(input.rejected));
  const rejectedInput = () => rejected ? { rejected: structuredClone(rejected) } : {};
  let rejectionHash: string | undefined;
  let completedPreparation: AiTaskRuleDraftPreparationReference | null = null;
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
    if (view.invalid) return;
    try { const value = input.store.read();
      if (value && value.taskId !== input.taskId || view.pending && (!value || value.operationKey !== view.pending.operationKey)) {
        view = { ...view, invalid: true }; return;
      }
      view = { ...view, pending: value && completedPreparation && value.operationKey === completedPreparation.operationKey
        ? null : value, invalid: false };
    } catch { view = { ...view, invalid: true }; }
  };
  const run = async (kind: NonNullable<PreparationView['busy']>, work: (signal: AbortSignal) => Promise<void>) => {
    check(); if (request) throw Error('AI_OPERATION_BUSY'); const controller = new AbortController(); request = controller;
    publish({ busy: kind, error: null });
    try { await work(controller.signal); check(controller.signal); }
    catch (error) { if (request === controller && !controller.signal.aborted) publish({ preview: null, error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: null }); } }
  };
  const verifyRejected = async (signal: AbortSignal) => {
    if (!rejected) return;
    if (!input.api.operation) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = aiTaskRuleDraftOperationResponse.parse(structuredClone(await input.api.operation(rejected, signal)));
    check(signal);
    if (value.taskId !== rejected.taskId || !same(value.reference, rejected) || value.operation.state !== 'rejected_no_commit')
      throw Error('AI_RESULT_UNKNOWN');
    const hash = JSON.stringify(value.operation);
    if (rejectionHash && hash !== rejectionHash) throw Error('AI_RESULT_UNKNOWN');
    rejectionHash = hash;
  };
  const retireCompletedPreparation = async (signal: AbortSignal) => {
    const reference = view.pending;
    if (!reference) return;
    if (!rejected) throw Error('AI_RESULT_UNKNOWN');
    const value = aiTaskRuleDraftPreparationOperationResponse.parse(structuredClone(await input.api.preparationOperation(reference, signal)));
    check(signal); validateScope(value.scope);
    if (value.reference.taskId !== reference.taskId || value.reference.operationKey !== reference.operationKey
      || value.operation.state !== 'ai_proposal_saved' || !same(value.operation.proposal.reference, rejected)) throw Error('AI_RESULT_UNKNOWN');
    // A completed preparation for this exact rejected save can be retired.
    // Unknown/other preparations keep their original journal and cannot restart.
    // Keep this old locator until the new explicit preparation is stored, so
    // reopening can still discover the rejected child's original Task.
    completedPreparation = structuredClone(reference);
    publish({ pending: null, operation: null, preparation: null, targetId: null, values: null, preview: null });
  };
  const observe = (value: AiTaskRuleDraftPreparationOperationResponse, reference: AiTaskRuleDraftPreparationReference) => {
    validateScope(value.scope);
    if (value.reference.taskId !== input.taskId || value.reference.operationKey !== reference.operationKey) throw Error('AI_SCOPE_CHANGED');
    publish({ operation: value, preview: null });
  };
  return Object.freeze({ get view() { return view; },
    async read() { check(); restore(); if (view.invalid || view.pending && !rejected) { input.changed(); throw Error('AI_RESULT_UNKNOWN'); }
      return run('read', async signal => { publish({ preparation: null, targetId: null, values: null, preview: null });
        await verifyRejected(signal); await retireCompletedPreparation(signal); check(signal);
        const value = await input.api.preparation(input.taskId, signal, rejected); check(signal); validateScope(value.scope);
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
      return run('preview', async signal => { await verifyRejected(signal);
        const value = await input.api.previewPreparation({ taskId: input.taskId, targetId: target.id, version: target.version, values, ...rejectedInput() }, signal);
        check(signal); validateScope(value.scope);
        if (value.taskId !== input.taskId || value.target.id !== target.id || value.target.version !== target.version
          || AI_TASK_RULE_DRAFT_FIELDS.some(field => value.values[field] !== values[field])) throw Error('AI_REVISION_CONFLICT');
        publish({ preview: value }); });
    },
    async prepare(operationKey: string) { check(); const preview = view.preview; restore();
      if (!preview || preview.status !== 'difference_ready' || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('prepare', async signal => { await verifyRejected(signal); check(signal);
        const reference = aiTaskRuleDraftPreparationReference.parse({ taskId: input.taskId, operationKey });
        if (completedPreparation?.operationKey === operationKey) throw Error('AI_RESULT_UNKNOWN');
        view = { ...view, pending: reference, preview: null }; input.changed(); input.store.write(reference, completedPreparation ?? undefined);
        const stored = input.store.read(); if (!stored || stored.taskId !== reference.taskId || stored.operationKey !== operationKey) { view = { ...view, invalid: true }; throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }
        completedPreparation = null;
        check(signal); const value = await input.api.prepareProposal({ taskId: input.taskId, targetId: preview.target.id, version: preview.target.version,
          values: preview.values, operationKey, reviewHash: preview.reviewHash, expiresAt: preview.expiresAt,
          decision: 'prepare_new_rule_ai_proposal', ...rejectedInput() }, signal);
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
export interface TaskRuleDraftStore { read(): AiTaskRuleDraftReference | null; write(value: AiTaskRuleDraftReference): void;
  clear(expected: AiTaskRuleDraftReference): void; markRejected?(expected: AiTaskRuleDraftReference): void; }
function readRuleDraftLocator(raw: string) {
  if (!raw || raw.length > 512) throw Error('AI_RESULT_UNKNOWN');
  const value: unknown = JSON.parse(raw);
  if (value && typeof value === 'object' && !Array.isArray(value) && 'phase' in value) {
    if (Object.keys(value).length !== 2 || value.phase !== 'read_rejected_operation' || !('reference' in value)) throw Error('AI_RESULT_UNKNOWN');
    return { reference: aiTaskRuleDraftReference.parse(value.reference), rejected: true };
  }
  return { reference: aiTaskRuleDraftReference.parse(value), rejected: false };
}
export function taskRuleDraftStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): TaskRuleDraftStore {
  return { read() {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const text = storage.getItem(key); if (text === null) return null;
    return readRuleDraftLocator(text).reference; },
    write(value) { if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const checked = aiTaskRuleDraftReference.parse(value);
      if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = JSON.stringify(checked); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }, clear(expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const raw = storage.getItem(key);
      // A verified terminal receipt can finish an earlier partial cleanup,
      // but cannot remove another page's original pending operation.
      if (raw === null) return;
      const found = readRuleDraftLocator(raw);
      if (found.rejected || !same(found.reference, aiTaskRuleDraftReference.parse(expected))) throw Error('AI_RESULT_UNKNOWN');
      storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); },
    markRejected(expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const raw = storage.getItem(key);
      if (raw === null || !same(readRuleDraftLocator(raw).reference, aiTaskRuleDraftReference.parse(expected))) throw Error('AI_RESULT_UNKNOWN');
      const next = JSON.stringify({ phase: 'read_rejected_operation', reference: expected });
      if (storage.getItem(key) !== raw) throw Error('AI_RESULT_UNKNOWN');
      storage.setItem(key, next); if (storage.getItem(key) !== next) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    } };
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
  const reset = () => { request?.abort(); request = null; view = { ...view, items: [], loaded: false, saveEnabled: false,
    review: null, operation: null, busy: null, error: null }; };
  const restore = () => {
    if (view.locatorInvalid) return;
    try {
      const stored = input.store.read();
      if (stored && stored.taskId !== input.taskId || view.pending && (!stored || !same(stored, view.pending))) {
        publish({ locatorInvalid: true, saveEnabled: false, review: null }); return;
      }
      const rejected = stored && view.operation?.operation.state === 'rejected_no_commit' && same(view.operation.reference, stored);
      if (stored && !view.pending && !rejected) publish({ pending: stored, saveEnabled: false, review: null, operation: null });
    } catch { publish({ locatorInvalid: true, saveEnabled: false, review: null }); }
  };
  const reference = (value: AiTaskRuleDraftReference) => { assert(); const checked = aiTaskRuleDraftReference.parse(structuredClone(value));
    if (checked.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED'); return checked; };
  const run = async <T>(kind: NonNullable<TaskRuleDraftView['busy']>, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (request || view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: kind, error: null });
    try { const result = await action(owner.signal); assert(owner.signal); return result; }
    catch (error) { if (request === owner && !owner.signal.aborted) publish({ error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  const observe = (value: AiTaskRuleDraftOperationResponse, original: AiTaskRuleDraftReference, reviewedHash?: string) => {
    if (value.taskId !== input.taskId || !same(value.reference, original)) throw Error('AI_SCOPE_CHANGED');
    if (view.operation?.operation.state === 'rejected_no_commit' && same(view.operation.reference, original)
      && JSON.stringify(view.operation.operation) !== JSON.stringify(value.operation)) throw Error('AI_RESULT_UNKNOWN');
    if (value.operation.state === 'rejected_no_commit') {
      if (reviewedHash && value.operation.reviewHash !== reviewedHash) throw Error('AI_RESULT_UNKNOWN');
      if (view.pending && same(view.pending, original)) {
        if (!input.store.markRejected) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        input.store.markRejected(original); publish({ pending: null });
      }
      publish({ operation: value, saveEnabled: false, review: null }); return;
    }
    if (value.operation.state === 'committed' && view.pending && same(view.pending, original)) {
      input.store.clear(original); publish({ pending: null });
    }
    publish({ operation: value, review: null });
  };
  return Object.freeze({ get view() { return view; },
    async list() { assert(); restore(); return run('list', async signal => { const value = await input.api.list(input.taskId, signal);
      assert(signal); if (value.taskId !== input.taskId || value.items.some(item => item.reference.taskId !== input.taskId)) throw Error('AI_SCOPE_CHANGED');
      restore(); publish({ items: value.items, loaded: true,
        saveEnabled: value.saveEnabled && !view.locatorInvalid && !view.pending && view.operation?.operation.state !== 'rejected_no_commit', review: null }); }); },
    async review(value: AiTaskRuleDraftReference, changeReason: string) {
      const original = reference(value); restore();
      if (view.pending) throw Error('AI_RESULT_UNKNOWN');
      if (view.operation?.operation.state === 'rejected_no_commit' && same(view.operation.reference, original)) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('review', async signal => { publish({ review: null });
        const operation = aiTaskRuleDraftOperationResponse.parse(structuredClone(await input.api.operation(original, signal)));
        assert(signal); observe(operation, original);
        if (operation.operation.state !== 'not_observed') throw Error('AI_RESOURCE_UNAVAILABLE');
        const reviewed = await input.api.review({ ...original, changeReason }, signal);
        assert(signal); restore(); if (!same(reviewed.reference, original) || reviewed.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED');
        if (view.pending || view.locatorInvalid) throw Error('AI_RESULT_UNKNOWN'); publish({ review: reviewed, operation: null }); });
    },
    async save() {
      assert(); restore(); const reviewed = view.review && structuredClone(view.review);
      if (!reviewed || !view.saveEnabled || view.pending || view.locatorInvalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('save', async signal => {
        // Refuse dispatch if the original locator cannot be preserved. No
        // fields, reason, hash, raw settings or token are written to storage.
        publish({ pending: reviewed.reference, review: null });
        assert(signal);
        try { input.store.write(reviewed.reference);
          const persisted = input.store.read();
          if (!persisted || !same(persisted, reviewed.reference)) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        } catch (error) { publish({ locatorInvalid: true, saveEnabled: false }); throw error; }
        assert(signal);
        try { const value = aiTaskRuleDraftOperationResponse.parse(structuredClone(await input.api.save({ ...reviewed.reference, changeReason: reviewed.changeReason,
          reviewHash: reviewed.reviewHash, decision: 'save_original_business_draft' }, signal)));
          assert(signal); if (value.operation.state === 'not_observed') throw Error('AI_RESULT_UNKNOWN');
          observe(value, reviewed.reference, reviewed.reviewHash);
        } catch (error) { if (!signal.aborted) publish({ review: null }); throw error; }
      });
    },
    async operation(value: AiTaskRuleDraftReference) {
      const original = reference(value);
      return run('operation', async signal => { const value = aiTaskRuleDraftOperationResponse.parse(structuredClone(await input.api.operation(original, signal)));
        assert(signal); observe(value, original);
        // not_observed does not clear unknown or permit another save.
      });
    },
    clearReview() { publish({ review: null }); },
    activate() { reset(); active = true; restore(); publish({}); },
    clear() { reset(); restore(); publish({}); },
    dispose() { active = false; reset(); }
  });
}
