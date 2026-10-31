/** Standard public-client token/revocation HTTP parsing, not an authorization server.
 * The original persistent AS owns code/PKCE verification, grant policy, refresh
 * rotation/reuse and revocation atomically. No fallback issuer or local token store. */
import type { OAuthTokens } from "@modelcontextprotocol/server";
import type { PublicClientRegistrations } from "./public-client-authorization.js";
import { snapshotJson } from "./json-snapshot.js";

interface ClientRequest {
  readonly clientId: string;
  /** The AS must recheck this registration revision in its commit transaction. */
  readonly clientRevision: number;
}

export interface AuthorizationCodeExchange extends ClientRequest {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly resource: string;
}

export interface RefreshTokenExchange extends ClientRequest {
  readonly refreshToken: string;
  readonly resource: string;
}

export interface TokenRevocation extends ClientRequest {
  readonly token: string;
  readonly tokenTypeHint?: "access_token" | "refresh_token";
}

/** Return only reviewed protocol tokens; no user, grant or internal receipt fields. */
export interface OriginalOAuthTokenService {
  /** Atomic original code consumption and S256/current grant verification. */
  exchangeCode(input: AuthorizationCodeExchange, signal: AbortSignal): Promise<OAuthTokens>;
  /** Atomic original refresh rotation/reuse detection; never a second issuance loop. */
  refresh(input: RefreshTokenExchange, signal: AbortSignal): Promise<OAuthTokens>;
  /** RFC7009 unknown-token acceptance belongs to the AS, not this transport. */
  revoke(input: TokenRevocation, signal: AbortSignal): Promise<void>;
}

/** Expected protocol rejection only. Provider details must not become HTTP text. */
export class OAuthTokenRequestError extends Error {
  constructor(readonly code: "invalid_grant" | "invalid_client" | "invalid_scope") {
    super(code);
    this.name = "OAuthTokenRequestError";
  }
}

export interface OAuthTokenEndpointConfig {
  enabled: boolean;
  tokenEndpoint: string;
  revocationEndpoint: string;
  resourceUrl: string;
  allowedOrigins: readonly string[];
  allowedScopes: readonly string[];
  timeoutMs: number;
  maxRequestBytes: number;
}

function address(value: string, callback = false): URL {
  const url = new URL(value);
  const native = callback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!native && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
    || value !== url.href || value.includes("*")) throw new TypeError("Invalid OAuth endpoint address");
  return url;
}

const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const opaqueToken = (value: string) => /^[\x21-\x7e]{1,8192}$/.test(value);
const validScopes = (values: readonly string[]) => values.length >= 1 && values.length <= 32
  && new Set(values).size === values.length && values.every(value => scopeToken.test(value));

function response(status: number, error?: string): Response {
  const result = error ? Response.json({ error }, { status }) : new Response(null, { status });
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("Pragma", "no-cache");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

/** Create an inert token/revocation handler for a pre-registered public client.
 * @param config - explicit service bounds and exact trusted endpoints.
 * @param registrations - original current persistent client registration source.
 * @param original - original persistent AS; absence returns unavailable, never tokens.
 * @returns a fetch handler; no socket, login, grant, task or background work starts.
 * Each request calls the original AS at most once. Token release rechecks current
 * registration; disabled registered clients can still request original revocation.
 * Cancellation/timeout or a changed registration suppresses late tokens but cannot
 * prove code/refresh consumption or revocation was undone. Recovery stays with the
 * original grant; this handler never retries.
 */
export function createOAuthTokenEndpoint(config: OAuthTokenEndpointConfig, registrations: PublicClientRegistrations,
  original?: OriginalOAuthTokenService): (request: Request) => Promise<Response> {
  const token = address(config.tokenEndpoint), revocation = address(config.revocationEndpoint), resource = address(config.resourceUrl).href;
  const enabled = config.enabled, timeoutMs = config.timeoutMs, maxBytes = config.maxRequestBytes;
  const allowedScopes = new Set(config.allowedScopes);
  const origins = new Set(config.allowedOrigins.map(value => {
    const origin = address(value);
    if (origin.href !== `${origin.origin}/`) throw new TypeError("OAuth allowed origins must be origins only");
    return origin.origin;
  }));
  if (typeof enabled !== "boolean" || token.href === revocation.href || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 30_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65_536
    || !validScopes(config.allowedScopes) || typeof registrations?.read !== "function"
    || original && (typeof original.exchangeCode !== "function" || typeof original.refresh !== "function" || typeof original.revoke !== "function")) {
    throw new TypeError("OAuth token endpoint requires current registration and explicit service limits");
  }
  const readClient = registrations.read.bind(registrations);
  const as = original ? { exchangeCode: original.exchangeCode.bind(original), refresh: original.refresh.bind(original), revoke: original.revoke.bind(original) } : undefined;
  return async request => {
    const url = new URL(request.url);
    if (url.href !== token.href && url.href !== revocation.href) return response(404, "not_found");
    if (!enabled || !as) return response(503, "server_error");
    if (request.method !== "POST") {
      const result = response(405, "invalid_request"); result.headers.set("Allow", "POST"); return result;
    }
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin)) return response(403, "invalid_request");
    // client_id identifies a public client; it is not authentication. The AS
    // verifies code/PKCE or token ownership, never a Web cookie or secret fallback.
    if (request.headers.has("authorization") || request.headers.has("cookie") || request.headers.has("dpop")
      || !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
      return response(400, "invalid_request");
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const execute = async (): Promise<Response> => {
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return response(413, "invalid_request");
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const cancel = () => { void reader?.cancel().catch((_error: unknown) => {}); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        if (signal.aborted) throw new Error("interrupted");
        if (reader) while (true) {
          const chunk = await reader.read();
          if (signal.aborted) throw new Error("interrupted");
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); return response(413, "invalid_request"); }
          chunks.push(chunk.value);
        }
      } finally { signal.removeEventListener("abort", cancel); reader?.releaseLock(); }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      let decoded: string;
      try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(body); }
      catch (_error) { return response(400, "invalid_request"); }
      const params = new URLSearchParams(decoded);
      const revoke = url.href === revocation.href;
      const grant = params.get("grant_type");
      const fields = revoke ? ["client_id", "token", "token_type_hint"]
        : grant === "authorization_code" ? ["grant_type", "client_id", "code", "code_verifier", "redirect_uri", "resource"]
          : ["grant_type", "client_id", "refresh_token", "resource"];
      if ([...params.keys()].some(key => !fields.includes(key))
        || fields.some(key => params.getAll(key).length !== (key === "token_type_hint" ? params.has(key) ? 1 : 0 : 1))) return response(400, "invalid_request");
      const clientId = params.get("client_id")!;
      if (!/^[\x21-\x7e]{1,200}$/.test(clientId)) return response(400, "invalid_client");
      if (!revoke && !["authorization_code", "refresh_token"].includes(grant!)) return response(400, "unsupported_grant_type");
      if (!revoke && params.get("resource") !== resource) return response(400, "invalid_request");
      const secret = params.get(revoke ? "token" : grant === "authorization_code" ? "code" : "refresh_token")!;
      if (!opaqueToken(secret)) return response(400, "invalid_request");
      let redirectUri: string | undefined;
      if (grant === "authorization_code" && !revoke) {
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(params.get("code_verifier")!)) return response(400, "invalid_request");
        redirectUri = params.get("redirect_uri")!;
        try { address(redirectUri, true); } catch { return response(400, "invalid_request"); }
      }
      const hint = params.get("token_type_hint");
      if (revoke && hint !== null && hint !== "access_token" && hint !== "refresh_token") return response(400, "unsupported_token_type");
      const currentClient = async () => {
        if (signal.aborted) throw new Error("interrupted");
        const registered: unknown = await readClient(clientId, signal);
        if (signal.aborted) throw new Error("interrupted");
        if (registered === undefined) return undefined;
        const snapshot: unknown = snapshotJson(registered, { stringCharacters: 2048, arrayItems: 32 });
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
          || Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 65_536) throw new Error("unavailable");
        const row = snapshot as Record<string, unknown>;
        if (row.clientId !== clientId || !Number.isSafeInteger(row.revision) || typeof row.revision !== "number" || row.revision < 1
          || typeof row.enabled !== "boolean" || typeof row.expiresAt !== "number" || !Number.isFinite(row.expiresAt)
          || !Array.isArray(row.scopes) || !row.scopes.every(scope => typeof scope === "string") || !validScopes(row.scopes)) throw new Error("unavailable");
        return { ...row, revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt, scopes: row.scopes, redirectUris: row.redirectUris };
      };
      const row = await currentClient();
      if (!row) return response(400, "invalid_client");
      // Revocation reduces access; disabled/expired registration must not prevent
      // the original AS from checking token ownership and accepting revocation.
      if (!revoke && (!row.enabled || row.expiresAt <= Date.now() / 1000)) return response(400, "invalid_client");
      const clientScopes = row.scopes;
      if (redirectUri !== undefined) {
        if (!Array.isArray(row.redirectUris) || row.redirectUris.length < 1 || row.redirectUris.length > 32
          || !row.redirectUris.every(uri => typeof uri === "string")) throw new Error("unavailable");
        const candidate = address(redirectUri, true);
        const matches = row.redirectUris.some(uri => {
          const registered = address(uri, true);
          return registered.protocol === "http:"
            ? candidate.protocol === registered.protocol && candidate.hostname === registered.hostname && candidate.pathname === registered.pathname
            : candidate.href === registered.href;
        });
        if (!matches) return response(400, "invalid_request");
      }
      const base = { clientId, clientRevision: row.revision };
      if (revoke) {
        if (hint !== null && hint !== "access_token" && hint !== "refresh_token") return response(400, "unsupported_token_type");
        await as.revoke(Object.freeze({ ...base, token: secret, ...(hint === null ? {} : { tokenTypeHint: hint }) }), signal);
        if (signal.aborted) throw new Error("interrupted");
        return response(200);
      }
      const tokens = grant === "authorization_code"
        ? await as.exchangeCode(Object.freeze({ ...base, code: secret, codeVerifier: params.get("code_verifier")!, redirectUri: redirectUri!, resource }), signal)
        : await as.refresh(Object.freeze({ ...base, refreshToken: secret, resource }), signal);
      if (signal.aborted) throw new Error("interrupted");
      const value: unknown = snapshotJson(tokens, { stringCharacters: 8192, arrayItems: 32 });
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unavailable");
      const released = value as Record<string, unknown>;
      const tokenFields = ["access_token", "token_type", "expires_in", "scope", "refresh_token"];
      if (Object.keys(released).some(key => !tokenFields.includes(key)) || released.token_type !== "Bearer"
        || typeof released.access_token !== "string" || !/^[A-Za-z0-9\-._~+/]+=*$/.test(released.access_token) || released.access_token.length > 8192
        || typeof released.expires_in !== "number" || !Number.isSafeInteger(released.expires_in) || released.expires_in < 1 || released.expires_in > 900
        || typeof released.scope !== "string") throw new Error("unavailable");
      const scopes = released.scope.split(" ");
      if (!validScopes(scopes) || scopes.some(scope => !allowedScopes.has(scope) || !clientScopes.includes(scope))) throw new Error("unavailable");
      if (released.refresh_token !== undefined && (typeof released.refresh_token !== "string" || !opaqueToken(released.refresh_token))) throw new Error("unavailable");
      if (grant === "refresh_token" && (released.refresh_token === undefined || released.refresh_token === secret)) throw new Error("unavailable");
      const text = JSON.stringify(released);
      if (Buffer.byteLength(text, "utf8") > 65_536 || signal.aborted) throw new Error("unavailable");
      // Issuance may already have committed. Reject late release on changed
      // registration, but leave consumption/revocation recovery with the AS.
      const current = await currentClient();
      if (!current || !current.enabled || current.expiresAt <= Date.now() / 1000
        || JSON.stringify(current) !== JSON.stringify(row) || signal.aborted) throw new Error("unavailable");
      const result = response(200);
      result.headers.set("Content-Type", "application/json");
      return new Response(text, { status: result.status, headers: result.headers });
    };
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([execute(), new Promise<Response>(resolve => {
        onAbort = () => resolve(response(503, "server_error"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]);
    } catch (error) {
      return error instanceof OAuthTokenRequestError ? response(400, error.code) : response(503, "server_error");
    } finally { signal.removeEventListener("abort", onAbort); }
  };
}
