/** CURRENT original Web-owner reads/index of persisted MCP call metering.
 * No token, subject, input/output body, quota release/retry or execution. Observed
 * accounting is not delivery/commit proof; missing/empty is not proof of no work.
 * Read rights are independent of new OAuth issuance, so revoke preserves history. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { capturePersistedOAuthGrant } from "./prisma-oauth-grant-authority.js";
import type { PersistedOriginalOAuthGrant } from "./prisma-oauth-grant-authority.js";
import type { OriginalOAuthGrantManagement, PrismaOAuthGrantManagementStore } from "./prisma-oauth-grant-management.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { captureOriginalMcpReadBudgetSnapshot, captureOriginalMcpReadCallSnapshot } from "./prisma-mcp-read-budget.js";
import type { OriginalMcpReadBudgetSnapshot } from "./prisma-mcp-read-budget.js";
import { createOriginalMcpTrafficMeter } from './original-traffic-meter.js';
import type { OriginalMcpTrafficOwner, OriginalMcpTrafficPolicy } from './original-traffic-meter.js';
/** Original CURRENT owner-checked receipt query, not an observed call/commit.
 * Hash binds the fixed reader/query and grant revision; it grants no authority. */
export interface OriginalMcpReceiptRateRequest {
  kind: 'exact_call' | 'call_index'; owner: Readonly<OriginalMcpTrafficOwner>;
  grantId: string; grantRevision: number; queryHash: string;
}
export interface OriginalMcpReceiptRatePolicySource<Native extends OAuthSqlTransaction> {
  /** Original approved independent-read limits only. The owner-checked reader
   * supplies the query fact, NOT a caller human/receipt claim or a new grant.
   * Same Native; do not open a transaction or re-lock a different grant. */
  current(request: Readonly<OriginalMcpReceiptRateRequest>, native: Native, signal: AbortSignal):
    Promise<Omit<OriginalMcpTrafficPolicy, 'evidence'> | undefined>;
}
export type McpReadCallReceipt = { state: "not_observed"; retryable: false }
  | { state: "observed"; callId: string; goalId: string; callsConsumed: true; retryable: false;
      accountingState: "reserved" | "unknown" | "returned" | "failed";
      activity: { state: "held"; reservedMs: number } | { state: "settled"; activeMs: number } };
export interface McpReadCallIndexItem { callId: string; goalId: string }
export interface McpReadCallIndexPage { items: readonly McpReadCallIndexItem[]; nextCursor?: string }
export interface PrismaMcpReadReceiptStore {
  /** Exact original key. Tenant managers cannot enumerate someone else's calls. */
  read(input: { grantId: string; callId: string }, signal: AbortSignal): Promise<McpReadCallReceipt>;
  /** One original-owner grant page. Cursor is only a position, not authority.
   * ASCII call-key ordering, NOT chronology/latest or a full historical snapshot. */
  list(input: { grantId: string; limit: number; cursor?: string }, signal: AbortSignal): Promise<McpReadCallIndexPage>;
}
export class McpReadReceiptError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "unavailable") { super("MCP read receipt " + kind); this.name = "McpReadReceiptError"; }
}
const fail = (kind: McpReadReceiptError["kind"] = "unavailable") => new McpReadReceiptError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail(); };
const limits = { stringCharacters: 32768, arrayItems: 32 };
const ref = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const callKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
function ordinary(raw: unknown, names: readonly string[], stringCharacters = 2048): Record<string, unknown> {
  const value = snapshotJson(raw, { stringCharacters, arrayItems: 1 });
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length) throw fail("invalid");
  return snapshotJsonFields(value, names, { stringCharacters, arrayItems: 1 });
}
function selected(raw: unknown): unknown | undefined {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 1) throw fail();
  if (!raw.length) return undefined;
  const row = Object.getOwnPropertyDescriptor(raw, "0"); if (!row?.enumerable || !Object.hasOwn(row, "value")) throw fail();
  return snapshotJson(row.value, limits);
}
export function createPrismaMcpReadReceiptStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }, database: OAuthSqlDatabase<Native>,
  grants: Pick<PrismaOAuthGrantManagementStore<Native>, "readIn">,
  management: Pick<OriginalOAuthGrantManagement<Native>, "authorize">,
  ratePolicy?: OriginalMcpReceiptRatePolicySource<Native>
): PrismaMcpReadReceiptStore {
  const resource = config.resourceUrl, url = new URL(resource);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== resource || resource.length > 2048) throw fail("invalid");
  if (typeof database?.$transaction !== "function" || typeof grants?.readIn !== "function" || typeof management?.authorize !== "function") throw fail();
  if (ratePolicy !== undefined && typeof ratePolicy?.current !== 'function') throw fail();
  const currentRate = ratePolicy?.current.bind(ratePolicy);
  const resourceHash = createHash("sha256").update(resource).digest("hex");
  const transact = database.$transaction.bind(database), grantIn = grants.readIn.bind(grants), authorize = management.authorize.bind(management);
  const within = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal): Promise<T> => {
    live(signal); let entered = false;
    try {
      const value = await transact(async tx => { if (entered) throw fail(); entered = true; live(signal); const result = await consume(tx); live(signal); return result;
      }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
      live(signal); return value;
    } catch (error) { if (error instanceof McpReadReceiptError) throw error; throw fail(); }
  };
  const grant = async (tx: Native, key: string, signal: AbortSignal): Promise<PersistedOriginalOAuthGrant> => {
    const raw = await grantIn(tx, key, signal); live(signal); if (!raw) throw fail();
    const value = capturePersistedOAuthGrant(raw); if (value.id !== key || value.resource !== resource) throw fail();
    return value; // enabled/expiry are not current independent Web ownership.
  };
  const owner = async (tx: Native, g: PersistedOriginalOAuthGrant, signal: AbortSignal) => {
    const raw = await authorize(tx, { action: "read_receipt", grant: g }, signal); live(signal);
    if (!raw) throw fail("denied");
    const who = ordinary(raw, ["actorId", "tenantId", "workspaceId", "authority"], 200);
    if (who.authority !== "owner" || who.actorId !== g.userId || who.tenantId !== g.tenantId || who.workspaceId !== g.workspaceId) throw fail("denied");
    return Object.freeze(who);
  };
  const recheck = async (tx: Native, g: PersistedOriginalOAuthGrant, who: unknown, signal: AbortSignal) => {
    if (!isDeepStrictEqual(await grant(tx, g.id, signal), g) || !isDeepStrictEqual(await owner(tx, g, signal), who)) throw fail("denied");
  };
  const rateIn = async (tx: Native, g: PersistedOriginalOAuthGrant, kind: OriginalMcpReceiptRateRequest['kind'], query: unknown, signal: AbortSignal) => {
    if (!currentRate) return; // Legacy direct readers, never the configured Web paths.
    const who = Object.freeze({ userId: g.userId, tenantId: g.tenantId, workspaceId: g.workspaceId });
    const queryHash = createHash('sha256').update(JSON.stringify({ kind, resourceHash, grantId: g.id, grantRevision: g.revision, owner: who, query })).digest('hex');
    const request = Object.freeze({ kind, owner: who, grantId: g.id, grantRevision: g.revision, queryHash });
    const meter = createOriginalMcpTrafficMeter<Native>({ async current(operation, owner, native, stop) {
      if (operation !== 'original.web.receipt.read' || native !== tx || !isDeepStrictEqual(owner, who)) throw fail();
      const value = await currentRate(request, native, stop); live(stop);
      if (!value) return undefined;
      const captured = ordinary(value, ['policyRef','policyRevision','expiresAt','windowSeconds','limit'], 200);
      if (typeof captured.policyRef !== 'string' || typeof captured.policyRevision !== 'number' || typeof captured.expiresAt !== 'number'
        || typeof captured.windowSeconds !== 'number' || typeof captured.limit !== 'number') throw fail();
      // This fact comes from the fixed read method and CURRENT original owner.
      // It is a query reference, not proof that a call/receipt exists or completed.
      return { policyRef: captured.policyRef, policyRevision: captured.policyRevision, expiresAt: captured.expiresAt,
        windowSeconds: captured.windowSeconds, limit: captured.limit,
        evidence: { kind: 'original_receipt_read', reference: queryHash, revision: g.revision, expiresAt: captured.expiresAt, ...who } };
    } });
    await meter.consumeIn('original.web.receipt.read', who, tx, signal);
  };
  const budgetIn = async (tx: Native, key: string, g: PersistedOriginalOAuthGrant, signal: AbortSignal) => {
    const row = selected(await tx.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${key} FOR UPDATE`); live(signal);
    if (!row) throw fail(); const budget = captureOriginalMcpReadBudgetSnapshot(row, key, g);
    if (budget.target.grantId !== g.id) throw fail("denied"); return budget;
  };
  const callIn = async (tx: Native, key: string, budget: OriginalMcpReadBudgetSnapshot, signal: AbortSignal) => {
    const row = selected(await tx.$queryRaw<unknown[]>`SELECT callId, goalId, grantId, callBindingHash, recordJson, state, activeMs FROM mcp_read_calls WHERE callId = ${key} FOR UPDATE`); live(signal);
    if (!row) throw fail(); return captureOriginalMcpReadCallSnapshot(row, key, budget);
  };
  const cursorAfter = (cursor: string, g: PersistedOriginalOAuthGrant): string => {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw fail("invalid");
    const bytes = Buffer.from(cursor, "base64url"); if (bytes.toString("base64url") !== cursor) throw fail("invalid");
    const v = ordinary(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["resourceHash", "grantId", "userId", "tenantId", "workspaceId", "afterCallId"], 200);
    if (v.resourceHash !== resourceHash || v.grantId !== g.id || v.userId !== g.userId || v.tenantId !== g.tenantId || v.workspaceId !== g.workspaceId || !callKey(v.afterCallId)) throw fail("invalid");
    return v.afterCallId;
  };
  const cursorFor = (afterCallId: string, g: PersistedOriginalOAuthGrant) => {
    const cursor = Buffer.from(JSON.stringify({ resourceHash, grantId: g.id, userId: g.userId, tenantId: g.tenantId, workspaceId: g.workspaceId, afterCallId }), "utf8").toString("base64url");
    if (cursor.length > 2048) throw fail(); return cursor;
  };
  return Object.freeze({
    async read(raw: { grantId: string; callId: string }, signal: AbortSignal): Promise<McpReadCallReceipt> {
      let grantId: string, callId: string;
      try { const input = ordinary(raw, ["grantId", "callId"], 200);
        if (!ref(input.grantId) || !callKey(input.callId)) throw fail("invalid"); grantId = input.grantId; callId = input.callId;
      } catch { throw fail("invalid"); }
      // End the short grant/owner -> immutable locator transaction first. Even
      // plain SELECT locks under Serializable; never retain call -> goal inversion.
      const located = await within(async tx => {
        const g = await grant(tx, grantId, signal), who = await owner(tx, g, signal);
        await rateIn(tx, g, 'exact_call', { callId }, signal);
        const row = selected(await tx.$queryRaw<unknown[]>`SELECT goalId FROM mcp_read_calls WHERE callId = ${callId} FOR UPDATE`); live(signal);
        await recheck(tx, g, who, signal); if (row === undefined) return undefined;
        const key = snapshotJsonFields(row, ["goalId"], { stringCharacters: 200, arrayItems: 1 }).goalId;
        if (!callKey(key)) throw fail(); return key;
      }, signal);
      if (located === undefined) return Object.freeze({ state: "not_observed", retryable: false });
      return within(async tx => {
        const g = await grant(tx, grantId, signal), who = await owner(tx, g, signal);
        const read = async () => { const budget = await budgetIn(tx, located, g, signal); return { budget, call: await callIn(tx, callId, budget, signal) }; };
        const before = await read(); if (!isDeepStrictEqual(await read(), before)) throw fail();
        await recheck(tx, g, who, signal); // Last await: suppress rights lost during either row read.
        const call = before.call, activity: Extract<McpReadCallReceipt, { state: "observed" }>["activity"] = call.activeMs === null
          ? Object.freeze({ state: "held", reservedMs: call.reservation.callAllowanceMs }) : Object.freeze({ state: "settled", activeMs: call.activeMs });
        // 'returned' is callback accounting only, not final MCP delivery/Core proof.
        return Object.freeze({ state: "observed", callId, goalId: located, callsConsumed: true, retryable: false, accountingState: call.state, activity });
      }, signal);
    },
    async list(raw: { grantId: string; limit: number; cursor?: string }, signal: AbortSignal): Promise<McpReadCallIndexPage> {
      let grantId: string, limit: number, cursor: string | undefined;
      try {
        const copy = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 1 });
        const v = ordinary(copy, copy && typeof copy === "object" && Object.hasOwn(copy, "cursor") ? ["grantId", "limit", "cursor"] : ["grantId", "limit"]);
        if (!ref(v.grantId) || typeof v.limit !== "number" || !Number.isSafeInteger(v.limit) || v.limit < 1 || v.limit > 20
          || Object.hasOwn(v, "cursor") && typeof v.cursor !== "string") throw fail("invalid");
        grantId = v.grantId; limit = v.limit; cursor = v.cursor as string | undefined;
      } catch { throw fail("invalid"); }
      const locators = await within(async tx => {
        const g = await grant(tx, grantId, signal), who = await owner(tx, g, signal);
        let after: string | undefined;
        try { after = cursor === undefined ? undefined : cursorAfter(cursor, g); } catch { throw fail("invalid"); }
        await rateIn(tx, g, 'call_index', { limit, after: after ?? null }, signal);
        const rows = after === undefined
          ? await tx.$queryRaw<unknown[]>`SELECT callId, goalId, grantId FROM mcp_read_calls WHERE grantId = ${grantId} ORDER BY callId ASC LIMIT ${limit + 1} FOR UPDATE`
          : await tx.$queryRaw<unknown[]>`SELECT callId, goalId, grantId FROM mcp_read_calls WHERE grantId = ${grantId} AND callId > ${after} ORDER BY callId ASC LIMIT ${limit + 1} FOR UPDATE`;
        live(signal); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > limit + 1) throw fail();
        const result: { callId: string; goalId: string }[] = []; let previous = after;
        for (let i = 0; i < rows.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(rows, String(i)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw fail();
          const row = ordinary(descriptor.value, ["callId", "goalId", "grantId"], 200);
          if (!callKey(row.callId) || !callKey(row.goalId) || row.grantId !== grantId || previous !== undefined && row.callId <= previous) throw fail();
          previous = row.callId; result.push(Object.freeze({ callId: row.callId, goalId: row.goalId }));
        }
        await recheck(tx, g, who, signal); return Object.freeze(result);
      }, signal);
      if (!locators.length) return Object.freeze({ items: Object.freeze([]) });
      return within(async tx => {
        const g = await grant(tx, grantId, signal), who = await owner(tx, g, signal);
        // Locator locks ended above. Lock distinct goals in stable order BEFORE
        // any call, including lookahead. This page-local array is not a quota cache.
        const budgets: OriginalMcpReadBudgetSnapshot[] = [];
        for (const key of [...new Set(locators.map(v => v.goalId))].sort()) budgets.push(await budgetIn(tx, key, g, signal));
        for (const locator of locators) {
          const budget = budgets.find(v => v.goalId === locator.goalId); if (!budget) throw fail();
          await callIn(tx, locator.callId, budget, signal);
        }
        await recheck(tx, g, who, signal); // Current owner, not a cursor or old grant permit.
        const items = Object.freeze(locators.slice(0, limit));
        const nextCursor = locators.length > limit ? cursorFor(items[items.length - 1]!.callId, g) : undefined;
        return Object.freeze({ items, ...(nextCursor === undefined ? {} : { nextCursor }) });
      }, signal);
    },
  });
}
