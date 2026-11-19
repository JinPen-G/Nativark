/** Rental支付/对账的私有MySQL视图与实际参加者，复用原数据库、资金服务和事务。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import type { RentalFundingService } from "./mysql-funding";
import type { RentalFundingRequestContext } from "./funding-storage";

export type RentalPaymentDataStore = Pick<PrismaClient,
  "rentalOrder" | "rentalPaymentIntent" | "rentalPaymentRefund" | "paymentWebhookEvent" | "externalAdapterLog" | "$transaction">;
export type RentalPaymentReadClient = Pick<Prisma.TransactionClient, "rentalPaymentIntent" | "rentalPaymentRefund">;
export type RentalPaymentRefundClient = Pick<Prisma.TransactionClient, "rentalPaymentRefund">;
export type RentalPaymentStatementDataStore = Pick<PrismaClient,
  "rentalPaymentIntent" | "rentalPaymentRefund" | "paymentReconciliationBatch" | "paymentReconciliationLine" | "$transaction">;

export type RentalPaymentIntegrationParticipant = Pick<TenantIntegrationService,
  "runtimeConfig" | "runtimeConfigsForCallback" | "assertEnabledInTransaction">;
export type RentalPaymentFundingParticipant = Pick<RentalFundingService<Prisma.TransactionClient>, "listEvents" | "recordEvent">;

export interface RentalPaymentRequestContext extends RentalFundingRequestContext {
  getRequestWorkspaceId(): string | undefined;
}

/** 原退款失败参加者与支付状态使用同一事务，事件数据由原出箱维护。 */
export interface RentalPaymentFailureEvents {
  refund(transaction: RentalPaymentRefundClient, scope: { tenantId: string; workspaceId: string }, id: string): Promise<void>;
}
