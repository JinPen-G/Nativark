/** Public catalog/help ownership and explicit login continuation only. A signed
 * anonymous reference grants no customer data, Task, quote, model or payment.
 * Current publication and original customer authentication remain server-owned. */
import { z } from 'zod';
import { CLIENT_API_VERSION, type ClientCatalogResponse, type ClientPublicDocumentResponse } from './client';
import { RENTAL_CATEGORY_ICON_CODES, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from './core';
import { leafClosed as object, leafEnum as choice, leafId as id, leafRef as ref,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_CLIENT_PUBLIC_HTTP = Object.freeze({
  basePaths: ['client/v1/ai-native/entry/public', 'client/v1/ai-native/wechat-entry/public'] as const,
  method: 'POST' as const, read: 'read', issueSession: 'session', prepare: 'prepare', readOriginal: 'operation',
  continueOriginal: 'continue', readContinuation: 'continuation', credentialHeader: 'x-ai-public-session',
});
export const AI_CLIENT_PUBLIC_CONTRACTS = Object.freeze({
  read: { request: 'AiClientPublicReadRequest', response: 'AiClientPublicReadResponse' },
  issueSession: { request: 'AiClientPublicSessionRequest', response: 'AiClientPublicSessionResponse' },
  prepare: { request: 'AiClientPublicPreparationRequest', response: 'AiClientPublicPreparationResponse' },
  readOriginal: { request: 'AiClientPublicOperationRequest', response: 'AiClientPublicOperationResponse' },
  continueOriginal: { request: 'AiClientPublicContinuationRequest', response: 'AiClientPublicContinuationResponse' },
  readContinuation: { request: 'AiClientPublicContinuationReadRequest', response: 'AiClientPublicContinuationResponse' },
} as const);
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const iso = z.string().datetime({ offset: true });
const reference = z.string().uuid();
const targetCode = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const target = { tenantCode: targetCode, serviceCode: targetCode };
export const aiClientPublicCommandSchema = z.object({ kind: z.enum(['catalog', 'help']) }).strict();
export const aiClientPublicReadRequestSchema = z.object({ ...target, command: aiClientPublicCommandSchema }).strict();
export const aiClientPublicSessionRequestSchema = z.object(target).strict();
export const aiClientPublicPreparationRequestSchema = aiClientPublicReadRequestSchema.extend({ operationKey: identifier }).strict();
export const aiClientPublicOperationRequestSchema = aiClientPublicSessionRequestSchema.extend({ operationKey: identifier }).strict();
export const aiClientPublicContinuationReadRequestSchema = aiClientPublicSessionRequestSchema.extend({ publicRef: reference,
  operationKey: identifier, expectedMaterialHash: digest }).strict();
export const aiClientPublicContinuationRequestSchema = aiClientPublicContinuationReadRequestSchema.extend({
  decision: z.literal('continue_public_request') }).strict();
export const aiClientPublicSessionResponseSchema = z.object({ credential: z.string().min(1).max(2048)
  .regex(/^ain-public-1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u), expiresAt: iso,
  ownership: z.literal('public_material_only'), execution: z.literal('not_authorized') }).strict();
const publicationSchema = z.object({ tenantCode: targetCode, channel: z.enum(['web', 'wechat_miniprogram']),
  service: z.object({ code: targetCode, name: z.string().min(1).max(255), categoryCode: targetCode, status: z.literal('open') }).strict() }).strict();
// These are the original client-safe projections. Model text or cached objects
// cannot substitute a private order/profile or add fields to public content.
const words = z.string(), textValue = z.union([z.string(), z.number().finite(), z.boolean()]);
const catalogMaterial = z.object({ apiVersion: z.literal(CLIENT_API_VERSION), tenantCode: targetCode,
  workspace: z.object({ workspaceCode: targetCode, workspaceName: words, categoryCode: targetCode,
    membershipStatus: words, isDefault: z.boolean().optional() }).strict(), categoryCode: targetCode,
  categoryMetadata: z.object({ structureVersion: z.literal(1), categoryVersionId: words.optional(), definitionVersion: words,
    name: words, icon: z.enum(RENTAL_CATEGORY_ICON_CODES).optional(), fields: z.array(z.object({ code: words, label: words,
      type: z.enum(['string', 'number', 'boolean', 'date', 'select']), unit: words.optional(), options: z.array(words).optional() }).strict()) }).strict().optional(),
  timeZone: words, terminology: z.object({ itemLabel: words, itemGroupLabel: words, assetLabel: words,
    fulfillmentLabel: words, pickupLabel: words, returnLabel: words, deliveryLabel: words.optional(), usageMetricLabel: words.optional() }).strict(),
  pricingUnits: z.array(z.object({ code: z.enum(RENTAL_PRICING_UNIT_CODES), label: words }).strict()),
  items: z.array(z.object({ id: targetCode, code: words, name: words, description: words.optional(), inventoryMode: words,
    images: z.array(z.object({ url: words, alt: words.optional() }).strict()).optional(), attributes: z.record(textValue).optional(),
    attributeLabels: z.record(words).optional(), startingPrice: z.object({ amount: z.number().finite(),
      unit: z.enum(RENTAL_PRICING_UNIT_CODES), currency: words }).strict().optional() }).strict()),
  pricingGroups: z.array(z.object({ id: targetCode, code: words, name: words, memberItemGroupIds: z.array(targetCode), enabled: z.boolean() }).strict()),
  services: z.array(z.object({ id: targetCode, code: words, name: words, description: words.optional(),
    pricingUnit: words.optional(), enabled: z.boolean() }).strict()),
  locations: z.array(z.object({ id: targetCode, code: words, name: words, status: words, address: words.optional(), city: words.optional(),
    latitude: z.number().finite().optional(), longitude: z.number().finite().optional(), businessHours: words.optional(),
    contactPhone: words.optional(), capabilities: z.array(z.enum(['pickup', 'return', 'storage', 'delivery'])).optional() }).strict()),
  discountPlans: z.array(z.object({ id: targetCode, code: words, name: words, status: words }).strict()),
  fulfillment: z.object({ enabledModes: z.array(z.enum(RENTAL_FULFILLMENT_MODES)), allowDifferentReturnLocation: z.boolean(),
    deliveryDestination: z.enum(['customer_address', 'tenant_location']), deliveryLabel: words.optional(), pickupLabel: words, returnLabel: words }).strict(),
}).strict() satisfies z.ZodType<ClientCatalogResponse>;
const helpMaterial = z.object({ apiVersion: z.literal(CLIENT_API_VERSION), tenantCode: targetCode, kind: z.literal('help'), name: words,
  version: words.optional(), url: words.optional(), body: words.optional(), intro: words.optional(),
  faq: z.array(z.object({ question: words, answer: words }).strict()).optional(), updatedAt: iso.optional() }).strict() satisfies z.ZodType<ClientPublicDocumentResponse>;
const material = z.union([catalogMaterial, helpMaterial]);
const samePublication = (value: { kind: string; material: ClientCatalogResponse | ClientPublicDocumentResponse;
  publication: z.infer<typeof publicationSchema> }) => value.material.tenantCode === value.publication.tenantCode
  && (value.kind === 'help' ? 'kind' in value.material && value.material.kind === 'help'
    : 'workspace' in value.material && value.material.workspace.workspaceCode === value.publication.service.code
      && value.material.categoryCode === value.publication.service.categoryCode);
export const aiClientPublicReadResponseSchema = z.object({ kind: z.enum(['catalog', 'help']), material,
  publication: publicationSchema, materialRef: z.null(), durability: z.literal('current_public_read_only'),
  persistentOperations: z.literal('unavailable_anonymous_session_missing') }).strict().refine(samePublication);
const preparedResponseSchema = z.object({ state: z.literal('observed'), operationKey: identifier,
  publicRef: reference, kind: z.enum(['catalog', 'help']), inputHash: digest, materialHash: digest, material,
  publication: publicationSchema, expiresAt: iso, execution: z.literal('public_read_only'),
  continuation: z.literal('explicit_current_client_required'), retryable: z.literal(false),
  nextAction: z.literal('read_original_public_operation') }).strict().refine(samePublication);
const operationResult = { operationKey: identifier, execution: z.literal('not_attested'), retryable: z.literal(false),
  nextAction: z.literal('read_original_public_operation') };
export const aiClientPublicOperationResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...operationResult, state: z.literal('observed'), publicRef: reference, kind: z.enum(['catalog', 'help']),
    inputHash: digest, materialHash: digest, expiresAt: iso, expiredAtObservation: z.boolean() }).strict(),
  z.object({ ...operationResult, state: z.literal('unknown'), publicRef: z.null(), kind: z.null(), inputHash: z.null(),
    materialHash: z.null(), expiresAt: z.null(), expiredAtObservation: z.null() }).strict(),
]);
// Replaying an original key returns locators, never reissues withdrawn content.
export const aiClientPublicPreparationResponseSchema = z.union([preparedResponseSchema, aiClientPublicOperationResponseSchema]);
export const aiClientPublicContinuationResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('observed'), operationKey: identifier, publicRef: reference, materialRef: reference,
    materialOperationKey: identifier.max(191), inputHash: digest, materialHash: digest, expiresAt: iso,
    execution: z.literal('not_attested'), continuation: z.literal('public_request_only_current_client_material'),
    retryable: z.literal(false), nextAction: z.literal('read_original_public_continuation') }).strict(),
  z.object({ state: z.literal('unknown'), operationKey: identifier, publicRef: reference, materialRef: z.null(),
    execution: z.literal('not_attested'), retryable: z.literal(false), nextAction: z.literal('read_original_public_continuation') }).strict(),
]);
export type AiClientPublicReadRequest = z.infer<typeof aiClientPublicReadRequestSchema>;
export type AiClientPublicSessionRequest = z.infer<typeof aiClientPublicSessionRequestSchema>;
export type AiClientPublicPreparationRequest = z.infer<typeof aiClientPublicPreparationRequestSchema>;
export type AiClientPublicOperationRequest = z.infer<typeof aiClientPublicOperationRequestSchema>;
export type AiClientPublicContinuationRequest = z.infer<typeof aiClientPublicContinuationRequestSchema>;
export type AiClientPublicContinuationReadRequest = z.infer<typeof aiClientPublicContinuationReadRequestSchema>;
export type AiClientPublicSessionResponse = z.infer<typeof aiClientPublicSessionResponseSchema>;
export type AiClientPublicReadResponse = z.infer<typeof aiClientPublicReadResponseSchema>;
export type AiClientPublicPreparationResponse = z.infer<typeof aiClientPublicPreparationResponseSchema>;
export type AiClientPublicOperationResponse = z.infer<typeof aiClientPublicOperationResponseSchema>;
export type AiClientPublicContinuationResponse = z.infer<typeof aiClientPublicContinuationResponseSchema>;

const shortId = { ...id(), maxLength: 128 }, uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' }, no = { type: 'boolean', const: false } as const;
const command = object({ kind: choice('catalog', 'help') }), selector = { tenantCode: id(), serviceCode: id() };
const continuationRead = { ...selector, publicRef: uuid, operationKey: shortId, expectedMaterialHash: hash };
const publication = object({ tenantCode: id(), channel: choice('web', 'wechat_miniprogram'),
  service: object({ code: id(), name: { type: 'string', minLength: 1, maxLength: 255 }, categoryCode: id(), status: choice('open') }) });
const currentRead = { materialRef: { type: 'null' } as const, durability: choice('current_public_read_only'),
  persistentOperations: choice('unavailable_anonymous_session_missing'), publication };
const prepared = { state: choice('observed'), operationKey: shortId, publicRef: uuid, inputHash: hash, materialHash: hash,
  publication, expiresAt: time, execution: choice('public_read_only'), continuation: choice('explicit_current_client_required'),
  retryable: no, nextAction: choice('read_original_public_operation') };
export const AI_CLIENT_PUBLIC_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiClientPublicReadRequest: object({ ...selector, command }), AiClientPublicSessionRequest: object(selector),
  AiClientPublicPreparationRequest: object({ ...selector, command, operationKey: shortId }),
  AiClientPublicOperationRequest: object({ ...selector, operationKey: shortId }),
  AiClientPublicContinuationReadRequest: object(continuationRead),
  AiClientPublicContinuationRequest: object({ ...continuationRead, decision: choice('continue_public_request') }),
  AiClientPublicSessionResponse: object({ credential: { type: 'string', minLength: 1, maxLength: 2048,
    pattern: '^ain-public-1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$' }, expiresAt: time,
    ownership: choice('public_material_only'), execution: choice('not_authorized') }),
  AiClientPublicReadResponse: { oneOf: [object({ ...currentRead, kind: choice('catalog'), material: ref('ClientCatalog') }),
    object({ ...currentRead, kind: choice('help'), material: ref('ClientPublicDocumentResponse') })] },
  AiClientPublicPreparationResponse: { oneOf: [object({ ...prepared, kind: choice('catalog'), material: ref('ClientCatalog') }),
    object({ ...prepared, kind: choice('help'), material: ref('ClientPublicDocumentResponse') }), ref('AiClientPublicOperationResponse')] },
  AiClientPublicOperationResponse: { oneOf: [object({ state: choice('observed'), operationKey: shortId,
    publicRef: uuid, kind: choice('catalog', 'help'), inputHash: hash, materialHash: hash,
    expiresAt: time, expiredAtObservation: { type: 'boolean' }, execution: choice('not_attested'),
    retryable: no, nextAction: choice('read_original_public_operation') }),
  object({ state: choice('unknown'), operationKey: shortId, publicRef: { type: 'null' }, kind: { type: 'null' },
    inputHash: { type: 'null' }, materialHash: { type: 'null' }, expiresAt: { type: 'null' }, expiredAtObservation: { type: 'null' },
    execution: choice('not_attested'), retryable: no, nextAction: choice('read_original_public_operation') })] },
  AiClientPublicContinuationResponse: { oneOf: [object({ state: choice('observed'), operationKey: shortId, publicRef: uuid,
    materialRef: uuid, materialOperationKey: id(), inputHash: hash, materialHash: hash, expiresAt: time,
    execution: choice('not_attested'), continuation: choice('public_request_only_current_client_material'),
    retryable: no, nextAction: choice('read_original_public_continuation') }),
  object({ state: choice('unknown'), operationKey: shortId, publicRef: uuid, materialRef: { type: 'null' },
    execution: choice('not_attested'), retryable: no, nextAction: choice('read_original_public_continuation') })] },
};
