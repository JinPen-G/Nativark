/** Customer goal -> original model candidates -> explicitly selected original
 * quote preparation. Intent is untrusted text; references, current visibility,
 * identity, pricing and execution remain in the original server/Core services. */
import { z } from 'zod';
import type { ClientCreateQuoteRequest } from './client';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { aiClientTaskReadRequestSchema } from './ai-client-entry-draft-schemas';
import { leafClosed as object, leafEnum as choice, leafId as leafId, leafInt as integer,
  leafList as list, leafRef as ref, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_CLIENT_GOAL_VERSION = 'ain-client-goal-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const key = id.max(128), digest = z.string().regex(/^[a-f0-9]{64}$/u), iso = z.string().datetime({ offset: true });
export const aiClientGoalPreparationRequestSchema = z.object({ operationKey: key,
  goalText: z.string().min(1).max(4096).refine(value => value.trim().length > 0) }).strict();
export const aiClientGoalPreparationReadRequestSchema = z.object({ operationKey: key, goalHash: digest }).strict();
const originalRead = { contractVersion: z.literal(AI_CLIENT_GOAL_VERSION), operationKey: key,
  execution: z.literal('not_attested'), retryable: z.literal(false), nextAction: z.literal('read_original_goal_preparation') };
export const aiClientGoalPreparationResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...originalRead, state: z.literal('observed'), goalHash: digest, materialRef: z.string().uuid(),
    materialHash: digest, inputHash: digest, expiresAt: iso }).strict(),
  z.object({ ...originalRead, state: z.literal('unknown'), goalHash: digest, materialRef: z.null(),
    materialHash: z.null(), inputHash: z.null(), expiresAt: z.null() }).strict(),
]);
export const aiClientGoalCandidatesRequestSchema = aiClientTaskReadRequestSchema.extend({ expectedMaterialHash: digest }).strict();
const field = z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9_.]*$/u);
const words = z.string().min(1).max(191).regex(/^[^\u0000-\u001F\u007F<>]+$/u);
const intent = z.object({ kind: z.literal('client_goal_candidates'), version: z.literal('client-goal-1'),
  conditions: z.object({ items: z.array(z.object({ productName: words.optional(), quantity: z.number().int().min(1).max(10000).optional(),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional(), usageQuantity: z.number().finite().min(0).max(1000000).optional() }).strict()).min(1).max(50).optional(),
    start: words.max(80).optional(), end: words.max(80).optional(), fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES).optional(),
    locationName: words.optional(), returnLocationName: words.optional() }).strict(), unresolvedFields: z.array(field).max(256) }).strict();
export const aiClientGoalProjectionSchema = z.object({ version: z.literal('client-goal-1'),
  original: z.object({ materialRef: z.string().uuid(), materialHash: digest, goalHash: digest }).strict(),
  model: z.object({ taskId: id.max(36), taskRevision: z.number().int().min(1).max(4294967294),
    resultId: id.nullable(), observedAt: iso.nullable() }).strict(),
  state: z.enum(['requires_input', 'unknown', 'failed']), candidates: intent.nullable(),
  missingFields: z.array(z.object({ field, reason: z.enum(['not_supplied', 'model_unresolved', 'human_choice_required',
    'not_observed_in_public_source', 'unsupported_by_current_configuration']) }).strict()).max(256),
  choices: z.array(z.object({ field, choices: z.array(z.object({ id, label: words }).strict()).max(10),
    source: z.object({ kind: z.enum(['public_catalog', 'workspace_configuration', 'own_booking_options']), version: digest,
      observedAt: iso, truncated: z.boolean() }).strict(), selection: z.literal('explicit_human_choice_required') }).strict()).max(256),
  context: z.object({ timeZone: z.string().min(1).max(128), categoryCode: id, categoryVersionId: id.nullable() }).strict(),
  sourceHash: digest, projectionHash: digest, automaticRetry: z.literal(false),
  nextAction: z.enum(['review_current_choices', 'read_original_result']),
  semantics: z.literal('unconfirmed_intent_and_unselected_public_choices') }).strict().superRefine((value, context) => {
    if ((value.state === 'requires_input') !== (value.candidates !== null)
      || value.state !== 'requires_input' && (value.choices.length || value.missingFields.length)
      || value.state === 'requires_input' && value.nextAction !== 'review_current_choices'
      || value.state !== 'requires_input' && value.nextAction !== 'read_original_result') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent goal observation' });
    }
  });
export const aiClientGoalQuoteRequestSchema = aiClientGoalCandidatesRequestSchema.extend({ operationKey: key,
  expectedProjectionHash: digest, decision: z.literal('prepare_original_quote'), input: z.unknown() }).strict();
export type AiClientGoalPreparationRequest = z.infer<typeof aiClientGoalPreparationRequestSchema>;
export type AiClientGoalPreparationReadRequest = z.infer<typeof aiClientGoalPreparationReadRequestSchema>;
export type AiClientGoalPreparationResponse = z.infer<typeof aiClientGoalPreparationResponseSchema>;
export type AiClientGoalCandidatesRequest = z.infer<typeof aiClientGoalCandidatesRequestSchema>;
export type AiClientGoalProjection = z.infer<typeof aiClientGoalProjectionSchema>;
export type AiClientGoalQuoteRequest = Omit<z.infer<typeof aiClientGoalQuoteRequestSchema>, 'input'> & { input: ClientCreateQuoteRequest };

const identifier = leafId(), operationKey = { ...identifier, maxLength: 128 }, hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' }, no = { type: 'boolean', const: false } as const;
const observation = { contractVersion: choice(AI_CLIENT_GOAL_VERSION), operationKey, goalHash: hash,
  execution: choice('not_attested'), retryable: no, nextAction: choice('read_original_goal_preparation') };
const modelWords: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[^\\u0000-\\u001F\\u007F<>]+$' };
const fieldSchema: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z][A-Za-z0-9_.]*$' };
const nil = { type: 'null' } as const;
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, nil] });
const candidate = object({ kind: choice('client_goal_candidates'), version: choice('client-goal-1'),
  conditions: object({ items: list(object({ productName: modelWords, quantity: integer(1, 10000),
    pricingUnit: choice(...RENTAL_PRICING_UNIT_CODES), usageQuantity: { type: 'number', minimum: 0, maximum: 1000000 } }, []), 50, 1),
    start: { ...modelWords, maxLength: 80 }, end: { ...modelWords, maxLength: 80 }, fulfillmentMode: choice(...RENTAL_FULFILLMENT_MODES),
    locationName: modelWords, returnLocationName: modelWords }, []), unresolvedFields: list(fieldSchema, 256) });
const task = { creationKey: operationKey, materialRef: uuid, expectedMaterialHash: hash };
export const AI_CLIENT_GOAL_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiClientGoalPreparationRequest: object({ operationKey, goalText: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' } }),
  AiClientGoalPreparationReadRequest: object({ operationKey, goalHash: hash }),
  AiClientGoalPreparationResponse: { oneOf: [object({ ...observation, state: choice('observed'), materialRef: uuid,
    materialHash: hash, inputHash: hash, expiresAt: time }), object({ ...observation, state: choice('unknown'), materialRef: nil,
    materialHash: nil, inputHash: nil, expiresAt: nil })] },
  AiClientGoalCandidatesRequest: object(task),
  AiClientGoalQuoteRequest: object({ ...task, operationKey, expectedProjectionHash: hash,
    decision: choice('prepare_original_quote'), input: ref('ClientQuoteRequest') }),
  AiClientGoalProjection: object({ version: choice('client-goal-1'),
    original: object({ materialRef: uuid, materialHash: hash, goalHash: hash }),
    model: object({ taskId: { ...identifier, maxLength: 36 }, taskRevision: integer(1, 4294967294), resultId: nullable(identifier), observedAt: nullable(time) }),
    state: choice('requires_input', 'unknown', 'failed'), candidates: nullable(candidate),
    missingFields: list(object({ field: fieldSchema, reason: choice('not_supplied', 'model_unresolved', 'human_choice_required',
      'not_observed_in_public_source', 'unsupported_by_current_configuration') }), 256),
    choices: list(object({ field: fieldSchema, choices: list(object({ id: identifier, label: modelWords }), 10),
      source: object({ kind: choice('public_catalog', 'workspace_configuration', 'own_booking_options'), version: hash,
        observedAt: time, truncated: { type: 'boolean' } }), selection: choice('explicit_human_choice_required') }), 256),
    context: object({ timeZone: { type: 'string', minLength: 1, maxLength: 128 }, categoryCode: identifier, categoryVersionId: nullable(identifier) }),
    sourceHash: hash, projectionHash: hash, automaticRetry: no, nextAction: choice('review_current_choices', 'read_original_result'),
    semantics: choice('unconfirmed_intent_and_unselected_public_choices') }),
};
