/** Shared fixed-origin Web control transport, not Auth/CSRF/business authority.
 * Original handlers own request schemas, current rights and native commits. Bounds
 * JSON delivery and tracks original work through timeout/close; never retries or
 * interprets cancellation as rollback. Importing starts no listener. */
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
export interface OriginalWebControlRoute {
  url: string; method: "GET" | "POST";
  handle?: (request: Request, signal: AbortSignal) => Promise<unknown>;
}
export interface OriginalWebControlPlane { fetch(request: Request): Promise<Response>; close(): Promise<void> }
type Failure = "invalid" | "denied" | "conflict" | "unavailable" | "unknown";
const headers = Object.freeze({ "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" });
export function createOriginalWebControlPlane(raw: { enabled: boolean; requestTimeoutMs: number; maxResponseBytes: number },
  registrations: readonly OriginalWebControlRoute[], failure: { prefix: "review" | "grant" | "admission" | "governance" | "subject" | "consent" | "goal"; kind(error: unknown): Failure | undefined },
  responseArrayItems: 32 | 50 = 32
): OriginalWebControlPlane {
  // Original admission metadata permits 50 client IDs; other Web contracts keep
  // their existing 32-item ceiling. This pin is internal, never a request option.
  if (responseArrayItems !== 32 && responseArrayItems !== 50) throw new TypeError("Invalid Web response array ceiling");
  const config = snapshotJsonFields(raw, ["enabled", "requestTimeoutMs", "maxResponseBytes"], { stringCharacters: 64, arrayItems: 1 });
  if (typeof config.enabled !== "boolean" || typeof config.requestTimeoutMs !== "number" || !Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1 || config.requestTimeoutMs > 30000
    || typeof config.maxResponseBytes !== "number" || !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1 || config.maxResponseBytes > 65536) throw new TypeError("Invalid Web control-plane limits");
  const routes = registrations.map(route => { const url = new URL(route.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== route.url || url.href.length > 2048
      || !["GET", "POST"].includes(route.method) || route.handle !== undefined && typeof route.handle !== "function") throw new TypeError("Invalid Web control route");
    return Object.freeze({ url, method: route.method, handle: route.handle?.bind(route) });
  });
  if (!routes.length || routes.length > 16 || new Set(routes.map(r => r.url.origin)).size !== 1 || new Set(routes.map(r => r.url.pathname)).size !== routes.length) throw new TypeError("Web control routes must be distinct HTTPS paths on one trusted origin");
  const enabled = config.enabled, timeoutMs = config.requestTimeoutMs, maximum = config.maxResponseBytes, prefix = failure.prefix, kindOf = failure.kind.bind(failure);
  const error = (status: number, code: string) => Response.json({ error: code, retryable: false }, { status, headers });
  const unavailable = (mutating: boolean) => error(503, prefix + (mutating ? "_unknown" : "_unavailable"));
  const lifetime = new AbortController(), pending = new Set<Promise<Response>>(); let closed = false, closing: Promise<void> | undefined;
  const execute = async (request: Request, route: typeof routes[number]): Promise<Response> => {
    const timeout = new AbortController(), signal = AbortSignal.any([request.signal, lifetime.signal, timeout.signal]);
    const mutating = route.method === "POST"; let accepted = false, abortListener: (() => void) | undefined;
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      if (signal.aborted) return unavailable(false);
      const abort = new Promise<Response>(resolve => { abortListener = () => resolve(unavailable(accepted && mutating)); signal.addEventListener("abort", abortListener, { once: true }); });
      const work = (async () => {
        try {
          accepted = true; const result = await route.handle!(new Request(request, { signal }), signal);
          if (signal.aborted) return unavailable(mutating);
          const safe = snapshotJson(result, { stringCharacters: 2048, arrayItems: responseArrayItems }), text = JSON.stringify(safe);
          if (Buffer.byteLength(text, "utf8") > maximum) return unavailable(mutating);
          return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
        } catch (errorValue) {
          if (signal.aborted) return unavailable(mutating);
          const kind = kindOf(errorValue);
          return kind === "invalid" ? error(400, "invalid_request") : kind === "denied" ? error(403, prefix + "_denied")
            : kind === "conflict" ? error(409, prefix + "_conflict") : unavailable(kind === "unknown" || mutating);
        }
      })();
      // Keep native work after delivery times out. close must wait for settlement,
      // not only for the raced HTTP response. No automatic callback replay.
      pending.add(work); void work.then(() => pending.delete(work), () => pending.delete(work));
      return await Promise.race([work, abort]);
    } finally { clearTimeout(timer); if (abortListener) signal.removeEventListener("abort", abortListener); }
  };
  return Object.freeze({ fetch(request: Request): Promise<Response> {
    if (closed) return Promise.resolve(error(503, prefix + "_closed"));
    const url = new URL(request.url), route = routes.find(r => r.url.origin === url.origin && r.url.pathname === url.pathname);
    if (!route) return Promise.resolve(error(404, "not_found"));
    if (request.method !== route.method) return Promise.resolve(error(405, "method_not_allowed"));
    if (!enabled || !route.handle) return Promise.resolve(unavailable(false));
    return execute(request, route);
  }, close() { if (closing) return closing; closed = true; lifetime.abort(); return closing = Promise.allSettled([...pending]).then(() => {}); } });
}
