/** Navigation hints only. The detail page and Core still own eligibility, locks and execution. */
import type { RentalOrder } from "@rental-os/shared";

export type OrderQuickAction = "confirm" | "allocation" | "pickup" | "return" | "extend" | "settle" | "cancel";
export interface OrderActionPermissions {
  operate: boolean;
  pickup: boolean;
  return: boolean;
  extend: boolean;
  settle: boolean;
  cancel: boolean;
}
export const ORDER_QUICK_ACTION_LABELS: Record<OrderQuickAction, string> = {
  confirm: "确认订单并核销优惠券", allocation: "分配 / 锁定", pickup: "办理领取",
  return: "办理归还", extend: "续租 / 延期", settle: "结算并关闭订单", cancel: "取消并按规则计费",
};
export function parseOrderQuickAction(value: string | null): OrderQuickAction | undefined {
  return value && Object.hasOwn(ORDER_QUICK_ACTION_LABELS, value) ? value as OrderQuickAction : undefined;
}
export function orderQuickActions(order: Pick<RentalOrder, "status" | "fulfillmentMode">, permissions: OrderActionPermissions) {
  const actions: OrderQuickAction[] = [];
  const prePickup = ["draft", "reserved", "ready_for_pickup"].includes(order.status);
  if (permissions.operate && order.status === "draft") actions.push("confirm");
  if (permissions.operate && ["reserved", "ready_for_pickup"].includes(order.status)) actions.push("allocation");
  if (permissions.pickup && order.status === "ready_for_pickup") actions.push("pickup");
  if (permissions.return && order.status === "renting") actions.push("return");
  // Carrier extension depends on shipment evidence not present in a list row; leave it to detail.
  if (permissions.extend && order.fulfillmentMode !== "carrier_shipping" && ["ready_for_pickup", "renting"].includes(order.status)) actions.push("extend");
  if (permissions.settle && order.status === "settling") actions.push("settle");
  if (permissions.cancel && prePickup) actions.push("cancel");
  const primaryByStatus: Partial<Record<RentalOrder["status"], OrderQuickAction>> = { draft: "confirm", reserved: "allocation", ready_for_pickup: "pickup", renting: "return", settling: "settle" };
  const preferred = primaryByStatus[order.status];
  // Never promote a destructive/cancellation shortcut to the primary action.
  return { actions, primary: actions.find(action => action === preferred) };
}
export function orderQuickActionPath(id: string, action?: OrderQuickAction) {
  return `/rental/orders/${encodeURIComponent(id)}${action ? `?action=${action}` : ""}`;
}
