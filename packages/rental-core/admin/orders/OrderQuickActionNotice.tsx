/** Deep links locate an existing operation; never click it, acquire a lock or execute a mutation. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Alert } from "@rental-os/platform-admin/ui";
import { useLocale } from "@rental-os/platform-admin/locale";
import { useCorePageHost } from "@rental-os/platform-admin/core";
import { ORDER_QUICK_ACTION_LABELS, parseOrderQuickAction } from "./orderQuickActions";
import { isMotionReduced } from "@rental-os/platform-admin/motion";

export function OrderQuickActionNotice({ orderId, ready }: { orderId: string; ready: boolean }) {
  const { search, key } = useLocation();
  const { t } = useLocale();
  const { page } = useCorePageHost();
  const action = parseOrderQuickAction(new URLSearchParams(search).get("action"));
  const handled = useRef("");
  const [result, setResult] = useState<{ key: string; found: boolean }>();
  const requestKey = JSON.stringify([page.key, orderId, key, action]);
  useEffect(() => {
    if (!ready || !action) return;
    const container = document.getElementById(action === "allocation" ? "rental-order-allocation" : "rental-order-operations");
    const declaredTarget = action === "allocation" ? undefined : Array.from(document.querySelectorAll<HTMLElement>("[data-core-page][data-core-action]"))
      .find(target => target.dataset.corePage === page.key && target.dataset.coreAction === action
        && !target.closest("[inert], [aria-hidden='true']"));
    const target = declaredTarget ?? (action === "allocation" ? container?.matches('[data-order-action="allocation"]') ? container : null : container?.querySelector<HTMLElement>(`[data-order-action="${action}"]`));
    setResult({ key: requestKey, found: Boolean(target) });
    if (!target || handled.current === requestKey) return;
    handled.current = requestKey;
    const button = target instanceof HTMLButtonElement ? target : target.querySelector<HTMLButtonElement>("button");
    const focusTarget = button?.disabled ? declaredTarget ?? container : button ?? target;
    focusTarget?.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: isMotionReduced() ? "instant" : "smooth" });
  }, [action, ready, requestKey, page.key]);
  if (!action || !ready || result?.key !== requestKey) return null;
  return <Alert type={result.found ? "info" : "warning"} showIcon title={t(ORDER_QUICK_ACTION_LABELS[action])}
    description={t(result.found ? "已定位操作入口，请核对订单后继续；不会自动执行。" : "订单状态或操作权限已变化，此快捷入口当前不可用，请查看下方订单详情。")} />;
}
