/** Request driver for the original domain's human reconfirmation services.
 * Only explicit prepare creates a replacement change. Reopening observes the
 * same original receipt; attachment delegates to the existing review workflow. */
import type { OriginalReconfirmationJournal, OriginalReconfirmationStore } from './original-reconfirmation-journal';

export type OriginalReconfirmationPort<Reference, Current, Values, Review, Prepared> = {
  read(original: Reference, signal: AbortSignal): Promise<{ current: Current; prepared: Prepared | null }>;
  review(original: Reference, values: Values, signal: AbortSignal): Promise<Review>;
  prepare(original: Reference, review: Review, signal: AbortSignal): Promise<Prepared>;
  replacement(prepared: Prepared): Reference;
  revalidateReview(review: Review): void;
  /** Reads/adopts the acknowledged reference in the original workflow only.
   * Creating/starting a Task remains a later explicit command of that host. */
  attach(prepared: Prepared, signal: AbortSignal): Promise<void>;
  completed(reference: Reference, signal: AbortSignal): Promise<boolean>;
};

export function createOriginalReconfirmationSession<Reference, Current, Values, Review, Prepared>(input: {
  current(): boolean;
  changed(): void;
  same(left: Reference, right: Reference): boolean;
  store: OriginalReconfirmationStore<Reference>;
  port: OriginalReconfirmationPort<Reference, Current, Values, Review, Prepared>;
}) {
  let active = true, request: AbortController | null = null;
  let journal: OriginalReconfirmationJournal<Reference> | null = null, damaged = false;
  try { journal = input.store.read(); } catch { damaged = true; }
  let view: {
    journal: OriginalReconfirmationJournal<Reference> | null;
    current: Current | null;
    review: Review | null;
    prepared: Prepared | null;
    damaged: boolean;
    busy: 'read' | 'review' | 'prepare' | 'attach' | null;
    error: unknown;
  } = { journal, current: null, review: null, prepared: null, damaged, busy: null, error: null };
  const assert = (signal?: AbortSignal) => {
    if (!active || !input.current() || signal?.aborted) throw Error('AI_SCOPE_CHANGED');
  };
  const publish = (update: Partial<typeof view>) => {
    if (active && input.current()) { view = { ...view, ...update }; input.changed(); }
  };
  const sameJournal = (left: typeof journal, right: typeof journal) => left === null || right === null
    ? left === right : left.phase === right.phase && input.same(left.original, right.original)
      && (left.replacement === null || right.replacement === null ? left.replacement === right.replacement
        : input.same(left.replacement, right.replacement));
  const held = (readOnly = false) => {
    assert();
    try { if (damaged || !sameJournal(input.store.read(), journal)) throw Error('AI_OPERATION_LOCATOR_ALREADY_EXISTS'); }
    catch (error) {
      damaged = true; publish({ damaged: true, current: null, review: null, prepared: null });
      if (!readOnly || !journal) throw error;
    }
  };
  const persist = (next: NonNullable<typeof journal>) => {
    held();
    try { input.store.write(next, journal); journal = structuredClone(next); publish({ journal }); }
    catch (error) { damaged = true; publish({ damaged: true, current: null, review: null, prepared: null }); throw error; }
  };
  const run = async <T>(busy: NonNullable<typeof view.busy>, work: (signal: AbortSignal) => Promise<T>) => {
    assert(); if (request) throw Error('AI_OPERATION_BUSY');
    const owner = new AbortController(); request = owner; publish({ busy, error: null });
    try { const value = await work(owner.signal); assert(owner.signal); return value; }
    catch (error) {
      if (request === owner && !owner.signal.aborted) publish({ current: null, review: null, prepared: null, error });
      throw error;
    } finally { if (request === owner) { request = null; publish({ busy: null }); } }
  };
  const observe = async (signal: AbortSignal) => {
    held(true); if (!journal) throw Error('AI_RESOURCE_UNAVAILABLE');
    const original = structuredClone(journal.original), observed = await input.port.read(original, signal);
    assert(signal); held(true);
    if (!observed.prepared) {
      // Absence leaves a delegated prepare/attach unresolved. It cannot clear
      // the journal or authorize a new request with another key.
      if (journal.phase !== 'read_original') throw Error('AI_RESULT_UNKNOWN');
      publish({ current: observed.current, review: null, prepared: null }); return observed;
    }
    const replacement = input.port.replacement(observed.prepared);
    if (input.same(original, replacement) || journal.replacement && !input.same(journal.replacement, replacement))
      throw Error('AI_SCOPE_CHANGED');
    if (!damaged && (journal.phase === 'read_original' || journal.phase === 'prepare')) {
      persist({ original, replacement, phase: 'prepared' });
    }
    publish({ current: observed.current, review: null, prepared: observed.prepared }); return observed;
  };
  return Object.freeze({ get view() { return view; },
    read(original?: Reference) {
      return run('read', async signal => {
        held(!!journal);
        if (!journal) {
          if (!original) throw Error('AI_RESOURCE_UNAVAILABLE');
          persist({ original: structuredClone(original), replacement: null, phase: 'read_original' });
        } else if (original && !input.same(original, journal.original)) throw Error('AI_RESULT_UNKNOWN');
        publish({ current: null, review: null, prepared: null });
        return observe(signal);
      });
    },
    review(values: Values) {
      return run('review', async signal => {
        held(); if (!journal || journal.phase !== 'read_original' || !view.current || view.prepared)
          throw Error('AI_RESULT_UNKNOWN');
        publish({ review: null });
        const review = await input.port.review(structuredClone(journal.original), structuredClone(values), signal);
        assert(signal); held(); input.port.revalidateReview(review); publish({ review }); return review;
      });
    },
    prepare() {
      return run('prepare', async signal => {
        held(); const review = view.review;
        if (!journal || journal.phase !== 'read_original' || !review || view.prepared) throw Error('AI_RESULT_UNKNOWN');
        input.port.revalidateReview(review);
        const original = structuredClone(journal.original);
        // Persist before delegating and never resend this phase after a lost ACK.
        persist({ original, replacement: null, phase: 'prepare' }); publish({ review: null }); assert(signal);
        const prepared = await input.port.prepare(original, structuredClone(review), signal);
        assert(signal); held();
        const replacement = input.port.replacement(prepared);
        if (input.same(original, replacement)) throw Error('AI_SCOPE_CHANGED');
        persist({ original, replacement, phase: 'prepared' }); publish({ prepared }); return prepared;
      });
    },
    attach() {
      return run('attach', async signal => {
        held();
        const observed = await observe(signal);
        if (!journal || !observed.prepared || !journal.replacement) throw Error('AI_RESULT_UNKNOWN');
        // Attachment only gives the acknowledged change to the original
        // workflow. A lost attachment ACK is reconciled by its own journal.
        const original = structuredClone(journal.original), replacement = structuredClone(journal.replacement);
        persist({ original, replacement, phase: 'handoff' }); assert(signal);
        await input.port.attach(observed.prepared, signal); assert(signal); held();
        persist({ original, replacement, phase: 'attached' });
      });
    },
    followReplacement() {
      return run('read', async signal => {
        held();
        if (!journal || journal.phase !== 'attached' || !journal.replacement) throw Error('AI_RESULT_UNKNOWN');
        await observe(signal); assert(signal); held();
        const original = structuredClone(journal.replacement!);
        const observed = await input.port.read(original, signal); assert(signal); held();
        // A later human review follows only an acknowledged server reference.
        // It claims no closure; preparation still proves that independently.
        persist({ original, replacement: null, phase: 'read_original' });
        if (observed.prepared) {
          const replacement = input.port.replacement(observed.prepared);
          if (input.same(original, replacement)) throw Error('AI_SCOPE_CHANGED');
          persist({ original, replacement, phase: 'prepared' });
        }
        publish({ current: observed.current, review: null, prepared: observed.prepared });
      });
    },
    finish() {
      return run('read', async signal => {
        held();
        if (!journal || !journal.replacement || !['handoff', 'attached'].includes(journal.phase))
          throw Error('AI_RESULT_UNKNOWN');
        const completed = await input.port.completed(structuredClone(journal.replacement), signal);
        assert(signal); held();
        if (completed !== true) throw Error('AI_RESULT_UNKNOWN');
        input.store.clear(journal); journal = null;
        publish({ journal: null, current: null, review: null, prepared: null, error: null });
      });
    },
    clearReview() { assert(); if (request) throw Error('AI_OPERATION_BUSY'); publish({ review: null }); },
    clear() {
      request?.abort(); request = null;
      view = { ...view, current: null, review: null, prepared: null, busy: null, error: null };
      if (active && input.current()) input.changed();
    },
    dispose() { active = false; request?.abort(); request = null; view = { ...view, current: null, review: null, prepared: null, busy: null, error: null }; }
  });
}
