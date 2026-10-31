/** Standard authorization-code callback transport, not login or consent UI.
 * The original AS authenticates the Web request, obtains real consent and issues
 * a one-use code atomically. Only the registered callback can receive its result. */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { createPublicClientAuthorization } from "./public-client-authorization.js";
import type { PublicClientAuthorizationConfig, PublicClientRegistrations, ValidatedPublicClientAuthorization } from "./public-client-authorization.js";
import { snapshotJson } from "./json-snapshot.js";

/** Completed original human authorization, never a model-provided approval. */
export type OriginalAuthorizationOutcome =
  | { kind: "code"; code: string }
  | { kind: "denied"; error: "access_denied" };

export interface OriginalPublicClientAuthorization {
  /** Original Web authentication/consent and atomic code issuance own this operation.
   * The AS must recheck clientRevision, resource/scopes and current policy at commit.
   * request carries the original browser credentials only to the trusted AS owner.
   */
  authorize(input: ValidatedPublicClientAuthorization, request: Request, signal: AbortSignal): Promise<OriginalAuthorizationOutcome>;
}

export interface PublicClientAuthorizationEndpointConfig extends PublicClientAuthorizationConfig {
  enabled: boolean;
  issuer: string;
  allowedOrigins: readonly string[];
}

function address(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.href !== value || value.includes("*")) throw new TypeError("Invalid authorization endpoint address");
  return url;
}

function response(status: number, error?: string): Response {
  const result = error ? Response.json({ error }, { status }) : new Response(null, { status });
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Pragma", "no-cache");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

/** Deliver the original AS's completed code/denial to one current registered callback.
 * @param config - fixed issuer, endpoint/resource/scopes, origins and bounded wait.
 * @param registrations - original persistent current client registration reader.
 * @param original - original Web/AS authorization owner; absence returns 503.
 * @returns an inert handler, with no listener or login/consent page. Calls the AS
 * once, then rechecks current registration before returning a 303. Cancellation,
 * changed registration or invalid outcome suppresses redirects without claiming
 * issuance rollback; only the original AS can reconcile/revoke, never retry here.
 */
export function createPublicClientAuthorizationEndpoint(config: PublicClientAuthorizationEndpointConfig,
  registrations: PublicClientRegistrations, original?: OriginalPublicClientAuthorization): (request: Request) => Promise<Response> {
  const endpoint = address(config.authorizationEndpoint), issuer = address(config.issuer).href;
  const enabled = config.enabled, timeoutMs = config.timeoutMs;
  const origins = new Set(config.allowedOrigins.map(value => {
    const url = address(value);
    if (url.href !== `${url.origin}/`) throw new TypeError("Authorization allowed origins must be origins only");
    return url.origin;
  }));
  if (typeof enabled !== "boolean" || timeoutMs > 30_000
    || original && typeof original.authorize !== "function") throw new TypeError("Invalid authorization endpoint configuration");
  const validate = createPublicClientAuthorization(config, registrations);
  const authorize = original?.authorize.bind(original);
  return async request => {
    const url = new URL(request.url);
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname) return response(404, "not_found");
    if (!enabled || !authorize) return response(503, "server_error");
    if (request.method !== "GET") {
      const result = response(405, "invalid_request"); result.headers.set("Allow", "GET"); return result;
    }
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin)) return response(403, "invalid_request");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    let dispatched = false, onAbort: () => void = () => {};
    const complete = async () => {
      const input = await validate(request, signal);
      if (signal.aborted) throw new Error("Authorization unavailable");
      dispatched = true;
      const outcome: unknown = await authorize(input, request, signal);
      if (signal.aborted) throw new Error("Authorization unavailable");
      const snapshot = snapshotJson(outcome, { stringCharacters: 8192, arrayItems: 1 });
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Authorization unavailable");
      const row = snapshot as Record<string, unknown>;
      const callback = new URL(input.redirectUri);
      if (row.kind === "code" && Object.keys(row).length === 2 && Object.hasOwn(row, "code")
        && typeof row.code === "string" && /^[\x21-\x7e]{1,8192}$/.test(row.code)) callback.searchParams.set("code", row.code);
      else if (row.kind === "denied" && Object.keys(row).length === 2 && row.error === "access_denied") callback.searchParams.set("error", "access_denied");
      else throw new Error("Authorization unavailable");
      callback.searchParams.set("state", input.state);
      callback.searchParams.set("iss", issuer);
      if (Buffer.byteLength(callback.href, "utf8") > 16_384) throw new Error("Authorization unavailable");
      const current = await validate(request, signal);
      if (signal.aborted || JSON.stringify(current) !== JSON.stringify(input)) throw new Error("Authorization unavailable");
      const result = response(303);
      result.headers.set("Location", callback.href);
      return result;
    };
    try {
      return await Promise.race([complete(), new Promise<Response>(resolve => {
        onAbort = () => resolve(response(503, "server_error"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
    } catch (error) {
      return !dispatched && error instanceof OAuthError && error.code === OAuthErrorCode.InvalidRequest
        ? response(400, "invalid_request") : response(503, "server_error");
    } finally { signal.removeEventListener("abort", onAbort); }
  };
}
