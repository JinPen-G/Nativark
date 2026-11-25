/** 原后台注入当前会话、原 Operator 与已登记导航，消息与工单逻辑由 Rental 提供。 */
import { matchPath } from "react-router-dom";
import {
  createRentalBrowserNotifications,
  type Notice,
  type RentalNotificationAuth,
} from "@rental-os/rental-core/admin/browser-notifications";
import { rentalBrowserSession } from "@/api/http";
import { APP_ROUTES, canAccessRoute } from "@/app/navigation";
import { useOperator } from "@/features/ai-operator/OperatorContext";
import { confirmationDetails } from "@/features/ai-operator/confirmationDetails";

function resolveHref(item: Notice, auth: RentalNotificationAuth) {
  const href = item.workOrderId
    ? APP_ROUTES.workOrderDetail.path.replace(":workOrderId", encodeURIComponent(item.workOrderId))
    : item.href;
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  const url = new URL(href, "https://rental.invalid");
  if (url.origin !== "https://rental.invalid") return null;
  const route = Object.values(APP_ROUTES)
    .filter(entry => matchPath({ path: entry.path, end: false }, url.pathname))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return route && canAccessRoute(route, auth.hasPermission, auth.hasCapability, auth.tenant?.categoryCode,
    Boolean(auth.user?.isSaasAdmin), auth.hasTenantMembershipPermission) ? href : null;
}

const notifications = createRentalBrowserNotifications({
  session: rentalBrowserSession,
  useOperator,
  confirmationDetails,
  aiHref: APP_ROUTES.aiOperator.path,
  resolveHref,
});

export const NotificationProvider = notifications.NotificationProvider;
export const useNotifications = notifications.useNotifications;
export const NotificationNoticeActions = notifications.NoticeActions;
