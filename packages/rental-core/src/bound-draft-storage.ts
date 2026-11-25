/** 绑定规则/日历草稿和批准设置的私有MySQL视图。
 * 只描述本链读取和同一事务；生成模型类型留在该适配层，通用Core合同不依赖ORM。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { RentalCategoryBindingTransaction } from "./mysql-category-write";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { ApprovedSettingsParticipant } from "./approved-settings-ports";

export interface RentalBoundDraftTransactionOptions {
  isolationLevel: "RepeatableRead" | "Serializable";
  maxWait: number;
  timeout: number;
}
export type RentalBoundRuleDraftTransaction = RentalCategoryBindingTransaction &
  Pick<Prisma.TransactionClient, "operationLog" | "rentalRuleVersion" | "rentalRuleVersionAudit">;
export type RentalBoundRuleDraftLineageReader = Pick<PrismaClient, "rentalRuleVersion">;
export type RentalBoundRuleDraftStorage = Pick<PrismaClient, "operationLog" | "rentalRuleVersion"> & {
  $transaction<TResult>(run: (transaction: RentalBoundRuleDraftTransaction) => Promise<TResult>, options: RentalBoundDraftTransactionOptions): PromiseLike<TResult>;
};
export type RentalBoundRuleDraftBusiness = Pick<RentalBusinessService, "prepareBoundRuleDraft" | "refreshBoundRuleDraftVersion">;

export type RentalBoundCalendarDraftTransaction = RentalCategoryBindingTransaction &
  Pick<Prisma.TransactionClient, "rentalBusinessCalendar" | "rentalCalendarOverrideAuditEntry">;
export type RentalBoundCalendarDraftStorage = Pick<PrismaClient, "rentalCalendarOverrideAuditEntry"> & {
  $transaction<TResult>(run: (transaction: RentalBoundCalendarDraftTransaction) => Promise<TResult>, options: RentalBoundDraftTransactionOptions): PromiseLike<TResult>;
};
export type RentalBoundCalendarDraftBusiness = Pick<RentalBusinessService, "prepareBoundCalendarDraftDay" | "refreshBoundCalendarDraftYear">;

export type RentalApprovedSettingsStorage = Pick<PrismaClient, "$transaction" | "rentalApprovedSettingsOperation">;
export type RentalApprovedSettingsCore = Pick<RentalCoreService<Prisma.TransactionClient>,
  "readVersionedBusinessSettings" | "previewNotificationSettings" | "commitNotificationSettings" | "refreshCommittedBusinessSettings">;
export type RentalApprovedSettingsParticipant = ApprovedSettingsParticipant<Prisma.TransactionClient>;
