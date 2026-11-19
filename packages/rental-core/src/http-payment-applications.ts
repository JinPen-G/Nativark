/** Rental支付HTTP消费原运行应用和对账实例，原Guard、订单范围与业务事务由同一宿主供给。 */
import type { PaymentRuntimeService } from "./mysql-payment-runtime";
import type { PaymentReconciliationFileService } from "./mysql-payment-reconciliation-file";
import { RENTAL_HTTP_CORE, type RentalHttpApplications } from "./http-applications";

export type RentalPaymentHttpApplication = Pick<PaymentRuntimeService,
  "listPaymentIntents" | "listPaymentRefunds" | "createPaymentRefund" | "refreshPaymentRefund" | "reconcileCurrentWorkspace" |
  "handleAlipayCallback" | "handleWechatCallback" | "handleStripeCallback" | "handleAlipayRefundCallback" | "handleWechatRefundCallback">;
export type RentalPaymentStatementHttpApplication = Pick<PaymentReconciliationFileService, "importStatement" | "listBatches" | "getBatch" | "reviewLine">;

export interface RentalPaymentHttpApplications {
  runtime: RentalPaymentHttpApplication;
  statements: RentalPaymentStatementHttpApplication;
  core: Pick<RentalHttpApplications["core"], "resolveWorkspaceId">;
}

export const RENTAL_PAYMENT_HTTP = {
  runtime: Symbol("rental.http.payment-runtime"),
  statements: Symbol("rental.http.payment-statements"),
  core: RENTAL_HTTP_CORE
} as const satisfies Record<keyof RentalPaymentHttpApplications, symbol>;
