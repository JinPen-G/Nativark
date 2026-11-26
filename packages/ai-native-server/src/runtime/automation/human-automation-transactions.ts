/** Human event metadata joins each original transaction separately. Current
 * Auth/Tenant/Core and original Order locks precede event/input/task locks.
 * This participant never dispatches work or replaces an uncertain operation. */
import type { AiBusinessFailureOutbox, Prisma, PrismaClient } from '@prisma/client';
import type { RentalAuthService } from '@rental-os/rental-core/auth-service';
import type { RentalCoreFactRepository } from '@rental-os/rental-core/mysql-core-facts';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority } from '../task-transaction-authority';
import { AutomationError } from './prisma-automation.authority';

export interface HumanAutomationTransactionDependencies {
  auth: Pick<RentalAuthService, 'lockRequestWorkspaceAccess'>;
  orders: Pick<RentalCoreFactRepository<Prisma.TransactionClient>, 'lockOrder' | 'findOrder'>;
}
export interface HumanAutomationTransactionParticipant {
  begin(tx: Prisma.TransactionClient, eventIds: readonly string[]): Promise<{ revalidate(): Promise<void>; close(): void }>;
}
const unavailable = () => new AutomationError('unavailable');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const identityKey = (value: NonNullable<ReturnType<typeof getRequestIdentity>>) => hash({
  tenantId: value.tenantId, workspaceId: value.workspaceId, userId: value.userId, audience: value.audience,
  accessSession: value.accessSession, isSaasAdmin: value.isSaasAdmin, isPlatformAdmin: Boolean(value.isPlatformAdmin),
  staffApi: Boolean(value.staffApi), permissions: value.permissions && [...value.permissions].sort(),
  dataScope: value.dataScope, organizationId: value.organizationId, locationScope: value.locationScope,
  staffLocationScope: value.staffLocationScope
});

export function createHumanAutomationTransactions(input: {
  db: Pick<PrismaClient, 'aiBusinessFailureOutbox'>;
  reads: BusinessFailureReadAuthority;
  credentials: AiTaskCredentialSource;
  ports?: HumanAutomationTransactionDependencies;
}): HumanAutomationTransactionParticipant {
  const identity = getRequestIdentity(), originalIdentity = identity && identityKey(identity);
  return Object.freeze({ async begin(tx: Prisma.TransactionClient, eventIds: readonly string[]) {
    const ports = input.ports;
    if (!hasRentalBusinessTenantFence() || '$transaction' in tx || !ports?.auth
      || typeof ports.auth.lockRequestWorkspaceAccess !== 'function' || typeof ports.orders?.lockOrder !== 'function'
      || typeof ports.orders.findOrder !== 'function' || !identity || identity.isSaasAdmin !== false
      || !['operator', 'staff'].includes(identity.audience ?? '') || Boolean(identity.staffApi) !== (identity.audience === 'staff')
      || !identity.tenantId || !identity.workspaceId || !identity.userId || !identity.accessSession
      || !identity.permissions || !identity.dataScope || !identity.locationScope) throw unavailable();
    const tenantId = identity.tenantId, workspaceId = identity.workspaceId, credential = await input.credentials.current();
    let active = true;
    const live = async () => {
      const current = await input.credentials.current();
      if (!active || getRequestIdentity() !== identity || identityKey(identity) !== originalIdentity
        || identity.accessSession!.expiresAt <= Date.now() / 1000 || current.audience !== identity.audience
        || current.authorization !== credential.authorization) throw unavailable();
    };
    await live();
    // Nonlocking locator reads precede Auth. Original bindings are verified
    // again inside the owning transaction before any metadata mutation.
    const originals: AiBusinessFailureOutbox[] = [];
    for (const id of [...new Set(eventIds)].sort()) {
      const event = await input.db.aiBusinessFailureOutbox.findFirst({ where: { id, tenantId, workspaceId } });
      if (!event || event.id !== id || event.tenantId !== tenantId || event.workspaceId !== workspaceId) throw unavailable();
      originals.push(event);
    }
    try {
      const lease = await ports.auth.lockRequestWorkspaceAccess(tx);
      const current = async (user: typeof lease.user) => {
        await live();
        if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== identity.userId || user.tenantId !== tenantId
          || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin) || user.dataScope !== identity.dataScope
          || user.organizationId !== identity.organizationId || hash([...user.permissions].sort()) !== hash([...identity.permissions!].sort())) throw unavailable();
        const locations = await resolveUserBusinessLocationScope(user, workspaceId, user.locationScope ?? { mode: 'all', locationIds: [] }, tx);
        if (hash(locations) !== hash(identity.locationScope)) throw unavailable();
        await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
        await live();
      };
      await current(lease.user);
      await holdAiTaskDeploymentAdmission(tx, 'new_work');
      for (const orderId of [...new Set(originals.flatMap(event => event.orderId ? [event.orderId] : []))].sort()) {
        await ports.orders.lockOrder(tenantId, orderId, tx);
        const order = await ports.orders.findOrder(tenantId, orderId, tx);
        if (!order || order.id !== orderId || order.tenantId !== tenantId) throw unavailable();
      }
      const resources = async () => {
        for (const event of originals) await input.reads.withOriginalEvent(event, async () => undefined, tx);
      };
      await resources();
      return Object.freeze({ async revalidate() {
        await resources();
        await current(await lease.revalidate());
      }, close() { active = false; } });
    } catch (error) { active = false; throw error; }
  } });
}

export async function withHumanAutomationTransaction<T>(tx: Prisma.TransactionClient,
  participant: HumanAutomationTransactionParticipant | undefined, eventIds: readonly string[],
  consume: () => Promise<T>, finalCheck?: () => void): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (!participant) throw unavailable();
  const lease = await participant.begin(tx, eventIds);
  try {
    const result = await consume();
    await lease.revalidate();
    finalCheck?.();
    return result;
  } finally { lease.close(); }
}

/** Single original CAS writes acquire their own transaction in selected hosts.
 * Multi-stage event/task workflows retain their existing separate commit points. */
export function mutateHumanAutomation<T, Db extends object>(db: Db & Partial<Pick<PrismaClient, '$transaction'>>,
  participant: HumanAutomationTransactionParticipant | undefined, eventIds: readonly string[],
  consume: (db: Db) => Promise<T>, finalCheck?: () => void): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume(db);
  if (!db.$transaction) throw unavailable();
  return db.$transaction(tx => withHumanAutomationTransaction(tx, participant, eventIds,
    () => consume(tx as unknown as Db), finalCheck),
  { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
}

export async function withHumanAutomationTaskCreation<T>(participant: HumanAutomationTransactionParticipant | undefined,
  target: { eventId: string; inputRef: string; sceneCode: string; binding: string },
  verify: (tx: Prisma.TransactionClient, lock: boolean) => Promise<void>, consume: () => Promise<T>, finalCheck: () => void): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (!participant) throw unavailable();
  const leases: { close(): void }[] = [];
  try {
    return await withAiTaskTransactionAuthority({ binding: target.binding, async begin(tx, reference) {
      const lease = await participant.begin(tx, [target.eventId]);
      leases.push(lease);
      await verify(tx, true);
      const verifyReference = async (key: typeof reference) => {
        if (key.kind !== 'creation' || key.inputRef !== target.inputRef || key.sceneCode !== target.sceneCode) throw unavailable();
        await verify(tx, false);
      };
      await verifyReference(reference);
      return { verifyReference, async revalidate() {
        await verifyReference(reference);
        await lease.revalidate();
        finalCheck();
      } };
    } }, consume);
  } finally { for (const lease of leases) lease.close(); }
}
