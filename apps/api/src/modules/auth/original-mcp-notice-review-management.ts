/** Original platform/tenant review authority, applicable verification and audit.
 * No role copy, MFA challenge/executor, model confirmation or public endpoint.
 * Browser identity and management scope are re-read in the same native review
 * transaction; the review producer owns nonce/CAS/publication/commit. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPlatformIdentity, createOriginalMcpPlatformManagement } from './original-mcp-platform-management';
import { createOriginalMcpBrowserIdentity } from './original-mcp-browser-identity';
import { createOriginalMcpWorkspaceManagement } from './original-mcp-workspace-management';
import type { OAuthAdmissionTarget } from '@rental-os/mcp-server/prisma-oauth-admission-store';
import type { OAuthConsentPolicy, captureOAuthConsentPolicyTarget } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store';
import type { OAuthNoticeReviewer, OriginalOAuthNoticeReviewManagement, oauthNoticeCandidateHash, oauthNoticeScopeKey } from '@rental-os/mcp-server/prisma-oauth-notice-review';
export interface OriginalNoticeReviewVerificationEvidence {
  kind: 'satisfied' | 'not_required'; reference: string; revision: number; expiresAt: number;
  userId: string; tenantId: string; workspaceId: string | null; sessionId: string; candidateHash: string;
}
export interface OriginalNoticeReviewVerificationSource {
  /** Independently read current applicability/ORIGINAL completed evidence.
   * not_required needs original policy, not a candidate/reference/hash echo. */
  current(transaction: Prisma.TransactionClient, principal: Omit<OAuthNoticeReviewer, 'verification'>, target: OAuthAdmissionTarget,
    policy: OAuthConsentPolicy, signal: AbortSignal): Promise<OriginalNoticeReviewVerificationEvidence | undefined>;
}
const unavailable = () => new Error('Original MCP notice review management unavailable');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const ref = (v: unknown): v is string => typeof v === 'string' && /^[\x21-\x7e]{1,200}$/.test(v);
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const d = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(d).length !== names.length) throw unavailable();
  for (const name of names) { const f = d[name]; if (!f?.enumerable || !Object.hasOwn(f, 'value')) throw unavailable(); result[name] = f.value; } return result;
}
export function createOriginalMcpNoticeReviewManagement(
  captures: { candidateHash: typeof oauthNoticeCandidateHash; scopeKey: typeof oauthNoticeScopeKey; target: typeof captureOAuthConsentPolicyTarget },
  config: { resourceUrl: string },
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  verification: OriginalNoticeReviewVerificationSource
): OriginalOAuthNoticeReviewManagement<Prisma.TransactionClient> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || typeof captures?.candidateHash !== 'function' || typeof captures.scopeKey !== 'function' || typeof captures.target !== 'function'
    || typeof logs?.recordOriginalOAuthAudit !== 'function' || typeof verification?.current !== 'function') throw unavailable();
  const hash = captures.candidateHash, scopeKey = captures.scopeKey, captureTarget = captures.target, verify = verification.current.bind(verification), record = logs.recordOriginalOAuthAudit.bind(logs);
  return Object.freeze({ forRequest(browser: Request) {
    const platformIdentity = createOriginalMcpPlatformIdentity(auth, browser), browserIdentity = createOriginalMcpBrowserIdentity(auth);
    const platformManager = createOriginalMcpPlatformManagement(auth, browser), workspaceManager = createOriginalMcpWorkspaceManagement(auth, platform, browser);
    const currentIdentity = async (tx: Prisma.TransactionClient, target: OAuthAdmissionTarget, signal: AbortSignal): Promise<Omit<OAuthNoticeReviewer, 'verification'>> => {
      if (signal.aborted) throw unavailable(); target = captureTarget(target);
      const authorizer = target.kind === 'platform' ? platformManager : workspaceManager;
      const before = await authorizer.authorize(tx, { action: 'read', target }, signal); if (signal.aborted || !before) throw unavailable();
      const raw = target.kind === 'platform' ? await platformIdentity.current(tx, signal) : await browserIdentity.current(browser, tx, signal);
      if (signal.aborted || !raw) throw unavailable();
      const v = fields(raw, ['userId', 'tenantId', 'audience', 'sessionId', 'expiresAt', ...(target.kind === 'workspace' ? ['workspaceId'] : [])]);
      if (![v.userId, v.tenantId, v.sessionId].every(id) || v.userId !== before.actorId || v.audience !== 'operator' || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= Date.now() / 1000
        || target.kind === 'workspace' && (v.tenantId !== target.tenantId || v.workspaceId !== target.workspaceId)) throw unavailable();
      if (!isDeepStrictEqual(await authorizer.authorize(tx, { action: 'read', target }, signal), before) || signal.aborted) throw unavailable();
      return Object.freeze({ userId: v.userId as string, tenantId: v.tenantId as string, workspaceId: target.kind === 'workspace' ? target.workspaceId : null, audience: 'operator', sessionId: v.sessionId as string, expiresAt: v.expiresAt });
    };
    return Object.freeze<ReturnType<OriginalOAuthNoticeReviewManagement<Prisma.TransactionClient>['forRequest']>>({
      async current(tx, target, policy, signal, purpose = 'review') {
        const abort = AbortSignal.any([signal, browser.signal]);
        try {
          const before = await currentIdentity(tx, target, abort); if (purpose === 'read_receipt') return before;
          if (purpose !== 'review' || !policy || fields(policy, ['resource'], false).resource !== resource) throw unavailable(); const inputHash = hash(target, policy);
          const evidence = async () => {
            const raw = await verify(tx, before, target, policy, abort); if (abort.aborted || !raw) throw unavailable();
            const v = fields(raw, ['kind', 'reference', 'revision', 'expiresAt', 'userId', 'tenantId', 'workspaceId', 'sessionId', 'candidateHash']);
            if (!['satisfied', 'not_required'].includes(v.kind as string) || !ref(v.reference) || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647
              || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= Date.now() / 1000 || v.userId !== before.userId || v.tenantId !== before.tenantId
              || v.workspaceId !== before.workspaceId || v.sessionId !== before.sessionId || v.candidateHash !== inputHash) throw unavailable(); return v;
          };
          const verified = await evidence();
          if (!isDeepStrictEqual(await currentIdentity(tx, target, abort), before) || !isDeepStrictEqual(await evidence(), verified) || abort.aborted) throw unavailable();
          return Object.freeze({ ...before, verification: Object.freeze({ kind: verified.kind as 'satisfied' | 'not_required', reference: verified.reference as string, revision: verified.revision as number, expiresAt: verified.expiresAt as number }) });
        } catch { throw unavailable(); }
      },
      async audit(tx, input, signal) {
        const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
        try {
          live(); const v = fields(input, ['operationKey', 'target', 'actorId', 'tenantId', 'workspaceId', 'revision', 'stage']);
          if (typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey) || !['prepared', 'approved', 'denied'].includes(v.stage as string)
            || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647) throw unavailable();
          const target = captureTarget(v.target), before = await currentIdentity(tx, target, abort); live();
          if (before.userId !== v.actorId || before.tenantId !== v.tenantId || before.workspaceId !== v.workspaceId) throw unavailable();
          const rows = await tx.$queryRaw<unknown[]>`SELECT operationKey, scopeKey, actorId, actorTenantId, actorWorkspaceId, reviewRevision, state FROM mcp_oauth_notice_review_drafts WHERE operationKey = ${v.operationKey} FOR UPDATE`;
          live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
          const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
          const r = fields(item.value, ['operationKey', 'scopeKey', 'actorId', 'actorTenantId', 'actorWorkspaceId', 'reviewRevision', 'state'], false);
          if (r.operationKey !== v.operationKey || r.scopeKey !== scopeKey(resource, target) || r.actorId !== before.userId || r.actorTenantId !== before.tenantId || r.actorWorkspaceId !== before.workspaceId || r.reviewRevision !== v.revision || r.state !== (v.stage === 'prepared' ? 'pending' : v.stage)) throw unavailable();
          const workspaceActions = { prepared: 'mcp.oauth.notice.review.workspace.prepared', approved: 'mcp.oauth.notice.review.workspace.approved', denied: 'mcp.oauth.notice.review.workspace.denied' } as const;
          const platformActions = { prepared: 'mcp.oauth.notice.review.platform.prepared', approved: 'mcp.oauth.notice.review.platform.approved', denied: 'mcp.oauth.notice.review.platform.denied' } as const;
          const auditScope = target.kind === 'workspace'
            ? { workspaceId: target.workspaceId, action: workspaceActions[v.stage as keyof typeof workspaceActions] }
            : { workspaceId: null, action: platformActions[v.stage as keyof typeof platformActions] };
          await record(tx, { tenantId: before.tenantId, userId: before.userId, ...auditScope,
            targetType: 'mcp-oauth-consent-review', targetId: v.operationKey,
            operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
          if (!isDeepStrictEqual(await currentIdentity(tx, target, abort), before)) throw unavailable();
        } catch { throw unavailable(); }
      },
    });
  } });
}
