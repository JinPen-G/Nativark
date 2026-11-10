/** Fixed URL dispatch and shared lifetime for already constructed MCP/Web components.
 * Owns no listener, environment, identity, business execution or accounting. Original
 * components validate requests and own commits; abort/close never proves rollback or revocation. */
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import type { RentalMcpServiceConfig } from "./service.js";

export interface McpHostComponent {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export interface McpHostRouterConfig {
  readonly service: Pick<RentalMcpServiceConfig, "resource" | "authorization" | "tokens">;
  readonly routes: readonly { readonly url: string; readonly component: string }[];
}

export type McpHostComponents = Readonly<Record<string, McpHostComponent>> & {
  readonly service: McpHostComponent;
};

const headers = Object.freeze({
  "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff",
});
const errorResponse = (status: number, error: string): Response =>
  Response.json({ error, retryable: false }, { status, headers });
const routeKey = (url: URL): string => `${url.origin}${url.pathname}`;

function canonicalHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError("MCP host URLs must be canonical HTTPS without credentials, query or fragment"); }
  // Comparing with the route key also rejects empty '?' and '#' delimiters.
  if (typeof value !== "string" || url.protocol !== "https:" || url.username || url.password
    || url.search || url.hash || url.href !== value || url.href !== routeKey(url)) {
    throw new TypeError("MCP host URLs must be canonical HTTPS without credentials, query or fragment");
  }
  return url;
}

/** Bind only declared URLs and original method identities. Responses pass through
 * untouched. close is single-shot and waits for original work, including work that
 * ignores cancellation; component close failures remain failures and are never retried. */
export function createMcpHostRouter(config: McpHostRouterConfig,
  components: McpHostComponents): McpHostComponent {
  if (!components || typeof components !== "object" || Array.isArray(components)) {
    throw new TypeError("MCP host components must include a service with fetch and close methods");
  }
  const byName = new Map<string, Readonly<McpHostComponent>>();
  const captured = new Map<McpHostComponent, Readonly<McpHostComponent>>();
  for (const [name, component] of Object.entries(components)) {
    let methods = captured.get(component);
    if (!methods) {
      const fetch = component?.fetch, close = component?.close;
      if (typeof fetch !== "function" || typeof close !== "function") {
        throw new TypeError("MCP host components require fetch and close methods");
      }
      methods = Object.freeze({ fetch: fetch.bind(component), close: close.bind(component) });
      captured.set(component, methods);
    }
    byName.set(name, methods);
  }
  const service = byName.get("service");
  if (!service) throw new TypeError("MCP host service component is required");

  const { resource, authorization, tokens } = config.service;
  const resourceUrl = canonicalHttpsUrl(resource.resourceUrl);
  const issuer = canonicalHttpsUrl(authorization.issuer);
  // RFC 8414 uses the same issuer-path calculation as the original MCP service.
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const standardUrls = [resourceUrl.href, getOAuthProtectedResourceMetadataUrl(resourceUrl),
    `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    authorization.authorizationEndpoint, tokens.tokenEndpoint, tokens.revocationEndpoint];
  const routes = new Map<string, Readonly<McpHostComponent>>();
  const register = (value: string, component: Readonly<McpHostComponent>): void => {
    const key = routeKey(canonicalHttpsUrl(value));
    if (routes.has(key)) throw new TypeError("MCP host routes must have distinct origins and paths");
    routes.set(key, component);
  };
  for (const value of standardUrls) register(value, service);
  if (!Array.isArray(config.routes)) throw new TypeError("MCP host routes must be an array");
  for (const registration of config.routes) {
    const name = registration.component, value = registration.url;
    const component = typeof name === "string" ? byName.get(name) : undefined;
    if (!component) throw new TypeError("Unknown MCP host route component");
    register(value, component);
  }

  const lifetime = new AbortController();
  // This set tracks settlement only, never quota, authorization or financial usage.
  const pending = new Set<Promise<Response>>();
  let closed = false, closing: Promise<void> | undefined;
  return Object.freeze({
    fetch(request: Request): Promise<Response> {
      if (closed) return Promise.resolve(errorResponse(503, "mcp_host_closed"));
      let component: Readonly<McpHostComponent>, forwarded: Request;
      try {
        const selected = routes.get(routeKey(new URL(request.url)));
        if (!selected) return Promise.resolve(errorResponse(404, "not_found"));
        component = selected;
        forwarded = new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) });
      } catch { return Promise.resolve(errorResponse(503, "mcp_host_unavailable")); }
      // Register before invoking original code, including a reentrant close. Work
      // accepted but not started when close begins must not start a new native call.
      const work = Promise.resolve().then(() => closed
        ? errorResponse(503, "mcp_host_closed") : component.fetch(forwarded));
      pending.add(work);
      void work.then(() => pending.delete(work), () => pending.delete(work));
      return work.catch(() => errorResponse(503, "mcp_host_unavailable"));
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      // Publish the same promise before abort listeners can reenter close. Both
      // groups settle fully: one failed close must not hide other outstanding work.
      closing = Promise.resolve().then(async () => {
        const stops = [...captured.values()].map(component => Promise.resolve().then(() => component.close()));
        const [, results] = await Promise.all([Promise.allSettled([...pending]), Promise.allSettled(stops)]);
        const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length) throw new AggregateError(failures, "MCP host components failed to close");
      });
      lifetime.abort();
      return closing;
    },
  });
}
