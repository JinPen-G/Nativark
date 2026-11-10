/** Original Web/current SaaS authorization and atomic PLATFORM admission audit.
 * Internal ports only: no tenant/workspace authority, candidate approval,
 * public Controller/Guard/CSRF, registration or business execution. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { OriginalOAuthAdmissionManagement } from '@rental-os/mcp-server/prisma-oauth-admission-store' with { 'resolution-mode': 'import' };
import type { OperationLogService } from '../../common/operation-log.service';
import type { TrustedPlatformBrowserPrincipal } from './trusted-platform-browser-principal';

const unavailable = () => new Error('Original MCP platform management unavailable');
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable(); result[name] = field.value; }
  return result;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(value);
const capture = (value: unknown): TrustedPlatformBrowserPrincipal => {
  const current = fields(value, ['userId', 'tenantId', 'audience', 'sessionId', 'expiresAt']);
  if (!id(current.userId) || !id(current.tenantId) || !id(current.sessionId) || current.audience !== 'operator'
    || typeof current.expiresAt !== 'number' || !Number.isSafeInteger(current.expiresAt) || current.expiresAt <= Date.now() / 1000) throw unavailable();
  return Object.freeze({ userId: current.userId, tenantId: current.tenantId, audience: 'operator', sessionId: current.sessionId, expiresAt: current.expiresAt });
};

/** Reusable original PLATFORM Web identity reader for internal management ports.
 * Holds this request's credential/signal, never a body actor or SQL-to-Prisma cast. */
export function createOriginalMcpPlatformIdentity(
  auth: Pick<AuthService, 'resolveTrustedPlatformBrowserPrincipal'>,
  browser: Request
) {
  if (!(browser instanceof Request) || typeof auth?.resolveTrustedPlatformBrowserPrincipal !== 'function') throw unavailable();
  const authorization = browser.headers.get('authorization') ?? undefined, requestSignal = browser.signal;
  const resolve = auth.resolveTrustedPlatformBrowserPrincipal.bind(auth);
  return Object.freeze({ async current(transaction: Prisma.TransactionClient, signal: AbortSignal): Promise<TrustedPlatformBrowserPrincipal | undefined> {
    const abort = AbortSignal.any([signal, requestSignal]);
    try {
      if (abort.aborted) throw unavailable();
      const original = await resolve(authorization, transaction, abort);
      if (abort.aborted) throw unavailable();
      return original === undefined ? undefined : capture(original);
    } catch { throw unavailable(); }
  } });
}

export function createOriginalMcpPlatformManagement(
  auth: Pick<AuthService, 'resolveTrustedPlatformBrowserPrincipal'>,
  browser: Request
): Pick<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>, 'authorize'> {
  if (!(browser instanceof Request) || typeof auth?.resolveTrustedPlatformBrowserPrincipal !== 'function') throw unavailable();
  const authorization = browser.headers.get('authorization') ?? undefined, requestSignal = browser.signal;
  const resolve = auth.resolveTrustedPlatformBrowserPrincipal.bind(auth);
  return Object.freeze({ async authorize(transaction: Prisma.TransactionClient, request: Parameters<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>['authorize']>[1], signal: AbortSignal) {
    const abort = AbortSignal.any([signal, requestSignal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live(); const hasPolicy = request && Object.hasOwn(request, 'policy');
      const original = fields(request, hasPolicy ? ['action', 'target', 'policy'] : ['action', 'target']);
      if (!['read', 'save', 'read_receipt'].includes(original.action as string)) throw unavailable();
      const kind = original.target && typeof original.target === 'object' ? Object.getOwnPropertyDescriptor(original.target, 'kind') : undefined;
      if (!kind?.enumerable || !Object.hasOwn(kind, 'value')) throw unavailable();
      if (kind.value === 'workspace') {
        const target = fields(original.target, ['kind', 'tenantId', 'workspaceId']);
        if (!id(target.tenantId) || !id(target.workspaceId)) throw unavailable();
        return undefined;
      }
      const target = fields(original.target, ['kind']); if (target.kind !== 'platform') throw unavailable();
      const first = await resolve(authorization, transaction, abort); live();
      if (!first) return undefined;
      const before = capture(first), last = await resolve(authorization, transaction, abort); live();
      if (!last || !isDeepStrictEqual(capture(last), before)) throw unavailable();
      return Object.freeze({ actorId: before.userId as string, kind: 'platform' as const });
    } catch { throw unavailable(); }
  } });
}

/** Complete PLATFORM admission management port. Original store owns CAS/commit
 * and unknown recovery. Audit verifies its exact saved operation and records only
 * original actor/key/revision, with no fictitious workspace or policy plaintext. */
export function createOriginalMcpPlatformAdmissionManagement(
  config: { resourceUrl: string },
  auth: Pick<AuthService, 'resolveTrustedPlatformBrowserPrincipal'>,
  browser: Request,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>
): OriginalOAuthAdmissionManagement<Prisma.TransactionClient> {
  let resource: string;
  try {
    const url = new URL(config.resourceUrl); resource = url.href;
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
      || typeof logs?.recordOriginalOAuthAudit !== 'function') throw unavailable();
  } catch { throw unavailable(); }
  const authorizer = createOriginalMcpPlatformManagement(auth, browser), record = logs.recordOriginalOAuthAudit.bind(logs);
  const resolve = auth.resolveTrustedPlatformBrowserPrincipal.bind(auth), authorization = browser.headers.get('authorization') ?? undefined, requestSignal = browser.signal;
  return Object.freeze({ authorize: authorizer.authorize,
    async audit(transaction: Prisma.TransactionClient, input: Parameters<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>['audit']>[1], signal: AbortSignal) {
      const abort = AbortSignal.any([signal, requestSignal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'operationKey', 'target', 'resource', 'revision']), target = fields(v.target, ['kind']);
        if (!id(v.actorId) || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey)
          || target.kind !== 'platform' || v.resource !== resource || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647) throw unavailable();
        const scope = Object.freeze({ kind: 'platform' as const });
        const manager = await authorizer.authorize(transaction, { action: 'save', target: scope }, abort); live();
        if (!manager || manager.kind !== 'platform' || manager.actorId !== v.actorId) throw unavailable();
        const original = await resolve(authorization, transaction, abort); live();
        const before = capture(original); if (before.userId !== manager.actorId) throw unavailable();
        const rows = await transaction.$queryRaw<unknown[]>`SELECT actorId, targetKind, resource, tenantId, workspaceId, resultJson FROM mcp_oauth_admission_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`;
        live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const saved = fields(item.value, ['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'resultJson'], false);
        let result = saved.resultJson;
        if (typeof result === 'string') { if (Buffer.byteLength(result, 'utf8') > 65536) throw unavailable(); result = JSON.parse(result); }
        const receipt = fields(result, ['state', 'operationKey', 'target', 'policy']), savedTarget = fields(receipt.target, ['kind']);
        const policy = fields(receipt.policy, ['resource', 'revision'], false);
        if (saved.actorId !== manager.actorId || saved.targetKind !== 'platform' || saved.resource !== resource || saved.tenantId !== null || saved.workspaceId !== null
          || receipt.state !== 'saved' || receipt.operationKey !== v.operationKey || !isDeepStrictEqual(savedTarget, scope) || policy.resource !== resource || policy.revision !== v.revision) throw unavailable();
        // Account tenant is original audit provenance; it is not a selected tenant
        // or a grant to its spaces. PLATFORM scope must remain workspaceId:null.
        await record(transaction, { tenantId: before.tenantId as string, userId: manager.actorId, workspaceId: null,
          action: 'mcp.oauth.admission.platform.saved', targetType: 'mcp-oauth-admission', targetId: v.operationKey,
          operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
        const currentManager = await authorizer.authorize(transaction, { action: 'save', target: scope }, abort); live();
        const current = await resolve(authorization, transaction, abort); live();
        if (!currentManager || !isDeepStrictEqual(currentManager, manager) || !isDeepStrictEqual(capture(current), before)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
