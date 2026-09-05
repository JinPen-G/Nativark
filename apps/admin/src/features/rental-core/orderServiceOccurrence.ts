import type { RentalOrderServiceOccurrence } from "@store-rental/shared";

/**
 * 订单服务发生项的展示口径（MKT-02C）。
 *
 * 单独成模块的理由与 orderFeeReview.ts 相同：这里的措辞与净额算法是验收点
 * （「第几次续租新增」必须可辨认、净额只能退客户实际支付的部分），
 * 必须能被 CJS 专项直接断言真实实现，而页面模块带别名与 antd。
 */

/** 来源文字。原订单服务与「第 N 次续租新增」必须能在界面上区分开。 */
export function serviceOccurrenceOriginText(row: Pick<RentalOrderServiceOccurrence, "origin" | "extensionSequence">) {
  if (row.origin === "extension") {
    return row.extensionSequence === undefined ? "续租新增" : `第 ${row.extensionSequence} 次续租新增`;
  }
  if (row.origin === "order") return "原订单服务";
  // 存量订单没有来源标记：不猜成原服务，也不猜成续租。
  return "历史记录（无来源标记）";
}

/**
 * 净额 = 原价 − 优惠减免 − 券抵扣。
 *
 * 退款只能退客户实际支付的净额；直接退原价等于把平台自己出的优惠也退给客户。
 * 减免字段缺省按 0，不按原价回落。
 */
export function serviceOccurrenceNetAmount(row: Pick<RentalOrderServiceOccurrence, "amount" | "discountAllocatedAmount" | "couponAllocatedAmount">) {
  const net = Number(row.amount) - Number(row.discountAllocatedAmount ?? 0) - Number(row.couponAllocatedAmount ?? 0);
  // 与服务端 roundMoney 同式，并且不允许算成负数：减免之和大于原价时净额是 0，不是负退款。
  return Math.max(0, Math.round((net + Number.EPSILON) * 100) / 100);
}

/** 同一服务在这张订单上发生了几次。界面据此提示「这不是重复记录」。 */
export function serviceOccurrenceCount(occurrences: RentalOrderServiceOccurrence[] | undefined, serviceId: string) {
  return (occurrences ?? []).filter((row) => row.serviceId === serviceId).length;
}
