/** Optional text resources from original policy owners. URIs are exact catalog
 * locators, never fetch targets or authority. Reads still require original
 * business authority, persistent accounting and complete field release. */
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpReadAuthorization } from "./read-tools.js";
import { snapshotJsonFields } from "./json-snapshot.js";

/** Already released discovery metadata; presence grants no permission to read. */
export interface McpResourceDescriptor {
  name: string;
  uri: string;
  version: string;
  description: string;
}

/** Original owners must classify resource reads; Resources are not a bypass of Tools limits. */
export interface McpResources {
  /** Current approved descriptors only, without reading any resource body. */
  list(authorization: McpReadAuthorization, signal: AbortSignal): Promise<readonly McpResourceDescriptor[]>;
  /** Original read-only implementation. Never follow the URI as an HTTP or file URL. */
  read(authorization: McpReadAuthorization, descriptor: Readonly<McpResourceDescriptor>, signal: AbortSignal): Promise<unknown>;
  authority: {
    /** Original Controller-equivalent Guard/ALS and before/after read checks. */
    withRead<T>(authorization: McpReadAuthorization, descriptor: Readonly<McpResourceDescriptor>,
      consume: () => Promise<T>, signal: AbortSignal): Promise<T>;
  };
  accounting: {
    /** Original durable goal or independent receipt-read limits, selected by the
     * server. An optional callback signal narrows the original remaining allowance;
     * older providers may omit it, keeping the endpoint/request cancellation. */
    withRead<T>(authorization: McpReadAuthorization, descriptor: Readonly<McpResourceDescriptor>,
      consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>;
  };
  release: {
    /** Only approved plain text or a textual original reference, never private service objects or HTML. */
    project(authorization: McpReadAuthorization, descriptor: Readonly<McpResourceDescriptor>, value: unknown,
      signal: AbortSignal): Promise<{ version: string; text: string } | undefined>;
  };
}

function unavailable(): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InternalError, "Resource unavailable. Check current authorization in Rental OS.");
}

function invalid(): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, "Use an exact currently published Rental resource URI without a cursor.");
}

/** Capture method owners, not policy state. Missing providers refuse before publication. */
export function captureResources(provider: McpResources): McpResources {
  if (typeof provider.list !== "function" || typeof provider.read !== "function"
    || typeof provider.authority?.withRead !== "function" || typeof provider.accounting?.withRead !== "function"
    || typeof provider.release?.project !== "function") throw new TypeError("MCP resources require original publication, authority, accounting and release providers");
  return Object.freeze({ list: provider.list.bind(provider), read: provider.read.bind(provider),
    authority: Object.freeze({ withRead: provider.authority.withRead.bind(provider.authority) }),
    accounting: Object.freeze({ withRead: provider.accounting.withRead.bind(provider.accounting) }),
    release: Object.freeze({ project: provider.release.project.bind(provider.release) }),
  });
}

function live(signal: AbortSignal): void {
  if (signal.aborted) throw unavailable();
}

/** Keep version attribution inside the complete 2,000-character text field. */
function textWithVersion(version: string, text: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(version) || !text.trim()) throw unavailable();
  const result = `Rental OS resource (${version})\n${text}`;
  if ([...result].length > 2000) throw unavailable();
  return result;
}

/** Register bounded exact-URI text reads with no templates, subscriptions or notifications.
 * @param server - authenticated per-request SDK server.
 * @param provider - captured original policy and read owners.
 * @param authorization - immutable current resource identity, never a model argument.
 * @param signal - complete endpoint deadline and shutdown signal.
 * @param revalidate - current resource identity check before publication and return.
 */
export function registerResources(server: McpServer, provider: McpResources, authorization: McpReadAuthorization,
  signal: AbortSignal, revalidate: () => Promise<void>): void {
  server.server.registerCapabilities({ resources: { subscribe: false, listChanged: false } });
  const listing = async (signal: AbortSignal): Promise<Readonly<McpResourceDescriptor>[]> => {
    live(signal); await revalidate(); live(signal);
    const values = await provider.list(authorization, signal);
    live(signal);
    if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length > 50
      || Reflect.ownKeys(values).length !== values.length + 1) throw unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(values), names = new Set<string>(), uris = new Set<string>();
    const result = Array.from({ length: values.length }, (_, index) => {
      const item = descriptors[index];
      if (!item?.enumerable || !Object.hasOwn(item, "value")) throw unavailable();
      const value = snapshotJsonFields(item.value, ["name", "uri", "version", "description"], { stringCharacters: 2000, arrayItems: 50 });
      const { name, uri, version, description } = value;
      if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || names.has(name)
        || typeof uri !== "string" || uris.has(uri) || typeof version !== "string" || typeof description !== "string") throw unavailable();
      const address = new URL(uri);
      if (address.protocol !== "https:" || address.origin !== new URL(authorization.resource).origin
        || address.href !== uri || address.username || address.password || address.search || address.hash) throw unavailable();
      textWithVersion(version, description);
      names.add(name); uris.add(uri);
      return Object.freeze({ name, uri, version, description });
    });
    await revalidate(); live(signal);
    return result;
  };
  server.server.setRequestHandler("resources/list", async (request, context) => {
    if (request.params?.cursor !== undefined && request.params.cursor !== "") throw invalid();
    const requestSignal = AbortSignal.any([signal, context.mcpReq.signal]);
    try {
      const resources = await listing(requestSignal);
      return { resources: resources.map(item => ({ name: item.name, uri: item.uri, mimeType: "text/plain",
        description: textWithVersion(item.version, item.description) })) };
    } catch { throw unavailable(); }
  });
  server.server.setRequestHandler("resources/templates/list", async (request, context) => {
    if (request.params?.cursor !== undefined && request.params.cursor !== "") throw invalid();
    try { live(signal); live(context.mcpReq.signal); await revalidate(); live(signal); live(context.mcpReq.signal); return { resourceTemplates: [] }; }
    catch { throw unavailable(); }
  });
  server.server.setRequestHandler("resources/read", async (request, context) => {
    const requestSignal = AbortSignal.any([signal, context.mcpReq.signal]);
    let descriptor;
    try { descriptor = (await listing(requestSignal)).find(item => item.uri === request.params.uri); }
    catch { throw unavailable(); }
    if (!descriptor) throw invalid();
    try {
      const selected = descriptor;
      const projected = await provider.authority.withRead(authorization, selected, () =>
        provider.accounting.withRead(authorization, selected, async allowanceSignal => {
          // Resource reads may narrow the same original allowance, never replace
          // endpoint or protocol cancellation with a fresh provider-only signal.
          const readSignal = allowanceSignal === undefined ? requestSignal : AbortSignal.any([requestSignal, allowanceSignal]);
          live(readSignal);
          const value = await provider.read(authorization, selected, readSignal);
          live(readSignal);
          const released = await provider.release.project(authorization, selected, value, readSignal);
          live(readSignal);
          const snapshot = snapshotJsonFields(released, ["version", "text"], { stringCharacters: 2000, arrayItems: 50 });
          if (snapshot.version !== selected.version || typeof snapshot.text !== "string") throw unavailable();
          return textWithVersion(selected.version, snapshot.text);
        }, requestSignal), requestSignal);
      live(requestSignal);
      const current = (await listing(requestSignal)).find(item => item.uri === selected.uri);
      if (!current || current.name !== selected.name || current.version !== selected.version
        || current.description !== selected.description) throw unavailable();
      return { contents: [{ uri: selected.uri, mimeType: "text/plain", text: projected }] };
    } catch { throw unavailable(); }
  });
}
