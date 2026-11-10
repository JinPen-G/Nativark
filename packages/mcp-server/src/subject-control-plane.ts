/** Fixed Web issuer-mapping management. Returns metadata WITHOUT the subject,
 * token or business authority. Original tenant manager, active target, stable
 * subject generation/CAS and native receipt/audit remain in the existing store.
 * Configured/enabled metadata is not consent/grant/access; no HTTP listener. */
import { snapshotJson } from "./json-snapshot.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
import type { OriginalWebControlPlane } from "./web-control-plane.js";
import { captureOAuthSubjectTarget, OAuthSubjectStoreError } from "./prisma-oauth-subject-store.js";
import type { PrismaOAuthSubjectStore, OAuthSubjectSave, OAuthSubjectTarget } from "./prisma-oauth-subject-store.js";
import { captureOAuthSubjectBinding } from "./prisma-oauth-consent-review.js";
import type { OriginalOAuthSubjectBinding } from "./prisma-oauth-consent-review.js";
import type { OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
export type OAuthSubjectSummary = Omit<OriginalOAuthSubjectBinding, "subject">;
export interface McpSubjectControlPlaneConfig {
  enabled: boolean; resourceUrl: string; requestTimeoutMs: number; maxResponseBytes: number;
  readEndpoint: string; saveEndpoint: string; receiptEndpoint: string;
}
export interface OriginalMcpSubjectControlDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  forRequest(browser: Request): Pick<PrismaOAuthSubjectStore<Native>, "read" | "save" | "operation">;
}
const fail = (kind: OAuthSubjectStoreError["kind"]) => new OAuthSubjectStoreError(kind);
function parameters(query: URLSearchParams, required: readonly string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of query) { if (!required.includes(name) || Object.hasOwn(result, name) || !value) throw fail("invalid"); result[name] = value; }
  if (required.some(name => !Object.hasOwn(result, name))) throw fail("invalid"); return result;
}
export function createMcpSubjectControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpSubjectControlPlaneConfig, original?: OriginalMcpSubjectControlDependencies<Native>
): OriginalWebControlPlane {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 10 }) as unknown as McpSubjectControlPlaneConfig;
  const resource = new URL(config.resourceUrl);
  if (resource.protocol !== "https:" || resource.username || resource.password || resource.search || resource.hash || resource.href !== config.resourceUrl || resource.href.length > 2048) throw fail("invalid");
  if (original !== undefined && typeof original?.forRequest !== "function") throw fail("unavailable");
  const storeFor = original?.forRequest.bind(original), endpoints = [config.readEndpoint, config.saveEndpoint, config.receiptEndpoint];
  const summary = (rawBinding: unknown, target: OAuthSubjectTarget): OAuthSubjectSummary => {
    const b = captureOAuthSubjectBinding(rawBinding);
    if (b.resource !== config.resourceUrl || b.userId !== target.userId || b.tenantId !== target.tenantId) throw fail("unavailable");
    // Explicit whitelist on read/save/receipt alike; never spread the raw binding
    // or return a second unfiltered structured/text representation.
    return Object.freeze({ resource: b.resource, userId: b.userId, tenantId: b.tenantId, revision: b.revision, enabled: b.enabled, expiresAt: b.expiresAt });
  };
  const handle = async (browser: Request, signal: AbortSignal, index: number): Promise<unknown> => {
    const url = new URL(browser.url), expectedOrigin = new URL(endpoints[index]!).origin, post = index === 1;
    const origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (url.username || url.password || url.hash || url.href.length > 8192 || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && origin !== expectedOrigin || origin !== null && origin !== expectedOrigin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get("authorization") ?? "")) throw fail("denied");
    let input: unknown, query: Record<string, string> | undefined, target: OAuthSubjectTarget;
    try {
      if (post) {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        input = snapshotJson(JSON.parse(await readOAuthReviewBody(browser, signal, 4096)), { stringCharacters: 2048, arrayItems: 10 });
        target = captureOAuthSubjectTarget((input as OAuthSubjectSave).target);
      } else { query = parameters(url.searchParams, index === 0 ? ["userId", "tenantId"] : ["userId", "tenantId", "operationKey"]);
        target = captureOAuthSubjectTarget({ userId: query.userId, tenantId: query.tenantId }); }
    } catch { if (signal.aborted) throw fail("unavailable"); throw fail("invalid"); }
    if (signal.aborted || !storeFor) throw fail("unavailable");
    const store = storeFor(browser);
    if (typeof store?.read !== "function" || typeof store.save !== "function" || typeof store.operation !== "function") throw fail("unavailable");
    if (index === 0) { const result = await store.read(target, signal);
      if (result.state === "not_configured") return Object.freeze({ state: "not_configured" });
      if (result.state !== "configured") throw fail("unavailable"); return Object.freeze({ state: "configured", binding: summary(result.binding, target) }); }
    if (post) { const result = await store.save(input as OAuthSubjectSave, signal);
      if (result.state !== "saved") throw fail("unavailable"); return Object.freeze({ state: "saved", operationKey: result.operationKey, binding: summary(result.binding, target) }); }
    const result = await store.operation(target, query!.operationKey!, signal);
    if (result.state === "not_observed") return Object.freeze({ state: "not_observed", retryable: false });
    if (result.state !== "observed" || result.result.state !== "saved" || result.result.operationKey !== query!.operationKey) throw fail("unavailable");
    return Object.freeze({ state: "observed", result: Object.freeze({ state: "saved", operationKey: result.result.operationKey, binding: summary(result.result.binding, target) }) });
  };
  return createOriginalWebControlPlane(config, endpoints.map((url, index) => ({ url, method: index === 1 ? "POST" as const : "GET" as const,
    ...(original === undefined ? {} : { handle: (browser: Request, signal: AbortSignal) => handle(browser, signal, index) }) })),
    { prefix: "subject", kind: error => error instanceof OAuthSubjectStoreError ? error.kind : undefined });
}
