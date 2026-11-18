/** 消息 HTTP 方法、路由、权限和输入输出同源声明，公开凭证操作仅登记 POST。 */
import { TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS, TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS } from "./tenant-messaging-openapi";

const pagination = [
  { name: "page", in: "query", required: false, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.page },
  { name: "pageSize", in: "query", required: false, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.pageSize },
  { name: "search", in: "query", required: false, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.search }
] as const;

export const TENANT_MESSAGING_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/dispatch", id: "listTenantDispatches", summary: "按当前租户管理范围查看原短信和邮件发送记录",
    access: "tenant", permission: "system:integration:manage", response: "Messaging.TenantDispatchPage",
    parameters: [...pagination,
      { name: "channel", in: "query", required: false, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.channel },
      { name: "status", in: "query", required: false, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.status }] },
  { method: "GET", path: "/platform/dispatch/:source/:id", id: "readTenantDispatch", summary: "审计后读取原发送内容、模板与投递结果",
    access: "tenant", permission: "system:integration:manage", response: "Messaging.TenantDispatchDetail",
    parameters: [
      { name: "source", in: "path", required: true, schema: TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS.source },
      { name: "id", in: "path", required: true, schema: TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS.id },
      { name: "channel", in: "query", required: true, schema: TENANT_MESSAGING_OPENAPI_QUERY_SCHEMAS.channel }] },
  { method: "GET", path: "/platform/users/invitations", id: "listOperatorInvitations", summary: "读取当前租户运营邀请记录",
    access: "tenant", permission: "system:user:manage", response: "Messaging.TenantOperatorInvitationList" },
  { method: "POST", path: "/platform/users/invitations/check-email", id: "checkOperatorInvitationEmail", summary: "发送前查重，读取已有账号或待接受邀请状态",
    access: "tenant", permission: "system:user:manage", effect: "read", request: "Messaging.CheckTenantOperatorEmailRequest", response: "Messaging.CheckTenantOperatorEmailResult" },
  { method: "POST", path: "/platform/users/invitations/preview", id: "previewOperatorInvitationMail", summary: "预览固定邀请邮件模板",
    access: "tenant", permission: "system:user:manage", effect: "read", request: "Messaging.InviteTenantOperatorRequest", response: "Messaging.TenantOperatorInvitationMailPreview" },
  { method: "POST", path: "/platform/users/invitations", id: "inviteTenantOperator", summary: "准备当前授权并提交原邮件邀请",
    access: "tenant", permission: "system:user:manage", request: "Messaging.InviteTenantOperatorRequest", response: "Messaging.TenantOperatorInvitationRow" },
  { method: "GET", path: "/platform/users/invitations/by-key/:key", id: "readOperatorInvitationByKey", summary: "通过原操作键核对邀请结果",
    access: "tenant", permission: "system:user:manage", response: "Messaging.TenantOperatorInvitationRow",
    parameters: [{ name: "key", in: "path", required: true, schema: TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS.key }] },
  { method: "POST", path: "/platform/users/invitations/:id/revoke", id: "revokeOperatorInvitation", summary: "撤回尚未接受的原邀请",
    access: "tenant", permission: "system:user:manage", response: "Messaging.TenantOperatorInvitationRow",
    parameters: [{ name: "id", in: "path", required: true, schema: TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS.id }] },
  { method: "POST", path: "/auth/operator-invitations/inspect", id: "inspectOperatorInvitation", summary: "经原限流与一次性凭证读取邀请",
    access: "anonymous", effect: "read", request: "Messaging.InspectTenantOperatorInvitationRequest", response: "Messaging.TenantOperatorInvitationPreview" },
  { method: "POST", path: "/auth/operator-invitations/accept", id: "acceptOperatorInvitation", summary: "复验原邀请，原子建立账号和已核定授权",
    access: "anonymous", request: "Messaging.AcceptTenantOperatorInvitationRequest", response: "Messaging.AcceptTenantOperatorInvitationResult" },
  { method: "GET", path: "/platform/support/emails", id: "listTenantSupportEmails", summary: "读取当前租户客服邮箱原邮件",
    access: "tenant", permission: "system:integration:manage", response: "Messaging.TenantSupportEmailPage", parameters: pagination },
  { method: "GET", path: "/platform/support/emails/:id", id: "readTenantSupportEmail", summary: "审计后读取客服邮件安全正文和附件信息",
    access: "tenant", permission: "system:integration:manage", response: "Messaging.TenantSupportEmailDetail",
    parameters: [{ name: "id", in: "path", required: true, schema: TENANT_MESSAGING_OPENAPI_PATH_SCHEMAS.id }] },
  { method: "POST", path: "/platform/support/emails/sync", id: "syncTenantSupportEmails", summary: "显式读取 IMAP 并按原 UID 幂等保存",
    access: "tenant", permission: "system:integration:manage", response: "Messaging.SyncTenantSupportEmailsResult" }
] as const;
