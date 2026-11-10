/** Original Web owner/current MCP grant/catalog Guard for catalog transitions.
 * Short locator commits first, then grant -> Auth/Guard -> original goal fences.
 * Ordinary intent callbacks must keep the old goal; a configured adoption path
 * must prove its exact same-Native history/receipt/new frontier before commit.
 * No synthetic resource token, manager fallback, second role/MFA/approval system. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { captureMcpReadInput } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { createPrismaMcpCatalogGoals, OriginalCatalogGoal, ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION } from '@rental-os/mcp-server/prisma-mcp-catalog-goals' with { 'resolution-mode': 'import' };
import type { OriginalCatalogGoalIntentAuthority, OriginalCatalogGoalIntentCurrent, OriginalCatalogGoalIntentAudit } from '@rental-os/mcp-server/prisma-mcp-catalog-goal-intents' with { 'resolution-mode': 'import' };
import type { createPrismaMcpCatalogGoalAdoptions } from '@rental-os/mcp-server/prisma-mcp-catalog-goal-adoptions' with { 'resolution-mode': 'import' };
import { aiCatalogReadInputSchema } from '@rental-os/shared';
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { OperationLogService } from '../../common/operation-log.service';
import type { OriginalMcpOAuthCore } from './original-mcp-oauth-core';
import type { TrustedBrowserPrincipal } from './trusted-browser-principal';
import { createOriginalMcpBrowserIdentity } from './original-mcp-browser-identity';
import { originalMcpCatalogGoalAuthorityHash } from './original-mcp-catalog-goals';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export interface OriginalCatalogGoalIntentVerification {
  kind: 'satisfied' | 'not_required'; reference: string; revision: number; expiresAt: number;
  userId: string; tenantId: string; workspaceId: string; sessionId: string;
  operationKey: string; goalRecordHash: string; nextInputHash: string;
}
export interface OriginalCatalogGoalIntentVerificationSource {
  /** Independently read/locked original applicability/completed evidence for this
   * goal intent. Explicit not_required requires original policy. No MFA execution. */
  current(native: Prisma.TransactionClient, principal: TrustedBrowserPrincipal,
    goal: OriginalCatalogGoal, operationKey: string, nextInputHash: string, signal: AbortSignal): Promise<OriginalCatalogGoalIntentVerification | undefined>;
}
const fail = () => new Error('Original catalog goal intent authority unavailable');
export function createOriginalMcpCatalogGoalIntentAuthority(mcp: {
  captureMcpReadInput: typeof captureMcpReadInput; createPrismaMcpCatalogGoals: typeof createPrismaMcpCatalogGoals;
  ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION: typeof ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION;
  /** Optional original SQL adoption producer. Missing never becomes a rollover. */
  createPrismaMcpCatalogGoalAdoptions?: typeof createPrismaMcpCatalogGoalAdoptions;
}, config: { requiredToolScopes: readonly string[]; allowedScopes: readonly string[] },
  original: Pick<OriginalMcpOAuthCore,'store'|'grantAuthority'>,
  auth: Pick<AuthService,'resolveTrustedBrowserPrincipal'|'withTrustedWorkspacePrincipal'>,
  guard: Pick<ApiAuthGuard,'withTrustedCatalogRead'>,
  logs: Pick<OperationLogService,'recordOriginalMcpReadGoalAudit'|'recordOriginalMcpCatalogGoalIntentAudit'> & Partial<Pick<OperationLogService,'recordOriginalMcpCatalogGoalAdoptionAudit'>>,
  verification: OriginalCatalogGoalIntentVerificationSource
): OriginalCatalogGoalIntentAuthority<Prisma.TransactionClient> {
  if (typeof mcp?.captureMcpReadInput !== 'function' || typeof mcp.createPrismaMcpCatalogGoals !== 'function' || mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION !== 'catalog-admission-1'
    || typeof original?.store?.transaction !== 'function' || typeof original.store.native !== 'function' || typeof original.grantAuthority?.access?.current !== 'function' || typeof original.grantAuthority.principal !== 'function'
    || typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof guard?.withTrustedCatalogRead !== 'function' || typeof logs?.recordOriginalMcpReadGoalAudit !== 'function'
    || typeof logs.recordOriginalMcpCatalogGoalIntentAudit !== 'function' || typeof verification?.current !== 'function') throw fail();
  const required = [...config.requiredToolScopes], allowed = [...config.allowedScopes];
  if (!required.length || required.length > 32 || new Set(required).size !== required.length || required.some(v => typeof v !== 'string' || !allowed.includes(v))) throw fail();
  const identity = createOriginalMcpBrowserIdentity(auth), capture = mcp.captureMcpReadInput.bind(mcp), run = original.store.transaction.bind(original.store), native = original.store.native.bind(original.store);
  const access = original.grantAuthority.access.current.bind(original.grantAuthority.access), binding = original.grantAuthority.principal.bind(original.grantAuthority);
  const withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth), withCatalog = guard.withTrustedCatalogRead.bind(guard), verify = verification.current.bind(verification);
  const record = logs.recordOriginalMcpReadGoalAudit.bind(logs), intentAudit = logs.recordOriginalMcpCatalogGoalIntentAudit.bind(logs), policyVersion = mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION;
  const goals = mcp.createPrismaMcpCatalogGoals<Prisma.TransactionClient>({ admitted: async () => { throw fail(); }, published: async () => { throw fail(); } });
  const own = (p: TrustedBrowserPrincipal, g: OriginalCatalogGoal) => p.audience === 'operator' && p.userId === g.owner.userId && p.tenantId === g.owner.tenantId && p.workspaceId === g.owner.workspaceId;
  const admitted = (g: OriginalCatalogGoal, sql: Prisma.TransactionClient, stop: AbortSignal, requireExisting = true) => record(sql, { kind: 'admitted', goalId: g.target.goalId, ownerKey: g.ownerKey,
    userId: g.owner.userId, tenantId: g.owner.tenantId, workspaceId: g.owner.workspaceId, grantId: g.owner.grantId, grantRevision: g.owner.grantRevision,
    authorityHash: g.authorityHash, recordHash: g.recordHash, bindingKeys: [] }, stop, requireExisting);
  if (mcp.createPrismaMcpCatalogGoalAdoptions !== undefined && (typeof mcp.createPrismaMcpCatalogGoalAdoptions !== 'function' || typeof logs.recordOriginalMcpCatalogGoalAdoptionAudit !== 'function')) throw fail();
  const adoptionAudit = logs.recordOriginalMcpCatalogGoalAdoptionAudit?.bind(logs);
  const adoption = mcp.createPrismaMcpCatalogGoalAdoptions?.<Prisma.TransactionClient>({
    admitted: (g,sql,stop) => admitted(g,sql,stop,false),
    adopted: (a,sql,stop,requireExisting = false) => {
      if (!adoptionAudit) throw fail();
      return adoptionAudit(sql,{ id:a.id,ownerKey:a.oldGoal.ownerKey,userId:a.oldGoal.owner.userId,tenantId:a.oldGoal.owner.tenantId,workspaceId:a.oldGoal.owner.workspaceId,
        oldGoalId:a.oldGoal.target.goalId,newGoalId:a.newGoal.target.goalId,recordHash:a.recordHash },stop,requireExisting);
    },
  });
  const withGoal = async <T>(browser: Request, input: { operationKey: string; nextInput: unknown }, signal: AbortSignal,
    consume: (current: OriginalCatalogGoalIntentCurrent, native: Prisma.TransactionClient, signal: AbortSignal) => Promise<T>, transition: boolean): Promise<T> => {
    const stop = AbortSignal.any([signal, browser.signal]); if (stop.aborted || typeof consume !== 'function' || transition && !adoption) throw fail();
    const captured = capture(input.nextInput), parsed = aiCatalogReadInputSchema.safeParse(captured.input);
    if (!parsed.success || parsed.data.limit > 50 || typeof input.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationKey)) throw fail();
    const operationKey = input.operationKey, nextInputHash = captured.inputHash;
    // This locator ends BEFORE current grant locks. Its Native is never a permit.
    const located = await run(async tx => {
      const sql = native(tx), p = await identity.current(browser,sql,stop); if (!p || stop.aborted) throw fail();
      const g = await goals.readOwnerIn(p,sql,stop); if (!g || !own(p,g) || stop.aborted) throw fail();
      if (!isDeepStrictEqual(p,await identity.current(browser,sql,stop))) throw fail(); return { p,g };
    },stop);
    let finalExpiresAt: number | undefined;
    const result = await run(async tx => {
      const sql = native(tx), current = await access(located.g.owner.grantId,tx,stop); if (!current || stop.aborted) throw fail();
      if (current.id !== located.g.owner.grantId || current.revision !== located.g.owner.grantRevision || current.subject !== located.g.target.subject
        || current.clientId !== located.g.target.clientId || current.resource !== located.g.target.resource || !isDeepStrictEqual(current.scopes,located.g.target.scopes)
        || required.some(v => !current.scopes.includes(v))) throw fail();
      const p = await identity.current(browser,sql,stop); if (!p || !isDeepStrictEqual(p,located.p) || !own(p,located.g) || stop.aborted) throw fail();
      const result = await withPrincipal(sql,() => binding(current.id,tx,stop),stop,resolve => withCatalog(parsed.data.limit,resolve,async who => {
        const g = await goals.readOwnerIn(p,sql,stop); if (!g || !isDeepStrictEqual(g,located.g) || stop.aborted) throw fail();
        const authorityHash = originalMcpCatalogGoalAuthorityHash({ ...who,grantId:current.id,grantRevision:current.revision },policyVersion);
        if (g.authorityHash !== authorityHash) throw fail(); await admitted(g,sql,stop);
        const v = await verify(sql,p,g,operationKey,nextInputHash,stop); if (!v || stop.aborted) throw fail();
        const copy = capture(v).input as unknown as OriginalCatalogGoalIntentVerification;
        const names = ['kind','reference','revision','expiresAt','userId','tenantId','workspaceId','sessionId','operationKey','goalRecordHash','nextInputHash'];
        if (Object.keys(copy).length !== names.length || names.some(k => !Object.hasOwn(copy,k)) || !['satisfied','not_required'].includes(copy.kind)
          || typeof copy.reference !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(copy.reference) || !Number.isSafeInteger(copy.revision) || copy.revision < 1 || copy.revision > 2147483647
          || !Number.isSafeInteger(copy.expiresAt) || copy.expiresAt <= Date.now()/1000 || copy.userId !== p.userId || copy.tenantId !== p.tenantId || copy.workspaceId !== p.workspaceId
          || copy.sessionId !== p.sessionId || copy.operationKey !== operationKey || copy.goalRecordHash !== g.recordHash || copy.nextInputHash !== nextInputHash) throw fail();
        const view = Object.freeze({ principal:p,goal:g,expiresAt:Math.min(p.expiresAt,current.expiresAt,copy.expiresAt),policyHash:requestFingerprint({ verification:copy,authorityHash }) });
        if (view.expiresAt <= Date.now()/1000) throw fail(); finalExpiresAt = view.expiresAt;
        const lifetime = new AbortController(), callbackSignal = AbortSignal.any([stop,lifetime.signal]); let value: T;
        try { value = await consume(view,sql,callbackSignal); } finally { lifetime.abort(); }
        if (stop.aborted || !isDeepStrictEqual(copy,capture(await verify(sql,p,g,operationKey,nextInputHash,stop)).input)
          || !isDeepStrictEqual(p,await identity.current(browser,sql,stop)) || stop.aborted || view.expiresAt <= Date.now()/1000) throw fail();
        if (transition) await adoption!.verifyIn(g,operationKey,nextInputHash,sql,stop);
        else if (!isDeepStrictEqual(g,await goals.readOwnerIn(p,sql,stop))) throw fail();
        if (stop.aborted || view.expiresAt <= Date.now()/1000) throw fail(); return value;
      },stop));
      if (stop.aborted || current.expiresAt <= Date.now()/1000 || !isDeepStrictEqual(current,await access(current.id,tx,stop))) throw fail(); return result;
    },stop);
    // Expiry while the enclosing commit is settling suppresses delivery, not
    // proof of rollback. The Web producer keeps its original unknown receipt key.
    if (stop.aborted || finalExpiresAt === undefined || finalExpiresAt <= Date.now()/1000) throw fail(); return result;
  };
  return Object.freeze({
    async withOwner<T>(browser: Request,signal: AbortSignal,consume: (owner: TrustedBrowserPrincipal,sql: Prisma.TransactionClient,signal: AbortSignal) => Promise<T>): Promise<T> {
      const stop = AbortSignal.any([signal,browser.signal]);
      return run(async tx => {
        const sql = native(tx),before = await identity.current(browser,sql,stop); if (!before || stop.aborted) throw fail();
        const lifetime = new AbortController(),callbackSignal = AbortSignal.any([stop,lifetime.signal]); let result: T;
        try { result = await consume(before,sql,callbackSignal); } finally { lifetime.abort(); }
        if (stop.aborted || !isDeepStrictEqual(before,await identity.current(browser,sql,stop))) throw fail(); return result;
      },stop);
    },
    withCurrent: <T>(browser: Request,input: { operationKey: string;nextInput: unknown },signal: AbortSignal,consume: (current: OriginalCatalogGoalIntentCurrent,native: Prisma.TransactionClient,signal: AbortSignal) => Promise<T>) => withGoal(browser,input,signal,consume,false),
    ...(adoption ? { adoption,withTransition: <T>(browser: Request,input: { operationKey: string;nextInput: unknown },signal: AbortSignal,consume: (current: OriginalCatalogGoalIntentCurrent,native: Prisma.TransactionClient,signal: AbortSignal) => Promise<T>) => withGoal(browser,input,signal,consume,true) } : {}),
    audit: (sql: Prisma.TransactionClient,input: OriginalCatalogGoalIntentAudit,stop: AbortSignal,requireExisting = false) => intentAudit(sql,input,stop,requireExisting),
  });
}
