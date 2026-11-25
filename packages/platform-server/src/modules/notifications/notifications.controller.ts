/** 原通知目录、日志与模拟发送 HTTP。请求沿公共合同传入同一应用，原校验和错误继续传播。 */
import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import type { SendMockNotificationRequest } from "@rental-os/platform-contracts/notifications";
import { NOTIFICATIONS_HTTP_APPLICATION, type NotificationHttpApplication } from "./notifications-http.application";

@Controller("notifications")
export class NotificationsController {
  constructor(@Inject(NOTIFICATIONS_HTTP_APPLICATION) private readonly notifications: NotificationHttpApplication) {}

  @Get("templates")
  templates() {
    return this.notifications.listNotificationTemplates();
  }

  @Get("logs")
  logs() {
    return this.notifications.listNotificationLogs();
  }

  @Post("send")
  send(@Body() body: SendMockNotificationRequest) {
    return this.notifications.sendNotification(body);
  }
}
