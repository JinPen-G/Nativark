import type { ClientOrderView } from "@rental-os/shared";
import { boundedText, displayMeasurement, displayTime } from "./display-format";

/** Original customer projection only. No model conclusion or payment receipt. */
export function customerOrderFacts(order: ClientOrderView, expectedId: string) {
  if (!order || order.id !== expectedId) return null;
  const unit = typeof order.currency === "string" && /^[A-Z]{3}$/u.test(order.currency) ? order.currency : null;
  const amount = (value: unknown) => {
    const result = displayMeasurement(value, unit);
    return result.source ? `${result.text} ${result.unit ?? "币种未知"}` : "未知";
  };
  return {
    title: "原订单事实（非AI回答）",
    receivable: amount(order.finalPayableAmount), paid: "未知：未读取付款收据",
    deposit: amount(order.depositAmount), preAuth: amount(order.preAuthAmount),
    refundStatus: "未加载退款受理/执行结果，不推断已退款",
    availabilityLabel: `原状态码：${boundedText(order.status, 80)}；不是付款或履约结论`,
    source: `本人订单 ${boundedText(order.id, 191)} / ${displayTime(order.updatedAt)}`,
    note: "押金和预授权是原订单要求，不表示已收取或冻结。历史报价/规则/检查依据未加载。",
  };
}
