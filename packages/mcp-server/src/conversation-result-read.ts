/** Existing conversation/model-result reads only. Original authority, persisted
 * accounting and external field release remain required by the MCP registry. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import {
  AI_CONVERSATION_DRAFT_VERSION, AI_CONVERSATION_HTTP_DRAFT, AI_CONVERSATION_SCHEMAS,
  AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_SCENE_MODEL_OBSERVATION_SCHEMAS,
  AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  AI_ORDER_FACTS_DRAFT_SCHEMAS, AI_KNOWLEDGE_DRAFT_SCHEMAS,
  AI_SCENE_QUOTE_HTTP_SCHEMAS, AI_TASK_INPUT_DRAFT_SCHEMAS,
} from "@rental-os/shared";
import type { AiConversationModelResultReadDraft, AiConversationModelResultResponseDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";

/** The registered name/description come from the capability owner, not a model.
 * read must use the original request/task-bound reader inside the original ALS;
 * it must not start, resume, reconcile, regenerate or dispatch a task. */
export interface ConversationResultReadBinding {
  name: string;
  description: string;
  /** Original owner's fixed components not yet exported by shared. This must
   * include AiOrderExplainRequestDraft and its dependencies, never substitute
   * permissive schemas or caller/model-provided definitions. */
  originalSchemas: Readonly<Record<string, JsonSchemaType>>;
  /** Fixed external projection schema from the original field/contract owner.
   * The larger Web observation is validated privately, never advertised as an
   * unrestricted MCP release policy or silently reduced to fit discovery. */
  outputSchema: JsonSchemaType;
  read(command: AiConversationModelResultReadDraft, signal: AbortSignal): Promise<unknown>;
}

/** Keep owner schemas and every reachable local reference intact. No keywords
 * are stripped to fit a Host's schema subset; that Host must reject unsupported tools. */
function originalSchema(name: string, originals: ConversationResultReadBinding["originalSchemas"]): JsonSchemaType {
  const schemas: Record<string, unknown> = { ...AI_CONVERSATION_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS,
    ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS, ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS,
    ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_ORDER_FACTS_DRAFT_SCHEMAS,
    ...AI_KNOWLEDGE_DRAFT_SCHEMAS, ...AI_SCENE_QUOTE_HTTP_SCHEMAS, ...AI_TASK_INPUT_DRAFT_SCHEMAS };
  for (const [key, schema] of Object.entries(originals)) {
    if (Object.hasOwn(schemas, key)) throw new TypeError("Original result schema must not override shared components");
    schemas[key] = schema;
  }
  const root = AI_CONVERSATION_SCHEMAS[name];
  if (!root) throw new TypeError("Original result schema unavailable");
  const reachable: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "$ref") { visit(child); continue; }
      if (typeof child !== "string" || !child.startsWith("#/components/schemas/")) throw new TypeError("Original result schema reference unavailable");
      const reference = child.slice("#/components/schemas/".length);
      if (Object.hasOwn(reachable, reference)) continue;
      const target = schemas[reference];
      if (!target) throw new TypeError(`Original result schema reference unavailable: ${reference}`);
      reachable[reference] = target;
      visit(target);
    }
  };
  visit(root);
  // The public branches are closed object roots. The explicit type meets MCP's
  // object-root requirement without weakening the original exact-one branches.
  const properties = root.properties ?? Object.fromEntries(root.oneOf?.flatMap(branch =>
    Object.keys(branch.properties ?? {}).map(key => [key, {}])) ?? []);
  const schema = { type: "object", ...structuredClone(root), properties: structuredClone(properties),
    additionalProperties: false, components: { schemas: structuredClone(reachable) } };
  return schema;
}

/** Build an inert read candidate from the public shared export. This does not
 * publish a capability, grant access, install an HTTP proxy or start a listener.
 * @param binding - fixed capability metadata and the original read-only adapter.
 * @returns a candidate requiring the registry's original policy/accounting/release.
 */
export function createConversationResultRead(binding: ConversationResultReadBinding): McpReadTool {
  const contract = AI_CONVERSATION_HTTP_DRAFT.operations.modelResult;
  const inputSchema = originalSchema(contract.request, binding.originalSchemas);
  const originalOutputSchema = originalSchema(contract.response, binding.originalSchemas);
  const input = fromJsonSchema<AiConversationModelResultReadDraft>(inputSchema);
  const output = fromJsonSchema<AiConversationModelResultResponseDraft>(originalOutputSchema);
  const outputSchema = structuredClone(binding.outputSchema);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external result schema must be a closed object");
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original result unavailable");
      const request = await input["~standard"].validate(value);
      if (request.issues || signal.aborted) throw new Error("Original result unavailable");
      const command = Object.freeze(structuredClone(request.value));
      const response = await binding.read(command, signal);
      if (signal.aborted) throw new Error("Original result unavailable");
      const checked = await output["~standard"].validate(response);
      if (checked.issues || signal.aborted) throw new Error("Original result unavailable");
      const result = checked.value;
      if (result.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || result.conversationId !== command.conversationId
        || result.admissionKey !== command.admissionKey || result.turn.admissionKey !== command.admissionKey) throw new Error("Original result unavailable");
      if (result.status === "material_erased") {
        if (result.turn.material !== "erased") throw new Error("Original result unavailable");
      } else {
        const turn = result.turn, observed = result.result;
        if (turn.material !== "retained" || !turn.task || observed.resultId !== command.resultId
          || observed.original.inputRef !== turn.original.inputRef || observed.original.requestKey !== turn.originalRequestKey
          || observed.sceneCode !== turn.capabilityCode || observed.original.sceneVersion !== turn.capabilityVersion
          || observed.taskId !== turn.task.taskId) throw new Error("Original result unavailable");
      }
      return result;
    },
  };
}
