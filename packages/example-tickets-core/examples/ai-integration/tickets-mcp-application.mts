/** 工单tenant MCP的显式服务组合与人工控制面，复用原OAuth/计量/字段释放。
 * 只发布已核HTTPS配置；不监听、注册客户端、创建默认政策或委托模型。
 */
import { createRequire } from "node:module";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PlatformAuthService, PlatformPrincipalAuthority } from "@rental-os/platform-server";
import { createRentalMcpService, type RentalMcpServiceConfig } from "@rental-os/mcp-server/service";
import { createMcpHostRouter } from "@rental-os/mcp-server/host-router";
import { createMcpHttpHost } from "@rental-os/mcp-server/http-host";
import { createPublicClientAuthorization } from "@rental-os/mcp-server/public-client-authorization";
import { TicketAiRouteStateSchema, TicketError } from "@rental-os/example-tickets-core";
import { createTicketsMcpTenant, TICKETS_MCP_SCOPES, TICKETS_MCP_TRANSACTION, TicketsMcpError,
  type TicketsMcpBusiness } from "./tickets-mcp-tenant.mjs";
import { createTicketsMcpReadHost } from "./tickets-mcp-read-host.mjs";
import { TICKETS_MCP_INPUTS, type TicketsMcpAction } from "@rental-os/example-tickets-core/mcp-http";
export { TICKETS_MCP_INPUTS, type TicketsMcpAction } from "@rental-os/example-tickets-core/mcp-http";

const { z } = createRequire(import.meta.url)("zod") as typeof import("zod");
const address = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.href === value && `${url.origin}${url.pathname}` === value && !url.username && !url.password && !value.includes("*");
});
export const TicketsMcpConfigurationSchema = z.object({ enabled: z.boolean(), origin: address.refine(value => new URL(value).pathname === "/"),
  reviewedUntil: z.number().int().positive().safe(), tableCollation: z.string().regex(/^[a-z0-9_]{1,64}$/u) }).strict();
export type TicketsMcpConfiguration = import("zod").infer<typeof TicketsMcpConfigurationSchema>;
export interface TicketsMcpRequest { headers: { authorization?: unknown; origin?: unknown } }
const absent = { retryable: false as const, executionGranted: false as const };
const noStore = { "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export function createTicketsMcpApplication(input: { database: PrismaClient;
  auth: Pick<PlatformAuthService, "resolveAccessContext">; principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, "lock">;
  tickets: TicketsMcpBusiness; configuration: TicketsMcpConfiguration; assertDataAvailable(native: Prisma.TransactionClient): Promise<void> }) {
  const configuration = TicketsMcpConfigurationSchema.parse(input.configuration), base = configuration.origin.slice(0, -1);
  const resource = `${base}/mcp`, issuer = `${base}/oauth`, authorizationEndpoint = `${issuer}/authorize`;
  const live = (signal: AbortSignal) => {
    if (signal.aborted || !configuration.enabled || configuration.reviewedUntil <= Date.now() / 1000) throw new TicketsMcpError("unavailable");
  };
  const tenant = createTicketsMcpTenant({ ...input, resource, authorizationEndpoint });
  const reads = createTicketsMcpReadHost({ ...input, tenant, resource });
  const config: RentalMcpServiceConfig = { enabled: configuration.enabled,
    resource: { resourceUrl: resource, authorizationServerUrl: issuer, allowedOrigins: [configuration.origin], maxRequestBytes: 65536,
      authorizationTimeoutMs: 15000, readTools: reads.readTools, protocolTraffic: reads.protocolTraffic },
    authorization: { issuer, authorizationEndpoint, tokenEndpoint: `${issuer}/token`, revocationEndpoint: `${issuer}/revoke`,
      allowedScopes: TICKETS_MCP_SCOPES, allowedOrigins: [configuration.origin], timeoutMs: 15000, maxMetadataBytes: 16384 },
    tokens: { tokenEndpoint: `${issuer}/token`, revocationEndpoint: `${issuer}/revoke`, resourceUrl: resource,
      allowedScopes: TICKETS_MCP_SCOPES, allowedOrigins: [configuration.origin], timeoutMs: 15000, maxRequestBytes: 16384 },
    lifetimes: { codeTtlSeconds: 120, accessTtlSeconds: 300, refreshTtlSeconds: 600 } };
  const service = createRentalMcpService(config, { store: tenant.store, registrations: tenant.registrations,
    consent: { async current(...args) { live(args[3]); const result = await tenant.consent.current(...args); live(args[3]); return result; } },
    issuance: { async current(...args) { live(args[4]); const result = await tenant.issuance.current(...args); live(args[4]); return result; },
      revocationOwner: (...args) => tenant.issuance.revocationOwner!(...args) },
    access: { async current(...args) { live(args[2]); const result = await tenant.access.current(...args); live(args[2]); return result; } }, metadata: { async read(signal) {
      live(signal);
      await input.database.$transaction(async native => { await input.assertDataAvailable(native); live(signal); }, TICKETS_MCP_TRANSACTION);
      return { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: config.tokens.tokenEndpoint,
        revocation_endpoint: config.tokens.revocationEndpoint, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [...TICKETS_MCP_SCOPES] };
    } } });
  const validate = createPublicClientAuthorization({ authorizationEndpoint, resourceUrl: resource, allowedScopes: TICKETS_MCP_SCOPES, timeoutMs: 15000 }, tenant.registrations);
  const lifetime = new AbortController();
  const routed = createMcpHostRouter({ service: config, routes: [] }, { service: {
    async fetch(request) {
      const signal = AbortSignal.any([request.signal, lifetime.signal]);
      try {
        live(signal);
        const url = new URL(request.url);
        if (`${url.origin}${url.pathname}` !== authorizationEndpoint) return service.fetch(request);
        // GET只检查原注册请求并导航固定人工页，绝不在未登录浏览器中创建同意或签发code。
        await validate(request, signal); live(signal);
        if (request.headers.has("origin") && request.headers.get("origin") !== base) return new Response(null, { status: 403, headers: noStore });
        const destination = new URL(`${base}/cores/example-tickets/mcp-authorization`);
        destination.hash = new URLSearchParams({ authorization: request.url }).toString();
        return new Response(null, { status: 303, headers: { ...noStore, Location: destination.href } });
      } catch { return Response.json({ error: "authorization_unavailable", retryable: false }, { status: 503, headers: noStore }); }
    },
    close() { lifetime.abort(); return service.close(); }
  } });
  const http = createMcpHttpHost(routed);
  const request = (value: string, signal: AbortSignal) => new Request(value, { method: "GET", headers: { Origin: base }, signal });
  const consume = async (action: TicketsMcpAction, browser: TicketsMcpRequest, value: unknown, signal: AbortSignal): Promise<unknown> => {
    if (browser.headers.origin !== undefined && browser.headers.origin !== base) throw new TicketsMcpError("denied");
    // 原账回读/撤回仍可在配置到期后进行；它们不会重新授予读取或计费额度。
    if (!["consent", "grant", "original", "revoke", "publicationOperation", "configuration"].includes(action)) live(signal);
    const command = TICKETS_MCP_INPUTS[action].parse(value);
    return tenant.withBrowser(browser, async () => {
      switch (action) {
        case "configuration": return { enabled: configuration.enabled && configuration.reviewedUntil > Date.now() / 1000,
          resource, authorizationEndpoint, scopes: [...TICKETS_MCP_SCOPES], fieldPolicy: "tickets-summary-v1", model: "client_paid", ...absent };
        case "status": {
          const c = TICKETS_MCP_INPUTS.status.parse(command);
          if (!c.grantId) return { state: "denied", reason: "policy_denied" };
          try { await reads.available(c.grantId, c.ticketId, signal); return TicketAiRouteStateSchema.parse({ state: "available", reason: "current_authorities_verified" }); }
          catch (error) {
            if (error instanceof TicketsMcpError && error.availability) return TicketAiRouteStateSchema.parse(error.availability);
            if (error instanceof TicketError && ["denied", "not_found"].includes(error.code)) return { state: "denied", reason: "permission_denied" };
            return { state: error instanceof TicketsMcpError && error.kind === "denied" ? "denied" : "unavailable",
            reason: error instanceof TicketsMcpError && error.kind === "denied" ? "policy_denied" : "authority_unavailable" }; }
        }
        case "publication": return tenant.publication(TICKETS_MCP_INPUTS.publication.parse(command).clientId, signal);
        case "publish": return tenant.publish(command, signal);
        case "publicationOperation": return tenant.publicationOperation(TICKETS_MCP_INPUTS.publicationOperation.parse(command).operationId, signal);
        case "prepareConsent": { const c = TICKETS_MCP_INPUTS.prepareConsent.parse(command); return tenant.prepareConsent(c.operationId, request(c.authorizationUrl, signal), signal); }
        case "consent": return tenant.readConsent(TICKETS_MCP_INPUTS.consent.parse(command).consentId, signal);
        case "decide": { const c = TICKETS_MCP_INPUTS.decide.parse(command); return tenant.decide(c.consentId, c.reviewHash, c.decision, signal); }
        case "complete": {
          const c = TICKETS_MCP_INPUTS.complete.parse(command);
          const response = await service.fetch(request(c.authorizationUrl, signal));
          const callback = response.headers.get("location");
          if (response.status !== 303 || !callback) throw new TicketsMcpError("unknown");
          return { callback, retryable: false }; // 只取正式AS二次核过的注册回调，不接受模型导航。
        }
        case "grant": return tenant.grant(TICKETS_MCP_INPUTS.grant.parse(command).grantId, signal);
        case "revoke": { const c = TICKETS_MCP_INPUTS.revoke.parse(command); return tenant.revoke(c.grantId, c.expectedRevision, signal); }
        case "original": return reads.original(TICKETS_MCP_INPUTS.original.parse(command).grantId, signal);
        case "preview": { const c = TICKETS_MCP_INPUTS.preview.parse(command); return reads.preview(c.grantId, c.tool, c.input, signal); }
        case "authorizeRead": { const c = TICKETS_MCP_INPUTS.authorizeRead.parse(command); return reads.authorizeRead(c.grantId, c.tool, c.input, c.reviewHash, signal); }
      }
    }, action === "complete" ? TICKETS_MCP_INPUTS.complete.parse(command).consentId : undefined);
  };
  return Object.freeze({ http, consume, configuration: Object.freeze({ resource, authorizationEndpoint }), close: () => http.close() });
}
export type TicketsMcpApplication = ReturnType<typeof createTicketsMcpApplication>;
