/** One human calendar-draft interaction. Only original ids persist before save;
 * unknown saves can only be observed, never retried or cleared by absence.
 * Scope/hide/unmount drops buffered facts and interrupts late delivery. */
import { aiTaskCalendarDraftReference, type AiTaskCalendarDraftReference, type AiTaskCalendarDraftReviewInput, type AiTaskCalendarDraftSaveInput,
  type AiTaskCalendarDraftListResponse, type AiTaskCalendarDraftReviewResponse, type AiTaskCalendarDraftOperationResponse } from '@rental-os/shared';

export interface TaskCalendarDraftApi {
  list(taskId: string, signal: AbortSignal): Promise<AiTaskCalendarDraftListResponse>;
  review(value: AiTaskCalendarDraftReviewInput, signal: AbortSignal): Promise<AiTaskCalendarDraftReviewResponse>;
  save(value: AiTaskCalendarDraftSaveInput, signal: AbortSignal): Promise<AiTaskCalendarDraftOperationResponse>;
  operation(value: AiTaskCalendarDraftReference, signal: AbortSignal): Promise<AiTaskCalendarDraftOperationResponse>;
}
export interface TaskCalendarDraftStore { read(): AiTaskCalendarDraftReference | null; write(value: AiTaskCalendarDraftReference): void; clear(expected: AiTaskCalendarDraftReference): void; }
export function taskCalendarDraftStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): TaskCalendarDraftStore {
  return { read() {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const text = storage.getItem(key); if (text === null) return null;
    if (!text || text.length > 512) throw Error('AI_RESULT_UNKNOWN');
    const parsed = aiTaskCalendarDraftReference.safeParse(JSON.parse(text)); if (!parsed.success) throw Error('AI_RESULT_UNKNOWN');
    return parsed.data; },
    write(value) { if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const checked = aiTaskCalendarDraftReference.parse(value);
      if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
      const raw = JSON.stringify(checked); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); }, clear(expected) {
      if (!storage || storage.getItem(key) !== JSON.stringify(aiTaskCalendarDraftReference.parse(expected))) throw Error('AI_RESULT_UNKNOWN');
      storage.removeItem(key); if (storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN'); } };
}
export interface TaskCalendarDraftView {
  items: AiTaskCalendarDraftListResponse['items']; loaded: boolean; saveEnabled: boolean; review: AiTaskCalendarDraftReviewResponse | null;
  operation: AiTaskCalendarDraftOperationResponse | null; pending: AiTaskCalendarDraftReference | null;
  locatorInvalid: boolean; busy: 'list' | 'review' | 'save' | 'operation' | null; error: unknown;
}
const same = (a: AiTaskCalendarDraftReference, b: AiTaskCalendarDraftReference) => a.taskId === b.taskId && a.runId === b.runId && a.stepId === b.stepId;
export function createTaskCalendarDraftSession(input: { taskId: string; current(): boolean; api: TaskCalendarDraftApi; store: TaskCalendarDraftStore; changed(): void }) {
  let saved: AiTaskCalendarDraftReference | null = null, locatorInvalid = false;
  try { saved = input.store.read(); locatorInvalid = !!saved && saved.taskId !== input.taskId; }
  catch { locatorInvalid = true; }
  let active = true, request: AbortController | null = null;
  let view: TaskCalendarDraftView = { items: [], loaded: false, saveEnabled: false, review: null, operation: null,
    pending: saved?.taskId === input.taskId ? saved : null, locatorInvalid, busy: null, error: null };
  const publish = (update: Partial<TaskCalendarDraftView>) => { if (!active || !input.current()) return; view = { ...view, ...update }; input.changed(); };
  // Effect replay can reactivate this session; an old request still retains its aborted signal.
  const assert = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const reset = () => { request?.abort(); request = null; view = { ...view, items: [], loaded: false, saveEnabled: false,
    review: null, operation: null, busy: null, error: null }; };
  const assertReference = (value: AiTaskCalendarDraftReference) => { assert(); aiTaskCalendarDraftReference.parse(value);
    if (value.taskId !== input.taskId) throw Error('AI_SCOPE_CHANGED'); };
  const run = async <T>(kind: NonNullable<TaskCalendarDraftView['busy']>, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: kind, error: null });
    try { const result = await action(owner.signal); assert(owner.signal); return result; }
    catch (error) { if (request === owner && !owner.signal.aborted) publish({ error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  return Object.freeze({ get view() { return view; },
    async list() { return run('list', async signal => { const value = await input.api.list(input.taskId, signal);
      assert(signal); if (value.taskId !== input.taskId || value.items.some(item => item.reference.taskId !== input.taskId)) throw Error('AI_SCOPE_CHANGED');
      publish({ items: value.items, loaded: true, saveEnabled: value.saveEnabled && !view.locatorInvalid, review: null }); }); },
    async review(reference: AiTaskCalendarDraftReference, overrideReason: string, overrideConfirmed: boolean) {
      assertReference(reference);
      if (view.pending) throw Error('AI_RESULT_UNKNOWN');
      return run('review', async signal => { const value = await input.api.review({ ...reference, overrideReason, overrideConfirmed }, signal);
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
        assert(signal);
        publish({ pending: reviewed.reference, review: null });
        try { const value = await input.api.save({ ...reviewed.reference, overrideReason: reviewed.overrideReason, overrideConfirmed: reviewed.overrideConfirmed,
          reviewHash: reviewed.reviewHash, decision: 'save_original_business_draft' }, signal);
          assert(signal); if (!same(value.reference, reviewed.reference) || value.operation.state !== 'committed') throw Error('AI_RESULT_UNKNOWN');
          input.store.clear(reviewed.reference); publish({ operation: value, pending: null });
        } catch (error) { if (!signal.aborted) publish({ review: null }); throw error; }
      });
    },
    async operation(reference: AiTaskCalendarDraftReference) {
      assertReference(reference);
      return run('operation', async signal => { const value = await input.api.operation(reference, signal);
        assert(signal); if (!same(value.reference, reference)) throw Error('AI_SCOPE_CHANGED');
        if (value.operation.state === 'committed' && view.pending && same(view.pending, reference)) { input.store.clear(reference); publish({ pending: null }); }
        // not_observed does not clear unknown or permit another save.
        publish({ operation: value, review: null });
      });
    },
    clearReview() { publish({ review: null }); },
    activate() { reset(); active = true; publish({}); },
    clear() { reset(); publish({}); },
    dispose() { active = false; reset(); }
  });
}
