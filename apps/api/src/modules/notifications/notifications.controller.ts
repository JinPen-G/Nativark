import { Body, Controller, Get, Post } from "@nestjs/common";
import type { SendMockNotificationRequest } from "@rimo/shared";
import { IntegrationsService } from "../integrations/integrations.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get("templates")
  templates() {
    return this.integrationsService.listNotificationTemplates();
  }

  @Get("logs")
  logs() {
    return this.integrationsService.listNotificationLogs();
  }

  @Post("send")
  send(@Body() body: SendMockNotificationRequest) {
    return this.integrationsService.sendNotification(body);
  }
}
