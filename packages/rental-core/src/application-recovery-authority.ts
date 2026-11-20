/** 原历史/善后入口的当前主体与原对象租约。先原 Auth 的 Tenant X/主体锁，
 * 再由 application-access 锁 Core，随后原 Order→Workspace→单据；只复用原权限与
 * 可见性，不替代原状态机、资金算法、业务幂等或提供方结果判断。 */
import { sqltag as sql } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { CoreAccessError } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity, getRequestDataScope, getRequestLocationIds, getRequestUserId } from "@rental-os/platform-server/request-identity";
import type { RentalAuthService, WorkspaceAccessLease } from "./auth-service";
import type { ClientAuthService, RentalClientSessionTransaction } from "./mysql-client-auth";
import type { ClientRequestContext, RentalClientSessionLease } from "./client-context";
import type { RentalWorkspaceAccessTransaction } from "./mysql-workspace-principal";
import { resolveUserBusinessLocationScope, type RentalBusinessLocationReader } from "./business-location-scope";
import { requestRentalOrderVisibilityWhere } from "./mysql-core-facts";
import { clientOwnsRentalOrder } from "./client-order-ownership";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import type { RentalRecoverySubject } from "./application-recovery-policy";

interface RecoveryOrderReader {
  rentalOrder: { findFirst(input: { where: Prisma.RentalOrderWhereInput; select: {
    id: true; tenantId: true; workspaceId: true; status: true; customerId: true; membershipSnapshot: true;
  } }): PromiseLike<{ id: string; tenantId: string; workspaceId: string; status: string;
    customerId: string | null; membershipSnapshot: unknown } | null> };
}
const denied = (message: string) => new CoreAccessError("denied", message);
const methods = (value: unknown, names: readonly string[]): boolean => value !== null && typeof value === "object"
  && names.every(name => name in value && typeof Reflect.get(value, name) === "function");

function memberTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction & RentalWorkspaceAccessTransaction & RentalBusinessLocationReader {
  return "user" in tx && methods(tx.user, ["findFirst", "findUnique", "findUniqueOrThrow", "update"])
    && "authSession" in tx && methods(tx.authSession, ["findFirst", "create", "updateMany"])
    && "workspaceMember" in tx && methods(tx.workspaceMember, ["findFirst"])
    && "businessWorkspace" in tx && methods(tx.businessWorkspace, ["findFirst"])
    && "organizationUnit" in tx && methods(tx.organizationUnit, ["findMany"])
    && "rentalFulfillmentLocation" in tx && methods(tx.rentalFulfillmentLocation, ["findMany"]);
}
function clientTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction & RentalClientSessionTransaction {
  return "clientAuthSession" in tx && methods(tx.clientAuthSession, ["findFirst"])
    && "customerAccount" in tx && methods(tx.customerAccount, ["findFirst"])
    && "customerMembership" in tx && methods(tx.customerMembership, ["findFirst"]);
}
function orderTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction & RecoveryOrderReader {
  return "rentalOrder" in tx && methods(tx.rentalOrder, ["findFirst"]);
}
function locationKey(scope: SystemUserRow["locationScope"]) {
  return scope && JSON.stringify([scope.mode, [...scope.locationIds].sort()]);
}
function memberKey(user: SystemUserRow) {
  return JSON.stringify([user.id, user.tenantId, user.isActive, Boolean(user.mustChangePassword), Boolean(user.isSaasAdmin),
    Boolean(user.isPlatformAdmin), [...user.permissions].sort(), user.dataScope, user.organizationId, locationKey(user.locationScope)]);
}

export interface RentalRecoveryRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly audience: "operator" | "staff" | "client";
  readonly user?: SystemUserRow;
  readonly client?: ClientRequestContext;
  readonly subject: RentalRecoverySubject;
}
export interface RentalRecoveryLease {
  /** Recheck expiry/current projection; the original row locks remain in this tx. */
  revalidate(): Promise<void>;
  /** Called after Tenant/Core. It locks only the server-bound original order,
   * then workspace/current original object, before any action participant. */
  lockOriginalSubject(coreDisabled: boolean): Promise<void>;
  assertOrder(tenantId: string, workspaceId: string, orderId: string): void;
}

export function createRentalRecoveryAuthority(input: {
  auth: Pick<RentalAuthService, "lockRequestWorkspaceAccess">;
  clientAuth: Pick<ClientAuthService, "lockCurrentSession">;
}) {
  if (typeof input.auth?.lockRequestWorkspaceAccess !== "function" || typeof input.clientAuth?.lockCurrentSession !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 善后缺少原同实例当前身份权威");
  }
  return Object.freeze({
    async lock(transaction: RentalBusinessTenantTransaction, request: RentalRecoveryRequest): Promise<RentalRecoveryLease> {
      if ("$transaction" in transaction || !request.workspaceId || !request.tenantId || !orderTransaction(transaction)) {
        throw denied("Rental 善后必须使用原事务、当前空间和原订单读取器");
      }
      const identity = getRequestIdentity();
      if (!identity || identity.isSaasAdmin || identity.tenantId !== request.tenantId || identity.workspaceId !== request.workspaceId
        || identity.audience !== request.audience) throw denied("Rental 善后主体与原 Guard 证据不一致");
      let userLease: WorkspaceAccessLease | undefined, clientLease: RentalClientSessionLease | undefined;
      const originalMember = request.user ? memberKey(request.user) : undefined;
      const revalidate = async () => {
        if (getRequestIdentity() !== identity || identity.tenantId !== request.tenantId || identity.workspaceId !== request.workspaceId)
          throw denied("Rental 善后主体上下文已变化");
        if (request.audience === "client") {
          const client = await clientLease!.revalidate();
          if (client.tenantId !== request.tenantId || client.workspaceId !== request.workspaceId || client.customerId !== identity.userId)
            throw denied("Rental 客户原会话或空间已变化");
          return;
        }
        if (!memberTransaction(transaction)) throw denied("Rental 原主体事务读取器不可用");
        const current = await userLease!.revalidate();
        if (!originalMember || memberKey(current) !== originalMember || current.id !== identity.userId
          || current.isSaasAdmin || !current.isActive || current.mustChangePassword
          || JSON.stringify([...current.permissions].sort()) !== JSON.stringify([...(identity.permissions ?? [])].sort())
          || current.dataScope !== identity.dataScope || current.organizationId !== identity.organizationId
          || Boolean(current.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin)) throw denied("Rental 当前成员权限或范围已变化，请重新读取");
        const locations = await resolveUserBusinessLocationScope(current, request.workspaceId,
          current.locationScope ?? { mode: "all", locationIds: [] }, transaction);
        if (locationKey(locations) !== locationKey(identity.locationScope)
          || identity.staffApi && locationKey(locations) !== locationKey(identity.staffLocationScope))
          throw denied("Rental 当前组织或地点范围已变化，请重新读取");
      };
      if (request.audience === "client") {
        if (!request.client || request.user || !clientTransaction(transaction)) throw denied("Rental 善后缺少原客户会话事务");
        clientLease = await input.clientAuth.lockCurrentSession(transaction, request.client);
      } else {
        if (!request.user || request.client || !memberTransaction(transaction)) throw denied("Rental 善后缺少原成员会话事务");
        userLease = await input.auth.lockRequestWorkspaceAccess(transaction);
      }
      await revalidate();
      const assertOrder = (tenantId: string, workspaceId: string, orderId: string) => {
        if (!request.subject.orderId || tenantId !== request.tenantId || workspaceId !== request.workspaceId
          || orderId !== request.subject.orderId) throw denied("Rental 善后事务不能切换原绑定订单");
      };
      return Object.freeze({ revalidate, assertOrder, async lockOriginalSubject(coreDisabled: boolean) {
        await revalidate();
        const { subject, tenantId, workspaceId } = request;
        if (subject.orderId) {
          const rows = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_orders
            WHERE id = ${subject.orderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`);
          if (rows.length !== 1 || rows[0].id !== subject.orderId) throw denied("原订单不存在或已不属于当前经营空间");
        } else if (!subject.declaration.collection || subject.declaration.kind !== "history") throw denied("善后动作缺少原持久订单");
        // Workspace follows the original order; never acquire it in beforeParent.
        const spaces = await transaction.$queryRaw<Array<{ id: string; status: string }>>(sql`SELECT id, status FROM business_workspaces
          WHERE id = ${workspaceId} AND tenantId = ${tenantId} FOR UPDATE`);
        if (spaces.length !== 1 || spaces[0].id !== workspaceId || spaces[0].status.toLowerCase() !== "active")
          throw denied("当前经营空间已冻结或停用");
        if (subject.orderId) {
          const order = await transaction.rentalOrder.findFirst({ where: { id: subject.orderId, tenantId, workspaceId,
            ...requestRentalOrderVisibilityWhere({ getRequestDataScope, getRequestLocationIds, getRequestUserId }) },
            select: { id: true, tenantId: true, workspaceId: true, status: true, customerId: true, membershipSnapshot: true } });
          if (!order || order.id !== subject.orderId || order.tenantId !== tenantId || order.workspaceId !== workspaceId
            || request.audience === "client" && !clientOwnsRentalOrder(request.client!, order)) throw denied("当前主体无权读取或处理原订单");
          // A persisted draft is historical data, but does not prove an established
          // rental commitment. The original action still checks every later state.
          if (coreDisabled && subject.declaration.kind === "fulfillment" && order.status.toLowerCase() === "draft") throw denied("草稿订单不能借停用善后成立新业务");
          if (subject.intentId) {
            const intents = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_payment_intents
              WHERE id = ${subject.intentId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
                AND orderId = ${subject.orderId} FOR UPDATE`);
            if (intents.length !== 1 || intents[0].id !== subject.intentId) throw denied("原支付单不属于本次绑定订单");
          }
          if (subject.refundId) {
            const refunds = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_payment_refunds
              WHERE id = ${subject.refundId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
                AND orderId = ${subject.orderId} AND paymentIntentId = ${subject.intentId} FOR UPDATE`);
            if (refunds.length !== 1 || refunds[0].id !== subject.refundId) throw denied("原退款单不属于本次绑定支付");
          }
        }
        await revalidate();
      } });
    }
  });
}
export type RentalRecoveryAuthority = ReturnType<typeof createRentalRecoveryAuthority>;
