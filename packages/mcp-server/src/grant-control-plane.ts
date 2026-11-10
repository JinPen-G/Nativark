/** Original Web grant transport: owner page, summary, revoke-only POST/receipt
 * and optional owner-only call index/exact metering evidence. Never MCP tools,
 * approval, tenant-wide listing or a listener. Current Auth/native audit/CAS stay
 * original; accounting reads neither replay nor release unknown occupancy. */
import { snapshotJson } from "./json-snapshot.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
import type { OriginalWebControlPlane } from "./web-control-plane.js";
import { createPrismaOAuthGrantManagementStore, OAuthGrantManagementError } from "./prisma-oauth-grant-management.js";
import type { OriginalOAuthGrantManagement, PrismaOAuthGrantManagementStore } from "./prisma-oauth-grant-management.js";
import type { OriginalOAuthGrantUseSource } from "./prisma-oauth-grant-use.js";
import type { OriginalOAuthGrantAdmissionSource } from "./prisma-oauth-grant-admission.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
import { createPrismaMcpReadReceiptStore, McpReadReceiptError } from "./prisma-mcp-read-receipt.js";
import type { OriginalMcpReceiptRatePolicySource } from './prisma-mcp-read-receipt.js';
export interface McpGrantControlPlaneConfig {
  enabled: boolean; resourceUrl: string; requestTimeoutMs: number; maxResponseBytes: number;
  listEndpoint: string; summaryEndpoint: string; revocationEndpoint: string; receiptEndpoint: string;
  /** Independent CURRENT owner-only evidence/index; absent stays unrouted.
   * No new business admission, automatic recovery or model management tool. */
  readCallReceiptEndpoint?: string;
  readCallListEndpoint?: string;
}
export interface McpGrantControlPlane extends OriginalWebControlPlane {}
export interface OriginalMcpGrantControlPlaneDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  database: OAuthSqlDatabase<Native>;
  management: { forRequest(browser: Request, grants: Pick<PrismaOAuthGrantManagementStore<Native>, "readIn">): OriginalOAuthGrantManagement<Native> };
  /** No writer exposed here. Missing source still means unavailable last use. */
  usage?: OriginalOAuthGrantUseSource<Native>;
  /** Read-only OAuth intersection; unavailable does not prevent historical ownership reads. */
  admission?: OriginalOAuthGrantAdmissionSource<Native>;
  /** Per-request original independent receipt-read limits. Missing keeps declared
   * call receipt/index paths unavailable, never silently unmetered. */
  receiptTraffic?: { forRequest(browser: Request): OriginalMcpReceiptRatePolicySource<Native> };
}
const fail = (kind: OAuthGrantManagementError["kind"]) => new OAuthGrantManagementError(kind);
function parameters(params: URLSearchParams, required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  const allowed = new Set([...required, ...optional]), result: Record<string, string> = Object.create(null);
  for (const [name, value] of params) { if (!allowed.has(name) || Object.hasOwn(result, name) || value === "") throw fail("invalid"); result[name] = value; }
  if (required.some(name => !Object.hasOwn(result, name))) throw fail("invalid"); return result;
}
const decimal = (value: string, maximum: number) => {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) throw fail("invalid"); const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw fail("invalid"); return number;
};
export function createMcpGrantControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpGrantControlPlaneConfig, original?: OriginalMcpGrantControlPlaneDependencies<Native>
): McpGrantControlPlane {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 1 }) as unknown as McpGrantControlPlaneConfig;
  const resource = new URL(config.resourceUrl);
  if (resource.protocol !== "https:" || resource.username || resource.password || resource.search || resource.hash || resource.href !== config.resourceUrl || resource.href.length > 2048) throw fail("invalid");
  if (original !== undefined && (typeof original?.database?.$transaction !== "function" || typeof original.management?.forRequest !== "function"
    || original.usage !== undefined && typeof original.usage?.readIn !== "function"
    || original.admission !== undefined && typeof original.admission?.readIn !== "function"
    || original.receiptTraffic !== undefined && typeof original.receiptTraffic?.forRequest !== 'function')) throw fail("unavailable");
  // Kind stays fixed even when either optional route is omitted; array position
  // must never silently turn an owner index into a different grant operation.
  const routes = [{ url: config.listEndpoint, kind: 0 }, { url: config.summaryEndpoint, kind: 1 },
    { url: config.revocationEndpoint, kind: 2 }, { url: config.receiptEndpoint, kind: 3 },
    ...(config.readCallReceiptEndpoint === undefined ? [] : [{ url: config.readCallReceiptEndpoint, kind: 4 }]),
    ...(config.readCallListEndpoint === undefined ? [] : [{ url: config.readCallListEndpoint, kind: 5 }])];
  const managerFor = original?.management.forRequest.bind(original.management), database = original?.database;
  const receiptRateFor = original?.receiptTraffic?.forRequest.bind(original.receiptTraffic);
  const usage = original?.usage === undefined ? undefined : Object.freeze({ readIn: original.usage.readIn.bind(original.usage) });
  const admission = original?.admission === undefined ? undefined : Object.freeze({ readIn: original.admission.readIn.bind(original.admission) });
  const handle = async (browser: Request, signal: AbortSignal, route: typeof routes[number]): Promise<unknown> => {
    const url = new URL(browser.url), expected = new URL(route.url), kind = route.kind, post = kind === 2;
    const origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (url.username || url.password || url.hash || url.href.length > 8192 || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    // GET need not send Origin; if present it must match. POST always requires it.
    // Neither this nor Fetch Metadata is identity or a caller "human" exemption.
    if (post && origin !== expected.origin || origin !== null && origin !== expected.origin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get("authorization") ?? "")) throw fail("denied");
    let input: Record<string, string>;
    if (post) {
      if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
      try { const text = await readOAuthReviewBody(browser, signal, 4096);
        if (/%(?![0-9a-f]{2})/i.test(text)) throw fail("invalid"); input = parameters(new URLSearchParams(text), ["operationKey", "grantId", "expectedRevision"]);
      } catch { if (signal.aborted) throw fail("unavailable"); throw fail("invalid"); }
    } else input = parameters(url.searchParams, kind === 0 ? [] : kind === 1 || kind === 5 ? ["grantId"] : kind === 4 ? ["grantId", "callId"] : ["grantId", "operationKey"], kind === 0 || kind === 5 ? ["limit", "cursor"] : []);
    if (signal.aborted || !database || !managerFor) throw fail("unavailable");
    let store: PrismaOAuthGrantManagementStore<Native> | undefined;
    const readOnly = Object.freeze({ readIn(tx: Native, grantId: string, currentSignal: AbortSignal) {
      if (!store) throw fail("unavailable"); return store.readIn(tx, grantId, currentSignal);
    } });
    const manager = managerFor(browser, readOnly);
    store = createPrismaOAuthGrantManagementStore({ resourceUrl: config.resourceUrl }, database, manager, usage, admission);
    if (kind === 0) return store.list({ limit: input.limit === undefined ? 20 : decimal(input.limit, 20), ...(input.cursor === undefined ? {} : { cursor: input.cursor }) }, signal);
    if (kind === 1) return store.read(input.grantId!, signal);
    if (kind === 2) return store.revoke({ operationKey: input.operationKey!, grantId: input.grantId!, expectedRevision: decimal(input.expectedRevision!, 2147483646) }, signal);
    if (kind === 4 || kind === 5) {
      if (!receiptRateFor) throw fail('unavailable');
      const rate = receiptRateFor(browser); if (typeof rate?.current !== 'function') throw fail('unavailable');
      const reads = createPrismaMcpReadReceiptStore({ resourceUrl: config.resourceUrl }, database, store, manager, rate);
      return kind === 4 ? reads.read({ grantId: input.grantId!, callId: input.callId! }, signal)
        : reads.list({ grantId: input.grantId!, limit: input.limit === undefined ? 20 : decimal(input.limit, 20), ...(input.cursor === undefined ? {} : { cursor: input.cursor }) }, signal);
    }
    return store.operation(input.grantId!, input.operationKey!, signal);
  };
  return createOriginalWebControlPlane(config, routes.map(route => ({ url: route.url, method: route.kind === 2 ? "POST" as const : "GET" as const,
    ...(original === undefined ? {} : { handle: (request: Request, signal: AbortSignal) => handle(request, signal, route) }) })),
    { prefix: "grant", kind: error => error instanceof OAuthGrantManagementError || error instanceof McpReadReceiptError ? error.kind : undefined });
}
