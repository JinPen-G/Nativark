/** Durable MCP READ metering projection over an ORIGINAL trusted goal, not a
 * business Task, financial ledger or authority. No target IDs/flags from clients,
 * grant locking, expiry refunds, execution/replay, connection or schema creation.
 * Reserve commits before reading; uncertain work retains active/concurrency holds. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOriginalMcpReadReservation, OriginalMcpReadBudgetError } from "./persistent-read-accounting.js";
import type { OriginalMcpReadCallRef, OriginalMcpReadReservation, OriginalMcpReadReservationBinding, OriginalPersistentMcpReadBudget } from "./persistent-read-accounting.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";

export interface OriginalMcpReadTarget {
  goalId: string; goalRevision: number; grantId: string;
  subject: string; clientId: string; resource: string; scopes: readonly string[];
  purpose: string; originalInputHash: string; policyVersion: string;
}
export interface OriginalMcpReadTargetSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Read-only ORIGINAL request/goal association, never derive a fresh goal from a
   * token, connection, Agent, client-selected ID or a claimed human category.
   * Resolve only an already-authorized automatic read; hold/recheck original goal
   * fences in this transaction. An outer business authority holds grant/identity
   * locks: this source MUST NOT reacquire them in this separate transaction.
   * Undefined is a confirmed lack of target; unreadable evidence must throw. */
  resolve(call: OriginalMcpReadCallRef, transaction: Native, signal: AbortSignal): Promise<OriginalMcpReadTarget | undefined>;
}
const fail = () => new Error("Original MCP read budget persistence unavailable");
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail(); };
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const limits = { stringCharacters: 2048, arrayItems: 32 };
const storageLimits = { stringCharacters: 32768, arrayItems: 32 };
function object(raw: unknown, fields: readonly string[], bounds = limits): Record<string, unknown> {
  const value = snapshotJson(raw, bounds);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length) throw fail();
  return snapshotJsonFields(value, fields, bounds);
}
function encoded(value: unknown): string {
  const text = JSON.stringify(value); if (Buffer.byteLength(text, "utf8") > 32768) throw fail(); return text;
}
function json(raw: unknown): unknown {
  if (typeof raw === "string") { if (Buffer.byteLength(raw, "utf8") > 32768) throw fail(); raw = JSON.parse(raw); }
  return snapshotJson(raw, limits);
}
function fixedCall(raw: OriginalMcpReadCallRef): OriginalMcpReadCallRef {
  const row = object(raw, ["callId", "authorization", "toolName", "inputHash"]);
  const a = object(row.authorization, ["subject", "token", "clientId", "scopes", "resource"]);
  if (!id(row.callId) || !digest(row.inputHash) || typeof row.toolName !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(row.toolName)
    || typeof a.subject !== "string" || !a.subject || typeof a.token !== "string" || !a.token || typeof a.clientId !== "string" || !a.clientId
    || typeof a.resource !== "string" || !a.resource || !Array.isArray(a.scopes) || !a.scopes.length
    || a.scopes.some(v => typeof v !== "string" || !v) || new Set(a.scopes).size !== a.scopes.length) throw fail();
  return Object.freeze({ callId: row.callId, inputHash: row.inputHash, toolName: row.toolName,
    authorization: Object.freeze({ subject: a.subject, token: a.token, clientId: a.clientId, resource: a.resource, scopes: Object.freeze([...a.scopes]) as readonly string[] }) });
}
function callHash(call: OriginalMcpReadCallRef): string {
  // Only a digest binds the internal credential. No token enters stored JSON/SQL.
  return hash({ callId: call.callId, toolName: call.toolName, inputHash: call.inputHash, subject: call.authorization.subject,
    clientId: call.authorization.clientId, resource: call.authorization.resource, scopes: call.authorization.scopes,
    credentialHash: createHash("sha256").update(call.authorization.token).digest("hex") });
}
/** Original target metadata validation shared by budgets and persisted associations.
 * With call, additionally compare its current authorization tuple; without call,
 * validate metadata only. Neither mode authorizes a caller target or creates a goal. */
export function captureOriginalMcpReadTarget(raw: unknown, call?: Pick<OriginalMcpReadReservationBinding, "authorization">): OriginalMcpReadTarget {
  const row = object(raw, ["goalId", "goalRevision", "grantId", "subject", "clientId", "resource", "scopes", "purpose", "originalInputHash", "policyVersion"]);
  if (!id(row.goalId) || !id(row.grantId) || !integer(row.goalRevision, 1, 2147483647) || !digest(row.originalInputHash)
    || !id(row.purpose) || !id(row.policyVersion) || typeof row.subject !== "string" || !row.subject
    || typeof row.clientId !== "string" || !row.clientId || typeof row.resource !== "string" || !row.resource
    || !Array.isArray(row.scopes) || !row.scopes.length || row.scopes.length > 32 || new Set(row.scopes).size !== row.scopes.length) throw fail();
  const scopes = row.scopes.map(value => { if (typeof value !== "string" || !value) throw fail(); return value; });
  if (call && (row.subject !== call.authorization.subject || row.clientId !== call.authorization.clientId
    || row.resource !== call.authorization.resource || !isDeepStrictEqual(scopes, call.authorization.scopes))) throw fail();
  return Object.freeze({ goalId: row.goalId, goalRevision: row.goalRevision, grantId: row.grantId,
    subject: row.subject, clientId: row.clientId, resource: row.resource,
    scopes: Object.freeze(scopes), purpose: row.purpose, originalInputHash: row.originalInputHash, policyVersion: row.policyVersion });
}
export interface OriginalMcpReadBudgetSnapshot { goalId: string; bindingHash: string; target: OriginalMcpReadTarget; revision: number;
  consumedCalls: number; consumedActiveMs: number; reservedActiveMs: number; concurrentReads: number }
type Budget = OriginalMcpReadBudgetSnapshot;
export interface OriginalMcpReadCallSnapshot { reservation: OriginalMcpReadReservation;
  callBindingHash: string; state: "reserved" | "unknown" | "returned" | "failed"; activeMs: number | null }
type CallRow = OriginalMcpReadCallSnapshot;
/** Shared ORIGINAL row validation only, not authorization or external field release.
 * Web history uses an independently authorized original grant tuple, not a token. */
export function captureOriginalMcpReadBudgetSnapshot(raw: unknown, key: string,
  authorization: OriginalMcpReadReservationBinding["authorization"]): OriginalMcpReadBudgetSnapshot {
  const r = object(raw, ["goalId", "grantId", "bindingHash", "recordJson", "revision", "consumedCalls", "consumedActiveMs", "reservedActiveMs", "concurrentReads"], storageLimits);
  const target = captureOriginalMcpReadTarget(json(r.recordJson), { authorization });
  if (r.goalId !== key || target.goalId !== key || r.grantId !== target.grantId || r.bindingHash !== hash(target) || !integer(r.revision, 1, 2147483647)
    || !integer(r.consumedCalls, 0, 20) || !integer(r.consumedActiveMs, 0, 300000) || !integer(r.reservedActiveMs, 0, 300000)
    || r.consumedActiveMs + r.reservedActiveMs > 300000 || !integer(r.concurrentReads, 0, 2)
    || (r.concurrentReads === 0) !== (r.reservedActiveMs === 0) || r.concurrentReads > r.consumedCalls) throw fail();
  return Object.freeze({ goalId: key, bindingHash: hash(target), target, revision: r.revision,
    consumedCalls: r.consumedCalls, consumedActiveMs: r.consumedActiveMs, reservedActiveMs: r.reservedActiveMs, concurrentReads: r.concurrentReads });
}
/** Validates stored indices/reservation/state, not possession of its credential.
 * Lifecycle callers MUST separately compare callBindingHash with their original
 * invocation. Web readers instead need independent current ORIGINAL owner access. */
export function captureOriginalMcpReadCallSnapshot(raw: unknown, key: string, budget: OriginalMcpReadBudgetSnapshot): OriginalMcpReadCallSnapshot {
  const r = object(raw, ["callId", "goalId", "grantId", "callBindingHash", "recordJson", "state", "activeMs"], storageLimits);
  const record = json(r.recordJson), inputHash = snapshotJsonFields(record, ["inputHash"], limits).inputHash;
  if (!digest(inputHash)) throw fail();
  const reservation = captureOriginalMcpReadReservation(record, { callId: key, inputHash, authorization: budget.target });
  if (r.callId !== key || r.goalId !== budget.goalId || r.grantId !== budget.target.grantId || !digest(r.callBindingHash)
    || reservation.goalId !== budget.goalId || reservation.goalBindingHash !== budget.bindingHash || reservation.grantId !== budget.target.grantId
    || reservation.goalRevision !== budget.target.goalRevision || reservation.consumedCalls > budget.consumedCalls
    || typeof r.state !== "string" || !["reserved", "unknown", "returned", "failed"].includes(r.state)) throw fail();
  const terminal = r.state === "returned" || r.state === "failed";
  if (terminal ? !integer(r.activeMs, 0, reservation.callAllowanceMs) || r.activeMs > budget.consumedActiveMs
    : r.activeMs !== null || budget.concurrentReads < 1 || budget.reservedActiveMs < reservation.callAllowanceMs) throw fail();
  return Object.freeze({ reservation, callBindingHash: r.callBindingHash, state: r.state as CallRow["state"], activeMs: r.activeMs as number | null });
}

/** Requires provisioned mysql-read-budget-schema.sql and a real target source.
 * One globally unique ORIGINAL goal key owns its counters: no client/token/Run
 * suffix, revision reset or grant replacement. Different binding under the same
 * key rejects. This creates metering metadata only, never the original goal.
 * Lock order is goal -> call, including settlement/unknown; no grant locks here.
 * The lifecycle adapter measures reservation and callback time; settlement and
 * enclosing activity, classification/goal production/reconciliation remain open. */
export function createPrismaMcpReadBudget<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  database: OAuthSqlDatabase<Native>, source: OriginalMcpReadTargetSource<Native>
): OriginalPersistentMcpReadBudget {
  if (typeof database?.$transaction !== "function" || typeof source?.resolve !== "function") throw fail();
  const transaction = database.$transaction.bind(database), resolve = source.resolve.bind(source);
  const within = async <T>(consume: (sql: Native) => Promise<T>, signal: AbortSignal): Promise<T> => {
    live(signal); let entered = false;
    try {
      const result = await transaction(async sql => {
        if (entered) throw fail(); entered = true; live(signal);
        const value = await consume(sql); live(signal); return value;
      }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
      live(signal); return result;
    } catch { throw fail(); } // No automatic retry, including ambiguous commit.
  };
  const rows = (raw: unknown): unknown[] => {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 1) throw fail();
    return snapshotJson(raw, storageLimits) as unknown[];
  };
  const changed = async (count: Promise<number>, signal: AbortSignal) => { if (await count !== 1) throw fail(); live(signal); };
  const readBudget = async (sql: Native, key: string, call: OriginalMcpReadCallRef, signal: AbortSignal): Promise<Budget | undefined> => {
    const found = rows(await sql.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${key} FOR UPDATE`);
    live(signal); if (!found.length) return undefined;
    return captureOriginalMcpReadBudgetSnapshot(found[0], key, call.authorization);
  };
  const readCall = async (sql: Native, call: OriginalMcpReadCallRef, budget: Budget, signal: AbortSignal): Promise<CallRow | undefined> => {
    const found = rows(await sql.$queryRaw<unknown[]>`SELECT callId, goalId, grantId, callBindingHash, recordJson, state, activeMs FROM mcp_read_calls WHERE callId = ${call.callId} FOR UPDATE`);
    live(signal); if (!found.length) return undefined;
    const result = captureOriginalMcpReadCallSnapshot(found[0], call.callId, budget);
    if (result.callBindingHash !== callHash(call) || result.reservation.inputHash !== call.inputHash) throw fail();
    return result;
  };
  const updateBudget = async (sql: Native, old: Budget, next: Pick<Budget, "consumedCalls" | "consumedActiveMs" | "reservedActiveMs" | "concurrentReads">, signal: AbortSignal) => {
    if (old.revision >= 2147483647) throw fail();
    await changed(sql.$executeRaw`UPDATE mcp_read_goal_budgets SET revision = ${old.revision + 1}, consumedCalls = ${next.consumedCalls}, consumedActiveMs = ${next.consumedActiveMs}, reservedActiveMs = ${next.reservedActiveMs}, concurrentReads = ${next.concurrentReads} WHERE goalId = ${old.goalId} AND revision = ${old.revision} AND bindingHash = ${old.bindingHash}`, signal);
  };
  const locateGoal = async (call: OriginalMcpReadCallRef, signal: AbortSignal): Promise<string> => within(async sql => {
    // Even a plain SELECT can take a shared lock under MySQL Serializable.
    // Finish this short locator transaction before any goal lock; otherwise
    // call -> goal would invert reserve/settle's goal -> call lock order.
    const found = rows(await sql.$queryRaw<unknown[]>`SELECT goalId FROM mcp_read_calls WHERE callId = ${call.callId}`);
    live(signal); if (!found.length) throw fail();
    const key = object(found[0], ["goalId"]).goalId; if (!id(key)) throw fail();
    return key;
  }, signal);
  const located = async (sql: Native, call: OriginalMcpReadCallRef, key: string, signal: AbortSignal): Promise<{ budget: Budget; row: CallRow }> => {
    // Locator is immutable but not authority: re-read the exact call under locks.
    // No token/current target lookup can forget an old reservation after revoke.
    const budget = await readBudget(sql, key, call, signal); if (!budget) throw fail();
    const row = await readCall(sql, call, budget, signal); if (!row) throw fail();
    return { budget, row };
  };
  return Object.freeze({
    async reserve(raw: OriginalMcpReadCallRef, signal: AbortSignal): Promise<OriginalMcpReadReservation> {
      const call = fixedCall(raw);
      const result = await within(async sql => {
        const original = await resolve(call, sql, signal); live(signal);
        if (original === undefined) return { denial: "denied" as const };
        const target = captureOriginalMcpReadTarget(original, call), bindingHash = hash(target);
        const old = await readBudget(sql, target.goalId, call, signal);
        if (old && old.bindingHash !== bindingHash) return { denial: "denied" as const };
        if (old && await readCall(sql, call, old, signal)) return { denial: "denied" as const }; // never replay
        const allowance = Math.min(15000, 300000 - (old?.consumedActiveMs ?? 0) - (old?.reservedActiveMs ?? 0));
        if ((old?.consumedCalls ?? 0) >= 20 || (old?.concurrentReads ?? 0) >= 2 || allowance < 1) return { denial: "limit" as const };
        const next = { consumedCalls: (old?.consumedCalls ?? 0) + 1, consumedActiveMs: old?.consumedActiveMs ?? 0,
          reservedActiveMs: (old?.reservedActiveMs ?? 0) + allowance, concurrentReads: (old?.concurrentReads ?? 0) + 1 };
        const reservation = captureOriginalMcpReadReservation({ state: "reserved", callId: call.callId, goalId: target.goalId,
          goalRevision: target.goalRevision, grantId: target.grantId, goalBindingHash: bindingHash, inputHash: call.inputHash,
          subject: target.subject, clientId: target.clientId, resource: target.resource, scopes: target.scopes, ...next, callAllowanceMs: allowance }, call);
        if (old) await updateBudget(sql, old, next, signal);
        else await changed(sql.$executeRaw`INSERT INTO mcp_read_goal_budgets (goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads) VALUES (${target.goalId}, ${target.grantId}, ${bindingHash}, ${encoded(target)}, 1, ${next.consumedCalls}, ${next.consumedActiveMs}, ${next.reservedActiveMs}, ${next.concurrentReads})`, signal);
        await changed(sql.$executeRaw`INSERT INTO mcp_read_calls (callId, goalId, grantId, callBindingHash, recordJson, state, activeMs) VALUES (${call.callId}, ${target.goalId}, ${target.grantId}, ${callHash(call)}, ${encoded(reservation)}, 'reserved', NULL)`, signal);
        // Original goal fences/recheck, not a fresh authorization or an idempotent
        // target creator. Different late binding rolls this transaction back.
        if (!isDeepStrictEqual(captureOriginalMcpReadTarget(await resolve(call, sql, signal), call), target)) throw fail();
        return { reservation };
      }, signal);
      // A classification is returned only after the original database confirms a
      // read-only denial transaction. Source/SQL/commit errors cannot masquerade as it.
      if (result.denial) throw new OriginalMcpReadBudgetError(result.denial);
      return result.reservation;
    },
    async settle(raw: OriginalMcpReadCallRef, supplied: OriginalMcpReadReservation, observation: { outcome: "returned" | "failed"; activeMs: number }, signal: AbortSignal): Promise<void> {
      const call = fixedCall(raw), reservation = captureOriginalMcpReadReservation(supplied, call);
      const observed = object(observation, ["outcome", "activeMs"]);
      if ((observed.outcome !== "returned" && observed.outcome !== "failed") || !integer(observed.activeMs, 0, reservation.callAllowanceMs)) throw fail();
      const outcome = observed.outcome, activeMs = observed.activeMs;
      await within(async sql => {
        const { budget, row } = await located(sql, call, reservation.goalId, signal);
        if (!isDeepStrictEqual(row.reservation, reservation)) throw fail();
        if (row.state === "returned" || row.state === "failed") {
          if (row.state !== outcome || row.activeMs !== activeMs) throw fail();
          return; // already durable; not delivery proof and no double charge
        }
        if (row.state !== "reserved" || budget.concurrentReads < 1 || budget.reservedActiveMs < reservation.callAllowanceMs) throw fail();
        await updateBudget(sql, budget, { consumedCalls: budget.consumedCalls, consumedActiveMs: budget.consumedActiveMs + activeMs,
          reservedActiveMs: budget.reservedActiveMs - reservation.callAllowanceMs, concurrentReads: budget.concurrentReads - 1 }, signal);
        await changed(sql.$executeRaw`UPDATE mcp_read_calls SET state = ${outcome}, activeMs = ${activeMs} WHERE callId = ${call.callId} AND state = 'reserved' AND callBindingHash = ${callHash(call)}`, signal);
      }, signal);
    },
    async markUnknown(raw: OriginalMcpReadCallRef, signal: AbortSignal): Promise<void> {
      const call = fixedCall(raw), key = await locateGoal(call, signal);
      await within(async sql => {
        const { row } = await located(sql, call, key, signal);
        // A lost settlement acknowledgement may follow a proven durable terminal
        // row. Preserve that evidence/counters; never undo it to synthesize a hold.
        if (row.state !== "reserved") return;
        await changed(sql.$executeRaw`UPDATE mcp_read_calls SET state = 'unknown' WHERE callId = ${call.callId} AND state = 'reserved' AND callBindingHash = ${callHash(call)}`, signal);
        // Counters stay unchanged. No TTL/abort cleanup or unknown -> settled path.
      }, signal);
    },
  });
}
