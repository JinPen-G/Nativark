import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiProfileScope, AiProfileServiceMode } from './provider-profile.ports';
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
  private async lookup(columns: ReturnType<typeof aiPersistenceScopeColumns>) {
    try { return await this.db.aiScope.findFirst({ where: { ...columns }, select }); }
    catch { throw new AiScopeResolutionError('AI_STORAGE_UNAVAILABLE'); }
  }
  private project(row: Prisma.AiScopeGetPayload<{ select: typeof select }> | null, columns: ReturnType<typeof aiPersistenceScopeColumns>): AiProfileScope {
    if (!row) throw new AiScopeResolutionError('AI_RESOURCE_UNAVAILABLE');
    if (row.kind !== columns.kind || row.scopeKey !== columns.scopeKey
      || row.tenantId !== columns.tenantId || row.workspaceId !== columns.workspaceId) throw new AiScopeResolutionError('AI_SCOPE_CHANGED');
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(row.id)) throw new AiScopeResolutionError('AI_STORAGE_UNAVAILABLE');
    return { id: row.id, kind: row.kind,
      ...(row.tenantId !== null ? { tenantId: row.tenantId } : {}),
      ...(row.workspaceId !== null ? { workspaceId: row.workspaceId } : {}) };
  }
  async resolveCurrent(): Promise<{ context: AiExecutionContext; scope: AiProfileScope }> {
    const initial = await this.current(), row = await this.lookup(initial.columns), current = await this.current();
    if (initial.binding !== current.binding) throw new AiScopeResolutionError('AI_SCOPE_CHANGED');
    return { context: current.context, scope: this.project(row, current.columns) };
  }
  async resolveRoutingScopes(mode: AiProfileServiceMode): Promise<{ context: AiExecutionContext; consumerScope: AiProfileScope; configurationScope: AiProfileScope }> {
    if (mode !== 'platform_managed' && mode !== 'tenant_managed') throw new AiScopeResolutionError('AI_ACCESS_DENIED');
    const initial = await this.current();
    if (mode === 'tenant_managed' && initial.context.scope.kind === 'platform') throw new AiScopeResolutionError('AI_ACCESS_DENIED');
    const ownerColumns = aiPersistenceScopeColumns(mode === 'platform_managed' ? { kind: 'platform' }
      : { kind: 'tenant', tenantId: initial.columns.tenantId! });
    const consumerRow = await this.lookup(initial.columns);
    const ownerRow = ownerColumns.scopeKey === initial.columns.scopeKey ? consumerRow : await this.lookup(ownerColumns);
    const current = await this.current();
    if (initial.binding !== current.binding) throw new AiScopeResolutionError('AI_SCOPE_CHANGED');
    return { context: current.context, consumerScope: this.project(consumerRow, current.columns), configurationScope: this.project(ownerRow, ownerColumns) };
  }
}
