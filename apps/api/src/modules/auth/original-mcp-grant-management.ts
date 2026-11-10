/** Original Web owner/tenant-management access to safe grant summaries/revoke.
 * No SaaS fallback, model identity, grant issuance/re-enable/remapping or business
 * permission. Original grant/operation association and OperationLog share native
 * commit; current Web identity/tenant rights are rechecked, never borrowed ALS. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpBrowserIdentity } from './original-mcp-browser-identity';
import { createOriginalMcpWorkspaceManagement } from './original-mcp-workspace-management';
import type { capturePersistedOAuthGrant } from '@rental-os/mcp-server/prisma-oauth-grant-authority' with { 'resolution-mode': 'import' };
import type { OriginalOAuthGrantManagement, PrismaOAuthGrantManagementStore, captureOAuthGrantRevocationReceipt } from '@rental-os/mcp-server/prisma-oauth-grant-management' with { 'resolution-mode': 'import' };
const unavailable = () => new Error('Original MCP grant management unavailable');
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const d = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(d).length !== names.length) throw unavailable();
  for (const name of names) { const f = d[name]; if (!f?.enumerable || !Object.hasOwn(f, 'value')) throw unavailable(); result[name] = f.value; } return result;
}
export function createOriginalMcpGrantManagement(
  captures: { grant: typeof capturePersistedOAuthGrant; receipt: typeof captureOAuthGrantRevocationReceipt },
  config: { resourceUrl: string }, auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>, browser: Request,
  grants: Pick<PrismaOAuthGrantManagementStore<Prisma.TransactionClient>, 'readIn'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>
): OriginalOAuthGrantManagement<Prisma.TransactionClient> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || typeof captures?.grant !== 'function' || typeof captures.receipt !== 'function' || typeof grants?.readIn !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function') throw unavailable();
  if (!(browser instanceof Request)) throw unavailable();
  // Identity readers need only fixed original headers/signal, not a mutable body.
  browser = new Request(browser.url, { method: browser.method, headers: new Headers(browser.headers), signal: browser.signal });
  const identity = createOriginalMcpBrowserIdentity(auth), tenant = createOriginalMcpWorkspaceManagement(auth, platform, browser);
  const capture = captures.grant, receipt = captures.receipt, read = grants.readIn.bind(grants), record = logs.recordOriginalOAuthAudit.bind(logs);
  const authorize: OriginalOAuthGrantManagement<Prisma.TransactionClient>['authorize'] = async (tx, request, signal) => {
    const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live(); const v = fields(request, ['action', 'grant']); if (!['read', 'revoke', 'read_receipt'].includes(v.action as string)) throw unavailable();
      const g = capture(v.grant); if (g.resource !== resource) return undefined;
      const before = await identity.current(browser, tx, abort); live(); if (!before || before.tenantId !== g.tenantId || before.workspaceId !== g.workspaceId) return undefined;
      const owner = before.userId === g.userId, target = Object.freeze({ kind: 'workspace' as const, tenantId: g.tenantId, workspaceId: g.workspaceId });
      const manager = owner ? undefined : await tenant.authorize(tx, { action: 'read', target }, abort); live();
      if (!owner && (!manager || manager.actorId !== before.userId)) return undefined;
      if (!isDeepStrictEqual(await identity.current(browser, tx, abort), before) || !owner && !isDeepStrictEqual(await tenant.authorize(tx, { action: 'read', target }, abort), manager)) throw unavailable(); live();
      return Object.freeze({ actorId: before.userId, tenantId: g.tenantId, workspaceId: g.workspaceId, authority: owner ? 'owner' as const : 'tenant_manager' as const });
    } catch { throw unavailable(); }
  };
  return Object.freeze<OriginalOAuthGrantManagement<Prisma.TransactionClient>>({ authorize,
    async owner(tx, signal) {
      const abort = AbortSignal.any([signal, browser.signal]);
      try {
        if (abort.aborted) throw unavailable(); const before = await identity.current(browser, tx, abort); if (!before || abort.aborted) return undefined;
        const v = fields(before, ['userId', 'tenantId', 'workspaceId', 'audience', 'sessionId', 'expiresAt']);
        if (![v.userId, v.tenantId, v.workspaceId, v.sessionId].every(x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(x))
          || v.audience !== 'operator' || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= Date.now() / 1000) throw unavailable();
        if (!isDeepStrictEqual(await identity.current(browser, tx, abort), before) || abort.aborted) throw unavailable();
        return Object.freeze({ userId: before.userId, tenantId: before.tenantId, workspaceId: before.workspaceId });
      } catch { throw unavailable(); }
    },
    async audit(tx, input, signal) {
      const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'operationKey', 'grantId', 'revision']);
        if (typeof v.actorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v.actorId) || typeof v.grantId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(v.grantId)
          || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey) || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 2 || v.revision > 2147483647) throw unavailable();
        const grant = await read(tx, v.grantId, abort); live(); if (!grant || grant.enabled || grant.revision !== v.revision) throw unavailable();
        const before = await authorize(tx, { action: 'revoke', grant }, abort); live(); if (!before || before.actorId !== v.actorId) throw unavailable();
        const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, grantId, resource, tenantId, workspaceId, payloadHash, resultJson FROM mcp_oauth_grant_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`; live();
        if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable(); const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const row = fields(item.value, ['actorId', 'grantId', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'], false); if (typeof row.payloadHash !== 'string') throw unavailable(); const saved = receipt(row.resultJson, row.payloadHash);
        if (row.actorId !== before.actorId || row.grantId !== grant.id || row.resource !== resource || row.tenantId !== grant.tenantId || row.workspaceId !== grant.workspaceId
          || saved.operationKey !== v.operationKey || saved.grantId !== grant.id || saved.revision !== grant.revision) throw unavailable();
        await record(tx, { tenantId: before.tenantId, userId: before.actorId, workspaceId: before.workspaceId, action: 'mcp.oauth.grant.revoked', targetType: 'mcp-oauth-grant', targetId: grant.id,
          operationKey: v.operationKey, revision: v.revision, grantId: grant.id }, abort); live();
        if (!isDeepStrictEqual(await authorize(tx, { action: 'revoke', grant }, abort), before)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
