/** Shared parent fence for business transactions, before aggregate/stock/credit
 * locks. Enterprise policy writers hold the exclusive parent fence; never upgrade.
 * A selected application may bind a request-local Core check to this same transaction;
 * this transport creates neither identities nor a process-wide authorization policy. */
import { AsyncLocalStorage } from "node:async_hooks";
import { sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { ForbiddenException } from "@nestjs/common";

export interface RentalBusinessTenantTransaction {
  $queryRaw<T>(query: Sql): PromiseLike<T>;
}

type BusinessFenceScope = {
  owner: object;
  active: boolean;
  assertCurrent(transaction: RentalBusinessTenantTransaction, tenantId: string): Promise<void>;
};
const businessFenceScope = new AsyncLocalStorage<BusinessFenceScope>();

/** One instance per application. The host selects it around the original request
 * pipeline; the callback must reject until that application's Guard identity is bound.
 * There is deliberately no global registration or default authorization callback. */
export function createRentalBusinessTenantFence(
  assertCurrent: BusinessFenceScope["assertCurrent"]
) {
  const owner = Object.freeze({});
  const assertBound = () => {
    const scope = businessFenceScope.getStore();
    if (!scope?.active || scope.owner !== owner) {
      throw new ForbiddenException("Rental 业务事务缺少本应用的有效请求范围");
    }
  };
  return Object.freeze({
    assertBound,
    async run<T>(consume: () => Promise<T>): Promise<T> {
      // Reject nested selections, including expired inherited contexts. Otherwise
      // a second application could replace the authority already attached to a write.
      if (businessFenceScope.getStore()) throw new ForbiddenException("Rental 请求不能嵌套或切换应用事务权威");
      const scope: BusinessFenceScope = { owner, active: true, assertCurrent };
      return businessFenceScope.run(scope, async () => {
        try { return await consume(); }
        finally { scope.active = false; }
      });
    }
  });
}

/** Revalidate the selected application in the caller's transaction after its
 * original Tenant shared/exclusive lock. This helper acquires no parent lock and
 * never upgrades one; callers must invoke it before facts or receipts are read. */
export async function assertRentalBusinessTenantAccessAfterLock(tx: RentalBusinessTenantTransaction, tenantId: string) {
  // Legacy hosts have no selected Core scope and retain their original behavior.
  // A selected standard host cannot fall back when its request has ended or has
  // not acquired original Guard evidence. Locks stay in this caller-owned transaction.
  const scope = businessFenceScope.getStore();
  if (scope) {
    if (!scope.active) throw new ForbiddenException("Rental 请求范围已结束，不能继续业务写入");
    await scope.assertCurrent(tx, tenantId);
    if (!scope.active) throw new ForbiddenException("Rental 授权复核期间请求已结束");
  }
}

export async function lockRentalBusinessTenant(tx: RentalBusinessTenantTransaction, tenantId: string) {
  // Synchronization only: existing lifecycle/Guard checks still decide whether
  // this tenant may perform new business or historical fulfillment.
  const rows = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
  if (!rows.length) throw new ForbiddenException("商户不存在，不能锁定租赁事务");
  await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
}
