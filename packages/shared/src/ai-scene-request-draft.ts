import type { RentalFulfillmentMode, RENTAL_PRICING_UNIT_CODES } from './core';

export const AI_SCENE_REQUEST_DRAFT_VERSION = 'ain-scene-request-draft-1' as const;
export const AI_SCENE_REQUEST_MAX_BYTES = 32768;
export const AI_SCENE_CODES = ['order_explanation', 'opening_diagnosis', 'quote_clarification'] as const;
export type AiSceneCode = typeof AI_SCENE_CODES[number];
export interface AiSceneQuoteCandidate {
  customerType: 'personal' | 'corporate';
  customerId?: string;
  customerName?: string;
  items?: Array<{ productName?: string; itemGroupId?: string; quantity: number; pricingUnit?: typeof RENTAL_PRICING_UNIT_CODES[number]; usageQuantity?: number }>;
  start?: string;
  end?: string;
  fulfillmentMode?: RentalFulfillmentMode;
  locationName?: string;
  returnLocationName?: string;
  locationId?: string;
  returnLocationId?: string;
  selectionRevision?: string;
}
export type AiSceneRequestBody =
  | { sceneCode: 'order_explanation'; input: { orderId: string; question: 'status' | 'fees' | 'payments' | 'next_steps' } }
  | { sceneCode: 'opening_diagnosis'; input: { sections: string[] } }
  | { sceneCode: 'quote_clarification'; input: { candidate: AiSceneQuoteCandidate } };
export type AiSceneRequestCreateDraft = AiSceneRequestBody & {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  requestKey: string;
};
export type AiSceneRequestReissueDraft = AiSceneRequestCreateDraft & { previousInputRef: string };
export interface AiSceneRequestReadDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
}
export interface AiSceneRequestReceiptDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
  revision: number;
  contentHash: string;
  sceneCode: AiSceneCode;
  sceneVersion: string;
  requestKey: string;
  previousInputRef: string | null;
  expiresAt: string;
  createdAt: string;
  state: 'stored' | 'expired' | 'revoked';
}
