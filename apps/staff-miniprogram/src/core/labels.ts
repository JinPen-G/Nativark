import type { RentalAssetStatus, RentalCoreOrderStatus, RentalWorkOrderStatus, RentalWorkOrderType, RentalWorkbenchTodoType } from "@rental-os/shared";
import { terms } from "./context";

/**
 * 员工视角的状态与类型文案。跨品类固定的操作词（出库/入库/验收）写在这里；
 * 与品类相关的名词（器材/装备/车辆）一律经 terms() 取，不在此写死。
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "待确认", tone: "warning" },
  reserved: { label: "待支付", tone: "warning" },
  ready_for_pickup: { label: "待取货", tone: "info" },
  pickup_overdue: { label: "逾期未取", tone: "danger" },
  renting: { label: "使用中", tone: "success" },
  return_inspection: { label: "待验收", tone: "warning" },
  settling: { label: "待结算", tone: "warning" },
  completed: { label: "已完成", tone: "neutral" },
  cancelled: { label: "已取消", tone: "neutral" },
  no_show: { label: "已爽约", tone: "danger" }
};

export function orderStatusLabel(status: RentalCoreOrderStatus | string): string {
  return ORDER_STATUS[status]?.label ?? String(status);
}

export function orderStatusTone(status: RentalCoreOrderStatus | string): Tone {
  return ORDER_STATUS[status]?.tone ?? "neutral";
}

/** 订单列表页签 → 状态集合。“待归还”按在租且已到约定归还时间判定（在页面里叠加时间条件）。 */
export type OrderTabKey = "all" | "pending_pickup" | "in_use" | "pending_return" | "done";
export const ORDER_TABS: Array<{ key: OrderTabKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending_pickup", label: "待取货" },
  { key: "in_use", label: "使用中" },
  { key: "pending_return", label: "待归还" },
  { key: "done", label: "已完成" }
];

export function orderTabMatches(tab: OrderTabKey, order: { status: string; endAt: string; effectiveEndAt?: string }, now = Date.now()): boolean {
  switch (tab) {
    case "all":
      return true;
    case "pending_pickup":
      return order.status === "draft" || order.status === "reserved" || order.status === "ready_for_pickup" || order.status === "pickup_overdue";
    case "in_use":
      return order.status === "renting";
    case "pending_return": {
      const due = Date.parse(order.effectiveEndAt ?? order.endAt);
      return (order.status === "renting" && Number.isFinite(due) && due <= now) || order.status === "return_inspection";
    }
    case "done":
      return order.status === "settling" || order.status === "completed" || order.status === "cancelled" || order.status === "no_show";
    default:
      return true;
  }
}

const ASSET_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "空闲可用", tone: "success" },
  reserved: { label: "已预留", tone: "info" },
  rented: { label: "使用中", tone: "info" },
  inspection: { label: "待检查", tone: "warning" },
  maintenance: { label: "维护中", tone: "warning" },
  disabled: { label: "已停用", tone: "neutral" }
};

export function assetStatusLabel(status: RentalAssetStatus | string): string {
  return ASSET_STATUS[status]?.label ?? String(status);
}

export function assetStatusTone(status: RentalAssetStatus | string): Tone {
  return ASSET_STATUS[status]?.tone ?? "neutral";
}

const WORK_ORDER_TYPE: Record<string, string> = {
  cleaning: "清洁",
  restock: "整备回库",
  calibration: "校准检验",
  repair: "维修"
};

export function workOrderTypeLabel(type: RentalWorkOrderType | string): string {
  return WORK_ORDER_TYPE[type] ?? String(type);
}

const WORK_ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "待处理", tone: "warning" },
  in_progress: { label: "处理中", tone: "info" },
  pending_review: { label: "待验收", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
  rejected: { label: "已驳回", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" }
};

export function workOrderStatusLabel(status: RentalWorkOrderStatus | string): string {
  return WORK_ORDER_STATUS[status]?.label ?? String(status);
}

export function workOrderStatusTone(status: RentalWorkOrderStatus | string): Tone {
  return WORK_ORDER_STATUS[status]?.tone ?? "neutral";
}

const TODO_TYPE: Record<string, { label: string; icon: string; color: string }> = {
  pending_payment: { label: "待支付超时", icon: "clock", color: "warning" },
  no_show_notice: { label: "待发爽约通知", icon: "bell", color: "warning" },
  no_show_confirmation: { label: "待确认爽约", icon: "alert", color: "danger" },
  return_overdue: { label: "超期未归还", icon: "alert", color: "danger" },
  fee_review: { label: "费用待复核", icon: "wallet", color: "warning" },
  refund: { label: "退款待办", icon: "refresh", color: "info" },
  work_order: { label: "待处理工单", icon: "tool", color: "purple" },
  offline_payment_pending: { label: "线下收款待确认", icon: "wallet", color: "warning" },
  notification_failure: { label: "通知发送失败", icon: "bell", color: "muted" },
  cancelled_refund_due: { label: "取消后待退款", icon: "wallet", color: "info" }
};

export function todoTypeLabel(type: RentalWorkbenchTodoType | string): string {
  return TODO_TYPE[type]?.label ?? String(type);
}

export function todoTypeIcon(type: RentalWorkbenchTodoType | string): { icon: string; color: string } {
  return TODO_TYPE[type] ?? { icon: "info", color: "secondary" };
}

/** 履约方式文案：名词部分随品类术语（取机/领用/取车），方式部分固定。 */
export function fulfillmentModeLabel(mode: string): string {
  const t = terms();
  switch (mode) {
    case "store_pickup_return":
      return `${t.fulfillmentLabel}自取自还`;
    case "partner_pickup_return":
      return `合作点自取自还`;
    case "locker_pickup_return":
      return "自助柜取还";
    case "warehouse_pickup_return":
      return "仓库自取自还";
    case "delivery":
      return t.deliveryLabel ?? "配送上门";
    case "onsite_delivery":
      return "现场交付";
    default:
      return mode;
  }
}

const ALLOCATION_STATUS: Record<string, string> = {
  pre_assigned: "已预分配",
  locked: "已锁定",
  allocated: "已分配",
  picked_up: "已交付",
  consumed: "已消耗",
  returned: "已归还",
  released: "已释放"
};

export function allocationStatusLabel(status: string): string {
  return ALLOCATION_STATUS[status] ?? status;
}

const INVENTORY_MODE: Record<string, string> = { serialized: "序列化", quantity: "按数量", consumable: "耗材", bundle: "套装" };

export function inventoryModeLabel(mode: string): string {
  return INVENTORY_MODE[mode] ?? mode;
}

const STOCK_OPERATION: Record<string, { label: string; tone: Tone }> = {
  receive: { label: "入库", tone: "success" },
  count_adjustment: { label: "盘点调整", tone: "info" },
  transfer: { label: "转移", tone: "warning" },
  consume: { label: "消耗", tone: "neutral" },
  scrap: { label: "报损", tone: "danger" },
  retire: { label: "退役", tone: "neutral" }
};

export function stockOperationLabel(type: string): string {
  return STOCK_OPERATION[type]?.label ?? type;
}

export function stockOperationTone(type: string): Tone {
  return STOCK_OPERATION[type]?.tone ?? "neutral";
}

/** 资产状态变化的来源（状态历史时间线）。领取/归还是订单取还事件，动作词随品类。 */
const ASSET_HISTORY_SOURCE: Record<string, string> = {
  manual: "手工调整",
  allocation: "配货",
  disposition: "归还处置",
  work_order: "养护工单",
  stock_operation: "库存操作",
  exchange: "换货"
};

export function assetHistorySourceLabel(source: string): string {
  if (source === "pickup") return `${terms().pickupLabel}交付`;
  if (source === "return") return `${terms().returnLabel}入库`;
  return ASSET_HISTORY_SOURCE[source] ?? source;
}
