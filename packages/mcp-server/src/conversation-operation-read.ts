/** Exact original conversation operation receipts only. A missing receipt is
 * not proof of no commit; this adapter never replays a mutation or cancels a Task. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_CONVERSATION_HTTP_DRAFT } from "@rental-os/shared";
import type { AiConversationOperationRequestDraft, AiConversationOperationObservationDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface ConversationOperationReadBinding {
  /** Fixed metadata from the capability owner; no caller-selected operation. */
  name: string;
  description: string;
  /** Original field owner's closed MCP projection, separate from private validation. */
  outputSchema: JsonSchemaType;
  /** Current original owner/space authority and request-local ALS are required.
   * Read the exact operation key; never mutate, look up latest or recreate it. */
  read(command: AiConversationOperationRequestDraft, signal: AbortSignal): Promise<unknown>;
}

/** Build an unpublished read candidate using the original public receipt contract.
 * @param binding - fixed original operation reader and approved external schema.
 * @returns an inert candidate requiring registry authorization/accounting/release.
 * No model dispatch, listener, new operation key or business mutation is created.
 */
export function createConversationOperationRead(binding: ConversationOperationReadBinding): McpReadTool {
  const contract = AI_CONVERSATION_HTTP_DRAFT.operations.operation;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiConversationOperationRequestDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiConversationOperationObservationDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external operation schema must be a closed object");
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original operation unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original operation unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original operation unavailable");
      const command = Object.freeze(request.value);
      const response = await read(command, signal);
      if (signal.aborted) throw new Error("Original operation unavailable");
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 50 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original operation unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted || checked.value.operationKey !== command.operationKey) throw new Error("Original operation unavailable");
      return checked.value;
    },
  };
}
