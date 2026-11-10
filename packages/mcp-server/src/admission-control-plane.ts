/** Fixed Web admission metadata control plane: current read, original CAS save and
 * original-key receipt. Original platform/workspace managers own rights and native
 * audit. Not user consent, MFA, a grant, field/tool publication or an HTTP listener;
 * enabled metadata alone never opens business access. Unknown is not a replay permit. */
import { snapshotJson } from "./json-snapshot.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
import type { OriginalWebControlPlane } from "./web-control-plane.js";
import { createPrismaOAuthAdmissionStore, captureOAuthAdmissionTarget, OAuthAdmissionStoreError } from "./prisma-oauth-admission-store.js";
import type { OriginalOAuthAdmissionManagement, OAuthAdmissionSave } from "./prisma-oauth-admission-store.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
export interface McpAdmissionControlPlaneConfig {
  enabled: boolean; resourceUrl: string; allowedScopes: readonly string[];
  requestTimeoutMs: number; maxResponseBytes: number;
  readEndpoint: string; saveEndpoint: string; receiptEndpoint: string;
}
export interface McpAdmissionControlPlane extends OriginalWebControlPlane {}
export interface OriginalMcpAdmissionControlPlaneDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  database: OAuthSqlDatabase<Native>;
  registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">;
  management: { forRequest(browser: Request): OriginalOAuthAdmissionManagement<Native> };
}
const fail = (kind: OAuthAdmissionStoreError["kind"]) => new OAuthAdmissionStoreError(kind);
function parameters(query: URLSearchParams, required: readonly string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of query) { if (!required.includes(name) || Object.hasOwn(result, name) || !value) throw fail("invalid"); result[name] = value; }
  if (required.some(name => !Object.hasOwn(result, name))) throw fail("invalid"); return result;
}
export function createMcpAdmissionControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpAdmissionControlPlaneConfig, original?: OriginalMcpAdmissionControlPlaneDependencies<Native>
): McpAdmissionControlPlane {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 }) as unknown as McpAdmissionControlPlaneConfig;
  const resource = new URL(config.resourceUrl), scopes = new Set(config.allowedScopes);
  if (resource.protocol !== "https:" || resource.username || resource.password || resource.search || resource.hash || resource.href !== config.resourceUrl || resource.href.length > 2048
    || scopes.size < 1 || scopes.size > 32 || scopes.size !== config.allowedScopes.length || [...scopes].some(scope => typeof scope !== "string" || !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(scope))) throw fail("invalid");
  if (original !== undefined && (typeof original?.database?.$transaction !== "function" || typeof original.registrations?.readIn !== "function" || typeof original.management?.forRequest !== "function")) throw fail("unavailable");
  const endpoints = [config.readEndpoint, config.saveEndpoint, config.receiptEndpoint], managerFor = original?.management.forRequest.bind(original.management);
  const database = original?.database, registrations = original?.registrations === undefined ? undefined : Object.freeze({ readIn: original.registrations.readIn.bind(original.registrations) });
  const handle = async (browser: Request, signal: AbortSignal, index: number): Promise<unknown> => {
    const url = new URL(browser.url), origin = new URL(endpoints[index]!).origin, post = index === 1;
    const suppliedOrigin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (url.username || url.password || url.hash || url.href.length > 8192 || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && suppliedOrigin !== origin || suppliedOrigin !== null && suppliedOrigin !== origin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get("authorization") ?? "")) throw fail("denied");
    let input: unknown, query: Record<string, string> | undefined;
    try {
      if (post) {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        input = snapshotJson(JSON.parse(await readOAuthReviewBody(browser, signal, 65536)), { stringCharacters: 2048, arrayItems: 50 });
      } else { query = parameters(url.searchParams, index === 0 ? ["target"] : ["target", "operationKey"]); input = captureOAuthAdmissionTarget(JSON.parse(query.target!)); }
    } catch { if (signal.aborted) throw fail("unavailable"); throw fail("invalid"); }
    if (signal.aborted || !database || !registrations || !managerFor) throw fail("unavailable");
    const store = createPrismaOAuthAdmissionStore({ resourceUrl: config.resourceUrl, allowedScopes: config.allowedScopes }, database, registrations, managerFor(browser));
    // save owns the closed input/candidate capture before touching any native row;
    // this cast supplies no authority. It computes the saved revision and checks
    // the caller's expected CAS against the original row, not against a UI claim.
    if (post) return store.save(input as OAuthAdmissionSave, signal);
    const target = captureOAuthAdmissionTarget(input);
    return index === 0 ? store.read(target, signal) : store.operation(target, query!.operationKey!, signal);
  };
  return createOriginalWebControlPlane(config, endpoints.map((url, index) => ({ url, method: index === 1 ? "POST" as const : "GET" as const,
    ...(original === undefined ? {} : { handle: (browser: Request, signal: AbortSignal) => handle(browser, signal, index) }) })),
    { prefix: "admission", kind: error => error instanceof OAuthAdmissionStoreError ? error.kind : undefined }, 50);
}
