/** Web-only user consent transport over the original persisted producer. Preparation
 * validates standard OAuth fields against current registration; it does not approve,
 * issue code or create another identity. Owner receipts never replay an unknown action.
 * No listener, model tool, HTML UI or substitute MFA/approval is installed here. */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { snapshotJson } from "./json-snapshot.js";
import { createPublicClientAuthorization } from "./public-client-authorization.js";
import { OAuthWebConsentError } from "./prisma-oauth-web-consent.js";
import type { PrismaOAuthWebConsent } from "./prisma-oauth-web-consent.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
import type { OriginalWebControlPlane } from "./web-control-plane.js";

export interface McpConsentControlPlaneConfig {
  enabled: boolean; authorizationEndpoint: string; resourceUrl: string; allowedScopes: readonly string[];
  requestTimeoutMs: number; maxResponseBytes: number;
  prepareEndpoint: string; decisionEndpoint: string; receiptEndpoint: string;
  /** Optional fixed GET reference. When configured, prepare POST must include
   * its exact authorizationId; a reference is not a preparation/issuance permit. */
  referenceEndpoint?: string;
}
export interface OriginalMcpConsentControlPlaneDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  webConsent: Pick<PrismaOAuthWebConsent<Native>, "prepare" | "decide" | "receipt"> & Partial<Pick<PrismaOAuthWebConsent<Native>, "reference">>;
  registrations: Pick<PrismaPublicClientRegistry<Native>, "read">;
}
const fail = (kind: OAuthWebConsentError["kind"]) => new OAuthWebConsentError(kind);

/** Route fixed Web POST preparation/decision and GET historical receipt. Original
 * producer owns current identity, nonce/CAS and atomic audit in its existing store. */
export function createMcpConsentControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpConsentControlPlaneConfig, original?: OriginalMcpConsentControlPlaneDependencies<Native>
): OriginalWebControlPlane {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 }) as unknown as McpConsentControlPlaneConfig;
  const authorization = new URL(config.authorizationEndpoint), endpoints = [config.prepareEndpoint, config.decisionEndpoint, config.receiptEndpoint,
    ...(config.referenceEndpoint === undefined ? [] : [config.referenceEndpoint])];
  if (authorization.protocol !== "https:" || authorization.username || authorization.password || authorization.search || authorization.hash
    || authorization.href !== config.authorizationEndpoint || endpoints.some(value => new URL(value).origin !== authorization.origin)
    || endpoints.includes(config.authorizationEndpoint)) throw fail("invalid");
  if (original !== undefined && (typeof original?.webConsent?.prepare !== "function" || typeof original.webConsent.decide !== "function"
    || typeof original.webConsent.receipt !== "function" || config.referenceEndpoint !== undefined && typeof original.webConsent.reference !== "function"
    || typeof original.registrations?.read !== "function")) throw fail("unavailable");
  const prepare = original?.webConsent.prepare.bind(original.webConsent), decide = original?.webConsent.decide.bind(original.webConsent), receipt = original?.webConsent.receipt.bind(original.webConsent);
  const reference = original?.webConsent.reference?.bind(original.webConsent);
  const validate = original ? createPublicClientAuthorization({ authorizationEndpoint: config.authorizationEndpoint, resourceUrl: config.resourceUrl,
    allowedScopes: config.allowedScopes, timeoutMs: config.requestTimeoutMs }, original.registrations) : undefined;
  const handle = async (browser: Request, signal: AbortSignal, index: number): Promise<unknown> => {
    const url = new URL(browser.url), post = index < 2, origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (url.username || url.password || url.hash || Buffer.byteLength(url.href, "utf8") > 8192 || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && origin !== authorization.origin || origin !== null && origin !== authorization.origin
      || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get("authorization") ?? "")) throw fail("denied");
    if (signal.aborted || !prepare || !decide || !receipt || !validate) throw fail("unavailable");
    if (index === 1) return decide(browser, signal);
    if (index === 2) {
      const params = url.searchParams, id = params.get("authorizationId");
      if ([...params.keys()].some(key => key !== "authorizationId") || params.getAll("authorizationId").length !== 1 || !id || !/^[a-f0-9]{64}$/.test(id)) throw fail("invalid");
      return receipt(id, new Request(config.authorizationEndpoint, { headers: browser.headers, signal }), signal);
    }
    if (index === 3) {
      if (!reference) throw fail("unavailable");
      const request = new Request(config.authorizationEndpoint + url.search, { headers: browser.headers, signal });
      try { return await reference(await validate(request, signal), request, signal); }
      catch (error) { if (error instanceof OAuthWebConsentError) throw error;
        throw fail(error instanceof OAuthError && error.code === OAuthErrorCode.InvalidRequest ? "invalid" : "unavailable"); }
    }
    if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
    let form: string;
    try { form = await readOAuthReviewBody(browser, signal, 8192); if (/%(?![0-9a-f]{2})/i.test(form)) throw fail("invalid"); }
    catch { if (signal.aborted) throw fail("unavailable"); throw fail("invalid"); }
    // Only after the outer authenticated same-origin POST passes, normalize to the
    // original AS GET precheck/producer URL. No caller URL or revision is accepted.
    const params = new URLSearchParams(form); let expectedAuthorizationId: string | undefined;
    if (config.referenceEndpoint !== undefined) {
      const supplied = params.get("authorizationId");
      if (params.getAll("authorizationId").length !== 1 || !supplied || !/^[a-f0-9]{64}$/.test(supplied)) throw fail("invalid");
      expectedAuthorizationId = supplied; params.delete("authorizationId");
    }
    const request = new Request(config.authorizationEndpoint + "?" + params, { headers: browser.headers, signal });
    let input: Awaited<ReturnType<typeof validate>>;
    try { input = await validate(request, signal); }
    catch (error) { throw fail(error instanceof OAuthError && error.code === OAuthErrorCode.InvalidRequest ? "invalid" : "unavailable"); }
    return prepare(input, request, signal, expectedAuthorizationId);
  };
  return createOriginalWebControlPlane(config, endpoints.map((url, index) => ({ url, method: index < 2 ? "POST" as const : "GET" as const,
    ...(original === undefined ? {} : { handle: (request: Request, signal: AbortSignal) => handle(request, signal, index) }) })),
    { prefix: "consent", kind: error => error instanceof OAuthWebConsentError ? error.kind : undefined });
}
