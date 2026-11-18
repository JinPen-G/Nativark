/** 租户寄件与运营账号邀请的公开契约；不携带 SMTP 凭据或可使用的邀请令牌。 */
import type { SaveWorkspaceAccessRequest } from "./platform";

export type TenantDispatchChannel = "sms" | "email";
export type TenantDispatchStatus = "queued" | "sent" | "delivery_pending" | "delivered" | "delivery_failed" | "failed" | "delivery_uncertain" | "simulated" | "simulation_failed";
export type TenantDispatchSource = "platform" | "rental" | "verification";

export interface TenantDispatchQuery {
  channel?: TenantDispatchChannel;
  status?: TenantDispatchStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TenantDispatchRow {
  id: string;
  source: TenantDispatchSource;
  channel: TenantDispatchChannel;
  recipient: string;
  subject: string;
  status: TenantDispatchStatus;
  provider: string;
  workspaceName?: string;
  businessType?: string;
  businessId?: string;
  createdAt: string;
  sentAt?: string;
}

export interface TenantDispatchDetail extends TenantDispatchRow {
  sender?: string;
  renderedText: string;
  /** 服务端固定模板的安全预览；认证凭证和实际激活链接均不在此投影中。 */
  renderedHtml?: string;
  templateVersion?: string;
  providerMessageId?: string;
  errorMessage?: string;
  attempts: number;
}

export interface TenantDispatchPage {
  rows: TenantDispatchRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InviteTenantOperatorRequest {
  email: string;
  displayName?: string;
  organizationId?: string;
  roleIds: string[];
  workspaceAccesses: SaveWorkspaceAccessRequest[];
  /** 同一次邀请提交保留原键；超时后通过原键核对，不换键重发。 */
  idempotencyKey: string;
}

export interface TenantOperatorInvitationRow {
  id: string;
  email: string;
  displayName: string;
  roleNames: string[];
  workspaceNames: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  deliveryStatus: TenantDispatchStatus;
  dispatchId: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
}

export interface CheckTenantOperatorEmailResult {
  exists: boolean;
  pendingInvitation: boolean;
  message?: string;
}
export interface CheckTenantOperatorEmailRequest { email: string; }

export interface InspectTenantOperatorInvitationRequest { token: string; }
export interface AcceptTenantOperatorInvitationRequest extends InspectTenantOperatorInvitationRequest {
  displayName: string;
  password: string;
}
export interface TenantOperatorInvitationPreview {
  tenantName: string;
  tenantCode: string;
  email: string;
  displayName: string;
  roleNames: string[];
  workspaceNames: string[];
  expiresAt: string;
  minPasswordLength: number;
}
export interface TenantOperatorInvitationMailPreview {
  subject: string;
  renderedText: string;
  renderedHtml: string;
}
export interface AcceptTenantOperatorInvitationResult {
  tenantCode: string;
  message: string;
}

export interface TenantSupportEmailQuery { search?: string; page?: number; pageSize?: number; }
export interface TenantSupportEmailRow {
  id: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  preview: string;
  receivedAt: string;
  attachmentCount: number;
}
export interface TenantSupportEmailDetail extends TenantSupportEmailRow {
  recipient: string;
  bodyText: string;
  messageId?: string;
  attachments: Array<{ name: string; contentType: string; size: number }>;
}
export interface TenantSupportEmailPage {
  rows: TenantSupportEmailRow[];
  total: number;
  page: number;
  pageSize: number;
  receiverConfigured: boolean;
  lastSyncedAt?: string;
}
export interface SyncTenantSupportEmailsResult {
  imported: number;
  checked: number;
  hasMore: boolean;
  syncedAt: string;
}
