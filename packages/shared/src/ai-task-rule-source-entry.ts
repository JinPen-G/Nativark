/** Original rule-page source Task creation. Client locators grant no scope,
 * execution or publication; uncertain creation is observed by its original key. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
import { aiTaskRuleDraftPreparationResponse } from './ai-task-rule-draft';

export const AI_TASK_RULE_SOURCE_ENTRY_VERSION = 'ain-task-rule-source-1' as const;
export const AI_TASK_RULE_SOURCE_ENTRY_HTTP = { basePath: 'ai-native/task-rule-drafts', source: 'source', entry: 'entry', entryOperation: 'entry-operation' } as const;
const resource = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), identifier = resource.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scope = z.object({ kind: z.literal('workspace'), tenantId: resource, workspaceId: resource }).strict();
const target = z.object({ id: resource, version: resource, status: z.enum(['draft', 'pending', 'published', 'superseded', 'void']) }).strict();
export const aiTaskRuleSourceInput = z.object({ targetId: resource, version: resource }).strict();
export const aiTaskRuleSourceEntryInput = aiTaskRuleSourceInput.extend({ sourceHash: hash, operationKey: z.string().uuid(),
  decision: z.literal('create_original_rule_task') }).strict();
export const aiTaskRuleSourceEntryReference = z.object({ operationKey: z.string().uuid() }).strict();
const base = z.object({ contractVersion: z.literal(AI_TASK_RULE_SOURCE_ENTRY_VERSION), scope,
  observedAt: z.string().datetime({ offset: true }) }).strict();
export const aiTaskRuleSourceResponse = base.extend({ target: target.extend({ sourceHash: hash,
  values: aiTaskRuleDraftPreparationResponse.shape.targets.element.shape.values }).strict(),
  source: z.literal('original_rule_version'), task: z.literal('not_created') }).strict();
export const aiTaskRuleSourceEntryResponse = base.extend({ reference: aiTaskRuleSourceEntryReference,
  model: z.literal('not_called'), execution: z.literal('not_started'), retryable: z.literal(false), operation: z.union([
    z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict(),
    z.object({ state: z.literal('original_request_recorded'), target,
      original: z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid() }).strict(),
      task: z.union([z.object({ state: z.literal('observed'), taskId: identifier, runId: identifier }).strict(),
        z.object({ state: z.literal('not_observed') }).strict()]) }).strict()
  ]) }).strict();
export type AiTaskRuleSourceInput = z.infer<typeof aiTaskRuleSourceInput>;
export type AiTaskRuleSourceEntryInput = z.infer<typeof aiTaskRuleSourceEntryInput>;
export type AiTaskRuleSourceEntryReference = z.infer<typeof aiTaskRuleSourceEntryReference>;
export type AiTaskRuleSourceResponse = z.infer<typeof aiTaskRuleSourceResponse>;
export type AiTaskRuleSourceEntryResponse = z.infer<typeof aiTaskRuleSourceEntryResponse>;

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const literal = (value: string | boolean): Schema => ({ type: typeof value, enum: [value] });
const res: Schema = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }, id = { ...res, maxLength: 36 };
const fingerprint: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' }, uuid: Schema = { type: 'string', format: 'uuid' };
const scopeSchema = object({ kind: literal('workspace'), tenantId: res, workspaceId: res });
const status: Schema = { type: 'string', enum: ['draft', 'pending', 'published', 'superseded', 'void'] };
const targetSchema = object({ id: res, version: res, status });
const envelope = { contractVersion: literal(AI_TASK_RULE_SOURCE_ENTRY_VERSION), scope: scopeSchema, observedAt: { type: 'string', format: 'date-time' } };
const values = object(Object.fromEntries(Object.keys(aiTaskRuleDraftPreparationResponse.shape.targets.element.shape.values.shape).map(field => [field, { type: 'boolean' }])));
export const AI_TASK_RULE_SOURCE_ENTRY_SCHEMAS = {
  AiTaskRuleSourceInput: object({ targetId: res, version: res }),
  AiTaskRuleSourceEntryInput: object({ targetId: res, version: res, sourceHash: fingerprint, operationKey: uuid, decision: literal('create_original_rule_task') }),
  AiTaskRuleSourceEntryReference: object({ operationKey: uuid }),
  AiTaskRuleSourceResponse: object({ ...envelope, target: object({ id: res, version: res, status, sourceHash: fingerprint, values }),
    source: literal('original_rule_version'), task: literal('not_created') }),
  AiTaskRuleSourceEntryResponse: object({ ...envelope, reference: object({ operationKey: uuid }), model: literal('not_called'),
    execution: literal('not_started'), retryable: literal(false), operation: { oneOf: [
      object({ state: literal('not_observed'), retryable: literal(false) }),
      object({ state: literal('original_request_recorded'), target: targetSchema,
        original: object({ draftVersion: literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: uuid }),
        task: { oneOf: [object({ state: literal('observed'), taskId: id, runId: id }), object({ state: literal('not_observed') })] } })
    ] } })
} as const;
export const AI_TASK_RULE_SOURCE_ENTRY_CONTRACTS = {
  source: { request: 'AiTaskRuleSourceInput', response: 'AiTaskRuleSourceResponse' },
  entry: { request: 'AiTaskRuleSourceEntryInput', response: 'AiTaskRuleSourceEntryResponse' },
  entryOperation: { request: 'AiTaskRuleSourceEntryReference', response: 'AiTaskRuleSourceEntryResponse' }
} as const;
