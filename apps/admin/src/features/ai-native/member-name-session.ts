/** Human selection and original-name confirmation. Preserve only original ids
 * before either mutation. Unknown is observed only; scope/hide drops facts and
 * interrupts late delivery. Names, hashes and credentials never enter storage. */
import { z } from 'zod';
import { aiMemberNameLocator, aiMemberNameResponse, type AiMemberNameQuery, type AiMemberNameLocator, type AiMemberNameSelection,
  type AiMemberNamePrepareInput, type AiMemberNameExecuteInput, type AiMemberNameResponse,
  type AiMemberNameStartReviewInput } from '@rental-os/shared';
export interface MemberNameApi {
  availability(signal: AbortSignal): Promise<AiMemberNameResponse>;
  discover(query: AiMemberNameQuery, signal: AbortSignal): Promise<AiMemberNameResponse>;
  inspect(value: AiMemberNameSelection, signal: AbortSignal): Promise<AiMemberNameResponse>;
  prepare(value: AiMemberNamePrepareInput, signal: AbortSignal): Promise<AiMemberNameResponse>;
  read(locator: AiMemberNameLocator, signal: AbortSignal): Promise<AiMemberNameResponse>;
  execute(value: AiMemberNameExecuteInput, signal: AbortSignal): Promise<AiMemberNameResponse>;
  startReview(value: AiMemberNameStartReviewInput, signal: AbortSignal): Promise<AiMemberNameResponse>;
}
const pendingSchema = z.object({ locator: aiMemberNameLocator,
  operation: z.enum(['prepare', 'execute', 'read_reconfirmed', 'start_review']) }).strict();
type Pending = z.infer<typeof pendingSchema>;
export interface MemberNameStore { read(): Pending | null; write(value: Pending, expected?: Pending | null): void; clear(expected: Pending): void; }
export function memberNameStore(key: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): MemberNameStore {
  return { read() { const raw = storage?.getItem(key); if (raw === undefined || raw === null) return null;
    if (!raw || raw.length > 512) throw Error('AI_OPERATION_LOCATOR_DAMAGED');
    try { return pendingSchema.parse(JSON.parse(raw)); } catch { throw Error('AI_OPERATION_LOCATOR_DAMAGED'); } },
    write(value, expected = null) { if (!storage) throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      // Another tab may have persisted an unknown request after this session
      // opened. Preserve it, including damaged or equal-looking records.
      if (storage.getItem(key) !== (expected ? JSON.stringify(pendingSchema.parse(expected)) : null))
        throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
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
export const sameMemberNameLocator = (a: AiMemberNameLocator, b: AiMemberNameLocator | null) =>
  a.customerId === b?.customerId && a.requestKey === b.requestKey && a.kind === b.kind;
const same = sameMemberNameLocator;
export function createMemberNameSession(input: { tenantId: string; current(): boolean; writesAllowed?(): boolean;
  api: MemberNameApi; store: MemberNameStore; changed(): void }) {
  let active = true, request: AbortController | null = null;
  let pending: Pending | null = null, damaged = false, initialError: unknown = null;
  try { pending = input.store.read(); } catch (error) { damaged = true; initialError = error; }
  let view: { frame: AiMemberNameResponse | null; locator: AiMemberNameLocator | null; pending: Pending | null;
    busy: string | null; error: unknown; locatorDamaged: boolean } = {
    frame: null, locator: pending?.locator ?? null, pending, busy: null, error: initialError, locatorDamaged: damaged };
  let query: AiMemberNameQuery | null = null;
  const assert = (signal?: AbortSignal) => { if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const assertWrite = (signal?: AbortSignal) => { assert(signal); if (input.writesAllowed?.() === false) throw Error('AI_RESULT_UNKNOWN'); };
  const publish = (next: Partial<typeof view>) => { if (!active || !input.current()) return; view = { ...view, ...next }; input.changed(); };
  const run = async (action: string, work: (signal: AbortSignal) => Promise<AiMemberNameResponse>, expected?: AiMemberNameLocator) => {
    assert(); if (request || view.busy) throw Error('AI_OPERATION_BUSY'); const owner = new AbortController(); request = owner;
    publish({ busy: action, error: null });
    try { const frame = aiMemberNameResponse.parse(structuredClone(await work(owner.signal))); assert(owner.signal); if (frame.scope.tenantId !== input.tenantId
      || expected && !same(expected, frame.locator)) throw Error('AI_SCOPE_CHANGED');
      publish({ frame, ...(frame.locator ? { locator: frame.locator } : {}) }); return frame; }
    catch (error) { if (request === owner && !owner.signal.aborted) publish({ frame: null, error }); throw error; }
    finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  const preserve = (value: Pending) => {
    const original = pendingSchema.parse(structuredClone(value));
    try { input.store.write(original, pending); pending = original; publish({ pending: original }); }
    catch (error) {
      // A different tab's journal cannot replace this page's delegated
      // operation. Keep our original reference readable and stop new writes.
      pending ??= original;
      damaged = true; publish({ pending, locator: pending.locator, locatorDamaged: true });
      throw error;
    }
  };
  const complete = () => {
    // An old successful receipt cannot clear a newer request from another tab.
    // Pure history reads own no pending journal and therefore remove nothing.
    if (pending) input.store.clear(pending);
    pending = null; publish({ pending: null });
  };
  const held = () => {
    try {
      const stored = input.store.read();
      if (stored && (!pending || !same(stored.locator, pending.locator) || stored.operation !== pending.operation)
        || !stored && pending) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
    } catch { damaged = true; publish({ locatorDamaged: true }); }
  };
  const startable = (frame: AiMemberNameResponse | null) => !!frame?.locator && !!frame.change && !frame.operation
    && !!pending && same(pending.locator, frame.locator) && ['prepare', 'read_reconfirmed', 'start_review'].includes(pending.operation)
    && (frame.phase === 'task_created' && frame.task?.status === 'queued' && frame.task.revision === 1
      || pending.operation === 'read_reconfirmed' && frame.locator.kind === 'reconfirmed' && frame.phase === 'prepared' && !frame.task);
  return Object.freeze({ get view() { return { ...view, canStartReview: !request && !view.busy && !view.locatorDamaged && startable(view.frame) }; },
    availability() { return run('availability', signal => input.api.availability(signal)); },
    discover(value: AiMemberNameQuery) {
      assertWrite(); if (view.pending || view.locatorDamaged || view.frame?.task && !view.frame.operation) throw Error('AI_RESULT_UNKNOWN'); query = structuredClone(value);
      return run('discover', signal => input.api.discover(value, signal));
    },
    inspect(customerId: string, name: string, requestKey: string) {
      assertWrite(); if (view.pending || view.locatorDamaged || !query || !view.frame?.selectionHash
        || !view.frame.candidates.some(row => row.customerId === customerId)) throw Error('AI_RESOURCE_UNAVAILABLE');
      const locator = { customerId, requestKey }, value = { ...locator, query: structuredClone(query), name, selectionHash: view.frame.selectionHash };
      return run('inspect', signal => input.api.inspect(value, signal), locator);
    },
    prepare() {
      assertWrite(); const review = view.frame?.review && structuredClone(view.frame.review);
      if (view.pending || view.locatorDamaged || !review || view.frame?.phase !== 'difference_ready') throw Error('AI_RESOURCE_UNAVAILABLE');
      const locator = { customerId: review.intent.customerId, requestKey: review.intent.requestKey };
      return run('prepare', async signal => {
        preserve({ locator, operation: 'prepare' });
        assertWrite(signal);
        const frame = aiMemberNameResponse.parse(structuredClone(await input.api.prepare({ intent: review.intent, reviewHash: review.reviewHash,
          decision: 'prepare_original_member_name_review' }, signal)));
        assert(signal); if (frame.scope.tenantId !== input.tenantId) throw Error('AI_SCOPE_CHANGED');
        if (frame.phase === 'difference_stale_not_saved') { if (!same(locator, frame.locator)) throw Error('AI_SCOPE_CHANGED'); complete(); return frame; }
        if (!same(locator, frame.locator) || !['waiting_confirmation', 'completed'].includes(frame.phase)) throw Error('AI_RESULT_UNKNOWN');
        complete(); return frame;
      }, locator);
    },
    execute() {
      assertWrite(); const frame = view.frame && structuredClone(view.frame), locator = frame?.locator;
      if (view.pending || view.locatorDamaged || !locator || !frame?.task?.confirmationHash || frame.phase !== 'waiting_confirmation') throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('execute', async signal => {
        preserve({ locator, operation: 'execute' });
        assertWrite(signal);
        const result = aiMemberNameResponse.parse(structuredClone(await input.api.execute({ locator, confirmationHash: frame.task!.confirmationHash!,
          decision: 'approve_and_execute_original_member_name' }, signal)));
        assert(signal); if (result.scope.tenantId !== input.tenantId || !same(locator, result.locator) || !result.operation || result.phase !== 'completed') throw Error('AI_RESULT_UNKNOWN');
        complete(); return result;
      }, locator);
    },
    attachReconfirmed(frame: AiMemberNameResponse, signal: AbortSignal) {
      assert(signal);
      if (request) throw Error('AI_OPERATION_BUSY');
      const found = aiMemberNameResponse.parse(structuredClone(frame)), link = found.reconfirmation;
      if (found.scope.tenantId !== input.tenantId || !link || link.preparation !== 'prepared'
        || !link.newLocator || link.newLocator.kind !== 'reconfirmed' || !same(link.newLocator, found.locator)
        || !found.change || link.originalLocator.customerId !== link.newLocator.customerId
        || same(link.originalLocator, link.newLocator) || found.phase === 'not_observed') throw Error('AI_SCOPE_CHANGED');
      if (pending && !same(pending.locator, link.originalLocator) && !same(pending.locator, link.newLocator))
        throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS');
      // The original domain's acknowledged replacement retains its old source
      // in the reconfirmation journal. Attachment never creates or starts.
      if (!pending || !same(pending.locator, link.newLocator))
        preserve({ locator: link.newLocator, operation: 'read_reconfirmed' });
      if (pending?.operation === 'read_reconfirmed' && (found.operation || found.phase === 'waiting_confirmation')) complete();
      publish({ frame: found, locator: found.locator, error: null });
    },
    startReview() {
      assertWrite(); const frame = view.frame && structuredClone(view.frame), locator = frame?.locator;
      if (!locator || view.locatorDamaged || !startable(frame)) throw Error('AI_RESULT_UNKNOWN');
      return run('start_review', async signal => {
        // A positive queued creation receipt can precede an unsent start.
        // Re-read it after the human intent; the server independently proves
        // no lease, execution traces or effects before admitting the start.
        const current = aiMemberNameResponse.parse(structuredClone(await input.api.read(locator, signal))); assertWrite(signal);
        if (current.scope.tenantId !== input.tenantId || !same(locator, current.locator)) throw Error('AI_SCOPE_CHANGED');
        if (current.operation || current.phase === 'waiting_confirmation') { complete(); return current; }
        if (!startable(current)) throw Error('AI_RESULT_UNKNOWN');
        preserve({ locator, operation: 'start_review' }); assertWrite(signal);
        const result = aiMemberNameResponse.parse(structuredClone(await input.api.startReview({ locator,
          decision: 'start_original_member_name_review' }, signal))); assert(signal);
        if (result.scope.tenantId !== input.tenantId || !same(locator, result.locator)) throw Error('AI_SCOPE_CHANGED');
        if (!result.operation && result.phase !== 'waiting_confirmation') throw Error('AI_RESULT_UNKNOWN');
        complete(); return result;
      }, locator);
    },
    read(reference?: AiMemberNameLocator) {
      assert(); const pending = view.pending, locator = reference ? aiMemberNameLocator.parse(structuredClone(reference))
        : pending?.locator ?? view.locator;
      if (!locator || pending && !same(pending.locator, locator) || view.locator && !same(view.locator, locator))
        throw Error('AI_RESOURCE_UNAVAILABLE');
      publish({ locator });
      return run('read', async signal => {
        held();
        const result = aiMemberNameResponse.parse(structuredClone(await input.api.read(locator, signal))); assert(signal);
        if (result.scope.tenantId !== input.tenantId || !same(locator, result.locator)) throw Error('AI_SCOPE_CHANGED');
        held();
        // Positive original preparation/completion can close that operation.
        // Absence, expiry or an existing approval cannot clear unknown execute.
        if (!damaged && (result.operation || pending && pending.operation !== 'execute' && result.phase === 'waiting_confirmation')) complete();
        return result;
      }, locator);
    },
    resetDraft() { assertWrite(); if (view.pending || view.locatorDamaged || view.frame?.task && !view.frame.operation) throw Error('AI_RESULT_UNKNOWN');
      query = null; publish({ locator: null, frame: view.frame ? { ...view.frame, phase: 'availability', locator: null, candidates: [],
        truncated: false, nextCursor: null, selectionHash: null, review: null, change: null, task: null, operation: null,
        reconfirmation: undefined } : null, error: null }); },
    dispose() { active = false; request?.abort(); request = null; query = null; view = { ...view, frame: null, busy: null, error: null }; }
  });
}
