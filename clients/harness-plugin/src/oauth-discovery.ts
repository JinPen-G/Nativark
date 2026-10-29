/** OAuth prerequisite inspection only: no browser, callback listener, code exchange or token storage. */
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import type { AuthorizationServerMetadata } from "@modelcontextprotocol/client";
import { inspectRentalMcpConnection } from "./connection.js";
import type { ConnectionInspectionConfig } from "./connection.js";
import { boundedDiscoveryResponse, ConnectionInspectionError } from "./discovery-response.js";

export interface OAuthClientConfiguration {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
}

const fields = ["clientId", "redirectUri", "scopes", "authorizationEndpoint", "tokenEndpoint", "revocationEndpoint"];
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;

/** Parse deployment-supplied public client settings, not a server registration or grant. */
export function resolveOAuthClientConfiguration(value: unknown): OAuthClientConfiguration {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !fields.includes(key)) || fields.some(key => !(key in row))) throw new Error();
    if (typeof row.clientId !== "string" || !/^[\x21-\x7e]{1,200}$/.test(row.clientId)) throw new Error();
    if (!Array.isArray(row.scopes) || row.scopes.length < 1 || row.scopes.length > 32
      || row.scopes.some(scope => typeof scope !== "string" || !scopeToken.test(scope))
      || new Set(row.scopes).size !== row.scopes.length) throw new Error();
    const address = (raw: unknown, callback = false): string => {
      if (typeof raw !== "string") throw new Error();
      const url = new URL(raw);
      const loopback = callback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
      if ((!loopback && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
        || raw !== url.href) throw new Error();
      return url.href;
    };
    const authorizationEndpoint = address(row.authorizationEndpoint);
    const tokenEndpoint = address(row.tokenEndpoint);
    const revocationEndpoint = address(row.revocationEndpoint);
    if (new Set([authorizationEndpoint, tokenEndpoint, revocationEndpoint]).size !== 3) throw new Error();
    const scopes: string[] = [...row.scopes];
    Object.freeze(scopes);
    return Object.freeze({
      clientId: row.clientId, redirectUri: address(row.redirectUri, true),
      scopes, authorizationEndpoint, tokenEndpoint, revocationEndpoint,
    });
  } catch {
    // Configuration errors must not repeat an accidentally pasted credential.
    throw new ConnectionInspectionError("invalid_configuration");
  }
}

/**
 * Check resource discovery and RFC8414/OIDC metadata within one deadline.
 * Only a configured issuer's standard discovery paths are fetched. Endpoint
 * pins and advertised capabilities are checked, never contacted or treated as
 * evidence that the client / callback is registered or a grant is available.
 */
export async function inspectRentalOAuthConfiguration(
  connection: ConnectionInspectionConfig,
  client: OAuthClientConfiguration,
  transport: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<{ status: "oauth_metadata_compatible" }> {
  await discoverRentalOAuthMetadata(connection, client, transport, signal);
  return { status: "oauth_metadata_compatible" };
}

/** Host-only validated metadata for a single authorization attempt; never returned to chat. */
export async function discoverRentalOAuthMetadata(
  connection: ConnectionInspectionConfig,
  client: OAuthClientConfiguration,
  transport: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<AuthorizationServerMetadata> {
  const configured = resolveOAuthClientConfiguration(client);
  if (!Number.isSafeInteger(connection.timeoutMs) || connection.timeoutMs < 1 || connection.timeoutMs > 2_147_483_647) {
    throw new ConnectionInspectionError("invalid_configuration");
  }
  const captured = Object.freeze({ ...connection });
  const abort = AbortSignal.any([signal, AbortSignal.timeout(captured.timeoutMs)]);
  let onAbort: () => void = () => {};
  const inspect = async (): Promise<AuthorizationServerMetadata> => {
    const discovered = await inspectRentalMcpConnection(captured, transport, abort);
    if (abort.aborted) throw new ConnectionInspectionError("cancelled");
    const issuer = new URL(discovered.authorizationServerUrl);
    const pathname = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
    const urls = [
      `${issuer.origin}/.well-known/oauth-authorization-server${pathname}`,
      `${issuer.origin}/.well-known/openid-configuration${pathname}`,
      ...(pathname ? [`${issuer.origin}${pathname}/.well-known/openid-configuration`] : []),
    ];
    const visited = new Set<string>();
    let revocationMatches = false;
    const metadata = await discoverAuthorizationServerMetadata(issuer, {
      // Pin SDK discovery metadata to the already verified protocol generation.
      protocolVersion: "2026-07-28",
      fetchFn: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (abort.aborted) throw new ConnectionInspectionError("cancelled");
        if (!urls.includes(url) || visited.has(url) || (init?.method !== undefined && init.method !== "GET")) {
          throw new ConnectionInspectionError("untrusted_discovery");
        }
        visited.add(url);
        const response = await transport(url, {
          method: "GET", credentials: "omit", redirect: "error", signal: abort,
          headers: { Accept: "application/json", "MCP-Protocol-Version": "2026-07-28" },
        });
        if (abort.aborted) { await response.body?.cancel(); throw new ConnectionInspectionError("cancelled"); }
        if (response.redirected || (response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) {
          await response.body?.cancel();
          throw new ConnectionInspectionError("untrusted_discovery");
        }
        // Only an absent discovery document permits the SDK's standard OIDC
        // fallback. A denied / broken endpoint is not another issuer to try.
        if (response.status === 404) { await response.body?.cancel(); return new Response(null, { status: 404 }); }
        if (response.status !== 200) { await response.body?.cancel(); throw new ConnectionInspectionError("unavailable"); }
        const bounded = await boundedDiscoveryResponse(response, captured.maxMetadataBytes, abort);
        // The SDK's OIDC parser intentionally strips RFC7009 extensions. Check
        // those two required wire fields on the same bounded document before parsing.
        const wire: unknown = await bounded.clone().json();
        if (wire && typeof wire === "object" && !Array.isArray(wire)) {
          const row = wire as Record<string, unknown>;
          revocationMatches = row.revocation_endpoint === configured.revocationEndpoint
            && Array.isArray(row.revocation_endpoint_auth_methods_supported)
            && row.revocation_endpoint_auth_methods_supported.every(item => typeof item === "string")
            && row.revocation_endpoint_auth_methods_supported.includes("none");
        }
        return bounded;
      },
    });
    if (abort.aborted) throw new ConnectionInspectionError("cancelled");
    if (!metadata) throw new ConnectionInspectionError("unavailable");
    if (metadata.issuer !== issuer.href
      || metadata.authorization_endpoint !== configured.authorizationEndpoint
      || metadata.token_endpoint !== configured.tokenEndpoint
      || !revocationMatches
      || !metadata.response_types_supported.includes("code")
      || !metadata.code_challenge_methods_supported?.includes("S256")
      || !metadata.grant_types_supported?.includes("authorization_code")
      || !metadata.token_endpoint_auth_methods_supported?.includes("none")
      || configured.scopes.some(scope => !metadata.scopes_supported?.includes(scope))) {
      throw new ConnectionInspectionError("untrusted_discovery");
    }
    return metadata;
  };
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
