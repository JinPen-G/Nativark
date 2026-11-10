/** Initial ORIGINAL catalog-goal metadata, not another business Task/ledger.
 * An authenticated original writer prepares it before the budget/read transaction.
 * One owner/workspace frontier survives credentials, queries and host restarts.
 * No automatic new-goal rollover, expiry reset, cleanup, execution or publication. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { captureMcpReadInput } from './persistent-read-accounting.js';
import { captureOriginalMcpReadTarget, captureOriginalMcpReadBudgetSnapshot } from './prisma-mcp-read-budget.js';
import type { OriginalMcpReadTarget } from './prisma-mcp-read-budget.js';
import type { OriginalMcpReadGoalOwner } from './prisma-mcp-read-bindings.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';

export const ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION = 'catalog-admission-1';
export interface OriginalCatalogGoal {
  ownerKey: string; target: OriginalMcpReadTarget; owner: Required<OriginalMcpReadGoalOwner>;
  authorityHash: string; recordHash: string;
}
export interface OriginalCatalogGoalDraft {
  owner: Required<OriginalMcpReadGoalOwner>; authorityHash: string;
  target: Omit<OriginalMcpReadTarget, 'goalId' | 'goalRevision'>;
}
export interface OriginalCatalogGoalAudit<Native extends OAuthSqlTransaction> {
  admitted(goal: OriginalCatalogGoal, native: Native, signal: AbortSignal): Promise<void>;
  published(goal: OriginalCatalogGoal, bindingKeys: readonly string[], native: Native, signal: AbortSignal): Promise<void>;
}
export interface OriginalCatalogGoalStore<Native extends OAuthSqlTransaction> {
  /** Only in the ORIGINAL authenticated writer's coherent transaction. It owns
   * grant/identity fences and confirms commit before budget/read. Missing legacy
   * association is NOT permission to reset old counters. No caller goal ID. */
  prepareIn(draft: OriginalCatalogGoalDraft, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoal>;
  /** Read-only original locator. Budget callers must not re-lock outer Auth/grant. */
  readOwnerIn(owner: Pick<OriginalMcpReadGoalOwner, 'userId' | 'tenantId' | 'workspaceId'>, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoal | undefined>;
  readIn(goalId: string, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoal | undefined>;
  auditPublishedIn(goalId: string, bindingKeys: readonly string[], native: Native, signal: AbortSignal): Promise<void>;
}
const fail = () => new Error('Original catalog goal unavailable');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const limits = { stringCharacters: 32768, arrayItems: 32 };
function object(raw: unknown, keys: readonly string[]) {
  const copy = snapshotJson(raw, limits);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== keys.length) throw fail();
  return snapshotJsonFields(copy, keys, limits);
}
function scope(raw: unknown) {
  const r = snapshotJsonFields(raw, ['userId', 'tenantId', 'workspaceId'], limits);
  const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
  if (!id(r.userId) || !id(r.tenantId) || !id(r.workspaceId)) throw fail();
  return Object.freeze({ userId: r.userId, tenantId: r.tenantId, workspaceId: r.workspaceId });
}
function owner(raw: unknown): Required<OriginalMcpReadGoalOwner> {
  const r = object(raw, ['userId', 'tenantId', 'workspaceId', 'grantId', 'grantRevision']), identity = scope(r);
  if (typeof r.grantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.grantId)
    || typeof r.grantRevision !== 'number' || !Number.isSafeInteger(r.grantRevision) || r.grantRevision < 1 || r.grantRevision > 2147483647) throw fail();
  return Object.freeze({ ...identity, grantId: r.grantId, grantRevision: r.grantRevision });
}
// NOT token/client/query/resource-derived. A different grant or endpoint cannot
// produce a new frontier for the same original catalog owner/workspace.
const keyFor = (raw: unknown) => captureMcpReadInput({ kind: 'original_catalog_goal', ...scope(raw) }).inputHash;
function stored(raw: unknown): OriginalCatalogGoal {
  const r = object(raw, ['ownerKey', 'goalId', 'grantId', 'grantRevision', 'userId', 'tenantId', 'workspaceId', 'authorityHash', 'recordHash', 'recordJson']);
  const body = object(typeof r.recordJson === 'string' ? JSON.parse(r.recordJson) : r.recordJson, ['ownerKey', 'target', 'owner', 'authorityHash']);
  const target = captureOriginalMcpReadTarget(body.target), who = owner(body.owner);
  const expected = captureMcpReadInput({ ownerKey: keyFor(who), target, owner: who, authorityHash: body.authorityHash });
  if (!uuid(target.goalId) || target.goalRevision !== 1 || target.purpose !== 'rental.catalog.search' || !digest(body.authorityHash)
    || body.ownerKey !== keyFor(who) || r.ownerKey !== body.ownerKey || r.goalId !== target.goalId || r.grantId !== target.grantId
    || who.grantId !== target.grantId || r.grantRevision !== who.grantRevision || r.userId !== who.userId || r.tenantId !== who.tenantId
    || r.workspaceId !== who.workspaceId || r.authorityHash !== body.authorityHash || r.recordHash !== expected.inputHash) throw fail();
  return Object.freeze({ ownerKey: body.ownerKey as string, target, owner: who, authorityHash: body.authorityHash, recordHash: expected.inputHash });
}

/** Detached ORIGINAL metadata validation, not a caller goal/owner authority.
 * Reuses the exact row/hash contract so consumers cannot invent a lookalike DTO. */
export function captureOriginalMcpCatalogGoal(raw: unknown): OriginalCatalogGoal {
  const value = object(raw, ['ownerKey', 'target', 'owner', 'authorityHash', 'recordHash']);
  const who = owner(value.owner), target = captureOriginalMcpReadTarget(value.target);
  return stored({ ownerKey: value.ownerKey, goalId: target.goalId, grantId: target.grantId, grantRevision: who.grantRevision,
    userId: who.userId, tenantId: who.tenantId, workspaceId: who.workspaceId, authorityHash: value.authorityHash,
    recordHash: value.recordHash, recordJson: { ownerKey: value.ownerKey, target, owner: who, authorityHash: value.authorityHash } });
}

/** Requires mysql-catalog-goal-schema.sql and actual original same-Native audit.
 * Does not open transactions or install tables. Initial admission only: a new
 * legitimate goal/changed policy requires separately implemented trusted adoption;
 * never manufacture it from another call/credential when this frontier is spent. */
export function createPrismaMcpCatalogGoals<Native extends OAuthSqlTransaction>(audit: OriginalCatalogGoalAudit<Native>): OriginalCatalogGoalStore<Native> {
  if (typeof audit?.admitted !== 'function' || typeof audit.published !== 'function') throw fail();
  const admitted = audit.admitted.bind(audit), published = audit.published.bind(audit);
  const live = (native: Native, signal: AbortSignal) => { if (!native || '$transaction' in native || signal.aborted) throw fail(); };
  const row = (raw: unknown) => {
    const rows = snapshotJson(raw, limits); if (!Array.isArray(rows) || rows.length > 1) throw fail();
    return rows.length ? stored(rows[0]) : undefined;
  };
  const readOwner = async (key: string, native: Native, s: AbortSignal) => {
    live(native, s);
    const value = row(await native.$queryRaw<unknown[]>`SELECT ownerKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, authorityHash, recordHash, recordJson FROM mcp_read_catalog_goals WHERE ownerKey = ${key} FOR UPDATE NOWAIT`);
    live(native, s); if (value && value.ownerKey !== key) throw fail(); return value;
  };
  const read = async (id: string, native: Native, s: AbortSignal) => {
    live(native, s); if (!uuid(id)) throw fail();
    const value = row(await native.$queryRaw<unknown[]>`SELECT ownerKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, authorityHash, recordHash, recordJson FROM mcp_read_catalog_goals WHERE goalId = ${id} FOR UPDATE NOWAIT`);
    live(native, s); if (value && value.target.goalId !== id) throw fail(); return value;
  };
  return Object.freeze({
    async prepareIn(raw: OriginalCatalogGoalDraft, native: Native, s: AbortSignal) {
      live(native, s);
      const d = object(raw, ['owner', 'authorityHash', 'target']), who = owner(d.owner);
      const fields = object(d.target, ['grantId', 'subject', 'clientId', 'resource', 'scopes', 'purpose', 'originalInputHash', 'policyVersion']);
      // Validate without adopting any caller goal ID. UUID is created only after
      // proving a genuinely empty original-owner frontier below.
      const template = captureOriginalMcpReadTarget({ ...fields, goalId: 'template', goalRevision: 1 });
      if (template.grantId !== who.grantId || template.purpose !== 'rental.catalog.search'
        || template.policyVersion !== ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION || !digest(d.authorityHash)) throw fail();
      const key = keyFor(who), existing = await readOwner(key, native, s);
      if (existing) {
        const { originalInputHash: _first, ...prior } = existing.target;
        const { originalInputHash: _query, ...current } = template;
        if (!isDeepStrictEqual(existing.owner, who) || existing.authorityHash !== d.authorityHash
          || !isDeepStrictEqual({ ...prior, goalId: 'template' }, current)) throw fail();
        // Do not grow association/audit metadata after the ORIGINAL goal is spent
        // or full. NOWAIT prevents holding this frontier while waiting on a budget.
        const rows = snapshotJson(await native.$queryRaw<unknown[]>`SELECT goalId, grantId, bindingHash, recordJson, revision, consumedCalls, consumedActiveMs, reservedActiveMs, concurrentReads FROM mcp_read_goal_budgets WHERE goalId = ${existing.target.goalId} FOR UPDATE NOWAIT`, limits);
        live(native, s); if (!Array.isArray(rows) || rows.length > 1) throw fail();
        if (rows.length) {
          const budget = captureOriginalMcpReadBudgetSnapshot(rows[0], existing.target.goalId, existing.target);
          if (budget.target.grantId !== existing.owner.grantId || !isDeepStrictEqual(budget.target, existing.target)
            || budget.consumedCalls >= 20 || budget.concurrentReads >= 2 || budget.consumedActiveMs + budget.reservedActiveMs >= 300000) throw fail();
        }
        return existing; // changing a query never changes originalInputHash/goal/counters
      }
      // Legacy metadata in ANY owned grant forbids bootstrap. These are ORIGINAL
      // writer-only queries under its Auth locks, never a separate budget source.
      const binding = snapshotJson(await native.$queryRaw<unknown[]>`SELECT bindingKey FROM mcp_read_target_bindings FORCE INDEX (mcp_catalog_goal_binding_owner) WHERE userId = ${who.userId} AND tenantId = ${who.tenantId} AND workspaceId = ${who.workspaceId} LIMIT 1 FOR UPDATE NOWAIT`, limits);
      live(native, s); if (!Array.isArray(binding) || binding.length) throw fail();
      const grants = snapshotJson(await native.$queryRaw<unknown[]>`SELECT id FROM mcp_oauth_grants FORCE INDEX (mcp_catalog_goal_grant_owner) WHERE userId = ${who.userId} AND tenantId = ${who.tenantId} AND workspaceId = ${who.workspaceId} ORDER BY id LIMIT 51 FOR UPDATE NOWAIT`, limits);
      live(native, s); if (!Array.isArray(grants) || grants.length > 50) throw fail();
      const ids = grants.map(v => object(v, ['id']).id);
      if (ids.some(v => typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v)) || new Set(ids).size !== ids.length || !ids.includes(who.grantId)) throw fail();
      for (const id of ids) {
        const budgets = snapshotJson(await native.$queryRaw<unknown[]>`SELECT goalId FROM mcp_read_goal_budgets FORCE INDEX (mcp_catalog_goal_budget_grant) WHERE grantId = ${id} LIMIT 1 FOR UPDATE NOWAIT`, limits);
        live(native, s); if (!Array.isArray(budgets) || budgets.length) throw fail();
      }
      const target = captureOriginalMcpReadTarget({ ...template, goalId: randomUUID() });
      const value = { ownerKey: key, target, owner: who, authorityHash: d.authorityHash }, captured = captureMcpReadInput(value);
      const text = JSON.stringify(captured.input);
      const count = await native.$executeRaw`INSERT INTO mcp_read_catalog_goals (ownerKey, goalId, grantId, grantRevision, userId, tenantId, workspaceId, authorityHash, recordHash, recordJson) VALUES (${key}, ${target.goalId}, ${who.grantId}, ${who.grantRevision}, ${who.userId}, ${who.tenantId}, ${who.workspaceId}, ${d.authorityHash}, ${captured.inputHash}, ${text})`;
      live(native, s); if (count !== 1) throw fail();
      const saved = await readOwner(key, native, s); if (!saved || saved.recordHash !== captured.inputHash) throw fail();
      await admitted(saved, native, s); live(native, s);
      if (!isDeepStrictEqual(saved, await readOwner(key, native, s))) throw fail();
      return saved;
    },
    readOwnerIn: (who: Pick<OriginalMcpReadGoalOwner, 'userId' | 'tenantId' | 'workspaceId'>, native: Native, s: AbortSignal) => readOwner(keyFor(who), native, s), readIn: read,
    async auditPublishedIn(id: string, rawKeys: readonly string[], native: Native, s: AbortSignal) {
      live(native, s);
      const keys = snapshotJson(rawKeys, limits);
      if (!Array.isArray(keys) || !keys.length || keys.length > 32 || keys.some(k => !digest(k)) || new Set(keys).size !== keys.length) throw fail();
      const before = await read(id, native, s); if (!before) throw fail();
      await published(before, Object.freeze(keys as string[]), native, s); live(native, s);
      if (!isDeepStrictEqual(before, await read(id, native, s))) throw fail();
    },
  });
}
