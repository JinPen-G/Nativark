/** Selected Rental host participation in the original model-configuration transaction.
 * Auth/Tenant and Core precede Scope/config/Profile CAS. No outer transaction,
 * second configuration store, model dispatch, credential cache or receipt retry. */
import type { Prisma } from '@prisma/client';
import type { RentalAuthService } from '@rental-os/rental-core/auth-service';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { ModelGatewayError, type WorkspaceGatewayContext } from './model-gateway.ports';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

export interface TenantModelConfigurationTransactionParticipant {
  begin(transaction: Prisma.TransactionClient, context: WorkspaceGatewayContext): Promise<{
    revalidate(): Promise<void>;
    close(): void;
  }>;
}
export interface TenantModelConfigurationTransactions {
  auth: Pick<RentalAuthService, 'lockRequestWorkspaceAccess'>;
}
const denied = () => new ModelGatewayError('FORBIDDEN');
const unavailable = () => new ModelGatewayError('PROVIDER_UNAVAILABLE');
type Identity = NonNullable<ReturnType<typeof getRequestIdentity>>;
const key = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
function identityKey(identity: Identity) {
  return key({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, userId: identity.userId,
    audience: identity.audience, accessSession: identity.accessSession, isSaasAdmin: identity.isSaasAdmin,
    isPlatformAdmin: Boolean(identity.isPlatformAdmin), staffApi: Boolean(identity.staffApi),
    permissions: identity.permissions && [...identity.permissions].sort(), dataScope: identity.dataScope,
    organizationId: identity.organizationId, locationScope: identity.locationScope && {
      mode: identity.locationScope.mode, locationIds: [...identity.locationScope.locationIds].sort() } });
}

/** Legacy callers retain their existing transaction. A selected request must
 * provide the original participant; a missing port never becomes legacy mode. */
export function beginTenantModelConfigurationTransaction(transaction: Prisma.TransactionClient,
  context: WorkspaceGatewayContext, participant?: TenantModelConfigurationTransactionParticipant) {
  if (!hasRentalBusinessTenantFence()) return Promise.resolve(undefined);
  if (!participant || typeof participant.begin !== 'function' || '$transaction' in transaction) throw unavailable();
  return participant.begin(transaction, context);
}

export function createTenantModelConfigurationTransactions(input: {
  transactions?: TenantModelConfigurationTransactions;
  credentials: AiTaskCredentialSource;
}): TenantModelConfigurationTransactionParticipant {
  const source = getRequestIdentity(), original = source && identityKey(source);
  return Object.freeze({ async begin(transaction: Prisma.TransactionClient, context: WorkspaceGatewayContext) {
    const auth = input.transactions?.auth;
    if (!hasRentalBusinessTenantFence() || '$transaction' in transaction || !auth
      || typeof auth.lockRequestWorkspaceAccess !== 'function') throw unavailable();
    if (!source || source.audience !== 'operator' || source.staffApi || source.isSaasAdmin !== false
      || source.tenantId !== context.tenantId || source.workspaceId !== context.workspaceId || source.userId !== context.actorId
      || !source.accessSession || !source.permissions || !source.dataScope || !source.locationScope) throw denied();
    let active = true;
    const credential = await input.credentials.current();
    if (credential.audience !== 'operator') throw denied();
    const live = async () => {
      const current = await input.credentials.current();
      if (!active || getRequestIdentity() !== source || identityKey(source) !== original
        || current.audience !== 'operator' || current.authorization !== credential.authorization) throw denied();
    };
    try {
      await live();
      const lease = await auth.lockRequestWorkspaceAccess(transaction);
      const verify = async (user: typeof lease.user) => {
        await live();
        if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== context.actorId
          || user.tenantId !== context.tenantId || Boolean(user.isPlatformAdmin) !== Boolean(source.isPlatformAdmin)
          || user.dataScope !== source.dataScope || user.organizationId !== source.organizationId
          || key([...user.permissions].sort()) !== key([...source.permissions!].sort())
          || !hasEffectivePermission(user.permissions, 'system:params:manage')) throw denied();
        const locations = await resolveUserBusinessLocationScope(user, context.workspaceId,
          user.locationScope ?? { mode: 'all', locationIds: [] }, transaction);
        if (key({ mode: locations.mode, locationIds: [...locations.locationIds].sort() }) !== key({
          mode: source.locationScope!.mode, locationIds: [...source.locationScope!.locationIds].sort() })) throw denied();
        await assertRentalBusinessTenantAccessAfterLock(transaction, context.tenantId);
        await live();
      };
      await verify(lease.user);
      return Object.freeze({ async revalidate() {
        try { await live(); await verify(await lease.revalidate()); }
        catch (error) { throw error instanceof ModelGatewayError ? error : denied(); }
      },
        close() { active = false; } });
    } catch (error) { active = false; throw error instanceof ModelGatewayError ? error : denied(); }
  } });
}
