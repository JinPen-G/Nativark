/** Platform management joins the repository's original transaction. Current
 * principal/data locks come from the host, never from a Core name or a DTO. */
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { PlatformPrincipalAuthority } from '@rental-os/platform-server/principal';
import type { PlatformAuthTransaction } from '@rental-os/platform-server/auth-store';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { captureAiRequestBinding } from './request-binding';

export interface PlatformAiManagementTransactionParticipant<Transaction extends object> {
  begin(transaction: Transaction, actorId: string): Promise<{
    revalidate(): Promise<void>;
    close(): void;
  }>;
}

/** A missing participant is unavailable. Legacy compatibility is selected only
 * by its separate host adapter; the public entry never silently skips locks. */
export async function beginPlatformAiManagementTransaction<Transaction extends object>(transaction: Transaction,
  actorId: string, participant: PlatformAiManagementTransactionParticipant<Transaction>) {
  if (!participant || typeof participant.begin !== 'function') throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const denied = () => new ModelGatewayError('FORBIDDEN');
  const binding = captureAiRequestBinding(denied), source = binding.identity;
  if ('$transaction' in transaction || !source.tenantId || source.userId !== actorId
    || source.isSaasAdmin !== true || source.audience !== 'operator' || source.staffApi) {
    binding.close();
    throw denied();
  }
  let lease: Awaited<ReturnType<typeof participant.begin>> | undefined;
  const close = () => { binding.close(); lease?.close?.(); };
  try {
    binding.assertCurrent();
    lease = await participant.begin(transaction, actorId);
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

/** Public SaaS participant. The existing principal authority owns session/User/
 * role/Tenant locks. The host checks its selected AI data in this same transaction.
 * requiredPermission comes from the registered server handler, never its body. */
export function createPlatformAiManagementTransactions<Transaction extends PlatformAuthTransaction>(input: {
  principalAuthority: Pick<PlatformPrincipalAuthority<Transaction>, 'lock'>;
  requiredPermission: string;
  assertDataAvailable(transaction: Transaction): Promise<void>;
  /** Compare the fresh Native principal with the authority captured before the write. */
  assertCurrentUser?(user: SystemUserRow): void;
  /** Server-resolved target of an existing record. The participant can lock a
   * frozen target for historical decisions; new writes check its own state. */
  targetTenantId?: string;
  clock?: () => number;
}): PlatformAiManagementTransactionParticipant<Transaction> {
  if (typeof input?.principalAuthority?.lock !== 'function' || typeof input.requiredPermission !== 'string' || !input.requiredPermission
    || typeof input.assertDataAvailable !== 'function') throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const targetTenantId = input.targetTenantId;
  return Object.freeze({ async begin(transaction: Transaction, actorId: string) {
    const denied = () => new ModelGatewayError('FORBIDDEN');
    const binding = captureAiRequestBinding(denied), identity = getRequestIdentity()!;
    const clock = input.clock ?? Date.now;
    const check = () => {
      binding.assertCurrent();
      if ('$transaction' in transaction || !identity.tenantId || identity.userId !== actorId || identity.isSaasAdmin !== true
        || identity.audience !== 'operator' || identity.staffApi || !identity.accessSession
        || !Number.isSafeInteger(identity.accessSession.expiresAt) || identity.accessSession.expiresAt <= clock() / 1000)
        throw denied();
    };
    const verify = (user: SystemUserRow) => {
      check();
      if (user.id !== actorId || user.tenantId !== identity.tenantId || !user.isActive
        || !user.isSaasAdmin || user.mustChangePassword || !hasEffectivePermission(user.permissions, input.requiredPermission))
        throw denied();
      input.assertCurrentUser?.(user);
    };
    try {
      check();
      const principal = { tenantId: identity.tenantId!, subjectId: actorId, audience: 'operator' as const };
      const lease = targetTenantId === undefined ? await input.principalAuthority.lock(transaction, principal, principal.tenantId)
        : await input.principalAuthority.lock(transaction, principal, targetTenantId, undefined, false);
      verify(lease.user);
      const revalidate = async () => {
        check();
        await input.assertDataAvailable(transaction);
        verify(await lease.revalidate());
      };
      await revalidate();
      return Object.freeze({ revalidate, close: binding.close });
    } catch (error) { binding.close(); throw error; }
  } });
}
