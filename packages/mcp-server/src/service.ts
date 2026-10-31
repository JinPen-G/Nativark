/** Standard MCP resource and OAuth AS composition, not an application server.
 * The original host supplies one durable transaction owner, current registration,
 * human consent and grant authorities. No listener, environment or login UI is owned here. */
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import { isDeepStrictEqual } from "node:util";
import { createProtectedMcpEndpoint } from "./index.js";
import type { ProtectedMcpConfig, ProtectedMcpEndpoint } from "./index.js";
import { createAuthorizationServerMetadata } from "./authorization-server-metadata.js";
import type { AuthorizationMetadataConfig, OriginalAuthorizationMetadata } from "./authorization-server-metadata.js";
import { createPublicClientAuthorizationEndpoint } from "./public-client-authorization-endpoint.js";
import type { PublicClientRegistrations } from "./public-client-authorization.js";
import { createOAuthTokenEndpoint } from "./oauth-token-endpoint.js";
import type { OAuthTokenEndpointConfig } from "./oauth-token-endpoint.js";
import { createPersistentOAuthAuthorization } from "./persistent-oauth-authorization.js";
import type { PersistentOAuthAuthorizationStore, OriginalOAuthConsentAuthority } from "./persistent-oauth-authorization.js";
import { createPersistentOAuthTokenService, createPersistentOAuthResourceVerifier } from "./persistent-oauth-tokens.js";
import type { PersistentOAuthTokenStore, OriginalOAuthGrantAuthority, OriginalOAuthAccessAuthority } from "./persistent-oauth-tokens.js";

export interface RentalMcpServiceConfig {
  enabled: boolean;
  resource: Omit<ProtectedMcpConfig, "enabled">;
  authorization: Omit<AuthorizationMetadataConfig, "enabled">;
  tokens: Omit<OAuthTokenEndpointConfig, "enabled">;
  lifetimes: { codeTtlSeconds: number; accessTtlSeconds: number; refreshTtlSeconds: number };
}

export interface OriginalRentalMcpServiceDependencies {
  /** The same serializable owner for code issuance, token rotation and resource
   * verification. Original consent/grant/registration fences remain locked through commit. */
  store: PersistentOAuthAuthorizationStore & PersistentOAuthTokenStore;
  registrations: PublicClientRegistrations;
  metadata: OriginalAuthorizationMetadata;
  consent: OriginalOAuthConsentAuthority;
  issuance: OriginalOAuthGrantAuthority;
  access: OriginalOAuthAccessAuthority;
}

function response(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: {
    "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff",
  } });
}

/** Compose the existing standard control and resource handlers for an original host.
 * @param config - explicit matching issuer/resource/scope pins and finite limits.
 * @param original - original persistent owners; absence makes every known route unavailable.
 * @returns a fetch/close service, without starting a socket or enabling business tools.
 * Metadata readiness still comes from the original AS. Original business Guard/ALS,
 * accounting and field release must be supplied on resource.readTools separately.
 * Closing stops new requests and cancels accepted control work; an unknown/late
 * commit still belongs to the original owner and is never retried or called rollback.
 */
export function createRentalMcpService(config: RentalMcpServiceConfig,
  original?: OriginalRentalMcpServiceDependencies): ProtectedMcpEndpoint {
  const enabled = config.enabled, resourceConfig = { ...config.resource, enabled };
  const metadataConfig = { ...config.authorization, allowedScopes: [...config.authorization.allowedScopes],
    allowedOrigins: [...config.authorization.allowedOrigins], enabled };
  const tokenConfig = { ...config.tokens, allowedScopes: [...config.tokens.allowedScopes],
    allowedOrigins: [...config.tokens.allowedOrigins], enabled };
  if (resourceConfig.authorizationServerUrl !== metadataConfig.issuer || resourceConfig.resourceUrl !== tokenConfig.resourceUrl
    || metadataConfig.tokenEndpoint !== tokenConfig.tokenEndpoint || metadataConfig.revocationEndpoint !== tokenConfig.revocationEndpoint
    || !isDeepStrictEqual(metadataConfig.allowedScopes, tokenConfig.allowedScopes)) {
    throw new TypeError("MCP resource and AS must share exact issuer, resource, token endpoints and scope ceiling");
  }
  const resource = new URL(resourceConfig.resourceUrl), issuer = new URL(metadataConfig.issuer);
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const metadataUrl = `${issuer.origin}/.well-known/oauth-authorization-server${path}`;
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const endpoints = [resource.href, resourceMetadataUrl, metadataUrl, metadataConfig.authorizationEndpoint,
    tokenConfig.tokenEndpoint, tokenConfig.revocationEndpoint].map(value => new URL(value));
  // Distinct paths prevent an authorization request from reaching a token or
  // resource handler. The original host still controls TLS/proxy routing.
  if (new Set(endpoints.map(url => `${url.origin}${url.pathname}`)).size !== endpoints.length) {
    throw new TypeError("MCP control and resource routes must be distinct");
  }
  const { codeTtlSeconds, accessTtlSeconds, refreshTtlSeconds } = config.lifetimes;
  if (!Number.isSafeInteger(codeTtlSeconds) || codeTtlSeconds < 1 || codeTtlSeconds > 600
    || !Number.isSafeInteger(accessTtlSeconds) || accessTtlSeconds < 1 || accessTtlSeconds > 900
    || !Number.isSafeInteger(refreshTtlSeconds) || refreshTtlSeconds < 1) throw new TypeError("Invalid MCP credential lifetimes");
  const lifecycle = { enabled, resourceUrl: resource.href, allowedScopes: tokenConfig.allowedScopes, accessTtlSeconds, refreshTtlSeconds };
  const tokens = original ? createPersistentOAuthTokenService(lifecycle, original.store, original.issuance) : undefined;
  const authorizer = original ? createPersistentOAuthAuthorization({ ...lifecycle, codeTtlSeconds }, original.store, original.consent) : undefined;
  const verifier = original ? createPersistentOAuthResourceVerifier(lifecycle, original.store, original.access) : undefined;
  const mcp = createProtectedMcpEndpoint(resourceConfig, verifier);
  const metadata = createAuthorizationServerMetadata(metadataConfig, original?.metadata);
  const authorization = original ? createPublicClientAuthorizationEndpoint({ enabled, issuer: issuer.href,
    authorizationEndpoint: metadataConfig.authorizationEndpoint, resourceUrl: resource.href, allowedScopes: tokenConfig.allowedScopes,
    allowedOrigins: metadataConfig.allowedOrigins, timeoutMs: metadataConfig.timeoutMs }, original.registrations, authorizer) : undefined;
  const token = original ? createOAuthTokenEndpoint(tokenConfig, original.registrations, tokens) : undefined;
  const lifetime = new AbortController(), pending = new Set<Promise<Response>>();
  let closed = false, closing: Promise<void> | undefined;
  const route = (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin === resource.origin && (url.pathname === resource.pathname || url.href === resourceMetadataUrl)) return mcp.fetch(request);
    if (url.href === metadataUrl) return metadata(request);
    const authorizationUrl = endpoints[3]!;
    if (url.origin === authorizationUrl.origin && url.pathname === authorizationUrl.pathname) {
      return authorization ? authorization(request) : Promise.resolve(response(503, "authorization_unavailable"));
    }
    if (url.href === tokenConfig.tokenEndpoint || url.href === tokenConfig.revocationEndpoint) {
      return token ? token(request) : Promise.resolve(response(503, "authorization_unavailable"));
    }
    return Promise.resolve(response(404, "not_found"));
  };
  return {
    fetch(request) {
      if (closed) return Promise.resolve(response(503, "mcp_closed"));
      const signal = AbortSignal.any([request.signal, lifetime.signal]);
      const work = route(new Request(request, { signal }));
      pending.add(work);
      void work.then(() => pending.delete(work), () => pending.delete(work));
      return work;
    },
    close() {
      if (closing) return closing;
      closed = true;
      lifetime.abort();
      const stopped = mcp.close();
      return closing = Promise.all([Promise.allSettled([...pending]), stopped]).then(() => {});
    },
  };
}
