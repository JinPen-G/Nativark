/** Conversation metadata joins its own original transaction. The selected
 * request's Auth/Tenant/Core fence precedes conversation CAS and receipts;
 * metadata ownership grants no Task, model, approval or business execution. */
import type { Prisma } from '@prisma/client';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { AI_TASK_CENTER_ENTRY_PERMISSIONS } from '@rental-os/shared';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { AiTaskRepositoryError } from './ai-task.repository';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { holdAiTaskDeploymentAdmission } from './task-transaction-authority';

type Owner = { scopeId: string; ownerId: string; tenantId: string; workspaceId: string };
type Identity = NonNullable<ReturnType<typeof getRequestIdentity>>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
function identityKey(value: Identity) {
  return hash({ tenantId: value.tenantId, workspaceId: value.workspaceId, userId: value.userId,
    audience: value.audience, accessSession: value.accessSession, isSaasAdmin: value.isSaasAdmin,
    isPlatformAdmin: Boolean(value.isPlatformAdmin), staffApi: Boolean(value.staffApi),
    permissions: value.permissions && [...value.permissions].sort(), dataScope: value.dataScope,
    organizationId: value.organizationId, locationScope: value.locationScope && {
      mode: value.locationScope.mode, locationIds: [...value.locationScope.locationIds].sort() } });
}

export async function beginConversationTransaction(input: AiOriginalSceneDependencies, tx: Prisma.TransactionClient,
  owner: Owner, purpose: 'new_work' | 'task_control') {
  if (!hasRentalBusinessTenantFence()) return undefined;
  const identity = getRequestIdentity(), auth = input.transactions?.auth;
  if ('$transaction' in tx || typeof auth?.lockRequestWorkspaceAccess !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (!identity || identity.audience !== 'operator' || identity.staffApi || identity.isSaasAdmin !== false
    || identity.tenantId !== owner.tenantId || identity.workspaceId !== owner.workspaceId || identity.userId !== owner.ownerId
    || !identity.accessSession || !identity.permissions || !identity.dataScope || !identity.locationScope) throw denied();
  const original = identityKey(identity), credential = await input.credentials.current();
  if (credential.audience !== 'operator') throw denied();
  let active = true;
  const live = async () => {
    const current = await input.credentials.current();
    if (!active || getRequestIdentity() !== identity || identityKey(identity) !== original
      || current.audience !== 'operator' || current.authorization !== credential.authorization) throw denied();
  };
  try {
    await live();
    const lease = await auth.lockRequestWorkspaceAccess(tx);
    const verify = async (user: typeof lease.user) => {
      await live();
      if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== owner.ownerId || user.tenantId !== owner.tenantId
        || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin) || user.dataScope !== identity.dataScope
        || user.organizationId !== identity.organizationId || hash([...user.permissions].sort()) !== hash([...identity.permissions!].sort())
        || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(permission => hasEffectivePermission(user.permissions, permission))) throw denied();
      const locations = await resolveUserBusinessLocationScope(user, owner.workspaceId,
        user.locationScope ?? { mode: 'all', locationIds: [] }, tx);
      if (hash({ mode: locations.mode, locationIds: [...locations.locationIds].sort() }) !== hash({
        mode: identity.locationScope!.mode, locationIds: [...identity.locationScope!.locationIds].sort() })) throw denied();
      await assertRentalBusinessTenantAccessAfterLock(tx, owner.tenantId);
      await live();
    };
    await verify(lease.user);
    await holdAiTaskDeploymentAdmission(tx, purpose);
    const columns = aiPersistenceScopeColumns({ kind: 'workspace', tenantId: owner.tenantId, workspaceId: owner.workspaceId });
    const scope = await tx.aiScope.findFirst({ where: { id: owner.scopeId, ...columns } });
    if (!scope || scope.id !== owner.scopeId || Object.entries(columns).some(([key, value]) => scope[key as keyof typeof columns] !== value))
      throw denied();
    return Object.freeze({ async revalidate() { await verify(await lease.revalidate()); }, close() { active = false; } });
  } catch (error) { active = false; throw error; }
}
