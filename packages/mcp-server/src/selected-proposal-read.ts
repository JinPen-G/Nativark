/** Read the original selected-order proposal review, never approve or execute.
 * Original readers verify human selection, immutable Core facts, proposal hash,
 * current Guard/ALS and Task ancestry. Private review validity is not external release. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { isDeepStrictEqual } from "node:util";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS } from "@rental-os/shared";
import type { AiHumanQuoteOrderReviewRequestDraft, AiApprovalApplicationReviewDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface SelectedProposalReadBinding {
  name: string;
  description: string;
  /** Closed reviewed external projection; the private proposal includes scope
   * and snapshot references that are not automatically allowed into a model. */
  outputSchema: JsonSchemaType;
  /** Original request-bound readSelectedProposal with current authority. Never
   * decide, prepare, reprepare or invoke the original order executor. */
  read(command: AiHumanQuoteOrderReviewRequestDraft, signal: AbortSignal): Promise<unknown>;
}

/** Build a non-published review candidate from the original shared contracts.
 * @param binding - fixed original review reader and approved external field schema.
 * @returns a read candidate requiring original authority/accounting/release. Review
 * status is not an approval or Core receipt. Missing/mismatched evidence refuses;
 * no proposal, decision, lease, execution or model invocation is created.
 */
export function createSelectedProposalRead(binding: SelectedProposalReadBinding): McpReadTool {
  const contract = AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS.readSelectedProposal;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiHumanQuoteOrderReviewRequestDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiApprovalApplicationReviewDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) {
    throw new TypeError("Original external proposal schema must be a closed object");
  }
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original proposal unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original proposal unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original proposal unavailable");
      const command = Object.freeze({ selection: Object.freeze(request.value.selection), proposal: Object.freeze(request.value.proposal) });
      const response = await read(command, signal);
      if (signal.aborted) throw new Error("Original proposal unavailable");
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 50 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original proposal unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted) throw new Error("Original proposal unavailable");
      const result = checked.value, payload = result.proposal.payload;
      if (payload.contractVersion !== command.proposal.contractVersion || payload.proposalId !== command.proposal.proposalId
        || payload.revision !== command.proposal.proposalRevision || payload.taskId !== command.selection.taskId
        || result.proposal.payloadHash !== command.proposal.reviewedPayloadHash || payload.atomicity !== "single_action"
        || payload.actions.length !== 1 || payload.actions[0]!.toolCode !== "rental.order.commit"
        || payload.actions[0]!.input.contentHash !== command.selection.inputHash
        || !isDeepStrictEqual(payload.actions[0]!.target, result.deterministic.target)) {
        throw new Error("Original proposal unavailable");
      }
      // Hash validity and exact Core/selection association are still original
      // reader obligations. This adapter never recalculates amounts or grants approval.
      return result;
    },
  };
}
