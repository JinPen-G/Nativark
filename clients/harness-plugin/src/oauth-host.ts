/** Human OAuth via an exact Host route or temporary native loopback listener and system browser. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";
import { OAuthSessionError } from "./oauth-session.js";
import type { OAuthInteraction } from "./oauth-session.js";

function handler(redirect: URL, receive: (request: Request) => Response) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    try {
      if (req.method !== "GET" || req.headers.host !== redirect.host || !req.url?.startsWith("/") || req.url.startsWith("//")) {
        res.writeHead(400, { "Cache-Control": "no-store" }).end();
        return;
      }
      const response = receive(new Request(new URL(req.url, redirect.origin), { method: req.method }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end();
    } catch {
      res.writeHead(400, { "Cache-Control": "no-store" }).end();
    }
  };
}

export function oauthHostInteraction(ctx: Context, mode: "host" | "loopback"): OAuthInteraction {
  return {
    async prepareCallback(redirectUri, receive, signal) {
      const redirect = new URL(redirectUri);
      if (!["127.0.0.1", "[::1]"].includes(redirect.hostname) || redirect.pathname === "/"
        || redirect.pathname.endsWith("/") || signal.aborted) throw new OAuthSessionError("unavailable");
      if (mode === "host") {
        const server = ctx.get("webServer");
        if (!server || redirect.origin !== server.getOrigin()) throw new OAuthSessionError("unavailable");
        const dispose = server.register({ kind: "exact", path: redirect.pathname, handler: handler(redirect, receive) });
        return { redirectUri, close: async () => { dispose(); } };
      }
      if (redirect.protocol !== "http:") throw new OAuthSessionError("unavailable");
      const listener = createServer({ maxHeaderSize: 8192 });
      listener.requestTimeout = 5000;
      listener.headersTimeout = 5000;
      listener.maxConnections = 4;
      let bound = false;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => {
        closing ??= new Promise<void>(resolve => {
          if (!bound) { resolve(); return; }
          listener.close(() => resolve());
          listener.closeAllConnections();
        });
        return closing;
      };
      try {
        // The OS allocates the port atomically. Only the port may differ from
        // registered native redirect metadata (RFC8252); host/path stay exact.
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { listener.off("error", failed); listener.off("close", cancelled); };
          const failed = () => { cleanup(); reject(new OAuthSessionError("unavailable")); };
          const cancelled = () => { cleanup(); reject(new OAuthSessionError("cancelled")); };
          listener.once("error", failed);
          listener.once("close", cancelled);
          // Native listen cancellation owns acquisition too; do not abandon a
          // listen promise that might bind after our cancellation response.
          try {
            listener.listen({ host: redirect.hostname === "[::1]" ? "::1" : "127.0.0.1", port: 0, exclusive: true, signal }, () => {
              bound = true;
              cleanup();
              resolve();
            });
          } catch { failed(); }
        });
        if (signal.aborted) throw new OAuthSessionError("cancelled");
        redirect.port = String((listener.address() as AddressInfo).port);
        listener.on("request", handler(redirect, receive));
        listener.on("clientError", (_error, socket) => { socket.destroy(); });
        return { redirectUri: redirect.href, close };
      } catch {
        await close();
        throw new OAuthSessionError("unavailable");
      }
    },
    async openBrowser(url) {
      // SDK URL from pinned AS metadata, not command input. It contains only
      // state/challenge, never the verifier, authorization code or access token.
      await open(url.href);
    },
  };
}
