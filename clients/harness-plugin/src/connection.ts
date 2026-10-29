/**
 * Pre-login MCP resource discovery for the Harness connection adapter.
 * Uses the official parser; never authenticates, stores tokens, registers tools
 * or starts a model. A successful inspection means authorization is required,
 * not that the connection has acquired Rental business permission.
 */
import {
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/client";
import { boundedDiscoveryResponse, ConnectionInspectionError } from "./discovery-response.js";
export { ConnectionInspectionError } from "./discovery-response.js";
export type { ConnectionInspectionErrorCode } from "./discovery-response.js";

export interface ConnectionInspectionConfig {
  resourceUrl: string;
  authorizationServerUrl: string;
  timeoutMs: number;
  maxMetadataBytes: number;
}

export interface AuthorizationRequired {
  status: "authorization_required";
  resourceUrl: string;
  authorizationServerUrl: string;
  resourceMetadataUrl: string;
}

function httpsUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("invalid URL");
    }
    return url;
  } catch {
    throw new ConnectionInspectionError("invalid_configuration");
  }
}

/**
 * Inspect one configured resource with no credentials. Discovery URLs cannot
 * redirect or nominate a different resource / authorization server.
 * transport is the original host's HTTP adapter (an in-process adapter in tests).
 */
export async function inspectRentalMcpConnection(
  config: ConnectionInspectionConfig,
  transport: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<AuthorizationRequired> {
  const resource = httpsUrl(config.resourceUrl);
  const issuer = httpsUrl(config.authorizationServerUrl);
  for (const limit of [config.timeoutMs, config.maxMetadataBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647) {
      throw new ConnectionInspectionError("invalid_configuration");
    }
  }
  const maxMetadataBytes = config.maxMetadataBytes;
  const metadata = new URL(resource.href);
  metadata.pathname = `/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`;
  const abort = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
  let onAbort: () => void = () => {};

  async function inspect(): Promise<AuthorizationRequired> {
    const send = async (url: URL, method: "POST" | "GET"): Promise<Response> => {
      if (abort.aborted) throw new ConnectionInspectionError("cancelled");
      const response = await transport(url, {
        method, credentials: "omit", redirect: "error", signal: abort,
        headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      if (abort.aborted) { await response.body?.cancel(); throw new ConnectionInspectionError("cancelled"); }
      if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new ConnectionInspectionError("untrusted_discovery");
      }
      return response;
    };
    const challenge = await send(resource, "POST");
    if (challenge.status !== 401) {
      await challenge.body?.cancel();
      throw new ConnectionInspectionError("unavailable");
    }
    const offered = extractWWWAuthenticateParams(challenge).resourceMetadataUrl;
    await challenge.body?.cancel();
    if (offered?.href !== metadata.href) throw new ConnectionInspectionError("untrusted_discovery");
    let requested = false;
    const document = await discoverOAuthProtectedResourceMetadata(resource, { resourceMetadataUrl: metadata }, async (input, init) => {
      // The SDK may have discovery fallbacks. This adapter permits one exact GET,
      // not an open HTTP client following untrusted metadata or fallback origins.
      const url = input instanceof Request ? input.url : String(input);
      if (requested || url !== metadata.href || (init?.method !== undefined && init.method !== "GET")) {
        throw new ConnectionInspectionError("untrusted_discovery");
      }
      requested = true;
      const response = await send(metadata, "GET");
      if (response.status !== 200) { await response.body?.cancel(); throw new ConnectionInspectionError("unavailable"); }
      return boundedDiscoveryResponse(response, maxMetadataBytes, abort);
    });
    if (abort.aborted) throw new ConnectionInspectionError("cancelled");
    if (document.resource !== resource.href || document.authorization_servers?.length !== 1
      || document.authorization_servers[0] !== issuer.href
      || document.bearer_methods_supported?.length !== 1 || document.bearer_methods_supported[0] !== "header") {
      throw new ConnectionInspectionError("untrusted_discovery");
    }
    return { status: "authorization_required", resourceUrl: resource.href, authorizationServerUrl: issuer.href, resourceMetadataUrl: metadata.href };
  }

  try {
    return await Promise.race([
      inspect(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new ConnectionInspectionError("cancelled"));
        abort.addEventListener("abort", onAbort, { once: true });
        if (abort.aborted) onAbort();
      }),
    ]);
  } catch (error) {
    if (error instanceof ConnectionInspectionError) throw error;
    throw new ConnectionInspectionError("unavailable");
  } finally {
    abort.removeEventListener("abort", onAbort);
  }
}
