/** 公共通知 HTTP 消费宿主的同一应用实例，业务内容、当前权限与原投递结果沿原参加者处理。 */
import type {
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  SendMockNotificationRequest
} from "@rental-os/platform-contracts/notifications";

export interface NotificationHttpApplication {
  listNotificationTemplates(): PromiseLike<NotificationTemplateSummary[]>;
  listNotificationLogs(): PromiseLike<NotificationSendLogSummary[]>;
  sendNotification(input: SendMockNotificationRequest): PromiseLike<NotificationSendLogSummary>;
}

export const NOTIFICATIONS_HTTP_APPLICATION = Symbol("platform.notifications.http-application");
