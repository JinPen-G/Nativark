/** Rental核心配置的私有MySQL视图。只包含本仓储使用的表方法；生成模型不进入公共Core合同。 */
import type { Prisma } from "@prisma/client";

export interface RentalCoreConfigurationTransaction {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst" | "findMany" | "findUnique" | "upsert">;
  tenantRentalProfile: Pick<Prisma.TransactionClient["tenantRentalProfile"], "findMany" | "findUnique" | "upsert">;
  rentalTenantBusinessSettings: Pick<Prisma.TransactionClient["rentalTenantBusinessSettings"], "findFirst" | "findMany" | "findUnique" | "updateMany" | "upsert">;
  rentalFulfillmentOperator: Pick<Prisma.TransactionClient["rentalFulfillmentOperator"], "findFirst" | "findMany" | "findUnique" | "upsert">;
  rentalFulfillmentLocation: Pick<Prisma.TransactionClient["rentalFulfillmentLocation"], "count" | "findFirst" | "findMany" | "findUnique" | "upsert">;
  rentalItemGroup: Pick<Prisma.TransactionClient["rentalItemGroup"], "count" | "findFirst" | "findMany" | "findUnique" | "upsert">;
  rentalPricingGroup: Pick<Prisma.TransactionClient["rentalPricingGroup"], "findMany" | "findUnique" | "upsert">;
  rentalCouponTemplate: Pick<Prisma.TransactionClient["rentalCouponTemplate"], "findMany" | "upsert">;
  rentalInspectionTemplate: Pick<Prisma.TransactionClient["rentalInspectionTemplate"], "findMany" | "findUnique" | "upsert">;
  rentalCategoryVersion: Pick<Prisma.TransactionClient["rentalCategoryVersion"], "findUnique">;
  rentalCategoryDefinition: Pick<Prisma.TransactionClient["rentalCategoryDefinition"], "findUnique">;
  rentalCategoryAdoptionAudit: Pick<Prisma.TransactionClient["rentalCategoryAdoptionAudit"], "upsert">;
  rentalAttributeUniqueValue: Pick<Prisma.TransactionClient["rentalAttributeUniqueValue"], "create" | "deleteMany">;
  rentalAsset: Pick<Prisma.TransactionClient["rentalAsset"], "findFirst">;
  rentalBundleComponent: Pick<Prisma.TransactionClient["rentalBundleComponent"], "create" | "deleteMany">;
  rentalPricingGroupMember: Pick<Prisma.TransactionClient["rentalPricingGroupMember"], "createMany" | "deleteMany">;
  // 初始化只读取原账号状态；地点配置只验证原组织引用，不授予公共人员/组织写权。
  user: Pick<Prisma.TransactionClient["user"], "findMany">;
  organizationUnit: Pick<Prisma.TransactionClient["organizationUnit"], "findFirst">;
  workspaceMember: Pick<Prisma.TransactionClient["workspaceMember"], "upsert">;
}

export type RentalCoreConfigurationStorage<TTransaction extends RentalCoreConfigurationTransaction> =
  RentalCoreConfigurationTransaction & {
    $transaction<T>(
      run: (transaction: TTransaction) => Promise<T>,
      options?: { isolationLevel: "ReadCommitted" }
    ): Promise<T>;
  };

export interface RentalCoreConfigurationContacts<TTransaction extends RentalCoreConfigurationTransaction> {
  getRequestTenantId(): string | undefined;
  getRequestWorkspaceId(): string | undefined;
  getRequestStaffLocationIds(): string[] | undefined;
  staffLocationWhere(field?: string): Record<string, { in: string[] }>;
  resolveWorkspaceId(client: RentalCoreConfigurationTransaction, tenantId: string): PromiseLike<string>;
  assertScopedWrite(
    existing: { tenantId: string; workspaceId: string } | null,
    tenantId: string,
    workspaceId: string,
    label: string
  ): void;
  /** 同一调用方事务捕获原事件，Core不解释AI持久化表或重做事件。 */
  openingConfiguration?(
    transaction: TTransaction,
    scope: { tenantId: string; workspaceId: string },
    reference: { kind: "tenant_profile" | "core_snapshot" | "business_settings"; id: string }
  ): PromiseLike<unknown>;
}
