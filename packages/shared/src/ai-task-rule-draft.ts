/** Human rule-draft consumption of an original Task/Step/proposal. References
 * are server lookups, never scope/approval grants. No caller registrationRef,
 * configuration fields, publication, model dispatch or replacement operation. */
import { z } from 'zod';

export const AI_TASK_RULE_DRAFT_VERSION = 'ain-task-rule-draft-1' as const;
export const AI_TASK_RULE_DRAFT_HTTP = { basePath: 'ai-native/task-rule-drafts', list: 'list', review: 'review', save: 'save', operation: 'operation' } as const;
export const AI_TASK_RULE_DRAFT_READ_PERMISSIONS = ['rental-os:rules:manage', 'rental-os:rules:publish', 'rental-os:price:manage'] as const;
export const AI_TASK_RULE_DRAFT_FIELDS = ['fulfillment.pickupInspectionRequired', 'fulfillment.returnInspectionRequired', 'fulfillment.evidenceRequired',
  'fulfillment.allowDifferentReturnLocation', 'damage.manualReviewRequired', 'cancellation.weatherExceptionEnabled'] as const;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const resource = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const aiTaskRuleDraftListInput = z.object({ taskId: id }).strict();
export const aiTaskRuleDraftReference = aiTaskRuleDraftListInput.extend({ runId: id, stepId: id }).strict();
export const aiTaskRuleDraftReviewInput = aiTaskRuleDraftReference.extend({ changeReason: z.string().trim().min(1).max(500) }).strict();
export const aiTaskRuleDraftSaveInput = aiTaskRuleDraftReviewInput.extend({ reviewHash: hash, decision: z.literal('save_original_business_draft') }).strict();
const changes = z.array(z.object({ field: z.enum(AI_TASK_RULE_DRAFT_FIELDS), before: z.boolean(), after: z.boolean() }).strict()).min(1).max(6);
const normalizedValue = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.array(z.string().max(191)).max(100)]);
const normalizations = z.array(z.object({ field: z.enum(['qualification.documentTypes', 'qualification.minimumValidityDays']),
  before: normalizedValue, after: normalizedValue, source: z.literal('original_core_normalization') }).strict()).max(2);
const target = z.object({ id: resource, version: resource }).strict();
const envelope = z.object({ contractVersion: z.literal(AI_TASK_RULE_DRAFT_VERSION), taskId: id,
  observedAt: z.string().datetime({ offset: true }) }).strict();
export const aiTaskRuleDraftListResponse = envelope.extend({ saveEnabled: z.boolean(), items: z.array(z.object({ reference: aiTaskRuleDraftReference,
  target, changes, source: z.literal('original_saved_ai_proposal') }).strict()).max(20) }).strict();
export const aiTaskRuleDraftReviewResponse = envelope.extend({ reference: aiTaskRuleDraftReference, target,
  reviewHash: hash, changeReason: z.string().min(1).max(500), changes, normalizations, resultVersion: resource,
  mode: z.enum(['edit_original_draft', 'restore_to_new_draft']), publication: z.literal('not_attempted') }).strict();
const committed = z.object({ state: z.literal('committed'), receiptId: resource, source: target,
  draft: target.extend({ mode: z.enum(['restored_new_draft', 'updated_original_draft']) }).strict(), changes, normalizations,
  committedAt: z.string().datetime({ offset: true }), publication: z.literal('not_performed_by_operation') }).strict();
export const aiTaskRuleDraftOperationResponse = envelope.extend({ reference: aiTaskRuleDraftReference,
  operation: z.union([committed, z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict()]) }).strict();
export type AiTaskRuleDraftReference = z.infer<typeof aiTaskRuleDraftReference>;
export type AiTaskRuleDraftListInput = z.infer<typeof aiTaskRuleDraftListInput>;
export type AiTaskRuleDraftReviewInput = z.infer<typeof aiTaskRuleDraftReviewInput>;
export type AiTaskRuleDraftSaveInput = z.infer<typeof aiTaskRuleDraftSaveInput>;
export type AiTaskRuleDraftListResponse = z.infer<typeof aiTaskRuleDraftListResponse>;
export type AiTaskRuleDraftReviewResponse = z.infer<typeof aiTaskRuleDraftReviewResponse>;
export type AiTaskRuleDraftOperationResponse = z.infer<typeof aiTaskRuleDraftOperationResponse>;

// OpenAPI uses the same closed shape/caps and formal package export as clients.
const atom = { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const resourceSchema = { ...atom, maxLength: 191 };
const fingerprint = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const literal = (value: string | boolean) => ({ type: typeof value, enum: [value] });
type RuleDraftJsonSchema = { type?: string; $ref?: string; format?: string; enum?: (string | number | boolean | null)[];
  minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number;
  properties?: Record<string, RuleDraftJsonSchema>; required?: string[]; additionalProperties?: boolean;
  items?: RuleDraftJsonSchema; minItems?: number; maxItems?: number; oneOf?: RuleDraftJsonSchema[] };
const object = (properties: Record<string, RuleDraftJsonSchema>): RuleDraftJsonSchema =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: RuleDraftJsonSchema, maxItems: number, minItems = 0): RuleDraftJsonSchema => ({ type: 'array', items, minItems, maxItems });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const reference = { taskId: atom, runId: atom, stepId: atom };
const reason = { type: 'string', minLength: 1, maxLength: 500 };
const time = { type: 'string', format: 'date-time' };
const base = { contractVersion: literal(AI_TASK_RULE_DRAFT_VERSION), taskId: atom, observedAt: time };
const changeSchema = object({ field: { type: 'string', enum: [...AI_TASK_RULE_DRAFT_FIELDS] }, before: { type: 'boolean' }, after: { type: 'boolean' } });
const valueSchema = { oneOf: [{ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, array({ type: 'string', maxLength: 191 }, 100)] };
const normalizedSchema = object({ field: { type: 'string', enum: ['qualification.documentTypes', 'qualification.minimumValidityDays'] },
  before: valueSchema, after: valueSchema, source: literal('original_core_normalization') });
const targetSchema = object({ id: resourceSchema, version: resourceSchema });
export const AI_TASK_RULE_DRAFT_SCHEMAS = {
  AiTaskRuleDraftReference: object(reference), AiTaskRuleDraftListInput: object({ taskId: atom }),
  AiTaskRuleDraftReviewInput: object({ ...reference, changeReason: reason }),
  AiTaskRuleDraftSaveInput: object({ ...reference, changeReason: reason, reviewHash: fingerprint, decision: literal('save_original_business_draft') }),
  AiTaskRuleDraftListResponse: object({ ...base, saveEnabled: { type: 'boolean' }, items: array(object({ reference: ref('AiTaskRuleDraftReference'),
    target: targetSchema, changes: array(changeSchema, 6, 1), source: literal('original_saved_ai_proposal') }), 20) }),
  AiTaskRuleDraftReviewResponse: object({ ...base, reference: ref('AiTaskRuleDraftReference'), target: targetSchema, reviewHash: fingerprint,
    changeReason: reason, changes: array(changeSchema, 6, 1), normalizations: array(normalizedSchema, 2), resultVersion: resourceSchema,
    mode: { type: 'string', enum: ['edit_original_draft', 'restore_to_new_draft'] }, publication: literal('not_attempted') }),
  AiTaskRuleDraftOperationResponse: object({ ...base, reference: ref('AiTaskRuleDraftReference'), operation: { oneOf: [
    object({ state: literal('committed'), receiptId: resourceSchema, source: targetSchema,
      draft: object({ id: resourceSchema, version: resourceSchema, mode: { type: 'string', enum: ['restored_new_draft', 'updated_original_draft'] } }),
      changes: array(changeSchema, 6, 1), normalizations: array(normalizedSchema, 2), committedAt: time, publication: literal('not_performed_by_operation') }),
    object({ state: literal('not_observed'), retryable: literal(false) })] } })
} as const;
export const AI_TASK_RULE_DRAFT_CONTRACTS = {
  list: { request: 'AiTaskRuleDraftListInput', response: 'AiTaskRuleDraftListResponse' },
  review: { request: 'AiTaskRuleDraftReviewInput', response: 'AiTaskRuleDraftReviewResponse' },
  save: { request: 'AiTaskRuleDraftSaveInput', response: 'AiTaskRuleDraftOperationResponse' },
  operation: { request: 'AiTaskRuleDraftReference', response: 'AiTaskRuleDraftOperationResponse' }
} as const;
