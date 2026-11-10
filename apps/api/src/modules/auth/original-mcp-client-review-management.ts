/** Original SaaS identity + original applicable verification + native review audit.
 * Not an MFA executor, permissive policy, public HTTP endpoint or business grant.
 * Review producer owns nonce/CAS/publication/commit; no body identity is trusted. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { RegisteredPublicClient } from '@rental-os/mcp-server/public-client-authorization';
import type { OriginalPublicClientReviewManagement, publicClientReviewRegistrationHash } from '@rental-os/mcp-server/prisma-public-client-review';
import type { AuthService } from './auth.service';
import type { TrustedPlatformBrowserPrincipal } from './trusted-platform-browser-principal';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPlatformIdentity } from './original-mcp-platform-management';

export interface OriginalClientReviewVerificationEvidence {
  kind: 'satisfied' | 'not_required'; reference: string; revision: number; expiresAt: number;
  userId: string; tenantId: string; sessionId: string; registrationHash: string;
}
export interface OriginalClientReviewVerificationSource {
  /** Original current applicability/completed evidence, independently read/locked.
   * Explicit not_required needs original policy, never an echoed request/hash.
   * No challenge, factor/secret input, execution or retry. */
  current(transaction: Prisma.TransactionClient, principal: TrustedPlatformBrowserPrincipal,
    registration: RegisteredPublicClient, signal: AbortSignal): Promise<OriginalClientReviewVerificationEvidence | undefined>;
}
const unavailable = () => new Error('Original MCP client review management unavailable');
const ref = (v: unknown): v is string => typeof v === 'string' && /^[\x21-\x7e]{1,200}$/.test(v);
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable(); result[name] = field.value; }
  return result;
}
export function createOriginalMcpClientReviewManagement(
  captures: { registrationHash: typeof publicClientReviewRegistrationHash },
  auth: Pick<AuthService, 'resolveTrustedPlatformBrowserPrincipal'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  verification: OriginalClientReviewVerificationSource
): OriginalPublicClientReviewManagement<Prisma.TransactionClient> {
  if (typeof captures?.registrationHash !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function' || typeof verification?.current !== 'function') throw unavailable();
  const hash = captures.registrationHash, verify = verification.current.bind(verification), record = logs.recordOriginalOAuthAudit.bind(logs);
  return Object.freeze({ forRequest(browser: Request) {
    const identity = createOriginalMcpPlatformIdentity(auth, browser);
    return Object.freeze<ReturnType<OriginalPublicClientReviewManagement<Prisma.TransactionClient>['forRequest']>>({
      async current(transaction, registration, signal, purpose = 'review') {
        const abort = AbortSignal.any([signal, browser.signal]); if (abort.aborted) throw unavailable();
        const before = await identity.current(transaction, abort); if (!before || abort.aborted) throw unavailable();
        if (purpose === 'read_receipt') return before;
        if (purpose !== 'review' || !registration) throw unavailable();
        const inputHash = hash(registration), original = await verify(transaction, before, registration, abort);
        if (abort.aborted || !original) throw unavailable();
        const v = fields(original, ['kind', 'reference', 'revision', 'expiresAt', 'userId', 'tenantId', 'sessionId', 'registrationHash']);
        if (!['satisfied', 'not_required'].includes(v.kind as string) || !ref(v.reference) || !revision(v.revision)
          || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= Date.now() / 1000
          || v.userId !== before.userId || v.tenantId !== before.tenantId || v.sessionId !== before.sessionId || v.registrationHash !== inputHash) throw unavailable();
        const after = await identity.current(transaction, abort), current = await verify(transaction, before, registration, abort);
        if (abort.aborted || !after || !isDeepStrictEqual(after, before)
          || !isDeepStrictEqual(fields(current, ['kind', 'reference', 'revision', 'expiresAt', 'userId', 'tenantId', 'sessionId', 'registrationHash']), v)) throw unavailable();
        return Object.freeze({ ...before, verification: Object.freeze({ kind: v.kind as 'satisfied' | 'not_required', reference: v.reference, revision: v.revision, expiresAt: v.expiresAt }) });
      },
      async audit(transaction, input, signal) {
        const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
        try {
          live(); const v = fields(input, ['operationKey', 'clientId', 'actorId', 'tenantId', 'revision', 'stage']);
          if (typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey) || !ref(v.clientId) || !revision(v.revision) || !['prepared', 'approved', 'denied'].includes(v.stage as string)) throw unavailable();
          const before = await identity.current(transaction, abort); live(); if (!before || before.userId !== v.actorId || before.tenantId !== v.tenantId) throw unavailable();
          const rows = await transaction.$queryRaw<unknown[]>`SELECT operationKey, clientId, actorId, tenantId, reviewRevision, state FROM mcp_oauth_public_client_review_drafts WHERE operationKey = ${v.operationKey} FOR UPDATE`;
          live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
          const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
          const saved = fields(item.value, ['operationKey', 'clientId', 'actorId', 'tenantId', 'reviewRevision', 'state'], false);
          if (saved.operationKey !== v.operationKey || saved.clientId !== v.clientId || saved.actorId !== before.userId || saved.tenantId !== before.tenantId || saved.reviewRevision !== v.revision || saved.state !== (v.stage === 'prepared' ? 'pending' : v.stage)) throw unavailable();
          const actions = { prepared: 'mcp.oauth.client.review.prepared', approved: 'mcp.oauth.client.review.approved', denied: 'mcp.oauth.client.review.denied' } as const;
          await record(transaction, { tenantId: before.tenantId, userId: before.userId, workspaceId: null,
            action: actions[v.stage as keyof typeof actions], targetType: 'mcp-oauth-client-review', targetId: v.operationKey,
            operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
          const after = await identity.current(transaction, abort); live(); if (!after || !isDeepStrictEqual(after, before)) throw unavailable();
        } catch { throw unavailable(); }
      },
    });
  } });
}
