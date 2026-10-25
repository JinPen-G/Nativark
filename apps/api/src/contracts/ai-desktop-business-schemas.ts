/** Local business contract; a saved policy is not an execution or model-egress receipt. */
import { RENTAL_DESKTOP_BUSINESS_HTTP } from '@rental-os/shared';
import type { ContractOperation, SchemaObject } from './openapi-document';

const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, SchemaObject>, optional: string[] = []): SchemaObject => ({ type: 'object', properties,
  required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false });
const id: SchemaObject = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const key = { ...id, maxLength: 128 };
const time: SchemaObject = { type: 'string', format: 'date-time', description: 'Exact UTC ISO timestamp including three millisecond digits.' };
const hash: SchemaObject = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision: SchemaObject = { type: 'integer', minimum: 1, maximum: 2147483647 };
const literal = (value: string): SchemaObject => ({ type: 'string', enum: [value] });
const configured = object({ state: literal('configured'), revision, policy: ref('DesktopBusinessPolicy') });
export const DESKTOP_BUSINESS_SCHEMAS: Record<string, SchemaObject> = {
  DesktopBusinessDestination: object({ provider: key, baseUrl: { type: 'string', format: 'uri', maxLength: 2048, description: 'HTTPS model destination, no credentials/query/hash; not an attestation of actual model egress.' } }),
  DesktopBusinessBinding: object({ actorId: id, tenantId: id, workspaceId: id }),
  DesktopBusinessModelRoute: object({ provider: key, baseUrl: { type: 'string', format: 'uri', maxLength: 2048 },
    model: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,255}$' },
    protocol: { type: 'string', enum: ['openai-responses', 'openai-completions', 'anthropic-messages'] } }),
  DesktopBusinessPolicy: object({ enabled: { type: 'boolean' }, toolCodes: { type: 'array', maxItems: 1, uniqueItems: true, items: literal('rental.catalog.search') },
    destinations: { type: 'array', maxItems: 16, uniqueItems: true, items: ref('DesktopBusinessDestination') },
    modelRoutes: { type: 'array', maxItems: 32, uniqueItems: true, items: ref('DesktopBusinessModelRoute'), description: 'Exact model/protocol routes; each must belong to destinations. Absent or empty grants no model-bound preview. No model dispatch permission.' },
    maxRows: { type: 'integer', minimum: 1, maximum: 50 }, expiresAt: time }, ['modelRoutes']),
  DesktopBusinessPolicyRead: { oneOf: [object({ state: literal('not_configured') }), configured] },
  DesktopBusinessPolicyChange: object({ operationKey: key, expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 }, policy: ref('DesktopBusinessPolicy') }),
  DesktopBusinessPolicySaved: object({ state: literal('saved'), operationKey: key, result: configured }),
  DesktopBusinessPolicyOperation: { oneOf: [object({ state: literal('not_observed') }), object({ state: literal('observed'), operationKey: key, result: configured })] },
  DesktopBusinessCatalogRequest: object({ id: key, binding: ref('DesktopBusinessBinding'), query: object({ limit: { type: 'integer', minimum: 1, maximum: 50 }, destination: ref('DesktopBusinessDestination'),
    modelRoute: ref('DesktopBusinessModelRoute') }, ['modelRoute']) }),
  DesktopBusinessCatalogResult: object({ version: { type: 'integer', enum: [1] }, requestId: key, binding: ref('DesktopBusinessBinding'),
    policyRevision: revision, policyHash: hash, observedAt: time, expiresAt: time, configurationVersion: hash,
    source: literal('persisted_workspace_configuration'), destination: ref('DesktopBusinessDestination'),
    modelRoute: ref('DesktopBusinessModelRoute'),
    items: { type: 'array', maxItems: 50, items: object({ reference: id, categoryCode: { ...id, maxLength: 64 }, status: { type: 'string', enum: ['enabled', 'disabled'] } }) },
    truncated: { type: 'boolean' }, omittedFields: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string', enum: ['name', 'code', 'unit', 'availability', 'price'] }, description: 'Exact ordered list: name, code, unit, availability, price.' },
    execution: literal('read_only') }, ['modelRoute'])
};
const base = `/api/${RENTAL_DESKTOP_BUSINESS_HTTP.basePath}`;
const row = (path: string, operationId: string, summary: string, requestSchema: string | SchemaObject, responseSchema: string, permissions: string[]): ContractOperation =>
  ({ method: 'post', path: `${base}/${path}`, tag: 'AI Desktop Business', operationId, summary, requestSchema, responseSchema, permissions, authRequired: true });
const manage = ['system:params:manage'];
export const DESKTOP_BUSINESS_OPERATIONS: ContractOperation[] = [
  row(RENTAL_DESKTOP_BUSINESS_HTTP.catalog, 'readDesktopBusinessCatalog', 'Current workspace policy and original catalog permission; read-only minimal projection, not a model call.',
    'DesktopBusinessCatalogRequest', 'DesktopBusinessCatalogResult', ['rental-core:catalog:view', 'rental-core:catalog:manage', 'rental-os:order:view', 'rental-os:order:create']),
  row(RENTAL_DESKTOP_BUSINESS_HTTP.policy, 'readDesktopBusinessPolicy', 'Read local-business policy under current model-configuration management permission.', object({}), 'DesktopBusinessPolicyRead', manage),
  row(RENTAL_DESKTOP_BUSINESS_HTTP.savePolicy, 'changeDesktopBusinessPolicy', 'Human policy CAS with original operation receipt; unknown must be reconciled by the same key, never auto-retried.', 'DesktopBusinessPolicyChange', 'DesktopBusinessPolicySaved', manage),
  row(RENTAL_DESKTOP_BUSINESS_HTTP.policyOperation, 'readDesktopBusinessPolicyOperation', 'Observe own original policy-save receipt; absence is not proof of rollback.', object({ operationKey: key }), 'DesktopBusinessPolicyOperation', manage)
];
