import { ModelGatewayError } from './model-gateway.ports';

export type AiOperationsKind = 'invocations' | 'usage' | 'reconciliation';
/** Resolved by fresh public authorization adapter, never by a model/request DTO. */
export interface AiOperationsGrant {
  tenantId: string; workspaceId: string; actorId: string;
  audience: 'operator' | 'staff'; dataScope: 'own' | 'all'; revision: string;
}
export interface AiOperationsFilter { after?: string; limit: number; }
export interface AiOperationsRow {
  id: string; tenantId: string; workspaceId: string; actorId: string;
  status: string; createdAt: Date; reservedUnits?: number; actualInput?: number | null; actualOutput?: number | null;
}
export interface AiOperationsRepository {
  /** Must apply grant before SELECT, ordered by stable id asc with take=limit+1. */
  list(kind: AiOperationsKind, grant: Readonly<AiOperationsGrant>, filter: Readonly<AiOperationsFilter>): Promise<readonly AiOperationsRow[]>;
}
export interface AiOperationsAuthorization {
  resolve(identityHandle: unknown, permission: 'ai.operations.read' | 'ai.reconciliation.read'): Promise<AiOperationsGrant>;
}
const idPattern = /^[a-zA-Z0-9_.:-]{1,191}$/;
const kinds: readonly AiOperationsKind[] = ['invocations', 'usage', 'reconciliation'];
/** Read-only projection; no dispatch/retry action, credentials, prompts or payloads. */
export class AiOperationsQueryService {
  constructor(private readonly authorization: AiOperationsAuthorization, private readonly repository: AiOperationsRepository) {
    if (typeof authorization?.resolve !== 'function' || typeof repository?.list !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  private async grant(handle: unknown, kind: AiOperationsKind) {
    const raw = await this.authorization.resolve(handle, kind === 'reconciliation' ? 'ai.reconciliation.read' : 'ai.operations.read');
    if (!raw || ![raw.tenantId, raw.workspaceId, raw.actorId, raw.revision].every(value => typeof value === 'string' && idPattern.test(value)) || !['operator', 'staff'].includes(raw.audience) || !['own', 'all'].includes(raw.dataScope)) throw new ModelGatewayError('FORBIDDEN');
    return Object.freeze({ tenantId: raw.tenantId, workspaceId: raw.workspaceId, actorId: raw.actorId, audience: raw.audience, dataScope: raw.dataScope, revision: raw.revision });
  }
  async list(identityHandle: unknown, kind: AiOperationsKind, input: unknown = {}) {
    if (!kinds.includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw new ModelGatewayError('INVALID_REQUEST');
    const query = input as Record<string, unknown>;
    if (Object.keys(query).some(key => !['after', 'limit'].includes(key))) throw new ModelGatewayError('INVALID_REQUEST');
    const limit = query.limit ?? 20;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50 || (query.after !== undefined && (typeof query.after !== 'string' || !idPattern.test(query.after)))) throw new ModelGatewayError('INVALID_REQUEST');
    const grant = await this.grant(identityHandle, kind);
    const rows = await this.repository.list(kind, grant, Object.freeze({ limit: limit + 1, ...(query.after === undefined ? {} : { after: query.after as string }) }));
    const refreshed = await this.grant(identityHandle, kind);
    if (JSON.stringify(grant) !== JSON.stringify(refreshed)) throw new ModelGatewayError('FORBIDDEN');
    if (!Array.isArray(rows) || rows.length > limit + 1) throw new ModelGatewayError('INVALID_RESPONSE');
    let last = typeof query.after === 'string' ? query.after : '';
    for (const row of rows) {
      if (!row || !idPattern.test(row.id) || row.id <= last || row.tenantId !== grant.tenantId || row.workspaceId !== grant.workspaceId || (grant.dataScope === 'own' && row.actorId !== grant.actorId) || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime()) || !['admitted', 'dispatching', 'completed', 'unknown', 'cancelled', 'revoked', 'reserved', 'released', 'settled'].includes(row.status)) throw new ModelGatewayError('INVALID_RESPONSE');
      if (kind === 'reconciliation' && row.status !== 'unknown') throw new ModelGatewayError('INVALID_RESPONSE');
      for (const key of ['reservedUnits', 'actualInput', 'actualOutput'] as const) if (row[key] !== undefined && row[key] !== null && (!Number.isSafeInteger(row[key]) || row[key]! < 0)) throw new ModelGatewayError('INVALID_RESPONSE');
      last = row.id;
    }
    const selected = rows.slice(0, limit);
    return {
      items: selected.map(row => ({ id: row.id, status: row.status, createdAt: row.createdAt.toISOString(), ...(kind === 'usage' ? { reservedUnits: row.reservedUnits ?? null, actualInput: row.actualInput ?? null, actualOutput: row.actualOutput ?? null } : {}), ...(kind === 'reconciliation' ? { nextAction: 'reconcile' as const, retryAllowed: false as const } : {}) })),
      nextCursor: rows.length > limit ? selected[selected.length - 1].id : null,
    };
  }
}
