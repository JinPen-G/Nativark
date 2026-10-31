/**
 * One process-local OAuth connection owned by the exact human-command session.
 * Secrets stay in private fields / closures, never in Harness credentials or logs.
 * This is not isolation from malicious same-process plugins or OS administrators.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Client, StreamableHTTPClientTransport, startAuthorization, exchangeAuthorization, refreshAuthorization } from "@modelcontextprotocol/client";
import type { AuthorizationServerMetadata, OAuthTokens, Tool, CallToolResult, Prompt } from "@modelcontextprotocol/client";
import { discoverRentalOAuthMetadata, resolveOAuthClientConfiguration } from "./oauth-discovery.js";
import type { OAuthClientConfiguration } from "./oauth-discovery.js";
import type { ConnectionInspectionConfig } from "./connection.js";
import { boundedDiscoveryResponse } from "./discovery-response.js";

export interface LoginConfiguration {
  enabled: boolean;
  attemptTimeoutMs: number;
  sessionLifetimeMs: number;
  maxAccessTtlSeconds: number;
  callbackMode: "host" | "loopback";
}

/** The Host adapter owns callback routes and browser launching, not credentials. */
export interface OAuthInteraction {
  prepareCallback(redirectUri: string, receive: (request: Request) => Response, signal: AbortSignal): Promise<{
    redirectUri: string;
    close(): Promise<void>;
  }>;
  openBrowser(url: URL): Promise<void>;
}

export type OAuthSessionState = "disconnected" | "connecting" | "connected" | "expired" | "unknown" | "other_session";
export type OAuthSessionErrorCode = "disabled" | "busy" | "other_session" | "cancelled" | "unavailable" | "unknown";
export class OAuthSessionError extends Error {
  constructor(readonly code: OAuthSessionErrorCode) {
    super(`Rental OAuth: ${code}`);
    this.name = "OAuthSessionError";
  }
}

/** Released Prompt metadata for explicit human selection; not an execution permit. */
export interface RentalPrompt {
  name: string;
  version: string;
  description: string;
}

/** One currently published text resource, selected by name rather than a model URI. */
export interface RentalResource {
  name: string;
  uri: string;
  version: string;
  description: string;
}

function resourceText(text: string): { version: string; text: string } {
  const matched = /^Rental OS resource \(([A-Za-z0-9._-]{1,64})\)\n([\s\S]+)$/.exec(text);
  if (!matched || !matched[2]!.trim() || [...text].length > 2000) throw new OAuthSessionError("unavailable");
  return { version: matched[1]!, text };
}

/** Extract only this server's bounded versioned guidance, without interpolation. */
function promptGuidance(text: string): { version: string; text: string } {
  const matched = /^Rental OS guidance \(([A-Za-z0-9._-]{1,64})\)\n([\s\S]+)$/.exec(text);
  if (!matched || !matched[2]!.trim() || [...text].length > 2000) throw new OAuthSessionError("unavailable");
  return { version: matched[1]!, text };
}

/** RFC7009 acceptance is not independent proof that the whole grant was revoked. */
export interface DisconnectResult {
  remote: "accepted" | "not_confirmed" | "not_required";
}

interface Credential {
  access: string;
  refresh?: string;
  expiresAt: number;
  deadline: number;
  metadata: AuthorizationServerMetadata;
}

/** A finite operation stops accepting late results; its transport still owns actual termination. */
function wait<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new OAuthSessionError("cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
    if (signal.aborted) abort();
  });
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function callbackReply(status: number): Response {
  return new Response(null, { status, headers: {
    "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff",
  } });
}

/**
 * Own login, lazy refresh and one authenticated MCP connection. No token getter
 * is published. Unknown exchange/refresh outcomes block reuse even after local disconnect.
 * A new instance never recovers a grant from disk or another session.
 */
export class RentalOAuthSession {
  readonly #connection: ConnectionInspectionConfig;
  readonly #oauth: OAuthClientConfiguration;
  readonly #config: LoginConfiguration;
  readonly #fetch: typeof globalThis.fetch;
  readonly #interaction: OAuthInteraction;
  #owner: object | undefined;
  #credential: Credential | undefined;
  #client: Client | undefined;
  #instructions = "";
  #lifetime = new AbortController();
  #pending: Promise<void> | undefined;
  #refreshing: Promise<string> | undefined;
  #unknown = false;
  #invalid = false;
  #closed = false;
  #disconnecting: Promise<DisconnectResult> | undefined;
  readonly #checks = new Set<Promise<unknown>>();
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #onExpiry: (result: DisconnectResult) => void;
  readonly #withdraw: () => void;

  constructor(connection: ConnectionInspectionConfig, oauth: OAuthClientConfiguration, config: LoginConfiguration,
    transport: typeof globalThis.fetch, interaction: OAuthInteraction, onExpiry: (result: DisconnectResult) => void,
    withdraw: () => void) {
    this.#connection = Object.freeze({ ...connection });
    this.#oauth = resolveOAuthClientConfiguration(oauth);
    this.#config = Object.freeze({ ...config });
    this.#fetch = transport;
    this.#interaction = interaction;
    this.#onExpiry = onExpiry;
    this.#withdraw = withdraw;
  }

  status(owner: object): OAuthSessionState {
    if (this.#owner && owner !== this.#owner) return "other_session";
    if (this.#unknown) return "unknown";
    if (this.#pending) return "connecting";
    if (!this.#credential || !this.#client) return "disconnected";
    if (this.#invalid) return "expired";
    if (Date.now() >= this.#credential.deadline || (!this.#credential.refresh && Date.now() >= this.#credential.expiresAt)) return "expired";
    return "connected";
  }

  /** Only the exact bound session can consume the last successfully discovered guidance. */
  instructions(owner: object): string {
    return this.status(owner) === "connected" ? this.#instructions : "";
  }

  #admitInstructions(value: string | undefined): string {
    if (value === undefined) return "";
    if ([...value].length > 2000 || Buffer.byteLength(value, "utf8") > 65_536) throw new OAuthSessionError("unavailable");
    return value;
  }

  /** Human-only entry. The callback code and browser URL never become a command result. */
  async login(owner: object, signal: AbortSignal): Promise<void> {
    if (this.#closed || !this.#config.enabled) throw new OAuthSessionError("disabled");
    if (this.#owner && this.#owner !== owner) throw new OAuthSessionError("other_session");
    if (this.#unknown) throw new OAuthSessionError("unknown");
    if (this.#pending || this.#credential || this.#disconnecting) throw new OAuthSessionError("busy");
    this.#owner = owner;
    const lifetime = this.#lifetime;
    const abort = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(this.#config.attemptTimeoutMs)]);
    const run = this.#login(abort);
    this.#pending = run;
    try { await run; }
    finally { if (this.#pending === run) this.#pending = undefined; }
  }

  async #login(signal: AbortSignal): Promise<void> {
    let closeCallback: (() => Promise<void>) | undefined;
    let redirectUri = this.#oauth.redirectUri;
    let mayHaveGrant = false;
    try {
      const metadata = await discoverRentalOAuthMetadata(this.#connection, this.#oauth, this.#fetch, signal);
      const state = randomBytes(32).toString("base64url");
      if (signal.aborted) throw new OAuthSessionError("cancelled");
      let receive!: (value: { code: string; iss?: string }) => void;
      let deny!: (error: Error) => void;
      const callback = new Promise<{ code: string; iss?: string }>((resolve, reject) => { receive = resolve; deny = reject; });
      void callback.catch((_error: unknown) => {}); // The browser launcher may fail before the callback is awaited.
      let consumed = false;
      const callbackServer = await this.#interaction.prepareCallback(this.#oauth.redirectUri, request => {
        if (signal.aborted || consumed) return callbackReply(410);
        const url = new URL(request.url);
        const expected = new URL(redirectUri);
        if (request.method !== "GET" || url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash
          || url.username || url.password || url.href.length > 8192
          || [...url.searchParams.keys()].some(key => !["code", "state", "iss", "error", "error_description", "error_uri"].includes(key))
          || [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)
          || !sameSecret(url.searchParams.get("state") ?? "", state)) return callbackReply(400);
        const iss = url.searchParams.get("iss") ?? undefined;
        if ((iss !== undefined && iss !== metadata.issuer)
          || (metadata.authorization_response_iss_parameter_supported === true && iss === undefined)) return callbackReply(400);
        const code = url.searchParams.get("code");
        if (url.searchParams.has("error")) {
          if (code !== null) return callbackReply(400);
          consumed = true;
          // A validated access_denied response ends this attempt without code
          // exchange. Other AS errors do not establish the grant's outcome.
          if (url.searchParams.get("error") === "access_denied") mayHaveGrant = false;
          deny(new OAuthSessionError("cancelled"));
          return callbackReply(204);
        }
        if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) return callbackReply(400);
        consumed = true;
        receive({ code, iss });
        return callbackReply(204);
      }, signal);
      closeCallback = () => callbackServer.close();
      redirectUri = callbackServer.redirectUri;
      const expectedRedirect = new URL(this.#oauth.redirectUri), actualRedirect = new URL(redirectUri);
      if (actualRedirect.protocol !== expectedRedirect.protocol || actualRedirect.hostname !== expectedRedirect.hostname
        || actualRedirect.pathname !== expectedRedirect.pathname || actualRedirect.search || actualRedirect.hash
        || actualRedirect.username || actualRedirect.password
        || (this.#config.callbackMode === "host" && actualRedirect.href !== expectedRedirect.href)) {
        throw new OAuthSessionError("unavailable");
      }
      const started = await startAuthorization(this.#connection.authorizationServerUrl, {
        metadata, clientInformation: { client_id: this.#oauth.clientId },
        redirectUrl: redirectUri, resource: this.#connection.resourceUrl,
        scope: this.#oauth.scopes.join(" "), state,
      });
      if (signal.aborted) throw new OAuthSessionError("cancelled");
      mayHaveGrant = true; // Browser consent may exist even if no usable code reaches this Host.
      await wait(this.#interaction.openBrowser(started.authorizationUrl), signal);
      const result = await wait(callback, signal);
      if (signal.aborted) throw new OAuthSessionError("cancelled");
      const tokens = await wait(exchangeAuthorization(this.#connection.authorizationServerUrl, {
        metadata, clientInformation: { client_id: this.#oauth.clientId },
        authorizationCode: result.code, iss: result.iss, codeVerifier: started.codeVerifier,
        redirectUri, resource: this.#connection.resourceUrl,
        fetchFn: this.#tokenFetch(signal),
      }), signal);
      if (signal.aborted) throw new OAuthSessionError("cancelled");
      this.#credential = this.#admit(tokens, metadata, Date.now() + this.#config.sessionLifetimeMs);
      this.#scheduleExpiry(this.#credential);
      const client = new Client({ name: "rental-os-harness", version: "0.1.0" }, {
        capabilities: {}, versionNegotiation: { mode: { pin: "2026-07-28" } },
      });
      this.#client = client;
      const lifetime = this.#lifetime.signal;
      const transport = new StreamableHTTPClientTransport(new URL(this.#connection.resourceUrl), {
        // Deliberately omit onUnauthorized: a 401 must not replay a business request.
        authProvider: { token: () => this.#accessToken(lifetime) },
        onInsufficientScope: "throw", reconnectionScheduler: () => {},
        fetch: (input, init) => this.#resourceFetch(input, init, lifetime),
      });
      await wait(client.connect(transport, { signal, timeout: this.#connection.timeoutMs }), signal);
      if (signal.aborted) throw new OAuthSessionError("cancelled");
      this.#instructions = this.#admitInstructions(client.getInstructions());
    } catch (error) {
      this.#instructions = "";
      const client = this.#client;
      this.#client = undefined;
      this.#unknown = mayHaveGrant;
      if (!mayHaveGrant) this.#owner = undefined;
      try { await client?.close(); }
      catch { this.#unknown = true; }
      if (this.#unknown) throw new OAuthSessionError("unknown");
      throw new OAuthSessionError(signal.aborted ? "cancelled" : error instanceof OAuthSessionError ? error.code : "unavailable");
    } finally {
      try { await closeCallback?.(); }
      catch {
        // Callback disposal is part of login completion. A failed command must
        // not leave a connected client; keep known tokens only for revocation.
        this.#unknown = true;
        this.#instructions = "";
        this.#lifetime.abort();
        this.#withdraw();
        clearTimeout(this.#expiryTimer);
        this.#expiryTimer = undefined;
        const client = this.#client;
        this.#client = undefined;
        try { await client?.close(); }
        catch { this.#unknown = true; }
        throw new OAuthSessionError("unknown");
      }
    }
  }

  #scheduleExpiry(credential: Credential): void {
    clearTimeout(this.#expiryTimer);
    const until = credential.refresh ? credential.deadline : Math.min(credential.deadline, credential.expiresAt);
    this.#expiryTimer = setTimeout(() => {
      // The timer withdraws local use; it cannot assert remote revocation.
      void this.disconnect(this.#owner ?? this).then(this.#onExpiry).catch((_error: unknown) => {
        this.#lifetime.abort();
        this.#credential = undefined;
        this.#unknown = true;
      });
    }, Math.max(1, until - Date.now()));
  }

  #admit(tokens: OAuthTokens, metadata: AuthorizationServerMetadata, deadline: number): Credential {
    const scopes = tokens.scope === undefined ? this.#oauth.scopes : tokens.scope.split(" ");
    if (deadline <= Date.now() || tokens.token_type.toLowerCase() !== "bearer" || !/^[A-Za-z0-9\-._~+/]+=*$/.test(tokens.access_token)
      || tokens.access_token.length > 8192 || !Number.isSafeInteger(tokens.expires_in) || !tokens.expires_in
      || tokens.expires_in < 1 || tokens.expires_in > this.#config.maxAccessTtlSeconds
      || scopes.length !== this.#oauth.scopes.length || new Set(scopes).size !== scopes.length
      || scopes.some(scope => !this.#oauth.scopes.includes(scope))
      || (tokens.refresh_token !== undefined && (!tokens.refresh_token || tokens.refresh_token.length > 8192 || /[\x00-\x20\x7f]/.test(tokens.refresh_token)))) {
      throw new OAuthSessionError("unknown");
    }
    return { access: tokens.access_token, refresh: tokens.refresh_token,
      expiresAt: Math.min(Date.now() + tokens.expires_in * 1000, deadline), deadline, metadata };
  }

  #tokenFetch(signal: AbortSignal): typeof globalThis.fetch {
    let used = false;
    return async (input, init) => {
      if (used || String(input) !== this.#oauth.tokenEndpoint || init?.method !== "POST" || signal.aborted) throw new OAuthSessionError("unavailable");
      used = true;
      const response = await this.#fetch(input, { ...init, credentials: "omit", redirect: "error", signal });
      if (signal.aborted) { await response.body?.cancel(); throw new OAuthSessionError("cancelled"); }
      if (response.redirected || (response.url && response.url !== this.#oauth.tokenEndpoint)) {
        await response.body?.cancel(); throw new OAuthSessionError("unknown");
      }
      return boundedDiscoveryResponse(response, 65_536, signal);
    };
  }

  async #accessToken(signal: AbortSignal): Promise<string> {
    if (signal.aborted || this.#unknown || this.#invalid || this.#closed) throw new OAuthSessionError("unavailable");
    const credential = this.#credential;
    if (!credential || Date.now() >= credential.deadline) throw new OAuthSessionError("unavailable");
    if (Date.now() < credential.expiresAt) return credential.access;
    if (!credential.refresh) throw new OAuthSessionError("unavailable");
    this.#refreshing ??= this.#refresh(credential, signal).finally(() => { this.#refreshing = undefined; });
    return this.#refreshing;
  }

  async #refresh(credential: Credential, signal: AbortSignal): Promise<string> {
    const abort = AbortSignal.any([signal, AbortSignal.timeout(this.#connection.timeoutMs)]);
    try {
      const tokens = await wait(refreshAuthorization(this.#connection.authorizationServerUrl, {
        metadata: credential.metadata, clientInformation: { client_id: this.#oauth.clientId },
        refreshToken: credential.refresh!, resource: this.#connection.resourceUrl, fetchFn: this.#tokenFetch(abort),
      }), abort);
      if (abort.aborted || credential !== this.#credential || !tokens.refresh_token || tokens.refresh_token === credential.refresh) {
        throw new OAuthSessionError("unknown");
      }
      this.#credential = this.#admit(tokens, credential.metadata, credential.deadline);
      return this.#credential.access;
    } catch {
      this.#unknown = true;
      this.#withdraw();
      throw new OAuthSessionError("unknown");
    }
  }

  async #resourceFetch(input: string | URL | Request, init: RequestInit | undefined, lifetime: AbortSignal): Promise<Response> {
    if (String(input) !== this.#connection.resourceUrl || lifetime.aborted || this.#unknown || this.#invalid || !this.#credential
      || Date.now() >= this.#credential.expiresAt) throw new OAuthSessionError("unavailable");
    const signal = AbortSignal.any([lifetime, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(this.#connection.timeoutMs)]);
    const send = async () => {
      const response = await this.#fetch(input, { ...init, credentials: "omit", redirect: "error", signal });
      if (signal.aborted || response.redirected || (response.url && response.url !== this.#connection.resourceUrl)) {
        await response.body?.cancel(); throw new OAuthSessionError("unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        this.#invalid = true;
        this.#withdraw();
        await response.body?.cancel();
        return new Response(null, { status: response.status });
      }
      // Keep late-response cleanup inside the operation, even if its caller
      // already stopped waiting; no unbounded protocol stream reaches the SDK.
      return boundedDiscoveryResponse(response, 65_536, signal);
    };
    return wait(send(), signal);
  }

  /** Revalidate this session with the modern protocol's server/discover, not legacy ping or a business tool. */
  async check(owner: object, signal: AbortSignal): Promise<void> {
    if (owner !== this.#owner) throw new OAuthSessionError("other_session");
    if (!this.#client || this.#pending || this.#unknown) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(this.#connection.timeoutMs)]);
    const operation = wait(client.discover({ signal: abort, timeout: this.#connection.timeoutMs }), abort).then(result => {
      // Concurrent requests can invalidate the same client without replacing it.
      // Only a still-current connection may publish a successful discovery.
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected") throw new OAuthSessionError("unavailable");
      this.#instructions = this.#admitInstructions(result.instructions);
    });
    this.#checks.add(operation);
    try { await operation; }
    catch {
      this.#instructions = "";
      throw new OAuthSessionError(this.#unknown ? "unknown" : "unavailable");
    }
    finally { this.#checks.delete(operation); }
  }

  /** One bounded tool listing, no pagination aggregation or automatic retries. */
  async listTools(owner: object, signal: AbortSignal): Promise<Tool[]> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = wait(client.listTools({ cursor: "" }, { cacheMode: "bypass", signal: abort, timeout: 15_000 }), abort);
    this.#checks.add(operation);
    try {
      const listed = await operation;
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || listed.nextCursor !== undefined
        || listed.tools.length > 50 || new Set(listed.tools.map(tool => tool.name)).size !== listed.tools.length) {
        throw new OAuthSessionError("unavailable");
      }
      return listed.tools;
    } catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** One explicit bounded Prompt discovery; no aggregation, text read or model dispatch. */
  async listPrompts(owner: object, signal: AbortSignal): Promise<RentalPrompt[]> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = wait(client.listPrompts({ cursor: "" }, { cacheMode: "bypass", signal: abort, timeout: 15_000 }), abort);
    this.#checks.add(operation);
    try {
      const listed = await operation;
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || listed.nextCursor !== undefined
        || listed.prompts.length > 50 || new Set(listed.prompts.map(prompt => prompt.name)).size !== listed.prompts.length) throw new OAuthSessionError("unavailable");
      return listed.prompts.map((prompt: Prompt) => {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(prompt.name) || !prompt.description || prompt.arguments?.length) throw new OAuthSessionError("unavailable");
        const description = promptGuidance(prompt.description);
        return { name: prompt.name, version: description.version, description: description.text };
      });
    } catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** Retrieve one current no-argument template under the original shared deadline. */
  async getPrompt(owner: object, name: string, signal: AbortSignal): Promise<RentalPrompt & { text: string }> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = (async () => {
      const descriptor = (await this.listPrompts(owner, abort)).find(prompt => prompt.name === name);
      if (!descriptor || abort.aborted) throw new OAuthSessionError("unavailable");
      const result = await wait(client.getPrompt({ name }, { signal: abort, timeout: 15_000 }), abort);
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || !result.description
        || result.messages.length !== 1 || result.messages[0]?.role !== "user" || result.messages[0].content.type !== "text") throw new OAuthSessionError("unavailable");
      const description = promptGuidance(result.description);
      const guidance = promptGuidance(result.messages[0].content.text);
      if (description.version !== descriptor.version || description.text !== descriptor.description
        || guidance.version !== descriptor.version) throw new OAuthSessionError("unavailable");
      return { ...descriptor, text: result.messages[0].content.text };
    })();
    this.#checks.add(operation);
    try { return await operation; }
    catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** Read one current resource catalog without aggregating pages or fetching bodies. */
  async listResources(owner: object, signal: AbortSignal): Promise<RentalResource[]> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = wait(client.listResources({ cursor: "" }, { cacheMode: "bypass", signal: abort, timeout: 15_000 }), abort);
    this.#checks.add(operation);
    try {
      const listed = await operation;
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || listed.nextCursor !== undefined
        || listed.resources.length > 50 || new Set(listed.resources.map(item => item.name)).size !== listed.resources.length
        || new Set(listed.resources.map(item => item.uri)).size !== listed.resources.length) throw new OAuthSessionError("unavailable");
      return listed.resources.map(item => {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(item.name) || item.mimeType !== "text/plain" || !item.description) throw new OAuthSessionError("unavailable");
        const uri = new URL(item.uri);
        if (uri.href !== item.uri || uri.origin !== new URL(this.#connection.resourceUrl).origin || uri.protocol !== "https:"
          || uri.username || uri.password || uri.search || uri.hash) throw new OAuthSessionError("unavailable");
        const description = resourceText(item.description);
        return { name: item.name, uri: item.uri, version: description.version, description: description.text };
      });
    } catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** Fetch one exact listed name on the same connection, with version and post-read catalog checks. */
  async getResource(owner: object, name: string, signal: AbortSignal): Promise<RentalResource & { text: string }> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = (async () => {
      const descriptor = (await this.listResources(owner, abort)).find(item => item.name === name);
      if (!descriptor || abort.aborted) throw new OAuthSessionError("unavailable");
      const result = await wait(client.readResource({ uri: descriptor.uri }, { cacheMode: "bypass", signal: abort, timeout: 15_000 }), abort);
      const content = result.contents[0];
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || result.contents.length !== 1
        || !content || content.uri !== descriptor.uri || content.mimeType !== "text/plain" || !("text" in content)
        || "blob" in content) throw new OAuthSessionError("unavailable");
      const released = resourceText(content.text);
      const current = (await this.listResources(owner, abort)).find(item => item.name === descriptor.name);
      if (!current || current.uri !== descriptor.uri || current.version !== descriptor.version || current.description !== descriptor.description
        || released.version !== descriptor.version || abort.aborted || client !== this.#client || this.status(owner) !== "connected") throw new OAuthSessionError("unavailable");
      return { ...descriptor, text: released.text };
    })();
    this.#checks.add(operation);
    try { return await operation; }
    catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** Execute once through the owned standard client. Original MCP permissions/accounting remain mandatory. */
  async callTool(owner: object, tool: Tool, input: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    if (this.status(owner) !== "connected" || !this.#client || signal.aborted) throw new OAuthSessionError("unavailable");
    const client = this.#client;
    const abort = AbortSignal.any([signal, this.#lifetime.signal, AbortSignal.timeout(Math.min(15_000, this.#connection.timeoutMs))]);
    const operation = wait(client.callTool({ name: tool.name, arguments: input },
      { signal: abort, timeout: 15_000, toolDefinition: tool }), abort);
    this.#checks.add(operation);
    try {
      const result = await operation;
      if (abort.aborted || client !== this.#client || this.status(owner) !== "connected" || result.isError
        || !result.structuredContent || result.content.length !== 1 || result.content[0]?.type !== "text"
        || result.content[0].text !== JSON.stringify(result.structuredContent)) throw new OAuthSessionError("unavailable");
      return result;
    } catch { throw new OAuthSessionError("unavailable"); }
    finally { this.#checks.delete(operation); }
  }

  /** Stop local use first. A failed remote revoke is reported, never called success. */
  disconnect(owner: object): Promise<{ remote: "accepted" | "not_confirmed" | "not_required" }> {
    if (this.#owner && this.#owner !== owner) return Promise.reject(new OAuthSessionError("other_session"));
    this.#disconnecting ??= this.#disconnect().finally(() => { this.#disconnecting = undefined; });
    return this.#disconnecting;
  }

  async #disconnect(): Promise<{ remote: "accepted" | "not_confirmed" | "not_required" }> {
    this.#lifetime.abort();
    this.#withdraw();
    this.#instructions = "";
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    await Promise.allSettled([...this.#checks]);
    // Both operations settle locally after cancellation; unknown remains owned here.
    await this.#pending?.catch((_error: unknown) => {});
    await this.#refreshing?.catch((_error: unknown) => {});
    const client = this.#client;
    this.#client = undefined;
    const credential = this.#credential;
    this.#credential = undefined;
    // A transport-close failure cannot retain usable local credentials or skip
    // the remote revocation attempt. It still prevents claiming a clean outcome.
    try { await client?.close(); }
    catch { this.#unknown = true; }
    const unknown = this.#unknown;
    this.#lifetime = new AbortController();
    if (!credential) {
      if (!unknown) this.#owner = undefined;
      return { remote: unknown ? "not_confirmed" : "not_required" };
    }
    const signal = AbortSignal.timeout(this.#connection.timeoutMs);
    try {
      const revoke = async () => {
        const response = await this.#fetch(this.#oauth.revocationEndpoint, {
          method: "POST", credentials: "omit", redirect: "error", signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ client_id: this.#oauth.clientId, token: credential.refresh ?? credential.access,
            token_type_hint: credential.refresh ? "refresh_token" : "access_token" }),
        });
        // Own a late response's cleanup even when the caller already stopped waiting.
        try {
          return !signal.aborted && response.status === 200 && !response.redirected
            && (!response.url || response.url === this.#oauth.revocationEndpoint);
        } finally { await response.body?.cancel(); }
      };
      const confirmed = await wait(revoke(), signal);
      this.#unknown = !confirmed || unknown;
      if (!this.#unknown) { this.#owner = undefined; this.#invalid = false; }
      return { remote: this.#unknown ? "not_confirmed" : "accepted" };
    } catch {
      this.#unknown = true;
      return { remote: "not_confirmed" };
    }
  }

  /** Unload removes local credentials; remote state remains separately reported. */
  async close(): Promise<{ remote: "accepted" | "not_confirmed" | "not_required" }> {
    this.#closed = true;
    return this.disconnect(this.#owner ?? this);
  }
}
