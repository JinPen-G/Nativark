/** Validate one browser authorization request against current pre-registration.
 * This is not an OAuth AS: original login, consent, grant storage and atomic code
 * issuance remain the AS owner's responsibility. No redirect or token is issued. */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson } from "./json-snapshot.js";

/** Current public client metadata from the original persistent registration owner. */
export interface RegisteredPublicClient {
  clientId: string;
  revision: number;
  enabled: boolean;
  expiresAt: number;
  redirectUris: readonly string[];
  scopes: readonly string[];
}

export interface PublicClientRegistrations {
  /** Read current metadata once, without dynamic registration or URL fetching. */
  read(clientId: string, signal: AbortSignal): Promise<RegisteredPublicClient | undefined>;
}

export interface PublicClientAuthorizationConfig {
  authorizationEndpoint: string;
  resourceUrl: string;
  allowedScopes: readonly string[];
  timeoutMs: number;
}

/** AS-only request snapshot, not consent, original identity or an issuance permit. */
export interface ValidatedPublicClientAuthorization {
  readonly clientId: string;
  readonly clientRevision: number;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly codeChallenge: string;
}

const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const fields = ["response_type", "client_id", "redirect_uri", "resource", "scope", "state", "code_challenge", "code_challenge_method"];

function canonicalAddress(value: string, callback = false): URL {
  const url = new URL(value);
  const loopback = callback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!loopback && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
    || url.href !== value || value.includes("*")) throw new TypeError("Invalid public client address");
  return url;
}

function matchesCallback(requested: string, registered: string): boolean {
  const candidate = canonicalAddress(requested, true), original = canonicalAddress(registered, true);
  if (original.protocol !== "http:") return candidate.href === original.href;
  // RFC8252 native loopback permits the OS-selected port only. Scheme, numeric
  // host and the exact registered path remain fixed; no localhost DNS exception.
  return candidate.protocol === original.protocol && candidate.hostname === original.hostname
    && candidate.pathname === original.pathname;
}

function invalid(): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidRequest, "Invalid registered public client authorization request");
}

function unavailable(): OAuthError {
  return new OAuthError(OAuthErrorCode.ServerError, "Current public client registration unavailable");
}

/** Build an inert AS precheck using current persistent public client metadata.
 * @param config - pinned AS endpoint, single resource and service scope ceiling.
 * @param registrations - original registration reader; absent evidence fails closed.
 * @returns a request validator; it never logs in, redirects, registers or issues.
 * Issuance must recheck this revision atomically with current identity and consent;
 * passing this precheck alone grants no business access. Unknown fields, duplicate
 * parameters, non-S256 requests and unregistered callbacks/scopes are rejected.
 */
export function createPublicClientAuthorization(config: PublicClientAuthorizationConfig,
  registrations: PublicClientRegistrations): (request: Request, signal: AbortSignal) => Promise<ValidatedPublicClientAuthorization> {
  const endpoint = canonicalAddress(config.authorizationEndpoint), resource = canonicalAddress(config.resourceUrl).href;
  const allowed = new Set(config.allowedScopes);
  if (allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length
    || [...allowed].some(scope => !scopeToken.test(scope)) || !Number.isSafeInteger(config.timeoutMs)
    || config.timeoutMs < 1 || config.timeoutMs > 60_000 || typeof registrations?.read !== "function") {
    throw new TypeError("Public client authorization requires pinned configuration and current registration");
  }
  const timeoutMs = config.timeoutMs, read = registrations.read.bind(registrations);
  return async (request, signal) => {
    const abort = AbortSignal.any([signal, request.signal, AbortSignal.timeout(timeoutMs)]);
    const parse = () => {
      const url = new URL(request.url);
      if (abort.aborted || request.method !== "GET" || url.origin !== endpoint.origin || url.pathname !== endpoint.pathname
        || url.username || url.password || url.hash || Buffer.byteLength(url.href, "utf8") > 8192) throw invalid();
      const params = url.searchParams;
      if ([...params.keys()].some(key => !fields.includes(key)) || fields.some(key => params.getAll(key).length !== 1)
        || params.get("response_type") !== "code" || params.get("resource") !== resource
        || params.get("code_challenge_method") !== "S256") throw invalid();
      const clientId = params.get("client_id")!, redirectUri = params.get("redirect_uri")!;
      const state = params.get("state")!, codeChallenge = params.get("code_challenge")!;
      const scopes = params.get("scope")!.split(" ");
      if (!/^[\x21-\x7e]{1,200}$/.test(clientId) || !/^[\x21-\x7e]{1,1024}$/.test(state)
        || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
        || Buffer.from(codeChallenge, "base64url").toString("base64url") !== codeChallenge
        || scopes.length < 1 || scopes.length > 32 || new Set(scopes).size !== scopes.length
        || scopes.some(scope => !scopeToken.test(scope) || !allowed.has(scope))) throw invalid();
      canonicalAddress(redirectUri, true);
      return { clientId, redirectUri, resource, scopes: Object.freeze(scopes), state, codeChallenge };
    };
    let command: ReturnType<typeof parse>;
    try { command = parse(); } catch { throw invalid(); }
    const current = async (): Promise<RegisteredPublicClient> => {
      if (abort.aborted) throw unavailable();
      let value: unknown;
      try { value = await read(command.clientId, abort); }
      catch { throw unavailable(); }
      if (abort.aborted) throw unavailable();
      if (value === undefined) throw invalid();
      try {
        const text = JSON.stringify(snapshotJson(value, { stringCharacters: 2048, arrayItems: 32 }));
        if (Buffer.byteLength(text, "utf8") > 65_536) throw unavailable();
        const row: RegisteredPublicClient = JSON.parse(text);
        if (row.clientId !== command.clientId || !Number.isSafeInteger(row.revision) || row.revision < 1
          || typeof row.enabled !== "boolean" || !Number.isFinite(row.expiresAt)
          || !Array.isArray(row.redirectUris) || row.redirectUris.length < 1 || row.redirectUris.length > 32
          || new Set(row.redirectUris).size !== row.redirectUris.length
          || !Array.isArray(row.scopes) || row.scopes.length < 1 || row.scopes.length > 32
          || new Set(row.scopes).size !== row.scopes.length || row.scopes.some(scope => typeof scope !== "string" || !scopeToken.test(scope))) throw unavailable();
        for (const uri of row.redirectUris) { if (typeof uri !== "string") throw unavailable(); canonicalAddress(uri, true); }
        if (!row.enabled || row.expiresAt <= Date.now() / 1000
          || !row.redirectUris.some(uri => matchesCallback(command.redirectUri, uri))
          || command.scopes.some(scope => !row.scopes.includes(scope))) throw invalid();
        return row;
      } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw unavailable();
      }
    };
    const validate = async () => {
      const first = await current();
      const second = await current();
      // Persistent object key order is not a registration change. Array order,
      // extra facts and every value still participate in this exact comparison.
      if (abort.aborted || !isDeepStrictEqual(first, second)) throw unavailable();
      return Object.freeze({ ...command, clientRevision: first.revision });
    };
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([validate(), new Promise<never>((_, reject) => {
        onAbort = () => reject(unavailable());
        abort.addEventListener("abort", onAbort, { once: true });
        if (abort.aborted) onAbort();
      })]);
    } finally { abort.removeEventListener("abort", onAbort); }
  };
}
