/** 租户寄件、受控邮箱邀请与客诉邮件的公开 API 投影；不开放凭据或可使用的邀请链接。 */
import type { ContractOperation, SchemaObject } from "./openapi-document";
const string: SchemaObject = { type: "string" };
const date: SchemaObject = { type: "string", format: "date-time" };
const bool: SchemaObject = { type: "boolean" };
const email: SchemaObject = { type: "string", format: "email", maxLength: 191 };
const number: SchemaObject = { type: "integer", minimum: 0 };
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const array = (item: string | SchemaObject): SchemaObject => ({ type: "array", items: typeof item === "string" ? ref(item) : item });
const object = (properties: Record<string, SchemaObject>, required: string[]): SchemaObject => ({ type: "object", properties, required, additionalProperties: false });
const token: SchemaObject = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$", description: "原邮件fragment中的一次性凭证，只能POST给原认证入口，不记录或返回。" };
const status: SchemaObject = { type: "string", enum: ["queued", "sent", "delivery_pending", "delivered", "delivery_failed", "failed", "delivery_uncertain", "simulated", "simulation_failed"] };
const row = { id: string, source: { type: "string", enum: ["platform", "rental", "verification"] } as SchemaObject,
  channel: { type: "string", enum: ["email", "sms"] } as SchemaObject, recipient: string, subject: string, status, provider: string,
  workspaceName: string, businessType: string, businessId: string, createdAt: date, sentAt: date };
const mail = { id: string, senderEmail: string, senderName: string, subject: string, preview: string, receivedAt: date, attachmentCount: number };

export const TENANT_MESSAGING_SCHEMAS: Record<string, SchemaObject> = {
  TenantDispatchRow: object(row, ["id", "source", "channel", "recipient", "subject", "status", "provider", "createdAt"]),
  TenantDispatchPage: object({ rows: array("TenantDispatchRow"), total: number, page: number, pageSize: number }, ["rows", "total", "page", "pageSize"]),
  TenantDispatchDetail: object({ ...row, sender: string, renderedText: string, renderedHtml: { type: "string", description: "发送时保存的安全邮件预览；邀请凭证隐藏，缺失历史样式不补造。" },
    templateVersion: string, providerMessageId: string, errorMessage: string, attempts: number }, ["id", "source", "channel", "recipient", "subject", "status", "provider", "createdAt", "renderedText", "attempts"]),
  CheckTenantOperatorEmailRequest: object({ email }, ["email"]),
  CheckTenantOperatorEmailResult: object({ exists: bool, pendingInvitation: bool, message: string }, ["exists", "pendingInvitation"]),
  InviteTenantOperatorRequest: object({ email, displayName: { type: "string", maxLength: 100 }, organizationId: string,
    roleIds: { type: "array", items: string, minItems: 1, maxItems: 8, uniqueItems: true },
    workspaceAccesses: { type: "array", items: ref("SaveWorkspaceAccessRequest"), minItems: 1, maxItems: 100 },
    idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" } }, ["email", "roleIds", "workspaceAccesses", "idempotencyKey"]),
  TenantOperatorInvitationRow: object({ id: string, email, displayName: string, roleNames: array(string), workspaceNames: array(string),
    status: { type: "string", enum: ["pending", "accepted", "revoked", "expired"] }, deliveryStatus: status, dispatchId: string,
    expiresAt: date, createdAt: date, acceptedAt: date }, ["id", "email", "displayName", "roleNames", "workspaceNames", "status", "deliveryStatus", "dispatchId", "expiresAt", "createdAt"]),
  TenantOperatorInvitationList: array("TenantOperatorInvitationRow"),
  TenantOperatorInvitationMailPreview: object({ subject: string, renderedText: string, renderedHtml: string }, ["subject", "renderedText", "renderedHtml"]),
  InspectTenantOperatorInvitationRequest: object({ token }, ["token"]),
  AcceptTenantOperatorInvitationRequest: object({ token, displayName: { type: "string", minLength: 1, maxLength: 100 },
    password: { type: "string", format: "password", minLength: 8, maxLength: 128 } }, ["token", "displayName", "password"]),
  TenantOperatorInvitationPreview: { oneOf: [
    object({ status: { type: "string", enum: ["pending"] }, tenantName: string, tenantCode: string, email, displayName: string, roleNames: array(string), workspaceNames: array(string),
      expiresAt: date, minPasswordLength: number }, ["status", "tenantName", "tenantCode", "email", "displayName", "roleNames", "workspaceNames", "expiresAt", "minPasswordLength"]),
    object({ status: { type: "string", enum: ["accepted"] }, tenantCode: string, message: string }, ["status", "tenantCode", "message"])
  ] },
  AcceptTenantOperatorInvitationResult: object({ tenantCode: string, message: string }, ["tenantCode", "message"]),
  TenantSupportEmailRow: object(mail, Object.keys(mail)),
  TenantSupportEmailDetail: object({ ...mail, recipient: string, bodyText: string, messageId: string,
    attachments: array(object({ name: string, contentType: string, size: number }, ["name", "contentType", "size"])) }, [...Object.keys(mail), "recipient", "bodyText", "attachments"]),
  TenantSupportEmailPage: object({ rows: array("TenantSupportEmailRow"), total: number, page: number, pageSize: number, receiverConfigured: bool, lastSyncedAt: date }, ["rows", "total", "page", "pageSize", "receiverConfigured"]),
  SyncTenantSupportEmailsResult: object({ imported: number, quarantined: number, checked: number, hasMore: bool, syncedAt: date }, ["imported", "quarantined", "checked", "hasMore", "syncedAt"])
};
const operation = (method: ContractOperation["method"], path: string, operationId: string, summary: string, permissions: string[], responseSchema: string,
  requestSchema?: string, parameters?: ContractOperation["parameters"], authRequired = true): ContractOperation => ({ method, path, operationId, summary, tag: "TenantMessaging", permissions,
  requestSchema, responseSchema, parameters, authRequired, successStatus: method === "post" ? 201 : 200 });
const pagination: NonNullable<ContractOperation["parameters"]> = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1 } }, { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
  { name: "search", in: "query", schema: { type: "string", maxLength: 100 } }
];
export const TENANT_MESSAGING_OPERATIONS: ContractOperation[] = [
  operation("get", "/api/platform/dispatch", "listTenantDispatches", "按租户全部范围查看原短信/邮件发送记录", ["system:integration:manage"], "TenantDispatchPage", undefined,
    [...pagination, { name: "channel", in: "query", schema: { type: "string", enum: ["sms", "email"] } }, { name: "status", in: "query", schema: status }]),
  operation("get", "/api/platform/dispatch/{source}/{id}", "readTenantDispatch", "查看发送内容、模板与原投递结果，邀请令牌隐藏", ["system:integration:manage"], "TenantDispatchDetail", undefined,
    [{ name: "source", in: "path", required: true, schema: row.source }, { name: "id", in: "path", required: true, schema: string }, { name: "channel", in: "query", required: true, schema: row.channel }]),
  operation("get", "/api/platform/users/invitations", "listOperatorInvitations", "查看当前租户运营邀请记录", ["system:user:manage"], "TenantOperatorInvitationList"),
  operation("post", "/api/platform/users/invitations/check-email", "checkOperatorInvitationEmail", "发送前查重，已有账号或待接受邀请不重复发送", ["system:user:manage"], "CheckTenantOperatorEmailResult", "CheckTenantOperatorEmailRequest"),
  operation("post", "/api/platform/users/invitations/preview", "previewOperatorInvitationMail", "只预览原邮件模板，不创建邀请或发送邮件", ["system:user:manage"], "TenantOperatorInvitationMailPreview", "InviteTenantOperatorRequest"),
  operation("post", "/api/platform/users/invitations", "inviteTenantOperator", "准备权限并发送一次邮件邀请，接受前不建账号", ["system:user:manage"], "TenantOperatorInvitationRow", "InviteTenantOperatorRequest"),
  operation("get", "/api/platform/users/invitations/by-key/{key}", "readOperatorInvitationByKey", "通过原操作键核对结果，不重发未知邮件", ["system:user:manage"], "TenantOperatorInvitationRow", undefined,
    [{ name: "key", in: "path", required: true, schema: string }]),
  operation("post", "/api/platform/users/invitations/{id}/revoke", "revokeOperatorInvitation", "撤回尚未接受邀请，原寄件记录保留", ["system:user:manage"], "TenantOperatorInvitationRow", undefined,
    [{ name: "id", in: "path", required: true, schema: string }]),
  operation("post", "/api/auth/operator-invitations/inspect", "inspectOperatorInvitation", "原凭证查看邀请或最小接受结果，未接受时复验原授权", [], "TenantOperatorInvitationPreview", "InspectTenantOperatorInvitationRequest", undefined, false),
  operation("post", "/api/auth/operator-invitations/accept", "acceptOperatorInvitation", "复验邀请和当前权限，原子建立账号及空间成员关系", [], "AcceptTenantOperatorInvitationResult", "AcceptTenantOperatorInvitationRequest", undefined, false),
  operation("get", "/api/platform/support/emails", "listTenantSupportEmails", "查看当前租户客诉邮箱原邮件", ["system:integration:manage"], "TenantSupportEmailPage", undefined, pagination),
  operation("get", "/api/platform/support/emails/{id}", "readTenantSupportEmail", "审计后查看客诉邮件安全正文和附件信息", ["system:integration:manage"], "TenantSupportEmailDetail", undefined,
    [{ name: "id", in: "path", required: true, schema: string }]),
  operation("post", "/api/platform/support/emails/sync", "syncTenantSupportEmails", "只读 IMAP 同步，不修改原邮箱标记，原UID幂等保存", ["system:integration:manage"], "SyncTenantSupportEmailsResult")
];
