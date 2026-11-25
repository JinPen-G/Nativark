/** Rental到期作业的实际依赖；外层命名锁连接与内部业务短事务分别保留。
 * 只暴露本空间遍历、锁SQL及已使用的Core方法，企业/支付由原正式参加者供给。 */
import type { Prisma } from "@prisma/client";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalCoreRuntimeTransaction } from "./core-runtime-ports";
import type { RentalBusinessRuntimeTransaction } from "./business-runtime-ports";
import type { RentalIdempotentActionService } from "./mysql-idempotent-actions";
import type { RentalServiceCapacityService } from "./mysql-service-capacity";

export type RentalDueJobTransaction = RentalCoreRuntimeTransaction & RentalBusinessRuntimeTransaction;

export interface RentalDueJobStorage {
  rentalTenantBusinessSettings: Pick<Prisma.TransactionClient["rentalTenantBusinessSettings"], "findMany">;
  $transaction<T>(run: (transaction: Pick<Prisma.TransactionClient, "$queryRaw">) => Promise<T>,
    options: { maxWait: number; timeout: number }): PromiseLike<T>;
}

export type RentalDueJobCore<T extends RentalDueJobTransaction> = Pick<RentalCoreService<T>,
  "confirmNoShowOrder" | "expirePendingOrder" | "getBusinessSettings" |
  "getOrder" | "getProfile" | "getWorkspaceCategory" |
  "listCouponTemplates" | "listExpiredPendingOrderIds" | "listItemGroups" |
  "listLocations" | "listNoShowCandidateIds" | "listOperators" |
  "listPickupOverdueOrderIds" | "listPricingGroups" | "markPickupOverdueOrder" |
  "persist" | "readBusinessContext" | "recordNoShowNotice">;

export type RentalDueJobBusiness<T extends RentalDueJobTransaction> = Pick<RentalBusinessService<T>,
  "emitNotificationEvent" | "persist" | "refreshCouponTemplateCache" |
  "refreshFromDatabase" | "refreshWorkspaceContext" | "releaseCouponInTransaction" |
  "retryDueNotifications" | "runDuePriceAdjustments">;

export type RentalDueJobActions<T extends RentalDueJobTransaction> = Pick<RentalIdempotentActionService<T>,
  "execute" | "executeWithReplayFlag">;

export type RentalDueJobServiceCapacities<T extends RentalDueJobTransaction> = Pick<RentalServiceCapacityService<T>, "releaseForOrder">;

export interface RentalDueJobCorporateSettlement<T> {
  settleCancelledOrderCredit(tenantId: string, orderId: string, reason: string,
    transaction: T, operator?: string): Promise<unknown>;
}

export interface RentalDueJobPayments {
  expireStalePaymentIntents(tenantId: string, workspaceId: string, take?: number): Promise<unknown>;
}
