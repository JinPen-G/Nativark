import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiProfileScope } from './provider-profile.ports';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { isAiStepExecutionContext } from './task-contract-validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export class AiScopeResolutionError extends Error {
  constructor(readonly code: 'AI_ACCESS_DENIED' | 'AI_SCOPE_CHANGED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_STORAGE_UNAVAILABLE') { super(code); }
}
export interface AiCurrentScopeAuthority {
  /** Bound to the real request/job credential by the application. Never accepts model identity fields. */
  resolve(): Promise<AiExecutionContext>;
}
const select = { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } satisfies Prisma.AiScopeSelect;

/** Resolve existing canonical scope metadata only. No scope creation, owner fallback,
 * provider selection or business authorization. Consumers must reauthorize each action.
 */
export class AiScopeRepository {
  constructor(private readonly db: Pick<PrismaClient, 'aiScope'>, private readonly authority: AiCurrentScopeAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (!authority || typeof authority.resolve !== 'function') throw new AiScopeResolutionError('AI_ACCESS_DENIED');
  }
  private async current() {
    try {
      const context = structuredClone(await this.authority.resolve()), now = this.clock();
      if (!isAiStepExecutionContext(context) || !(now instanceof Date) || !Number.isFinite(now.getTime())
        || Date.parse(context.authorizedAt) > now.getTime()
        || (context.actor.kind === 'automation' && Date.parse(context.actor.expiresAt) <= now.getTime())) throw Error();
      const columns = aiPersistenceScopeColumns(context.scope);
      const { authorizedAt: _, requestId: __, ...identity } = context;
      return { context, columns, binding: requestFingerprint(identity) };
    } catch { throw new AiScopeResolutionError('AI_ACCESS_DENIED'); }
  }
  async resolveCurrent(): Promise<{ context: AiExecutionContext; scope: AiProfileScope }> {
    const initial = await this.current();
    let row: Prisma.AiScopeGetPayload<{ select: typeof select }> | null;
    try { row = await this.db.aiScope.findFirst({ where: { ...initial.columns }, select }); }
    catch { throw new AiScopeResolutionError('AI_STORAGE_UNAVAILABLE'); }
    // Discard buffered metadata if identity or permissions changed while the DB was read.
    const current = await this.current();
    if (initial.binding !== current.binding) throw new AiScopeResolutionError('AI_SCOPE_CHANGED');
    if (!row) throw new AiScopeResolutionError('AI_RESOURCE_UNAVAILABLE');
    if (row.kind !== current.columns.kind || row.scopeKey !== current.columns.scopeKey
      || row.tenantId !== current.columns.tenantId || row.workspaceId !== current.columns.workspaceId) throw new AiScopeResolutionError('AI_SCOPE_CHANGED');
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(row.id)) throw new AiScopeResolutionError('AI_STORAGE_UNAVAILABLE');
    return { context: current.context, scope: {
      id: row.id, kind: row.kind,
      ...(row.tenantId !== null ? { tenantId: row.tenantId } : {}),
      ...(row.workspaceId !== null ? { workspaceId: row.workspaceId } : {})
    } };
  }
}
