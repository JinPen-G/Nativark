/** Node HTTP ingress for one original MCP router. The outer application owns
 * TLS, listener and database lifetimes. Only the router's registered URLs can
 * enter its Fetch handlers, which retain authorization and commit evidence. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { McpRoutedHost } from "./host-router.js";

export interface McpHttpHost {
  middleware(request: IncomingMessage, response: ServerResponse, next: () => void): void;
  close(): Promise<void>;
}

const hopByHop = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
];
const singleHeaders = new Set([
  "host", "authorization", "origin", "content-type", "content-length", "transfer-encoding",
  "sec-fetch-site", "mcp-protocol-version", "mcp-session-id", "last-event-id",
]);

function localError(response: ServerResponse, status: number, error: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify({ error, retryable: false }));
}

function captureHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  const raw = request.rawHeaders;
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index].toLowerCase();
    if (singleHeaders.has(name) && headers.has(name)) throw new TypeError("Duplicate MCP HTTP header");
    headers.append(name, raw[index + 1]);
  }
  return headers;
}

function connectionHeaders(headers: Headers): Set<string> {
  const options = headers.get("connection")?.toLowerCase().split(",").map(value => value.trim()).filter(Boolean) ?? [];
  for (const option of options) {
    if (!/^[!#$%&'*+.^_`|~\w-]+$/u.test(option)) throw new TypeError("Invalid HTTP connection option");
  }
  return new Set([...hopByHop, ...options]);
}

async function writeResponse(result: Response, response: ServerResponse, signal: AbortSignal, head: boolean): Promise<void> {
  const excluded = connectionHeaders(result.headers);
  const body = result.body;
  if (head || !body) await body?.cancel();
  signal.throwIfAborted();
  response.statusCode = result.status;
  for (const [name, value] of result.headers) {
    if (name !== "set-cookie" && !excluded.has(name)) response.setHeader(name, value);
  }
  const cookies = excluded.has("set-cookie") ? [] : result.headers.getSetCookie();
  if (cookies.length) response.setHeader("Set-Cookie", cookies);
  if (head || !body) {
    response.end();
    return;
  }
  response.flushHeaders();
  // Node Fetch and node:stream/web use the same runtime stream. Their DOM and
  // Node declarations differ on async iteration and pipeThrough.
  await pipeline(Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>), response, { signal });
}

export function createMcpHttpHost(host: McpRoutedHost): McpHttpHost {
  if (!Array.isArray(host?.routeUrls) || host.routeUrls.length === 0 ||
    typeof host.fetch !== "function" || typeof host.close !== "function") {
    throw new TypeError("MCP HTTP requires the selected original router");
  }
  const routes = new Map<string, Map<string, string>>();
  for (const value of host.routeUrls) {
    const url = new URL(value);
    if (url.protocol !== "https:" || `${url.origin}${url.pathname}` !== value)
      throw new TypeError("MCP HTTP requires fixed HTTPS route URLs");
    let byHost = routes.get(url.pathname);
    if (!byHost) routes.set(url.pathname, byHost = new Map());
    if (byHost.has(url.host)) throw new TypeError("Duplicate MCP HTTP route");
    byHost.set(url.host, value);
  }
  const fetch = host.fetch.bind(host), close = host.close.bind(host);
  const lifetime = new AbortController();
  const pending = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;

  async function forward(request: IncomingMessage, response: ServerResponse,
    authorities: ReadonlyMap<string, string>, query: string): Promise<void> {
    const disconnected = new AbortController();
    const signal = AbortSignal.any([disconnected.signal, lifetime.signal]);
    const onRequestClose = () => { if (!request.complete) disconnected.abort(); };
    const onRequestError = () => disconnected.abort();
    const onResponseClose = () => { if (!response.writableFinished) disconnected.abort(); };
    const abortResponse = () => { if (!response.writableFinished) response.destroy(); };
    let incoming: PassThrough | undefined;
    request.once("close", onRequestClose);
    request.once("error", onRequestError);
    response.once("close", onResponseClose);
    signal.addEventListener("abort", abortResponse, { once: true });
    try {
      if (lifetime.signal.aborted) return localError(response, 503, "mcp_host_closed");
      if (request.readableAborted || response.destroyed) return;
      let headers: Headers, excluded: Set<string>;
      try { headers = captureHeaders(request); excluded = connectionHeaders(headers); }
      catch { return localError(response, 400, "invalid_request"); }
      const method = request.method;
      if (!method || ["CONNECT", "TRACE", "TRACK"].includes(method))
        return localError(response, 405, "method_not_allowed");
      const authority = headers.get("host");
      const endpoint = authority === null ? undefined : authorities.get(authority.toLowerCase());
      if (!endpoint) return localError(response, 421, "misdirected_request");
      const hasBody = headers.has("transfer-encoding") || (headers.get("content-length") ?? "0") !== "0";
      if ((hasBody && (method === "GET" || method === "HEAD" || request.readableEnded)) ||
        [...excluded].some(name => headers.has(name) && !hopByHop.includes(name))) {
        return localError(response, 400, "invalid_request");
      }
      for (const name of excluded) headers.delete(name);
      const options: RequestInit & { duplex?: "half" } = { method, headers, signal };
      if (hasBody) {
        // Fetch body cancellation may destroy its stream. Keep that separate
        // from the HTTP socket so the original error response can still finish.
        incoming = new PassThrough();
        const stream = Readable.toWeb(incoming, {
          strategy: { highWaterMark: incoming.readableHighWaterMark, size: (chunk: Uint8Array) => chunk.byteLength },
        });
        options.body = stream as unknown as ReadableStream<Uint8Array>;
        options.duplex = "half";
        request.pipe(incoming);
      }
      const result = await fetch(new Request(endpoint + query, options));
      if (signal.aborted) {
        await result.body?.cancel();
        return;
      }
      await writeResponse(result, response, signal, method === "HEAD");
    } catch {
      if (response.destroyed || signal.aborted) return;
      if (response.headersSent) response.destroy();
      else localError(response, 503, "mcp_host_unavailable");
    } finally {
      signal.removeEventListener("abort", abortResponse);
      request.off("close", onRequestClose);
      request.off("error", onRequestError);
      response.off("close", onResponseClose);
      if (incoming) {
        request.unpipe(incoming);
        incoming.destroy();
      }
      if (!request.readableEnded && !request.destroyed) request.resume();
    }
  }

  return Object.freeze({
    middleware(request: IncomingMessage, response: ServerResponse, next: () => void): void {
      const target = request.url ?? "";
      const queryAt = target.indexOf("?");
      const pathname = queryAt < 0 ? target : target.slice(0, queryAt);
      const authorities = routes.get(pathname);
      if (!authorities) return next();
      const query = queryAt < 0 ? "" : target.slice(queryAt);
      if (/[#\u0000-\u0020\u007f]/u.test(query)) return localError(response, 400, "invalid_request");
      const work = Promise.resolve().then(() => forward(request, response, authorities, query));
      pending.add(work);
      void work.then(() => pending.delete(work), () => {
        pending.delete(work);
        response.destroy();
      });
    },
    close(): Promise<void> {
      if (closing) return closing;
      closing = Promise.resolve().then(async () => {
        const [result] = await Promise.allSettled([Promise.resolve().then(close), ...pending]);
        if (result.status === "rejected") throw result.reason;
      });
      lifetime.abort();
      return closing;
    },
  });
}
