/**
 * Read-only MCP registration, not a business implementation. Original authorities
 * own Guard/ALS, persistent call accounting and field release. All are required;
 * no injected provider means no publication. Schemas come from their owners.
 */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { McpServer, JsonSchemaType } from "@modelcontextprotocol/server";

/** Trusted internal request identity; never a model argument or returned result. */
export interface McpReadAuthorization {
  /** The original authority must map this issuer subject, never trust model identity fields. */
  subject: string;
  token: string;
  clientId: string;
  scopes: readonly string[];
  resource: string;
}

export interface McpReadTool {
  name: string;
  description: string;
  inputSchema: JsonSchemaType;
  outputSchema: JsonSchemaType;
  /** Original read implementation; no persistence, cloud dispatch or business effect. */
  read(input: unknown, signal: AbortSignal): Promise<unknown>;
}

/** Publication policy is current; it must include original client/grant/field prerequisites. */
export interface McpReadPublication {
  allows(authorization: McpReadAuthorization, tool: McpReadTool, signal: AbortSignal): Promise<boolean>;
}

/** Run inside the original Controller-equivalent authorization/ALS and recheck before returning. */
export interface McpReadAuthority {
  withRead<T>(authorization: McpReadAuthorization, name: string, input: unknown,
    consume: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

/** Original server-persisted goal/call accounting. A local counter is not this provider. */
export interface McpReadAccounting {
  withCall<T>(authorization: McpReadAuthorization, name: string, input: unknown,
    consume: () => Promise<T>, signal: AbortSignal): Promise<T>;
}

/** Return the approved complete external projection; never pass through the original service object. */
export interface McpReadRelease {
  project(authorization: McpReadAuthorization, name: string, value: unknown, signal: AbortSignal): Promise<Record<string, unknown>>;
}

export interface McpReadTools {
  tools: readonly McpReadTool[];
  publication: McpReadPublication;
  authority: McpReadAuthority;
  accounting: McpReadAccounting;
  release: McpReadRelease;
}

/** Validate trusted registration wiring before any request can publish a partial set. */
export function validateReadTools(bindings: McpReadTools): void {
  if (bindings.tools.length > 50 || new Set(bindings.tools.map(tool => tool.name)).size !== bindings.tools.length) {
    throw new TypeError("MCP read registrations must have at most 50 unique names");
  }
  if (typeof bindings.publication.allows !== "function" || typeof bindings.authority.withRead !== "function"
    || typeof bindings.accounting.withCall !== "function" || typeof bindings.release.project !== "function") {
    throw new TypeError("MCP read registrations require original publication, authority, accounting and release providers");
  }
  for (const tool of bindings.tools) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || !tool.description || tool.description.length > 2000 || typeof tool.read !== "function") {
      throw new TypeError("Invalid MCP read registration metadata");
    }
    for (const schema of [tool.inputSchema, tool.outputSchema]) {
      if (typeof schema !== "object" || schema.type !== "object" || schema.additionalProperties !== false) {
        throw new TypeError("MCP read schemas must be closed objects from the original contract owner");
      }
      fromJsonSchema(schema); // Compile the actual advertised schema, not a second parser.
    }
  }
}

function live(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Read unavailable");
}

/** Snapshot only ordinary JSON fields, without invoking getters or toJSON. */
function releasedFields(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if ([...value].length > 2000) throw new Error("Read unavailable");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("Read unavailable");
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Read unavailable");
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype || value.length > 50
    : prototype !== Object.prototype && prototype !== null) throw new Error("Read unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const fields = array ? keys.filter(key => key !== "length") : keys;
  if (fields.some(key => typeof key !== "string") || array && fields.length !== value.length) throw new Error("Read unavailable");
  ancestors.add(value);
  try {
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of fields) {
      if (typeof key !== "string") throw new Error("Read unavailable");
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Read unavailable");
      snapshot[key] = releasedFields(descriptor.value, ancestors);
    }
    if (!array) return snapshot;
    return Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(snapshot, index)) throw new Error("Read unavailable");
      return snapshot[index];
    });
  } finally { ancestors.delete(value); }
}

/** One JSON snapshot supplies text and structured output, never two mutable projections. */
function releasedResult(output: Record<string, unknown>) {
  const text = JSON.stringify(releasedFields(output));
  if (Buffer.byteLength(text, "utf8") > 32_000) throw new Error("Read unavailable");
  const structuredContent: unknown = JSON.parse(text);
  if (structuredContent === null || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    throw new Error("Read unavailable");
  }
  return { text, structuredContent: structuredContent as Record<string, unknown> };
}

/** Register only currently published reads. The endpoint bounds the final protocol response too. */
export async function registerReadTools(server: McpServer, bindings: McpReadTools, authorization: McpReadAuthorization,
  signal: AbortSignal, revalidate: () => Promise<void>): Promise<number> {
  let count = 0;
  for (const tool of bindings.tools) {
    live(signal);
    await revalidate();
    const allowed = await bindings.publication.allows(authorization, tool, signal);
    live(signal);
    if (!allowed) continue;
    count++;
    const outputSchema = fromJsonSchema(tool.outputSchema);
    server.registerTool(tool.name, {
      description: tool.description, inputSchema: fromJsonSchema(tool.inputSchema), outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async input => {
      try {
        live(signal);
        await revalidate();
        if (!await bindings.publication.allows(authorization, tool, signal)) throw new Error("Read unavailable");
        live(signal);
        const projected = await bindings.authority.withRead(authorization, tool.name, input, () =>
          bindings.accounting.withCall(authorization, tool.name, input, async () => {
            live(signal);
            const value = await tool.read(input, signal);
            live(signal);
            const output = await bindings.release.project(authorization, tool.name, value, signal);
            live(signal);
            // Snapshot before leaving release/accounting; later mutations cannot
            // produce a different text/structured value after the return checks.
            return releasedResult(output);
          }, signal), signal);
        live(signal);
        await revalidate();
        if (!await bindings.publication.allows(authorization, tool, signal)) throw new Error("Read unavailable");
        live(signal);
        // Use the same advertised validator here to contain schema errors before
        // the SDK could echo validation details from an invalid private result.
        const validation = await outputSchema["~standard"].validate(projected.structuredContent);
        if (validation.issues) throw new Error("Read unavailable");
        live(signal);
        return { content: [{ type: "text", text: projected.text }], structuredContent: projected.structuredContent };
      } catch {
        // Internal provider failures may contain personal data, URLs or SQL.
        return { isError: true, content: [{ type: "text", text: "Read unavailable. Check current authorization in Rental OS." }] };
      }
    });
  }
  await revalidate();
  live(signal);
  return count;
}
