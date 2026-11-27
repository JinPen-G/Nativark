/** Closed original-reader adapter. The host still owns current authorization,
 * durable accounting, approved publication and the separately released fields. */
import { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { assembleNamedOriginalReadSchema } from "./assemble-original-read-schema.js";
import type { McpReadTool } from "./read-tools.js";
import { snapshotJson } from "./json-snapshot.js";

// The business owner can keep its existing closed receipt contracts and use
// the same transport validation without bringing those contracts into MCP.
export { fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
export { assembleOriginalReadSchema, assembleNamedOriginalReadSchema } from "./assemble-original-read-schema.js";
export { snapshotJson } from "./json-snapshot.js";

/** A preserved module name is not a replacement for its original owner. */
export function originalReadOwnerUnavailable(): never {
  throw new Error("Original read owner unavailable; use the owning host's reader");
}

export interface ClosedOriginalReadBinding<Input extends object> {
  name: string;
  description: string;
  outputSchema: JsonSchemaType;
  read(command: Readonly<Input>, signal: AbortSignal): Promise<unknown>;
}

function capture(value: unknown, maxBytes: number, arrayItems: number) {
  const text = JSON.stringify(snapshotJson(value, { stringCharacters: maxBytes, arrayItems }));
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Original read unavailable");
  return JSON.parse(text) as unknown;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A server owner supplies fixed contract components, never a model-selected schema. */
export function createClosedOriginalRead<Input extends object, Result extends object>(binding: ClosedOriginalReadBinding<Input>, contract: {
  request: string;
  response: string;
  components: Readonly<Record<string, JsonSchemaType>>;
  matches(command: Readonly<Input>, original: Result): boolean;
  resultItems?: number;
  unavailable: string;
}): McpReadTool {
  const inputSchema = assembleNamedOriginalReadSchema(contract.components, contract.request);
  const input = fromJsonSchema<Input>(inputSchema), result = fromJsonSchema<Result>(assembleNamedOriginalReadSchema(contract.components, contract.response));
  const outputSchema = structuredClone(binding.outputSchema), read = binding.read.bind(binding);
  if (outputSchema.type !== "object" || outputSchema.additionalProperties !== false) throw new TypeError("Original external schema must be a closed object");
  fromJsonSchema(outputSchema);
  const { resultItems = 50, unavailable } = contract, matches = contract.matches.bind(contract);
  const fail = () => new Error(unavailable);
  return { name: binding.name, description: binding.description, inputSchema, outputSchema, async read(value, signal) {
    if (signal.aborted) throw fail();
    const request = await input["~standard"].validate(capture(value, 32_768, 50));
    if (request.issues || signal.aborted) throw fail();
    const command = freeze(request.value), original = await read(command, signal);
    if (signal.aborted) throw fail();
    const checked = await result["~standard"].validate(capture(original, 131_072, resultItems));
    if (checked.issues || signal.aborted || !matches(command, checked.value)) throw fail();
    return checked.value;
  } };
}
