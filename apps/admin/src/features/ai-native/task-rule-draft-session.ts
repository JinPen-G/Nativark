/** One human rule-draft interaction. Only original ids persist before save;
 * unknown saves can only be observed, never retried or cleared by absence.
 * Scope/hide/unmount drops buffered facts and interrupts late delivery. */
import { aiTaskRuleDraftReference, type AiTaskRuleDraftReference, type AiTaskRuleDraftReviewInput, type AiTaskRuleDraftSaveInput,
  type AiTaskRuleDraftListResponse, type AiTaskRuleDraftReviewResponse, type AiTaskRuleDraftOperationResponse } from '@rental-os/shared';

export interface TaskRuleDraftApi {
  list(taskId: string, signal: AbortSignal): Promise<AiTaskRuleDraftListResponse>;
  review(value: AiTaskRuleDraftReviewInput, signal: AbortSignal): Promise<AiTaskRuleDraftReviewResponse>;
  save(value: AiTaskRuleDraftSaveInput, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
  operation(value: AiTaskRuleDraftReference, signal: AbortSignal): Promise<AiTaskRuleDraftOperationResponse>;
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
  const assert = () => { if (!active || !input.current()) throw Error('AI_SCOPE_CHANGED'); };
  const assertReference = (value: AiTaskRuleDraftReference) => { assert(); aiTaskRuleDraftReference.parse(value);
    if (value.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED'); };
  const run = async <T>(kind: NonNullable<TaskRuleDraftView['busy']>, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: kind, error: null });
    try { const result = await action(owner.signal); assert(); if (owner.signal.aborted) throw Error('AI_SCOPE_CHANGED'); return result; }
    catch (error) { publish({ error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  return Object.freeze({ get view() { return view; },
    async list() { return run('list', async signal => { const value = await input.api.list(input.taskId, signal);
      assert(); if (value.taskId !== input.taskId || value.items.some(item => item.reference.taskId !== input.taskId)) throw Error('AI_SCOPE_CHANGED');
      publish({ items: value.items, loaded: true, saveEnabled: value.saveEnabled && !view.locatorInvalid, review: null }); }); },
    async review(reference: AiTaskRuleDraftReference, changeReason: string) {
      assertReference(reference);
      if (view.pending) throw Error('AI_RESULT_UNKNOWN');
      return run('review', async signal => { const value = await input.api.review({ ...reference, changeReason }, signal);
        assert(); if (!same(value.reference, reference)) throw Error('AI_SCOPE_CHANGED'); publish({ review: value, operation: null }); });
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
          assert(); if (!same(value.reference, reviewed.reference) || value.operation.state !== 'committed') throw Error('AI_RESULT_UNKNOWN');
          input.store.clear(); publish({ operation: value, pending: null });
        } catch (error) { publish({ review: null }); throw error; }
      });
    },
    async operation(reference: AiTaskRuleDraftReference) {
      assertReference(reference);
      return run('operation', async signal => { const value = await input.api.operation(reference, signal);
        assert(); if (!same(value.reference, reference)) throw Error('AI_SCOPE_CHANGED');
        if (value.operation.state === 'committed' && view.pending && same(view.pending, reference)) { input.store.clear(); publish({ pending: null }); }
        // not_observed does not clear unknown or permit another save.
        publish({ operation: value, review: null });
      });
    },
    clearReview() { publish({ review: null }); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, items: [], review: null, operation: null, busy: null, error: null }; }
  });
}
