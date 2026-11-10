/** Original platform/tenant management for approved notice projections.
 * Independent completed review is mandatory for creation/change/re-enabling;
 * absent review permits only exact existing-policy disable. No review/MFA/UI,
 * business authority, grant revoke, public Controller or transaction retry. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPlatformManagement, createOriginalMcpPlatformIdentity } from './original-mcp-platform-management';
import { createOriginalMcpWorkspaceManagement } from './original-mcp-workspace-management';
import type { OAuthAdmissionTarget } from '@rental-os/mcp-server/prisma-oauth-admission-store';
import type { captureOAuthConsentPolicy } from '@rental-os/mcp-server/prisma-oauth-consent-review';
import type { OAuthConsentPolicy, PrismaOAuthConsentPolicyStore, OriginalOAuthConsentPolicyManagement, OriginalOAuthConsentPolicyReviewSource,
  captureOAuthConsentPolicyReceipt, captureOAuthConsentPolicyTarget } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store';
const unavailable = () => new Error('Original MCP consent policy management unavailable');
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const d = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(d).length !== names.length) throw unavailable();
  for (const name of names) { const f = d[name]; if (!f?.enumerable || !Object.hasOwn(f, 'value')) throw unavailable(); result[name] = f.value; } return result;
}
export function createOriginalMcpConsentPolicyManagement(
  captures: { policy: typeof captureOAuthConsentPolicy; target: typeof captureOAuthConsentPolicyTarget; receipt: typeof captureOAuthConsentPolicyReceipt },
  config: { resourceUrl: string }, auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>, browser: Request,
  policies: Pick<PrismaOAuthConsentPolicyStore<Prisma.TransactionClient>, 'readIn'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  reviews?: OriginalOAuthConsentPolicyReviewSource<Prisma.TransactionClient>
): OriginalOAuthConsentPolicyManagement<Prisma.TransactionClient> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || typeof captures?.policy !== 'function' || typeof captures.target !== 'function' || typeof captures.receipt !== 'function'
    || typeof policies?.readIn !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function' || reviews !== undefined && typeof reviews.current !== 'function') throw unavailable();
  const platformManager = createOriginalMcpPlatformManagement(auth, browser), workspaceManager = createOriginalMcpWorkspaceManagement(auth, platform, browser), identity = createOriginalMcpPlatformIdentity(auth, browser);
  const capture = captures.policy, target = captures.target, receipt = captures.receipt, read = policies.readIn.bind(policies), review = reviews?.current.bind(reviews), record = logs.recordOriginalOAuthAudit.bind(logs);
  const permit = async (tx: Prisma.TransactionClient, scope: OAuthAdmissionTarget, candidate: OAuthConsentPolicy, signal: AbortSignal) => {
    if (signal.aborted) throw unavailable();
    if (!candidate.enabled) {
      const previous = await read(tx, scope, signal); if (signal.aborted) throw unavailable();
      if (previous) { const current = capture(previous, scope.kind === 'workspace');
        if ((candidate.revision === current.revision || candidate.revision === current.revision + 1)
          && isDeepStrictEqual({ ...candidate, revision: current.revision, enabled: current.enabled }, current)) return Object.freeze({ kind: 'disable_only', previous: current }); }
    }
    if (!review) return undefined; const raw = await review(tx, scope, signal); if (signal.aborted) throw unavailable(); if (raw === undefined) return undefined;
    const v = fields(raw, ['reference', 'revision', 'expiresAt', 'target', 'policy']), approved = capture(v.policy, scope.kind === 'workspace');
    if (v.reference !== candidate.reviewRef || v.revision !== candidate.reviewRevision || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt)
      || v.expiresAt <= Date.now() / 1000 || candidate.expiresAt > v.expiresAt || !isDeepStrictEqual(target(v.target), scope) || !isDeepStrictEqual(approved, candidate)) return undefined;
    return Object.freeze({ kind: 'reviewed', reference: v.reference, revision: v.revision, expiresAt: v.expiresAt, target: scope, policy: approved });
  };
  const authorize: OriginalOAuthConsentPolicyManagement<Prisma.TransactionClient>['authorize'] = async (tx, request, signal) => {
    const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live(); const has = request && Object.hasOwn(request, 'policy'), v = fields(request, has ? ['action', 'target', 'policy'] : ['action', 'target']);
      if (!['read', 'save', 'read_receipt'].includes(v.action as string) || (v.action === 'save') !== Boolean(has)) throw unavailable();
      const scope = target(v.target), candidate = has ? capture(v.policy, scope.kind === 'workspace') : undefined;
      if (candidate && (candidate.resource !== resource || scope.kind === 'workspace' && !isDeepStrictEqual(target({ kind: 'workspace', ...fields(candidate, ['tenantId', 'workspaceId'], false) }), scope))) throw unavailable();
      const author = scope.kind === 'platform' ? platformManager : workspaceManager;
      const current = () => author.authorize(tx, { action: v.action as 'read' | 'save' | 'read_receipt', target: scope }, abort);
      const before = await current(); live(); if (!before) return undefined;
      const allowed = candidate ? await permit(tx, scope, candidate, abort) : undefined; live(); if (candidate && !allowed) return undefined;
      if (!isDeepStrictEqual(await current(), before) || candidate && !isDeepStrictEqual(await permit(tx, scope, candidate, abort), allowed)) throw unavailable(); live(); return before;
    } catch { throw unavailable(); }
  };
  return Object.freeze<OriginalOAuthConsentPolicyManagement<Prisma.TransactionClient>>({ authorize,
    async audit(tx, input, signal) {
      const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'target', 'operationKey', 'resource', 'revision']), scope = target(v.target);
        if (typeof v.actorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v.actorId) || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey)
          || v.resource !== resource || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647) throw unavailable();
        const current = await read(tx, scope, abort); live(); if (!current || current.revision !== v.revision || current.resource !== resource) throw unavailable();
        const before = await authorize(tx, { action: 'save', target: scope, policy: current }, abort); live(); if (!before || before.actorId !== v.actorId) throw unavailable();
        const p = scope.kind === 'platform' ? await identity.current(tx, abort) : undefined; live(); if (scope.kind === 'platform' && (!p || p.userId !== before.actorId)) throw unavailable();
        const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, targetKind, resource, tenantId, workspaceId, payloadHash, resultJson FROM mcp_oauth_consent_policy_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`;
        live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const row = fields(item.value, ['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'], false);
        if (typeof row.payloadHash !== 'string') throw unavailable(); const saved = receipt(row.resultJson, row.payloadHash);
        if (row.actorId !== before.actorId || row.targetKind !== scope.kind || row.resource !== resource || row.tenantId !== (scope.kind === 'workspace' ? scope.tenantId : null)
          || row.workspaceId !== (scope.kind === 'workspace' ? scope.workspaceId : null) || saved.operationKey !== v.operationKey || !isDeepStrictEqual(saved.target, scope) || !isDeepStrictEqual(saved.policy, current)) throw unavailable();
        const tenantId = scope.kind === 'workspace' ? scope.tenantId : p!.tenantId;
        await record(tx, { tenantId, userId: before.actorId,
          ...(scope.kind === 'workspace'
            ? { workspaceId: scope.workspaceId, action: 'mcp.oauth.consent.policy.workspace.saved' as const }
            : { workspaceId: null, action: 'mcp.oauth.consent.policy.platform.saved' as const }),
          targetType: 'mcp-oauth-consent-policy', targetId: scope.kind === 'workspace' ? scope.workspaceId : v.operationKey,
          operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
        if (!isDeepStrictEqual(await authorize(tx, { action: 'save', target: scope, policy: current }, abort), before)
          || p && !isDeepStrictEqual(await identity.current(tx, abort), p)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
