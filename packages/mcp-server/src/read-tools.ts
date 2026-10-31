/**
 * Read-only MCP registration, not a business implementation. Original authorities
 * own Guard/ALS, persistent call accounting and field release. All are required;
 * no injected provider means no publication. Schemas come from their owners.
 */
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { McpServer, JsonSchemaType } from "@modelcontextprotocol/server";
import { snapshotJson } from "./json-snapshot.js";

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

/** Capture one endpoint's approved definitions and provider method identities.
 * Provider state remains live: a captured publication method must still observe
 * current grants/revocation. Replacement definitions require a new endpoint.
 */
export function captureReadTools(bindings: McpReadTools): McpReadTools {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  const tools = bindings.tools.map(tool => {
    const inputSchema = structuredClone(tool.inputSchema), outputSchema = structuredClone(tool.outputSchema);
    freeze(inputSchema); freeze(outputSchema);
    return Object.freeze({ name: tool.name, description: tool.description, inputSchema, outputSchema, read: tool.read.bind(tool) });
  });
  const fixed: McpReadTools = Object.freeze({ tools: Object.freeze(tools),
    publication: Object.freeze({ allows: bindings.publication.allows.bind(bindings.publication) }),
    authority: Object.freeze({ withRead: bindings.authority.withRead.bind(bindings.authority) }),
    accounting: Object.freeze({ withCall: bindings.accounting.withCall.bind(bindings.accounting) }),
    release: Object.freeze({ project: bindings.release.project.bind(bindings.release) }),
  });
  validateReadTools(fixed);
  return fixed;
}

function live(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Read unavailable");
}

/** One JSON snapshot supplies text and structured output, never two mutable projections. */
function releasedResult(output: Record<string, unknown>) {
  const text = JSON.stringify(snapshotJson(output, { stringCharacters: 2000, arrayItems: 50 }));
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
    const originalInput = fromJsonSchema(tool.inputSchema);
    // The SDK renders validation issues before our handler. Keep its original
    // schema/converter, but never expose paths containing caller-supplied keys.
    const inputSchema: typeof originalInput = { "~standard": {
      ...originalInput["~standard"],
      validate: async value => {
        try {
          const result = await originalInput["~standard"].validate(value);
          if (!result.issues) return result;
        } catch (_error: unknown) { /* Validator failures are unavailable, never valid input. */ }
        return { issues: [{ message: "Read unavailable. Check current authorization in Rental OS." }] };
      },
    } };
    const outputSchema = fromJsonSchema(tool.outputSchema);
    server.registerTool(tool.name, {
      description: tool.description, inputSchema, outputSchema,
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
