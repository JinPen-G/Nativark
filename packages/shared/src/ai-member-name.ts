/** Human-only member-name consumption. Opaque hashes bind original facts;
 * no caller scope, approval, arbitrary fields, model/code payload or publication.
 * Stored locators contain ids only and never authorize an operation. */
import { z } from 'zod';
import { AI_TASK_STATUSES_DRAFT } from './ai-task-draft';

export const AI_MEMBER_NAME_VERSION = 'ain-member-name-human-1' as const;
export const AI_MEMBER_NAME_HTTP = { basePath: 'ai-native/member-name', availability: 'availability', discover: 'discover',
  inspect: 'inspect', prepare: 'prepare', read: 'read', execute: 'execute',
  inspectReconfirmation: 'reconfirmation/inspect', prepareReconfirmation: 'reconfirmation/prepare',
  readReconfirmation: 'reconfirmation/read', startReview: 'review/start' } as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskId = id.max(36), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const name = z.string().trim().min(1).max(191).refine(value => Array.from(value).length <= 120);
const time = z.string().datetime({ offset: true });
export const aiMemberNameQuery = z.object({ limit: z.number().int().min(1).max(50), name: z.string().trim().min(1).max(191).optional(),
  customerId: id.optional(), cursor: id.optional() }).strict();
export const aiMemberNameLocator = z.object({ customerId: id, requestKey: id.max(128), kind: z.literal('reconfirmed').optional() }).strict();
export const aiMemberNameSelection = aiMemberNameLocator.extend({ query: aiMemberNameQuery, selectionHash: hash, name }).strict();
export const aiMemberNameIntent = aiMemberNameSelection.extend({ expiresAt: time }).strict();
export const aiMemberNameAvailabilityInput = z.object({}).strict();
export const aiMemberNameDiscoverInput = z.object({ query: aiMemberNameQuery }).strict();
export const aiMemberNamePrepareInput = z.object({ intent: aiMemberNameIntent, reviewHash: hash,
  decision: z.literal('prepare_original_member_name_review') }).strict();
export const aiMemberNameReadInput = z.object({ locator: aiMemberNameLocator }).strict();
export const aiMemberNameExecuteInput = aiMemberNameReadInput.extend({ confirmationHash: hash,
  decision: z.literal('approve_and_execute_original_member_name') }).strict();
export const aiMemberNameReconfirmationInspectInput = aiMemberNameReadInput.extend({ name }).strict();
export const aiMemberNameReconfirmationPrepareInput = aiMemberNameReconfirmationInspectInput.extend({ expiresAt: time, reviewHash: hash,
  decision: z.literal('prepare_reconfirmed_member_name_change') }).strict();
export const aiMemberNameStartReviewInput = aiMemberNameReadInput.extend({ decision: z.literal('start_original_member_name_review') }).strict();
const candidate = z.object({ customerId: id, name: z.string().max(191), phoneMasked: z.string().max(64),
  membershipStatus: z.enum(['pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed']) }).strict();
const change = z.object({ before: z.string().max(191), after: name, baseRevision: z.number().int().positive().max(4294967294),
  expiresAt: time, source: z.literal('original_core_profile'),
  sharing: z.literal('tenant_member_master_not_workspace_order_access') }).strict();
const operation = z.object({ receiptId: id, resultRevision: z.number().int().positive().max(4294967294), resultName: name,
  committedAt: time, source: z.literal('original_core_operation_receipt') }).strict();
const task = z.object({ taskId, runId: taskId, status: z.enum(AI_TASK_STATUSES_DRAFT).nullable(),
  revision: z.number().int().positive().max(4294967294).nullable(), approval: z.enum(['not_observed', 'approved', 'rejected']),
  businessOutcome: z.enum(['not_observed', 'committed', 'unknown']), confirmationHash: hash.nullable() }).strict();
const reconfirmation = z.object({ originalLocator: aiMemberNameLocator, newLocator: aiMemberNameLocator.nullable(),
  review: z.object({ name, expiresAt: time, reviewHash: hash, previous: change, current: change,
    originalBaseMatches: z.boolean() }).strict().nullable(),
  closure: z.object({ taskId, runId: taskId, taskRevision: z.number().int().positive().max(4294967294),
    state: z.literal('closed_no_business_submission') }).strict().nullable(),
  preparation: z.enum(['not_attempted', 'prepared', 'not_observed']),
  approval: z.literal('fresh_proposal_and_approval_required'), automaticRetry: z.literal(false) }).strict();
export const aiMemberNameResponse = z.object({ contractVersion: z.literal(AI_MEMBER_NAME_VERSION), observedAt: time,
  newWorkEnabled: z.boolean(), phase: z.enum(['availability', 'candidates', 'difference_ready', 'no_change', 'not_observed',
    'prepared', 'task_created', 'waiting_confirmation', 'completed', 'task_read_unavailable', 'task_observed', 'difference_stale_not_saved',
    'reconfirmation_difference_ready']),
  scope: z.object({ kind: z.literal('tenant'), tenantId: id }).strict(), locator: aiMemberNameLocator.nullable(),
  candidates: z.array(candidate).max(50), truncated: z.boolean(), nextCursor: id.nullable(), selectionHash: hash.nullable(),
  review: z.object({ intent: aiMemberNameIntent, reviewHash: hash, change }).strict().nullable(), change: change.nullable(),
  task: task.nullable(), operation: operation.nullable(), retryable: z.literal(false),
  reconfirmation: reconfirmation.optional(), sensitiveFields: z.literal('use_original_verification_flow') }).strict();
export type AiMemberNameQuery = z.infer<typeof aiMemberNameQuery>;
export type AiMemberNameLocator = z.infer<typeof aiMemberNameLocator>;
export type AiMemberNameSelection = z.infer<typeof aiMemberNameSelection>;
export type AiMemberNameIntent = z.infer<typeof aiMemberNameIntent>;
export type AiMemberNamePrepareInput = z.infer<typeof aiMemberNamePrepareInput>;
export type AiMemberNameExecuteInput = z.infer<typeof aiMemberNameExecuteInput>;
export type AiMemberNameReconfirmationInspectInput = z.infer<typeof aiMemberNameReconfirmationInspectInput>;
export type AiMemberNameReconfirmationPrepareInput = z.infer<typeof aiMemberNameReconfirmationPrepareInput>;
export type AiMemberNameStartReviewInput = z.infer<typeof aiMemberNameStartReviewInput>;
export type AiMemberNameResponse = z.infer<typeof aiMemberNameResponse>;

type Schema = { type?: string; $ref?: string; enum?: (string | number | boolean | null)[]; format?: string; nullable?: boolean;
  minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number; properties?: Record<string, Schema>;
  required?: string[]; additionalProperties?: boolean; items?: Schema; maxItems?: number };
const text = (maxLength = 191): Schema => ({ type: 'string', minLength: 1, maxLength });
const identifier: Schema = { ...text(), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const fingerprint: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' }, datetime: Schema = { type: 'string', format: 'date-time' };
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum });
const bool: Schema = { type: 'boolean' }, constant = (value: string | boolean): Schema => ({ type: typeof value, enum: [value] });
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const query = object({ limit: integer(1, 50), name: text(), customerId: identifier, cursor: identifier }, ['limit']);
const locator = object({ customerId: identifier, requestKey: { ...identifier, maxLength: 128 }, kind: constant('reconfirmed') }, ['customerId', 'requestKey']);
const selection = { customerId: identifier, requestKey: { ...identifier, maxLength: 128 }, query, selectionHash: fingerprint, name: text(120) };
const intent = object({ ...selection, expiresAt: datetime });
const changed = object({ before: { type: 'string', maxLength: 191 }, after: text(120), baseRevision: integer(1, 4294967294), expiresAt: datetime,
  source: constant('original_core_profile'), sharing: constant('tenant_member_master_not_workspace_order_access') });
const reconfirmationSchema = object({ originalLocator: locator, newLocator: nullable(locator),
  review: nullable(object({ name: text(120), expiresAt: datetime, reviewHash: fingerprint, previous: changed, current: changed, originalBaseMatches: bool })),
  closure: nullable(object({ taskId: { ...identifier, maxLength: 36 }, runId: { ...identifier, maxLength: 36 }, taskRevision: integer(1, 4294967294),
    state: constant('closed_no_business_submission') })), preparation: choice('not_attempted', 'prepared', 'not_observed'),
  approval: constant('fresh_proposal_and_approval_required'), automaticRetry: constant(false) });
export const AI_MEMBER_NAME_SCHEMAS: Record<string, Schema> = {
  AiMemberNameAvailabilityInput: object({}), AiMemberNameQuery: query, AiMemberNameLocator: locator,
  AiMemberNameDiscoverInput: object({ query }), AiMemberNameSelection: object(selection), AiMemberNameIntent: intent,
  AiMemberNamePrepareInput: object({ intent, reviewHash: fingerprint, decision: constant('prepare_original_member_name_review') }),
  AiMemberNameReadInput: object({ locator }), AiMemberNameExecuteInput: object({ locator, confirmationHash: fingerprint,
    decision: constant('approve_and_execute_original_member_name') }),
  AiMemberNameReconfirmationInspectInput: object({ locator, name: text(120) }),
  AiMemberNameReconfirmationPrepareInput: object({ locator, name: text(120), expiresAt: datetime, reviewHash: fingerprint,
    decision: constant('prepare_reconfirmed_member_name_change') }),
  AiMemberNameStartReviewInput: object({ locator, decision: constant('start_original_member_name_review') }),
  AiMemberNameResponse: object({ contractVersion: constant(AI_MEMBER_NAME_VERSION), observedAt: datetime, newWorkEnabled: bool,
    phase: choice('availability', 'candidates', 'difference_ready', 'no_change', 'not_observed', 'prepared', 'task_created',
      'waiting_confirmation', 'completed', 'task_read_unavailable', 'task_observed', 'difference_stale_not_saved', 'reconfirmation_difference_ready'), scope: object({ kind: constant('tenant'), tenantId: identifier }),
    locator: nullable(locator), candidates: { type: 'array', maxItems: 50, items: object({ customerId: identifier, name: { type: 'string', maxLength: 191 },
      phoneMasked: { type: 'string', maxLength: 64 }, membershipStatus: choice('pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed') }) },
    truncated: bool, nextCursor: nullable(identifier), selectionHash: nullable(fingerprint),
    review: nullable(object({ intent, reviewHash: fingerprint, change: changed })), change: nullable(changed),
    task: nullable(object({ taskId: { ...identifier, maxLength: 36 }, runId: { ...identifier, maxLength: 36 }, status: nullable(choice(...AI_TASK_STATUSES_DRAFT)),
      revision: nullable(integer(1, 4294967294)), approval: choice('not_observed', 'approved', 'rejected'), businessOutcome: choice('not_observed', 'committed', 'unknown'),
      confirmationHash: nullable(fingerprint) })),
    operation: nullable(object({ receiptId: identifier, resultRevision: integer(1, 4294967294), resultName: text(120), committedAt: datetime,
      source: constant('original_core_operation_receipt') })), retryable: constant(false), reconfirmation: reconfirmationSchema,
    sensitiveFields: constant('use_original_verification_flow') }, ['contractVersion', 'observedAt', 'newWorkEnabled', 'phase', 'scope', 'locator',
      'candidates', 'truncated', 'nextCursor', 'selectionHash', 'review', 'change', 'task', 'operation', 'retryable', 'sensitiveFields'])
};
export const AI_MEMBER_NAME_CONTRACTS = { availability: 'AiMemberNameAvailabilityInput', discover: 'AiMemberNameDiscoverInput',
  inspect: 'AiMemberNameSelection', prepare: 'AiMemberNamePrepareInput', read: 'AiMemberNameReadInput', execute: 'AiMemberNameExecuteInput',
  inspectReconfirmation: 'AiMemberNameReconfirmationInspectInput', prepareReconfirmation: 'AiMemberNameReconfirmationPrepareInput',
  readReconfirmation: 'AiMemberNameReadInput', startReview: 'AiMemberNameStartReviewInput' } as const;
