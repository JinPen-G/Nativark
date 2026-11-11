/** Human rule-draft consumption of an original Task/Step/proposal. References
 * are server lookups, never scope/approval grants. No caller registrationRef,
 * configuration fields, publication, model dispatch or replacement operation. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';

export const AI_TASK_RULE_DRAFT_VERSION = 'ain-task-rule-draft-1' as const;
export const AI_TASK_RULE_DRAFT_HTTP = { basePath: 'ai-native/task-rule-drafts', list: 'list', review: 'review', save: 'save', operation: 'operation',
  preparation: 'preparation', previewPreparation: 'preparation/preview', prepare: 'preparation/prepare', preparationOperation: 'preparation/operation' } as const;
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

/** An explicit new rule-preparation request linked to the original diagnosis.
 * Only the original operation locator persists on the client. Preparing saves
 * an AI proposal; the separate bound draft save never becomes publication. */
export const AI_TASK_RULE_DRAFT_PREPARATION_VERSION = 'ain-task-rule-preparation-1' as const;
const preparationScope = z.object({ kind: z.literal('workspace'), tenantId: resource, workspaceId: resource }).strict();
const preparationOriginal = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid(),
  contentHash: hash, sceneVersion: resource }).strict();
const preparationValues = z.object({
  'fulfillment.pickupInspectionRequired': z.boolean(), 'fulfillment.returnInspectionRequired': z.boolean(),
  'fulfillment.evidenceRequired': z.boolean(), 'fulfillment.allowDifferentReturnLocation': z.boolean(),
  'damage.manualReviewRequired': z.boolean(), 'cancellation.weatherExceptionEnabled': z.boolean()
}).strict();
const preparationTarget = target.extend({ status: z.enum(['draft', 'pending', 'published', 'superseded', 'void']),
  values: preparationValues, sourceHash: hash }).strict();
const preparationBase = z.object({ contractVersion: z.literal(AI_TASK_RULE_DRAFT_PREPARATION_VERSION), taskId: id, runId: id,
  scope: preparationScope, original: preparationOriginal, observedAt: z.string().datetime({ offset: true }) }).strict();
export const aiTaskRuleDraftPreparationInput = aiTaskRuleDraftListInput;
export const aiTaskRuleDraftPreparationResponse = preparationBase.extend({ targets: z.array(preparationTarget).max(20), hasMore: z.boolean(),
  coverage: z.literal('latest_20_candidates'),
  preparation: z.literal('new_linked_opening_request'), businessDraft: z.literal('not_created'), publication: z.literal('not_attempted') }).strict();
export const aiTaskRuleDraftPreparationPreviewInput = aiTaskRuleDraftListInput.extend({ targetId: resource, version: resource, values: preparationValues }).strict();
export const aiTaskRuleDraftPreparationPreviewResponse = preparationBase.extend({ target, values: preparationValues,
  changes: changes.min(0), reviewHash: hash, expiresAt: z.string().datetime({ offset: true }),
  status: z.enum(['difference_ready', 'no_change']), preparation: z.literal('new_linked_opening_request'),
  persistence: z.literal('not_attempted'), businessDraft: z.literal('not_created'), publication: z.literal('not_attempted') }).strict();
export const aiTaskRuleDraftPrepareInput = aiTaskRuleDraftPreparationPreviewInput.extend({ operationKey: z.string().uuid(), reviewHash: hash,
  expiresAt: z.string().datetime({ offset: true }), decision: z.literal('prepare_new_rule_ai_proposal') }).strict();
export const aiTaskRuleDraftPreparationReference = aiTaskRuleDraftListInput.extend({ operationKey: z.string().uuid() }).strict();
const preparationRequest = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid() }).strict();
const preparationTask = z.object({ state: z.literal('observed'), taskId: id, runId: id }).strict();
const preparedProposal = z.object({ reference: aiTaskRuleDraftReference, target, changes,
  source: z.literal('original_saved_ai_proposal') }).strict();
export const aiTaskRuleDraftPreparationOperationResponse = z.object({ contractVersion: z.literal(AI_TASK_RULE_DRAFT_PREPARATION_VERSION),
  reference: aiTaskRuleDraftPreparationReference, scope: preparationScope, observedAt: z.string().datetime({ offset: true }),
  operation: z.discriminatedUnion('state', [
    z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict(),
    z.object({ state: z.literal('linked_request_recorded'), original: preparationRequest,
      task: z.union([preparationTask, z.object({ state: z.literal('not_observed') }).strict()]),
      proposal: z.literal('not_observed'), admission: z.enum(['not_started', 'unavailable', 'unknown']) }).strict(),
    z.object({ state: z.literal('ai_proposal_saved'), original: preparationRequest, task: preparationTask, proposal: preparedProposal }).strict()
  ]), model: z.literal('not_called'), businessDraft: z.literal('not_created'), publication: z.literal('not_attempted'),
  retryable: z.literal(false) }).strict().superRefine((value, context) => {
    if (value.operation.state === 'ai_proposal_saved' && (value.operation.proposal.reference.taskId !== value.operation.task.taskId
      || value.operation.proposal.reference.runId !== value.operation.task.runId || value.operation.task.taskId === value.reference.taskId)) {
      context.addIssue({ code: 'custom', message: 'Original rule preparation task mismatch' });
    }
  });
export type AiTaskRuleDraftPreparationInput = z.infer<typeof aiTaskRuleDraftPreparationInput>;
export type AiTaskRuleDraftPreparationResponse = z.infer<typeof aiTaskRuleDraftPreparationResponse>;
export type AiTaskRuleDraftPreparationPreviewInput = z.infer<typeof aiTaskRuleDraftPreparationPreviewInput>;
export type AiTaskRuleDraftPreparationPreviewResponse = z.infer<typeof aiTaskRuleDraftPreparationPreviewResponse>;
export type AiTaskRuleDraftPrepareInput = z.infer<typeof aiTaskRuleDraftPrepareInput>;
export type AiTaskRuleDraftPreparationReference = z.infer<typeof aiTaskRuleDraftPreparationReference>;
export type AiTaskRuleDraftPreparationOperationResponse = z.infer<typeof aiTaskRuleDraftPreparationOperationResponse>;

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
const preparationScopeSchema = object({ kind: literal('workspace'), tenantId: resourceSchema, workspaceId: resourceSchema });
const preparationOriginalSchema = object({ draftVersion: literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' },
  contentHash: fingerprint, sceneVersion: resourceSchema });
const preparationValuesSchema = object(Object.fromEntries(AI_TASK_RULE_DRAFT_FIELDS.map(field => [field, { type: 'boolean' }])));
const preparationReferenceSchema = object({ taskId: atom, operationKey: { type: 'string', format: 'uuid' } });
const preparationTaskSchema = object({ state: literal('observed'), taskId: atom, runId: atom });
const preparationRequestSchema = object({ draftVersion: literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' } });
const preparationBaseSchema = { contractVersion: literal(AI_TASK_RULE_DRAFT_PREPARATION_VERSION), taskId: atom, runId: atom,
  scope: preparationScopeSchema, original: preparationOriginalSchema, observedAt: time };
const preparationPreviewInputSchema = { taskId: atom, targetId: resourceSchema, version: resourceSchema, values: preparationValuesSchema };
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
    object({ state: literal('not_observed'), retryable: literal(false) })] } }),
  AiTaskRuleDraftPreparationInput: object({ taskId: atom }),
  AiTaskRuleDraftPreparationResponse: object({ ...preparationBaseSchema,
    targets: array(object({ ...targetSchema.properties!, status: { type: 'string', enum: ['draft', 'pending', 'published', 'superseded', 'void'] },
      values: preparationValuesSchema, sourceHash: fingerprint }), 20), hasMore: { type: 'boolean' }, coverage: literal('latest_20_candidates'), preparation: literal('new_linked_opening_request'),
    businessDraft: literal('not_created'), publication: literal('not_attempted') }),
  AiTaskRuleDraftPreparationPreviewInput: object(preparationPreviewInputSchema),
  AiTaskRuleDraftPreparationPreviewResponse: object({ ...preparationBaseSchema, target: targetSchema, values: preparationValuesSchema,
    changes: array(changeSchema, 6), reviewHash: fingerprint, expiresAt: time, status: { type: 'string', enum: ['difference_ready', 'no_change'] },
    preparation: literal('new_linked_opening_request'), persistence: literal('not_attempted'), businessDraft: literal('not_created'), publication: literal('not_attempted') }),
  AiTaskRuleDraftPrepareInput: object({ ...preparationPreviewInputSchema, operationKey: { type: 'string', format: 'uuid' }, reviewHash: fingerprint,
    expiresAt: time, decision: literal('prepare_new_rule_ai_proposal') }),
  AiTaskRuleDraftPreparationReference: preparationReferenceSchema,
  AiTaskRuleDraftPreparationOperationResponse: object({ contractVersion: literal(AI_TASK_RULE_DRAFT_PREPARATION_VERSION), reference: preparationReferenceSchema,
    scope: preparationScopeSchema, observedAt: time, operation: { oneOf: [object({ state: literal('not_observed'), retryable: literal(false) }),
      object({ state: literal('linked_request_recorded'), original: preparationRequestSchema,
        task: { oneOf: [preparationTaskSchema, object({ state: literal('not_observed') })] }, proposal: literal('not_observed'),
        admission: { type: 'string', enum: ['not_started', 'unavailable', 'unknown'] } }),
      object({ state: literal('ai_proposal_saved'), original: preparationRequestSchema, task: preparationTaskSchema,
        proposal: object({ reference: ref('AiTaskRuleDraftReference'), target: targetSchema, changes: array(changeSchema, 6, 1), source: literal('original_saved_ai_proposal') }) })] },
    model: literal('not_called'), businessDraft: literal('not_created'), publication: literal('not_attempted'), retryable: literal(false) })
} as const;
export const AI_TASK_RULE_DRAFT_CONTRACTS = {
  list: { request: 'AiTaskRuleDraftListInput', response: 'AiTaskRuleDraftListResponse' },
  review: { request: 'AiTaskRuleDraftReviewInput', response: 'AiTaskRuleDraftReviewResponse' },
  save: { request: 'AiTaskRuleDraftSaveInput', response: 'AiTaskRuleDraftOperationResponse' },
  operation: { request: 'AiTaskRuleDraftReference', response: 'AiTaskRuleDraftOperationResponse' },
  preparation: { request: 'AiTaskRuleDraftPreparationInput', response: 'AiTaskRuleDraftPreparationResponse' },
  previewPreparation: { request: 'AiTaskRuleDraftPreparationPreviewInput', response: 'AiTaskRuleDraftPreparationPreviewResponse' },
  prepare: { request: 'AiTaskRuleDraftPrepareInput', response: 'AiTaskRuleDraftPreparationOperationResponse' },
  preparationOperation: { request: 'AiTaskRuleDraftPreparationReference', response: 'AiTaskRuleDraftPreparationOperationResponse' }
} as const;
