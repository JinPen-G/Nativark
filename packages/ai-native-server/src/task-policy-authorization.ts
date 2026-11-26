/** Public Task action authorization with the original persisted policy and
 * current scope. Scene eligibility and business-object ACL remain host ports. */
import type { Prisma } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { AiTaskRepositoryError } from './task-errors';
import { AiScopeRepository, type AiCurrentScopeAuthority } from './runtime/ai-scope.repository';
import { aiTaskAccessFromContext } from './runtime/task-owner-access';
import { AiTaskActionChecks } from './runtime/task-action-checks';
import { PrismaTaskActionPolicySource } from './runtime/task-action-policy.reader';
import type { AiTaskRepositoryOperation } from './runtime/task-persistence.repository';

type Database = Pick<Prisma.TransactionClient, 'aiScope' | 'aiTask' | 'aiTaskActionPolicy'>;
type Action = AiTaskRepositoryOperation;
export type PublicTenantTaskContext = Extract<AiExecutionContext, { access: unknown }> & {
  audience: 'operator'; actor: { kind: 'user'; userId: string }; scope: { kind: 'tenant'; tenantId: string };
};
type PermissionSource = (operation: Action) => string | undefined;

/** Accepts a host-authenticated identity source, never an execution context
 * from a body. When used inside a held transaction, both the identity source
 * and db must be bound to that exact transaction. No policy is seeded here. */
export function createPublicTaskActionAuthority(input: {
  db: Database;
  identities: AiCurrentScopeAuthority;
  entryPermission: PermissionSource;
  assertTaskAction(context: PublicTenantTaskContext, taskId: string, operation: Action): Promise<void>;
  clock?: () => Date;
}) {
  if (typeof input?.db?.aiTask?.findFirst !== 'function' || typeof input.identities?.resolve !== 'function'
    || typeof input.entryPermission !== 'function' || typeof input.assertTaskAction !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { db, identities, entryPermission } = input, clock = input.clock ?? (() => new Date());
  const scopes = new AiScopeRepository(db, identities, clock);
  const original = new PrismaTaskActionPolicySource(db, scopes, clock);
  const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const checks = new AiTaskActionChecks(identities, { async resolve(taskId, operation, context) {
    // Identity policy determines the current permission; the owner predicate
    // also binds the operation to the original scope row and actual Task.
    const permission = entryPermission(operation);
    const effective = 'access' in context ? context.access.permissions : undefined;
    if (!permission || !effective || context.scope.kind !== 'tenant' || context.actor.kind !== 'user' || context.audience !== 'operator'
      || !hasEffectivePermission(effective, permission)) throw denied();
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const owner = await scopes.resolveCurrent();
    const current = aiTaskAccessFromContext(owner.context, taskId, clock());
    if (current.bindingKey !== access.bindingKey) throw denied();
    // Root and Native sources use the same owner predicate. Comparing the
    // returned row protects the authorization path from mismatched custody.
    const task = await db.aiTask.findFirst({ where: { ...access.where, scopeId: owner.scope.id }, select: {
      id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true, archivedAt: true
    } });
    if (!task || task.id !== taskId || task.scopeId !== owner.scope.id || task.scopeKind !== access.scope.kind
      || task.audience !== access.audience || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.archivedAt !== null) throw denied();
    await input.assertTaskAction(structuredClone(context as PublicTenantTaskContext), taskId, operation);
    return original.resolve(taskId, operation, context);
  } }, clock);
  return Object.freeze({ resolve: checks.resolve.bind(checks) });
}
