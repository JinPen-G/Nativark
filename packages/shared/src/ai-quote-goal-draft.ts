/** Named human quote goals and read-only model candidates. The original request
 * stores the exact input and owns its hash; these contracts never select a
 * customer/product, create a Core quote, or grant approval or execution. */
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, type RentalFulfillmentMode } from './core';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafText as text, leafTime, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_QUOTE_GOAL_DRAFT_VERSION = 'ai-quote-goal-1' as const;
export const AI_QUOTE_GOAL_LIMITS = Object.freeze({ goalCharacters: 4096, lines: 50,
  quantity: 10000, usageQuantity: 1000000, choices: 10, fields: 256, modelBytes: 131072 });

export interface AiQuoteGoalInputDraft {
  kind: 'quote_goal';
  draftVersion: typeof AI_QUOTE_GOAL_DRAFT_VERSION;
  /** Preserve whitespace and original words. This is human intent, not facts. */
  goalText: string;
}

export interface AiQuoteGoalOriginalDraft { inputRef: string; revision: number; contentHash: string }
export interface AiQuoteGoalSourceDraft {
  kind: 'original_quote_goal';
  draftVersion: typeof AI_QUOTE_GOAL_DRAFT_VERSION;
  original: AiQuoteGoalOriginalDraft;
  input: AiQuoteGoalInputDraft;
  goalHash: string;
  trust: 'human_goal_not_business_fact_or_authority';
}

/** Guarded configuration for collecting a goal, before any customer, product,
 * quantity or Core quotation is selected. Monetary facts are not loaded. */
export interface AiQuoteGoalContextDraft {
  kind: 'quote_goal_context'; goalHash: string;
  configuration: {
    scope: { kind: 'workspace'; tenantId: string; workspaceId: string };
    audience: 'operator' | 'staff'; observedAt: string; sourceHash: string;
    categoryCode: string; configVersion: string; timeZone: string;
    pricingUnits: Array<typeof RENTAL_PRICING_UNIT_CODES[number]>;
    fulfillmentModes: RentalFulfillmentMode[];
    deliveryDestination: 'customer_address' | 'tenant_location'; capabilities: string[];
  };
  input: 'unconfirmed_human_goal'; quotation: 'not_created'; identitySelection: 'explicit_human_choice_required';
}

/** Model words only. There are deliberately no IDs, payer selections, prices,
 * quote references, proposed tool calls, or approval fields. */
export interface AiQuoteGoalConditionsDraft {
  customerType?: 'personal' | 'corporate';
  customerName?: string;
  items?: Array<{ productName?: string; quantity?: number;
    pricingUnit?: typeof RENTAL_PRICING_UNIT_CODES[number]; usageQuantity?: number }>;
  start?: string;
  end?: string;
  fulfillmentMode?: RentalFulfillmentMode;
  locationName?: string;
  returnLocationName?: string;
}

export interface AiQuoteGoalModelOutputDraft {
  kind: 'quote_goal_candidates';
  draftVersion: typeof AI_QUOTE_GOAL_DRAFT_VERSION;
  conditions: AiQuoteGoalConditionsDraft;
  unresolvedFields: string[];
}

export type AiQuoteGoalIssueReasonDraft = 'not_supplied' | 'model_unresolved'
  | 'human_choice_required' | 'unsupported_by_current_configuration'
  | 'original_enterprise_flow_required' | 'not_observed_in_bounded_source';
export interface AiQuoteGoalChoiceGroupDraft {
  field: string;
  choices: Array<{ id: string; label: string; phoneMasked?: string }>;
  source: { kind: 'membership_candidates' | 'catalog' | 'workspace_configuration';
    version: string; observedAt: string; truncated: boolean };
  selection: 'explicit_human_choice_required';
}

export interface AiQuoteGoalProjectionDraft {
  draftVersion: typeof AI_QUOTE_GOAL_DRAFT_VERSION;
  original: AiQuoteGoalOriginalDraft;
  goalHash: string;
  model: { taskId: string; runId: string; resultId: string; observedAt: string };
  status: 'requires_input' | 'unknown' | 'stale' | 'failed';
  candidates: AiQuoteGoalModelOutputDraft | null;
  missingFields: Array<{ field: string; reason: AiQuoteGoalIssueReasonDraft }>;
  choices: AiQuoteGoalChoiceGroupDraft[];
  configuration: null | { scope: { kind: 'workspace'; tenantId: string; workspaceId: string };
    audience: 'operator' | 'staff'; version: string; categoryCode: string; timeZone: string;
    pricingUnits: Array<typeof RENTAL_PRICING_UNIT_CODES[number]>; fulfillmentModes: RentalFulfillmentMode[];
    rates: 'not_observed_not_price_authority' };
  modelSemantics: 'unconfirmed_intent_candidates';
  businessSemantics: 'authorized_source_choices_not_selected';
  consistency: 'revalidated_reads_not_atomic_snapshot';
  nextAction: 'review_candidates' | 'read_original_result' | 'manual_review';
  automaticRetry: false;
  sideEffects: { quoteSaved: false; inventoryReserved: false; orderCreated: false; approvalGranted: false };
}

const fieldPattern = '^(?:customerType|customerName|customerId|items|start|end|fulfillmentMode|locationName|returnLocationName|locationId|returnLocationId|deliveryAddressId|items\\.(?:[0-9]|[1-4][0-9])(?:\\.(?:productName|quantity|pricingUnit|usageQuantity|itemGroupId))?)$';
const fieldExpression = new RegExp(fieldPattern, 'u');
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid = { type: 'string', format: 'uuid' };
const version = choice(AI_QUOTE_GOAL_DRAFT_VERSION);
const field = { ...text(100), pattern: fieldPattern };
const words = (max = 191): AiLeafSchemaDraft => ({ ...text(max),
  pattern: '^[^\\u0000-\\u001F\\u007F<>]+$' });
const goalInput = object({ kind: choice('quote_goal'), draftVersion: version,
  goalText: { ...text(AI_QUOTE_GOAL_LIMITS.goalCharacters), pattern: '\\S' } });
const original = object({ inputRef: uuid, revision: integer(1, 4294967294), contentHash: hash });
const conditions = object({ customerType: choice('personal', 'corporate'), customerName: words(),
  items: list(object({ productName: words(), quantity: integer(1, AI_QUOTE_GOAL_LIMITS.quantity),
    pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES), usageQuantity: { type: 'number', minimum: 0,
      maximum: AI_QUOTE_GOAL_LIMITS.usageQuantity } }, []), AI_QUOTE_GOAL_LIMITS.lines, 1),
  start: words(80), end: words(80), fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES),
  locationName: words(), returnLocationName: words() }, []);
const modelOutput = object({ kind: choice('quote_goal_candidates'), draftVersion: version, conditions,
  unresolvedFields: { ...list(field, AI_QUOTE_GOAL_LIMITS.fields), uniqueItems: true } });
const issueReasons = ['not_supplied', 'model_unresolved', 'human_choice_required',
  'unsupported_by_current_configuration', 'original_enterprise_flow_required',
  'not_observed_in_bounded_source'] as const;

export const AI_QUOTE_GOAL_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiQuoteGoalInputDraft: goalInput,
  AiQuoteGoalSourceDraft: object({ kind: choice('original_quote_goal'), draftVersion: version, original,
    input: goalInput, goalHash: hash, trust: choice('human_goal_not_business_fact_or_authority') }),
  AiQuoteGoalContextDraft: object({ kind: choice('quote_goal_context'), goalHash: hash,
    configuration: object({ scope: object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }),
      audience: choice('operator', 'staff'), observedAt: leafTime, sourceHash: hash, categoryCode: id(), configVersion: id(),
      timeZone: text(128), pricingUnits: { ...list(choice(...RENTAL_PRICING_UNIT_CODES), RENTAL_PRICING_UNIT_CODES.length), uniqueItems: true },
      fulfillmentModes: { ...list(choice(...RENTAL_FULFILLMENT_MODES), RENTAL_FULFILLMENT_MODES.length), uniqueItems: true },
      deliveryDestination: choice('customer_address', 'tenant_location'), capabilities: { ...list(id(), 100), uniqueItems: true } }),
    input: choice('unconfirmed_human_goal'), quotation: choice('not_created'), identitySelection: choice('explicit_human_choice_required') }),
  AiQuoteGoalModelOutputDraft: modelOutput,
  AiQuoteGoalProjectionDraft: object({ draftVersion: version, original, goalHash: hash,
    model: object({ taskId: id(), runId: id(), resultId: id(), observedAt: leafTime }),
    status: choice('requires_input', 'unknown', 'stale', 'failed'),
    candidates: { oneOf: [modelOutput, { type: 'null' }] },
    missingFields: list(object({ field, reason: choice(...issueReasons) }), AI_QUOTE_GOAL_LIMITS.fields),
    choices: list(object({ field, choices: list(object({ id: id(), label: words(),
      phoneMasked: { ...text(64, 0), pattern: '^(?:|[0-9]{0,3}\\*{3,}[0-9]{0,4})$' } }, ['id', 'label']), AI_QUOTE_GOAL_LIMITS.choices),
      source: object({ kind: choice('membership_candidates', 'catalog', 'workspace_configuration'),
        version: hash, observedAt: leafTime, truncated: { type: 'boolean' } }),
      selection: choice('explicit_human_choice_required') }), AI_QUOTE_GOAL_LIMITS.fields),
    configuration: { oneOf: [object({ scope: object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }),
      audience: choice('operator', 'staff'), version: hash, categoryCode: id(), timeZone: text(100),
      pricingUnits: { ...list(choice(...RENTAL_PRICING_UNIT_CODES), RENTAL_PRICING_UNIT_CODES.length), uniqueItems: true },
      fulfillmentModes: { ...list(choice(...RENTAL_FULFILLMENT_MODES), RENTAL_FULFILLMENT_MODES.length), uniqueItems: true },
      rates: choice('not_observed_not_price_authority') }), { type: 'null' }] },
    modelSemantics: choice('unconfirmed_intent_candidates'), businessSemantics: choice('authorized_source_choices_not_selected'),
    consistency: choice('revalidated_reads_not_atomic_snapshot'),
    nextAction: choice('review_candidates', 'read_original_result', 'manual_review'), automaticRetry: { type: 'boolean', const: false },
    sideEffects: object({ quoteSaved: { type: 'boolean', const: false }, inventoryReserved: { type: 'boolean', const: false },
      orderCreated: { type: 'boolean', const: false }, approvalGranted: { type: 'boolean', const: false } }) })
};

const closed = (value: unknown, keys: readonly string[], required: readonly string[] = keys): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key))
    && required.every(key => Object.prototype.hasOwnProperty.call(value, key));
};
const plainWords = (value: unknown, maximum = 191): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001F\u007F<>]/u.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const hashValue = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const uuidValue = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
const instant = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 20 && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  && Number.isFinite(Date.parse(value));
const integerWithin = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const fieldName = (value: unknown): value is string => typeof value === 'string' && fieldExpression.test(value);

export function validateAiQuoteGoalInputDraft(value: unknown): value is AiQuoteGoalInputDraft {
  return closed(value, ['kind', 'draftVersion', 'goalText']) && value.kind === 'quote_goal'
    && value.draftVersion === AI_QUOTE_GOAL_DRAFT_VERSION && typeof value.goalText === 'string'
    && value.goalText.trim().length > 0 && value.goalText.length <= AI_QUOTE_GOAL_LIMITS.goalCharacters;
}

function validOriginal(value: unknown): value is AiQuoteGoalOriginalDraft {
  return closed(value, ['inputRef', 'revision', 'contentHash']) && uuidValue(value.inputRef)
    && integerWithin(value.revision, 1, 4294967294) && hashValue(value.contentHash);
}

export function validateAiQuoteGoalSourceDraft(value: unknown): value is AiQuoteGoalSourceDraft {
  return closed(value, ['kind', 'draftVersion', 'original', 'input', 'goalHash', 'trust'])
    && value.kind === 'original_quote_goal' && value.draftVersion === AI_QUOTE_GOAL_DRAFT_VERSION
    && validOriginal(value.original) && validateAiQuoteGoalInputDraft(value.input)
    && hashValue(value.goalHash) && value.trust === 'human_goal_not_business_fact_or_authority';
}

export function validateAiQuoteGoalModelOutputDraft(value: unknown): value is AiQuoteGoalModelOutputDraft {
  if (!closed(value, ['kind', 'draftVersion', 'conditions', 'unresolvedFields'])
    || value.kind !== 'quote_goal_candidates' || value.draftVersion !== AI_QUOTE_GOAL_DRAFT_VERSION
    || !closed(value.conditions, ['customerType', 'customerName', 'items', 'start', 'end', 'fulfillmentMode', 'locationName', 'returnLocationName'], [])
    || !Array.isArray(value.unresolvedFields) || value.unresolvedFields.length > AI_QUOTE_GOAL_LIMITS.fields
    || !value.unresolvedFields.every(fieldName) || new Set(value.unresolvedFields).size !== value.unresolvedFields.length) return false;
  const row = value.conditions;
  if (value.unresolvedFields.some(field => {
    const match = /^items\.(\d+)(?:\.|$)/u.exec(field);
    return match && (!Array.isArray(row.items) || Number(match[1]) >= row.items.length);
  })) return false;
  if (row.customerType !== undefined && row.customerType !== 'personal' && row.customerType !== 'corporate'
    || row.fulfillmentMode !== undefined && !RENTAL_FULFILLMENT_MODES.includes(row.fulfillmentMode as RentalFulfillmentMode)) return false;
  for (const key of ['customerName', 'locationName', 'returnLocationName']) if (row[key] !== undefined && !plainWords(row[key])) return false;
  for (const key of ['start', 'end']) if (row[key] !== undefined && !plainWords(row[key], 80)) return false;
  if (row.items !== undefined) {
    if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > AI_QUOTE_GOAL_LIMITS.lines) return false;
    for (const item of row.items) {
      if (!closed(item, ['productName', 'quantity', 'pricingUnit', 'usageQuantity'], [])
        || item.productName !== undefined && !plainWords(item.productName)
        || item.quantity !== undefined && !integerWithin(item.quantity, 1, AI_QUOTE_GOAL_LIMITS.quantity)
        || item.pricingUnit !== undefined && !RENTAL_PRICING_UNIT_CODES.includes(item.pricingUnit as typeof RENTAL_PRICING_UNIT_CODES[number])
        || item.usageQuantity !== undefined && (typeof item.usageQuantity !== 'number' || !Number.isFinite(item.usageQuantity)
          || item.usageQuantity < 0 || item.usageQuantity > AI_QUOTE_GOAL_LIMITS.usageQuantity)) return false;
    }
  }
  return true;
}

export function validateAiQuoteGoalProjectionDraft(value: unknown): value is AiQuoteGoalProjectionDraft {
  if (!closed(value, ['draftVersion', 'original', 'goalHash', 'model', 'status', 'candidates', 'missingFields', 'choices',
    'configuration', 'modelSemantics', 'businessSemantics', 'consistency', 'nextAction', 'automaticRetry', 'sideEffects'])
    || value.draftVersion !== AI_QUOTE_GOAL_DRAFT_VERSION || !validOriginal(value.original) || !hashValue(value.goalHash)
    || !closed(value.model, ['taskId', 'runId', 'resultId', 'observedAt']) || !identifier(value.model.taskId)
    || !identifier(value.model.runId) || !identifier(value.model.resultId) || !instant(value.model.observedAt)
    || !['requires_input', 'unknown', 'stale', 'failed'].includes(value.status as string)
    || value.candidates !== null && !validateAiQuoteGoalModelOutputDraft(value.candidates)
    || !Array.isArray(value.missingFields) || value.missingFields.length > AI_QUOTE_GOAL_LIMITS.fields
    || !Array.isArray(value.choices) || value.choices.length > AI_QUOTE_GOAL_LIMITS.fields
    || value.modelSemantics !== 'unconfirmed_intent_candidates' || value.businessSemantics !== 'authorized_source_choices_not_selected'
    || value.consistency !== 'revalidated_reads_not_atomic_snapshot'
    || !['review_candidates', 'read_original_result', 'manual_review'].includes(value.nextAction as string)
    || value.automaticRetry !== false || !closed(value.sideEffects, ['quoteSaved', 'inventoryReserved', 'orderCreated', 'approvalGranted'])
    || Object.values(value.sideEffects).some(effect => effect !== false)) return false;
  if (value.missingFields.some(row => !closed(row, ['field', 'reason']) || !fieldName(row.field) || !issueReasons.includes(row.reason as AiQuoteGoalIssueReasonDraft))) return false;
  for (const group of value.choices) {
    if (!closed(group, ['field', 'choices', 'source', 'selection']) || !fieldName(group.field)
      || group.selection !== 'explicit_human_choice_required' || !Array.isArray(group.choices)
      || group.choices.length > AI_QUOTE_GOAL_LIMITS.choices || !closed(group.source, ['kind', 'version', 'observedAt', 'truncated'])
      || !['membership_candidates', 'catalog', 'workspace_configuration'].includes(group.source.kind as string)
      || !hashValue(group.source.version) || !instant(group.source.observedAt) || typeof group.source.truncated !== 'boolean') return false;
    if (group.choices.some(row => !closed(row, ['id', 'label', 'phoneMasked'], ['id', 'label']) || !identifier(row.id) || !plainWords(row.label)
      || row.phoneMasked !== undefined && (typeof row.phoneMasked !== 'string' || !/^(?:|[0-9]{0,3}\*{3,}[0-9]{0,4})$/u.test(row.phoneMasked)))) return false;
    if (new Set(group.choices.map(row => row.id)).size !== group.choices.length) return false;
  }
  if (value.configuration !== null) {
    const config = value.configuration;
    if (!closed(config, ['scope', 'audience', 'version', 'categoryCode', 'timeZone', 'pricingUnits', 'fulfillmentModes', 'rates'])
      || !closed(config.scope, ['kind', 'tenantId', 'workspaceId']) || config.scope.kind !== 'workspace'
      || !identifier(config.scope.tenantId) || !identifier(config.scope.workspaceId) || !['operator', 'staff'].includes(config.audience as string)
      || !hashValue(config.version) || !identifier(config.categoryCode) || !plainWords(config.timeZone, 100)
      || !Array.isArray(config.pricingUnits) || config.pricingUnits.length > RENTAL_PRICING_UNIT_CODES.length
      || !config.pricingUnits.every(unit => RENTAL_PRICING_UNIT_CODES.includes(unit)) || new Set(config.pricingUnits).size !== config.pricingUnits.length
      || !Array.isArray(config.fulfillmentModes) || config.fulfillmentModes.length > RENTAL_FULFILLMENT_MODES.length
      || !config.fulfillmentModes.every(mode => RENTAL_FULFILLMENT_MODES.includes(mode)) || new Set(config.fulfillmentModes).size !== config.fulfillmentModes.length
      || config.rates !== 'not_observed_not_price_authority') return false;
  }
  return value.status === 'requires_input'
    ? value.candidates !== null && value.configuration !== null && value.nextAction === 'review_candidates' && value.missingFields.length > 0
    : value.candidates === null && value.configuration === null && value.choices.length === 0 && value.missingFields.length === 0
      && value.nextAction === (value.status === 'unknown' ? 'read_original_result' : 'manual_review');
}
