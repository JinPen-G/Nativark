import type { RentalOrderServiceOccurrence } from "@rental-os/shared";
import { roundMoney } from "./rental-money";

export interface ServiceCancellationSelection {
  occurrenceId: string;
  quantity: number;
}

/**
 * ORDER-CHANGE-01D：按订单服务快照分摊一次部分取消的客户净支付。
 *
 * 服务金额、优惠和券分摊都是当前发生项的历史事实，不能回读可变目录或模板。
 * 满量取消保留原金额；部分取消按数量比例分摊，剩余快照由调用方用“总额 - 本次份额”
 * 计算，避免多次拆分累计舍入误差。
 */
export function serviceCancellationAmounts(row: Pick<RentalOrderServiceOccurrence, "quantity" | "amount" | "discountAllocatedAmount" | "couponAllocatedAmount">, quantity: number) {
  const totalQuantity = Number(row.quantity);
  if (!Number.isInteger(totalQuantity) || totalQuantity < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > totalQuantity) {
    throw new Error("服务取消数量无效");
  }
  const ratio = quantity === totalQuantity ? 1 : quantity / totalQuantity;
  const allocate = (value: number | undefined) => {
    const total = Math.max(0, Number(value ?? 0) || 0);
    return ratio === 1 ? roundMoney(total) : roundMoney(total * ratio);
  };
  const gross = allocate(Number(row.amount ?? 0));
  const discount = allocate(row.discountAllocatedAmount);
  const coupon = allocate(row.couponAllocatedAmount);
  return {
    gross,
    discount,
    coupon,
    refundAmount: roundMoney(Math.max(0, gross - discount - coupon)),
    remainingGross: roundMoney(Math.max(0, Number(row.amount ?? 0) || 0) - gross),
    remainingDiscount: roundMoney(Math.max(0, Number(row.discountAllocatedAmount ?? 0) || 0) - discount),
    remainingCoupon: roundMoney(Math.max(0, Number(row.couponAllocatedAmount ?? 0) || 0) - coupon)
  };
}
