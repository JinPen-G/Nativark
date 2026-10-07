import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_CODES } from './ai-scene-request-draft';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { leafClosed as object, leafEnum as choice, leafId as id, leafText as text, leafInt as integer, leafList as list, leafTime, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const candidate = object({ customerType: choice('personal', 'corporate'), customerId: text(), customerName: text(),
  items: list(object({ productName: text(), itemGroupId: id(), quantity: integer(1, 10000), pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES),
    usageQuantity: { type: 'number', minimum: 0, maximum: 1000000 } }, ['quantity']), 50, 1),
  start: text(80), end: text(80), fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES), locationName: text(), returnLocationName: text(),
  locationId: id(), returnLocationId: id(), selectionRevision: hash }, ['customerType']);
const inputs = [
  { sceneCode: choice('order_explanation'), input: object({ orderId: id(), question: choice('status', 'fees', 'payments', 'next_steps') }) },
  { sceneCode: choice('opening_diagnosis'), input: object({ sections: { ...list(id(), 9, 1), uniqueItems: true } }) },
  { sceneCode: choice('quote_clarification'), input: object({ candidate }) }
];
const base = { draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), requestKey: { ...id(), maxLength: 128 } };
export const AI_SCENE_REQUEST_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneRequestCreateDraft: { oneOf: inputs.map(input => object({ ...base, ...input })) },
  AiSceneRequestReissueDraft: { oneOf: inputs.map(input => object({ ...base, ...input, previousInputRef: uuid })) },
  AiSceneRequestReadDraft: object({ draftVersion: base.draftVersion, inputRef: uuid }),
  AiSceneRequestReceiptDraft: object({ draftVersion: base.draftVersion, inputRef: uuid, revision: integer(1, 4294967294), contentHash: hash,
    sceneCode: choice(...AI_SCENE_CODES), sceneVersion: { ...id(), maxLength: 64 }, requestKey: base.requestKey,
    previousInputRef: { oneOf: [uuid, { type: 'null' }] }, expiresAt: leafTime, createdAt: leafTime, state: choice('stored', 'expired', 'revoked') })
};
