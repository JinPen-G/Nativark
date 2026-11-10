/** ORIGINAL catalog frontier adoption participant, never a model approval tool.
 * Trusted Web owner holds grant/Auth/Guard/verification through its Native commit.
 * Fresh complete settlement + accepted original intent permits metadata closure,
 * archive and CAS to a server-created next goal; NO budget/call/binding deletion,
 * refund, business completion claim, transaction ownership or automatic rollover. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureMcpReadInput } from './persistent-read-accounting.js';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { captureOriginalMcpCatalogGoal, createPrismaMcpCatalogGoals } from './prisma-mcp-catalog-goals.js';
import type { OriginalCatalogGoal } from './prisma-mcp-catalog-goals.js';
import { createPrismaMcpReadGoalSettlement } from './prisma-mcp-read-goal-settlement.js';
import type { OriginalMcpReadGoalSettlement } from './prisma-mcp-read-goal-settlement.js';
import { originalCatalogGoalIntentId } from './prisma-mcp-catalog-goal-intents.js';
import type { OriginalAcceptedCatalogGoalIntent } from './prisma-mcp-catalog-goal-intents.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';

export interface OriginalCatalogGoalAdoption {
  version: 'catalog-goal-adoption-1'; id: string; operationKey: string; intentRecordHash: string;
  oldGoal: OriginalCatalogGoal; newGoal: OriginalCatalogGoal;
  settlement: OriginalMcpReadGoalSettlement; adoptedAt: number; recordHash: string;
}
export interface OriginalCatalogGoalAdoptionAudit<Native extends OAuthSqlTransaction> {
  admitted(goal: OriginalCatalogGoal, native: Native, signal: AbortSignal): Promise<void>;
  adopted(record: OriginalCatalogGoalAdoption, native: Native, signal: AbortSignal, requireExisting?: boolean): Promise<void>;
}
export interface PrismaMcpCatalogGoalAdoptions<Native extends OAuthSqlTransaction> {
  /** Requires original current owner and nonce decision in this SAME Native;
   * returned prepared metadata is NOT a commit or business completion receipt. */
  prepareIn(intent: OriginalAcceptedCatalogGoalIntent, goal: OriginalCatalogGoal, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoalAdoption>;
  /** Original owner must separately authorize historical observation. */
  readIn(id: string, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoalAdoption | undefined>;
  readHistoricalIn(goalId: string, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoal | undefined>;
  /** Current-transition final fence; historical reads do NOT require it. */
  verifyIn(goal: OriginalCatalogGoal, operationKey: string, nextInputHash: string, native: Native, signal: AbortSignal): Promise<OriginalCatalogGoalAdoption>;
}
const fail = () => new Error('Original catalog goal adoption unavailable');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const limits = { stringCharacters: 32768, arrayItems: 50 };
function object(raw: unknown, keys: readonly string[]) {
  if (typeof raw === 'string') { if (Buffer.byteLength(raw,'utf8') > 32768) throw fail(); raw=JSON.parse(raw); }
  const copy = snapshotJson(raw,limits);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== keys.length) throw fail();
  return snapshotJsonFields(copy,keys,limits);
}
function settled(raw: unknown, goal: OriginalCatalogGoal): OriginalMcpReadGoalSettlement {
  const r = object(raw,['state','goalId','goalRecordHash','budgetRevision','consumedCalls','consumedActiveMs','reservedActiveMs','concurrentReads','ledgerHash','observation','retryable']);
  if (r.state !== 'settled' || r.goalId !== goal.target.goalId || r.goalRecordHash !== goal.recordHash || !digest(r.ledgerHash)
    || typeof r.budgetRevision !== 'number' || !Number.isSafeInteger(r.budgetRevision) || r.budgetRevision < 1
    || typeof r.consumedCalls !== 'number' || !Number.isSafeInteger(r.consumedCalls) || r.consumedCalls < 1 || r.consumedCalls > 20
    || typeof r.consumedActiveMs !== 'number' || !Number.isSafeInteger(r.consumedActiveMs) || r.consumedActiveMs < 0 || r.consumedActiveMs > 300000
    || r.concurrentReads !== 0 || r.reservedActiveMs !== 0 || r.observation !== 'native_call_rows_not_commit_or_goal_completion_evidence' || r.retryable !== false) throw fail();
  return Object.freeze({ ...r }) as unknown as OriginalMcpReadGoalSettlement;
}
export function captureOriginalCatalogGoalAdoption(raw: unknown): OriginalCatalogGoalAdoption {
  const r = object(raw,['version','id','operationKey','intentRecordHash','oldGoal','newGoal','settlement','adoptedAt','recordHash']);
  const oldGoal = captureOriginalMcpCatalogGoal(r.oldGoal), newGoal = captureOriginalMcpCatalogGoal(r.newGoal);
  if (r.version !== 'catalog-goal-adoption-1' || typeof r.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.operationKey)
    || r.id !== originalCatalogGoalIntentId(r.operationKey,oldGoal.owner) || !digest(r.intentRecordHash) || !digest(r.recordHash)
    || typeof r.adoptedAt !== 'number' || !Number.isSafeInteger(r.adoptedAt) || r.adoptedAt < 1 || oldGoal.target.goalId === newGoal.target.goalId
    || oldGoal.ownerKey !== newGoal.ownerKey || oldGoal.authorityHash !== newGoal.authorityHash || !isDeepStrictEqual(oldGoal.owner,newGoal.owner)) throw fail();
  const { goalId: _old, originalInputHash: _before, ...prior } = oldGoal.target;
  const { goalId: _next, originalInputHash: _after, ...next } = newGoal.target;
  if (!isDeepStrictEqual(prior,next)) throw fail();
  const body = { version: r.version as 'catalog-goal-adoption-1', id: r.id as string, operationKey: r.operationKey, intentRecordHash: r.intentRecordHash,
    oldGoal,newGoal,settlement: settled(r.settlement,oldGoal),adoptedAt:r.adoptedAt };
  if (captureMcpReadInput(body).inputHash !== r.recordHash) throw fail();
  return Object.freeze({ ...body,recordHash:r.recordHash });
}

export function createPrismaMcpCatalogGoalAdoptions<Native extends OAuthSqlTransaction>(audit: OriginalCatalogGoalAdoptionAudit<Native>): PrismaMcpCatalogGoalAdoptions<Native> {
  if (typeof audit?.admitted !== 'function' || typeof audit.adopted !== 'function') throw fail();
  const admitted = audit.admitted.bind(audit), adopted = audit.adopted.bind(audit);
  const goals = createPrismaMcpCatalogGoals<Native>({ admitted: async()=>{ throw fail(); },published:async()=>{ throw fail(); } });
  const live = (sql: Native, signal: AbortSignal) => { if (!sql || '$transaction' in sql || typeof sql.$queryRaw !== 'function' || signal.aborted) throw fail(); };
  const history = async (goalId: string, sql: Native, signal: AbortSignal) => {
    live(sql,signal); if (!uuid(goalId)) throw fail();
    const rows = snapshotJson(await sql.$queryRaw<unknown[]>`SELECT goalId, ownerKey, recordHash, adoptionId, adoptionHash, recordJson FROM mcp_catalog_goal_history WHERE goalId = ${goalId} FOR UPDATE NOWAIT`,limits);
    live(sql,signal); if (!Array.isArray(rows) || rows.length > 1) throw fail(); if (!rows.length) return undefined;
    const r = object(rows[0],['goalId','ownerKey','recordHash','adoptionId','adoptionHash','recordJson']), g = captureOriginalMcpCatalogGoal(typeof r.recordJson === 'string' ? JSON.parse(r.recordJson) : r.recordJson);
    if (r.goalId !== goalId || g.target.goalId !== goalId || g.ownerKey !== r.ownerKey || g.recordHash !== r.recordHash || !digest(r.adoptionId) || !digest(r.adoptionHash)) throw fail();
    return { goal:g,adoptionId:r.adoptionId,adoptionHash:r.adoptionHash };
  };
  const read = async (id: string, sql: Native, signal: AbortSignal) => {
    live(sql,signal); if (!digest(id)) throw fail();
    const rows = snapshotJson(await sql.$queryRaw<unknown[]>`SELECT id, ownerKey, operationKey, userId, tenantId, workspaceId, oldGoalId, newGoalId, intentRecordHash, recordHash, recordJson FROM mcp_catalog_goal_adoptions WHERE id = ${id} FOR UPDATE NOWAIT`,limits);
    live(sql,signal); if (!Array.isArray(rows) || rows.length > 1) throw fail(); if (!rows.length) return undefined;
    const r = object(rows[0],['id','ownerKey','operationKey','userId','tenantId','workspaceId','oldGoalId','newGoalId','intentRecordHash','recordHash','recordJson']);
    const a = captureOriginalCatalogGoalAdoption(r.recordJson);
    if (a.id !== id || r.id !== id || r.operationKey !== a.operationKey || r.ownerKey !== a.oldGoal.ownerKey || r.oldGoalId !== a.oldGoal.target.goalId
      || r.newGoalId !== a.newGoal.target.goalId || r.recordHash !== a.recordHash || r.intentRecordHash !== a.intentRecordHash
      || r.userId !== a.oldGoal.owner.userId || r.tenantId !== a.oldGoal.owner.tenantId || r.workspaceId !== a.oldGoal.owner.workspaceId) throw fail();
    return a;
  };
  const oldReader = { async readIn(id: string, sql: Native, signal: AbortSignal) {
    const current = await goals.readIn(id,sql,signal), past = await history(id,sql,signal);
    if (current && past && !isDeepStrictEqual(current,past.goal)) throw fail(); return current ?? past?.goal;
  } };
  const settlement = createPrismaMcpReadGoalSettlement(oldReader);
  const intentRow = async (intent: OriginalAcceptedCatalogGoalIntent, goal: OriginalCatalogGoal, sql: Native, signal: AbortSignal) => {
    live(sql,signal); const rows = snapshotJson(await sql.$queryRaw<unknown[]>`SELECT id, operationKey, ownerKey, userId, tenantId, workspaceId, sessionId, goalId, goalRecordHash, nextInputHash, recordHash, nonceHash, revision, state, CAST(decidedAt AS DOUBLE) AS decidedAt, recordJson FROM mcp_catalog_goal_intents WHERE id = ${intent.id} FOR UPDATE NOWAIT`,limits);
    live(sql,signal); if (!Array.isArray(rows) || rows.length !== 1) throw fail();
    const r = snapshotJsonFields(rows[0],['id','operationKey','ownerKey','userId','tenantId','workspaceId','goalId','goalRecordHash','nextInputHash','recordHash','revision','state','recordJson'],limits);
    const body = object(r.recordJson,['operationKey','owner','goal','nextInputHash','policyHash','expiresAt']);
    const originalGoal = captureOriginalMcpCatalogGoal(body.goal), owner = object(body.owner,['userId','tenantId','workspaceId','audience','sessionId']);
    if (r.id !== intent.id || r.operationKey !== intent.operationKey || r.ownerKey !== goal.ownerKey || r.userId !== goal.owner.userId || r.tenantId !== goal.owner.tenantId || r.workspaceId !== goal.owner.workspaceId
      || r.goalId !== goal.target.goalId || r.goalRecordHash !== goal.recordHash || r.nextInputHash !== intent.nextInputHash || r.recordHash !== intent.recordHash || r.revision !== 2 || r.state !== 'accepted'
      || body.operationKey !== intent.operationKey || body.nextInputHash !== intent.nextInputHash || !isDeepStrictEqual(originalGoal,goal)
      || owner.userId !== goal.owner.userId || owner.tenantId !== goal.owner.tenantId || owner.workspaceId !== goal.owner.workspaceId || owner.audience !== 'operator'
      || captureMcpReadInput(body).inputHash !== intent.recordHash || typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt) || intent.expiresAt > body.expiresAt) throw fail();
    return rows;
  };
  const verify = async (goal: OriginalCatalogGoal, operationKey: string, nextInputHash: string, sql: Native, signal: AbortSignal) => {
    live(sql,signal); const old = captureOriginalMcpCatalogGoal(goal), id = originalCatalogGoalIntentId(operationKey,old.owner), a = await read(id,sql,signal);
    if (!a || !isDeepStrictEqual(a.oldGoal,old) || a.newGoal.target.originalInputHash !== nextInputHash) throw fail();
    const past = await history(old.target.goalId,sql,signal);
    if (!past || !isDeepStrictEqual(past.goal,old) || past.adoptionId !== id || past.adoptionHash !== a.recordHash
      || !isDeepStrictEqual(a.newGoal,await goals.readOwnerIn(old.owner,sql,signal)) || !isDeepStrictEqual(a.settlement,settled(await settlement.readIn(old,sql,signal),old))) throw fail();
    await adopted(a,sql,signal,true); live(sql,signal);
    if (!isDeepStrictEqual(a,await read(id,sql,signal))) throw fail(); return a;
  };
  return Object.freeze({
    async prepareIn(raw: OriginalAcceptedCatalogGoalIntent, rawGoal: OriginalCatalogGoal, sql: Native, signal: AbortSignal) {
      live(sql,signal); const fields = object(raw,['id','operationKey','goalId','goalRecordHash','nextInputHash','recordHash','expiresAt','observation','retryable']);
      const intent = Object.freeze({ ...fields }) as unknown as OriginalAcceptedCatalogGoalIntent, goal = captureOriginalMcpCatalogGoal(rawGoal);
      if (typeof intent.operationKey !== 'string' || intent.id !== originalCatalogGoalIntentId(intent.operationKey,goal.owner) || intent.goalId !== goal.target.goalId || intent.goalRecordHash !== goal.recordHash
        || !digest(intent.nextInputHash) || !digest(intent.recordHash) || !Number.isSafeInteger(intent.expiresAt) || intent.expiresAt <= Date.now()/1000
        || intent.observation !== 'trusted_web_intent_not_goal_completion_or_adoption' || intent.retryable !== false) throw fail();
      const originalRows = await intentRow(intent,goal,sql,signal), existing = await read(intent.id,sql,signal);
      if (existing) {
        if (existing.intentRecordHash !== intent.recordHash) throw fail(); return verify(goal,intent.operationKey,intent.nextInputHash,sql,signal);
      }
      if (!isDeepStrictEqual(goal,await goals.readOwnerIn(goal.owner,sql,signal)) || await history(goal.target.goalId,sql,signal)) throw fail();
      const completed = settled(await settlement.readIn(goal,sql,signal),goal); live(sql,signal);
      // The Web owner explicitly ends the catalog goal, not the business outcome.
      // A new UUID is generated ONLY under this accepted original transition.
      const body = { ownerKey:goal.ownerKey,owner:goal.owner,authorityHash:goal.authorityHash,target:{ ...goal.target,goalId:randomUUID(),originalInputHash:intent.nextInputHash } };
      const newGoal = captureOriginalMcpCatalogGoal({ ...body,recordHash:captureMcpReadInput(body).inputHash });
      const draft = { version:'catalog-goal-adoption-1' as const,id:intent.id,operationKey:intent.operationKey,intentRecordHash:intent.recordHash,oldGoal:goal,newGoal,settlement:completed,adoptedAt:Math.floor(Date.now()/1000) };
      const a = captureOriginalCatalogGoalAdoption({ ...draft,recordHash:captureMcpReadInput(draft).inputHash });
      const receiptCount = await sql.$executeRaw`INSERT INTO mcp_catalog_goal_adoptions (id, ownerKey, operationKey, userId, tenantId, workspaceId, oldGoalId, newGoalId, intentRecordHash, recordHash, recordJson) VALUES (${a.id}, ${goal.ownerKey}, ${a.operationKey}, ${goal.owner.userId}, ${goal.owner.tenantId}, ${goal.owner.workspaceId}, ${goal.target.goalId}, ${newGoal.target.goalId}, ${a.intentRecordHash}, ${a.recordHash}, ${JSON.stringify(a)})`;
      live(sql,signal); if (receiptCount !== 1) throw fail();
      const historyCount = await sql.$executeRaw`INSERT INTO mcp_catalog_goal_history (goalId, ownerKey, recordHash, adoptionId, adoptionHash, recordJson) VALUES (${goal.target.goalId}, ${goal.ownerKey}, ${goal.recordHash}, ${a.id}, ${a.recordHash}, ${JSON.stringify(goal)})`;
      live(sql,signal); if (historyCount !== 1) throw fail();
      const currentCount = await sql.$executeRaw`UPDATE mcp_read_catalog_goals SET goalId = ${newGoal.target.goalId}, recordHash = ${newGoal.recordHash}, recordJson = ${JSON.stringify(body)} WHERE ownerKey = ${goal.ownerKey} AND goalId = ${goal.target.goalId} AND recordHash = ${goal.recordHash}`;
      live(sql,signal); if (currentCount !== 1) throw fail();
      await admitted(newGoal,sql,signal); live(sql,signal); await adopted(a,sql,signal); live(sql,signal);
      if (intent.expiresAt <= Date.now()/1000 || !isDeepStrictEqual(originalRows,await intentRow(intent,goal,sql,signal))) throw fail();
      return verify(goal,intent.operationKey,intent.nextInputHash,sql,signal);
    },
    async readIn(id: string,sql: Native,signal: AbortSignal) {
      const a = await read(id,sql,signal); if (!a) return undefined;
      const past = await history(a.oldGoal.target.goalId,sql,signal);
      if (!past || !isDeepStrictEqual(past.goal,a.oldGoal) || past.adoptionId !== id || past.adoptionHash !== a.recordHash) throw fail();
      await adopted(a,sql,signal,true); live(sql,signal);
      if (!isDeepStrictEqual(a,await read(id,sql,signal))) throw fail(); return a;
    },
    async readHistoricalIn(id: string,sql: Native,signal: AbortSignal) {
      const h = await history(id,sql,signal); if (!h) return undefined;
      const a = await read(h.adoptionId,sql,signal); if (!a || a.recordHash !== h.adoptionHash || !isDeepStrictEqual(a.oldGoal,h.goal)) throw fail();
      await adopted(a,sql,signal,true); live(sql,signal); return h.goal;
    },
    verifyIn: verify,
  });
}
