import type { RentalCoreOrderStatus } from './core';
import type { AI_CONTRACT_DRAFT_VERSION, AiFactReference, AiWorkspaceScope } from './ai-native';

export const AI_ORDER_FACTS_DRAFT_VERSION = 'ain-order-facts-draft-1' as const;
/** Minimal current Core projection, NOT a complete explanation or payment result.
 * Amounts copy Core numbers unchanged; null means not loaded, not zero.
 */
export interface AiOrderReadFactsDraft {
  draftVersion: typeof AI_ORDER_FACTS_DRAFT_VERSION;
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
  audience: 'operator' | 'staff';
  scope: AiWorkspaceScope;
  observedAt: string;
  order: {
    id: string; orderNo: string; status: RentalCoreOrderStatus; updatedAt: string;
    startAt: string; originalEndAt: string; effectiveEndAt: string;
    effectiveEndBasis: 'effectiveEndAt' | 'endAt_fallback';
    currency: string;
    amounts: { rental: number | null; service: number | null; discount: number | null; coupon: number | null;
      deposit: number | null; preAuthorization: number | null; finalPayable: number | null };
  };
  sources: [AiFactReference & { scope: AiWorkspaceScope; resourceType: 'order'; basis: { kind: 'current' } }];
  paymentEvidence: 'not_loaded';
  historicalFeeEvidence: 'not_loaded';
}
