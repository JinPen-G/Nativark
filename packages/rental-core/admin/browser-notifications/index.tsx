/** 一个 Rental 宿主共用原消息状态和详情，指派结果不明时继续保留原锁。 */
import { createRentalNotificationApi } from "./api";
import { createRentalNoticeActions } from "./NoticeActions";
import { createRentalNotificationProvider } from "./NotificationProvider";
import { createRentalMessageCenterPage } from "./MessageCenterPage";
import type { RentalBrowserNotificationsOptions } from "./types";
import type { CoreAdminPage } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";

export function createRentalBrowserNotifications(options: RentalBrowserNotificationsOptions) {
  const bindings = { ...options, api: createRentalNotificationApi(options.session) };
  const provider = createRentalNotificationProvider(bindings);
  const NoticeActions = createRentalNoticeActions(bindings, provider.useNotifications);
  const MessageCenterPage = createRentalMessageCenterPage(bindings, provider.useNotifications, NoticeActions);
  const page: CoreAdminPage<CoreRouteComponent> = {
    id: "notifications", path: "/notifications", title: { default: "消息中心", translations: { "en-US": "Messages" } },
    permissions: [], menu: { group: { default: "概览", translations: { "en-US": "Overview" } }, order: 30 },
    component: MessageCenterPage,
  };
  return { ...provider, NoticeActions, MessageCenterPage, page };
}

export * from "./model";
export type {
  RentalBrowserNotificationsOptions,
  RentalNotificationAuth,
  RentalNotificationArtifact,
  RentalNotificationOperator,
} from "./types";
