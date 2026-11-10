/** Original signed Web session + tenant integration rights for MCP workspace
 * governance. No SaaS/platform authority, model input, role copy or policy approval.
 * Internal authorize and workspace admission audit ports, not public HTTP;
 * original Controller/Guard/CSRF and candidate policy review remain required. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OriginalOAuthAdmissionManagement } from '@rental-os/mcp-server/prisma-oauth-admission-store' with { 'resolution-mode': 'import' };
import type { OperationLogService } from '../../common/operation-log.service';

const unavailable = () => new Error('Original MCP workspace management unavailable');
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable(); result[name] = field.value; }
  return result;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(value);

export function createOriginalMcpWorkspaceManagement(
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  browser: Request
): Pick<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>, 'authorize'> {
  if (!(browser instanceof Request) || typeof auth?.resolveTrustedBrowserPrincipal !== 'function' || typeof platform?.assertTrustedWorkspaceIntegrationManagement !== 'function') throw unavailable();
  const authorization = browser.headers.get('authorization') ?? undefined, requestSignal = browser.signal;
  const resolve = auth.resolveTrustedBrowserPrincipal.bind(auth), manage = platform.assertTrustedWorkspaceIntegrationManagement.bind(platform);
  return Object.freeze({ async authorize(transaction: Prisma.TransactionClient, request: Parameters<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>['authorize']>[1], signal: AbortSignal) {
    const abort = AbortSignal.any([signal, requestSignal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live();
      const hasPolicy = request && Object.hasOwn(request, 'policy');
      const original = fields(request, hasPolicy ? ['action', 'target', 'policy'] : ['action', 'target']);
      if (!['read', 'save', 'read_receipt'].includes(original.action as string)) throw unavailable();
      const kind = original.target && typeof original.target === 'object' ? Object.getOwnPropertyDescriptor(original.target, 'kind') : undefined;
      if (!kind?.enumerable || !Object.hasOwn(kind, 'value')) throw unavailable();
      if (kind.value === 'platform') { fields(original.target, ['kind']); return undefined; }
      const target = fields(original.target, ['kind', 'tenantId', 'workspaceId']);
      if (target.kind !== 'workspace' || !id(target.tenantId) || !id(target.workspaceId)) throw unavailable();
      const before = await resolve(authorization, transaction, abort); live();
      if (!before || before.tenantId !== target.tenantId || before.workspaceId !== target.workspaceId) return undefined;
      const binding = Object.freeze({ userId: before.userId, tenantId: before.tenantId, workspaceId: before.workspaceId });
      const actor = await manage(binding, transaction); live();
      const after = await resolve(authorization, transaction, abort); live();
      if (!after || !isDeepStrictEqual(after, before)) throw unavailable();
      const currentActor = await manage(binding, transaction); live();
      if (!isDeepStrictEqual(currentActor, actor)) throw unavailable();
      return Object.freeze({ actorId: before.userId, kind: 'workspace' as const, tenantId: before.tenantId, workspaceId: before.workspaceId });
    } catch { throw unavailable(); }
  } });
}

/** Complete WORKSPACE admission management port. Reuses the original authorizer
 * and original OperationLog transaction writer; no platform fallback or generic
 * management event. The original save owns CAS, commit and unknown recovery. */
export function createOriginalMcpWorkspaceAdmissionManagement(
  config: { resourceUrl: string },
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  browser: Request,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>
): OriginalOAuthAdmissionManagement<Prisma.TransactionClient> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || typeof logs?.recordOriginalOAuthAudit !== 'function') throw unavailable();
  const authorizer = createOriginalMcpWorkspaceManagement(auth, platform, browser), record = logs.recordOriginalOAuthAudit.bind(logs);
  return Object.freeze({ authorize: authorizer.authorize,
    async audit(transaction: Prisma.TransactionClient, input: Parameters<OriginalOAuthAdmissionManagement<Prisma.TransactionClient>['audit']>[1], signal: AbortSignal) {
      const abort = AbortSignal.any([signal, browser.signal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'operationKey', 'target', 'resource', 'revision']), target = fields(v.target, ['kind', 'tenantId', 'workspaceId']);
        if (!id(v.actorId) || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey)
          || target.kind !== 'workspace' || !id(target.tenantId) || !id(target.workspaceId) || v.resource !== resource
          || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647) throw unavailable();
        const scope = Object.freeze({ kind: 'workspace' as const, tenantId: target.tenantId, workspaceId: target.workspaceId });
        const before = await authorizer.authorize(transaction, { action: 'save', target: scope }, abort); live();
        if (!before || before.kind !== 'workspace' || before.actorId !== v.actorId) throw unavailable();
        const rows = await transaction.$queryRaw<unknown[]>`SELECT actorId, targetKind, resource, tenantId, workspaceId, resultJson FROM mcp_oauth_admission_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`;
        live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const saved = fields(item.value, ['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'resultJson'], false);
        let original = saved.resultJson;
        if (typeof original === 'string') { if (Buffer.byteLength(original, 'utf8') > 65536) throw unavailable(); original = JSON.parse(original); }
        const receipt = fields(original, ['state', 'operationKey', 'target', 'policy']), savedTarget = fields(receipt.target, ['kind', 'tenantId', 'workspaceId']);
        const savedPolicy = fields(receipt.policy, ['resource', 'revision'], false);
        if (saved.actorId !== before.actorId || saved.targetKind !== 'workspace' || saved.resource !== resource || saved.tenantId !== before.tenantId || saved.workspaceId !== before.workspaceId
          || receipt.state !== 'saved' || receipt.operationKey !== v.operationKey || !isDeepStrictEqual(savedTarget, scope)
          || savedPolicy.resource !== resource || savedPolicy.revision !== v.revision) throw unavailable();
        await record(transaction, { tenantId: before.tenantId, userId: before.actorId, workspaceId: before.workspaceId,
          action: 'mcp.oauth.admission.workspace.saved', targetType: 'mcp-oauth-admission', targetId: before.workspaceId,
          operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
        const after = await authorizer.authorize(transaction, { action: 'save', target: scope }, abort); live();
        if (!after || !isDeepStrictEqual(after, before)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
