import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_CODES } from './ai-scene-request-draft';
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT } from './ai-task-draft';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { AI_TASK_INPUT_DRAFT_SCHEMAS } from './ai-task-input-draft-schemas';
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
const originalReference = object({ draftVersion: base.draftVersion, inputRef: uuid });
const noTask = object({ state: choice('not_observed'), retryable: { type: 'boolean', const: false } });
const observedTask = object({ state: choice('observed'), taskId: uuid, runId: uuid, status: choice(...AI_TASK_STATUSES_DRAFT),
  revision: integer(1, 4294967294), plan: choice('stored', 'not_observed'), resultAvailable: { type: 'boolean' }, execution: choice('not_inferred_from_metadata') });
const recoveryStep = object({ stepId: id(), runId: id(), actionId: id(), revision: integer(1, 4294967294), status: choice(...AI_STEP_STATUSES_DRAFT),
  effect: choice('none', 'possible', 'committed'), resultAvailable: { type: 'boolean' }, nextAction: choice('reconcile_original_action', 'read_authorized_result', 'runner_owned') });
export const AI_SCENE_REQUEST_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneModelReferenceDraft: originalReference,
  AiSceneModelResumeDraft: object({ original: originalReference, submission: AI_TASK_INPUT_DRAFT_SCHEMAS.AiTaskInputSubmissionDraft }),
  AiSceneModelCancelDraft: object({ original: originalReference, expectedRevision: integer(1, 4294967294) }),
  AiSceneModelResultReadDraft: object({ original: originalReference, resultId: id() }),
  AiSceneModelSourceReadDraft: object({ original: originalReference, resultId: id(), sourceIndex: integer(0, 4),
    sourceKind: choice('order', 'knowledge') }, ['original', 'resultId', 'sourceIndex']),
  AiSceneTaskReceiptDraft: { oneOf: [noTask, observedTask] },
  AiSceneRequestRecoveryDraft: { oneOf: [object({ task: noTask, nextAction: choice('reconcile_request_or_explicit_create_task'), automaticExecution: { type: 'boolean', const: false } }),
    object({ task: observedTask, steps: list(recoveryStep, 50), hasMore: { type: 'boolean' }, automaticExecution: { type: 'boolean', const: false },
      nextAction: choice('host_plan_handoff', 'existing_runner_recovery'), observedResults: choice('preserved_even_if_task_cancelled'), snapshot: choice('bounded_sequential_read') })] },
  AiSceneRequestCreateDraft: { oneOf: inputs.map(input => object({ ...base, ...input })) },
  AiSceneRequestReissueDraft: { oneOf: inputs.map(input => object({ ...base, ...input, previousInputRef: uuid })) },
  AiSceneRequestReadDraft: object({ draftVersion: base.draftVersion, inputRef: uuid }),
  AiSceneRequestReceiptDraft: object({ draftVersion: base.draftVersion, inputRef: uuid, revision: integer(1, 4294967294), contentHash: hash,
    sceneCode: choice(...AI_SCENE_CODES), sceneVersion: { ...id(), maxLength: 64 }, requestKey: base.requestKey,
    previousInputRef: { oneOf: [uuid, { type: 'null' }] }, expiresAt: leafTime, createdAt: leafTime, state: choice('stored', 'expired', 'revoked') })
};
