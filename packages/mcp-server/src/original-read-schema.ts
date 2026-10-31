/** Private schema assembly for original read adapters. Owner components and all
 * constraints survive; this is neither a public DTO nor a field release policy. */
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import {
  AI_CONVERSATION_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  AI_SCENE_MODEL_OBSERVATION_SCHEMAS, AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
  AI_SCOPE_DRAFT_SCHEMAS, AI_ORDER_FACTS_DRAFT_SCHEMAS, AI_KNOWLEDGE_DRAFT_SCHEMAS,
  AI_SCENE_QUOTE_HTTP_SCHEMAS, AI_TASK_INPUT_DRAFT_SCHEMAS, AI_QUOTE_SELECTION_DRAFT_SCHEMAS,
  AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, AI_PROPOSAL_DRAFT_SCHEMAS,
} from "@rental-os/shared";

/** Preserve every reachable owner reference. A Host with an unsupported schema
 * must refuse the tool; missing components cannot be replaced by loose schemas. */
export function originalReadSchema(name: string, originals: Readonly<Record<string, JsonSchemaType>> = {}): JsonSchemaType {
  const schemas = { ...AI_CONVERSATION_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS,
    ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS, ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
    ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_ORDER_FACTS_DRAFT_SCHEMAS,
    ...AI_KNOWLEDGE_DRAFT_SCHEMAS, ...AI_SCENE_QUOTE_HTTP_SCHEMAS, ...AI_TASK_INPUT_DRAFT_SCHEMAS,
    ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS, ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, ...AI_PROPOSAL_DRAFT_SCHEMAS };
  const root = schemas[name];
  if (!root) throw new TypeError("Original result schema unavailable");
  const definitions: Record<string, unknown> = { ...schemas };
  for (const [key, schema] of Object.entries(originals)) {
    if (Object.hasOwn(definitions, key)) throw new TypeError("Original result schema must not override shared components");
    definitions[key] = schema;
  }
  const reachable: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "$ref") { visit(child); continue; }
      if (typeof child !== "string" || !child.startsWith("#/components/schemas/")) throw new TypeError("Original result schema reference unavailable");
      const reference = child.slice("#/components/schemas/".length);
      if (Object.hasOwn(reachable, reference)) continue;
      const target = definitions[reference];
      if (!target) throw new TypeError(`Original result schema reference unavailable: ${reference}`);
      reachable[reference] = target;
      visit(target);
    }
  };
  visit(root);
  // Explicit object roots meet MCP's requirement without weakening exact-one
  // closed owner branches. The union keys do not replace branch constraints.
  const properties = root.properties ?? Object.fromEntries(root.oneOf?.flatMap(branch =>
    Object.keys(branch.properties ?? {}).map(key => [key, {}])) ?? []);
  const schema = { type: "object", ...structuredClone(root), properties: structuredClone(properties),
    additionalProperties: false, components: { schemas: structuredClone(reachable) } };
  return schema;
}
