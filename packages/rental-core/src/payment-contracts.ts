/** Rental原支付退款、对账摘要与文件差异合同，金额和订单范围由原资金域裁定。 */

/** EXT-01D：运营端按当前经营空间执行的支付/退款主动对账结果。 */
export interface PaymentReconciliationSummary {
  scanned: number;
  processed: number;
  paid: number;
  closed: number;
  refunded: number;
  pending: number;
  failed: number;
  results: Array<{
    kind: "payment_intent" | "refund";
    id: string;
    orderId: string;
    previousStatus: string;
    status: string;
    error?: string;
  }>;
}

/** EXT-01D：生产支付对账文件导入结果。导入只生成证据与差异，不改资金事实。 */
export type PaymentStatementKind = "payment" | "refund";
export type PaymentStatementReviewStatus = "not_required" | "open" | "query_pending" | "acknowledged";

export interface PaymentStatementBatchSummary {
  id: string;
  workspaceId: string;
  provider: "alipay" | "wechat_pay" | string;
  fileName: string;
  fileSha256: string;
  status: "matched" | "needs_review" | "reviewed" | string;
  totalRows: number;
  matchedRows: number;
  differenceRows: number;
  acknowledgedRows: number;
  importedBy?: string;
  importedAt: string;
}

export interface PaymentStatementLineSummary {
  id: string;
  batchId: string;
  rowNumber: number;
  kind: PaymentStatementKind;
  merchantOrderNo: string;
  merchantRefundNo?: string;
  externalId?: string;
  statementStatus: string;
  normalizedStatus: string;
  amount: number;
  currency: string;
  occurredAt?: string;
  localRecordId?: string;
  localStatus?: string;
  differenceCodes: string[];
  differenceDetail?: string;
  reviewStatus: PaymentStatementReviewStatus;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface PaymentStatementBatchDetail extends PaymentStatementBatchSummary {
  lines: PaymentStatementLineSummary[];
}

export interface ReviewPaymentStatementLineRequest {
  decision: "acknowledge" | "query_provider";
  reason: string;
}

/** EXT-01D：真实支付退款申请。只允许引用订单资金事实形成的待退余额。 */
export interface CreatePaymentRefundRequest {
  amount: number;
  reason: string;
  idempotencyKey: string;
}
