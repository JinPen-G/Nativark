import { AI_CREDIT_HTTP, type AiCreditRequest, type AiCreditSummary, type AiTenantCallRecords } from '@rental-os/shared';
import { request } from './http';
const post = <T>(action: keyof Omit<typeof AI_CREDIT_HTTP, 'basePath'>, data: unknown) =>
  request<T>(`/${AI_CREDIT_HTTP.basePath}/${AI_CREDIT_HTTP[action]}`, { method: 'post', data });
export const aiCreditApi = {
  calls: (data: { since: string; until: string; cursor?: string; workspaceId?: string; mode?: 'platform_managed' | 'tenant_managed' }) =>
    post<AiTenantCallRecords>('calls', data),
  read: () => post<AiCreditSummary>('read', {}),
  request: (data: { operationKey: string; currency: string; amount: string }) => post<AiCreditRequest>('request', data),
  receipt: (operationKey: string) => post<{ state: 'unknown' } | { state: 'recorded'; request: AiCreditRequest }>('receipt', { operationKey }),
  allocate: (data: { operationKey: string; currency: string; expectedRevision: number; allocations: { workspaceId: string; amount: string }[] }) =>
    post<{ state: 'allocated'; revision: number }>('allocate', data),
  allocationReceipt: (data: { operationKey: string; currency: string }) =>
    post<{ state: 'unknown' } | { state: 'recorded'; result: { state: 'allocated'; revision: number } }>('allocationReceipt', data),
  platformRead: (cursor?: string) => post<{ requests: AiCreditRequest[]; nextCursor: string | null }>('platformRead', { ...(cursor ? { cursor } : {}) }),
  platformDecide: (data: { requestId: string; operationKey: string; expectedRevision: number; decision: 'approve' | 'reject'; amount?: string }) =>
    post<AiCreditRequest>('platformDecide', data),
  platformReceipt: (requestId: string, operationKey: string) => post<{ state: 'unknown' } | { state: 'recorded'; request: AiCreditRequest;
    originalDecision: 'unknown' | 'matched' | 'superseded' }>('platformReceipt', { requestId, operationKey })
};
