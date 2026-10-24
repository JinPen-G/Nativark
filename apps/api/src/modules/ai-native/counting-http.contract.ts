/** Public counting transport contracts only. Canonical reader/pricing schemas
 * remain shared; this registry does not create calls, rates or authorization. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_COUNTING_HTTP_OPERATIONS, AI_COUNTING_HTTP_SCHEMAS, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS,
  AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS } from '@rental-os/shared';

type Action = typeof AI_COUNTING_HTTP_OPERATIONS[number][0];
const ajv = new Ajv({ strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' && typeof child === 'string' ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:counting:') : refs(child)])) : value;
for (const family of [AI_COUNTING_HTTP_SCHEMAS, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS]) {
  for (const [name, schema] of Object.entries(family)) ajv.addSchema(refs(schema) as object, `urn:rental:counting:${name}`);
}
const validators = new Map(AI_COUNTING_HTTP_OPERATIONS.map(([action, request, response]) =>
  [action, { request: ajv.getSchema(`urn:rental:counting:${request}`)!, response: ajv.getSchema(`urn:rental:counting:${response}`)! }]));
export function validateCountingHttp(action: Action, phase: 'request' | 'response', value: unknown): boolean {
  return validators.get(action)![phase](value) === true;
}
