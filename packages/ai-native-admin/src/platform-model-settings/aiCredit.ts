/** 原额度申请、分配、审批与收据沿同一宿主运输；金额不换算，写入不重发。 */
import { AI_CREDIT_HTTP, type AiCreditRequest, type AiCreditSummary, type AiTenantCallRecords } from '@rental-os/platform-contracts/ai-finance';
import type { AiAdminHost } from "../host";
import { createAiSettingsRequest } from "./request";

export function createAiCreditApi(host: AiAdminHost) {
  const request = createAiSettingsRequest(host);
  const post = <T>(action: keyof Omit<typeof AI_CREDIT_HTTP, "basePath">, data: unknown) => {
    const platform = action.startsWith("platform");
    const permission = platform
      ? action === "platformDecide" ? "system:ai-provider:manage" : "system:ai-provider:view"
      : "system:params:manage";
    return request<T>(`/${AI_CREDIT_HTTP.basePath}/${AI_CREDIT_HTTP[action]}`,
      { audience: platform ? "platform" : "tenant", permission,
        write: action === "request" || action === "allocate" || action === "platformDecide" },
      { method: "post", data });
  };
  return Object.freeze({
  calls: (data: { since: string; until: string; cursor?: string; workspaceId?: string; mode?: 'platform_managed' | 'tenant_managed' }) =>
    post<AiTenantCallRecords>('calls', data),
  read: (page: { afterCurrency?: string; afterWorkspace?: string } = {}) => post<AiCreditSummary>('read', page),
  request: (data: { operationKey: string; currency: string; amount: string }) => post<AiCreditRequest>('request', data),
  receipt: (operationKey: string) => post<{ state: 'unknown' } | { state: 'recorded'; request: AiCreditRequest }>('receipt', { operationKey }),
  allocate: (data: { operationKey: string; currency: string; expectedRevision: number; mode?: 'update_listed'; allocations: { workspaceId: string; amount: string }[] }) =>
    post<{ state: 'allocated'; revision: number }>('allocate', data),
  allocationReceipt: (data: { operationKey: string; currency: string }) =>
    post<{ state: 'unknown' } | { state: 'recorded'; result: { state: 'allocated'; revision: number } }>('allocationReceipt', data),
  platformRead: (cursor?: string) => post<{ requests: AiCreditRequest[]; nextCursor: string | null }>('platformRead', { ...(cursor ? { cursor } : {}) }),
  platformDecide: (data: { requestId: string; operationKey: string; expectedRevision: number; decision: 'approve' | 'reject'; amount?: string }) =>
    post<AiCreditRequest>('platformDecide', data),
  platformReceipt: (requestId: string, operationKey: string) => post<{ state: 'unknown' } | { state: 'recorded'; request: AiCreditRequest;
    originalDecision: 'unknown' | 'matched' | 'superseded' }>('platformReceipt', { requestId, operationKey })
});
}
export type AiCreditApi = ReturnType<typeof createAiCreditApi>;
