/** Compatibility schema catalogue for the existing conversation and Rental
 * readers. Public readers import their own contracts and the assembler directly. */
import type { JsonSchemaType } from "@rental-os/mcp-server/original-read-tool" with { "resolution-mode": "import" };
import {
  AI_CONVERSATION_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  AI_SCENE_MODEL_OBSERVATION_SCHEMAS, AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
  AI_SCOPE_DRAFT_SCHEMAS, AI_ORDER_FACTS_DRAFT_SCHEMAS, AI_KNOWLEDGE_DRAFT_SCHEMAS,
  AI_SCENE_QUOTE_HTTP_SCHEMAS, AI_TASK_INPUT_DRAFT_SCHEMAS, AI_QUOTE_SELECTION_DRAFT_SCHEMAS,
  AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, AI_PROPOSAL_DRAFT_SCHEMAS,
} from "@rental-os/shared";

export type OriginalReadRuntime = typeof import("@rental-os/mcp-server/original-read-tool", { with: { "resolution-mode": "import" } });

/** Preserve every reachable owner reference. A Host with an unsupported schema
 * must refuse the tool; missing components cannot be replaced by loose schemas. */
export function originalReadSchema(assembleOriginalReadSchema: OriginalReadRuntime["assembleOriginalReadSchema"],
  name: string, originals: Readonly<Record<string, JsonSchemaType>> = {}): JsonSchemaType {
  const schemas = { ...AI_CONVERSATION_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS,
    ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS, ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
    ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_ORDER_FACTS_DRAFT_SCHEMAS,
    ...AI_KNOWLEDGE_DRAFT_SCHEMAS, ...AI_SCENE_QUOTE_HTTP_SCHEMAS, ...AI_TASK_INPUT_DRAFT_SCHEMAS,
    ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS, ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, ...AI_PROPOSAL_DRAFT_SCHEMAS };
  const root = schemas[name];
  if (!Object.hasOwn(schemas, name) || !root) throw new TypeError("Original result schema unavailable");
  for (const key of Object.keys(originals)) {
    if (Object.hasOwn(schemas, key)) throw new TypeError("Original result schema must not override shared components");
  }
  return assembleOriginalReadSchema(root, { ...schemas, ...originals });
}
