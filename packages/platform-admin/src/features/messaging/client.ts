/** 公共邀请、寄件与客服邮件沿宿主会话端口；写入单次派发，保留原键与长请求时限。 */
import axios from "axios";
import { useMemo } from "react";
import type {
  AcceptTenantOperatorInvitationRequest,
  AcceptTenantOperatorInvitationResult,
  ApiResult,
  CheckTenantOperatorEmailResult,
  InviteTenantOperatorRequest,
  SyncTenantSupportEmailsResult,
  TenantDispatchChannel,
  TenantDispatchDetail,
  TenantDispatchPage,
  TenantDispatchQuery,
  TenantDispatchSource,
  TenantOperatorInvitationMailPreview,
  TenantOperatorInvitationPreview,
  TenantOperatorInvitationRow,
  TenantSupportEmailDetail,
  TenantSupportEmailPage,
  TenantSupportEmailQuery
} from "@rental-os/platform-contracts";
import { useAdminRuntime, type AdminRequestOptions } from "../../runtime";

export interface MessagingRequestOptions extends AdminRequestOptions {
  timeout?: number;
}

export type MessagingRequest = <Output>(path: string, options?: MessagingRequestOptions) => Promise<Output>;

export function createTenantMessagingApi(request: MessagingRequest) {
  return {
    dispatches: (params: TenantDispatchQuery, signal?: AbortSignal) =>
      request<TenantDispatchPage>("/platform/dispatch", { params, signal }),
    dispatchDetail: (source: TenantDispatchSource, id: string, channel: TenantDispatchChannel, signal?: AbortSignal) =>
      request<TenantDispatchDetail>(`/platform/dispatch/${source}/${encodeURIComponent(id)}`, { params: { channel }, signal }),
    invitations: (signal?: AbortSignal) =>
      request<TenantOperatorInvitationRow[]>("/platform/users/invitations", { signal }),
    checkEmail: (email: string, signal?: AbortSignal) =>
      request<CheckTenantOperatorEmailResult>("/platform/users/invitations/check-email", { method: "post", data: { email }, signal }),
    invitationPreview: (data: InviteTenantOperatorRequest, signal?: AbortSignal) =>
      request<TenantOperatorInvitationMailPreview>("/platform/users/invitations/preview", { method: "post", data, signal }),
    invite: (data: InviteTenantOperatorRequest) =>
      request<TenantOperatorInvitationRow>("/platform/users/invitations", { method: "post", data, timeout: 55_000, retryAuthentication: false }),
    invitationByKey: (key: string, signal?: AbortSignal) =>
      request<TenantOperatorInvitationRow>(`/platform/users/invitations/by-key/${encodeURIComponent(key)}`, { signal }),
    revokeInvitation: (id: string) =>
      request<TenantOperatorInvitationRow>(`/platform/users/invitations/${encodeURIComponent(id)}/revoke`, { method: "post", retryAuthentication: false })
  };
}

export function useTenantMessagingApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createTenantMessagingApi(runtime.request), [runtime]);
}

export function createTenantSupportApi(request: MessagingRequest) {
  return {
    emails: (params: TenantSupportEmailQuery, signal?: AbortSignal) =>
      request<TenantSupportEmailPage>("/platform/support/emails", { params, signal }),
    detail: (id: string, signal?: AbortSignal) =>
      request<TenantSupportEmailDetail>(`/platform/support/emails/${encodeURIComponent(id)}`, { signal }),
    sync: () => request<SyncTenantSupportEmailsResult>("/platform/support/emails/sync", { method: "post", data: {}, timeout: 110_000, retryAuthentication: false })
  };
}

export function useTenantSupportApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createTenantSupportApi(runtime.request), [runtime]);
}

/** 匿名邀请使用独立客户端，凭证仅提交至宿主明确配置的原认证入口。 */
export function createOperatorInvitationApi(baseURL: string) {
  const anonymous = axios.create({
    baseURL,
    withCredentials: false,
    headers: { Authorization: null, "x-tenant-id": null, "x-tenant-code": null, "x-workspace-id": null }
  });
  return {
    inspect: async (token: string, signal?: AbortSignal) =>
      (await anonymous.post<ApiResult<TenantOperatorInvitationPreview>>("/auth/operator-invitations/inspect", { token }, { signal })).data.data,
    accept: async (data: AcceptTenantOperatorInvitationRequest) =>
      (await anonymous.post<ApiResult<AcceptTenantOperatorInvitationResult>>("/auth/operator-invitations/accept", data, { timeout: 20_000 })).data.data
  };
}

export type OperatorInvitationApi = ReturnType<typeof createOperatorInvitationApi>;
