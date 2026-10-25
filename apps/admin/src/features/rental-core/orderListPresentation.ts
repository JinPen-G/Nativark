/** Order-list display facts only: never changes status, grants a grace period or calculates a fee. */
import type { RentalOrder } from "@rental-os/shared";

export function plannedReturnAt(order: Pick<RentalOrder, "fulfillmentMode" | "carrierRentalDueAt" | "effectiveEndAt" | "endAt">) {
  return order.fulfillmentMode === "carrier_shipping" ? order.carrierRentalDueAt ?? order.effectiveEndAt ?? order.endAt : order.effectiveEndAt ?? order.endAt;
}

export type OrderTimingNotice = { kind: "pickup" | "return"; label: string; minutes: number; tone: "warning" | "danger" };

export function orderTimingNotice(order: RentalOrder, now: number): OrderTimingNotice | undefined {
  const start = Date.parse(order.startAt);
  const end = Date.parse(plannedReturnAt(order));
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  // A dispatched parcel can be in transit while READY_FOR_PICKUP; it is not a customer no-show.
  if (order.fulfillmentMode === "carrier_shipping") return undefined;
  if (["reserved", "ready_for_pickup", "pickup_overdue"].includes(order.status) && now >= start) {
    return { kind: "pickup", label: "到时未取", minutes: Math.floor((now - start) / 60_000), tone: "warning" };
  }
  // Once goods are all received, inspection/settlement time must not look like customer lateness.
  if (order.status === "renting" && now > end && order.allocations.some(allocation => allocation.status === "picked_up" && allocation.quantity > 0)) {
    return { kind: "return", label: "逾期未还", minutes: Math.floor((now - end) / 60_000), tone: "danger" };
  }
  return undefined;
}

/** A human-readable elapsed span, not the order's pricing-unit or billable-period calculation. */
export function timeSpanParts(minutes: number): Array<{ value: number; unit: "天" | "小时" | "分钟" }> {
  if (!Number.isFinite(minutes) || minutes < 0) return [];
  const whole = Math.floor(minutes);
  const days = Math.floor(whole / 1440);
  const hours = Math.floor((whole % 1440) / 60);
  const rest = whole % 60;
  return [days && { value: days, unit: "天" as const }, hours && { value: hours, unit: "小时" as const }, rest && { value: rest, unit: "分钟" as const }].filter(Boolean) as Array<{ value: number; unit: "天" | "小时" | "分钟" }>;
}
