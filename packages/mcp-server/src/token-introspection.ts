/**
 * RFC7662 resource-server introspection at a fixed trusted AS endpoint.
 * No token issuance, cache, business role mapping, or implicit retry. Its AS
 * must actually check current grant/client/tenant revocation before active=true.
 */
import { ResourceAuthorizationError } from "./resource-authorization.js";
import type { ResourceTokenVerifier, VerifiedResourceToken } from "./resource-authorization.js";

export interface IntrospectionConfiguration {
  issuer: string;
  resourceUrl: string;
  endpoint: string;
  allowedClientIds: readonly string[];
  allowedScopes: readonly string[];
  timeoutMs: number;
  maxResponseBytes: number;
}

/** Host-only AS client authentication; never obtained from an MCP caller or model. */
export interface IntrospectionClientAuthentication {
  headers(signal: AbortSignal): Promise<Headers>;
}

function secureUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== value) {
    throw new TypeError("Introspection addresses must be canonical HTTPS URLs without credentials or parameters");
  }
  return url.href;
}

/**
 * Build a verifier, not an authorization server. All settings and authentication
 * are required. A missing / broken / ambiguous AS response is unavailable, not
 * proof that a credential or its grant was revoked.
 */
export function createIntrospectionVerifier(
  configuration: IntrospectionConfiguration,
  clientAuthentication: IntrospectionClientAuthentication,
  transport: typeof globalThis.fetch,
): ResourceTokenVerifier {
  const issuer = secureUrl(configuration.issuer);
  const resource = secureUrl(configuration.resourceUrl);
  const endpoint = secureUrl(configuration.endpoint);
  if (!Number.isSafeInteger(configuration.timeoutMs) || configuration.timeoutMs < 1 || configuration.timeoutMs > 60_000
    || !Number.isSafeInteger(configuration.maxResponseBytes) || configuration.maxResponseBytes < 1 || configuration.maxResponseBytes > 65_536) {
    throw new TypeError("Introspection limits must be positive bounded integers");
  }
  const clients = new Set(configuration.allowedClientIds);
  const scopes = new Set(configuration.allowedScopes);
  if (clients.size < 1 || clients.size > 256 || clients.size !== configuration.allowedClientIds.length
    || [...clients].some(value => !/^[\x21-\x7e]{1,200}$/.test(value))
    || scopes.size > 128 || scopes.size !== configuration.allowedScopes.length
    || [...scopes].some(value => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(value))) {
    throw new TypeError("Introspection client and scope allowlists are invalid");
  }
  const { timeoutMs, maxResponseBytes } = configuration;

  return {
    async verifyAccessToken(token, options): Promise<VerifiedResourceToken> {
      if (!/^[A-Za-z0-9\-._~+/]+=*$/.test(token) || token.length > 8192) throw new ResourceAuthorizationError("invalid");
      const signal = AbortSignal.any([...(options ? [options.signal] : []), AbortSignal.timeout(timeoutMs)]);
      const request = async (): Promise<VerifiedResourceToken> => {
        const headers = new Headers(await clientAuthentication.headers(signal));
        if (signal.aborted) throw new ResourceAuthorizationError("unavailable");
        // One authenticated request to one AS; caller headers and cookies never
        // select a client identity or leak MCP credentials to another endpoint.
        if (!headers.has("authorization") || [...headers.keys()].some(key => !["authorization", "content-type", "accept"].includes(key))) {
          throw new ResourceAuthorizationError("unavailable");
        }
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        headers.set("Accept", "application/json");
        const response = await transport(endpoint, {
          method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal, headers,
          body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        });
        if (signal.aborted || response.status !== 200 || response.redirected || (response.url && response.url !== endpoint)) {
          await response.body?.cancel();
          throw new ResourceAuthorizationError("unavailable");
        }
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) {
          await response.body?.cancel(); throw new ResourceAuthorizationError("unavailable");
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => { void reader?.cancel().catch((_error: unknown) => {}); };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          if (signal.aborted) throw new ResourceAuthorizationError("unavailable");
          if (reader) while (true) {
            const item = await reader.read();
            if (signal.aborted) throw new ResourceAuthorizationError("unavailable");
            if (item.done) break;
            size += item.value.byteLength;
            if (size > maxResponseBytes) { await reader.cancel(); throw new ResourceAuthorizationError("unavailable"); }
            chunks.push(item.value);
          }
        } finally { signal.removeEventListener("abort", cancel); reader?.releaseLock(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const wire: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!wire || typeof wire !== "object" || Array.isArray(wire)) throw new ResourceAuthorizationError("unavailable");
        const row = wire as Record<string, unknown>;
        if (row.active === false) throw new ResourceAuthorizationError("invalid");
        if (row.active !== true || row.iss !== issuer || row.token_type !== "Bearer"
          || typeof row.sub !== "string" || !row.sub || row.sub.length > 200
          || typeof row.client_id !== "string" || !clients.has(row.client_id)
          || !Number.isSafeInteger(row.exp) || typeof row.exp !== "number" || row.exp <= Date.now() / 1000
          || (row.nbf !== undefined && (typeof row.nbf !== "number" || !Number.isSafeInteger(row.nbf) || row.nbf > Date.now() / 1000))
          || (row.aud !== resource && !(Array.isArray(row.aud) && row.aud.length === 1 && row.aud[0] === resource))
          || typeof row.scope !== "string") throw new ResourceAuthorizationError("invalid");
        const granted = row.scope === "" ? [] : row.scope.split(" ");
        if (new Set(granted).size !== granted.length || granted.some(scope => !scopes.has(scope))) throw new ResourceAuthorizationError("invalid");
        if (signal.aborted) throw new ResourceAuthorizationError("unavailable");
        return { subject: row.sub, clientId: row.client_id, scopes: granted, expiresAt: row.exp, resource };
      };
      let onAbort: () => void = () => {};
      try {
        return await Promise.race([
          request(),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(new ResourceAuthorizationError("unavailable"));
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          }),
        ]);
      } catch (error) {
        if (error instanceof ResourceAuthorizationError) throw error;
        throw new ResourceAuthorizationError("unavailable");
      } finally { signal.removeEventListener("abort", onAbort); }
    },
  };
}
