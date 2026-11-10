/** Original signed Web session + full-tenant integration rights for issuer
 * subject metadata. Not a role/subject generator, business grant, MFA system or
 * public Controller. Target accounts stay in the actor's original tenant;
 * native original receipt and audit must commit with the mapping CAS. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import type { OriginalOAuthSubjectManagement, captureOAuthSubjectReceipt } from '@rental-os/mcp-server/prisma-oauth-subject-store';

const unavailable = () => new Error('Original MCP subject management unavailable');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const f = descriptors[name]; if (!f?.enumerable || !Object.hasOwn(f, 'value')) throw unavailable(); result[name] = f.value; }
  return result;
}
export function createOriginalMcpSubjectManagement(
  captures: { receipt: typeof captureOAuthSubjectReceipt },
  config: { resourceUrl: string },
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceSubjectManagement'>,
  browser: Request,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>
): OriginalOAuthSubjectManagement<Prisma.TransactionClient> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || !(browser instanceof Request) || typeof captures?.receipt !== 'function' || typeof auth?.resolveTrustedBrowserPrincipal !== 'function'
    || typeof platform?.assertTrustedWorkspaceSubjectManagement !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function') throw unavailable();
  const authorization = browser.headers.get('authorization') ?? undefined, requestSignal = browser.signal;
  const resolve = auth.resolveTrustedBrowserPrincipal.bind(auth), manage = platform.assertTrustedWorkspaceSubjectManagement.bind(platform);
  const capture = captures.receipt, record = logs.recordOriginalOAuthAudit.bind(logs);
  const authorize: OriginalOAuthSubjectManagement<Prisma.TransactionClient>['authorize'] = async (transaction, request, signal) => {
    const abort = AbortSignal.any([signal, requestSignal]), live = () => { if (abort.aborted) throw unavailable(); };
    try {
      live(); const r = fields(request, ['action', 'target']), target = fields(r.target, ['userId', 'tenantId']);
      if (!['read', 'save', 'read_receipt'].includes(r.action as string) || !id(target.userId) || !id(target.tenantId)) throw unavailable();
      const principal = async () => {
        const raw = await resolve(authorization, transaction, abort); live(); if (!raw) return undefined;
        const v = fields(raw, ['userId', 'tenantId', 'workspaceId', 'audience', 'sessionId', 'expiresAt']);
        if (![v.userId, v.tenantId, v.workspaceId, v.sessionId].every(id) || v.audience !== 'operator'
          || typeof v.expiresAt !== 'number' || !Number.isSafeInteger(v.expiresAt) || v.expiresAt <= Date.now() / 1000) throw unavailable();
        return v;
      };
      const before = await principal(); if (!before || before.tenantId !== target.tenantId) return undefined;
      const binding = Object.freeze({ userId: before.userId as string, tenantId: before.tenantId as string, workspaceId: before.workspaceId as string });
      const current = async () => {
        const raw = await manage(binding, target.userId as string, transaction); live();
        const v = fields(raw, ['actorId', 'tenantId', 'userId', 'workspaceId']);
        if (v.actorId !== binding.userId || v.tenantId !== binding.tenantId || v.userId !== target.userId || v.workspaceId !== binding.workspaceId) throw unavailable();
        return Object.freeze({ actorId: binding.userId, tenantId: binding.tenantId, userId: target.userId as string, workspaceId: binding.workspaceId });
      };
      const who = await current(); if (!isDeepStrictEqual(await principal(), before) || !isDeepStrictEqual(await current(), who)) throw unavailable();
      return who;
    } catch { throw unavailable(); }
  };
  return Object.freeze<OriginalOAuthSubjectManagement<Prisma.TransactionClient>>({ authorize,
    async audit(transaction, input, signal) {
      const abort = AbortSignal.any([signal, requestSignal]), live = () => { if (abort.aborted) throw unavailable(); };
      try {
        live(); const v = fields(input, ['actorId', 'workspaceId', 'operationKey', 'target', 'resource', 'revision']), t = fields(v.target, ['userId', 'tenantId']);
        if (![v.actorId, v.workspaceId, t.userId, t.tenantId].every(id) || typeof v.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.operationKey)
          || v.resource !== resource || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 2147483647) throw unavailable();
        const target = Object.freeze({ userId: t.userId as string, tenantId: t.tenantId as string });
        const before = await authorize(transaction, { action: 'save', target }, abort); live();
        if (!before || before.actorId !== v.actorId || before.workspaceId !== v.workspaceId) throw unavailable();
        const bindings = await transaction.$queryRaw<unknown[]>`SELECT subject, revision FROM mcp_oauth_subject_bindings WHERE resource = ${resource} AND userId = ${target.userId} AND tenantId = ${target.tenantId} FOR UPDATE`;
        live(); if (!Array.isArray(bindings) || Object.getPrototypeOf(bindings) !== Array.prototype || bindings.length !== 1) throw unavailable();
        const bindingItem = Object.getOwnPropertyDescriptor(bindings, '0'); if (!bindingItem?.enumerable || !Object.hasOwn(bindingItem, 'value')) throw unavailable();
        const current = fields(bindingItem.value, ['subject', 'revision'], false);
        const rows = await transaction.$queryRaw<unknown[]>`SELECT actorId, workspaceId, resource, userId, tenantId, payloadHash, resultJson FROM mcp_oauth_subject_operations WHERE operationKey = ${v.operationKey} FOR UPDATE`;
        live(); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const item = Object.getOwnPropertyDescriptor(rows, '0'); if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw unavailable();
        const row = fields(item.value, ['actorId', 'workspaceId', 'resource', 'userId', 'tenantId', 'payloadHash', 'resultJson'], false);
        if (typeof row.payloadHash !== 'string') throw unavailable(); const receipt = capture(row.resultJson, row.payloadHash);
        if (row.actorId !== before.actorId || row.workspaceId !== before.workspaceId || row.resource !== resource || row.userId !== target.userId || row.tenantId !== target.tenantId
          || receipt.state !== 'saved' || receipt.operationKey !== v.operationKey || receipt.binding.resource !== resource || receipt.binding.userId !== target.userId
          || receipt.binding.tenantId !== target.tenantId || receipt.binding.revision !== v.revision
          || current.subject !== receipt.binding.subject || current.revision !== v.revision) throw unavailable();
        await record(transaction, { tenantId: before.tenantId, userId: before.actorId, workspaceId: before.workspaceId,
          action: 'mcp.oauth.subject.binding.saved', targetType: 'mcp-oauth-subject-binding', targetId: target.userId,
          operationKey: v.operationKey, revision: v.revision, grantId: null }, abort); live();
        if (!isDeepStrictEqual(await authorize(transaction, { action: 'save', target }, abort), before)) throw unavailable();
      } catch { throw unavailable(); }
    },
  });
}
