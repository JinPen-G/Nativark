/** 公共通知字段沿正式合同描述，历史状态和扩展渠道保持可读，模拟结果沿原回执表示。 */
import type {
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  SendMockNotificationRequest
} from "@rental-os/platform-contracts/notifications";

type Schema = Record<string, unknown>;
const string: Schema = { type: "string" };
const date: Schema = { type: "string", format: "date-time" };
const channels: Schema = { type: "array", items: string };
const json: Schema = { type: "object", additionalProperties: true };
const object = (properties: Record<string, Schema>, required: readonly string[], additionalProperties = false): Schema =>
  ({ type: "object", properties, required, additionalProperties });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/Notifications.${name}` });

export const NOTIFICATIONS_OPENAPI_SCHEMAS = {
  "Notifications.Template": object({
    id: string, code: string, name: string, category: string, trigger: string, channels,
    content: string, enabled: { type: "boolean" }, updatedAt: date
  } satisfies Record<keyof NotificationTemplateSummary, Schema>,
  ["id", "code", "name", "category", "trigger", "channels", "content", "enabled", "updatedAt"]),
  "Notifications.Templates": { type: "array", items: ref("Template") },
  "Notifications.Log": object({
    id: string, templateCode: string, businessType: string, businessId: string, targetType: string,
    targetName: string, targetMasked: string, channels, provider: string, status: string,
    sentAt: date, createdAt: date, requestJson: json, responseJson: json
  } satisfies Record<keyof NotificationSendLogSummary, Schema>,
  ["id", "businessType", "channels", "provider", "status", "createdAt", "requestJson"]),
  "Notifications.Logs": { type: "array", items: ref("Log") },
  "Notifications.SendRequest": object({
    templateCode: string, businessType: string, businessId: string, targetType: string,
    targetName: string, targetMasked: string, channels: { ...channels, minItems: 1 },
    variables: { type: "object", additionalProperties: { oneOf: [string, { type: "number" }] } },
    operator: { ...string, description: "沿原请求保存的操作者标签，授权身份来自服务端当前请求。" }
  } satisfies Record<keyof SendMockNotificationRequest, Schema>, ["businessType", "channels"], true)
} as const;
