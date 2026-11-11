import type { AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

/** Bounded validation of the repository's published leaf schemas. This reads
 * data only; unknown schema keywords and unresolved references fail closed. */
const keys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'oneOf', 'anyOf', 'allOf', '$ref',
  'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
  'description', 'title', 'default', 'nullable']);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const dateTime = (value: string) => {
  if (value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};

export function validateAiLeafSchemaValue(root: AiLeafSchemaDraft, value: unknown,
  definitions: Record<string, AiLeafSchemaDraft>): boolean {
  let remaining = 200000;
  const visit = (schema: AiLeafSchemaDraft, item: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 64 || !schema || Object.keys(schema).some(key => !keys.has(key))) return false;
    if (schema.$ref) {
      const match = /^#\/components\/schemas\/([A-Za-z0-9_]+)$/u.exec(schema.$ref);
      if (!match || !Object.hasOwn(definitions, match[1]) || !visit(definitions[match[1]], item, depth + 1)) return false;
    }
    if (schema.oneOf && schema.oneOf.filter(branch => visit(branch, item, depth + 1)).length !== 1) return false;
    if (schema.anyOf && !(schema.anyOf as AiLeafSchemaDraft[]).some(branch => visit(branch, item, depth + 1))) return false;
    if (schema.allOf && !(schema.allOf as AiLeafSchemaDraft[]).every(branch => visit(branch, item, depth + 1))) return false;
    if (Object.hasOwn(schema, 'const') && JSON.stringify(canonical(item)) !== JSON.stringify(canonical(schema.const))) return false;
    if (schema.enum && !(schema.enum as unknown[]).some(choice => JSON.stringify(canonical(choice)) === JSON.stringify(canonical(item)))) return false;
    if (item === null && schema.nullable === true) return true;
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const matches = (type: string) => type === 'null' ? item === null : type === 'array' ? Array.isArray(item)
      : type === 'object' ? !!item && typeof item === 'object' && !Array.isArray(item)
        : type === 'integer' ? typeof item === 'number' && Number.isSafeInteger(item)
          : type === 'number' ? typeof item === 'number' && Number.isFinite(item) : typeof item === type;
    if (types.length && !types.some(matches)) return false;
    if (typeof item === 'number' && (!Number.isFinite(item) || typeof schema.minimum === 'number' && item < schema.minimum
      || typeof schema.maximum === 'number' && item > schema.maximum)) return false;
    if (typeof item === 'string') {
      const size = Array.from(item).length;
      if (typeof schema.minLength === 'number' && size < schema.minLength || typeof schema.maxLength === 'number' && size > schema.maxLength
        || typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(item)) return false;
      if (schema.format && (schema.format === 'date-time' ? !dateTime(item) : schema.format === 'uuid'
        ? !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(item) : true)) return false;
    }
    if (Array.isArray(item)) {
      if (typeof schema.minItems === 'number' && item.length < schema.minItems || typeof schema.maxItems === 'number' && item.length > schema.maxItems) return false;
      if (schema.uniqueItems && new Set(item.map(value => JSON.stringify(canonical(value)))).size !== item.length) return false;
      if (schema.items && !item.every(value => visit(schema.items!, value, depth + 1))) return false;
    } else if (item && typeof item === 'object' && schema.properties) {
      const row = item as Record<string, unknown>, required = schema.required ?? [];
      if (required.some(key => !Object.hasOwn(row, key)) || schema.additionalProperties === false
        && Object.keys(row).some(key => !Object.hasOwn(schema.properties!, key))) return false;
      for (const [key, child] of Object.entries(schema.properties)) {
        if (Object.hasOwn(row, key) && !(row[key] === undefined && !required.includes(key)) && !visit(child, row[key], depth + 1)) return false;
      }
    }
    return !!schema.type || !!schema.$ref || !!schema.oneOf || !!schema.anyOf || !!schema.allOf || Object.hasOwn(schema, 'const') || !!schema.enum;
  };
  try { return visit(root, value, 0); }
  catch { return false; }
}
