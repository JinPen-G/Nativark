import { AI_GATEWAY_DRAFT_SCHEMAS, AI_KNOWLEDGE_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_INSPECTION_DRAFT_SCHEMAS, AI_PROPOSAL_DRAFT_SCHEMAS } from "@rental-os/shared";
import { aiLeafToOpenApi30 } from "./ai-leaf-openapi";
import type { SchemaObject } from "./openapi-document";

/** Draft components only. Publication is not route registration, authorization or activation. */
export const AI_LEAF_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {};
for (const leaf of [AI_GATEWAY_DRAFT_SCHEMAS, AI_KNOWLEDGE_DRAFT_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_INSPECTION_DRAFT_SCHEMAS, AI_PROPOSAL_DRAFT_SCHEMAS]) {
  for (const [name, schema] of Object.entries(leaf)) {
    if (Object.prototype.hasOwnProperty.call(AI_LEAF_COMPONENT_SCHEMAS, name)) throw new Error(`Duplicate AI component: ${name}`);
    AI_LEAF_COMPONENT_SCHEMAS[name] = aiLeafToOpenApi30(schema, name);
  }
}
