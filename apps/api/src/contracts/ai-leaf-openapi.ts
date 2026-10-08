import type { SchemaObject } from "./openapi-document";

/**
 * Only the JSON-Schema subset used by the authored AI leaf drafts. OpenAPI 3.0
 * has no const and takes boolean exclusive bounds; never publish those keywords
 * unchanged or silently drop a constraint. Unsupported input fails at import.
 */
export function aiLeafToOpenApi30(schema: unknown, path = "schema"): SchemaObject {
  const fail = (message: string): never => { throw new TypeError(`${path}: ${message}`); };
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return fail("expected a schema object");
  const input = schema as Record<string, unknown>;
  if (input.type === "null") {
    if (Object.keys(input).length !== 1) return fail("null-only schemas cannot have sibling constraints");
    // OpenAPI 3.0 needs a concrete nullable type; the enum keeps it null-only.
    return { type: "string", nullable: true, enum: [null] };
  }
  const output: SchemaObject = {};
  const scalar = (value: unknown): value is string | number | boolean => typeof value === "string"
    || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
  if ("$ref" in input && Object.keys(input).length !== 1) return fail("$ref siblings are not preserved by OpenAPI 3.0");
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case "$ref":
        if (typeof value !== "string" || !/^#\/components\/schemas\/[A-Za-z][A-Za-z0-9_]*$/u.test(value)) return fail("only local component references are supported");
        output.$ref = value;
        break;
      case "type":
        if (Array.isArray(value)) {
          if (value.length !== 2 || !value.includes("null")) return fail("only a single type plus null is supported");
          const nonNull = value.find(item => item !== "null");
          if (typeof nonNull !== "string" || !["object", "array", "string", "integer", "number", "boolean"].includes(nonNull)) return fail("invalid nullable type");
          output.type = nonNull;
          output.nullable = true;
          break;
        }
        if (typeof value !== "string" || !["object", "array", "string", "integer", "number", "boolean"].includes(value)) return fail("unsupported type");
        output.type = value;
        break;
      case "format": case "description": case "pattern":
        if (typeof value !== "string") return fail(`${key} must be text`);
        output[key] = value;
        break;
      case "minLength": case "maxLength": case "minItems": case "maxItems":
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(`${key} must be a non-negative safe integer`);
        output[key] = value;
        break;
      case "minimum": case "maximum":
        if (typeof value !== "number" || !Number.isFinite(value)) return fail(`${key} must be finite`);
        output[key] = value;
        break;
      case "writeOnly": case "readOnly": case "uniqueItems":
        if (typeof value !== "boolean") return fail(`${key} must be boolean`);
        output[key] = value;
        break;
      case "enum":
        if (!Array.isArray(value) || value.length === 0 || !value.every(scalar)) return fail("enum must contain finite scalar values");
        output.enum = [...value];
        break;
      case "required":
        if (!Array.isArray(value) || !value.every(item => typeof item === "string") || new Set(value).size !== value.length) return fail("invalid required keys");
        output.required = [...value];
        break;
      case "properties":
        if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid properties");
        output.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, aiLeafToOpenApi30(child, `${path}.properties.${name}`)]));
        break;
      case "items": case "not":
        output[key] = aiLeafToOpenApi30(value, `${path}.${key}`);
        break;
      case "oneOf": case "allOf": case "anyOf":
        if (!Array.isArray(value) || value.length === 0) return fail(`${key} must be a non-empty schema list`);
        output[key] = value.map((child, index) => aiLeafToOpenApi30(child, `${path}.${key}[${index}]`));
        break;
      case "additionalProperties":
        output.additionalProperties = typeof value === "boolean" ? value : aiLeafToOpenApi30(value, `${path}.${key}`);
        break;
      case "const": case "exclusiveMinimum": case "exclusiveMaximum":
        // Process these after ordinary bounds/enums, independent of object key order.
        break;
      default:
        return fail(`unsupported keyword ${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "const")) {
    if (!scalar(input.const)) return fail("only finite scalar const values are supported");
    if (output.enum && !output.enum.includes(input.const)) return fail("const conflicts with enum");
    output.enum = [input.const];
  }
  for (const [exclusive, inclusive] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]] as const) {
    if (!Object.prototype.hasOwnProperty.call(input, exclusive)) continue;
    const value = input[exclusive];
    if (typeof value !== "number" || !Number.isFinite(value)) return fail(`${exclusive} must be a finite JSON-Schema numeric bound`);
    const bound = output[inclusive];
    const inclusiveStricter = bound !== undefined && (inclusive === "minimum" ? bound > value : bound < value);
    if (!inclusiveStricter) {
      output[inclusive] = value;
      output[exclusive] = true;
    }
  }
  return output;
}
