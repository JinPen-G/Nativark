/** 租户寄件及邀请 API：权限/去重由原服务端裁定，沿共用会话中止与401恢复。 */
import axios from "axios";
import type { AcceptTenantOperatorInvitationRequest, AcceptTenantOperatorInvitationResult, ApiResult,
  CheckTenantOperatorEmailResult, InviteTenantOperatorRequest, TenantDispatchChannel, TenantDispatchDetail, TenantDispatchPage,
  TenantDispatchQuery, TenantDispatchSource, TenantOperatorInvitationPreview, TenantOperatorInvitationRow,
  TenantSupportEmailDetail, TenantSupportEmailPage, TenantSupportEmailQuery, SyncTenantSupportEmailsResult, TenantOperatorInvitationMailPreview } from "@rental-os/shared";
import { http, request } from "./http";

export const tenantMessagingApi = {
  dispatches: (params: TenantDispatchQuery) => request<TenantDispatchPage>("/platform/dispatch", { params }),
  dispatchDetail: (source: TenantDispatchSource, id: string, channel: TenantDispatchChannel) =>
    request<TenantDispatchDetail>(`/platform/dispatch/${source}/${encodeURIComponent(id)}`, { params: { channel } }),
  invitations: () => request<TenantOperatorInvitationRow[]>("/platform/users/invitations"),
  checkEmail: (email: string) => request<CheckTenantOperatorEmailResult>("/platform/users/invitations/check-email", { method: "post", data: { email } }),
  invitationPreview: (data: InviteTenantOperatorRequest) => request<TenantOperatorInvitationMailPreview>("/platform/users/invitations/preview", { method: "post", data }),
  invite: async (data: InviteTenantOperatorRequest) => (await http.post<ApiResult<TenantOperatorInvitationRow>>("/platform/users/invitations", data, { timeout: 55000 })).data.data,
  invitationByKey: (key: string) => request<TenantOperatorInvitationRow>(`/platform/users/invitations/by-key/${encodeURIComponent(key)}`),
  revokeInvitation: (id: string) => request<TenantOperatorInvitationRow>(`/platform/users/invitations/${encodeURIComponent(id)}/revoke`, { method: "post" })
};
export const tenantSupportApi = {
  emails: (params: TenantSupportEmailQuery) => request<TenantSupportEmailPage>("/platform/support/emails", { params }),
  detail: (id: string) => request<TenantSupportEmailDetail>(`/platform/support/emails/${encodeURIComponent(id)}`),
  sync: async () => (await http.post<ApiResult<SyncTenantSupportEmailsResult>>("/platform/support/emails/sync", {}, { timeout: 110000 })).data.data
};
// 受邀页面为匿名认证入口，不能携带浏览器内其他租户的token/headers或触发自动401重发。
const base = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const operatorInvitationApi = {
  inspect: async (token: string, signal?: AbortSignal) => (await axios.post<ApiResult<TenantOperatorInvitationPreview>>(`${base}/auth/operator-invitations/inspect`, { token }, { signal })).data.data,
  accept: async (data: AcceptTenantOperatorInvitationRequest) => (await axios.post<ApiResult<AcceptTenantOperatorInvitationResult>>(`${base}/auth/operator-invitations/accept`, data, { timeout: 20000 })).data.data
};
