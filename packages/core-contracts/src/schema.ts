/**
 * 把接入合同使用的简单Zod3对象转换为OpenAPI 3.0 schema，供同版本离线文档。
 * 不生成业务实现；未支持的校验必须显式处理，不能静默丢掉约束。
 */
import { z } from "zod";

export function coreOpenApiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let result: Record<string, unknown>;
  if (schema instanceof z.ZodDefault) {
    result = { ...coreOpenApiSchema(schema._def.innerType), default: schema._def.defaultValue() };
  } else if (schema instanceof z.ZodOptional) {
    result = coreOpenApiSchema(schema.unwrap());
  } else if (schema instanceof z.ZodNullable) {
    result = { ...coreOpenApiSchema(schema.unwrap()), nullable: true };
    if (Array.isArray(result.enum)) result.enum = [...result.enum, null];
  } else if (schema instanceof z.ZodString) {
    result = { type: "string" };
    for (const check of schema._def.checks) {
      if (check.kind === "min") result.minLength = Math.max(Number(result.minLength ?? 0), check.value);
      else if (check.kind === "max") result.maxLength = Math.min(Number(result.maxLength ?? Infinity), check.value);
      else if (check.kind === "length") {
        result.minLength = Math.max(Number(result.minLength ?? 0), check.value);
        result.maxLength = Math.min(Number(result.maxLength ?? Infinity), check.value);
      }
      else if (check.kind === "regex") {
        if (result.pattern || check.regex.flags) throw new Error("OpenAPI字符串仅支持一个无flags的正则");
        result.pattern = check.regex.source;
      } else if (check.kind === "datetime") result.format = "date-time";
      else if (check.kind === "email") result.format = "email";
      else if (check.kind === "url") result.format = "uri";
      else if (check.kind === "uuid") result.format = "uuid";
      else if (check.kind === "trim") result["x-normalization"] = "trim";
      else throw new Error(`OpenAPI未支持字符串约束：${check.kind}`);
    }
  } else if (schema instanceof z.ZodNumber) {
    result = { type: schema._def.checks.some(check => check.kind === "int") ? "integer" : "number" };
    for (const check of schema._def.checks) {
      if (check.kind === "int") result.type = "integer";
      else if (check.kind === "min") {
        const value = result.type === "integer" && !check.inclusive ? Math.floor(check.value) + 1 : check.value;
        if (value >= Number(result.minimum ?? -Infinity)) {
          result.exclusiveMinimum = result.type !== "integer" && !check.inclusive || value === result.minimum && result.exclusiveMinimum === true;
          result.minimum = value;
        }
      } else if (check.kind === "max") {
        const value = result.type === "integer" && !check.inclusive ? Math.ceil(check.value) - 1 : check.value;
        if (value <= Number(result.maximum ?? Infinity)) {
          result.exclusiveMaximum = result.type !== "integer" && !check.inclusive || value === result.maximum && result.exclusiveMaximum === true;
          result.maximum = value;
        }
      } else if (check.kind === "multipleOf") {
        if (result.multipleOf !== undefined && result.multipleOf !== check.value) throw new Error("OpenAPI不合并不同的multipleOf约束");
        result.multipleOf = check.value;
      }
      else if (check.kind !== "finite") throw new Error("OpenAPI未支持数字约束");
    }
  } else if (schema instanceof z.ZodDiscriminatedUnion) {
    result = { oneOf: schema.options.map((option: z.ZodTypeAny) => coreOpenApiSchema(option)), discriminator: { propertyName: schema.discriminator } };
  } else if (schema instanceof z.ZodBoolean) result = { type: "boolean" };
  else if (schema instanceof z.ZodEnum) result = { type: "string", enum: schema.options };
  else if (schema instanceof z.ZodLiteral) {
    if (!["string", "number", "boolean"].includes(typeof schema.value)) throw new Error("OpenAPI字面量只支持字符串、数字或布尔");
    result = { type: typeof schema.value, enum: [schema.value] };
  }
  else if (schema instanceof z.ZodArray) {
    result = { type: "array", items: coreOpenApiSchema(schema.element) };
    if (schema._def.minLength) result.minItems = schema._def.minLength.value;
    if (schema._def.maxLength) result.maxItems = schema._def.maxLength.value;
    if (schema._def.exactLength) { result.minItems = schema._def.exactLength.value; result.maxItems = schema._def.exactLength.value; }
  } else if (schema instanceof z.ZodObject) {
    if (!(schema._def.catchall instanceof z.ZodNever)) throw new Error("OpenAPI对象暂不支持catchall");
    const entries = Object.entries(schema.shape) as Array<[string, z.ZodTypeAny]>;
    result = { type: "object", properties: Object.fromEntries(entries.map(([key, value]) => [key, coreOpenApiSchema(value)])) };
    const optional = (value: z.ZodTypeAny): boolean => value instanceof z.ZodOptional || value instanceof z.ZodDefault
      || value instanceof z.ZodNullable && optional(value.unwrap());
    const required = entries.filter(([, value]) => !optional(value)).map(([key]) => key);
    if (required.length) result.required = required;
    if (schema._def.unknownKeys === "strict") result.additionalProperties = false;
  } else throw new Error(`OpenAPI未支持schema类型：${schema._def.typeName}`);
  if (schema.description) result.description = schema.description;
  return result;
}
