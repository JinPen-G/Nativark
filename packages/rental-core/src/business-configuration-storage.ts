/** Rental业务配置的私有MySQL视图。生成模型类型仅用于适配层；公共Core合同不依赖ORM。 */
import type { Prisma } from "@prisma/client";
import type { RentalCategoryDefinition } from "./contracts";
import type { CategoryWriteBinding } from "./configuration-basis";

export type RentalBusinessConfigurationTransaction = Pick<Prisma.TransactionClient,
  "$queryRaw" | "rentalBusinessCalendar"
  | "rentalCalendarOverrideAuditEntry" | "rentalDiscountPlan" | "rentalNotificationTemplate"
  | "rentalPriceVersion" | "rentalPricingPlan" | "rentalRuleVersion" | "rentalRuleVersionAudit"
  | "rentalValueAddedService" | "rentalValueAddedServiceVersion"> & {
    businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findMany" | "findFirst">;
    workspaceMember: Pick<Prisma.TransactionClient["workspaceMember"], "count">;
  };

export type RentalBusinessConfigurationStorage<TTransaction extends RentalBusinessConfigurationTransaction> =
  RentalBusinessConfigurationTransaction & {
    $transaction<T>(
      run: (transaction: TTransaction) => Promise<T>,
      options?: { isolationLevel: "ReadCommitted" }
    ): PromiseLike<T>;
  };

export interface RentalBusinessConfigurationContacts<TTransaction extends RentalBusinessConfigurationTransaction> {
  getRequestTenantId(): string | undefined;
  getRequestWorkspaceId(): string | undefined;
  getRequestIdentity(): unknown;
  resolveWorkspaceId(client: RentalBusinessConfigurationTransaction, tenantId: string): PromiseLike<string>;
  assertScopedWrite(
    existing: { tenantId: string; workspaceId: string } | null,
    tenantId: string,
    workspaceId: string,
    label: string
  ): void;
  lockCategoryBinding(
    transaction: TTransaction,
    tenantId: string,
    workspaceId: string,
    expected?: CategoryWriteBinding,
    categoryCode?: string
  ): PromiseLike<{ definition: RentalCategoryDefinition; binding: CategoryWriteBinding }>;
  /** 等待原配置提交点的事件捕获完成，不解释其业务返回值。 */
  openingConfiguration?(
    transaction: TTransaction,
    scope: { tenantId: string; workspaceId: string },
    reference: { kind: "business_settings"; id: string }
  ): PromiseLike<unknown>;
}
