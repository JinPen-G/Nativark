/** Existing selected-order execution receipts only. Original selection, Task,
 * approval consumption and Core readers own association and current authority;
 * this adapter never starts, reconciles, cancels or approves an operation. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS } from "@rental-os/shared";
import type { AiSelectedQuoteTaskRequestDraft, AiSelectedQuoteTaskResultDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface SelectedOrderResultReadBinding {
  name: string;
  description: string;
  /** Approved external field schema, not the private Core or Web response. */
  outputSchema: JsonSchemaType;
  /** Original readResult under current Guard/ALS; never the task's reconcile.
   * The reader must recheck selection, Task, phase and receipt associations. */
  read(command: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal): Promise<unknown>;
}

/** Construct a non-published original selected-order result read.
 * @param binding - fixed original readResult and field owner's closed projection.
 * @returns an inert read candidate requiring original publication, authority,
 * persistent accounting and release. A selection reference grants no execution;
 * unknown/not_observed never permits retry or implies payment or fulfillment.
 */
export function createSelectedOrderResultRead(binding: SelectedOrderResultReadBinding): McpReadTool {
  const contract = AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS.readResult;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiSelectedQuoteTaskRequestDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiSelectedQuoteTaskResultDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) {
    throw new TypeError("Original external order-result schema must be a closed object");
  }
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original order result unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original order result unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original order result unavailable");
      const command = Object.freeze({ selection: Object.freeze(request.value.selection) });
      const response = await read(command, signal);
      if (signal.aborted) throw new Error("Original order result unavailable");
      // Private validation is not permission to send the original response.
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 50 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original order result unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted) throw new Error("Original order result unavailable");
      const result = checked.value;
      if (result.status === "committed" && result.source.resourceId !== result.order.id) {
        throw new Error("Original order result unavailable");
      }
      // The result contains no selection/input hash. Only the original reader
      // can attest its association; never infer an order from Task success.
      return result;
    },
  };
}
