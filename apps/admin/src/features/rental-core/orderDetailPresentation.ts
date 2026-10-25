import type { RentalFundingEvent, RentalOrder } from "@rental-os/shared";

export const detailStatusLabels: Record<RentalOrder["status"], string> = {
  draft: "待确认", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待领取",
  renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已完成",
  cancelled: "已取消", no_show: "已爽约",
};
export const detailFulfillmentLabels: Record<string, string> = {
  store_pickup_return: "门店取还", partner_pickup_return: "合作点取还", warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "智能柜取还", delivery: "配送取还", onsite_delivery: "现场交付", carrier_shipping: "承运寄送",
};
export const detailResourceLabels: Record<string, string> = {
  soft: "已预占", hard: "已锁定", pre_assigned: "预分配", locked: "已锁定", allocated: "已锁定",
  picked_up: "已交付", returned: "已归还", released: "已释放", consumed: "已消耗", expired: "已过期", cancelled: "已取消",
};
export const detailChargeLabels: Record<string, string> = {
  rental: "租金", service: "增值服务", fulfillment: "履约费用", discount: "优惠", coupon: "优惠券",
  deposit: "押金", preauthorization: "预授权", cancellation: "取消费用", early_return_refund: "提前归还核减",
  overdue: "逾期费用", damage: "损坏费用", adjustment: "费用调整", extension: "续租费用",
};

/** Event time is the ledger chronology; preserve source order for ties and leave
 * unknown times last. Never mutate the query cache or infer time from an ID. */
export function newestFundingEvents(events: readonly RentalFundingEvent[]) {
  const time = (at: string) => Number.isFinite(Date.parse(at)) ? Date.parse(at) : -Infinity;
  return [...events].sort((a, b) => time(b.at) - time(a.at) || 0);
}

/** Missing ledger data is not a zero balance. Formatting only; no client totals. */
export function knownMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
