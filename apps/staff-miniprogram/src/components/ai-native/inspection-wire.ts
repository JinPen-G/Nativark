/** Validation of the existing inspection HTTP schema registry only. This reader
 * admits no arbitrary schema, route or action, and grants no host authority. */
import type { AiLeafSchemaDraft, StaffUploadObservationRequest, StaffUploadObservationResponse,
  AiInspectionSavedCandidateReview } from '@rental-os/shared';
import { contracts, schemas, taskContracts, uploadObservationHttp, uploadObservationContract } from './inspection-wire-schemas';
const keywords = new Set(['type', 'oneOf', '$ref', 'properties', 'required', 'additionalProperties', 'maxProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'format', 'enum', 'const',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'not']);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const dateTime = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/iu.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 60
    || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59) return false;
  // Date.parse rejects leap seconds; validate the calendar independently.
  if (Number(match[6]) === 60) {
    const offset = (Number(match[9] ?? 0) * 60 + Number(match[10] ?? 0)) * (match[8] === '-' ? -1 : 1);
    if ((Number(match[4]) * 60 + Number(match[5]) - offset + 1440) % 1440 !== 1439) return false;
  }
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
};
export function validateInspectionWire(operation: keyof typeof contracts, direction: 'request' | 'response', value: unknown): boolean {
  if (!own(contracts, operation)) return false;
  return validateRegisteredSchema(contracts[operation][direction], value);
}
/** The task registry is generated from the same original shared contracts.
 * This selects a fixed operation; it cannot accept caller-provided schemas. */
export function validateInspectionTaskWire(operation: keyof typeof taskContracts, direction: 'request' | 'response', value: unknown): boolean {
  if (!own(taskContracts, operation)) return false;
  return validateRegisteredSchema(taskContracts[operation][direction], value);
}
/** Validate only the server's current saved-candidate review projection. */
export function isInspectionSavedCandidateReview(value: unknown): value is AiInspectionSavedCandidateReview {
  return validateRegisteredSchema('AiInspectionDraftReadResponse', value, 'candidateReviews');
}
/** Only the original published upload observation, never a caller schema. */
export function isStaffUploadObservationRequest(value: unknown): value is StaffUploadObservationRequest {
  return validateStaffUploadObservation('request', value);
}
export function isStaffUploadObservationResponse(value: unknown): value is StaffUploadObservationResponse {
  return validateStaffUploadObservation('response', value);
}
export function validateStaffUploadObservation(direction: 'request' | 'response', value: unknown): boolean {
  return validateRegisteredSchema(uploadObservationContract[direction], value);
}
export function staffUploadObservationRoute(): string {
  if (uploadObservationHttp.basePath !== 'staff/v1/uploads' || uploadObservationHttp.observe !== 'sessions/observe') throw Error('原上传观察入口不可用');
  return `/uploads/${uploadObservationHttp.observe}`;
}
function validateRegisteredSchema(name: string, value: unknown, item?: 'candidateReviews'): boolean {
  // The fixed schemas bound text, maps and lists. A second aggregate size/node
  // limit would reject valid historical drafts containing repeated field facts.
  const valid = (schema: AiLeafSchemaDraft, value: unknown, depth = 0): boolean => {
    if (depth > 32 || !schema || Object.keys(schema).some(key => !keywords.has(key))) return false;
    // The original task contracts exclude control characters with not.pattern.
    // Support that fixed form; other negative schemas remain unavailable.
    const excluded = (schema as AiLeafSchemaDraft & { not?: unknown }).not;
    if (excluded !== undefined && (!object(excluded) || Object.keys(excluded).length !== 1
      || typeof excluded.pattern !== 'string'
      || typeof value === 'string' && new RegExp(excluded.pattern, 'u').test(value))) return false;
    if (schema.$ref) {
      const match = /^#\/components\/schemas\/([A-Za-z0-9]+)$/u.exec(schema.$ref);
      return !!match && own(schemas, match[1]) && valid(schemas[match[1]], value, depth + 1);
    }
    if (schema.oneOf) return schema.oneOf.filter(branch => valid(branch, value, depth + 1)).length === 1;
    if (own(schema, 'const') && value !== schema.const) return false;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    if (schema.type === 'null') return value === null;
    if (schema.type === 'boolean') return typeof value === 'boolean';
    if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
      && (schema.type !== 'integer' || Number.isSafeInteger(value))
      && (schema.minimum === undefined || value >= Number(schema.minimum)) && (schema.maximum === undefined || value <= Number(schema.maximum))
      && (schema.exclusiveMinimum === undefined || value > Number(schema.exclusiveMinimum)) && (schema.exclusiveMaximum === undefined || value < Number(schema.exclusiveMaximum));
    if (schema.type === 'string') return typeof value === 'string' && Array.from(value).length >= Number(schema.minLength ?? 0)
      && (schema.maxLength === undefined || Array.from(value).length <= Number(schema.maxLength))
      && (schema.pattern === undefined || new RegExp(String(schema.pattern), 'u').test(value))
      && (schema.format === undefined || schema.format === 'date-time' && dateTime(value));
    if (schema.type === 'array') return Array.isArray(value) && value.length >= Number(schema.minItems ?? 0)
      && (schema.maxItems === undefined || value.length <= Number(schema.maxItems))
      && (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length)
      && !!schema.items && value.every(item => valid(schema.items!, item, depth + 1));
    if (schema.type === 'object') {
      if (!object(value) || schema.maxProperties !== undefined && Object.keys(value).length > Number(schema.maxProperties)
        || schema.required?.some(key => !own(value, key))) return false;
      return Object.entries(value).every(([key, item]) => {
        if (schema.properties && own(schema.properties, key)) return valid(schema.properties[key], item, depth + 1);
        return object(schema.additionalProperties) && valid(schema.additionalProperties as AiLeafSchemaDraft, item, depth + 1);
      });
    }
    return false;
  };
  try {
    const registered = schemas[name], schema = item ? registered?.properties?.[item]?.items : registered;
    return !!schema && valid(schema, value);
  } catch { return false; }
}
