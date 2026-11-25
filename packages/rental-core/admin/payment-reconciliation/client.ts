/** 支付对账沿原批次、明细、CSV 导入和差异处理请求消费 Rental 事实。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  PaymentStatementBatchDetail,
  PaymentStatementBatchSummary,
  ReviewPaymentStatementLineRequest,
} from "@rental-os/rental-core";

export function createRentalPaymentReconciliationApi(request: AdminRuntime["request"]) {
  return {
    paymentStatementBatches: (limit = 50, signal?: AbortSignal) =>
      request<PaymentStatementBatchSummary[]>(
        `/rental/v1/payment-reconciliation/statements?limit=${limit}`,
        { signal },
      ),
    paymentStatementBatch: (batchId: string, signal?: AbortSignal) =>
      request<PaymentStatementBatchDetail>(
        `/rental/v1/payment-reconciliation/statements/${encodeURIComponent(batchId)}`,
        { signal },
      ),
    importPaymentStatement: (provider: string, file: File) => {
      const data = new FormData();
      data.append("provider", provider);
      data.append("file", file);
      return request<PaymentStatementBatchDetail>(
        "/rental/v1/payment-reconciliation/statements",
        { method: "post", data },
      );
    },
    reviewPaymentStatementLine: (
      batchId: string,
      lineId: string,
      data: ReviewPaymentStatementLineRequest,
    ) => request<PaymentStatementBatchDetail>(
      `/rental/v1/payment-reconciliation/statements/${encodeURIComponent(batchId)}/lines/${encodeURIComponent(lineId)}/review`,
      { method: "post", data },
    ),
  };
}

export type RentalPaymentReconciliationApi = ReturnType<typeof createRentalPaymentReconciliationApi>;
