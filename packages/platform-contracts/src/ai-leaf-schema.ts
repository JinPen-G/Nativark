/** Browser/Node neutral JSON-Schema builders reused by the other owned leaf drafts. */
export interface AiLeafSchemaDraft {
  [key: string]: unknown;
  type?: string | readonly string[]; properties?: Record<string, AiLeafSchemaDraft>; required?: readonly string[];
  items?: AiLeafSchemaDraft; oneOf?: readonly AiLeafSchemaDraft[]; $ref?: string;
}
export const leafRef = (name: string): AiLeafSchemaDraft => ({ $ref: `#/components/schemas/${name}` });
export const leafEnum = (...values: readonly string[]): AiLeafSchemaDraft => ({ type: "string", enum: values });
export const leafText = (maxLength = 191, minLength = 1): AiLeafSchemaDraft => ({ type: "string", minLength, maxLength });
export const leafId = (): AiLeafSchemaDraft => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
export const leafInt = (minimum = 0, maximum = 2147483647): AiLeafSchemaDraft => ({ type: "integer", minimum, maximum });
export const leafList = (items: AiLeafSchemaDraft, maxItems = 64, minItems = 0): AiLeafSchemaDraft => ({ type: "array", items, minItems, maxItems });
export const leafClosed = (properties: Record<string, AiLeafSchemaDraft>, required: readonly string[] = Object.keys(properties)): AiLeafSchemaDraft => ({ type: "object", properties, required, additionalProperties: false });
export const leafTime: AiLeafSchemaDraft = { type: "string", format: "date-time", minLength: 20, maxLength: 40 };
