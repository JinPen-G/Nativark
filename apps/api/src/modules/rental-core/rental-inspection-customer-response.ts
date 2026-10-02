export type InspectionCustomerResponseDecision = "confirmed" | "disputed";
export type InspectionCustomerResponseStatus = "not_required" | "pending" | "confirmed" | "disputed";

export type InspectionCustomerResponseInput = {
  reviewStatus: "pending" | "approved" | "rejected";
  approvedChargeAmount?: number;
  currentStatus?: InspectionCustomerResponseStatus;
  decision: InspectionCustomerResponseDecision;
};

export function validateInspectionCustomerResponse(input: InspectionCustomerResponseInput): string | undefined {
  const amount = Number(input.approvedChargeAmount ?? 0);
  if (input.reviewStatus !== "approved" || !Number.isFinite(amount) || amount <= 0) {
    return "只有已批准且金额大于 0 的异常费用需要客户确认或申诉";
  }
  // 存量正数费用误标 not_required 时允许补录真实响应，不能永久堵住纠错入口。
  if (input.currentStatus === "confirmed") return "客户已经确认，不能重复记录";
  if (input.currentStatus === "disputed" && input.decision === "disputed") return "该异常已经记录过客户申诉，请先处理现有申诉";
  return undefined;
}

/** 所有结算入口共用，缺失客户响应不能被当成客户已经确认。 */
export function inspectionClosureError(rows: Array<{ exceptions: unknown }>): string | undefined {
  for (const row of rows) {
    if (!Array.isArray(row.exceptions)) return "检查异常事实格式无效，须先核对记录再关闭订单";
    for (const exception of row.exceptions as Array<Record<string, unknown>>) {
      if (!exception || !["approved", "rejected"].includes(String(exception.reviewStatus))) return "仍有检查异常待审核，不能关闭订单";
      if (exception.reviewStatus !== "approved") continue;
      const amount = exception.approvedChargeAmount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return "检查异常裁定金额无效，须先核对账目再关闭订单";
      if (amount > 0 && exception.customerResponseStatus !== "confirmed") return "还有检查异常费用待客户确认或申诉处理，不能关闭订单";
    }
  }
  return undefined;
}
