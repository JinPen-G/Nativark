/** 一个 Rental 宿主共用原消息状态和详情，指派结果不明时继续保留原锁。 */
import { createRentalNotificationApi } from "./api";
import { createRentalNoticeActions } from "./NoticeActions";
import { createRentalNotificationProvider } from "./NotificationProvider";
import type { RentalBrowserNotificationsOptions } from "./types";

export function createRentalBrowserNotifications(options: RentalBrowserNotificationsOptions) {
  const bindings = { ...options, api: createRentalNotificationApi(options.session) };
  const provider = createRentalNotificationProvider(bindings);
  const NoticeActions = createRentalNoticeActions(bindings, provider.useNotifications);
  return { ...provider, NoticeActions };
}

export * from "./model";
export type {
  RentalBrowserNotificationsOptions,
  RentalNotificationAuth,
  RentalNotificationArtifact,
  RentalNotificationOperator,
} from "./types";
