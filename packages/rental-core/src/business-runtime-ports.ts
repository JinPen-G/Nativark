/** Rental报价/营销运行层所需的实际宿主能力。
 * MySQL视图仅供私有运行入口；会员、密文和外部短信仍由原所属服务裁定。
 * 调用方原事务、当前范围与unknown原收据不可被默认实现替代。 */
import type { Prisma } from "@prisma/client";
import type { NotificationSmsResult, NotificationDeliveryQueryResult } from "@rental-os/platform-server/notification-delivery";
import type { TenantIntegrationProvider } from "@rental-os/platform-contracts/integration-provider";
import type { RentalBookingIdentityInput, RentalMembershipSnapshot } from "./contracts";
import type { RentalCoreMemberships } from "./core-runtime-ports";
import type { RentalBusinessFactTransaction } from "./business-fact-storage";
import type { RentalBusinessConfigurationTransaction } from "./business-configuration-storage";
import type { RentalCoreConfigurationTransaction } from "./core-configuration-storage";
import type { RentalServiceCapacityTransaction } from "./service-capacity-storage";
import type { RentalSnapshotTransaction } from "./state-storage";
import type { RentalCategoryCreationReader } from "./category-runtime";

export type RentalBusinessRuntimeTransaction = RentalBusinessFactTransaction & RentalBusinessConfigurationTransaction
  & RentalCoreConfigurationTransaction & RentalServiceCapacityTransaction & RentalSnapshotTransaction
  & RentalCategoryCreationReader & Pick<Prisma.TransactionClient, "customerDeliveryAddress" | "rentalPriceAdjustmentPlan" | "customerProfile" | "rentalNotificationLog" | "rentalNotificationTemplate" | "aiDataErasure">;

export type RentalBusinessRuntimeStorage<TTransaction extends RentalBusinessRuntimeTransaction> = TTransaction & {
  $transaction<TResult>(run: (transaction: TTransaction) => Promise<TResult>,
    options?: { isolationLevel?: "ReadCommitted"; maxWait?: number; timeout?: number }): Promise<TResult>;
};

export interface RentalBusinessMemberships<TTransaction> extends Pick<RentalCoreMemberships<TTransaction>, "hasOpenRiskForBooking"> {
  assertCustomerInWorkspace(tenantId: string, workspaceId: string, customerId: string): Promise<unknown>;
  countPlans(tenantId: string, transaction?: TTransaction): Promise<number>;
  resolveBookingIdentity(tenantId: string, workspaceId: string, personalCustomerId: string,
    input?: RentalBookingIdentityInput, transaction?: TTransaction, purpose?: "new_business" | "fulfillment"): Promise<RentalMembershipSnapshot>;
}

export interface RentalBusinessCorporateSettlement {
  assertQuoteCreditCurrency(tenantId: string, membership: RentalMembershipSnapshot, currency: string): Promise<unknown>;
}

export interface RentalBusinessNotifications {
  /** 配置存在只用于区分原开发模拟与生产拒绝，不代表真实投递成功。 */
  hasEnabledProvider(tenantId: string): Promise<boolean>;
  sendNotificationSms(tenantId: string, phone: string, templateCode: string, variables: Record<string, unknown>,
    variableNames: string[], idempotencyKey: string): Promise<NotificationSmsResult>;
  queryNotificationDelivery(tenantId: string, phone: string, providerMessageId: string,
    sentAt?: string, provider?: TenantIntegrationProvider): Promise<NotificationDeliveryQueryResult>;
}

/** 不输出密钥；稳定指纹与密文各自沿原加密服务和轮换规则。 */
export interface RentalBusinessSecretBox {
  encrypt(value: Record<string, string>): string;
  decrypt(value: string): Record<string, string>;
  fingerprint(value: string): string;
}
