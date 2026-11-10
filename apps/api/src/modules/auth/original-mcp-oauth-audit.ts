/** Original OperationLog callbacks for trusted OAuth consent/grant/code authors.
 * No second audit table, permission, browser body/token, SQL action or auto retry.
 * Consent/grant scopes are original author outputs; code scope is read from the
 * exact original persisted grant/authorization in the same native transaction. */
import type { Prisma } from '@prisma/client';
import type { OperationLogService, OriginalOAuthAuditRecord } from '../../common/operation-log.service';
import type { OriginalOAuthWebConsentPolicy } from '@rental-os/mcp-server/prisma-oauth-web-consent' with { 'resolution-mode': 'import' };
import type { OriginalCompletedOAuthConsentSource } from '@rental-os/mcp-server/prisma-oauth-consent-authority' with { 'resolution-mode': 'import' };
import type { OriginalOAuthCodeAudit } from '@rental-os/mcp-server/prisma-oauth-store' with { 'resolution-mode': 'import' };

export interface OriginalMcpOAuthAudit {
  consent: OriginalOAuthWebConsentPolicy<Prisma.TransactionClient>['audit'];
  grant: OriginalCompletedOAuthConsentSource<Prisma.TransactionClient>['audit'];
  code: OriginalOAuthCodeAudit<Prisma.TransactionClient>['record'];
}
const unavailable = () => new Error('Original OAuth audit unavailable');
const live = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };
function fields(value: unknown, names: readonly string[], closed = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  if (closed && Reflect.ownKeys(descriptors).length !== names.length) throw unavailable();
  for (const name of names) { const field = descriptors[name]; if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw unavailable(); result[name] = field.value; }
  return result;
}
const ref = (v: unknown): v is string => typeof v === 'string' && /^[\x21-\x7e]{1,200}$/.test(v);
const rev = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

export function createOriginalMcpOAuthAudit(logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>): OriginalMcpOAuthAudit {
  if (typeof logs?.recordOriginalOAuthAudit !== 'function') throw unavailable();
  const record = logs.recordOriginalOAuthAudit.bind(logs);
  const write = async (tx: Prisma.TransactionClient, input: OriginalOAuthAuditRecord, signal: AbortSignal) => {
    live(signal); await record(tx, input, signal); live(signal);
  };
  return Object.freeze({
    async consent(tx: Prisma.TransactionClient, input: Parameters<OriginalMcpOAuthAudit['consent']>[1], signal: AbortSignal) {
      try {
        const v = fields(input, ['authorizationId', 'userId', 'tenantId', 'workspaceId', 'revision', 'stage']);
        if (!['prepared', 'approved', 'denied'].includes(v.stage as string)) throw unavailable();
        await write(tx, { tenantId: v.tenantId, userId: v.userId, workspaceId: v.workspaceId, action: `mcp.oauth.consent.${v.stage}`,
          targetType: 'mcp-oauth-consent', targetId: v.authorizationId, operationKey: v.authorizationId, revision: v.revision, grantId: null } as OriginalOAuthAuditRecord, signal);
      } catch { throw unavailable(); }
    },
    async grant(tx: Prisma.TransactionClient, input: Parameters<OriginalMcpOAuthAudit['grant']>[1], signal: AbortSignal) {
      try {
        const v = fields(input, ['authorizationId', 'authorizationRevision', 'grantId', 'userId', 'tenantId', 'workspaceId']);
        await write(tx, { tenantId: v.tenantId, userId: v.userId, workspaceId: v.workspaceId, action: 'mcp.oauth.grant.created',
          targetType: 'mcp-oauth-grant', targetId: v.grantId, operationKey: v.authorizationId, revision: v.authorizationRevision, grantId: v.grantId } as OriginalOAuthAuditRecord, signal);
      } catch { throw unavailable(); }
    },
    async code(tx: Prisma.TransactionClient, input: Parameters<OriginalMcpOAuthAudit['code']>[1], signal: AbortSignal) {
      try {
        live(signal); const v = fields(input, ['authorizationId', 'authorizationRevision', 'grantId']);
        if (!ref(v.authorizationId) || !rev(v.authorizationRevision) || !ref(v.grantId)) throw unavailable();
        const rows = await tx.$queryRaw<unknown[]>`SELECT id, userId, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE id = ${v.grantId} FOR UPDATE`;
        live(signal); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length !== 1) throw unavailable();
        const index = Object.getOwnPropertyDescriptor(rows, '0'); if (!index?.enumerable || !Object.hasOwn(index, 'value')) throw unavailable();
        const row = fields(index.value, ['id', 'userId', 'tenantId', 'workspaceId', 'recordJson'], false);
        let original = row.recordJson;
        if (typeof original === 'string') { if (Buffer.byteLength(original, 'utf8') > 65536) throw unavailable(); original = JSON.parse(original); }
        const grant = fields(original, ['id', 'userId', 'tenantId', 'workspaceId', 'consentRef', 'consentRevision'], false);
        if (grant.id !== v.grantId || ['id', 'userId', 'tenantId', 'workspaceId'].some(key => grant[key] !== row[key])
          || grant.consentRef !== v.authorizationId || grant.consentRevision !== v.authorizationRevision) throw unavailable();
        await write(tx, { tenantId: grant.tenantId, userId: grant.userId, workspaceId: grant.workspaceId, action: 'mcp.oauth.code.issued',
          targetType: 'mcp-oauth-code', targetId: v.authorizationId, operationKey: v.authorizationId, revision: v.authorizationRevision, grantId: v.grantId } as OriginalOAuthAuditRecord, signal);
      } catch { throw unavailable(); }
    },
  });
}
