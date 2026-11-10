/** ORIGINAL goal/call settlement observation in the caller's Native.
 * Requires the original goal reader/current owner fences; checks the complete
 * bounded call set against existing budget scalars. No writes, new goal, closure,
 * retry, refund or permission to adopt/replay. SQL rows are NOT enclosing Auth
 * commit, external delivery or business-goal completion evidence. */
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { captureMcpReadInput } from './persistent-read-accounting.js';
import { captureOriginalMcpCatalogGoal } from './prisma-mcp-catalog-goals.js';
import type { OriginalCatalogGoal } from './prisma-mcp-catalog-goals.js';
import { captureOriginalMcpReadBudgetSnapshot, captureOriginalMcpReadCallSnapshot } from './prisma-mcp-read-budget.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';
export interface OriginalMcpReadGoalSettlement {
  state: 'not_observed' | 'pending' | 'settled';
  goalId: string; goalRecordHash: string; budgetRevision: number | null;
  consumedCalls: number | null; consumedActiveMs: number | null;
  reservedActiveMs: number | null; concurrentReads: number | null;
  ledgerHash: string | null;
  observation: 'native_call_rows_not_commit_or_goal_completion_evidence';
  retryable: false;
}
const fail = () => new Error('Original goal settlement evidence unavailable');
const limits = { stringCharacters: 32768, arrayItems: 32 };
/** Not an MCP tool; trusted owner must authorize before/after in this SAME Native.
 * The goal is selected by that original owner, never by a model parameter. */
export function createPrismaMcpReadGoalSettlement<Native extends OAuthSqlTransaction>(original: {
  readIn(goalId: string, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoal | undefined>;
}): { readIn(goal: OriginalCatalogGoal, native: Native, signal: AbortSignal): Promise<OriginalMcpReadGoalSettlement> } {
  if (typeof original?.readIn !== 'function') throw fail();
  const readGoal = original.readIn.bind(original);
  return Object.freeze({ async readIn(raw: OriginalCatalogGoal, native: Native, signal: AbortSignal): Promise<OriginalMcpReadGoalSettlement> {
    const goal = captureOriginalMcpCatalogGoal(raw);
    const live = () => { if (!native || '$transaction' in native || signal.aborted) throw fail(); };
    live();
    if (!isDeepStrictEqual(goal, await readGoal(goal.target.goalId, native, signal))) throw fail(); live();
    const budgetRows = async () => {
      live(); const rows = snapshotJson(await native.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${goal.target.goalId} FOR UPDATE NOWAIT`, limits);
      live(); if (!Array.isArray(rows) || rows.length > 1) throw fail(); return rows;
    };
    const callRows = async () => {
      live(); const rows = snapshotJson(await native.$queryRaw<unknown[]>`SELECT callId, goalId, grantId, callBindingHash, recordJson, state, activeMs FROM mcp_read_calls FORCE INDEX (mcp_read_calls_goal) WHERE goalId = ${goal.target.goalId} ORDER BY callId LIMIT 21 FOR UPDATE NOWAIT`, limits);
      live(); if (!Array.isArray(rows) || rows.length > 20) throw fail(); return rows;
    };
    const budgets = await budgetRows(), calls = await callRows();
    const base = { goalId: goal.target.goalId, goalRecordHash: goal.recordHash,
      observation: 'native_call_rows_not_commit_or_goal_completion_evidence' as const, retryable: false as const };
    let result: OriginalMcpReadGoalSettlement;
    if (!budgets.length) {
      if (calls.length) throw fail();
      result = { ...base, state: 'not_observed', budgetRevision: null, consumedCalls: null, consumedActiveMs: null,
        reservedActiveMs: null, concurrentReads: null, ledgerHash: null };
    } else {
      const budget = captureOriginalMcpReadBudgetSnapshot(budgets[0], goal.target.goalId, goal.target);
      if (!isDeepStrictEqual(budget.target, goal.target) || calls.length !== budget.consumedCalls) throw fail();
      const ledger = calls.map(row => {
        const key = snapshotJsonFields(row, ['callId'], limits).callId;
        if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)) throw fail();
        const call = captureOriginalMcpReadCallSnapshot(row, key, budget);
        return { callId: key, callBindingHash: call.callBindingHash, state: call.state, activeMs: call.activeMs,
          ordinal: call.reservation.consumedCalls, allowance: call.reservation.callAllowanceMs };
      });
      const ids = ledger.map(row => row.callId), ordinals = ledger.map(row => row.ordinal);
      if (new Set(ids).size !== ids.length || new Set(ordinals).size !== ordinals.length
        || ordinals.some(value => value < 1 || value > ledger.length)
        || ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) throw fail();
      const held = ledger.filter(row => row.state === 'reserved' || row.state === 'unknown');
      const active = ledger.reduce((sum, row) => sum + (row.activeMs ?? 0), 0);
      const reserved = held.reduce((sum, row) => sum + row.allowance, 0);
      if (held.length !== budget.concurrentReads || reserved !== budget.reservedActiveMs || active !== budget.consumedActiveMs) throw fail();
      result = { ...base, state: budget.consumedCalls === 0 ? 'not_observed' : held.length ? 'pending' : 'settled',
        budgetRevision: budget.revision, consumedCalls: budget.consumedCalls, consumedActiveMs: budget.consumedActiveMs,
        reservedActiveMs: budget.reservedActiveMs, concurrentReads: budget.concurrentReads,
        ledgerHash: captureMcpReadInput(ledger).inputHash };
    }
    // Do not let a shared Native/adaptor mutate rows after validation. Actual
    // production locks/isolation and the enclosing commit remain the owner's job.
    if (!isDeepStrictEqual(goal, await readGoal(goal.target.goalId, native, signal))) throw fail(); live();
    if (!isDeepStrictEqual(budgets, await budgetRows()) || !isDeepStrictEqual(calls, await callRows())) throw fail();
    live(); return Object.freeze(result);
  } });
}
