/** Optional, current-policy MCP guidance; no business inputs, reads, tasks or authority grants. */
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpReadAuthorization } from "./read-tools.js";
import { formatReleasedGuidance } from "./instructions.js";

/** A reviewed, currently published template descriptor, not a business capability. */
export interface McpPromptDescriptor {
  name: string;
  version: string;
  description: string;
}

/** The original release policy filters both discovery and retrieval for this exact identity. */
export interface McpPromptsProvider {
  /** Return one complete bounded list of approved descriptors; never fetch business data. */
  list(authorization: McpReadAuthorization, signal: AbortSignal): Promise<readonly McpPromptDescriptor[]>;
  /** Read current reviewed guidance only; undefined means no current release, not an empty success. */
  read(authorization: McpReadAuthorization, name: string, signal: AbortSignal): Promise<{
    version: string;
    text: string;
  } | undefined>;
}

function unavailable(): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InternalError, "Guidance unavailable. Check current authorization in Rental OS.");
}

function invalid(): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, "Use a currently published Rental prompt without arguments or a cursor.");
}

/** Attach typed SDK handlers without claiming unsupported change notifications or prompt arguments. */
export function registerPrompts(server: McpServer, provider: McpPromptsProvider,
  authorization: McpReadAuthorization, signal: AbortSignal, revalidate: () => Promise<void>): void {
  server.server.registerCapabilities({ prompts: { listChanged: false } });
  const listing = async (signal: AbortSignal) => {
    if (signal.aborted) throw unavailable();
    await revalidate();
    if (signal.aborted) throw unavailable();
    const descriptors = await provider.list(authorization, signal);
    if (signal.aborted || descriptors.length > 50) throw unavailable();
    const names = new Set<string>();
    // Capture descriptor values once so a mutable provider object cannot change
    // the advertised version after its checks or supply unreviewed extra fields.
    const published = descriptors.map(descriptor => {
      const { name, version, description } = descriptor;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || names.has(name)) throw unavailable();
      names.add(name);
      return { name, version, description: formatReleasedGuidance({ version, text: description }) };
    });
    await revalidate();
    if (signal.aborted) throw unavailable();
    return published;
  };
  server.server.setRequestHandler("prompts/list", async (request, context) => {
    const requestSignal = AbortSignal.any([signal, context.mcpReq.signal]);
    if (request.params?.cursor !== undefined && request.params.cursor !== "") throw invalid();
    try {
      return { prompts: (await listing(requestSignal)).map(({ name, description }) => ({ name, description })) };
    } catch { throw unavailable(); }
  });
  server.server.setRequestHandler("prompts/get", async (request, context) => {
    const requestSignal = AbortSignal.any([signal, context.mcpReq.signal]);
    if (request.params.arguments && Object.keys(request.params.arguments).length !== 0) throw invalid();
    let descriptors;
    try { descriptors = await listing(requestSignal); }
    catch { throw unavailable(); }
    const descriptor = descriptors.find(prompt => prompt.name === request.params.name);
    if (!descriptor) throw invalid();
    try {
      const value = await provider.read(authorization, descriptor.name, requestSignal);
      if (value === undefined || requestSignal.aborted) throw unavailable();
      const { version, text } = value;
      if (version !== descriptor.version) throw unavailable();
      const released = formatReleasedGuidance({ version, text });
      const current = (await listing(requestSignal)).find(prompt => prompt.name === descriptor.name);
      if (!current || current.version !== descriptor.version || current.description !== descriptor.description) throw unavailable();
      return { description: descriptor.description, messages: [{ role: "user" as const, content: { type: "text" as const, text: released } }] };
    } catch { throw unavailable(); }
  });
}
