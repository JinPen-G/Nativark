export type InspectionCustomerResponseDecision = "confirmed" | "disputed";
export type InspectionCustomerResponseStatus = "not_required" | "pending" | "confirmed" | "disputed";

export type InspectionCustomerResponseInput = {
  reviewStatus: "pending" | "approved" | "rejected";
  approvedChargeAmount?: number;
  currentStatus?: InspectionCustomerResponseStatus;
  decision: InspectionCustomerResponseDecision;
};

export function validateInspectionCustomerResponse(input: InspectionCustomerResponseInput): string | undefined {
  if (input.reviewStatus !== "approved" || Number(input.approvedChargeAmount ?? 0) <= 0) {
    return "只有已批准且金额大于 0 的异常费用需要客户确认或申诉";
  }
  if (input.currentStatus === "not_required") return "该异常不需要客户确认";
  if (input.currentStatus === "confirmed") return "客户已经确认，不能重复记录";
  if (input.currentStatus === "disputed" && input.decision === "disputed") return "该异常已经记录过客户申诉，请先处理现有申诉";
  return undefined;
}
