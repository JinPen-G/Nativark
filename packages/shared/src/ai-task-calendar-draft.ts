/** Original Task/Run/Step calendar draft consumption. IDs locate server-owned
 * material; neither references nor review responses grant scope or publication. */
import { z } from 'zod';
import { aiTaskDraftRejectedOperation } from './ai-task-rule-draft';
export const AI_TASK_CALENDAR_DRAFT_VERSION = 'ain-task-calendar-draft-1' as const;
export const AI_TASK_CALENDAR_DRAFT_HTTP = { basePath: 'ai-native/task-calendar-drafts', list: 'list', review: 'review', save: 'save', operation: 'operation' } as const;
export const AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS = ['rental-os:calendar:view-history', 'rental-os:calendar:edit', 'rental-os:calendar:publish', 'rental-os:price:manage', 'rental-os:rules:manage'] as const;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), resource = id.max(191), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), revision = z.number().int().nonnegative().max(4294967295);
const status = z.enum(['open', 'limited', 'closed', 'self_service']);
export const aiTaskCalendarDraftListInput = z.object({ taskId: id }).strict();
export const aiTaskCalendarDraftReference = aiTaskCalendarDraftListInput.extend({ runId: id, stepId: id }).strict();
export const aiTaskCalendarDraftReviewInput = aiTaskCalendarDraftReference.extend({ overrideReason: z.string().trim().min(1).max(1000), overrideConfirmed: z.boolean() }).strict();
export const aiTaskCalendarDraftSaveInput = aiTaskCalendarDraftReviewInput.extend({ reviewHash: hash, decision: z.literal('save_original_business_draft') }).strict();
const window = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/u), end: z.string().regex(/^\d{2}:\d{2}$/u) }).strict();
const windows = z.array(window).max(100);
const snapshot = z.object({ dayType: z.enum(['workday', 'weekend', 'statutory_holiday', 'makeup_workday', 'tenant_special']), name: z.string().min(1).max(120), pricingMultiplier: z.number().finite(),
  closed: z.boolean(), businessStatus: status.optional(), source: z.enum(['week_rule','official_cn','tenant_override']),
  hours: z.object({ windows, pickup: windows.optional(), return: windows.optional(), delivery: windows.optional() }).strict().optional(), pricingOverrideRef: resource.optional() }).strict();
const target = z.object({ id: resource, year: z.number().int().min(1900).max(2200), version: resource, baseRevision: revision, date }).strict();
const changes = z.array(z.union([z.object({ field: z.literal('name'), before: z.string(), after: z.string() }).strict(),
  z.object({ field: z.literal('businessStatus'), before: status, after: status }).strict(),
  z.object({ field: z.literal('closed'), before: z.boolean(), after: z.boolean() }).strict()])).min(1).max(3);
const envelope = z.object({ contractVersion: z.literal(AI_TASK_CALENDAR_DRAFT_VERSION), taskId: id, observedAt: z.string().datetime({ offset: true }) }).strict();
export const aiTaskCalendarDraftListResponse = envelope.extend({ saveEnabled: z.boolean(), items: z.array(z.object({ reference: aiTaskCalendarDraftReference,
  target, changes, overrideRequired: z.boolean(), source: z.literal('original_saved_ai_proposal') }).strict()).max(20) }).strict();
export const aiTaskCalendarDraftReviewResponse = envelope.extend({ reference: aiTaskCalendarDraftReference, target, reviewHash: hash,
  overrideReason: z.string().min(1).max(1000), overrideConfirmed: z.boolean(), overrideRequired: z.boolean(), existingOverrideReason: z.string().min(1).max(1000).nullable(), before: snapshot, after: snapshot,
  persistence: z.literal('not_attempted'), publication: z.literal('not_attempted') }).strict();
export const aiTaskCalendarDraftOperationResponse = envelope.extend({ reference: aiTaskCalendarDraftReference, operation: z.union([
  z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict(),
  aiTaskDraftRejectedOperation,
  z.object({ state: z.literal('committed'), receiptId: resource, target, resultRevision: revision, before: snapshot, after: snapshot,
    overrideReason: z.string().min(1).max(1000), committedAt: z.string().datetime({ offset: true }), businessDraft: z.literal('saved_not_published'), publication: z.literal('not_attempted') }).strict()]) }).strict();
export type AiTaskCalendarDraftReference = z.infer<typeof aiTaskCalendarDraftReference>;
export type AiTaskCalendarDraftListInput = z.infer<typeof aiTaskCalendarDraftListInput>;
export type AiTaskCalendarDraftReviewInput = z.infer<typeof aiTaskCalendarDraftReviewInput>;
export type AiTaskCalendarDraftSaveInput = z.infer<typeof aiTaskCalendarDraftSaveInput>;
export type AiTaskCalendarDraftListResponse = z.infer<typeof aiTaskCalendarDraftListResponse>;
export type AiTaskCalendarDraftReviewResponse = z.infer<typeof aiTaskCalendarDraftReviewResponse>;
export type AiTaskCalendarDraftOperationResponse = z.infer<typeof aiTaskCalendarDraftOperationResponse>;
// The formal OpenAPI contract keeps the runtime shapes, bounds and optionality.
type JsonSchema = { type?: string; format?: string; pattern?: string; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; enum?: (string | boolean)[]; properties?: Record<string, JsonSchema>;
  required?: string[]; additionalProperties?: boolean; items?: JsonSchema; minItems?: number; maxItems?: number; oneOf?: JsonSchema[] };
const object = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({ type: 'object', properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false });
const array = (items: JsonSchema, maxItems: number, minItems = 0): JsonSchema => ({ type: 'array', items, maxItems, minItems });
const literal = (value: string | boolean): JsonSchema => ({ type: typeof value, enum: [value] });
const atom: JsonSchema = { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const res = { ...atom, maxLength: 191 }, reason = { type: 'string', minLength: 1, maxLength: 1000 };
const fingerprint = { type: 'string', pattern: '^[a-f0-9]{64}$' }, datetime = { type: 'string', format: 'date-time' };
const boolean = { type: 'boolean' }, rev = { type: 'integer', minimum: 0, maximum: 4294967295 };
const businessStatus = { type: 'string', enum: ['open', 'limited', 'closed', 'self_service'] };
const referenceSchema = object({ taskId: atom, runId: atom, stepId: atom });
const targetSchema = object({ id: res, year: { type: 'integer', minimum: 1900, maximum: 2200 }, version: res,
  baseRevision: rev, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } });
const windowsSchema = array(object({ start: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, end: { type: 'string', pattern: '^\\d{2}:\\d{2}$' } }), 100);
const snapshotSchema = object({ dayType: { type: 'string', enum: ['workday', 'weekend', 'statutory_holiday', 'makeup_workday', 'tenant_special'] },
  name: { type: 'string', minLength: 1, maxLength: 120 }, pricingMultiplier: { type: 'number' }, closed: boolean, businessStatus,
  source: { type: 'string', enum: ['week_rule', 'official_cn', 'tenant_override'] },
  hours: object({ windows: windowsSchema, pickup: windowsSchema, return: windowsSchema, delivery: windowsSchema }, ['pickup','return','delivery']),
  pricingOverrideRef: res }, ['businessStatus','hours','pricingOverrideRef']);
const changesSchema = array({ oneOf: [object({ field: literal('name'), before: { type: 'string' }, after: { type: 'string' } }),
  object({ field: literal('businessStatus'), before: businessStatus, after: businessStatus }),
  object({ field: literal('closed'), before: boolean, after: boolean })] }, 3, 1);
const base = { contractVersion: literal(AI_TASK_CALENDAR_DRAFT_VERSION), taskId: atom, observedAt: datetime };
const referenceFields = { taskId: atom, runId: atom, stepId: atom };
const reviewFields = { ...referenceFields, overrideReason: reason, overrideConfirmed: boolean };
export const AI_TASK_CALENDAR_DRAFT_SCHEMAS = {
  AiTaskCalendarDraftListInput: object({ taskId: atom }), AiTaskCalendarDraftReference: referenceSchema,
  AiTaskCalendarDraftReviewInput: object(reviewFields), AiTaskCalendarDraftSaveInput: object({ ...reviewFields, reviewHash: fingerprint, decision: literal('save_original_business_draft') }),
  AiTaskCalendarDraftListResponse: object({ ...base, saveEnabled: boolean, items: array(object({ reference: referenceSchema,
    target: targetSchema, changes: changesSchema, overrideRequired: boolean, source: literal('original_saved_ai_proposal') }), 20) }),
  AiTaskCalendarDraftReviewResponse: object({ ...base, reference: referenceSchema, target: targetSchema, reviewHash: fingerprint,
    overrideReason: reason, overrideConfirmed: boolean, overrideRequired: boolean, existingOverrideReason: { oneOf: [reason, { type: 'null' }] }, before: snapshotSchema, after: snapshotSchema,
    persistence: literal('not_attempted'), publication: literal('not_attempted') }),
  AiTaskCalendarDraftOperationResponse: object({ ...base, reference: referenceSchema, operation: { oneOf: [
    object({ state: literal('not_observed'), retryable: literal(false) }),
    object({ state: literal('rejected_no_commit'), receiptId: res, reason: literal('revision_conflict'), reviewHash: fingerprint,
      recordedAt: datetime, nextAction: literal('prepare_new_proposal'), retryable: literal(false),
      businessDraft: literal('not_written'), publication: literal('not_attempted') }), object({ state: literal('committed'), receiptId: res,
      target: targetSchema, resultRevision: rev, before: snapshotSchema, after: snapshotSchema, overrideReason: reason, committedAt: datetime,
      businessDraft: literal('saved_not_published'), publication: literal('not_attempted') })] } })
} as const;
export const AI_TASK_CALENDAR_DRAFT_CONTRACTS = { list: { request: 'AiTaskCalendarDraftListInput', response: 'AiTaskCalendarDraftListResponse' },
  review: { request: 'AiTaskCalendarDraftReviewInput', response: 'AiTaskCalendarDraftReviewResponse' },
  save: { request: 'AiTaskCalendarDraftSaveInput', response: 'AiTaskCalendarDraftOperationResponse' },
  operation: { request: 'AiTaskCalendarDraftReference', response: 'AiTaskCalendarDraftOperationResponse' } } as const;
