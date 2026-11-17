/** Original unsent notification draft transport. The registered Action binds
 * one explicit save; it grants no sending, retry or provider refresh. Only
 * masked original material crosses this response boundary. */
import { z } from 'zod';
import { AI_REGISTERED_ENTRY_ACTION_HTTP, aiRegisteredEntryActionSchema } from './ai-registered-entry-action';

export const AI_ENTRY_NOTIFICATION_DRAFT_VERSION = 'ain-entry-notification-draft-1' as const;
export const AI_ENTRY_NOTIFICATION_DRAFT_HTTP = {
  basePath: `${AI_REGISTERED_ENTRY_ACTION_HTTP.operatorBasePath}/notification-drafts`,
  prepare: 'prepare', save: 'save', read: 'read',
} as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().max(40).datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
const variables = z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/u), scalar).refine(value => Object.keys(value).length <= 64);
const scope = z.object({ tenantId: id, workspaceId: id }).strict();
export const aiEntryNotificationDraftPrepareSchema = z.object({ operationKey: id.max(128), customerId: id,
  templateId: id, templateVersion: id, variables }).strict();
export const aiEntryNotificationDraftSaveCommandSchema = aiEntryNotificationDraftPrepareSchema.extend({ reviewHash: hash,
  expiresAt: timestamp, decision: z.literal('save_unsent_notification_draft') }).strict();
export const aiEntryNotificationDraftSaveSchema = z.object({ action: aiRegisteredEntryActionSchema,
  command: aiEntryNotificationDraftSaveCommandSchema }).strict().superRefine((value, context) => {
  if (value.action.actionCode !== 'CREATE_NOTIFICATION_DRAFT' || value.action.audience !== 'operations'
    || value.action.surface !== 'tenant_admin' || value.action.expiresAt !== value.command.expiresAt)
    context.addIssue({ code: 'custom', message: 'The original draft-save Action is required' });
});
export const aiEntryNotificationDraftReadSchema = z.object({ operationKey: id.max(128) }).strict();
export const aiEntryNotificationDraftResourceSchema = z.object({ draftId: z.string().regex(/^notification-draft-[a-f0-9]{64}$/u) }).strict();
const materialFields = {
  version: z.literal('rental-notification-draft-1'), id: z.string().regex(/^notification-draft-[a-f0-9]{64}$/u),
  key: hash, actorId: id, scope, customerId: id, customerVersion: timestamp,
  templateId: id, templateVersion: id, eventCode: id, channel: z.enum(['sms', 'email', 'app_push', 'wechat']),
  commandHash: hash, inputHash: hash, templateHash: hash, configurationHash: hash, contentHash: hash,
  provider: z.literal('not_dispatched'), attempts: z.literal(0),
};
export const aiEntryNotificationDraftIntactMaterialSchema = z.object({ ...materialFields,
  recipient: z.string().min(1).max(191), renderedTitle: z.string().max(191), renderedBody: z.string().max(32768),
  variables: z.record(z.string().regex(/^[A-Za-z0-9_]{1,64}$/u), z.union([z.literal('[已加密保留]'), z.literal(''), z.null()]))
    .refine(value => Object.keys(value).length <= 64),
  status: z.enum(['prepared', 'draft']), createdAt: timestamp.nullable(), provider: z.literal('not_dispatched'), attempts: z.literal(0),
}).strict().superRefine((value, context) => {
  if (value.id !== `notification-draft-${value.key}` || (value.status === 'prepared' ? value.createdAt !== null : value.createdAt === null))
    context.addIssue({ code: 'custom', message: 'Original notification draft receipt binding mismatch' });
});
export const aiEntryNotificationDraftErasedMaterialSchema = z.object({ ...materialFields,
  recipient: z.null(), renderedTitle: z.null(), renderedBody: z.null(), variables: z.null(),
  status: z.literal('draft'), createdAt: timestamp,
  bodyRetention: z.object({ state: z.literal('erased'), receiptId: hash,
    policyVersion: z.literal('ai-retention-20261015-1'), erasedAt: timestamp, erasedRevision: z.literal(2) }).strict(),
}).strict().superRefine((value, context) => {
  if (value.id !== `notification-draft-${value.key}` || Date.parse(value.bodyRetention.erasedAt) < Date.parse(value.createdAt) + 30 * 86400000)
    context.addIssue({ code: 'custom', message: 'Original draft erasure basis is invalid' });
});
export const aiEntryNotificationDraftMaterialSchema = z.union([
  aiEntryNotificationDraftIntactMaterialSchema, aiEntryNotificationDraftErasedMaterialSchema,
]);
const common = { contractVersion: z.literal(AI_ENTRY_NOTIFICATION_DRAFT_VERSION), operationKey: id.max(128),
  scope: scope.extend({ kind: z.literal('workspace') }).strict(), observedAt: timestamp,
  automaticRetry: z.literal(false), dispatch: z.literal('not_dispatched') };
export const aiEntryNotificationDraftResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...common, state: z.literal('prepared'), material: aiEntryNotificationDraftIntactMaterialSchema,
    action: aiRegisteredEntryActionSchema, reviewHash: hash, expiresAt: timestamp,
    persistence: z.literal('not_saved'), execution: z.literal('not_attempted'),
    nextAction: z.literal('explicit_save_or_original_notification_page') }).strict(),
  z.object({ ...common, state: z.literal('saved'), draft: aiEntryNotificationDraftMaterialSchema, action: z.null(),
    persistence: z.literal('draft_saved'), execution: z.literal('not_sent'), nextAction: z.literal('read_original_notification_draft') }).strict(),
  z.object({ ...common, state: z.literal('unknown'), draft: z.null(), action: z.null(),
    persistence: z.literal('not_attested'), execution: z.literal('not_attested'), nextAction: z.literal('read_original_notification_draft') }).strict(),
]).superRefine((value, context) => {
  const material = value.state === 'prepared' ? value.material : value.state === 'saved' ? value.draft : null;
  if (material && (material.scope.tenantId !== value.scope.tenantId || material.scope.workspaceId !== value.scope.workspaceId
    || material.status !== (value.state === 'prepared' ? 'prepared' : 'draft')))
    context.addIssue({ code: 'custom', message: 'Original draft response scope or state mismatch' });
  if (value.state === 'prepared' && (value.action.actionCode !== 'CREATE_NOTIFICATION_DRAFT'
    || value.action.surface !== 'tenant_admin' || value.action.audience !== 'operations'
    || value.action.resource.id !== value.material.id || value.action.inputFingerprint !== value.material.inputHash
    || value.action.expiresAt !== value.expiresAt || value.action.scope.tenantId !== value.scope.tenantId
    || value.action.scope.workspaceId !== value.scope.workspaceId))
    context.addIssue({ code: 'custom', message: 'Original draft-save Action/material binding mismatch' });
});
export type AiEntryNotificationDraftPrepare = z.infer<typeof aiEntryNotificationDraftPrepareSchema>;
export type AiEntryNotificationDraftSaveCommand = z.infer<typeof aiEntryNotificationDraftSaveCommandSchema>;
export type AiEntryNotificationDraftSave = z.infer<typeof aiEntryNotificationDraftSaveSchema>;
export type AiEntryNotificationDraftRead = z.infer<typeof aiEntryNotificationDraftReadSchema>;
export type AiEntryNotificationDraftMaterial = z.infer<typeof aiEntryNotificationDraftMaterialSchema>;
export type AiEntryNotificationDraftResponse = z.infer<typeof aiEntryNotificationDraftResponseSchema>;

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema;
  enum?: readonly (string | boolean | number)[]; format?: string; pattern?: string; minLength?: number; maxLength?: number;
  maxProperties?: number; anyOf?: readonly Schema[]; $ref?: string };
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = (maxLength = 191): Schema => ({ type: 'string', maxLength });
const identifier: Schema = { ...str(), minLength: 1, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const digest: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const time: Schema = { ...str(40), format: 'date-time' };
const choice = (...values: (string | number | boolean)[]): Schema => ({ enum: values });
const nil: Schema = { type: 'null' };
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const location = obj({ tenantId: identifier, workspaceId: identifier });
const fields: Schema = { type: 'object', maxProperties: 64, additionalProperties: { anyOf: [str(2000), { type: 'number' }, { type: 'boolean' }, nil] } };
const input = { operationKey: { ...identifier, maxLength: 128 }, customerId: identifier, templateId: identifier,
  templateVersion: identifier, variables: fields };
const materialJsonFields = { version: choice('rental-notification-draft-1'), id: { ...str(), pattern: '^notification-draft-[a-f0-9]{64}$' },
  key: digest, actorId: identifier, scope: location, customerId: identifier, customerVersion: time,
  templateId: identifier, templateVersion: identifier, eventCode: identifier, channel: choice('sms', 'email', 'app_push', 'wechat'),
  commandHash: digest, inputHash: digest, templateHash: digest, configurationHash: digest, contentHash: digest,
  provider: choice('not_dispatched'), attempts: choice(0),
};
const material = obj({ ...materialJsonFields,
  recipient: { ...str(), minLength: 1 }, renderedTitle: str(), renderedBody: str(32768),
  variables: { type: 'object', maxProperties: 64, additionalProperties: { anyOf: [choice('[已加密保留]', ''), nil] } },
  status: choice('prepared', 'draft'), createdAt: { anyOf: [time, nil] }, provider: choice('not_dispatched'), attempts: choice(0) });
const envelope = { contractVersion: choice(AI_ENTRY_NOTIFICATION_DRAFT_VERSION), operationKey: { ...identifier, maxLength: 128 },
  scope: obj({ kind: choice('workspace'), tenantId: identifier, workspaceId: identifier }), observedAt: time,
  automaticRetry: choice(false), dispatch: choice('not_dispatched') };
export const AI_ENTRY_NOTIFICATION_DRAFT_SCHEMAS: Record<string, Schema> = {
  AiEntryNotificationDraftPrepare: obj(input),
  AiEntryNotificationDraftSaveCommand: obj({ ...input, reviewHash: digest, expiresAt: time, decision: choice('save_unsent_notification_draft') }),
  AiEntryNotificationDraftSave: obj({ action: ref('AiRegisteredEntryAction'), command: ref('AiEntryNotificationDraftSaveCommand') }),
  AiEntryNotificationDraftRead: obj({ operationKey: { ...identifier, maxLength: 128 } }),
  AiEntryNotificationDraftIntactMaterial: material,
  AiEntryNotificationDraftErasedMaterial: obj({ ...materialJsonFields, recipient: nil, renderedTitle: nil,
    renderedBody: nil, variables: nil, status: choice('draft'), createdAt: time,
    bodyRetention: obj({ state: choice('erased'), receiptId: digest, policyVersion: choice('ai-retention-20261015-1'), erasedAt: time, erasedRevision: choice(2) }) }),
  AiEntryNotificationDraftMaterial: { anyOf: [ref('AiEntryNotificationDraftIntactMaterial'), ref('AiEntryNotificationDraftErasedMaterial')] },
  AiEntryNotificationDraftResponse: { anyOf: [
    obj({ ...envelope, state: choice('prepared'), material: ref('AiEntryNotificationDraftIntactMaterial'), action: ref('AiRegisteredEntryAction'),
      reviewHash: digest, expiresAt: time, persistence: choice('not_saved'), execution: choice('not_attempted'),
      nextAction: choice('explicit_save_or_original_notification_page') }),
    obj({ ...envelope, state: choice('saved'), draft: ref('AiEntryNotificationDraftMaterial'), action: nil,
      persistence: choice('draft_saved'), execution: choice('not_sent'), nextAction: choice('read_original_notification_draft') }),
    obj({ ...envelope, state: choice('unknown'), draft: nil, action: nil, persistence: choice('not_attested'),
      execution: choice('not_attested'), nextAction: choice('read_original_notification_draft') }),
  ] },
};
export const AI_ENTRY_NOTIFICATION_DRAFT_CONTRACTS = {
  prepare: { request: 'AiEntryNotificationDraftPrepare', response: 'AiEntryNotificationDraftResponse' },
  save: { request: 'AiEntryNotificationDraftSave', response: 'AiEntryNotificationDraftResponse' },
  read: { request: 'AiEntryNotificationDraftRead', response: 'AiEntryNotificationDraftResponse' },
} as const;
