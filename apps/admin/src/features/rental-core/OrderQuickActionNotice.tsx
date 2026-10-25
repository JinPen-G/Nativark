/** Deep links locate an existing operation; never click it, acquire a lock or execute a mutation. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Alert } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { ORDER_QUICK_ACTION_LABELS, parseOrderQuickAction } from "./orderQuickActions";

export function OrderQuickActionNotice({ orderId, ready }: { orderId: string; ready: boolean }) {
  const { search, key } = useLocation();
  const { t } = useLocale();
  const action = parseOrderQuickAction(new URLSearchParams(search).get("action"));
  const handled = useRef("");
  const [result, setResult] = useState<{ key: string; found: boolean }>();
  const requestKey = JSON.stringify([orderId, key, action]);
  useEffect(() => {
    if (!ready || !action) return;
    const container = document.getElementById(action === "allocation" ? "rental-order-allocation" : "rental-order-operations");
    const target = action === "allocation" ? container?.matches('[data-order-action="allocation"]') ? container : null : container?.querySelector<HTMLElement>(`[data-order-action="${action}"]`);
    setResult({ key: requestKey, found: Boolean(target) });
    if (!target || handled.current === requestKey) return;
    handled.current = requestKey;
    const button = target instanceof HTMLButtonElement ? target : target.querySelector<HTMLButtonElement>("button");
    const focusTarget = button?.disabled ? container : button ?? target;
    focusTarget?.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [action, ready, requestKey]);
  if (!action || !ready || result?.key !== requestKey) return null;
  return <Alert type={result.found ? "info" : "warning"} showIcon title={t(ORDER_QUICK_ACTION_LABELS[action])}
    description={t(result.found ? "已定位操作入口，请核对订单后继续；不会自动执行。" : "订单状态或操作权限已变化，此快捷入口当前不可用，请查看下方订单详情。")} />;
}
