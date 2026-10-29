/**
 * Protected MCP transport with optional original-authorized read registrations.
 * This does not issue grants or resolve Rental business identity. Production must
 * supply current authorization/accounting/release providers; importing starts no listener.
 */
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from "@modelcontextprotocol/server";

import { ResourceAuthorizationError } from "./resource-authorization.js";
import type { ResourceTokenVerifier, VerifiedResourceToken } from "./resource-authorization.js";
export { ResourceAuthorizationError } from "./resource-authorization.js";
export type { ResourceTokenVerifier, VerifiedResourceToken } from "./resource-authorization.js";
export { createIntrospectionVerifier } from "./token-introspection.js";
export type { IntrospectionConfiguration, IntrospectionClientAuthentication } from "./token-introspection.js";
import { registerReadTools, validateReadTools } from "./read-tools.js";
import type { McpReadAuthorization, McpReadTools } from "./read-tools.js";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { releasedInstructions } from "./instructions.js";
import type { McpInstructionsProvider } from "./instructions.js";
export type { McpInstructionsProvider } from "./instructions.js";
import { registerPrompts } from "./prompts.js";
import type { McpPromptsProvider } from "./prompts.js";
export type { McpPromptsProvider, McpPromptDescriptor } from "./prompts.js";
export type { McpReadTools, McpReadTool, McpReadAuthorization, McpReadPublication,
  McpReadAuthority, McpReadAccounting, McpReadRelease } from "./read-tools.js";

export interface ProtectedMcpConfig {
  enabled: boolean;
  resourceUrl: string;
  authorizationServerUrl: string;
  allowedOrigins: readonly string[];
  maxRequestBytes: number;
  authorizationTimeoutMs: number;
  readTools?: McpReadTools;
  instructions?: McpInstructionsProvider;
  prompts?: McpPromptsProvider;
}

export interface ProtectedMcpEndpoint {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function httpsUrl(value: string, field: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${field} must be an HTTPS URL without credentials, query or fragment`);
  }
  return url;
}

function positiveLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError(`${field} must be a positive bounded integer`);
  }
}

function reply(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** An access token cannot change subjects while a response is being prepared. */
function sameIdentity(current: VerifiedResourceToken, authorization: McpReadAuthorization): boolean {
  return current.subject === authorization.subject && current.clientId === authorization.clientId
    && current.resource === authorization.resource && Number.isFinite(current.expiresAt)
    && current.expiresAt > Date.now() / 1000 && new Set(current.scopes).size === current.scopes.length
    && current.scopes.length === authorization.scopes.length
    && current.scopes.every(scope => authorization.scopes.includes(scope));
}

/**
 * Construct an inert, web-standard MCP handler, with RFC 9728 discovery.
 * An absent verifier is unavailable, never an anonymous/allow-all adapter.
 * No business capability is registered until its original authority is wired.
 */
export function createProtectedMcpEndpoint(
  config: ProtectedMcpConfig,
  verifier?: ResourceTokenVerifier,
): ProtectedMcpEndpoint {
  const resource = httpsUrl(config.resourceUrl, "resourceUrl");
  const issuer = httpsUrl(config.authorizationServerUrl, "authorizationServerUrl");
  if (resource.pathname.startsWith("/.well-known/")) throw new TypeError("resourceUrl must not occupy discovery routes");
  if (typeof config.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
  positiveLimit(config.maxRequestBytes, "maxRequestBytes");
  positiveLimit(config.authorizationTimeoutMs, "authorizationTimeoutMs");
  const enabled = config.enabled;
  const maxRequestBytes = config.maxRequestBytes;
  const authorizationTimeoutMs = config.authorizationTimeoutMs;
  const allowedOrigins = new Set(config.allowedOrigins.map(value => {
    const origin = httpsUrl(value, "allowedOrigins");
    if (origin.href !== `${origin.origin}/`) throw new TypeError("allowedOrigins must contain origins only");
    return origin.origin;
  }));
  const metadataUrl = new URL(getOAuthProtectedResourceMetadataUrl(resource));
  const shutdown = new AbortController();
  let closed = false;
  let closing: Promise<void> | undefined;

  // Keep subject metadata on the verified SDK auth object only; it must not be
  // projected into protocol metadata, instructions or a tool response.
  const identities = new WeakMap<AuthInfo, McpReadAuthorization>();
  const readTools = config.readTools;
  const instructionsProvider = config.instructions;
  const promptsProvider = config.prompts;
  const boundedOutput = readTools !== undefined || instructionsProvider !== undefined || promptsProvider !== undefined;
  if (readTools) validateReadTools(readTools);
  if (promptsProvider && (typeof promptsProvider.list !== "function" || typeof promptsProvider.read !== "function")) {
    throw new TypeError("MCP prompts require original current publication and guidance providers");
  }
  const handler = createMcpHandler(async context => {
    const authorization = context.authInfo ? identities.get(context.authInfo) : undefined;
    if (context.authInfo && !authorization) throw new ResourceAuthorizationError("unavailable");
    let instructions: string | undefined;
    if (instructionsProvider && authorization && context.requestInfo) {
      instructions = await releasedInstructions(instructionsProvider, authorization, context.requestInfo.signal);
    }
    const server = new McpServer(
      { name: "rental-os", version: "0.1.0" },
      { capabilities: { tools: {} }, instructions },
    );
    if (authorization && context.requestInfo && verifier) {
      // The request signal already includes the endpoint's complete read deadline.
      const signal = AbortSignal.any([context.requestInfo.signal, shutdown.signal]);
      const revalidate = async () => {
        if (signal.aborted) throw new ResourceAuthorizationError("unavailable");
        const current = await verifier.verifyAccessToken(authorization.token, { signal });
        if (!sameIdentity(current, authorization) || signal.aborted) throw new ResourceAuthorizationError("invalid");
      };
      const count = readTools ? await registerReadTools(server, readTools, authorization, signal, revalidate) : 0;
      // registerTool owns validation / era projection. If nothing is currently
      // published, advertise an empty list without a fake business result.
      if (count === 0) server.server.setRequestHandler("tools/list", async () => ({ tools: [] }));
      if (promptsProvider) registerPrompts(server, promptsProvider, authorization, signal, revalidate);
    } else {
      server.server.setRequestHandler("tools/list", async () => ({ tools: [] }));
    }
    return server;
  }, { legacy: "stateless", responseMode: "auto", maxRequestBodySize: maxRequestBytes });

  const authenticate = (signal: AbortSignal) => requireBearerAuth({
    resourceMetadataUrl: metadataUrl.href,
    verifier: {
      async verifyAccessToken(token) {
        if (!verifier) throw new OAuthError(OAuthErrorCode.ServerError, "Authorization unavailable");
        let verified: VerifiedResourceToken;
        try {
          verified = await verifier.verifyAccessToken(token, { signal });
        } catch (error) {
          if (error instanceof ResourceAuthorizationError && error.kind === "unavailable") {
            throw new OAuthError(OAuthErrorCode.ServerError, "Authorization unavailable");
          }
          // A provider's exception can contain a token, SQL or remote response body.
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or unavailable authorization");
        }
        if (typeof verified.subject !== "string" || !verified.subject || verified.subject.length > 200
          || verified.resource !== resource.href || !verified.clientId
          || !Number.isFinite(verified.expiresAt) || verified.expiresAt <= Date.now() / 1000
          || new Set(verified.scopes).size !== verified.scopes.length) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid resource authorization");
        }
        const authorization: McpReadAuthorization = Object.freeze({
          subject: verified.subject, token, clientId: verified.clientId,
          scopes: Object.freeze([...verified.scopes]), resource: resource.href,
        });
        const auth: AuthInfo = {
          token, clientId: authorization.clientId, scopes: [...authorization.scopes],
          expiresAt: verified.expiresAt, resource: new URL(resource.href), resourceMetadataUrl: metadataUrl.href,
        };
        identities.set(auth, authorization);
        return auth;
      },
    },
  });

  async function fetch(request: Request): Promise<Response> {
    if (closed) return noStore(reply(503, "mcp_closed"));
    const url = new URL(request.url);
    if (url.origin !== resource.origin || url.username || url.password || url.search || url.hash) {
      return noStore(reply(404, "not_found"));
    }
    const origin = request.headers.get("origin");
    if (origin !== null && !allowedOrigins.has(origin)) return noStore(reply(403, "origin_not_allowed"));
    if (!enabled) return noStore(reply(503, "mcp_disabled"));
    if (url.pathname === metadataUrl.pathname) {
      if (request.method !== "GET") return noStore(new Response(null, { status: 405, headers: { Allow: "GET" } }));
      if (!verifier) return noStore(reply(503, "authorization_unavailable"));
      // Resource metadata belongs here; AS metadata is served by the actual AS,
      // not fabricated at the resource origin from a login URL.
      return noStore(Response.json({
        resource: resource.href,
        authorization_servers: [issuer.href],
        bearer_methods_supported: ["header"],
        resource_name: "Rental OS",
      }));
    }
    if (url.pathname !== resource.pathname) return noStore(reply(404, "not_found"));
    if (request.method !== "POST") return noStore(new Response(null, { status: 405, headers: { Allow: "POST" } }));
    if (!verifier) return noStore(reply(503, "authorization_unavailable"));
    const authorization = request.headers.get("authorization");
    // Do not let comma-separated or trailing credentials be silently accepted.
    if (authorization !== null && !/^Bearer [A-Za-z0-9\-._~+/]+=*$/i.test(authorization)) {
      return noStore(bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "Invalid Authorization header"),
        { resourceMetadataUrl: metadataUrl.href },
      ));
    }
    if (request.signal.aborted) return noStore(reply(408, "request_cancelled"));
    const deadline = AbortSignal.any([request.signal, shutdown.signal,
      ...(boundedOutput ? [AbortSignal.timeout(15_000)] : [])]);
    const abort = AbortSignal.any([deadline, AbortSignal.timeout(authorizationTimeoutMs)]);
    let onAbort: () => void = () => {};
    try {
      const auth = await Promise.race([
        authenticate(abort)(request),
        new Promise<Response>(resolve => {
          onAbort = () => resolve(reply(503, "authorization_interrupted"));
          abort.addEventListener("abort", onAbort, { once: true });
          if (abort.aborted) onAbort();
        }),
      ]);
      if (auth instanceof Response) return noStore(auth);
      // Disconnection during verification does not permit its late result to dispatch.
      if (closed || abort.aborted) return noStore(reply(503, "authorization_interrupted"));
      const authorization = identities.get(auth);
      if (!authorization) return noStore(reply(503, "authorization_unavailable"));
      if (!boundedOutput) return noStore(await handler.fetch(request, { authInfo: auth }));
      const readRequest = new Request(request, { signal: deadline });
      let releaseAbort: () => void = () => {};
      const serve = async () => {
        const response = await handler.fetch(readRequest, { authInfo: auth });
        const declared = response.headers.get("content-length");
        if (deadline.aborted || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 65_536))) {
          await response.body?.cancel();
          throw new ResourceAuthorizationError("unavailable");
        }
        const reader = response.body?.getReader();
        const cancel = () => {
          // Cancellation is best effort; the deadline still rejects every late byte.
          void reader?.cancel().catch((_error: unknown) => {});
        };
        deadline.addEventListener("abort", cancel, { once: true });
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          if (deadline.aborted) throw new ResourceAuthorizationError("unavailable");
          if (reader) while (true) {
            const chunk = await reader.read();
            if (deadline.aborted) throw new ResourceAuthorizationError("unavailable");
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 65_536) { await reader.cancel(); throw new ResourceAuthorizationError("unavailable"); }
            chunks.push(chunk.value);
          }
        } finally { deadline.removeEventListener("abort", cancel); reader?.releaseLock(); }
        // Hold every byte until current resource identity is rechecked. Original
        // authority/release providers own the business-specific return checks.
        const current = await verifier!.verifyAccessToken(auth.token, { signal: deadline });
        if (deadline.aborted || !sameIdentity(current, authorization)) {
          throw new ResourceAuthorizationError("invalid");
        }
        const output = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        return new Response([204, 205, 304].includes(response.status) ? null : output,
          { status: response.status, headers: response.headers });
      };
      try {
        return noStore(await Promise.race([
          serve(),
          new Promise<Response>(resolve => {
            releaseAbort = () => resolve(reply(503, "read_unavailable"));
            deadline.addEventListener("abort", releaseAbort, { once: true });
            if (deadline.aborted) releaseAbort();
          }),
        ]));
      } catch {
        return noStore(reply(503, "read_unavailable"));
      } finally { deadline.removeEventListener("abort", releaseAbort); }
    } finally {
      abort.removeEventListener("abort", onAbort);
    }
  }

  return {
    fetch,
    close() {
      if (closing) return closing;
      closed = true;
      shutdown.abort();
      closing = handler.close();
      return closing;
    },
  };
}
