/** 消息 HTTP 的字段与参数资料。公共邀请和原 Rental 请求按各自最小业务范围生成。 */
import type {
  InviteTenantOperatorRequest,
  SaveWorkspaceAccessRequest,
  TenantDispatchRow,
  TenantSupportEmailRow
} from "@rental-os/platform-contracts/tenant-messaging";

type Schema = { [field: string]: unknown };
const string: Schema = { type: "string" };
const date: Schema = { type: "string", format: "date-time" };
const bool: Schema = { type: "boolean" };
const email: Schema = { type: "string", format: "email", maxLength: 191 };
const number: Schema = { type: "integer", minimum: 0 };
const token: Schema = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$", writeOnly: true,
  description: "原邮件 fragment 中的一次性凭证，仅通过 POST 提交给原认证入口。" };
const channel: Schema = { type: "string", enum: ["sms", "email"] };
const source: Schema = { type: "string", enum: ["platform", "rental", "verification"] };
const status: Schema = { type: "string", enum: ["queued", "sent", "delivery_pending", "delivered", "delivery_failed", "failed", "delivery_uncertain", "simulated", "simulation_failed"] };
const object = (properties: Record<string, Schema>, required: string[]): Schema =>
  ({ type: "object", properties, required, additionalProperties: false });
const row = { id: string, source, channel, recipient: string, subject: string, status, provider: string,
  workspaceName: string, businessType: string, businessId: string, createdAt: date, sentAt: date
} satisfies Record<keyof TenantDispatchRow, Schema>;
const mail = { id: string, senderEmail: string, senderName: string, subject: string, preview: string,
  receivedAt: date, attachmentCount: number
} satisfies Record<keyof TenantSupportEmailRow, Schema>;

export const TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS = {
  page: { type: "integer", minimum: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: 100 },
  search: { type: "string", maxLength: 100 },
  channel,
  status
};

export const TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS = { source, id: string, key: string };

/** namespace 包含所需前缀，最小范围由宿主显式选择，旧请求始终传 1。 */
export function createTenantMessagingOpenApiSchemas(namespace: string, minimumWorkspaceAccesses: 0 | 1): Record<string, Schema> {
  const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${namespace}${name}` });
  const array = (item: string | Schema): Schema => ({ type: "array", items: typeof item === "string" ? ref(item) : item });
  const schemas: Record<string, Schema> = {
    SaveWorkspaceAccessRequest: object({
      workspaceId: { type: "string", minLength: 1 }, roleId: { type: "string", minLength: 1 },
      dataScope: { type: "string", enum: ["all", "organization", "store", "own"] },
      locationScope: object({ mode: { type: "string", enum: ["all", "selected"] }, locationIds: array(string) }, ["mode", "locationIds"]),
      isActive: bool
    } satisfies Record<keyof SaveWorkspaceAccessRequest, Schema>, ["workspaceId", "isActive"]),
    TenantDispatchRow: object(row, ["id", "source", "channel", "recipient", "subject", "status", "provider", "createdAt"]),
    TenantDispatchPage: object({ rows: array("TenantDispatchRow"), total: number, page: number, pageSize: number }, ["rows", "total", "page", "pageSize"]),
    TenantDispatchDetail: object({ ...row, sender: string, renderedText: string,
      renderedHtml: { type: "string", description: "发送时保存的安全邮件预览，邀请凭证隐藏，缺失历史样式明确表示。" },
      templateVersion: string, providerMessageId: string, errorMessage: string, attempts: number },
    ["id", "source", "channel", "recipient", "subject", "status", "provider", "createdAt", "renderedText", "attempts"]),
    CheckTenantOperatorEmailRequest: object({ email }, ["email"]),
    CheckTenantOperatorEmailResult: object({ exists: bool, pendingInvitation: bool, message: string }, ["exists", "pendingInvitation"]),
    InviteTenantOperatorRequest: object({ email, displayName: { type: "string", maxLength: 100 },
      organizationId: { type: "string", minLength: 1, maxLength: 191 },
      roleIds: { type: "array", items: string, minItems: 1, maxItems: 8, uniqueItems: true },
      workspaceAccesses: { type: "array", items: ref("SaveWorkspaceAccessRequest"), minItems: minimumWorkspaceAccesses, maxItems: 100,
        description: "空数组仅准备租户基础成员授权，非空业务范围由宿主真实参加者在原事务中校验与写入。" },
      idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" }
    } satisfies Record<keyof InviteTenantOperatorRequest, Schema>, ["email", "roleIds", "workspaceAccesses", "idempotencyKey"]),
    TenantOperatorInvitationRow: object({ id: string, email, displayName: string, roleNames: array(string), workspaceNames: array(string),
      status: { type: "string", enum: ["pending", "accepted", "revoked", "expired"] }, deliveryStatus: status, dispatchId: string,
      expiresAt: date, createdAt: date, acceptedAt: date },
    ["id", "email", "displayName", "roleNames", "workspaceNames", "status", "deliveryStatus", "dispatchId", "expiresAt", "createdAt"]),
    TenantOperatorInvitationList: array("TenantOperatorInvitationRow"),
    TenantOperatorInvitationMailPreview: object({ subject: string, renderedText: string, renderedHtml: string }, ["subject", "renderedText", "renderedHtml"]),
    InspectTenantOperatorInvitationRequest: object({ token }, ["token"]),
    AcceptTenantOperatorInvitationRequest: object({ token, displayName: { type: "string", minLength: 1, maxLength: 100 },
      password: { type: "string", format: "password", writeOnly: true, minLength: 8, maxLength: 128 } }, ["token", "displayName", "password"]),
    TenantOperatorInvitationPreview: { oneOf: [
      object({ status: { type: "string", enum: ["pending"] }, tenantName: string, tenantCode: string, email, displayName: string, roleNames: array(string), workspaceNames: array(string),
        expiresAt: date, minPasswordLength: number }, ["status", "tenantName", "tenantCode", "email", "displayName", "roleNames", "workspaceNames", "expiresAt", "minPasswordLength"]),
      object({ status: { type: "string", enum: ["accepted"] }, tenantCode: string, message: string }, ["status", "tenantCode", "message"])
    ] },
    AcceptTenantOperatorInvitationResult: object({ tenantCode: string, message: string }, ["tenantCode", "message"]),
    TenantSupportEmailRow: object(mail, Object.keys(mail)),
    TenantSupportEmailDetail: object({ ...mail, recipient: string, bodyText: string, messageId: string,
      attachments: array(object({ name: string, contentType: string, size: number }, ["name", "contentType", "size"])) },
    [...Object.keys(mail), "recipient", "bodyText", "attachments"]),
    TenantSupportEmailPage: object({ rows: array("TenantSupportEmailRow"), total: number, page: number, pageSize: number,
      receiverConfigured: bool, lastSyncedAt: date }, ["rows", "total", "page", "pageSize", "receiverConfigured"]),
    SyncTenantSupportEmailsResult: object({ imported: number, quarantined: number, checked: number, hasMore: bool, syncedAt: date }, ["imported", "quarantined", "checked", "hasMore", "syncedAt"])
  };
  return Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [`${namespace}${name}`, schema]));
}

export const TENANT_MESSAGING_OPENAPI_SCHEMAS = createTenantMessagingOpenApiSchemas("Messaging.", 0);
