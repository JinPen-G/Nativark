/** Human selection and original-name confirmation. Preserve only original ids
 * before either mutation. Unknown is observed only; scope/hide drops facts and
 * interrupts late delivery. Names, hashes and credentials never enter storage. */
import { z } from 'zod';
import { aiMemberNameLocator, type AiMemberNameQuery, type AiMemberNameLocator, type AiMemberNameSelection,
  type AiMemberNamePrepareInput, type AiMemberNameExecuteInput, type AiMemberNameResponse } from '@rental-os/shared';
export interface MemberNameApi {
  availability(signal: AbortSignal): Promise<AiMemberNameResponse>;
  discover(query: AiMemberNameQuery, signal: AbortSignal): Promise<AiMemberNameResponse>;
  inspect(value: AiMemberNameSelection, signal: AbortSignal): Promise<AiMemberNameResponse>;
  prepare(value: AiMemberNamePrepareInput, signal: AbortSignal): Promise<AiMemberNameResponse>;
  read(locator: AiMemberNameLocator, signal: AbortSignal): Promise<AiMemberNameResponse>;
  execute(value: AiMemberNameExecuteInput, signal: AbortSignal): Promise<AiMemberNameResponse>;
}
const pendingSchema = z.object({ locator: aiMemberNameLocator, operation: z.enum(['prepare', 'execute']) }).strict();
type Pending = z.infer<typeof pendingSchema>;
export interface MemberNameStore { read(): Pending | null; write(value: Pending): void; clear(expected: Pending): void; }
export function memberNameStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): MemberNameStore {
  return { read() { const raw = storage?.getItem(key); if (raw === undefined || raw === null) return null;
    if (!raw || raw.length > 512) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
    try { return pendingSchema.parse(JSON.parse(raw)); } catch { throw Error('AI_OPERATION_LOCATOR_DAMAGED'); } },
    write(value) { if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      // Another tab may have persisted an unknown request after this session
      // opened. Preserve it, including damaged or equal-looking records.
      if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      const encoded = JSON.stringify(pendingSchema.parse(value));
      storage.setItem(key, encoded); if (storage.getItem(key) !== encoded) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED'); },
    clear(expected) {
      if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      const current = storage.getItem(key);
      if (current === null) return;
      if (current !== JSON.stringify(pendingSchema.parse(expected))) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw Error('AI_OPERATION_LOCATOR_UNCONFIRMED');
    } };
}
const same = (a: AiMemberNameLocator, b: AiMemberNameLocator | null) => a.customerId === b?.customerId && a.requestKey === b.requestKey;
export function createMemberNameSession(input: { tenantId: string; current(): boolean; api: MemberNameApi; store: MemberNameStore; changed(): void }) {
  let active = true, request: AbortController | null = null;
  let pending: Pending | null = null, damaged = false, initialError: unknown = null;
  try { pending = input.store.read(); } catch (error) { damaged = true; initialError = error; }
  let view: { frame: AiMemberNameResponse | null; pending: Pending | null; busy: string | null; error: unknown; locatorDamaged: boolean } = {
    frame: null, pending, busy: null, error: initialError, locatorDamaged: damaged };
  let query: AiMemberNameQuery | null = null;
  const assert = () => { if (!active || !input.current()) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (next: Partial<typeof view>) => { if (!active || !input.current()) return; view = { ...view, ...next }; input.changed(); };
  const run = async (action: string, work: (signal: AbortSignal) => Promise<AiMemberNameResponse>, expected?: AiMemberNameLocator) => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: action, error: null });
    try { const frame = await work(owner.signal); assert(); if (owner.signal.aborted || frame.scope.tenantId !== input.tenantId
      || expected && !same(expected, frame.locator)) throw Error('AI_SCOPE_CHANGED'); publish({ frame }); return frame; }
    catch (error) { publish({ error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  const preserve = (value: Pending) => {
    try { input.store.write(value); publish({ pending: value }); }
    catch (error) {
      try { const original = input.store.read(); publish(original ? { pending: original } : { locatorDamaged: true }); }
      catch { publish({ locatorDamaged: true }); }
      throw error;
    }
  };
  const complete = () => {
    // An old successful receipt cannot clear a newer request from another tab.
    // Pure history reads own no pending journal and therefore remove nothing.
    if (view.pending) input.store.clear(view.pending);
    publish({ pending: null });
  };
  return Object.freeze({ get view() { return view; },
    availability() { return run('availability', signal => input.api.availability(signal)); },
    discover(value: AiMemberNameQuery) {
      assert(); if (view.pending || view.locatorDamaged) throw Error('AI_RESULT_UNKNOWN'); query = structuredClone(value);
      return run('discover', signal => input.api.discover(value, signal));
    },
    inspect(customerId: string, name: string, requestKey: string) {
      assert(); if (view.pending || view.locatorDamaged || !query || !view.frame?.selectionHash
        || !view.frame.candidates.some(row => row.customerId === customerId)) throw Error('AI_RESOURCE_UNAVAILABLE');
      const locator = { customerId, requestKey }, value = { ...locator, query: structuredClone(query), name, selectionHash: view.frame.selectionHash };
      return run('inspect', signal => input.api.inspect(value, signal), locator);
    },
    prepare() {
      assert(); const review = view.frame?.review;
      if (view.pending || view.locatorDamaged || !review || view.frame?.phase !== 'difference_ready') throw Error('AI_RESOURCE_UNAVAILABLE');
      const locator = { customerId: review.intent.customerId, requestKey: review.intent.requestKey };
      return run('prepare', async signal => {
        preserve({ locator, operation: 'prepare' });
        const frame = await input.api.prepare({ intent: review.intent, reviewHash: review.reviewHash, decision: 'prepare_original_member_name_review' }, signal);
        if (frame.phase === 'difference_stale_not_saved') { assert(); if (!same(locator, frame.locator)) throw Error('AI_SCOPE_CHANGED'); complete(); return frame; }
        assert(); if (!same(locator, frame.locator) || !['waiting_confirmation', 'completed'].includes(frame.phase)) throw Error('AI_RESULT_UNKNOWN');
        complete(); return frame;
      }, locator);
    },
    execute() {
      assert(); const frame = view.frame, locator = frame?.locator;
      if (view.pending || view.locatorDamaged || !locator || !frame?.task?.confirmationHash || frame.phase !== 'waiting_confirmation') throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('execute', async signal => {
        preserve({ locator, operation: 'execute' });
        const result = await input.api.execute({ locator, confirmationHash: frame.task!.confirmationHash!, decision: 'approve_and_execute_original_member_name' }, signal);
        assert(); if (!same(locator, result.locator) || !result.operation || result.phase !== 'completed') throw Error('AI_RESULT_UNKNOWN');
        complete(); return result;
      }, locator);
    },
    read() {
      assert(); const pending = view.pending, locator = pending?.locator ?? view.frame?.locator;
      if (!locator) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('read', async signal => {
        const result = await input.api.read(locator, signal); assert();
        if (!same(locator, result.locator)) throw Error('AI_SCOPE_CHANGED');
        // Positive original preparation/completion can close that operation.
        // Absence, expiry or an existing approval cannot clear unknown execute.
        if (result.operation || pending?.operation === 'prepare' && result.phase === 'waiting_confirmation') complete();
        return result;
      }, locator);
    },
    resetDraft() { assert(); if (view.pending || view.locatorDamaged || view.frame?.task && !view.frame.operation) throw Error('AI_RESULT_UNKNOWN');
      query = null; publish({ frame: view.frame ? { ...view.frame, phase: 'availability', locator: null, candidates: [],
        truncated: false, nextCursor: null, selectionHash: null, review: null, change: null, task: null, operation: null } : null, error: null }); },
    dispose() { active = false; request?.abort(); request = null; query = null; view = { ...view, frame: null, busy: null, error: null }; }
  });
}
