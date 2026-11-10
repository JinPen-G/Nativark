/** Original SaaS Web authorization + original atomic public-client audit.
 * Candidate registration needs original current review; absent review permits
 * only exact non-expanding disable of an existing registration, not new clients.
 * No public HTTP/dynamic registration, role copy, grant, review approval or retry. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPlatformIdentity } from './original-mcp-platform-management';
import type { RegisteredPublicClient } from '@rental-os/mcp-server/public-client-authorization';
import type { OriginalPublicClientManagement, PrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from '@rental-os/mcp-server/prisma-public-client-registry';

import type { PublicClientRegistrationReview, PublicClientRegistrationReviewSource } from '@rental-os/mcp-server/prisma-public-client-review';
// Compatibility names for the same formal source, not private duplicate contracts.
export type OriginalMcpPublicClientReview = PublicClientRegistrationReview;
export type OriginalMcpPublicClientReviewSource = PublicClientRegistrationReviewSource<Prisma.TransactionClient>;
const unavailable = () => new Error('Original MCP public-client management unavailable');
const ref = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value);
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable(); result[name] = field.value; }
  return result;
}

export function createOriginalMcpPublicClientManagement(
  // The original host supplies these actual formal package exports, not private
  // copies or permissive validators. Captured functions cannot change mid-request.
  captures: { registration: typeof captureRegisteredPublicClient; receipt: typeof capturePublicClientRegistrationReceipt },
  auth: Pick<AuthService, 'resolveTrustedPlatformBrowserPrincipal'>,
  browser: Request,
  registrations: Pick<PrismaPublicClientRegistry<Prisma.TransactionClient>, 'readIn'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  reviews?: OriginalMcpPublicClientReviewSource
): OriginalPublicClientManagement<Prisma.TransactionClient> {
  if (typeof captures?.registration !== 'function' || typeof captures.receipt !== 'function' || typeof registrations?.readIn !== 'function'
    || typeof logs?.recordOriginalOAuthAudit !== 'function' || reviews !== undefined && typeof reviews.current !== 'function') throw unavailable();
  const identity = createOriginalMcpPlatformIdentity(auth, browser), capture = captures.registration, receipt = captures.receipt;
  const readIn = registrations.readIn.bind(registrations), review = reviews?.current.bind(reviews), record = logs.recordOriginalOAuthAudit.bind(logs);
  const permit = async (transaction: Prisma.TransactionClient, candidate: RegisteredPublicClient, signal: AbortSignal) => {
    if (signal.aborted) throw unavailable();
    if (!candidate.enabled) {
      const previous = await readIn(transaction, candidate.clientId, signal); if (signal.aborted) throw unavailable();
      if (previous) {
        const current = capture(previous);
        // Disabling never approves existing metadata. It closes only that exact
        // client, preserving callbacks/scopes/expiry; post-write CAS rechecks see
        // the same already-disabled revision and must not require a new review.
        if ((candidate.revision === current.revision + 1 || candidate.revision === current.revision)
          && isDeepStrictEqual({ ...candidate, revision: current.revision, enabled: current.enabled }, current)) {
          return Object.freeze({ kind: 'disable_only', previous: current });
        }
      }
    }
    if (!review) return undefined;
    const original = await review(transaction, candidate.clientId, signal); if (signal.aborted) throw unavailable();
    if (original === undefined) return undefined;
    const v = fields(original, ['reference', 'revision', 'expiresAt', 'registration']);
    if (!ref(v.reference) || !revision(v.revision) || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt)
      || v.expiresAt <= Date.now() / 1000 || candidate.expiresAt > v.expiresAt) return undefined;
    const approved = capture(v.registration); if (!isDeepStrictEqual(approved, candidate)) return undefined;
    return Object.freeze({ kind: 'reviewed', reference: v.reference, revision: v.revision, expiresAt: v.expiresAt, registration: approved });
  };
  const authorize: OriginalPublicClientManagement<Prisma.TransactionClient>['authorize'] = async (transaction, request, signal) => {
    const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live(); const hasCandidate = request && Object.hasOwn(request, 'registration');
      const v = fields(request, hasCandidate ? ['action', 'clientId', 'registration'] : ['action', 'clientId']);
      if (!ref(v.clientId) || !['read', 'save', 'read_receipt'].includes(v.action as string) || (v.action === 'save') !== Boolean(hasCandidate)) throw unavailable();
      const before = await identity.current(transaction, abort); live(); if (!before) return undefined;
      const candidate = hasCandidate ? capture(v.registration) : undefined;
      if (candidate && candidate.clientId !== v.clientId) throw unavailable();
      const permission = candidate ? await permit(transaction, candidate, abort) : undefined; live();
      if (candidate && !permission) return undefined;
      const after = await identity.current(transaction, abort); live();
      if (!after || !isDeepStrictEqual(after, before)) throw unavailable();
      if (candidate && !isDeepStrictEqual(await permit(transaction, candidate, abort), permission)) throw unavailable();
      live(); return Object.freeze({ actorId: before.userId });
    } catch { throw unavailable(); }
  };
  return Object.freeze({ authorize,
    async audit(transaction, input, signal) {
      const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'clientId', 'operationKey', 'revision']);
        if (!ref(v.actorId) || !ref(v.clientId) || !key(v.operationKey) || !revision(v.revision)) throw unavailable();
        const before = await identity.current(transaction, abort); live(); if (!before || before.userId !== v.actorId) throw unavailable();
        const rows = await transaction.$queryRaw<unknown[]>`SELECT actorId, clientId, payloadHash, resultJson FROM mcp_oauth_public_client_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`;
        live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const original = fields(item.value, ['actorId', 'clientId', 'payloadHash', 'resultJson'], false);
        if (original.actorId !== before.userId || original.clientId !== v.clientId || typeof original.payloadHash !== 'string') throw unavailable();
        const saved = receipt({ actorId: before.userId, clientId: v.clientId, payloadHash: original.payloadHash, resultJson: original.resultJson }, v.clientId, v.operationKey);
        if (saved.registration.revision !== v.revision) throw unavailable();
        const manager = await authorize(transaction, { action: 'save', clientId: v.clientId, registration: saved.registration }, abort); live();
        if (!manager || manager.actorId !== before.userId) throw unavailable();
        await record(transaction, { tenantId: before.tenantId, userId: before.userId, workspaceId: null,
          action: 'mcp.oauth.client.registration.saved', targetType: 'mcp-oauth-public-client', targetId: v.clientId,
          operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
        const current = await authorize(transaction, { action: 'save', clientId: v.clientId, registration: saved.registration }, abort); live();
        const after = await identity.current(transaction, abort); live();
        if (!current || !isDeepStrictEqual(current, manager) || !after || !isDeepStrictEqual(after, before)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
