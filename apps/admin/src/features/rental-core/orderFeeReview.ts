import type { RentalOrderFeeReview } from "@rental-os/shared";

/**
 * 费用审核在管理端的展示口径。
 *
 * 单独成模块而不是留在页面里：这里的措辞是 ORDER-CLOSE-02 的验收点之一
 * （「批准退款」不得显示成「已经退款」），必须能被专项直接断言，
 * 而页面模块带 `@/` 别名与 antd，拉进测试进程只会引入无关依赖。
 */
export const FEE_REVIEW_TYPE_LABELS: Record<RentalOrderFeeReview["type"], string> = {
  overdue: "逾期费（规则要求人工核价）",
  early_return_refund: "提前归还退款（规则要求人工审核）",
  service_refund: "增值服务退款（规则要求人工审核）",
  refund_due: "取消/爽约后待退款（押金/预授权/多收租金）",
  carrier_rental_refund: "承运寄送租期重算核减（规则要求人工审核）"
};

export const FEE_REVIEW_STATUS_COLORS: Record<RentalOrderFeeReview["status"], string> = {
  pending: "orange",
  approved: "green",
  rejected: "default"
};

/**
 * 状态文字必须把「裁定」和「已经动钱」分开。
 *
 * 批准一笔退款只表示应收已按结论核减、等待实际退款；真正的退款是资金区里另一笔
 * 需要资金权限的操作。写成「已退款」会让运营以为钱已经出去了，从而漏办实际退款。
 */
export function feeReviewStatusText(row: Pick<RentalOrderFeeReview, "status" | "type">) {
  if (row.status === "pending") return "待裁定";
  if (row.status === "rejected") return "已驳回（不计费/不退款）";
  if (row.type === "refund_due") return "已批准：退款/释放已获认可，待资金区办理";
  return row.type === "early_return_refund" || row.type === "service_refund" || row.type === "carrier_rental_refund"
    ? "已批准：应收已核减，待实际退款"
    : "已批准：已计入应收";
}

/** 未知建议额不补零；原快照上限只约束人工认定，不是建议金额。 */
export function feeReviewAmountCeiling(row: Pick<RentalOrderFeeReview, "suggestedAmount" | "maximumAmount">) {
  const value = row.suggestedAmount === null ? row.maximumAmount : row.suggestedAmount;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function feeReviewAmountError(row: Pick<RentalOrderFeeReview, "suggestedAmount" | "maximumAmount"> | undefined, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "请填写有效的非负认定金额";
  const ceiling = row && feeReviewAmountCeiling(row);
  if (ceiling === undefined) return "原快照金额上限依据缺失，不能批准";
  if (value > ceiling) return row?.suggestedAmount === null ? "认定额不能超过原快照金额上限" : "认定额不能超过建议额";
  return undefined;
}

/** 订单上是否还有需要人工裁定的费用事项。列表标记与筛选共用它，避免两处判据分叉。 */
export function hasPendingFeeReview(order: { feeReviews?: RentalOrderFeeReview[] }) {
  return (order.feeReviews ?? []).some((row) => row.status === "pending");
}
