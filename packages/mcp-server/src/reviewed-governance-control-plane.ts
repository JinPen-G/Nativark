/** Fixed Web consumers for reviewed public-client/notice projections. Not review
 * approval, user consent, MFA, grant creation or business tools. Per-request original
 * managers own current rights, approved-source checks, CAS/audit and exact receipts;
 * missing approval never turns a submitted reference into authority. No listener. */
import { snapshotJson } from "./json-snapshot.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
import type { OriginalWebControlPlane } from "./web-control-plane.js";
import { PublicClientRegistryError } from "./prisma-public-client-registry.js";
import type { PrismaPublicClientRegistry, PublicClientRegistrationSave } from "./prisma-public-client-registry.js";
import { captureOAuthConsentPolicyTarget, OAuthConsentPolicyStoreError } from "./prisma-oauth-consent-policy-store.js";
import type { PrismaOAuthConsentPolicyStore, OAuthConsentPolicySave } from "./prisma-oauth-consent-policy-store.js";
import type { OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
export interface McpReviewedGovernanceConfig {
  enabled: boolean; resourceUrl: string; requestTimeoutMs: number; maxResponseBytes: number;
  client: { readEndpoint: string; saveEndpoint: string; receiptEndpoint: string };
  notice: { readEndpoint: string; saveEndpoint: string; receiptEndpoint: string };
}
export interface OriginalReviewedGovernanceStores<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  clients: Pick<PrismaPublicClientRegistry<Native>, "readManaged" | "save" | "operation">;
  policies: Pick<PrismaOAuthConsentPolicyStore<Native>, "read" | "save" | "operation">;
}
export interface OriginalReviewedGovernanceDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  forRequest(browser: Request): OriginalReviewedGovernanceStores<Native>;
}
const fail = (kind: OAuthConsentPolicyStoreError["kind"]) => new OAuthConsentPolicyStoreError(kind);
function parameters(query: URLSearchParams, required: readonly string[]): Record<string, string> {
  const value: Record<string, string> = Object.create(null);
  for (const [name, data] of query) { if (!required.includes(name) || Object.hasOwn(value, name) || !data) throw fail("invalid"); value[name] = data; }
  if (required.some(name => !Object.hasOwn(value, name))) throw fail("invalid"); return value;
}
export function createMcpReviewedGovernanceControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpReviewedGovernanceConfig, original?: OriginalReviewedGovernanceDependencies<Native>
): OriginalWebControlPlane {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 }) as unknown as McpReviewedGovernanceConfig;
  const resource = new URL(config.resourceUrl);
  if (resource.protocol !== "https:" || resource.username || resource.password || resource.search || resource.hash || resource.href !== config.resourceUrl || resource.href.length > 2048) throw fail("invalid");
  if (original !== undefined && typeof original?.forRequest !== "function") throw fail("unavailable");
  const managerFor = original?.forRequest.bind(original);
  const endpoints = [config.client.readEndpoint, config.client.saveEndpoint, config.client.receiptEndpoint, config.notice.readEndpoint, config.notice.saveEndpoint, config.notice.receiptEndpoint];
  const handle = async (browser: Request, signal: AbortSignal, index: number): Promise<unknown> => {
    const url = new URL(browser.url), expectedOrigin = new URL(endpoints[index]!).origin, post = index % 3 === 1;
    const origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (url.username || url.password || url.hash || url.href.length > 8192 || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && origin !== expectedOrigin || origin !== null && origin !== expectedOrigin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get("authorization") ?? "")) throw fail("denied");
    let input: unknown, query: Record<string, string> | undefined;
    try {
      if (post) {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        input = snapshotJson(JSON.parse(await readOAuthReviewBody(browser, signal, 65536)), { stringCharacters: 2048, arrayItems: 32 });
      } else query = parameters(url.searchParams, index < 3 ? index === 0 ? ["clientId"] : ["clientId", "operationKey"] : index === 3 ? ["target"] : ["target", "operationKey"]);
    } catch { if (signal.aborted) throw fail("unavailable"); throw fail("invalid"); }
    if (signal.aborted || !managerFor) throw fail("unavailable");
    const stores = managerFor(browser);
    if (typeof stores?.clients?.readManaged !== "function" || typeof stores.clients.save !== "function" || typeof stores.clients.operation !== "function"
      || typeof stores.policies?.read !== "function" || typeof stores.policies.save !== "function" || typeof stores.policies.operation !== "function") throw fail("unavailable");
    // No raw AS read can be selected by HTTP. Each concrete store owns its full
    // input capture and approved-source/current-management checks in native tx.
    if (index === 0) return stores.clients.readManaged(query!.clientId!, signal);
    if (index === 1) return stores.clients.save(input as PublicClientRegistrationSave, signal);
    if (index === 2) return stores.clients.operation(query!.clientId!, query!.operationKey!, signal);
    if (index === 4) return stores.policies.save(input as OAuthConsentPolicySave, signal);
    let target;
    try { target = captureOAuthConsentPolicyTarget(JSON.parse(query!.target!)); } catch { throw fail("invalid"); }
    return index === 3 ? stores.policies.read(target, signal) : stores.policies.operation(target, query!.operationKey!, signal);
  };
  return createOriginalWebControlPlane(config, endpoints.map((url, index) => ({ url, method: index % 3 === 1 ? "POST" as const : "GET" as const,
    ...(original === undefined ? {} : { handle: (browser: Request, signal: AbortSignal) => handle(browser, signal, index) }) })),
    { prefix: "governance", kind: error => error instanceof PublicClientRegistryError || error instanceof OAuthConsentPolicyStoreError ? error.kind : undefined });
}
