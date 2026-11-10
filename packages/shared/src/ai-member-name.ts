/** Human-only member-name consumption. Opaque hashes bind original facts;
 * no caller scope, approval, arbitrary fields, model/code payload or publication.
 * Stored locators contain ids only and never authorize an operation. */
import { z } from 'zod';
import { AI_TASK_STATUSES_DRAFT } from './ai-task-draft';

export const AI_MEMBER_NAME_VERSION = 'ain-member-name-human-1' as const;
export const AI_MEMBER_NAME_HTTP = { basePath: 'ai-native/member-name', availability: 'availability', discover: 'discover',
  inspect: 'inspect', prepare: 'prepare', read: 'read', execute: 'execute' } as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskId = id.max(36), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const name = z.string().trim().min(1).max(191).refine(value => Array.from(value).length <= 120);
const time = z.string().datetime({ offset: true });
export const aiMemberNameQuery = z.object({ limit: z.number().int().min(1).max(50), name: z.string().trim().min(1).max(191).optional(),
  cursor: id.optional() }).strict();
export const aiMemberNameLocator = z.object({ customerId: id, requestKey: id.max(128) }).strict();
export const aiMemberNameSelection = aiMemberNameLocator.extend({ query: aiMemberNameQuery, selectionHash: hash, name }).strict();
export const aiMemberNameIntent = aiMemberNameSelection.extend({ expiresAt: time }).strict();
export const aiMemberNameAvailabilityInput = z.object({}).strict();
export const aiMemberNameDiscoverInput = z.object({ query: aiMemberNameQuery }).strict();
export const aiMemberNamePrepareInput = z.object({ intent: aiMemberNameIntent, reviewHash: hash,
  decision: z.literal('prepare_original_member_name_review') }).strict();
export const aiMemberNameReadInput = z.object({ locator: aiMemberNameLocator }).strict();
export const aiMemberNameExecuteInput = aiMemberNameReadInput.extend({ confirmationHash: hash,
  decision: z.literal('approve_and_execute_original_member_name') }).strict();
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
export const aiMemberNameResponse = z.object({ contractVersion: z.literal(AI_MEMBER_NAME_VERSION), observedAt: time,
  newWorkEnabled: z.boolean(), phase: z.enum(['availability', 'candidates', 'difference_ready', 'no_change', 'not_observed',
    'prepared', 'task_created', 'waiting_confirmation', 'completed', 'task_read_unavailable', 'task_observed', 'difference_stale_not_saved']),
  scope: z.object({ kind: z.literal('tenant'), tenantId: id }).strict(), locator: aiMemberNameLocator.nullable(),
  candidates: z.array(candidate).max(50), truncated: z.boolean(), nextCursor: id.nullable(), selectionHash: hash.nullable(),
  review: z.object({ intent: aiMemberNameIntent, reviewHash: hash, change }).strict().nullable(), change: change.nullable(),
  task: task.nullable(), operation: operation.nullable(), retryable: z.literal(false),
  sensitiveFields: z.literal('use_original_verification_flow') }).strict();
export type AiMemberNameQuery = z.infer<typeof aiMemberNameQuery>;
export type AiMemberNameLocator = z.infer<typeof aiMemberNameLocator>;
export type AiMemberNameSelection = z.infer<typeof aiMemberNameSelection>;
export type AiMemberNameIntent = z.infer<typeof aiMemberNameIntent>;
export type AiMemberNamePrepareInput = z.infer<typeof aiMemberNamePrepareInput>;
export type AiMemberNameExecuteInput = z.infer<typeof aiMemberNameExecuteInput>;
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
const query = object({ limit: integer(1, 50), name: text(), cursor: identifier }, ['limit']);
const locator = object({ customerId: identifier, requestKey: { ...identifier, maxLength: 128 } });
const selection = { customerId: identifier, requestKey: { ...identifier, maxLength: 128 }, query, selectionHash: fingerprint, name: text(120) };
const intent = object({ ...selection, expiresAt: datetime });
const changed = object({ before: { type: 'string', maxLength: 191 }, after: text(120), baseRevision: integer(1, 4294967294), expiresAt: datetime,
  source: constant('original_core_profile'), sharing: constant('tenant_member_master_not_workspace_order_access') });
export const AI_MEMBER_NAME_SCHEMAS: Record<string, Schema> = {
  AiMemberNameAvailabilityInput: object({}), AiMemberNameQuery: query, AiMemberNameLocator: locator,
  AiMemberNameDiscoverInput: object({ query }), AiMemberNameSelection: object(selection), AiMemberNameIntent: intent,
  AiMemberNamePrepareInput: object({ intent, reviewHash: fingerprint, decision: constant('prepare_original_member_name_review') }),
  AiMemberNameReadInput: object({ locator }), AiMemberNameExecuteInput: object({ locator, confirmationHash: fingerprint,
    decision: constant('approve_and_execute_original_member_name') }),
  AiMemberNameResponse: object({ contractVersion: constant(AI_MEMBER_NAME_VERSION), observedAt: datetime, newWorkEnabled: bool,
    phase: choice('availability', 'candidates', 'difference_ready', 'no_change', 'not_observed', 'prepared', 'task_created',
      'waiting_confirmation', 'completed', 'task_read_unavailable', 'task_observed', 'difference_stale_not_saved'), scope: object({ kind: constant('tenant'), tenantId: identifier }),
    locator: nullable(locator), candidates: { type: 'array', maxItems: 50, items: object({ customerId: identifier, name: { type: 'string', maxLength: 191 },
      phoneMasked: { type: 'string', maxLength: 64 }, membershipStatus: choice('pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed') }) },
    truncated: bool, nextCursor: nullable(identifier), selectionHash: nullable(fingerprint),
    review: nullable(object({ intent, reviewHash: fingerprint, change: changed })), change: nullable(changed),
    task: nullable(object({ taskId: { ...identifier, maxLength: 36 }, runId: { ...identifier, maxLength: 36 }, status: nullable(choice(...AI_TASK_STATUSES_DRAFT)),
      revision: nullable(integer(1, 4294967294)), approval: choice('not_observed', 'approved', 'rejected'), businessOutcome: choice('not_observed', 'committed', 'unknown'),
      confirmationHash: nullable(fingerprint) })),
    operation: nullable(object({ receiptId: identifier, resultRevision: integer(1, 4294967294), resultName: text(120), committedAt: datetime,
      source: constant('original_core_operation_receipt') })), retryable: constant(false), sensitiveFields: constant('use_original_verification_flow') })
};
export const AI_MEMBER_NAME_CONTRACTS = { availability: 'AiMemberNameAvailabilityInput', discover: 'AiMemberNameDiscoverInput',
  inspect: 'AiMemberNameSelection', prepare: 'AiMemberNamePrepareInput', read: 'AiMemberNameReadInput', execute: 'AiMemberNameExecuteInput' } as const;
