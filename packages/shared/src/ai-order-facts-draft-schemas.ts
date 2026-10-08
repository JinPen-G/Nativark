import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import { RentalCoreOrderStatus } from './core';
import { AI_ORDER_FACTS_DRAFT_VERSION } from './ai-order-facts-draft';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafList as list, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
const amount: AiLeafSchemaDraft = { type: ['number', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const source = obj({ scope: ref('AiWorkspaceScope'), resourceType: choice('order'), resourceId: id(), observedAt: time, basis: obj({ kind: choice('current') }) });
export const AI_ORDER_FACTS_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOrderReadFactsDraft: obj({
    draftVersion: choice(AI_ORDER_FACTS_DRAFT_VERSION), contractVersion: choice(AI_CONTRACT_DRAFT_VERSION),
    requestId: id(), audience: choice('operator', 'staff'), scope: ref('AiWorkspaceScope'), observedAt: time,
    order: obj({ id: id(), orderNo: text(191), status: choice(...Object.values(RentalCoreOrderStatus)), updatedAt: time,
      startAt: time, originalEndAt: time, effectiveEndAt: time, effectiveEndBasis: choice('effectiveEndAt', 'endAt_fallback'),
      currency: { type: 'string', pattern: '^[A-Z]{3}$', minLength: 3, maxLength: 3 },
      amounts: obj({ rental: amount, service: amount, discount: amount, coupon: amount, deposit: amount, preAuthorization: amount, finalPayable: amount }) }),
    sources: list(source, 1, 1), paymentEvidence: choice('not_loaded'), historicalFeeEvidence: choice('not_loaded')
  })
};
