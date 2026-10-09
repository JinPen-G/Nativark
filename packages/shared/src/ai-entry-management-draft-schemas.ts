import { AI_ENTRY_ACTION_CONTRACT_VERSION, AI_CUSTOMER_ENTRY_SURFACES } from './ai-entry-action-draft';
import { AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION } from './ai-knowledge-policy-management-draft';
import { AI_BOOKING_DRAFT_CONTRACT_VERSION, AI_BOOKING_DRAFT_STATES, AI_BOOKING_INPUT_SOURCES } from './ai-booking-draft';
import { RENTAL_FULFILLMENT_MODES } from './core';

const id = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const uuid = { type: 'string', format: 'uuid' };
const knowledgeId = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const date = { type: 'string', format: 'date-time' };
const literal = (value: string | boolean | number) => ({ const: value });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const permissions = { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true,
  items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$' } };
const scope = object({ kind: literal('workspace'), tenantId: id, workspaceId: id });
const quantity = { type: 'integer', minimum: 1, maximum: 999 };
const selection = object({ quoteId: id, timeZone: { type: 'string', minLength: 1, maxLength: 100 }, startAt: date, endAt: date,
  fulfillmentMode: { enum: [...RENTAL_FULFILLMENT_MODES] }, fulfillmentLocationId: id, returnLocationId: id, deliveryAddressId: id,
  bookingIdentity: object({ bookingIdentity: { enum: ['personal', 'enterprise_employee'] }, corporateCustomerId: id,
    enterpriseContractAndPayer: { type: 'boolean' } }, ['bookingIdentity', 'enterpriseContractAndPayer']),
  lines: { type: 'array', minItems: 1, maxItems: 20, items: object({ itemGroupId: id, quantity }) },
  services: { type: 'array', maxItems: 20, items: object({ serviceId: id, quantity, scheduledStartAt: date,
    scheduledEndAt: date, serviceLocationId: id }, ['serviceId', 'quantity']) }
}, ['quoteId', 'timeZone', 'startAt', 'endAt', 'fulfillmentMode', 'fulfillmentLocationId', 'bookingIdentity', 'lines']);
const nullableId = { anyOf: [id, { type: 'null' }] };
const amount = { type: 'number', minimum: 0 };
const quote = object({ quoteId: id, quoteVersion: hash, pricingPlanVersion: id, ruleVersion: id,
  priceVersionId: nullableId, calendarVersion: nullableId, categoryVersionId: nullableId,
  currency: { type: 'string', pattern: '^[A-Z]{3}$' }, payableAmount: amount, depositAmount: amount, preAuthAmount: amount,
  chargeLines: { type: 'array', maxItems: 100, items: object({ type: id, amount: { type: 'number' }, sourceId: nullableId, sourceVersion: nullableId }) },
  expiresAt: date, createdAt: date });
const source = { enum: [...AI_BOOKING_INPUT_SOURCES] };
const sources = object(Object.fromEntries(Object.keys(selection.properties).map(key => [key, source])),
  Object.keys(selection.properties).filter(key => key !== 'deliveryAddressId'));
const material = object({ selection, sources, deliveryAddress: object({ addressId: id,
  observedRevision: { type: 'integer', minimum: 1 }, observedUpdatedAt: date, quoteAddressRevision: { type: 'null' },
  snapshotFingerprint: hash, serviceAreaFingerprint: hash, source: literal('current_client_saved_address') }),
  quote, catalogVersion: hash, availabilityVersion: hash, identityVersion: hash,
  availability: literal('available_at_observation_not_reserved') },
  ['selection', 'sources', 'quote', 'catalogVersion', 'availabilityVersion', 'identityVersion', 'availability']);

// Publication describes payload shape, not current authorization or permission
// to navigate/execute. Runtime consumers must still verify the original binding.
export const AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS = {
  AiKnowledgePreparationTargetSpecDraft: object({ version: literal('knowledge-prepared-target-1'), operationKey: knowledgeId,
    upload: object({ documentId: { ...knowledgeId, maxLength: 36 }, fileName: { type: 'string', minLength: 1, maxLength: 180 },
      mimeType: { enum: ['text/plain', 'text/markdown'] }, sizeBytes: { type: 'integer', minimum: 1, maximum: 262144 } }),
    document: object({ documentVersion: knowledgeId, operationId: knowledgeId, title: { type: 'string', minLength: 1, maxLength: 256 },
      validFrom: date, validUntil: date }, ['documentVersion', 'operationId', 'title', 'validFrom']), expiresAt: date }),
  AiKnowledgeTargetSelectionDraft: object({ authorityId: uuid }),
  AiKnowledgeTargetReadDraft: object({ authorityId: uuid, operationKey: knowledgeId, specHash: hash }, ['authorityId', 'operationKey']),
  AiKnowledgeTargetBindDraft: object({ authorityId: uuid, operationKey: knowledgeId, sessionId: { type: 'string', minLength: 1, maxLength: 128 },
    expectedRevision: literal(1), confirm: literal('bind_knowledge_upload') }),
  AiBookingSelection: selection,
  AiBookingDraft: object({ contractVersion: literal(AI_BOOKING_DRAFT_CONTRACT_VERSION), bookingDraftId: uuid,
    audience: literal('customer'), surface: { enum: [...AI_CUSTOMER_ENTRY_SURFACES] }, scope,
    state: { enum: [...AI_BOOKING_DRAFT_STATES] }, revision: { type: 'integer', minimum: 1 },
    selectionRevision: { type: 'integer', minimum: 0, maximum: 1 }, inputFingerprint: hash, materialRef: uuid, material,
    createdAt: date, expiresAt: date, execution: literal('not_submitted'),
    action: { anyOf: [{ $ref: '#/components/schemas/AiEntryActionDraft' }, { type: 'null' }] } }),
  AiBookingHandoff: object({ contractVersion: literal(AI_BOOKING_DRAFT_CONTRACT_VERSION), handoffRef: uuid,
    bookingDraftId: uuid, revision: { type: 'integer', minimum: 1 }, audience: literal('customer'),
    surface: { enum: [...AI_CUSTOMER_ENTRY_SURFACES] }, scope, expiresAt: date, fields: selection,
    actionCode: literal('OPEN_BOOKING'), submission: literal('original_booking_page_required'), inventory: literal('not_reserved') }),
  AiEntryActionDraft: object({ contractVersion: literal(AI_ENTRY_ACTION_CONTRACT_VERSION), actionId: id,
    actionCode: { enum: ['OPEN_ORDER', 'OPEN_BOOKING', 'CREATE_BOOKING_DRAFT'] }, audience: literal('customer'),
    surface: { enum: [...AI_CUSTOMER_ENTRY_SURFACES] },
    scope: object({ kind: literal('workspace'), tenantId: id, workspaceId: id }),
    resource: object({ kind: { enum: ['order', 'quote', 'booking_draft'] }, id, resourceVersion: hash }),
    requiresConfirmation: { type: 'boolean' }, riskLevel: { enum: ['R0', 'R1'] }, issuedAt: date, expiresAt: date,
    inputFingerprint: hash, bindingFingerprint: hash, policyFingerprint: hash,
    associations: object({ materialRef: uuid, taskId: { type: 'null' }, proposalId: { type: 'null' },
      quoteId: { anyOf: [id, { type: 'null' }] }, bookingDraftId: { anyOf: [uuid, { type: 'null' }] } }) }),
  AiKnowledgePolicyChangeDraft: object({ version: literal(AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION), authorityId: uuid,
    operationKey: knowledgeId, expectedRevision: { type: 'integer', minimum: 0, maximum: 4294967293 },
    action: { enum: ['create_disabled', 'update_disabled', 'enable', 'disable'] }, requiredPermissions: permissions, expiresAt: date }),
  AiKnowledgePolicyCommitDraft: object({ preparationId: uuid, changeHash: hash, confirm: literal('apply_knowledge_policy_change') }),
  AiKnowledgePolicyPreparationSelectionDraft: object({ operationKey: knowledgeId, changeHash: hash }, ['operationKey']),
  AiKnowledgePolicyReceiptSelectionDraft: object({ operationKey: knowledgeId, changeHash: hash }),
  AiKnowledgePolicyManagementReceiptDraft: object({ state: literal('observed'), operationKey: knowledgeId,
    preparationId: uuid, changeHash: hash, policyKeyHash: hash,
    result: { $ref: '#/components/schemas/AiKnowledgePolicySnapshotDraft' }, recordedAt: date,
    retryable: literal(false), executionPermission: literal(false) }),
  AiKnowledgePolicyManagementUnknownDraft: object({ state: { enum: ['unknown', 'not_observed'] }, operationKey: knowledgeId,
    changeHash: hash, retryable: literal(false), nextAction: { enum: ['read_preparation', 'read_operation'] },
    executionPermission: literal(false) }, ['state', 'operationKey', 'retryable', 'nextAction', 'executionPermission']),
  AiKnowledgePolicySnapshotDraft: object({ revision: { type: 'integer', minimum: 1, maximum: 4294967294 },
    enabled: { type: 'boolean' }, requiredPermissions: permissions, expiresAt: date })
} as const;
