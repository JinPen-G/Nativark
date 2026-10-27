/** Platform AI entitlement protocol. Grants are not model dispatch authority or
 * a second payment ledger; BYOK has no supplier-price fields in this contract. */
export const AI_CREDIT_HTTP = { basePath: 'ai-native/credits', read: 'read', request: 'request',
  receipt: 'receipt', allocate: 'allocate', platformRead: 'platform-read',
  platformDecide: 'platform-decide', platformReceipt: 'platform-receipt', calls: 'calls', allocationReceipt: 'allocation-receipt' } as const;
export interface AiTenantCallRecord {
  id: string; taskId: string; callId: string; createdAt: string; workspaceId: string; workspaceName: string;
  actorName: string; sceneCode: string; mode: 'platform_managed' | 'tenant_managed' | 'unknown'; modelLabel: string;
  state: 'registered' | 'reserved' | 'dispatched' | 'settled' | 'cancelled' | 'unknown';
  inputTokens: string | null; outputTokens: string | null; cachedInputTokens: string | null;
  amount: string | null; currency: string | null;
}
export interface AiTenantCallRecords { records: AiTenantCallRecord[]; nextCursor: string | null; observedAt: string; }
export interface AiCreditRequest {
  id: string; tenantId: string; tenantName: string; currency: string; requestedAmount: string;
  state: 'pending' | 'approved' | 'rejected'; revision: number; grantedAmount: string | null;
  createdAt: string; decidedAt: string | null;
}
export interface AiCreditBalance {
  currency: string; grantedAmount: string; spentAmount: string; heldAmount: string; availableAmount: string;
  revision: number; allocations: { workspaceId: string; amount: string }[];
}
export interface AiCreditSummary {
  currencies: string[]; balances: AiCreditBalance[]; requests: AiCreditRequest[];
  workspaces: { id: string; name: string }[]; requestHistoryComplete: boolean;
}
