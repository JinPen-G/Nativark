/** Read-call lifecycle over ORIGINAL persistent goal accounting, not a ledger.
 * The required source resolves the trusted target/binding and atomically persists
 * calls/active/concurrency admission before returning. No local quota, refund,
 * goal creation, client-selected goal or replay is implemented by this adapter. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson } from "./json-snapshot.js";
import type { McpReadAccounting, McpReadAuthorization } from "./read-tools.js";
export interface OriginalMcpReadCallRef {
  callId: string; authorization: McpReadAuthorization; toolName: string; inputHash: string;
}
/** Metadata-only binding for stored reservation validation, not an authority.
 * Historical Web readers use original grant identity, never a fabricated token. */
export type OriginalMcpReadReservationBinding = Pick<OriginalMcpReadCallRef, "callId" | "inputHash"> & {
  authorization: Pick<McpReadAuthorization, "subject" | "clientId" | "resource" | "scopes">;
};
export interface OriginalMcpReadReservation {
  state: "reserved"; callId: string; goalId: string; goalRevision: number; grantId: string;
  goalBindingHash: string; inputHash: string; subject: string; clientId: string; resource: string; scopes: readonly string[];
  consumedCalls: number; consumedActiveMs: number; reservedActiveMs: number; concurrentReads: number; callAllowanceMs: number;
}
export interface OriginalPersistentMcpReadBudget {
  /** Resolve ORIGINAL persistent goal/actor/grant/purpose/input/policy binding,
   * never caller goal IDs or "human" flags. Counts include this attempted call.
   * Persist atomically before returning; uncertain reservation remains held.
   * This port must not reacquire an enclosing business authority's grant locks. */
  reserve(call: OriginalMcpReadCallRef, signal: AbortSignal): Promise<OriginalMcpReadReservation>;
  /** Original durable settlement; calls stay consumed even for failed reads.
   * Complete only from actual server callback settlement/measurement, not abort.
   * Uncertain active/concurrency occupancy stays held; no automatic expiry refund. */
  settle(call: OriginalMcpReadCallRef, reservation: OriginalMcpReadReservation,
    observation: { outcome: "returned" | "failed"; activeMs: number }, signal: AbortSignal): Promise<void>;
  /** Original key only; never refund, restart, create a goal or replay a call.
   * May follow uncertain reserve, ignored cancellation or settlement failure. */
  markUnknown(call: OriginalMcpReadCallRef, signal: AbortSignal): Promise<void>;
}
export class OriginalMcpReadBudgetError extends Error {
  /** Only the original source may classify a confirmed denial/limit before any
   * reservation. All unclassified reserve failures remain potentially committed. */
  constructor(readonly kind: "denied" | "limit" | "unknown") { super("Original persistent read budget " + kind); this.name = "OriginalMcpReadBudgetError"; }
}
const fail = () => new Error("Original persistent read accounting unavailable");
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
/** Shared detached validation for the lifecycle and original persistent store. */
export function captureOriginalMcpReadReservation(raw: unknown, call: OriginalMcpReadReservationBinding): OriginalMcpReadReservation {
  const value = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 16 || row.state !== "reserved" || row.callId !== call.callId
    || typeof row.goalId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.goalId)
    || !integer(row.goalRevision, 1, 2147483647) || typeof row.grantId !== "string" || !row.grantId
    || typeof row.goalBindingHash !== "string" || !/^[a-f0-9]{64}$/.test(row.goalBindingHash)
    || row.inputHash !== call.inputHash || row.subject !== call.authorization.subject || row.clientId !== call.authorization.clientId
    || row.resource !== call.authorization.resource || !isDeepStrictEqual(row.scopes, call.authorization.scopes)
    || !integer(row.consumedCalls, 1, 20) || !integer(row.consumedActiveMs, 0, 300000) || !integer(row.reservedActiveMs, 1, 300000)
    || row.consumedActiveMs + row.reservedActiveMs > 300000 || !integer(row.concurrentReads, 1, 2)
    || !integer(row.callAllowanceMs, 1, 15000) || row.callAllowanceMs > row.reservedActiveMs) throw fail();
  return Object.freeze({ state: "reserved", callId: call.callId, goalId: row.goalId, goalRevision: row.goalRevision, grantId: row.grantId,
    goalBindingHash: row.goalBindingHash, inputHash: call.inputHash, subject: call.authorization.subject, clientId: call.authorization.clientId,
    resource: call.authorization.resource, scopes: Object.freeze([...call.authorization.scopes]), consumedCalls: row.consumedCalls,
    consumedActiveMs: row.consumedActiveMs, reservedActiveMs: row.reservedActiveMs, concurrentReads: row.concurrentReads, callAllowanceMs: row.callAllowanceMs });
}
/** Detached canonical wire input for ORIGINAL server-side goal lookup, never a
 * caller-selected goal or authority. Bounds/hash match the read lifecycle.
 * @param input - ordinary JSON from the validated MCP call, not native handles.
 * @returns a deeply frozen input snapshot and its stable UTF-8 hash. */
export function captureMcpReadInput(input: unknown): { readonly input: unknown; readonly inputHash: string } {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sort(child)])) : value;
  const value = sort(snapshotJson(input, { stringCharacters: 2048, arrayItems: 50 }));
  const inputText = JSON.stringify(value);
  if (Buffer.byteLength(inputText, "utf8") > 32768) throw fail();
  const freeze = (child: unknown): void => {
    if (child && typeof child === "object") { for (const nested of Object.values(child)) freeze(nested); Object.freeze(child); }
  };
  freeze(value);
  return Object.freeze({ input: value, inputHash: createHash("sha256").update(inputText).digest("hex") });
}

/** Bind one required original budget source. Nothing initializes/resets a goal;
 * discovery/Web/passive token verification must never use this business slot. */
export function createPersistentMcpReadAccounting(original: OriginalPersistentMcpReadBudget): McpReadAccounting {
  if (typeof original?.reserve !== "function" || typeof original.settle !== "function" || typeof original.markUnknown !== "function") throw fail();
  const reserve = original.reserve.bind(original), settle = original.settle.bind(original), unknown = original.markUnknown.bind(original);
  interface Invocation {
    active: boolean; entered: boolean; failed: boolean; started: number;
    call: OriginalMcpReadCallRef; signal: AbortSignal; readSignal?: AbortSignal; deadline: AbortController;
    reservation?: OriginalMcpReadReservation; timer?: ReturnType<typeof setTimeout>; work?: Promise<unknown>; finished: boolean;
  }
  // Callback-local ownership only, not a quota or authorization. The source still
  // persists the same original goal/call; rebuild/token rotation cannot reset it.
  const invocations = new AsyncLocalStorage<Invocation>();
  const mark = async (call: OriginalMcpReadCallRef) => {
    try { await unknown(call, new AbortController().signal); } catch { throw fail(); }
  };
  const invokeRead = async <T>(entry: Invocation, consume: (signal?: AbortSignal) => Promise<T>): Promise<T> => {
    const readSignal = entry.readSignal ?? entry.signal;
    try {
      try { entry.reservation = captureOriginalMcpReadReservation(await reserve(entry.call, readSignal), entry.call); }
      catch (error) {
        if (!(error instanceof OriginalMcpReadBudgetError) || error.kind === 'unknown') await mark(entry.call);
        throw fail();
      }
      const remaining = entry.reservation.callAllowanceMs - Math.ceil(performance.now() - entry.started);
      if (readSignal.aborted || remaining < 1) { await mark(entry.call); throw fail(); }
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => entry.deadline.abort(), remaining);
      const value = await consume(readSignal);
      if (!entry.active || readSignal.aborted) throw fail();
      return value; // STILL reserved until the entire original invocation settles.
    } catch { entry.failed = true; throw fail(); }
    finally { entry.finished = true; }
  };
  const standalone = async <T>(authorization: McpReadAuthorization, toolName: string, input: unknown, consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> => {
    if (signal.aborted || typeof consume !== "function") throw fail();
    const captured = captureMcpReadInput(input);
    const call: OriginalMcpReadCallRef = Object.freeze({ callId: randomUUID(), toolName,
      authorization: Object.freeze({ ...authorization, scopes: Object.freeze([...authorization.scopes]) }), inputHash: captured.inputHash });
    const markUnknown = async () => { try { await unknown(call, new AbortController().signal); } catch { throw fail(); } };
    // Reservation is server activity too. Include its elapsed time in the same
    // held allowance; an exhausted allowance must never start the reader.
    const started = performance.now();
    let reservation: OriginalMcpReadReservation;
    try { reservation = captureOriginalMcpReadReservation(await reserve(call, signal), call); }
    catch (error) { if (!(error instanceof OriginalMcpReadBudgetError) || error.kind === "unknown") await markUnknown(); throw fail(); }
    const remainingMs = reservation.callAllowanceMs - Math.ceil(performance.now() - started);
    if (signal.aborted || remainingMs < 1) { await markUnknown(); throw fail(); }
    // This signal belongs to the ORIGINAL reservation, not a fresh 15-second
    // window. Keep the timer through settlement; finally always releases it.
    const deadline = new AbortController(), readSignal = AbortSignal.any([signal, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(), remainingMs);
    try {
      let result!: T, failed = false;
      try { result = await consume(readSignal); } catch { failed = true; }
      const activeMs = Math.max(0, Math.ceil(performance.now() - started));
      // Await actual callback completion even if it ignores abort. Deadline/cancel
      // is not proof of remote stop or rollback; late work retains the original hold.
      if (readSignal.aborted || activeMs >= reservation.callAllowanceMs) { await markUnknown(); throw fail(); }
      try { await settle(call, reservation, { outcome: failed ? "failed" : "returned", activeMs }, readSignal); }
      catch { await markUnknown(); throw fail(); }
      if (readSignal.aborted) { await markUnknown(); throw fail(); }
      if (failed) throw fail();
      return result;
    } finally { clearTimeout(timer); }
  };
  return Object.freeze({
    async withInvocation<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted || typeof consume !== 'function' || invocations.getStore()) throw fail();
      const started = performance.now(), captured = captureMcpReadInput(input);
      const call: OriginalMcpReadCallRef = Object.freeze({ callId: randomUUID(), toolName,
        authorization: Object.freeze({ ...authorization, scopes: Object.freeze([...authorization.scopes]) }), inputHash: captured.inputHash });
      const deadline = new AbortController(), lifetime = new AbortController();
      const entry: Invocation = { active: true, entered: false, failed: false, started, call, deadline,
        signal: AbortSignal.any([signal, deadline.signal, lifetime.signal]), finished: false,
        timer: setTimeout(() => deadline.abort(), Math.max(1, 15000 - Math.ceil(performance.now() - started))) };
      try {
        return await invocations.run(entry, async () => {
          let result!: T;
          try { result = await consume(entry.signal); } catch { entry.failed = true; }
          // A producer returning without awaiting its read cannot release a hold.
          // Await the actual work first; local cancellation is never completion.
          const detached = entry.entered && !entry.finished;
          if (entry.work) { try { await entry.work; } catch { entry.failed = true; } }
          if (!entry.entered || !entry.reservation) throw fail();
          const activeMs = Math.max(0, Math.ceil(performance.now() - started));
          if (detached || entry.signal.aborted || entry.readSignal?.aborted || activeMs >= entry.reservation.callAllowanceMs) {
            await mark(call); throw fail();
          }
          // This is now AFTER owner commit and final schema/publication/usage
          // checks, outside their grant locks. Settlement's own SQL/commit tail
          // remains held/timed, but is NOT included in this pre-write measurement.
          try { await settle(call, entry.reservation, { outcome: entry.failed ? 'failed' : 'returned', activeMs }, entry.signal); }
          catch { await mark(call); throw fail(); }
          if (entry.signal.aborted) { await mark(call); throw fail(); }
          if (entry.failed) throw fail();
          return result;
        });
      } finally { entry.active = false; clearTimeout(entry.timer); lifetime.abort(); }
    },
    withCall<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      const entry = invocations.getStore();
      if (!entry) return standalone(authorization, toolName, input, consume, signal);
      if (!entry.active || entry.entered || signal.aborted || entry.signal.aborted || typeof consume !== 'function'
        || toolName !== entry.call.toolName || captureMcpReadInput(input).inputHash !== entry.call.inputHash
        || !isDeepStrictEqual(snapshotJson(authorization, { stringCharacters: 2048, arrayItems: 32 }), snapshotJson(entry.call.authorization, { stringCharacters: 2048, arrayItems: 32 }))) {
        entry.failed = true; return Promise.reject(fail());
      }
      entry.entered = true;
      entry.readSignal = AbortSignal.any([entry.signal, signal]);
      const work = invokeRead(entry, consume);
      entry.work = work;
      return work;
    },
  });
}
