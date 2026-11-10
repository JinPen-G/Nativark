/** Trusted Web catalog-goal intents and separately configured adoption POST.
 * Original owner supplies current Auth/grant/Guard/applicable verification in its
 * Native. Ordinary intent methods do not adopt; the optional original participant
 * requires fresh settlement/history/CAS. No budget refund/reset, business approval,
 * automatic rollover/retry, listener or model-facing goal management tool. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { aiCatalogReadInputSchema } from '@rental-os/shared';
import { captureMcpReadInput } from './persistent-read-accounting.js';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { captureOriginalMcpCatalogGoal } from './prisma-mcp-catalog-goals.js';
import type { OriginalCatalogGoal } from './prisma-mcp-catalog-goals.js';
import type { OAuthConsentBrowserPrincipal } from './prisma-oauth-web-consent.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';
import type { PrismaMcpCatalogGoalAdoptions, OriginalCatalogGoalAdoption } from './prisma-mcp-catalog-goal-adoptions.js';

export interface OriginalCatalogGoalIntentCurrent {
  principal: OAuthConsentBrowserPrincipal; goal: OriginalCatalogGoal;
  policyHash: string; expiresAt: number;
}
export interface OriginalCatalogGoalIntentAudit {
  id: string; operationKey: string; userId: string; tenantId: string; workspaceId: string;
  goalId: string; recordHash: string; revision: 1 | 2; state: 'pending' | 'accepted' | 'denied';
}
export interface OriginalCatalogGoalIntentAuthority<Native extends OAuthSqlTransaction> {
  /** Must own and CONFIRM its original current-grant/Auth/Guard transaction.
   * Locate separately, then grant -> Auth -> goal. No model identity or fake token. */
  withCurrent<T>(browser: Request, request: { operationKey: string; nextInput: unknown }, signal: AbortSignal,
    consume: (current: OriginalCatalogGoalIntentCurrent, native: Native, signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Independent current Web-owner history read, not new issuance/MFA permission. */
  withOwner<T>(browser: Request, signal: AbortSignal,
    consume: (owner: OAuthConsentBrowserPrincipal, native: Native, signal: AbortSignal) => Promise<T>): Promise<T>;
  audit(native: Native, input: OriginalCatalogGoalIntentAudit, signal: AbortSignal, requireExisting?: boolean): Promise<void>;
  /** Optional ORIGINAL adoption path; absent never falls back to ordinary intent
   * authority. Final current goal must match the actual history/adoption receipt. */
  withTransition?<T>(browser: Request, request: { operationKey: string; nextInput: unknown }, signal: AbortSignal,
    consume: (current: OriginalCatalogGoalIntentCurrent, native: Native, signal: AbortSignal) => Promise<T>): Promise<T>;
  adoption?: PrismaMcpCatalogGoalAdoptions<Native>;
}
export type CatalogGoalAdoptionStatus = { state: 'not_observed'; retryable: false }
  | { state: 'observed'; operationKey: string; closedGoalId: string; adoptedGoalId: string;
      observation: 'catalog_frontier_transition_not_business_completion'; retryable: false };
export type CatalogGoalIntentReceipt =
  | { state: 'not_observed'; retryable: false }
  | { state: 'observed'; operationKey: string; revision: 1 | 2; decision: 'pending' | 'accepted' | 'denied'; retryable: false; adoption?: CatalogGoalAdoptionStatus };
export interface OriginalAcceptedCatalogGoalIntent {
  id: string; operationKey: string; goalId: string; goalRecordHash: string; nextInputHash: string;
  recordHash: string; expiresAt: number;
  observation: 'trusted_web_intent_not_goal_completion_or_adoption'; retryable: false;
}
export class CatalogGoalIntentError extends Error {
  constructor(readonly kind: 'invalid' | 'denied' | 'conflict' | 'unavailable' | 'unknown') {
    super('Catalog goal intent ' + kind); this.name = 'CatalogGoalIntentError';
  }
}
const fail = (kind: CatalogGoalIntentError['kind']) => new CatalogGoalIntentError(kind);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const key = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const limits = { stringCharacters: 32768, arrayItems: 50 };
function object(raw: unknown, names: readonly string[]) {
  if (typeof raw === 'string') { if (Buffer.byteLength(raw, 'utf8') > 32768) throw fail('unavailable'); raw = JSON.parse(raw); }
  const copy = snapshotJson(raw, limits);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy) || Object.keys(copy).length !== names.length) throw fail('unavailable');
  return snapshotJsonFields(copy, names, limits);
}
function principal(raw: unknown): OAuthConsentBrowserPrincipal {
  const p = object(raw, ['userId','tenantId','workspaceId','audience','sessionId','expiresAt']);
  if (![p.userId,p.tenantId,p.workspaceId,p.sessionId].every(id) || p.audience !== 'operator' || !positive(p.expiresAt)) throw fail('denied');
  return Object.freeze(p) as unknown as OAuthConsentBrowserPrincipal;
}
const fixedOwner = (p: OAuthConsentBrowserPrincipal) => ({ userId: p.userId, tenantId: p.tenantId, workspaceId: p.workspaceId, audience: p.audience, sessionId: p.sessionId });
const request = (raw: unknown) => {
  const r = object(raw, ['operationKey','nextInput']); if (!key(r.operationKey)) throw fail('invalid');
  const input = captureMcpReadInput(r.nextInput), parsed = aiCatalogReadInputSchema.safeParse(input.input);
  if (!parsed.success || parsed.data.limit > 50) throw fail('invalid');
  return Object.freeze({ operationKey: r.operationKey, nextInput: input.input, nextInputHash: input.inputHash });
};
type Draft = { operationKey: string; owner: ReturnType<typeof fixedOwner>; goal: OriginalCatalogGoal; nextInputHash: string; policyHash: string; expiresAt: number };
type Row = OriginalCatalogGoalIntentAudit & { ownerKey: string; sessionId: string; goalRecordHash: string; nextInputHash: string; nonceHash: string; decidedAt: number | null; draft: Draft };
/** Stable ORIGINAL Web key; a locator only, never proof of identity or decision. */
export const originalCatalogGoalIntentId = (operationKey: string, owner: Pick<OAuthConsentBrowserPrincipal,'userId'|'tenantId'|'workspaceId'>) => {
  if (!key(operationKey) || ![owner?.userId,owner?.tenantId,owner?.workspaceId].every(id)) throw fail('invalid');
  return captureMcpReadInput({ kind: 'original_catalog_goal_intent', operationKey, userId: owner.userId, tenantId: owner.tenantId, workspaceId: owner.workspaceId }).inputHash;
};
const originalId = originalCatalogGoalIntentId;
const auditInput = (r: Row): OriginalCatalogGoalIntentAudit => ({ id: r.id, operationKey: r.operationKey, userId: r.userId, tenantId: r.tenantId, workspaceId: r.workspaceId, goalId: r.goalId, recordHash: r.recordHash, revision: r.revision, state: r.state });
const receipt = (r?: Row): CatalogGoalIntentReceipt => r ? { state: 'observed', operationKey: r.operationKey, revision: r.revision, decision: r.state, retryable: false } : { state: 'not_observed', retryable: false };

export function createPrismaMcpCatalogGoalIntents<Native extends OAuthSqlTransaction>(
  config: { prepareEndpoint: string; decideEndpoint: string; receiptEndpoint: string; adoptEndpoint?: string }, authority: OriginalCatalogGoalIntentAuthority<Native>
) {
  const urls = [config.prepareEndpoint,config.decideEndpoint,config.receiptEndpoint];
  if (config.adoptEndpoint !== undefined) urls.push(config.adoptEndpoint);
  const routes = urls.map(raw => { const u = new URL(raw);
    if (u.protocol !== 'https:' || u.href !== raw || u.username || u.password || u.search || u.hash || raw.length > 2048) throw fail('invalid'); return u; });
  if (new Set(routes.map(u => u.origin)).size !== 1 || new Set(routes.map(u => u.pathname)).size !== routes.length
    || typeof authority?.withCurrent !== 'function' || typeof authority.withOwner !== 'function' || typeof authority.audit !== 'function') throw fail('unavailable');
  const current = authority.withCurrent.bind(authority),owner = authority.withOwner.bind(authority),audit = authority.audit.bind(authority);
  const enabledAdoption = config.adoptEndpoint !== undefined;
  if (enabledAdoption && (typeof authority.withTransition !== 'function' || typeof authority.adoption?.prepareIn !== 'function'
    || typeof authority.adoption.readIn !== 'function' || typeof authority.adoption.verifyIn !== 'function')) throw fail('unavailable');
  const transition = enabledAdoption ? authority.withTransition!.bind(authority) : undefined;
  const prepareAdoption = enabledAdoption ? authority.adoption!.prepareIn.bind(authority.adoption) : undefined;
  const readAdoption = enabledAdoption ? authority.adoption!.readIn.bind(authority.adoption) : undefined;
  const adoptionStatus = (a?: OriginalCatalogGoalAdoption): CatalogGoalAdoptionStatus => a ? { state:'observed',operationKey:a.operationKey,
    closedGoalId:a.oldGoal.target.goalId,adoptedGoalId:a.newGoal.target.goalId,observation:'catalog_frontier_transition_not_business_completion',retryable:false } : { state:'not_observed',retryable:false };
  const live = (native: Native, signal: AbortSignal) => { if (!native || '$transaction' in native || typeof native.$queryRaw !== 'function' || signal.aborted) throw fail('unavailable'); };
  const route = (browser: Request, n: number) => {
    if (!(browser instanceof Request)) throw fail('invalid'); const u = new URL(browser.url),expected = routes[n];
    if (!expected) throw fail('unavailable');
    if (browser.method !== (n === 2 ? 'GET' : 'POST') || u.origin !== expected.origin || u.pathname !== expected.pathname || u.username || u.password || u.hash || u.search || browser.headers.has('cookie')) throw fail('invalid');
    const origin = browser.headers.get('origin'), site = browser.headers.get('sec-fetch-site');
    if (n !== 2 && origin !== expected.origin || origin !== null && origin !== expected.origin || site !== null && !['same-origin','none'].includes(site)) throw fail('denied');
  };
  const body = async (browser: Request, signal: AbortSignal) => {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get('content-type') ?? '')) throw fail('invalid');
    const reader = browser.body?.getReader(); if (!reader) throw fail('invalid');
    const chunks: Uint8Array[] = []; let size = 0; const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try { for (;;) { if (signal.aborted) throw fail('unavailable'); const part = await reader.read(); if (signal.aborted) throw fail('unavailable'); if (part.done) break;
      size += part.value.byteLength; if (size > 4096) { cancel(); throw fail('invalid'); } chunks.push(part.value); }
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw fail('invalid'); }
  };
  const row = async (sql: Native, operationKey: string, p: OAuthConsentBrowserPrincipal, signal: AbortSignal): Promise<Row | undefined> => {
    live(sql, signal); const expected = originalId(operationKey, p);
    const rows = snapshotJson(await sql.$queryRaw<unknown[]>`SELECT id, operationKey, ownerKey, userId, tenantId, workspaceId, sessionId, goalId, goalRecordHash, nextInputHash, recordHash, nonceHash, revision, state, CAST(decidedAt AS DOUBLE) AS decidedAt, recordJson FROM mcp_catalog_goal_intents WHERE id = ${expected} FOR UPDATE NOWAIT`, limits);
    live(sql, signal); if (!Array.isArray(rows) || rows.length > 1) throw fail('unavailable'); if (!rows.length) return undefined;
    const r = object(rows[0], ['id','operationKey','ownerKey','userId','tenantId','workspaceId','sessionId','goalId','goalRecordHash','nextInputHash','recordHash','nonceHash','revision','state','decidedAt','recordJson']);
    const d = object(r.recordJson, ['operationKey','owner','goal','nextInputHash','policyHash','expiresAt']), g = captureOriginalMcpCatalogGoal(d.goal);
    const o = object(d.owner, ['userId','tenantId','workspaceId','audience','sessionId']);
    if (r.id !== expected || r.operationKey !== operationKey || d.operationKey !== operationKey || r.userId !== p.userId || r.tenantId !== p.tenantId || r.workspaceId !== p.workspaceId
      || o.userId !== r.userId || o.tenantId !== r.tenantId || o.workspaceId !== r.workspaceId || o.sessionId !== r.sessionId || o.audience !== 'operator' || !id(o.sessionId)
      || g.owner.userId !== r.userId || g.owner.tenantId !== r.tenantId || g.owner.workspaceId !== r.workspaceId || r.ownerKey !== g.ownerKey || r.goalId !== g.target.goalId || r.goalRecordHash !== g.recordHash
      || !digest(d.nextInputHash) || r.nextInputHash !== d.nextInputHash || !digest(d.policyHash) || !positive(d.expiresAt) || !digest(r.nonceHash) || !digest(r.recordHash)
      || captureMcpReadInput(d).inputHash !== r.recordHash || (r.state === 'pending' ? r.revision !== 1 || r.decidedAt !== null : !['accepted','denied'].includes(r.state as string) || r.revision !== 2 || !positive(r.decidedAt))) throw fail('unavailable');
    return { ...r, draft: { ...d, goal: g, owner: o } } as unknown as Row;
  };
  const checked = (raw: OriginalCatalogGoalIntentCurrent): OriginalCatalogGoalIntentCurrent => {
    const v = object(raw, ['principal','goal','policyHash','expiresAt']), p = principal(v.principal), g = captureOriginalMcpCatalogGoal(v.goal);
    if (!digest(v.policyHash) || !positive(v.expiresAt) || v.expiresAt > p.expiresAt || v.expiresAt <= Date.now() / 1000 || p.userId !== g.owner.userId || p.tenantId !== g.owner.tenantId || p.workspaceId !== g.owner.workspaceId) throw fail('denied');
    return Object.freeze({ principal: p, goal: g, policyHash: v.policyHash, expiresAt: v.expiresAt });
  };
  const check = (r: Row, c: OriginalCatalogGoalIntentCurrent, nextInputHash: string) => {
    if (!isDeepStrictEqual(r.draft.owner, snapshotJson(fixedOwner(c.principal), limits)) || !isDeepStrictEqual(r.draft.goal, c.goal) || r.nextInputHash !== nextInputHash
      || r.draft.policyHash !== c.policyHash || r.draft.expiresAt <= Date.now() / 1000) throw fail('denied');
  };
  return Object.freeze({
    async prepare(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try { route(browser, 0); const input = request(await body(browser, signal));
        return await current(browser, input, signal, async (raw, sql, stop) => {
          entered = true; live(sql, stop); const c = checked(raw), existing = await row(sql, input.operationKey, c.principal, stop);
          if (existing) { check(existing, c, input.nextInputHash); await audit(sql, auditInput(existing), stop, true); live(sql, stop); return receipt(existing); }
          const nonce = randomBytes(32).toString('base64url'), nonceHash = createHash('sha256').update(nonce).digest('hex');
          const d: Draft = { operationKey: input.operationKey, owner: fixedOwner(c.principal), goal: c.goal, nextInputHash: input.nextInputHash, policyHash: c.policyHash, expiresAt: c.expiresAt };
          const recordHash = captureMcpReadInput(d).inputHash, value = originalId(input.operationKey, c.principal);
          const count = await sql.$executeRaw`INSERT INTO mcp_catalog_goal_intents (id, operationKey, ownerKey, userId, tenantId, workspaceId, sessionId, goalId, goalRecordHash, nextInputHash, recordHash, nonceHash, revision, state, decidedAt, recordJson) VALUES (${value}, ${input.operationKey}, ${c.goal.ownerKey}, ${c.principal.userId}, ${c.principal.tenantId}, ${c.principal.workspaceId}, ${c.principal.sessionId}, ${c.goal.target.goalId}, ${c.goal.recordHash}, ${input.nextInputHash}, ${recordHash}, ${nonceHash}, ${1}, ${'pending'}, ${null}, ${JSON.stringify(d)})`;
          live(sql, stop); if (count !== 1) throw fail('conflict'); const saved = await row(sql, input.operationKey, c.principal, stop);
          if (!saved || saved.state !== 'pending' || saved.recordHash !== recordHash || saved.nonceHash !== nonceHash) throw fail('unavailable');
          await audit(sql, auditInput(saved), stop); live(sql, stop);
          if (!isDeepStrictEqual(saved, await row(sql, input.operationKey, c.principal, stop))) throw fail('unavailable');
          return { state: 'prepared' as const, operationKey: input.operationKey, revision: 1 as const, nonce, goalId: c.goal.target.goalId, expiresAt: d.expiresAt };
        });
      } catch (error) { if (error instanceof CatalogGoalIntentError && ['invalid','denied','conflict'].includes(error.kind)) throw error; throw fail(entered ? 'unknown' : 'unavailable'); }
    },
    async decide(browser: Request, nextInput: unknown, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try { route(browser, 1); const v = object(await body(browser, signal), ['operationKey','expectedRevision','decision','nonce']);
        if (!key(v.operationKey) || v.expectedRevision !== 1 || !['accept','deny'].includes(v.decision as string) || typeof v.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.nonce) || Buffer.from(v.nonce, 'base64url').toString('base64url') !== v.nonce) throw fail('invalid');
        const input = request({ operationKey: v.operationKey, nextInput }), decision = v.decision === 'accept' ? 'accepted' : 'denied', nonce = v.nonce;
        return await current(browser, input, signal, async (raw, sql, stop) => {
          entered = true; live(sql, stop); const c = checked(raw), saved = await row(sql, input.operationKey, c.principal, stop); if (!saved) throw fail('denied'); check(saved, c, input.nextInputHash);
          const expected = Buffer.from(saved.nonceHash, 'hex'), supplied = createHash('sha256').update(nonce).digest(); if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw fail('denied');
          if (saved.state !== 'pending' && saved.state !== decision) throw fail('conflict');
          // Existing completed rows are historical evidence, not permission to replay.
          await audit(sql, auditInput(saved), stop, true); live(sql, stop);
          if (saved.state === 'pending') {
            const count = await sql.$executeRaw`UPDATE mcp_catalog_goal_intents SET revision = ${2}, state = ${decision}, decidedAt = ${Math.floor(Date.now() / 1000)} WHERE id = ${saved.id} AND revision = ${1} AND state = ${'pending'}`;
            live(sql, stop); if (count !== 1) throw fail('conflict'); const recorded = await row(sql, input.operationKey, c.principal, stop);
            if (!recorded || recorded.state !== decision || recorded.recordHash !== saved.recordHash) throw fail('unavailable');
            await audit(sql, auditInput(recorded), stop); live(sql, stop);
          }
          const result = await row(sql, input.operationKey, c.principal, stop); if (!result || result.state !== decision || result.revision !== 2 || result.recordHash !== saved.recordHash) throw fail('unavailable');
          return receipt(result);
        });
      } catch (error) { if (error instanceof CatalogGoalIntentError && ['invalid','denied','conflict'].includes(error.kind)) throw error; throw fail(entered ? 'unknown' : 'unavailable'); }
    },
    /** Separately configured same-origin POST only. An accepted decision is not
     * adopted on GET or by an automatic quota/expiry/token rollover. */
    async adopt(browser: Request,signal: AbortSignal): Promise<CatalogGoalAdoptionStatus> {
      signal=AbortSignal.any([signal,browser.signal]);let entered=false;
      try {
        route(browser,3);if (!transition || !prepareAdoption || !readAdoption) throw fail('unavailable');
        const v=object(await body(browser,signal),['operationKey','nextInput','expectedRevision','nonce']);
        if (v.expectedRevision !== 2 || typeof v.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.nonce) || Buffer.from(v.nonce,'base64url').toString('base64url') !== v.nonce) throw fail('invalid');
        const input=request({ operationKey:v.operationKey,nextInput:v.nextInput }),nonce=v.nonce;
        const nonceMatches=(r: Row) => {
          const supplied=createHash('sha256').update(nonce).digest(),expected=Buffer.from(r.nonceHash,'hex');
          if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) throw fail('denied');
        };
        // Original receipt first: an already adopted key is only observed. This
        // is NOT a missing-receipt proof of rollback or permission to change keys.
        const previous=await owner(browser,signal,async(raw,sql,stop)=>{
          const p=principal(raw),r=await row(sql,input.operationKey,p,stop);
          if (!r || r.state !== 'accepted' || r.nextInputHash !== input.nextInputHash) throw fail('denied');nonceMatches(r);
          await audit(sql,auditInput(r),stop,true);live(sql,stop);
          const a=await readAdoption!(r.id,sql,stop);live(sql,stop);
          if (a && (a.intentRecordHash !== r.recordHash || !isDeepStrictEqual(a.oldGoal,r.draft.goal) || a.newGoal.target.originalInputHash !== input.nextInputHash)) throw fail('denied');
          if (!isDeepStrictEqual(r,await row(sql,input.operationKey,p,stop))) throw fail('unavailable');return a;
        });
        if (previous) return adoptionStatus(previous);
        const a=await transition(browser,input,signal,async(raw,sql,stop)=>{
          entered=true;live(sql,stop);const c=checked(raw),r=await row(sql,input.operationKey,c.principal,stop);
          if (!r || r.state !== 'accepted') throw fail('denied');check(r,c,input.nextInputHash);nonceMatches(r);
          await audit(sql,auditInput(r),stop,true);live(sql,stop);
          const intent: OriginalAcceptedCatalogGoalIntent=Object.freeze({ id:r.id,operationKey:r.operationKey,goalId:r.goalId,goalRecordHash:r.goalRecordHash,nextInputHash:r.nextInputHash,
            recordHash:r.recordHash,expiresAt:Math.min(r.draft.expiresAt,c.expiresAt),observation:'trusted_web_intent_not_goal_completion_or_adoption',retryable:false });
          const result=await prepareAdoption!(intent,c.goal,sql,stop);live(sql,stop);
          if (!isDeepStrictEqual(r,await row(sql,input.operationKey,c.principal,stop))) throw fail('unavailable');return result;
        });
        if (signal.aborted) throw fail('unknown');return adoptionStatus(a);
      } catch (error) {
        if (error instanceof CatalogGoalIntentError && ['invalid','denied','conflict'].includes(error.kind)) throw error;
        throw fail(entered ? 'unknown' : 'unavailable');
      }
    },
    async receipt(operationKey: string, browser: Request, signal: AbortSignal): Promise<CatalogGoalIntentReceipt> {
      signal = AbortSignal.any([signal, browser.signal]); route(browser, 2); if (!key(operationKey)) throw fail('invalid');
      try { return await owner(browser, signal, async (raw, sql, stop) => {
        const p = principal(raw); live(sql, stop); if (p.expiresAt <= Date.now() / 1000) throw fail('denied');
        const saved = await row(sql, operationKey, p, stop); if (saved) await audit(sql, auditInput(saved), stop, true); live(sql, stop);
        let a: OriginalCatalogGoalAdoption | undefined;
        if (readAdoption && saved) {
          a=await readAdoption(saved.id,sql,stop);live(sql,stop);
          if (a && (saved.state !== 'accepted' || a.intentRecordHash !== saved.recordHash || !isDeepStrictEqual(a.oldGoal,saved.draft.goal) || a.newGoal.target.originalInputHash !== saved.nextInputHash)) throw fail('unavailable');
        }
        if (!isDeepStrictEqual(saved,await row(sql,operationKey,p,stop))) throw fail('unavailable');
        const result=receipt(saved);return readAdoption && result.state === 'observed' ? { ...result,adoption:adoptionStatus(a) } : result;
      }); } catch { throw fail('unavailable'); }
    },
    source: Object.freeze({
      /** Internal current-owner evidence callback only; NOT bearer-like approval.
       * The current authority still fences the unchanged old goal. Actual adoption
       * needs its own authorized transition fence and fresh settlement/history/CAS.
       * This function neither consumes an intent nor closes/creates a goal. */
      async withAccepted<T>(operationKey: string, nextInput: unknown, browser: Request, signal: AbortSignal,
        consume: (intent: OriginalAcceptedCatalogGoalIntent, goal: OriginalCatalogGoal, native: Native, signal: AbortSignal) => Promise<T>): Promise<T> {
        signal = AbortSignal.any([signal, browser.signal]); route(browser, 2); if (typeof consume !== 'function') throw fail('invalid');
        const input = request({ operationKey, nextInput });
        return current(browser, input, signal, async (raw, sql, stop) => {
          const c = checked(raw), saved = await row(sql, input.operationKey, c.principal, stop); if (!saved || saved.state !== 'accepted') throw fail('denied'); check(saved, c, input.nextInputHash);
          await audit(sql, auditInput(saved), stop, true); live(sql, stop);
          const intent: OriginalAcceptedCatalogGoalIntent = Object.freeze({ id: saved.id, operationKey, goalId: saved.goalId, goalRecordHash: saved.goalRecordHash, nextInputHash: saved.nextInputHash,
            recordHash: saved.recordHash, expiresAt: Math.min(saved.draft.expiresAt,c.expiresAt), observation: 'trusted_web_intent_not_goal_completion_or_adoption', retryable: false });
          const result = await consume(intent, c.goal, sql, stop); live(sql, stop);
          if (!isDeepStrictEqual(saved, await row(sql, input.operationKey, c.principal, stop))) throw fail('unavailable'); return result;
        });
      },
    }),
  });
}
