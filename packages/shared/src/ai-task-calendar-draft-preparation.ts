/** Explicit linked calendar proposal preparation. References bind the original
 * task and one existing draft date; they grant neither calendar access nor Core
 * save/publication. An uncertain operation is observed by its original key. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
import { aiTaskCalendarDraftListResponse, AI_TASK_CALENDAR_DRAFT_SCHEMAS } from './ai-task-calendar-draft';

export const AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION = 'ain-task-calendar-preparation-1' as const;
export const AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP = {
  basePath: 'ai-native/task-calendar-drafts', preparation: 'preparation', previewPreparation: 'preview-preparation',
  prepare: 'prepare', preparationOperation: 'preparation-operation', source: 'source', entry: 'entry', entryOperation: 'entry-operation'
} as const;
export const AI_TASK_CALENDAR_DRAFT_PREPARATION_FIELDS = ['name', 'businessStatus'] as const;
const resource = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const id = resource.max(36), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^(?:(?:19|20|21)\d{2}|2200)-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) <= 2200;
});
const revision = z.number().int().min(0).max(4294967294);
const status = z.enum(['open', 'limited', 'closed', 'self_service']);
export const aiTaskCalendarDraftPreparationValues = z.object({ name: z.string().trim().min(1).max(120),
  businessStatus: status.optional() }).strict();
const original = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid() }).strict();
const scope = z.object({ kind: z.literal('workspace'), tenantId: resource, workspaceId: resource }).strict();
const target = z.object({ id: resource, year: z.number().int().min(1900).max(2200), version: resource,
  revision, date, status: z.literal('draft') }).strict();
const envelope = z.object({ contractVersion: z.literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION), taskId: id, runId: id,
  scope, original: original.extend({ contentHash: hash, sceneVersion: resource.max(64) }).strict(),
  observedAt: z.string().datetime({ offset: true }) }).strict();
const changes = z.array(z.union([
  z.object({ field: z.literal('name'), before: z.string().min(1).max(120), after: z.string().min(1).max(120) }).strict(),
  z.object({ field: z.literal('businessStatus'), before: status, after: status }).strict()
])).max(2);
export const aiTaskCalendarDraftPreparationInput = z.object({ taskId: id, date }).strict();
export const aiTaskCalendarDraftPreparationPreviewInput = aiTaskCalendarDraftPreparationInput.extend({
  targetId: resource, version: resource, revision, values: aiTaskCalendarDraftPreparationValues
}).strict();
export const aiTaskCalendarDraftPrepareInput = aiTaskCalendarDraftPreparationPreviewInput.extend({
  operationKey: z.string().uuid(), reviewHash: hash, expiresAt: z.string().datetime({ offset: true }),
  decision: z.literal('prepare_new_calendar_ai_proposal')
}).strict();
export const aiTaskCalendarDraftPreparationReference = z.object({ taskId: id, operationKey: z.string().uuid() }).strict();
export const aiTaskCalendarDraftPreparationResponse = envelope.extend({ date,
  targets: z.array(target.extend({ values: aiTaskCalendarDraftPreparationValues, sourceHash: hash }).strict()).max(20),
  hasMore: z.boolean(), coverage: z.literal('latest_20_draft_calendars_for_selected_date'),
  preparation: z.literal('new_linked_opening_request'), businessDraft: z.literal('not_created'), publication: z.literal('not_attempted')
}).strict();
export const aiTaskCalendarDraftPreparationPreviewResponse = envelope.extend({ target, values: aiTaskCalendarDraftPreparationValues,
  before: aiTaskCalendarDraftPreparationValues, changes, status: z.enum(['difference_ready', 'no_change']),
  materialHash: hash, reviewHash: hash, expiresAt: z.string().datetime({ offset: true }),
  preparation: z.literal('ai_proposal_only'), businessDraft: z.literal('not_created'), publication: z.literal('not_attempted')
}).strict();
const createdTask = z.object({ state: z.literal('observed'), taskId: id, runId: id }).strict();
export const aiTaskCalendarDraftSourceInput = z.object({ date }).strict();
export const aiTaskCalendarDraftEntryInput = z.object({ date, targetId: resource, version: resource, revision,
  operationKey: z.string().uuid(), decision: z.literal('create_original_calendar_task') }).strict();
export const aiTaskCalendarDraftEntryReference = z.object({ operationKey: z.string().uuid() }).strict();
export const aiTaskCalendarDraftSourceResponse = z.object({ contractVersion: z.literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION),
  scope, date, observedAt: z.string().datetime({ offset: true }),
  targets: z.array(target.extend({ values: aiTaskCalendarDraftPreparationValues, sourceHash: hash }).strict()).max(20),
  hasMore: z.boolean(), source: z.literal('original_draft_calendar_date'), task: z.literal('not_created') }).strict();
export const aiTaskCalendarDraftEntryResponse = z.object({ contractVersion: z.literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION),
  reference: aiTaskCalendarDraftEntryReference, scope, observedAt: z.string().datetime({ offset: true }),
  model: z.literal('not_called'), execution: z.literal('not_started'), retryable: z.literal(false), operation: z.union([
    z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict(),
    z.object({ state: z.literal('original_request_recorded'), original, target,
      task: z.union([createdTask, z.object({ state: z.literal('not_observed') }).strict()]) }).strict()
  ]) }).strict();
export const aiTaskCalendarDraftPreparationOperationResponse = z.object({
  contractVersion: z.literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION), reference: aiTaskCalendarDraftPreparationReference,
  scope, observedAt: z.string().datetime({ offset: true }), model: z.literal('not_called'), businessDraft: z.literal('not_created'),
  publication: z.literal('not_attempted'), retryable: z.literal(false), operation: z.union([
    z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict(),
    z.object({ state: z.literal('linked_request_recorded'), original,
      task: z.union([createdTask, z.object({ state: z.literal('not_observed') }).strict()]), proposal: z.literal('not_observed'),
      admission: z.enum(['not_started', 'unavailable', 'unknown']) }).strict(),
    z.object({ state: z.literal('ai_proposal_saved'), original, task: createdTask,
      proposal: aiTaskCalendarDraftListResponse.shape.items.element }).strict()
  ])
}).strict();
export type AiTaskCalendarDraftPreparationInput = z.infer<typeof aiTaskCalendarDraftPreparationInput>;
export type AiTaskCalendarDraftPreparationValues = z.infer<typeof aiTaskCalendarDraftPreparationValues>;
export type AiTaskCalendarDraftPreparationPreviewInput = z.infer<typeof aiTaskCalendarDraftPreparationPreviewInput>;
export type AiTaskCalendarDraftPrepareInput = z.infer<typeof aiTaskCalendarDraftPrepareInput>;
export type AiTaskCalendarDraftPreparationReference = z.infer<typeof aiTaskCalendarDraftPreparationReference>;
export type AiTaskCalendarDraftPreparationResponse = z.infer<typeof aiTaskCalendarDraftPreparationResponse>;
export type AiTaskCalendarDraftPreparationPreviewResponse = z.infer<typeof aiTaskCalendarDraftPreparationPreviewResponse>;
export type AiTaskCalendarDraftPreparationOperationResponse = z.infer<typeof aiTaskCalendarDraftPreparationOperationResponse>;
export type AiTaskCalendarDraftSourceInput = z.infer<typeof aiTaskCalendarDraftSourceInput>;
export type AiTaskCalendarDraftSourceResponse = z.infer<typeof aiTaskCalendarDraftSourceResponse>;
export type AiTaskCalendarDraftEntryInput = z.infer<typeof aiTaskCalendarDraftEntryInput>;
export type AiTaskCalendarDraftEntryReference = z.infer<typeof aiTaskCalendarDraftEntryReference>;
export type AiTaskCalendarDraftEntryResponse = z.infer<typeof aiTaskCalendarDraftEntryResponse>;

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({ type: 'object', properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false });
const literal = (value: string | boolean): Schema => ({ type: typeof value, enum: [value] });
const res: Schema = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const identifier = { ...res, maxLength: 36 }, fingerprint: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const dateSchema: Schema = { type: 'string', format: 'date', pattern: '^(?:(?:19|20|21)\\d{2}|2200)-\\d{2}-\\d{2}$' };
const time: Schema = { type: 'string', format: 'date-time' }, revisionSchema: Schema = { type: 'integer', minimum: 0, maximum: 4294967294 };
const statusSchema: Schema = { type: 'string', enum: ['open', 'limited', 'closed', 'self_service'] };
const nameSchema: Schema = { type: 'string', minLength: 1, maxLength: 120 };
const valuesSchema = object({ name: nameSchema, businessStatus: statusSchema }, ['businessStatus']);
const originalSchema = object({ draftVersion: literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' } });
const scopeSchema = object({ kind: literal('workspace'), tenantId: res, workspaceId: res });
const targetSchema = object({ id: res, year: { type: 'integer', minimum: 1900, maximum: 2200 }, version: res,
  revision: revisionSchema, date: dateSchema, status: literal('draft') });
const base = { contractVersion: literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION), taskId: identifier, runId: identifier,
  scope: scopeSchema, original: object({ draftVersion: literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' },
    contentHash: fingerprint, sceneVersion: { ...res, maxLength: 64 } }), observedAt: time };
const previewFields = { taskId: identifier, date: dateSchema, targetId: res, version: res, revision: revisionSchema, values: valuesSchema };
const referenceSchema = object({ taskId: identifier, operationKey: { type: 'string', format: 'uuid' } });
const createdSchema = object({ state: literal('observed'), taskId: identifier, runId: identifier });
const savedProposal = AI_TASK_CALENDAR_DRAFT_SCHEMAS.AiTaskCalendarDraftListResponse.properties?.items.items;
if (!savedProposal) throw Error('AI_CALENDAR_PROPOSAL_SCHEMA_UNAVAILABLE');
export const AI_TASK_CALENDAR_DRAFT_PREPARATION_SCHEMAS = {
  AiTaskCalendarDraftSourceInput: object({ date: dateSchema }),
  AiTaskCalendarDraftEntryInput: object({ date: dateSchema, targetId: res, version: res, revision: revisionSchema,
    operationKey: { type: 'string', format: 'uuid' }, decision: literal('create_original_calendar_task') }),
  AiTaskCalendarDraftEntryReference: object({ operationKey: { type: 'string', format: 'uuid' } }),
  AiTaskCalendarDraftSourceResponse: object({ contractVersion: literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION), scope: scopeSchema,
    date: dateSchema, observedAt: time, targets: { type: 'array', maxItems: 20, items: object({ id: res,
      year: { type: 'integer', minimum: 1900, maximum: 2200 }, version: res, revision: revisionSchema, date: dateSchema,
      status: literal('draft'), values: valuesSchema, sourceHash: fingerprint }) }, hasMore: { type: 'boolean' },
    source: literal('original_draft_calendar_date'), task: literal('not_created') }),
  AiTaskCalendarDraftEntryResponse: object({ contractVersion: literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION),
    reference: object({ operationKey: { type: 'string', format: 'uuid' } }), scope: scopeSchema, observedAt: time,
    model: literal('not_called'), execution: literal('not_started'), retryable: literal(false), operation: { oneOf: [
      object({ state: literal('not_observed'), retryable: literal(false) }), object({ state: literal('original_request_recorded'),
        original: originalSchema, target: targetSchema, task: { oneOf: [createdSchema, object({ state: literal('not_observed') })] } })
    ] } }),
  AiTaskCalendarDraftPreparationInput: object({ taskId: identifier, date: dateSchema }),
  AiTaskCalendarDraftPreparationPreviewInput: object(previewFields),
  AiTaskCalendarDraftPrepareInput: object({ ...previewFields, operationKey: { type: 'string', format: 'uuid' }, reviewHash: fingerprint,
    expiresAt: time, decision: literal('prepare_new_calendar_ai_proposal') }),
  AiTaskCalendarDraftPreparationReference: referenceSchema,
  AiTaskCalendarDraftPreparationResponse: object({ ...base, date: dateSchema,
    targets: { type: 'array', maxItems: 20, items: object({ id: res, year: { type: 'integer', minimum: 1900, maximum: 2200 }, version: res,
      revision: revisionSchema, date: dateSchema, status: literal('draft'), values: valuesSchema, sourceHash: fingerprint }) },
    hasMore: { type: 'boolean' }, coverage: literal('latest_20_draft_calendars_for_selected_date'),
    preparation: literal('new_linked_opening_request'), businessDraft: literal('not_created'), publication: literal('not_attempted') }),
  AiTaskCalendarDraftPreparationPreviewResponse: object({ ...base, target: targetSchema, values: valuesSchema, before: valuesSchema,
    changes: { type: 'array', maxItems: 2, items: { oneOf: [object({ field: literal('name'), before: nameSchema, after: nameSchema }),
      object({ field: literal('businessStatus'), before: statusSchema, after: statusSchema })] } }, status: { type: 'string', enum: ['difference_ready', 'no_change'] },
    materialHash: fingerprint, reviewHash: fingerprint, expiresAt: time, preparation: literal('ai_proposal_only'),
    businessDraft: literal('not_created'), publication: literal('not_attempted') }),
  AiTaskCalendarDraftPreparationOperationResponse: object({ contractVersion: literal(AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION),
    reference: referenceSchema, scope: scopeSchema, observedAt: time, model: literal('not_called'), businessDraft: literal('not_created'),
    publication: literal('not_attempted'), retryable: literal(false), operation: { oneOf: [
      object({ state: literal('not_observed'), retryable: literal(false) }),
      object({ state: literal('linked_request_recorded'), original: originalSchema,
        task: { oneOf: [createdSchema, object({ state: literal('not_observed') })] }, proposal: literal('not_observed'),
        admission: { type: 'string', enum: ['not_started', 'unavailable', 'unknown'] } }),
      object({ state: literal('ai_proposal_saved'), original: originalSchema, task: createdSchema, proposal: savedProposal })
    ] } })
} as const;
export const AI_TASK_CALENDAR_DRAFT_PREPARATION_CONTRACTS = {
  source: { request: 'AiTaskCalendarDraftSourceInput', response: 'AiTaskCalendarDraftSourceResponse' },
  entry: { request: 'AiTaskCalendarDraftEntryInput', response: 'AiTaskCalendarDraftEntryResponse' },
  entryOperation: { request: 'AiTaskCalendarDraftEntryReference', response: 'AiTaskCalendarDraftEntryResponse' },
  preparation: { request: 'AiTaskCalendarDraftPreparationInput', response: 'AiTaskCalendarDraftPreparationResponse' },
  previewPreparation: { request: 'AiTaskCalendarDraftPreparationPreviewInput', response: 'AiTaskCalendarDraftPreparationPreviewResponse' },
  prepare: { request: 'AiTaskCalendarDraftPrepareInput', response: 'AiTaskCalendarDraftPreparationOperationResponse' },
  preparationOperation: { request: 'AiTaskCalendarDraftPreparationReference', response: 'AiTaskCalendarDraftPreparationOperationResponse' }
} as const;
