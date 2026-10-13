import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { BudgetError } from './budget/budget.ports';

/** Current tenant configuration metadata only. Same canonical keys/unique index
 * as task creation; never creates a task, policy, lease, entitlement or grant.
 * Existing metadata is not reassigned or repaired on collision. */
export async function registerCurrentAiConfigurationScopes(input: {
  db: Pick<PrismaClient, '$transaction' | 'aiScope'>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiTaskCredentialSource;
  clock?: () => Date;
}) {
  const identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, input.clock);
  const management = new TenantModelConfigurationAuthority(input.guard, input.credentials, identity);
  const resolve = async () => {
    const context = structuredClone(await identity.resolve());
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
    await management.authorize({ actorId: context.actor.userId, tenantId: context.scope.tenantId,
      workspaceId: context.scope.workspaceId }, 'manage');
    const { requestId: _, authorizedAt: __, ...principal } = context;
    return { context, fingerprint: requestFingerprint(principal) };
  };
  const initial = await resolve();
  const scope = initial.context.scope;
  if (scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
  const keys = [aiPersistenceScopeColumns({ kind: 'tenant', tenantId: scope.tenantId }), aiPersistenceScopeColumns(scope)];
  const recheck = async () => {
    if ((await resolve()).fingerprint !== initial.fingerprint) throw new BudgetError('FORBIDDEN');
  };
  let callbackCompleted = false;
  try {
    await input.db.$transaction(async tx => {
      // Fixed TENANT -> WORKSPACE order; never writes PLATFORM metadata here.
      for (const key of keys) {
        const row = await tx.aiScope.upsert({ where: { scopeKey: key.scopeKey }, create: { id: randomUUID(), ...key }, update: {},
          select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
        if (!row || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(row.id)
          || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)) throw new BudgetError('FORBIDDEN');
        await recheck();
      }
      await recheck();
      callbackCompleted = true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  } catch (error) {
    if (callbackCompleted) throw new BudgetError('PENDING_RECONCILIATION');
    if (error instanceof BudgetError) throw error;
    throw new BudgetError('PENDING_RECONCILIATION');
  }
  try { await recheck(); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
  return initial.context;
}
