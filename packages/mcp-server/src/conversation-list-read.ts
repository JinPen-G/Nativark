/** One owner-authorized conversation metadata page. The original reader owns
 * scope, filtering and cursor order; this adapter never aggregates or mutates pages. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_CONVERSATION_HTTP_DRAFT } from "@rental-os/shared";
import type { AiConversationListDraft, AiConversationListResponseDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface ConversationListReadBinding {
  /** Fixed publication metadata, never supplied by a client or model. */
  name: string;
  description: string;
  /** Closed external metadata projection from the original field owner. */
  outputSchema: JsonSchemaType;
  /** Current owner/space filtering and before/after authorization are mandatory.
   * Return one bounded original page, not a caller-selected owner's records. */
  read(command: AiConversationListDraft, signal: AbortSignal): Promise<unknown>;
}

/** Construct an inert metadata reader from the original public list contract.
 * @param binding - fixed original page reader and external field schema.
 * @returns one unpublished candidate requiring registry authorization/accounting/release.
 * This never fetches a following page, reports totals or starts a Task/model.
 */
export function createConversationListRead(binding: ConversationListReadBinding): McpReadTool {
  const contract = AI_CONVERSATION_HTTP_DRAFT.operations.list;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiConversationListDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiConversationListResponseDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external list schema must be a closed object");
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original list unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original list unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original list unavailable");
      const command = Object.freeze(request.value);
      const response = await read(command, signal);
      if (signal.aborted) throw new Error("Original list unavailable");
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 20 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original list unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted) throw new Error("Original list unavailable");
      const page = checked.value;
      if (page.items.length > command.limit || page.items.some(item => item.status !== command.status)) throw new Error("Original list unavailable");
      // Preserve the original cursor. A repeated/non-page cursor would turn a
      // bounded original page into a misleading or looping client continuation.
      const ids = page.items.map(item => item.conversationId);
      if (new Set(ids).size !== ids.length || page.nextBeforeId !== null
        && (page.items.length !== command.limit || page.nextBeforeId !== ids.at(-1) || page.nextBeforeId === command.beforeId)) throw new Error("Original list unavailable");
      return page;
    },
  };
}
