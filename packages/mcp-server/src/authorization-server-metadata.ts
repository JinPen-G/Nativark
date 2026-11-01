/** Current RFC8414 metadata publication, not an AS or resource identity.
 * Original AS readiness supplies reviewed metadata. No login, token issuance,
 * registration, network listener or fallback authorization server is created. */
import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson } from "./json-snapshot.js";

/** Original AS publication source; undefined means it cannot advertise readiness. */
export interface OriginalAuthorizationMetadata {
  read(signal: AbortSignal): Promise<OAuthMetadata | undefined>;
}

export interface AuthorizationMetadataConfig {
  enabled: boolean;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  allowedScopes: readonly string[];
  allowedOrigins: readonly string[];
  timeoutMs: number;
  maxMetadataBytes: number;
}

function address(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.href !== value || value.includes("*")) throw new TypeError("Invalid AS metadata address");
  return url;
}

const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const fields = ["issuer", "authorization_endpoint", "token_endpoint", "revocation_endpoint",
  "response_types_supported", "grant_types_supported", "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported", "revocation_endpoint_auth_methods_supported", "scopes_supported"];

function response(status: number, body?: string): Response {
  const result = new Response(body ?? null, { status });
  if (body !== undefined) result.headers.set("Content-Type", "application/json");
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Pragma", "no-cache");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

/** Publish one exact, path-aware RFC8414 document from the original current AS.
 * @param config - explicit endpoint/scope pins, origins, deadline and full byte limit.
 * @param original - current original AS metadata; absence or withdrawal returns 503.
 * @returns an inert fetch handler. Reads current publication twice, never caches,
 * issues or retries. Cancellation, changed metadata and private fields refuse the
 * document; discovery success alone proves no client registration or business grant.
 */
export function createAuthorizationServerMetadata(config: AuthorizationMetadataConfig,
  original?: OriginalAuthorizationMetadata): (request: Request) => Promise<Response> {
  const issuer = address(config.issuer), authorization = address(config.authorizationEndpoint);
  const token = address(config.tokenEndpoint), revocation = address(config.revocationEndpoint);
  const scopes = [...config.allowedScopes], allowed = new Set(scopes);
  const enabled = config.enabled, timeoutMs = config.timeoutMs, maxBytes = config.maxMetadataBytes;
  const origins = new Set(config.allowedOrigins.map(value => {
    const url = address(value);
    if (url.href !== `${url.origin}/`) throw new TypeError("AS metadata origins must be origins only");
    return url.origin;
  }));
  if (typeof enabled !== "boolean" || new Set([authorization.href, token.href, revocation.href]).size !== 3
    || scopes.length < 1 || scopes.length > 32 || allowed.size !== scopes.length || scopes.some(scope => !scopeToken.test(scope))
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65_536
    || original && typeof original.read !== "function") throw new TypeError("Invalid AS metadata publication configuration");
  const pathname = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const endpoint = `${issuer.origin}/.well-known/oauth-authorization-server${pathname}`;
  const read = original?.read.bind(original);
  return async request => {
    if (request.url !== endpoint) return response(404);
    if (!enabled || !read) return response(503);
    if (request.method !== "GET") {
      const result = response(405); result.headers.set("Allow", "GET"); return result;
    }
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin)) return response(403);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const current = async (): Promise<{ row: Record<string, unknown>; text: string }> => {
      if (signal.aborted) throw new Error("Metadata unavailable");
      const originalValue: unknown = await read(signal);
      if (signal.aborted || originalValue === undefined) throw new Error("Metadata unavailable");
      const value = snapshotJson(originalValue, { stringCharacters: 2048, arrayItems: 32 });
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata unavailable");
      const row = value as Record<string, unknown>;
      const exact = (field: string, expected: readonly string[]) => Array.isArray(row[field])
        && JSON.stringify(row[field]) === JSON.stringify(expected);
      if (Object.keys(row).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(row, key))
        || row.issuer !== issuer.href || row.authorization_endpoint !== authorization.href
        || row.token_endpoint !== token.href || row.revocation_endpoint !== revocation.href
        || !exact("response_types_supported", ["code"]) || !exact("code_challenge_methods_supported", ["S256"])
        || !exact("token_endpoint_auth_methods_supported", ["none"]) || !exact("revocation_endpoint_auth_methods_supported", ["none"])
        || !(exact("grant_types_supported", ["authorization_code"]) || exact("grant_types_supported", ["authorization_code", "refresh_token"]))
        || !Array.isArray(row.scopes_supported) || row.scopes_supported.length < 1
        || new Set(row.scopes_supported).size !== row.scopes_supported.length
        || row.scopes_supported.some(scope => typeof scope !== "string" || !allowed.has(scope))) throw new Error("Metadata unavailable");
      const text = JSON.stringify(row);
      if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Metadata unavailable");
      return { row, text };
    };
    const publish = async () => {
      const first = await current(), second = await current();
      // Object key order does not change publication; arrays and values do.
      if (signal.aborted || !isDeepStrictEqual(first.row, second.row)) throw new Error("Metadata unavailable");
      return response(200, first.text);
    };
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([publish(), new Promise<Response>(resolve => {
        onAbort = () => resolve(response(503));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
    } catch { return response(503); }
    finally { signal.removeEventListener("abort", onAbort); }
  };
}
