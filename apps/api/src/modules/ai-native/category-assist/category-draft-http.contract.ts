/** Original CAT-GOV wire shape only. A mutable draft can be invalid business
 * configuration; only the original validate/publish domain decides executability.
 * Preserve JSON and original Date serialization, reject hidden extra fields. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_CATEGORY_DRAFT_HTTP_CONTRACTS, AI_CATEGORY_DRAFT_HTTP_SCHEMAS, isRentalCategoryCode,
  type AiCategoryDraftHttpRequests, type AiCategoryDraftHttpResponses, type AiCategoryVersionWire } from '@rental-os/shared';

type Action = keyof typeof AI_CATEGORY_DRAFT_HTTP_CONTRACTS;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries(AI_CATEGORY_DRAFT_HTTP_SCHEMAS)) ajv.addSchema(schema, `#/components/schemas/${name}`);
const contracts = Object.fromEntries(Object.entries(AI_CATEGORY_DRAFT_HTTP_CONTRACTS).map(([action, names]) => [action, {
  request: ajv.getSchema(`#/components/schemas/${names.request}`)!, response: ajv.getSchema(`#/components/schemas/${names.response}`)!,
}]));
// Validate before JSON.stringify so NaN, unsupported objects or deep cycles are
// not silently turned into null, empty data or an unbounded traversal. Date is
// accepted only for response serialization, never as caller configuration.
function wire(value: unknown, dates: boolean, depth = 0): unknown {
  if (depth > 32) throw Error('category wire nesting');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (dates && value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => wire(item, dates, depth + 1));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('category wire key');
      return [key, wire(child, dates, depth + 1)];
    }));
  }
  throw Error('category wire data');
}
export function categoryDraftRequest<A extends Action>(action: A, value: unknown): AiCategoryDraftHttpRequests[A] {
  const copy = wire(structuredClone(value), false);
  if (!Object.hasOwn(contracts, action) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 262144
    || !contracts[action].request(copy)) throw Error('category request');
  return copy as AiCategoryDraftHttpRequests[A];
}
export function categoryDraftResponse<A extends Action>(action: A, value: unknown,
  command: AiCategoryDraftHttpRequests[A]): AiCategoryDraftHttpResponses[A] {
  const copy = wire(structuredClone(value), true) as AiCategoryDraftHttpResponses[Action];
  // detail returns up to 100 original 256 KiB definitions; do not truncate them
  // or use a single-draft cap that would make a legitimate history unreadable.
  if (!Object.hasOwn(contracts, action) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 67108864
    || !contracts[action].response(copy)) throw Error('category response');
  const versionMatches = (row: AiCategoryVersionWire) => {
    if (!isRentalCategoryCode(command.code) || row.categoryCode.toLowerCase() !== command.code || row.definition.code !== command.code
      || row.policy && row.policy.versionId !== row.id) throw Error('category binding');
  };
  if (action === 'detail') {
    const result = copy as AiCategoryDraftHttpResponses['detail'];
    if (result.code !== command.code || new Set(result.versions.map(row => row.id)).size !== result.versions.length) throw Error('category detail');
    result.versions.forEach(versionMatches);
  }
  if (action === 'create' || action === 'patch') {
    const result = copy as AiCategoryVersionWire;
    versionMatches(result);
    if (result.status !== 'draft') throw Error('category write status');
    if (action === 'create') {
      const expected = command as AiCategoryDraftHttpRequests['create'];
      if (result.revision !== 0 || result.sourceVersionId !== expected.body.sourceVersionId
        || result.versionLabel !== expected.body.versionLabel || result.sourceKind !== 'platform_copy') throw Error('category create');
    } else {
      const expected = command as AiCategoryDraftHttpRequests['patch'];
      if (result.id !== expected.versionId || result.revision !== expected.body.expectedRevision + 1) throw Error('category patch');
    }
  }
  return copy as AiCategoryDraftHttpResponses[A];
}
