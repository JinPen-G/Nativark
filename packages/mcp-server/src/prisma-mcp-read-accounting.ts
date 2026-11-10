/** Input-bound composition for the ORIGINAL SQL read budget. The goal resolver
 * can locate existing server records from a captured call input, not reverse a
 * digest or create a goal from a token/connection. No goal, ledger, schema install,
 * authorization fallback, classification exemption or replay is introduced. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson } from './json-snapshot.js';
import { captureMcpReadInput, createPersistentMcpReadAccounting } from "./persistent-read-accounting.js";
import type { OriginalMcpReadCallRef } from "./persistent-read-accounting.js";
import { createPrismaMcpReadBudget } from "./prisma-mcp-read-budget.js";
import type { OriginalMcpReadTarget } from "./prisma-mcp-read-budget.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import type { McpReadAccounting, McpReadAuthorization } from "./read-tools.js";

export interface OriginalMcpReadInputTargetSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Resolve ONLY an already-authorized automatic goal and its original call/input
   * association under original goal fences in this SAME native budget transaction.
   * Input is deeply frozen locator data, never goalId/human/actor authorization.
   * An enclosing business authority owns grant locks; do not reacquire them here.
   * Undefined means confirmed no target. Missing/unreadable evidence must throw.
   * No native handle, input or credential may escape into a client result. */
  resolve(call: OriginalMcpReadCallRef, input: unknown, transaction: Native, signal: AbortSignal): Promise<OriginalMcpReadTarget | undefined>;
}

/** Supply the standard read accounting slot with a fixed database and ORIGINAL
 * input-aware target owner. New per-call adapters still use the SAME persisted
 * goal counters; neither construction nor token refresh resets a goal.
 * @param database - existing Serializable database, never a connection factory.
 * @param source - original trusted goal/input producer, not a caller assertion.
 * @returns accounting with pre-reserve input capture, original holds/settlement and
 * unknown behavior. Raw inputs remain operation-local and never enter SQL storage. */
export function createPrismaMcpReadAccounting<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  database: OAuthSqlDatabase<Native>, source: OriginalMcpReadInputTargetSource<Native>
): McpReadAccounting {
  const fail = () => new Error("Original input-bound MCP accounting unavailable");
  if (typeof database?.$transaction !== "function" || typeof source?.resolve !== "function") throw fail();
  const fixedDatabase: OAuthSqlDatabase<Native> = Object.freeze({ $transaction: database.$transaction.bind(database) });
  const resolve = source.resolve.bind(source);
  interface Entry { active: boolean; authorization: unknown; toolName: string; inputHash: string; accounting: McpReadAccounting }
  const invocations = new AsyncLocalStorage<Entry>();
  const prepare = (authorization: McpReadAuthorization, toolName: string, input: unknown): Entry => {
    const captured = captureMcpReadInput(input);
    let entry!: Entry;
    const budget = createPrismaMcpReadBudget(fixedDatabase, { async resolve(call, native, requestSignal) {
      if (!entry.active || requestSignal.aborted || call.toolName !== toolName || call.inputHash !== captured.inputHash) throw fail();
      const target = await resolve(call, captured.input, native, requestSignal);
      if (!entry.active || requestSignal.aborted) throw fail();
      return target;
    } });
    entry = { active: true, authorization: snapshotJson(authorization, { stringCharacters: 2048, arrayItems: 32 }), toolName, inputHash: captured.inputHash,
      accounting: createPersistentMcpReadAccounting(budget) };
    return entry;
  };
  return Object.freeze({
    async withInvocation<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted || typeof consume !== 'function' || invocations.getStore()) throw fail();
      const entry = prepare(authorization, toolName, input);
      try {
        if (!entry.accounting.withInvocation) throw fail();
        return await invocations.run(entry, () => entry.accounting.withInvocation!(authorization, toolName, input, consume, signal));
      } finally { entry.active = false; }
    },
    async withCall<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted || typeof consume !== 'function') throw fail();
      const current = invocations.getStore();
      if (current) {
        if (!current.active || current.toolName !== toolName || captureMcpReadInput(input).inputHash !== current.inputHash
          || !isDeepStrictEqual(snapshotJson(authorization, { stringCharacters: 2048, arrayItems: 32 }), current.authorization)) throw fail();
        return current.accounting.withCall(authorization, toolName, input, consume, signal);
      }
      const entry = prepare(authorization, toolName, input);
      try { return await entry.accounting.withCall(authorization, toolName, input, consume, signal); }
      finally { entry.active = false; }
    },
  });
}
