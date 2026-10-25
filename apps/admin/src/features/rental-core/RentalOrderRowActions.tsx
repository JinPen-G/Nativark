import type { RentalOrder } from "@rental-os/shared";
import { CalendarClock, CircleCheck, CircleX, Layers, PackageCheck, RotateCcw, Wallet, type LucideIcon } from "lucide-react";
import { DataTableRowActions } from "@/components/ui";
import { ORDER_QUICK_ACTION_LABELS, orderQuickActions, orderQuickActionPath, type OrderActionPermissions, type OrderQuickAction } from "./orderQuickActions";

const icons: Record<OrderQuickAction, LucideIcon> = { confirm: CircleCheck, allocation: Layers, pickup: PackageCheck, return: RotateCcw, extend: CalendarClock, settle: Wallet, cancel: CircleX };
export function RentalOrderRowActions({ order, permissions, navigate, t, pickupLabel = "领取", returnLabel = "归还" }: {
  order: RentalOrder;
  permissions: OrderActionPermissions;
  navigate: (path: string) => void;
  t: (text: string) => string;
  pickupLabel?: string;
  returnLabel?: string;
}) {
  const available = orderQuickActions(order, permissions);
  const handoverLabel = (label: string) => {
    const source = `办理${label}`;
    const translated = t(source);
    return translated !== source ? translated : `${t("办理")} ${t(label)}`;
  };
  const actions = available.actions.map(id => ({ id, icon: icons[id], danger: id === "cancel",
    label: id === "pickup" ? handoverLabel(pickupLabel) : id === "return" ? handoverLabel(returnLabel) : t(ORDER_QUICK_ACTION_LABELS[id]),
    onSelect: () => navigate(orderQuickActionPath(order.id, id)),
  }));
  const primary = actions.find(action => action.id === available.primary);
  return <DataTableRowActions menuIcons primary={primary && { ...primary, label: primary.id === "confirm" ? t("确认订单") : primary.id === "settle" ? t("结算关单") : primary.label }} actions={actions}
    details={() => navigate(orderQuickActionPath(order.id))}
    detailLabel={t("查看详情")} detailAccessibleLabel={`${t("查看详情")} · ${order.orderNo}`} menuLabel={`${t("订单快捷操作")} · ${order.orderNo}`} />;
}
