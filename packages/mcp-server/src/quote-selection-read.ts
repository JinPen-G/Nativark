/** Read an existing human quote-selection receipt, never choose or save one.
 * The original reader owns current Guard/ALS, quote basis, input hash and Task
 * ancestry. Selection metadata is not approval, execution or personal candidate data. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_QUOTE_SELECTION_HTTP_CONTRACTS } from "@rental-os/shared";
import type { AiQuoteSelectionReadDraft, AiQuoteSelectionReceiptDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface QuoteSelectionReadBinding {
  name: string;
  description: string;
  /** Original field owner's closed external projection, not the private receipt. */
  outputSchema: JsonSchemaType;
  /** Original read under current identity; must verify quote/input hashes and
   * Task ancestry before and after lookup. Never select or readAuthorized. */
  read(command: AiQuoteSelectionReadDraft, signal: AbortSignal): Promise<unknown>;
}

/** Construct an inert read of the exact saved human selection.
 * @param binding - fixed original read and field owner's external schema.
 * @returns a non-published read candidate requiring original authority,
 * persistent accounting and field release. Missing receipts remain unavailable;
 * expired/superseded selections do not grant new selection, approval or execution.
 */
export function createQuoteSelectionRead(binding: QuoteSelectionReadBinding): McpReadTool {
  const contract = AI_QUOTE_SELECTION_HTTP_CONTRACTS.read;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiQuoteSelectionReadDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiQuoteSelectionReceiptDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) {
    throw new TypeError("Original external selection schema must be a closed object");
  }
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original selection unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original selection unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original selection unavailable");
      const response = await read(Object.freeze(request.value), signal);
      if (signal.aborted) throw new Error("Original selection unavailable");
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 50 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original selection unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted || checked.value.draftVersion !== request.value.draftVersion
        || checked.value.originalInputRef !== request.value.originalInputRef || checked.value.selectionId !== request.value.selectionId) {
        throw new Error("Original selection unavailable");
      }
      return checked.value;
    },
  };
}
