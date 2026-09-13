import {
  RentalAssetStatus,
  type RentalAllocation,
  type RentalOrder,
} from "@rental-os/shared";
import { bufferedRentalPeriod } from "./rental-occupancy";

export const ACTIVE_ASSIGNMENTS = [
  "pre_assigned",
  "locked",
  "allocated",
  "picked_up",
];
export const lockedAssignment = (a: RentalAllocation) =>
  ["locked", "allocated", "picked_up"].includes(a.status);
export interface AssignmentOccupancy {
  orderId: string;
  assetId: string;
  startAt: string;
  endAt: string;
  status: string;
  returnLocationId?: string;
  locationId?: string;
}
export function allocationConflict(
  order: RentalOrder,
  asset: { id: string; status: RentalAssetStatus; locationId: string },
  rows: AssignmentOccupancy[],
  clock = Date.now(),
): string | undefined {
  if (
    ![
      RentalAssetStatus.Available,
      RentalAssetStatus.Reserved,
      RentalAssetStatus.Rented,
    ].includes(asset.status)
  )
    return "资产停用、检查或维护中";
  const period = bufferedRentalPeriod(
    order.startAt,
    order.effectiveEndAt ?? order.endAt,
    order.ruleSnapshot,
  );
  const start = Date.parse(period.startAt),
    end = Date.parse(period.endAt);
  const others = rows.filter(
    (r) => r.assetId === asset.id && r.orderId !== order.id,
  );
  if (
    others.some(
      (r) => Date.parse(r.startAt) < end && Date.parse(r.endAt) > start,
    )
  )
    return "租期或前后缓冲与其他订单冲突";
  const previous = others
    .filter((r) => Date.parse(r.endAt) <= start)
    .sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt))[0];
  if (
    (previous?.returnLocationId ?? asset.locationId) !==
    order.fulfillmentLocationId
  )
    return "约定领取地点不可交付，须先处理调拨";
  const next = others
    .filter((r) => Date.parse(r.startAt) >= end)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  if (
    next?.locationId &&
    next.locationId !== (order.returnLocationId ?? order.fulfillmentLocationId)
  )
    return "本单归还地点会影响后续订单交付，须先处理后单";
  if (
    asset.status === RentalAssetStatus.Rented &&
    (!previous ||
      previous.status !== "picked_up" ||
      Date.parse(previous.endAt) <= clock)
  )
    return "在租资产缺少可确认的前序归还排期";
  if (
    asset.status === RentalAssetStatus.Reserved &&
    !others.length &&
    !order.allocations.some(
      (a) => a.assetId === asset.id && ACTIVE_ASSIGNMENTS.includes(a.status),
    )
  )
    return "资产存在未释放的历史占用";
  return undefined;
}

export function allocationComplete(order: RentalOrder, lockedOnly = false) {
  return (
    order.reservations
      .filter((r) => r.status === "confirmed" || r.status === "fulfilled")
      .every((r) => {
        const amount = order.allocations
          .filter(
            (a) =>
              ACTIVE_ASSIGNMENTS.includes(a.status) &&
              (!lockedOnly || lockedAssignment(a)) &&
              (a.metadata?.reservationId
                ? a.metadata.reservationId === r.id
                : a.orderLineId === r.orderLineId &&
                  a.itemGroupId === r.itemGroupId),
          )
          .reduce((s, a) => s + a.quantity, 0);
        return amount === r.quantity - r.releasedQuantity;
      }) &&
    order.reservations.some(
      (r) =>
        r.quantity > r.releasedQuantity &&
        ["confirmed", "fulfilled"].includes(r.status),
    )
  );
}
