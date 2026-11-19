/** 原通知 HTTP 的方法、路由、真实 Guard 权限和字段契约同源声明。 */
export const NOTIFICATIONS_HTTP_OPERATIONS = [
  {
    method: "GET", path: "/notifications/templates", id: "listNotificationTemplates",
    summary: "读取当前租户的通知模板", access: "tenant", permission: "system:integration:manage",
    response: "Notifications.Templates"
  },
  {
    method: "GET", path: "/notifications/logs", id: "listNotificationLogs",
    summary: "读取当前租户原通知记录", access: "tenant", permission: "system:integration:manage",
    response: "Notifications.Logs"
  },
  {
    method: "POST", path: "/notifications/send", id: "sendNotification",
    summary: "按原校验登记模拟通知及适配日志", access: "tenant", permission: "system:integration:manage",
    request: "Notifications.SendRequest", response: "Notifications.Log"
  }
] as const;
