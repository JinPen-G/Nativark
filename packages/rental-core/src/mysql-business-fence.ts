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
  beforeParent?(transaction: RentalBusinessTenantTransaction, tenantId: string): Promise<void>;
  assertOperation?(transaction: RentalBusinessTenantTransaction, tenantId: string, workspaceId: string): Promise<void>;
};
const businessFenceScope = new AsyncLocalStorage<BusinessFenceScope>();

/** Presence only, including an expired selection. A specialized participant may
 * use this to reject a missing adapter instead of falling back to a legacy host. */
export function hasRentalBusinessTenantFence(): boolean {
  return businessFenceScope.getStore() !== undefined;
}

/** One instance per application. The host selects it around the original request
 * pipeline; the callback must reject until that application's Guard identity is bound.
 * There is deliberately no global registration or default authorization callback. */
export function createRentalBusinessTenantFence(
  assertCurrent: BusinessFenceScope["assertCurrent"], beforeParent?: BusinessFenceScope["beforeParent"],
  assertOperation?: BusinessFenceScope["assertOperation"]
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
      const scope: BusinessFenceScope = { owner, active: true, assertCurrent, beforeParent, assertOperation };
      return businessFenceScope.run(scope, async () => {
        try { return await consume(); }
        finally { scope.active = false; }
      });
    }
  });
}

/** Original payment participant calls this after its order lock, or inside the
 * short provider-admission transaction that locks no order. A system worker can
 * then lock its workspace without putting Workspace before Order in settlement. */
export async function assertRentalBusinessOperationAccessAfterLock(tx: RentalBusinessTenantTransaction,
  tenantId: string, workspaceId: string): Promise<void> {
  const scope = businessFenceScope.getStore();
  if (!scope) return;
  if (!scope.active) throw new ForbiddenException("Rental 请求范围已结束，不能开始业务动作");
  if (scope.assertOperation) await scope.assertOperation(tx, tenantId, workspaceId);
  else await scope.assertCurrent(tx, tenantId);
  if (!scope.active) throw new ForbiddenException("Rental 动作复核期间请求已结束");
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
  const scope = businessFenceScope.getStore();
  if (scope?.beforeParent) {
    if (!scope.active) throw new ForbiddenException("Rental 请求范围已结束，不能继续锁定业务");
    // Control-plane callers may need original sorted Tenant X/principal locks.
    // They must run before Tenant S, never upgrade a parent already held here.
    await scope.beforeParent(tx, tenantId);
    if (!scope.active) throw new ForbiddenException("Rental 管理身份复核期间请求已结束");
  }
  // Synchronization only: existing lifecycle/Guard checks still decide whether
  // this tenant may perform new business or historical fulfillment.
  const rows = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
  if (!rows.length) throw new ForbiddenException("商户不存在，不能锁定租赁事务");
  await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
}
