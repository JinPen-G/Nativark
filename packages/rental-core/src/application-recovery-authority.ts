/** 原历史/善后入口的当前主体与原对象租约。先原 Auth 的 Tenant X/主体锁，
 * 再由 application-access 锁 Core，随后原 Order→Workspace→单据；空间历史只锁
 * 当前 Workspace，不进入订单动作。企业历史另用原企业动作/对象谓词，不能借本人授权代读。只复用原权限与
 * 可见性，不替代原状态机、资金算法、业务幂等或提供方结果判断。 */
import { sqltag as sql } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { CoreAccessError } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity, getRequestDataScope, getRequestLocationIds, getRequestUserId } from "@rental-os/platform-server/request-identity";
import type { RentalAuthService, WorkspaceAccessLease } from "./auth-service";
import type { ClientAuthService, RentalClientSessionTransaction } from "./mysql-client-auth";
import type { ClientRequestContext, RentalClientSessionLease } from "./client-context";
import { resolveUserBusinessLocationScope } from "./business-location-scope";
import { requestRentalOrderVisibilityWhere } from "./mysql-core-facts";
import { clientOwnsRentalOrder } from "./client-order-ownership";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import { assertRentalRecoveryBinding, type RentalRecoverySubject } from "./application-recovery-policy";
import type { EnterpriseApprovalService } from "./mysql-enterprise-approval";
import type { EnterpriseExtensionApprovalService } from "./mysql-enterprise-extension-approval";
import type { EnterpriseExchangeApprovalService } from "./mysql-enterprise-exchange-approval";
import type { EnterpriseManagementRequestService } from "./mysql-enterprise-management-request";
import type { RentalFileBusinessAccessService } from "./file-business-access";
import type { EnterprisePortalAction } from "./enterprise";
import type { EnterpriseAccessService } from "./mysql-enterprise-access";
import type { EnterpriseOrderReaderService } from "./mysql-enterprise-orders";
import { isRentalMemberTransaction as memberTransaction, memberLocationKey as locationKey,
  memberProjectionKey as memberKey } from "./application-member-authority";

interface RecoveryOrderReader {
  rentalOrder: { findFirst(input: { where: Prisma.RentalOrderWhereInput; select: {
    id: true; tenantId: true; workspaceId: true; status: true; fulfillmentMode: true; customerId: true; membershipSnapshot: true;
  } }): PromiseLike<{ id: string; tenantId: string; workspaceId: string; status: string;
    fulfillmentMode: string; customerId: string | null; membershipSnapshot: unknown } | null> };
}
const denied = (message: string) => new CoreAccessError("denied", message);
const methods = (value: unknown, names: readonly string[]): boolean => value !== null && typeof value === "object"
  && names.every(name => name in value && typeof Reflect.get(value, name) === "function");

function clientTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction & RentalClientSessionTransaction {
  return "clientAuthSession" in tx && methods(tx.clientAuthSession, ["findFirst"])
    && "customerAccount" in tx && methods(tx.customerAccount, ["findFirst"])
    && "customerMembership" in tx && methods(tx.customerMembership, ["findFirst"]);
}
function orderTransaction(tx: RentalBusinessTenantTransaction): tx is RentalBusinessTenantTransaction & RecoveryOrderReader {
  return "rentalOrder" in tx && methods(tx.rentalOrder, ["findFirst"]);
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
  /** Called after Tenant/Core. It locks the bound original order before workspace;
   * an explicit workspace-history read has no order and cannot become an action. */
  lockOriginalSubject(coreDisabled: boolean): Promise<void>;
  assertOrder(tenantId: string, workspaceId: string, orderId: string): void;
}

export function createRentalRecoveryAuthority(input: {
  auth: Pick<RentalAuthService, "lockRequestWorkspaceAccess">;
  clientAuth: Pick<ClientAuthService, "lockCurrentSession">;
  /** Same assembly's original enterprise qualifier/reader. Missing participants
   * reject these eight readers, including when the Core is currently enabled. */
  corporateHistory?: {
    access: Pick<EnterpriseAccessService, "requireWorkspaceAction">;
    orders: Pick<EnterpriseOrderReaderService, "assertHistoryOrder">;
  };
  originalHistory?: {
    files: Pick<RentalFileBusinessAccessService, "readHistoryOrderReference">;
    approvals: Pick<EnterpriseApprovalService, "readHistoryReference" | "readOrderHistoryReference">;
    extensions: Pick<EnterpriseExtensionApprovalService, "readHistoryReference">;
    exchanges: Pick<EnterpriseExchangeApprovalService, "readHistoryReference">;
    management: Pick<EnterpriseManagementRequestService, "readEvidenceHistoryReference">;
  };
}) {
  if (typeof input.auth?.lockRequestWorkspaceAccess !== "function" || typeof input.clientAuth?.lockCurrentSession !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 善后缺少原同实例当前身份权威");
  }
  // Subject identity lasts for this one buffered request, across admission, the
  // original audit/funding transactions and delivery. A restore with a newer
  // revision must not release data prepared under an earlier corporate grant.
  const corporateGrants = new WeakMap<RentalRecoverySubject, string>();
  const originalMaterials = new WeakMap<RentalRecoverySubject, string>();
  return Object.freeze({
    async lock(transaction: RentalBusinessTenantTransaction, request: RentalRecoveryRequest): Promise<RentalRecoveryLease> {
      assertRentalRecoveryBinding(request.subject);
      if ("$transaction" in transaction || !request.workspaceId || !request.tenantId
        || request.subject.declaration.scope === "order" && !orderTransaction(transaction)) {
        throw denied("Rental 善后必须使用原事务、当前空间及所需原对象读取器");
      }
      if (request.subject.declaration.scope === "workspace-history" && request.audience === "client")
        throw denied("经营空间报表与对账历史须沿原成员权限，不能借客户身份代读");
      const corporate = request.subject.declaration.scope === "corporate-history";
      const file = request.subject.declaration.scope === "file-history", approval = request.subject.declaration.scope === "approval-history";
      const proof = request.subject.declaration.scope === "payment-proof-history";
      const indirect = file || approval || proof;
      const originals = input.originalHistory;
      if (file && (request.audience === "client" || !request.subject.fileId)
        || (approval || proof) && (request.audience !== "client" || !request.client || !request.subject.referenceId && !request.subject.quoteId)
        || proof && !request.subject.fileId || request.subject.declaration.path === "/staff/v1/offline-payments" && request.audience !== "staff")
        throw denied("原文件、审批或员工收款历史主体不一致");
      if (file && typeof originals?.files?.readHistoryOrderReference !== "function"
        || approval && (request.subject.quoteId ? typeof originals?.approvals?.readOrderHistoryReference !== "function" : !request.subject.approvalKind || typeof (request.subject.approvalKind === "booking" ? originals?.approvals
          : request.subject.approvalKind === "extension" ? originals?.extensions : originals?.exchanges)?.readHistoryReference !== "function")
        || proof && typeof originals?.management?.readEvidenceHistoryReference !== "function")
        throw new CoreAccessError("core_unavailable", "原证据历史缺少同实例原对象定位参加者");
      type Located = { workspaceId: string; orderId?: string; materialKey: string; corporateId?: string;
        evidenceStage?: "pickup" | "return"; uploadedBy?: string | null; businessType?: string; uploadScene?: string };
      let located: Located | undefined, boundOrderId = request.subject.orderId, boundCorporateId = request.subject.corporateId;
      const locate = async (): Promise<Located> => {
        const subject = request.subject;
        if (file && originals && subject.fileId) return originals.files.readHistoryOrderReference(request.tenantId, subject.fileId, transaction);
        if (proof && originals && request.client && subject.referenceId && subject.fileId)
          return originals.management.readEvidenceHistoryReference(request.client, subject.referenceId, subject.fileId, transaction);
        if (approval && originals && request.client && subject.quoteId && subject.operationKey)
          return originals.approvals.readOrderHistoryReference(request.client, subject.quoteId, subject.operationKey, transaction);
        if (approval && originals && request.client && subject.referenceId) {
          const reader = subject.approvalKind === "booking" ? originals.approvals : subject.approvalKind === "extension" ? originals.extensions : originals.exchanges;
          return reader.readHistoryReference(request.client, subject.referenceId, transaction);
        }
        throw denied("原证据定位参数已变化");
      };
      const remember = (value: Located) => {
        const key = JSON.stringify(value), prior = originalMaterials.get(request.subject);
        if (value.workspaceId !== request.workspaceId || prior !== undefined && key !== prior)
          throw denied("原证据或审批关联已变化，请重新读取");
        if (request.subject.orderId && value.orderId !== request.subject.orderId) throw denied("文件不属于本次原订单");
        if (file && request.subject.orderId && (value.businessType !== "rental_order" || value.uploadScene !== "carrier-shipment-evidence"
          || value.uploadedBy !== request.user?.id)) throw denied("原承运证据不属于当前上传主体");
        originalMaterials.set(request.subject, key);
        located = value; boundOrderId = value.orderId; boundCorporateId = value.corporateId;
      };
      if (corporate && (request.audience !== "client" || !request.client || !request.subject.corporateId
        || request.subject.declaration.kind !== "history" || request.subject.intentId || request.subject.refundId))
        throw denied("企业历史必须绑定原客户、企业及已登记读取动作");
      if ((corporate || proof) && (typeof input.corporateHistory?.access?.requireWorkspaceAction !== "function"
        || typeof input.corporateHistory?.orders?.assertHistoryOrder !== "function"))
        throw new CoreAccessError("core_unavailable", "企业历史缺少同实例企业授权与原订单读取参加者");
      const identity = getRequestIdentity();
      if (!identity || identity.isSaasAdmin || identity.tenantId !== request.tenantId || identity.workspaceId !== request.workspaceId
        || identity.audience !== request.audience) throw denied("Rental 善后主体与原 Guard 证据不一致");
      let userLease: WorkspaceAccessLease | undefined, clientLease: RentalClientSessionLease | undefined;
      let corporateValidated = false;
      const checkCorporate = async () => {
        if (!corporate && !proof) return;
        const { subject, client } = request, participant = input.corporateHistory;
        const required: readonly EnterprisePortalAction[] | undefined = proof ? ["requests:manage", "orders:read", "finance:read"] : subject.declaration.corporateActions;
        if (!participant || !client || !boundCorporateId || !required?.length)
          throw denied("企业历史缺少原动作与对象依据");
        // The original qualifier checks current session, relationship, enabled
        // portals, exact action grants and their relationship revision together.
        const grant = await participant.access.requireWorkspaceAction(client, boundCorporateId, required[0], transaction);
        if (grant.corporateCustomerId !== boundCorporateId || required.some(action => !grant.actions.includes(action)))
          throw denied("企业历史当前动作权限不完整");
        const current = JSON.stringify([request.tenantId, request.workspaceId, client.customerId, boundCorporateId,
          grant.membershipId, grant.permissionRevision, [...grant.actions].sort()]);
        const original = corporateGrants.get(subject);
        if (original !== undefined && original !== current) throw denied("企业历史授权已变化，请重新读取");
        corporateGrants.set(subject, current);
        corporateValidated = true;
      };
      const originalMember = request.user ? memberKey(request.user) : undefined;
      const revalidate = async () => {
        assertRentalRecoveryBinding(request.subject);
        if (getRequestIdentity() !== identity || identity.tenantId !== request.tenantId || identity.workspaceId !== request.workspaceId)
          throw denied("Rental 善后主体上下文已变化");
        if (request.audience === "client") {
          const client = await clientLease!.revalidate();
          if (client.tenantId !== request.tenantId || client.workspaceId !== request.workspaceId || client.customerId !== identity.userId)
            throw denied("Rental 客户原会话或空间已变化");
          if (corporateValidated) await checkCorporate();
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
        if ((request.subject.declaration.scope !== "order" && !corporate && !indirect) || !boundOrderId || tenantId !== request.tenantId || workspaceId !== request.workspaceId
          || orderId !== boundOrderId) throw denied("Rental 善后事务不能切换原绑定订单");
      };
      return Object.freeze({ revalidate, assertOrder, async lockOriginalSubject(coreDisabled: boolean) {
        await revalidate();
        const { subject, tenantId, workspaceId } = request;
        if (indirect) {
          remember(await locate());
          if (!boundOrderId && (proof || approval && !subject.quoteId && subject.approvalKind !== "booking" || file && coreDisabled))
            throw denied("原对象未关联已存订单，不能使用停用后的订单证据读取");
        }
        if (subject.declaration.scope === "order" || (corporate || indirect) && boundOrderId) {
          if (!boundOrderId || !corporate && !proof && !orderTransaction(transaction)) throw denied("善后动作缺少原持久订单读取器");
          const rows = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_orders
            WHERE id = ${boundOrderId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId} FOR UPDATE`);
          if (rows.length !== 1 || rows[0].id !== boundOrderId) throw denied("原订单不存在或已不属于当前经营空间");
        } else if (!indirect && !["order-collection", "workspace-history", "corporate-history"].includes(subject.declaration.scope)
          || subject.declaration.kind !== "history" || subject.orderId || subject.intentId || subject.refundId)
          throw denied("空间历史只允许已登记的读取，不能绑定订单或资金动作");
        // Workspace follows the bound order. The reviewed workspace/collection
        // readers take no Order locks; assertOrder grants them no order actions.
        const spaces = await transaction.$queryRaw<Array<{ id: string; status: string }>>(sql`SELECT id, status FROM business_workspaces
          WHERE id = ${workspaceId} AND tenantId = ${tenantId} FOR UPDATE`);
        if (spaces.length !== 1 || spaces[0].id !== workspaceId || spaces[0].status.toLowerCase() !== "active")
          throw denied("当前经营空间已冻结或停用");
        if (indirect) remember(await locate());
        if (corporate || proof) {
          await checkCorporate();
          if (boundOrderId) {
            const participant = input.corporateHistory, client = request.client, required = proof ? ["finance:read"] : subject.declaration.corporateActions;
            if (!participant || !client || !boundCorporateId || !required?.length) throw denied("企业历史对象参加者已缺失");
            await participant.orders.assertHistoryOrder(client, boundCorporateId, boundOrderId, transaction,
              required.includes("finance:read"));
          }
          await revalidate();
          return;
        }
        if (boundOrderId) {
          if (!orderTransaction(transaction)) throw denied("原订单读取器不可用");
          const locations = getRequestLocationIds(), stage = located?.evidenceStage;
          const stageWhere = stage && locations !== undefined ? stage === "pickup"
            ? { fulfillmentLocationId: { in: locations } }
            : { OR: [{ returnLocationId: { in: locations } }, { returnLocationId: null, fulfillmentLocationId: { in: locations } }] } : {};
          const order = await transaction.rentalOrder.findFirst({ where: { id: boundOrderId, tenantId, workspaceId,
            AND: [stageWhere, requestRentalOrderVisibilityWhere({ getRequestDataScope, getRequestLocationIds, getRequestUserId })] },
            select: { id: true, tenantId: true, workspaceId: true, status: true, fulfillmentMode: true, customerId: true, membershipSnapshot: true } });
          if (!order || order.id !== boundOrderId || order.tenantId !== tenantId || order.workspaceId !== workspaceId
            || request.audience === "client" && !clientOwnsRentalOrder(request.client!, order)) throw denied("当前主体无权读取或处理原订单");
          if (file && subject.orderId && order.fulfillmentMode !== "carrier_shipping") throw denied("原承运证据必须属于承运订单");
          // A persisted draft is historical data, but does not prove an established
          // rental commitment. The original action still checks every later state.
          if (coreDisabled && subject.declaration.kind === "fulfillment" && order.status.toLowerCase() === "draft") throw denied("草稿订单不能借停用善后成立新业务");
          if (subject.intentId) {
            const intents = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_payment_intents
              WHERE id = ${subject.intentId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
                AND orderId = ${boundOrderId} FOR UPDATE`);
            if (intents.length !== 1 || intents[0].id !== subject.intentId) throw denied("原支付单不属于本次绑定订单");
          }
          if (subject.refundId) {
            const refunds = await transaction.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_payment_refunds
              WHERE id = ${subject.refundId} AND tenantId = ${tenantId} AND workspaceId = ${workspaceId}
                AND orderId = ${boundOrderId} AND paymentIntentId = ${subject.intentId} FOR UPDATE`);
            if (refunds.length !== 1 || refunds[0].id !== subject.refundId) throw denied("原退款单不属于本次绑定支付");
          }
        }
        await revalidate();
      } });
    }
  });
}
export type RentalRecoveryAuthority = ReturnType<typeof createRentalRecoveryAuthority>;
