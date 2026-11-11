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
import { aiTaskCalendarDraftPreparationReference, aiTaskCalendarDraftEntryReference,
  type AiTaskCalendarDraftPreparationResponse, type AiTaskCalendarDraftPreparationPreviewResponse,
  type AiTaskCalendarDraftPreparationPreviewInput, type AiTaskCalendarDraftPrepareInput,
  type AiTaskCalendarDraftPreparationReference, type AiTaskCalendarDraftPreparationOperationResponse,
  type AiTaskCalendarDraftSourceResponse, type AiTaskCalendarDraftSourceInput, type AiTaskCalendarDraftEntryInput,
  type AiTaskCalendarDraftEntryReference, type AiTaskCalendarDraftEntryResponse } from '@rental-os/shared';

/** Preparation locators survive positive ACKs too, so reopening reads the
 * original linked task rather than producing another request or proposal. */
export function calendarPreparationStorageKey(owner: { tenantId?: string; workspaceId?: string | null; actorId?: string; taskId: string }) {
  return `rental-os-calendar-preparation:${JSON.stringify([owner.tenantId, owner.workspaceId, owner.actorId, owner.taskId])}`;
}
export function calendarPreparationStore<T>(key: string, parse: (value: unknown) => T,
  storage?: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>) {
  return { read(): T | null {
    if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); const raw = storage.getItem(key);
    if (raw === null) return null; if (!raw || raw.length > 512) throw Error('AI_RESULT_UNKNOWN');
    return parse(JSON.parse(raw));
  }, write(value: T) {
    if (!storage || storage.getItem(key) !== null) throw Error('AI_RESULT_UNKNOWN');
    const encoded = JSON.stringify(parse(value)); storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  }, clearCompleted(expected: T) {
    if (!storage?.removeItem) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
    const raw = storage.getItem(key);
    // The caller has read the original Core commit. A prior partial cleanup
    // can be completed, but another page's newer operation must survive.
    if (raw === null) return;
    if (raw !== JSON.stringify(parse(expected))) throw Error('AI_RESULT_UNKNOWN');
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
  } };
}
type CalendarPreparationApi = {
  preparation(value: { taskId: string; date: string }, signal: AbortSignal): Promise<AiTaskCalendarDraftPreparationResponse>;
  previewPreparation(value: AiTaskCalendarDraftPreparationPreviewInput, signal: AbortSignal): Promise<AiTaskCalendarDraftPreparationPreviewResponse>;
  prepareProposal(value: AiTaskCalendarDraftPrepareInput, signal: AbortSignal): Promise<AiTaskCalendarDraftPreparationOperationResponse>;
  preparationOperation(value: AiTaskCalendarDraftPreparationReference, signal: AbortSignal): Promise<AiTaskCalendarDraftPreparationOperationResponse>;
};
export function createTaskCalendarDraftPreparationSession(input: { taskId: string; tenantId: string; workspaceId: string;
  current(): boolean; changed(): void; api: CalendarPreparationApi;
  store: ReturnType<typeof calendarPreparationStore<AiTaskCalendarDraftPreparationReference>> }) {
  let active = true, request: AbortController | null = null;
  let view: { preparation: AiTaskCalendarDraftPreparationResponse | null; targetId: string | null;
    values: AiTaskCalendarDraftPreparationPreviewInput['values'] | null; preview: AiTaskCalendarDraftPreparationPreviewResponse | null;
    pending: AiTaskCalendarDraftPreparationReference | null; operation: AiTaskCalendarDraftPreparationOperationResponse | null;
    invalid: boolean; busy: 'read' | 'preview' | 'prepare' | 'operation' | null; error: unknown } = {
    preparation: null, targetId: null, values: null, preview: null, pending: null, operation: null, invalid: false, busy: null, error: null };
  const check = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (next: Partial<typeof view>) => { if (active && input.current()) { view = { ...view, ...next }; input.changed(); } };
  const restore = () => {
    if (view.invalid) return;
    try { const pending = input.store.read();
      if (pending && pending.taskId !== input.taskId || view.pending && (!pending || pending.operationKey !== view.pending.operationKey)) { view = { ...view, invalid: true }; return; }
      view = { ...view, pending, invalid: false };
    } catch { view = { ...view, invalid: true }; }
  };
  restore();
  const scope = (value: { tenantId: string; workspaceId: string }) => {
    if (value.tenantId !== input.tenantId || value.workspaceId !== input.workspaceId) throw Error('AI_SCOPE_CHANGED');
  };
  const run = async (kind: NonNullable<typeof view.busy>, work: (signal: AbortSignal) => Promise<void>) => {
    check(); if (request) throw Error('AI_OPERATION_BUSY'); const controller = new AbortController(); request = controller;
    publish({ busy: kind, error: null });
    try { await work(controller.signal); check(controller.signal); }
    catch (error) { if (!controller.signal.aborted) publish({ preview: null, error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: null }); } }
  };
  const observe = (value: AiTaskCalendarDraftPreparationOperationResponse, reference: AiTaskCalendarDraftPreparationReference) => {
    scope(value.scope); if (value.reference.taskId !== input.taskId || value.reference.operationKey !== reference.operationKey) throw Error('AI_SCOPE_CHANGED');
    publish({ operation: value, preview: null });
  };
  return Object.freeze({ get view() { return view; },
    async read(date: string) { check(); restore(); if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN');
      return run('read', async signal => { publish({ preparation: null, targetId: null, values: null, preview: null });
        const value = await input.api.preparation({ taskId: input.taskId, date }, signal); check(signal); scope(value.scope);
        if (value.taskId !== input.taskId || value.date !== date) throw Error('AI_SCOPE_CHANGED'); restore();
        if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); publish({ preparation: value }); });
    },
    select(targetId: string) { check(); if (view.busy || view.pending || view.invalid) throw Error('AI_OPERATION_BUSY');
      const target = view.preparation?.targets.find(row => row.id === targetId); if (!target) throw Error('AI_RESOURCE_UNAVAILABLE');
      publish({ targetId, values: structuredClone(target.values), preview: null, error: null });
    },
    edit(field: 'name' | 'businessStatus', value: string) { check(); if (view.busy || view.pending || view.invalid || !view.values) throw Error('AI_OPERATION_BUSY');
      if (field === 'businessStatus' && view.values.businessStatus === undefined) throw Error('AI_RESOURCE_UNAVAILABLE');
      publish({ values: { ...view.values, [field]: value } as typeof view.values, preview: null });
    },
    async preview() { check(); const target = view.preparation?.targets.find(row => row.id === view.targetId), values = view.values && structuredClone(view.values);
      if (!target || !values || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('preview', async signal => { const value = await input.api.previewPreparation({ taskId: input.taskId, date: target.date,
        targetId: target.id, version: target.version, revision: target.revision, values }, signal); check(signal); scope(value.scope);
        if (value.taskId !== input.taskId || value.target.id !== target.id || value.target.version !== target.version
          || value.target.revision !== target.revision || value.target.date !== target.date || JSON.stringify(value.values) !== JSON.stringify(values)) throw Error('AI_REVISION_CONFLICT');
        publish({ preview: value }); });
    },
    async prepare(operationKey: string) { check(); const preview = view.preview; restore(); if (!preview || preview.status !== 'difference_ready' || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('prepare', async signal => { const reference = aiTaskCalendarDraftPreparationReference.parse({ taskId: input.taskId, operationKey });
        view = { ...view, pending: reference, preview: null }; input.changed(); input.store.write(reference);
        const saved = input.store.read(); if (!saved || saved.taskId !== reference.taskId || saved.operationKey !== operationKey) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
        check(signal); const value = await input.api.prepareProposal({ taskId: input.taskId, date: preview.target.date, targetId: preview.target.id,
          version: preview.target.version, revision: preview.target.revision, values: preview.values, operationKey,
          reviewHash: preview.reviewHash, expiresAt: preview.expiresAt, decision: 'prepare_new_calendar_ai_proposal' }, signal);
        check(signal); observe(value, reference); });
    },
    async operation() { check(); const reference = view.pending; if (!reference) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      return run('operation', async signal => { const value = await input.api.preparationOperation(reference, signal); check(signal); observe(value, reference); });
    },
    activate() { active = true; restore(); input.changed(); },
    clear() { request?.abort(); request = null; view = { ...view, preparation: null, targetId: null, values: null, preview: null, operation: null, busy: null, error: null }; if (active && input.current()) input.changed(); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, preparation: null, targetId: null, values: null, preview: null, operation: null, busy: null, error: null }; }
  });
}
type CalendarEntryApi = { source(value: AiTaskCalendarDraftSourceInput, signal: AbortSignal): Promise<AiTaskCalendarDraftSourceResponse>;
  entry(value: AiTaskCalendarDraftEntryInput, signal: AbortSignal): Promise<AiTaskCalendarDraftEntryResponse>;
  entryOperation(value: AiTaskCalendarDraftEntryReference, signal: AbortSignal): Promise<AiTaskCalendarDraftEntryResponse> };
export function createTaskCalendarSourceEntrySession(input: { tenantId: string; workspaceId: string; current(): boolean; changed(): void;
  api: CalendarEntryApi; store: ReturnType<typeof calendarPreparationStore<AiTaskCalendarDraftEntryReference>> }) {
  let active = true, request: AbortController | null = null;
  let view: { source: AiTaskCalendarDraftSourceResponse | null; selected: string | null; pending: AiTaskCalendarDraftEntryReference | null;
    result: AiTaskCalendarDraftEntryResponse | null; invalid: boolean; busy: boolean; error: unknown } = {
    source: null, selected: null, pending: null, result: null, invalid: false, busy: false, error: null };
  const restore = () => { try { const pending = input.store.read(); if (view.pending && (!pending || pending.operationKey !== view.pending.operationKey)) throw Error('AI_RESULT_UNKNOWN'); view = { ...view, pending }; } catch { view = { ...view, invalid: true }; } };
  const check = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (next: Partial<typeof view>) => { if (active && input.current()) { view = { ...view, ...next }; input.changed(); } };
  const scope = (value: { tenantId: string; workspaceId: string }) => { if (value.tenantId !== input.tenantId || value.workspaceId !== input.workspaceId) throw Error('AI_SCOPE_CHANGED'); };
  restore();
  const run = async (work: (signal: AbortSignal) => Promise<void>) => { check(); if (request) throw Error('AI_OPERATION_BUSY'); const controller = new AbortController(); request = controller; publish({ busy: true, error: null });
    try { await work(controller.signal); check(controller.signal); } catch (error) { if (!controller.signal.aborted) publish({ error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: false }); } } };
  const observe = (value: AiTaskCalendarDraftEntryResponse, key: string) => { scope(value.scope); if (value.reference.operationKey !== key) throw Error('AI_SCOPE_CHANGED'); publish({ result: value }); };
  return Object.freeze({ get view() { return view; },
    async read(date: string) { check(); restore(); if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); return run(async signal => {
      publish({ source: null, selected: null }); const value = await input.api.source({ date }, signal); check(signal); scope(value.scope);
      if (value.date !== date) throw Error('AI_SCOPE_CHANGED'); restore(); if (view.pending || view.invalid) throw Error('AI_RESULT_UNKNOWN'); publish({ source: value }); }); },
    select(id: string) { check(); if (view.busy || view.pending || view.invalid || !view.source?.targets.some(row => row.id === id)) throw Error('AI_RESOURCE_UNAVAILABLE'); publish({ selected: id }); },
    async create(operationKey: string) { check(); restore(); const target = view.source?.targets.find(row => row.id === view.selected);
      if (!target || view.pending || view.invalid) throw Error('AI_RESOURCE_UNAVAILABLE'); return run(async signal => {
        const reference = aiTaskCalendarDraftEntryReference.parse({ operationKey }); view = { ...view, pending: reference }; input.changed(); input.store.write(reference);
        if (input.store.read()?.operationKey !== operationKey) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); check(signal);
        const value = await input.api.entry({ operationKey, targetId: target.id, version: target.version, date: target.date, revision: target.revision,
          decision: 'create_original_calendar_task' }, signal); check(signal); observe(value, operationKey); }); },
    async operation() { check(); const pending = view.pending; if (!pending) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE'); return run(async signal => {
      const value = await input.api.entryOperation(pending, signal); check(signal); observe(value, pending.operationKey); }); },
    activate() { active = true; restore(); input.changed(); },
    clear() { request?.abort(); request = null; view = { ...view, source: null, selected: null, result: null, error: null, busy: false }; if (active && input.current()) input.changed(); },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, source: null, selected: null, result: null, error: null, busy: false }; }
  });
}
