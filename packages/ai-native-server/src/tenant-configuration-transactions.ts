/** Public tenant configuration joins the caller's original transaction. Tenant
 * management needs no business workspace; scoped Core access stays with its host. */
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { PlatformPrincipalAuthority } from '@rental-os/platform-server/principal';
import type { PlatformAuthTransaction } from '@rental-os/platform-server/auth-store';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { captureAiRequestBinding } from './request-binding';

export interface TenantConfigurationContext { tenantId: string; actorId: string; workspaceId?: string; }
export interface AiConfigurationTransactionLease { revalidate(): Promise<void>; close(): void; }
export interface TenantConfigurationTransactionParticipant<Transaction extends object,
  Context extends TenantConfigurationContext = TenantConfigurationContext> {
  begin(transaction: Transaction, context: Context): Promise<AiConfigurationTransactionLease>;
}

/** Match public tenant administration: the fixed tenant admin or a base role
 * with the setting permission and full tenant scope. Never use a Core role. */
export function mayManageTenantConfiguration(subject: {
  isSaasAdmin?: boolean;
  isPlatformAdmin?: boolean;
  dataScope?: SystemUserRow['dataScope'];
  permissions?: readonly string[];
}, permission: string): boolean {
  return subject.isSaasAdmin !== true && (subject.isPlatformAdmin === true
    || subject.dataScope === 'all' && hasEffectivePermission(subject.permissions ?? [], permission));
}

export async function beginTenantConfigurationTransaction<Transaction extends object, Context extends TenantConfigurationContext>(
  transaction: Transaction, context: Context, participant: TenantConfigurationTransactionParticipant<Transaction, Context>
) {
  if (!participant || typeof participant.begin !== 'function' || '$transaction' in transaction)
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const denied = () => new ModelGatewayError('FORBIDDEN');
  const binding = captureAiRequestBinding(denied), source = binding.identity;
  let lease: AiConfigurationTransactionLease | undefined;
  const close = () => { binding.close(); lease?.close(); };
  try {
    if (source.tenantId !== context.tenantId || source.userId !== context.actorId
      || source.workspaceId !== context.workspaceId || source.isSaasAdmin !== false
      || source.audience !== 'operator' || source.staffApi) throw denied();
    lease = await participant.begin(transaction, Object.freeze({ ...context }));
    binding.assertCurrent();
    if (!lease || typeof lease.revalidate !== 'function' || typeof lease.close !== 'function') {
      lease = undefined;
      throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    }
    return Object.freeze({ async revalidate() {
      binding.assertCurrent();
      await lease!.revalidate();
      binding.assertCurrent();
    }, close });
  } catch (error) { close(); throw error; }
}

/** Tenant-wide settings use the public principal's current session and roles.
 * A workspace request must use its Core's participant, never this tenant-only one. */
export function createTenantConfigurationTransactions<Transaction extends PlatformAuthTransaction>(input: {
  principalAuthority: Pick<PlatformPrincipalAuthority<Transaction>, 'lock'>;
  requiredPermission: string;
  assertDataAvailable(transaction: Transaction): Promise<void>;
  assertCurrentUser?(user: SystemUserRow): void;
}): TenantConfigurationTransactionParticipant<Transaction> {
  if (typeof input?.principalAuthority?.lock !== 'function' || typeof input.requiredPermission !== 'string'
    || !input.requiredPermission || typeof input.assertDataAvailable !== 'function')
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  return Object.freeze({ async begin(transaction: Transaction, context: TenantConfigurationContext) {
    const denied = () => new ModelGatewayError('FORBIDDEN');
    const binding = captureAiRequestBinding(denied), source = binding.identity;
    const check = () => {
      binding.assertCurrent();
      if ('$transaction' in transaction || context.workspaceId !== undefined || source.workspaceId !== undefined
        || source.tenantId !== context.tenantId || source.userId !== context.actorId
        || source.isSaasAdmin !== false || source.audience !== 'operator' || source.staffApi
        || !mayManageTenantConfiguration(source, input.requiredPermission)) throw denied();
    };
    try {
      check();
      const lease = await input.principalAuthority.lock(transaction,
        { tenantId: context.tenantId, subjectId: context.actorId, audience: 'operator' }, context.tenantId);
      const verify = (user: typeof lease.user) => {
        check();
        if (user.id !== context.actorId || user.tenantId !== context.tenantId || !user.isActive
          || user.mustChangePassword || !mayManageTenantConfiguration(user, input.requiredPermission)) throw denied();
        input.assertCurrentUser?.(user);
      };
      const revalidate = async () => {
        check();
        await input.assertDataAvailable(transaction);
        // Data checks can wait. Session expiry must be checked after that wait.
        verify(await lease.revalidate());
      };
      verify(lease.user);
      await revalidate();
      return Object.freeze({ revalidate, close: binding.close });
    } catch (error) { binding.close(); throw error; }
  } });
}
