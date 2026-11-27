/** Existing conversation/model-result reads only. Original authority, persisted
 * accounting and external field release remain required by the MCP registry. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS,
  type AiConversationModelResultReadDraft } from "@rental-os/platform-contracts/ai-original-result";
import { AI_CONVERSATION_HTTP_DRAFT, type AiConversationModelResultResponseDraft } from "@rental-os/shared";
import type { McpReadTool } from "@rental-os/mcp-server" with { "resolution-mode": "import" };
import type { JsonSchemaType } from "@rental-os/mcp-server/original-read-tool" with { "resolution-mode": "import" };
import type { OriginalReadRuntime } from "./original-read-schema";
import { originalReadSchema } from "./original-read-schema";

/** The registered name/description come from the capability owner, not a model.
 * read must use the original request/task-bound reader inside the original ALS;
 * it must not start, resume, reconcile, regenerate or dispatch a task. */
export interface RentalConversationResultReadBinding {
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

/** Use the public locator and the original complete result contract. This does not
 * publish a capability, grant access, install an HTTP proxy or start a listener.
 * @param binding - fixed capability metadata and the original read-only adapter.
 * @returns a candidate requiring the registry's original policy/accounting/release.
 */
export function createRentalConversationResultRead(binding: RentalConversationResultReadBinding, runtime: Pick<OriginalReadRuntime, "assembleOriginalReadSchema" | "fromJsonSchema" | "snapshotJson">): McpReadTool {
  const { assembleOriginalReadSchema, fromJsonSchema, snapshotJson } = runtime;
  const contract = AI_CONVERSATION_HTTP_DRAFT.operations.modelResult;
  const inputSchema = assembleOriginalReadSchema(AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS.AiConversationModelResultReadDraft,
    AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS);
  const originalOutputSchema = originalReadSchema(assembleOriginalReadSchema, contract.response, binding.originalSchemas);
  const input = fromJsonSchema<AiConversationModelResultReadDraft>(inputSchema);
  const output = fromJsonSchema<AiConversationModelResultResponseDraft>(originalOutputSchema);
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external result schema must be a closed object");
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original result unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original result unavailable");
      const requestSnapshot: unknown = JSON.parse(requestText);
      const request = await input["~standard"].validate(requestSnapshot);
      if (request.issues || signal.aborted) throw new Error("Original result unavailable");
      const command = Object.freeze(request.value);
      const response = await read(command, signal);
      if (signal.aborted) throw new Error("Original result unavailable");
      // This private Web observation has its own original 128 KiB limit. The
      // stricter MCP field/response limits still apply after original release.
      const encoded = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 1000 }));
      if (Buffer.byteLength(encoded, "utf8") > 131_072) throw new Error("Original result unavailable");
      const snapshot: unknown = JSON.parse(encoded);
      const checked = await output["~standard"].validate(snapshot);
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
