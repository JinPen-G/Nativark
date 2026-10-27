import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { AuthService } from '../auth/auth.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyMutation,
  type AiTaskActionPolicyMutationAuthority } from './prisma-task-action-policy.repository';

type Dependencies = {
  db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiTaskActionPolicy'> & Partial<Pick<PrismaClient, 'operationLog'>>;
  auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
  guard: Pick<ApiAuthGuard, 'canActivate'>; clock?: () => Date;
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Explicit task-policy configuration using the original system-rules Guard.
 * It does not seed policy during task creation, register HTTP, grant business
 * approval, or turn task ownership into permission to configure execution.
 * Owner-only is deliberate: no cross-user sharing/admin fallback is introduced.
 */
export function composeTaskActionPolicyManagement(input: Dependencies) {
  const clock = input.clock ?? (() => new Date());
  const identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
  const scopes = new AiScopeRepository(input.db, identity, clock);
  const management = new TenantModelConfigurationAuthority(input.guard, input.credentials, identity);

  const authority = (permissions: readonly string[]): AiTaskActionPolicyMutationAuthority => ({
    async resolve(taskId, operation) {
      if (operation !== 'configure_action_policy') throw denied();
      const before = await scopes.resolveCurrent();
      const access = aiTaskAccessFromContext(before.context, taskId, clock());
      const context = before.context;
      if (context.actor.kind !== 'user' || context.audience !== 'operator' || context.scope.kind !== 'workspace'
        || before.scope.kind !== 'WORKSPACE' || !('access' in context)
        || permissions.some(permission => !context.access.permissions.includes(permission))) throw denied();
      await management.authorize({ tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
        actorId: context.actor.userId }, 'manage');
      const row = await input.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: before.scope.id }] },
        select: { id: true, scopeId: true, revision: true, audience: true, ownerKind: true, ownerId: true, archivedAt: true } });
      if (!row || row.id !== taskId || row.scopeId !== before.scope.id || row.ownerKind !== access.actorKind
        || row.ownerId !== access.actorId || row.audience !== access.audience || row.archivedAt !== null) throw unavailable();
      const after = await scopes.resolveCurrent();
      const current = aiTaskAccessFromContext(after.context, taskId, clock());
      if (after.scope.id !== before.scope.id || current.bindingKey !== access.bindingKey
        || identityHash(after.context) !== identityHash(context)) throw denied();
      const latest = await input.db.aiTask.findFirst({ where: { AND: [current.where, { scopeId: after.scope.id }] },
        select: { id: true, revision: true, ownerId: true, ownerKind: true, audience: true } });
      if (!latest || latest.id !== row.id || latest.revision !== row.revision || latest.ownerId !== row.ownerId
        || latest.ownerKind !== row.ownerKind || latest.audience !== row.audience) throw denied();
      return after.context;
    },
  });
  return Object.freeze({
    read(taskId: string, operation: AiTaskActionPolicyMutation['operation']) {
      return new PrismaTaskActionPolicyRepository(input.db, scopes, authority([]), clock).read(taskId, operation);
    },
    readMutation(taskId: string, operation: AiTaskActionPolicyMutation['operation'], expectedRevision: number | null,
      mutation: 'configure' | 'clear' = 'configure') {
      return new PrismaTaskActionPolicyRepository(input.db, scopes, authority([]), clock).readMutation(taskId, operation, expectedRevision, mutation);
    },
    /** Required permissions are server-selected existing codes, never inferred
     * from a model. The manager must currently hold every selected permission;
     * CAS/null-create still follows the existing repository contract. */
    put(value: AiTaskActionPolicyMutation, expectedRevision: number | null, recordOriginalReceipt = false) {
      const command = structuredClone(value);
      if (!Array.isArray(command?.requiredPermissions)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const repository = new PrismaTaskActionPolicyRepository(input.db, scopes, authority([...command.requiredPermissions]), clock);
      return repository.put(command, expectedRevision, recordOriginalReceipt);
    },
    clear(taskId: string, operation: AiTaskActionPolicyMutation['operation'], expectedRevision: number, recordOriginalReceipt = false) {
      const repository = new PrismaTaskActionPolicyRepository(input.db, scopes, authority([]), clock);
      return repository.clear(taskId, operation, expectedRevision, recordOriginalReceipt);
    },
  });
}

function identityHash(context: Awaited<ReturnType<AiTaskCurrentIdentityAuthority['resolve']>>) {
  const { requestId: _id, authorizedAt: _at, ...identity } = context;
  return requestFingerprint(identity);
}
