/** Explicit selected-Core participant in the original MCP Native transaction.
 * OAuth/Auth/Guard remain the identity and object authorities. This adds current
 * Core membership/binding/physical evidence and the canonical stop-new fence;
 * it owns no transaction, Web credential, publication, accounting or recovery. */
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { isCoreVersionSupported } from '@rental-os/core-contracts';
import { CoreAccessError, type CoreDeploymentAvailability } from '@rental-os/core-host';
import type { CoreHostSqlTransaction } from '@rental-os/core-host/mysql';
import { createMysqlCoreDeploymentAdmission } from '@rental-os/core-host/mysql-deployment-admission';
import { PlatformCoreAccess, type PlatformCoreUsers, type PlatformCoreTermPolicy } from '@rental-os/platform-core-host';
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from '@rental-os/rental-core/server';
import { RENTAL_DATA_READABLE } from '@rental-os/rental-core/data';
import type { OriginalMcpReadSubject } from './original-mcp-read-context';

export interface OriginalMcpCoreLease {
  /** Existing exact-result/control readers do not call this. It grants no new
   * task, approved action or permission to replay an unknown operation. */
  requireAccepting(): void;
  requireNewBusiness(): Promise<void>;
}
export interface OriginalMcpCoreAccess {
  withCurrent<T>(native: Prisma.TransactionClient, subject: OriginalMcpReadSubject, signal: AbortSignal,
    consume: (lease: OriginalMcpCoreLease) => Promise<T>): Promise<T>;
}
const unavailable = () => new CoreAccessError('core_unavailable', 'Original MCP Core access unavailable');

/** Only the owning selected host supplies these real ports. Omission of this
 * whole selection retains the old host; a selected but missing port rejects.
 * A physical observer must use the supplied Native reader, not its root DB. */
export function createOriginalMcpCoreAccess(input: {
  users: PlatformCoreUsers<Prisma.TransactionClient>;
  term: PlatformCoreTermPolicy<Prisma.TransactionClient>;
  deploymentForTransaction(reader: Pick<CoreHostSqlTransaction, '$queryRaw'>): CoreDeploymentAvailability;
}): OriginalMcpCoreAccess {
  if (typeof input?.users?.findUserById !== 'function' || typeof input.term?.requireNewBusiness !== 'function'
    || typeof input.deploymentForTransaction !== 'function') throw unavailable();
  const findUser = input.users.findUserById.bind(input.users), term = Object.freeze({
    requireNewBusiness: input.term.requireNewBusiness.bind(input.term)
  }), deploymentForTransaction = input.deploymentForTransaction.bind(input);
  return Object.freeze({ async withCurrent<T>(native: Prisma.TransactionClient, raw: OriginalMcpReadSubject,
    signal: AbortSignal, consume: (lease: OriginalMcpCoreLease) => Promise<T>): Promise<T> {
    if (!native || '$transaction' in native || typeof native.$queryRaw !== 'function' || signal.aborted
      || typeof consume !== 'function' || raw.audience !== 'operator' || !raw.userId || !raw.tenantId || !raw.workspaceId
      || !raw.grantId || !Number.isSafeInteger(raw.grantRevision) || raw.grantRevision < 1) throw unavailable();
    const subject = structuredClone(raw);
    let active = true;
    const live = () => { if (!active || signal.aborted || !isDeepStrictEqual(raw, subject)) throw unavailable(); };
    const reader = Object.freeze({ $queryRaw: native.$queryRaw.bind(native) });
    const deployment = deploymentForTransaction(reader);
    if (typeof deployment?.requireAvailable !== 'function' || typeof deployment.requireRegistered !== 'function') throw unavailable();
    const access = new PlatformCoreAccess(term, deployment);
    const scope = { tenantId: subject.tenantId, coreId: RENTAL_CORE_ID,
      container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: subject.workspaceId! } };
    const check = async () => {
      live();
      const tenants = await native.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM Tenant WHERE id = ${subject.tenantId} LOCK IN SHARE MODE`;
      live();
      if (tenants.length !== 1 || tenants[0].id !== subject.tenantId || tenants[0].status?.toLowerCase() !== 'active') throw unavailable();
      const user = await findUser(subject.userId, native); live();
      if (!user || user.id !== subject.userId || user.tenantId !== subject.tenantId || !user.isActive
        || user.mustChangePassword || user.isSaasAdmin) throw unavailable();
      await access.requireMember(native, user, RENTAL_CORE_ID); live();
      const binding = await access.binding(native, scope); live();
      if (!binding || !isCoreVersionSupported(binding.dataVersion, RENTAL_DATA_READABLE)) throw unavailable();
      return binding;
    };
    try {
      // Run before AI scope/goal/request/resource locks. The original transaction
      // keeps these Core and canonical locks through its own commit/unknown path.
      const binding = await check();
      const admission = await createMysqlCoreDeploymentAdmission(reader).readCurrent(RENTAL_CORE_ID); live();
      if (admission.coreId !== RENTAL_CORE_ID) throw unavailable();
      const accepting = () => { live(); if (admission.state !== 'accepting') throw unavailable(); };
      const lease: OriginalMcpCoreLease = Object.freeze({ requireAccepting: accepting,
        async requireNewBusiness() { accepting(); await access.requireNewBusiness(native, subject.tenantId); accepting(); }
      });
      const result = await consume(lease); live();
      if (!isDeepStrictEqual(binding, await check())) throw unavailable();
      live(); return result;
    } finally { active = false; }
  } });
}
