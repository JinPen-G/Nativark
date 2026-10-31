/** Original request-bound Task/step observations only. A recovery hint is not
 * permission to claim, cancel, resume, reconcile or execute the original action. */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import { AI_SCENE_REQUEST_HTTP_CONTRACTS } from "@rental-os/shared";
import type { AiSceneRequestReadDraft, AiSceneRequestRecoveryDraft } from "@rental-os/shared";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";
import { originalReadSchema } from "./original-read-schema.js";

export interface OriginalTaskRecoveryReadBinding {
  /** Fixed capability metadata, never selected by a caller or model. */
  name: string;
  description: string;
  /** Original field owner's closed external projection. Schema validity does
   * not authorize release; the MCP registry still requires all policy providers. */
  outputSchema: JsonSchemaType;
  /** Must call the original request-bound recovery reader inside its current
   * authority/ALS. It owns task association and before/after identity checks. */
  read(command: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
}

/** Construct an inert candidate using the original shared runtime contract.
 * Missing identity, persistent accounting or field providers must keep it unpublished.
 * @param binding - fixed original reader and external field schema from their owners.
 * @returns a read-only candidate; this never starts a listener or recovers a task.
 */
export function createOriginalTaskRecoveryRead(binding: OriginalTaskRecoveryReadBinding): McpReadTool {
  const contract = AI_SCENE_REQUEST_HTTP_CONTRACTS.recovery;
  const inputSchema = originalReadSchema(contract.request);
  const input = fromJsonSchema<AiSceneRequestReadDraft>(inputSchema);
  const originalOutput = fromJsonSchema<AiSceneRequestRecoveryDraft>(originalReadSchema(contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external recovery schema must be a closed object");
  fromJsonSchema(outputSchema);
  return {
    name: binding.name, description: binding.description, inputSchema, outputSchema,
    async read(value, signal) {
      if (signal.aborted) throw new Error("Original recovery unavailable");
      const requestText = JSON.stringify(snapshotJson(value, { stringCharacters: 32_768, arrayItems: 50 }));
      if (Buffer.byteLength(requestText, "utf8") > 32_768) throw new Error("Original recovery unavailable");
      const request = await input["~standard"].validate(JSON.parse(requestText));
      if (request.issues || signal.aborted) throw new Error("Original recovery unavailable");
      const response = await read(Object.freeze(request.value), signal);
      if (signal.aborted) throw new Error("Original recovery unavailable");
      // Private validation is separate from the stricter registry release limits.
      const text = JSON.stringify(snapshotJson(response, { stringCharacters: 131_072, arrayItems: 50 }));
      if (Buffer.byteLength(text, "utf8") > 131_072) throw new Error("Original recovery unavailable");
      const checked = await originalOutput["~standard"].validate(JSON.parse(text));
      if (checked.issues || signal.aborted) throw new Error("Original recovery unavailable");
      // The public response carries no inputRef. Only the original reader can
      // attest that task/step locators belong to the captured request; do not infer
      // execution or zero consumption from absent metadata or terminal task state.
      return checked.value;
    },
  };
}
