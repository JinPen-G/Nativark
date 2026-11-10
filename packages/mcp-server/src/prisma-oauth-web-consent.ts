/** Trusted Web-only consent preparation, nonce CAS and completed-decision source.
 * No listener/UI, model approval tool or login/MFA implementation. Original Auth,
 * reviewed notice/current verification policy and same-transaction audit are required;
 * only an authenticated same-origin POST can record a decision. Nothing issues code. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOAuthConsentRequest } from "./prisma-oauth-consent-authority.js";
import { captureOAuthAdmission } from "./prisma-oauth-grant-authority.js";
import type { OriginalCompletedOAuthConsentSource, CompletedOriginalOAuthConsent } from "./prisma-oauth-consent-authority.js";
import type { OAuthSqlTransaction, PrismaOAuthStore } from "./prisma-oauth-store.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { PrismaOAuthAdmissionStore } from "./prisma-oauth-admission-store.js";
import type { ValidatedPublicClientAuthorization, RegisteredPublicClient } from "./public-client-authorization.js";

export interface OAuthConsentBrowserPrincipal {
  readonly userId: string; readonly tenantId: string; readonly workspaceId: string;
  readonly audience: "operator"; readonly sessionId: string; readonly expiresAt: number;
}
export interface OriginalOAuthConsentReview {
  subject: string; noticeVersion: string; noticeText: string; expiresAt: number;
  /** CURRENT original policy/evidence, not a client claim or a default exemption.
   * Required MFA lacking evidence must return unavailable, never not_required. */
  verification: { kind: "satisfied" | "not_required"; reference: string; revision: number; expiresAt: number };
}
export interface OriginalOAuthWebConsentPolicy<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original approved external processing/storage notice and applicable current
   * verification/consent rights, locked in this transaction through commit. */
  current(input: ValidatedPublicClientAuthorization, principal: OAuthConsentBrowserPrincipal,
    transaction: Native, signal: AbortSignal): Promise<OriginalOAuthConsentReview | undefined>;
  audit(transaction: Native, receipt: { authorizationId: string; userId: string; tenantId: string; workspaceId: string;
    revision: number; stage: "prepared" | "approved" | "denied" }, signal: AbortSignal): Promise<void>;
  auditGrant: OriginalCompletedOAuthConsentSource<Native>["audit"];
}
export type OAuthWebConsentReceipt =
  | { state: "observed"; authorizationId: string; revision: number; decision: "pending" | "approved" | "denied"; retryable: false }
  | { state: "not_observed"; retryable: false };
export interface PrismaOAuthWebConsent<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Read-only original request key before preparation. Current Web owner access
   * is required; this returns no nonce, preparation/issuance permit or completion. */
  reference(input: ValidatedPublicClientAuthorization, browser: Request, signal: AbortSignal): Promise<
    { state: "referenced"; authorizationId: string; retryable: false }>;
  /** Original Web-only preparation. A repeated/unknown preparation never returns
   * another nonce, changes a deadline or silently starts another authorization. */
  prepare(input: ValidatedPublicClientAuthorization, browser: Request, signal: AbortSignal, expectedAuthorizationId?: string): Promise<
    { state: "prepared"; authorizationId: string; revision: 1; nonce: string; clientId: string; scopes: readonly string[]; noticeVersion: string; noticeText: string; expiresAt: number }
    | { state: "observed"; authorizationId: string; revision: number; decision: string; retryable: false }>;
  /** Fixed same-origin authenticated POST, exact form fields and nonce/revision CAS.
   * Repeated same intent returns an original receipt, never another decision. */
  decide(browser: Request, signal: AbortSignal): Promise<{ state: "recorded"; authorizationId: string; revision: 2; decision: "approved" | "denied" }>;
  /** Web-owner historical observation by the original key, including pending.
   * Independent of current issuance/MFA; never returns nonce/subject or replays. */
  receipt(authorizationId: string, browser: Request, signal: AbortSignal): Promise<OAuthWebConsentReceipt>;
  source: OriginalCompletedOAuthConsentSource<Native>;
}
export class OAuthWebConsentError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth Web consent ${kind}`); this.name = "OAuthWebConsentError"; }
}
const fail = (kind: OAuthWebConsentError["kind"]) => new OAuthWebConsentError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const identifier = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const originalId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
function hash(value: unknown) {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}
function ordinary(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") { if (Buffer.byteLength(value, "utf8") > 65_536) throw fail("unavailable"); value = JSON.parse(value); }
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 50 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== fields.length || fields.some(k => !Object.hasOwn(copy, k))
    || Buffer.byteLength(JSON.stringify(copy), "utf8") > 65_536) throw fail("unavailable");
  return copy as Record<string, unknown>;
}
const fixedPrincipal = (p: OAuthConsentBrowserPrincipal) => Object.freeze({ userId: p.userId, tenantId: p.tenantId, workspaceId: p.workspaceId, audience: "operator" as const, sessionId: p.sessionId });
type Draft = { id: string; request: ValidatedPublicClientAuthorization; principal: ReturnType<typeof fixedPrincipal>; subject: string; expiresAt: number; policyHash: string };
type ConsentRow = { id: string; browserSessionId: string; userId: string; tenantId: string; workspaceId: string; nonceHash: string; revision: number; state: "pending" | "approved" | "denied"; decidedAt: number | null; recordJson: unknown };

export function createPrismaOAuthWebConsent<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { authorizationEndpoint: string; consentEndpoint: string; resourceUrl: string; allowedScopes: readonly string[] },
  store: PrismaOAuthStore<Native>, registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">, admissions: Pick<PrismaOAuthAdmissionStore<Native>, "readIn">,
  browserIdentity: { current(browser: Request, transaction: Native, signal: AbortSignal): Promise<OAuthConsentBrowserPrincipal | undefined> },
  policy: OriginalOAuthWebConsentPolicy<Native>): PrismaOAuthWebConsent<Native> {
  const authorization = new URL(config.authorizationEndpoint), endpoint = new URL(config.consentEndpoint), resource = new URL(config.resourceUrl), allowed = new Set(config.allowedScopes);
  if ([authorization, endpoint, resource].some(u => u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    || authorization.href !== config.authorizationEndpoint || endpoint.href !== config.consentEndpoint || resource.href !== config.resourceUrl
    || authorization.origin !== endpoint.origin || authorization.pathname === endpoint.pathname || resource.href.length > 2048
    || allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length || [...allowed].some(v => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(v))
    || typeof store?.native !== "function" || typeof store?.transaction !== "function" || typeof registrations?.readIn !== "function" || typeof admissions?.readIn !== "function"
    || typeof browserIdentity?.current !== "function" || typeof policy?.current !== "function" || typeof policy?.audit !== "function" || typeof policy?.auditGrant !== "function") throw fail("unavailable");
  const native = store.native.bind(store), run = store.transaction.bind(store), client = registrations.readIn.bind(registrations), admission = admissions.readIn.bind(admissions);
  const identity = browserIdentity.current.bind(browserIdentity), review = policy.current.bind(policy), audit = policy.audit.bind(policy), auditGrant = policy.auditGrant.bind(policy);
  const request = (value: unknown) => captureOAuthConsentRequest(value, resource.href, allowed);
  // One canonical key for preparation, pre-submit reference and original receipts.
  const requestId = (input: ValidatedPublicClientAuthorization) => hash({ version: "original-web-consent-1", request: input });
  const route = (browser: Request, post = false) => {
    const url = new URL(browser.url), expected = post ? endpoint : authorization;
    if (browser.method !== (post ? "POST" : "GET") || url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash
      || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    const origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (post && origin !== endpoint.origin || origin !== null && origin !== endpoint.origin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
  };
  const principal = async (browser: Request, tx: Native, signal: AbortSignal) => {
    live(signal); const value = await identity(browser, tx, signal); live(signal); if (!value) throw fail("denied");
    const p = ordinary(value, ["userId", "tenantId", "workspaceId", "audience", "sessionId", "expiresAt"]);
    if (![p.userId, p.tenantId, p.workspaceId, p.sessionId].every(originalId) || p.audience !== "operator" || !positive(p.expiresAt) || p.expiresAt <= Date.now() / 1000) throw fail("denied");
    return Object.freeze(p) as unknown as OAuthConsentBrowserPrincipal;
  };
  const observe = async (input: ValidatedPublicClientAuthorization, browser: Request, tx: Native, signal: AbortSignal) => {
    const p = await principal(browser, tx, signal), registered = await client(tx, input.clientId, signal);
    const platform = await admission(tx, { kind: "platform" }, signal), workspace = await admission(tx, { kind: "workspace", tenantId: p.tenantId, workspaceId: p.workspaceId }, signal);
    const raw = await review(input, p, tx, signal); live(signal); if (!registered || !platform || !workspace || !raw) throw fail("unavailable");
    const c = ordinary(registered, ["clientId", "revision", "enabled", "expiresAt", "redirectUris", "scopes"]) as unknown as RegisteredPublicClient;
    const notice = ordinary(raw, ["subject", "noticeVersion", "noticeText", "expiresAt", "verification"]), verification = ordinary(notice.verification, ["kind", "reference", "revision", "expiresAt"]);
    if (!identifier(notice.subject) || !identifier(notice.noticeVersion) || typeof notice.noticeText !== "string" || !notice.noticeText.trim() || !positive(notice.expiresAt)
      || !["satisfied", "not_required"].includes(verification.kind as string) || !identifier(verification.reference) || !positive(verification.revision) || !positive(verification.expiresAt)) throw fail("unavailable");
    const a = captureOAuthAdmission(platform, false), w = captureOAuthAdmission(workspace, true);
    const callback = new URL(input.redirectUri);
    if (c.clientId !== input.clientId || c.revision !== input.clientRevision || c.enabled !== true || !positive(c.expiresAt) || !Array.isArray(c.redirectUris)
      || !c.redirectUris.some(value => { const registered = new URL(value); return registered.protocol === "http:"
        ? callback.protocol === registered.protocol && callback.hostname === registered.hostname && callback.pathname === registered.pathname : value === input.redirectUri; })
      || a.resource !== resource.href || w.resource !== resource.href || w.tenantId !== p.tenantId || w.workspaceId !== p.workspaceId || !a.enabled || !w.enabled
      || !a.clientIds.includes(input.clientId) || !w.clientIds.includes(input.clientId) || input.scopes.some(scope => !c.scopes.includes(scope) || !a.scopes.includes(scope) || !w.scopes.includes(scope))) throw fail("denied");
    const expiresAt = Math.min(c.expiresAt, a.expiresAt, w.expiresAt, notice.expiresAt as number, verification.expiresAt as number);
    if (expiresAt <= Date.now() / 1000) throw fail("denied");
    return { principal: p, subject: notice.subject as string, noticeVersion: notice.noticeVersion as string, noticeText: notice.noticeText as string,
      policyHash: hash({ client: c, platform: a, workspace: w, notice, verification }), expiresAt };
  };
  const row = async (tx: Native, id: string, signal: AbortSignal): Promise<ConsentRow | undefined> => {
    // BIGINT arrives as bigint through Prisma. Keep NULL/numeric SQL output and
    // let the existing safe-integer check reject values outside exact JSON range.
    const rows = await tx.$queryRaw<unknown[]>`SELECT id, browserSessionId, userId, tenantId, workspaceId, nonceHash, revision, state, CAST(decidedAt AS DOUBLE) AS decidedAt, recordJson FROM mcp_oauth_browser_consents WHERE id = ${id} FOR UPDATE`;
    live(signal); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
    if (!rows.length) return undefined; const field = Object.getOwnPropertyDescriptor(rows, "0"); if (!field?.enumerable || !Object.hasOwn(field, "value")) throw fail("unavailable");
    const r = snapshotJsonFields(field.value, ["id", "browserSessionId", "userId", "tenantId", "workspaceId", "nonceHash", "revision", "state", "decidedAt", "recordJson"], { stringCharacters: 65_536, arrayItems: 50 });
    if (r.id !== id || typeof r.nonceHash !== "string" || !/^[a-f0-9]{64}$/.test(r.nonceHash)
      || (r.state === "pending" ? r.revision !== 1 || r.decidedAt !== null : !["approved", "denied"].includes(r.state as string) || r.revision !== 2 || !positive(r.decidedAt))) throw fail("unavailable");
    return r as unknown as ConsentRow;
  };
  const draft = (r: ConsentRow): Draft => {
    const d = ordinary(r.recordJson, ["id", "request", "principal", "subject", "expiresAt", "policyHash"]), input = request(d.request);
    const p = ordinary(d.principal, ["userId", "tenantId", "workspaceId", "audience", "sessionId"]);
    if (d.id !== r.id || r.id !== requestId(input) || !identifier(d.subject) || !positive(d.expiresAt)
      || typeof d.policyHash !== "string" || !/^[a-f0-9]{64}$/.test(d.policyHash) || p.audience !== "operator"
      || p.sessionId !== r.browserSessionId || p.userId !== r.userId || p.tenantId !== r.tenantId || p.workspaceId !== r.workspaceId
      || ![p.userId, p.tenantId, p.workspaceId, p.sessionId].every(originalId)) throw fail("unavailable");
    return { id: r.id, request: input, principal: p as unknown as Draft["principal"], subject: d.subject, expiresAt: d.expiresAt, policyHash: d.policyHash };
  };
  const check = (d: Draft, current: Awaited<ReturnType<typeof observe>>) => {
    if (!isDeepStrictEqual(d.principal, snapshotJson(fixedPrincipal(current.principal), { stringCharacters: 2048, arrayItems: 50 }))
      || current.subject !== d.subject || current.policyHash !== d.policyHash || d.expiresAt <= Date.now() / 1000) throw fail("denied");
  };
  const ownedReceipt = async (id: string, browser: Request, sql: Native, signal: AbortSignal) => {
    const before = await principal(browser, sql, signal), saved = await row(sql, id, signal), d = saved ? draft(saved) : undefined;
    // Historical ownership does not require new issuance, the old session or MFA.
    // A new current Web session can observe only their same-tenant/space record.
    if (d && (d.principal.userId !== before.userId || d.principal.tenantId !== before.tenantId || d.principal.workspaceId !== before.workspaceId)) throw fail("denied");
    if (!isDeepStrictEqual(await principal(browser, sql, signal), before)) throw fail("denied");
    return saved && d ? { saved, draft: d } : undefined;
  };
  const submission = async (browser: Request, signal: AbortSignal) => {
    route(browser, true);
    if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
    const reader = browser.body?.getReader(); if (!reader) throw fail("invalid");
    const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { live(signal); const item = await reader.read(); live(signal); if (item.done) break; size += item.value.byteLength;
      if (size > 4096) { cancel(); throw fail("invalid"); } chunks.push(item.value); } }
    finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const params = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body)), fields = ["authorizationId", "expectedRevision", "decision", "nonce"];
    if ([...params.keys()].some(k => !fields.includes(k)) || fields.some(k => params.getAll(k).length !== 1)
      || !/^[a-f0-9]{64}$/.test(params.get("authorizationId")!) || params.get("expectedRevision") !== "1"
      || !["approve", "deny"].includes(params.get("decision")!) || !/^[A-Za-z0-9_-]{43}$/.test(params.get("nonce")!)
      || Buffer.from(params.get("nonce")!, "base64url").toString("base64url") !== params.get("nonce")) throw fail("invalid");
    return { id: params.get("authorizationId")!, nonce: params.get("nonce")!, decision: params.get("decision") === "approve" ? "approved" as const : "denied" as const };
  };
  return Object.freeze({
    async reference(raw: ValidatedPublicClientAuthorization, browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]);
      try {
        route(browser); const input = request(raw), id = requestId(input);
        return await run(async tx => {
          await ownedReceipt(id, browser, native(tx), signal);
          return { state: "referenced" as const, authorizationId: id, retryable: false as const };
        }, signal);
      } catch (error) { if (error instanceof OAuthWebConsentError && ["invalid", "denied"].includes(error.kind)) throw error; throw fail("unavailable"); }
    },
    async prepare(raw: ValidatedPublicClientAuthorization, browser: Request, signal: AbortSignal, expectedAuthorizationId?: string) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try {
        route(browser); const input = request(raw), id = requestId(input);
        // A changed registration revision/input cannot silently prepare another
        // request after the Web caller retained its original recovery reference.
        if (expectedAuthorizationId !== undefined && (!/^[a-f0-9]{64}$/.test(expectedAuthorizationId) || expectedAuthorizationId !== id)) throw fail("invalid");
        return await run(async tx => {
        entered = true; const sql = native(tx), before = await observe(input, browser, sql, signal);
        const existing = await row(sql, id, signal);
        if (existing) { const d = draft(existing); check(d, before); if (!isDeepStrictEqual(await observe(input, browser, sql, signal), before)) throw fail("denied");
          return { state: "observed" as const, authorizationId: id, revision: existing.revision, decision: existing.state, retryable: false as const }; }
        const nonce = randomBytes(32).toString("base64url"), expiresAt = Math.min(before.expiresAt, before.principal.expiresAt);
        const d: Draft = { id, request: input, principal: fixedPrincipal(before.principal), subject: before.subject, expiresAt, policyHash: before.policyHash };
        const count = await sql.$executeRaw`INSERT INTO mcp_oauth_browser_consents (id, browserSessionId, userId, tenantId, workspaceId, nonceHash, revision, state, decidedAt, recordJson)
          VALUES (${id}, ${d.principal.sessionId}, ${d.principal.userId}, ${d.principal.tenantId}, ${d.principal.workspaceId}, ${createHash("sha256").update(nonce).digest("hex")}, ${1}, ${"pending"}, ${null}, ${JSON.stringify(d)})`;
        live(signal); if (count !== 1) throw fail("unavailable");
        await audit(sql, { authorizationId: id, userId: d.principal.userId, tenantId: d.principal.tenantId, workspaceId: d.principal.workspaceId, revision: 1, stage: "prepared" }, signal);
        const prepared = await row(sql, id, signal);
        if (!prepared || prepared.state !== "pending" || prepared.nonceHash !== createHash("sha256").update(nonce).digest("hex") || hash(draft(prepared)) !== hash(d)) throw fail("unavailable");
        if (!isDeepStrictEqual(await observe(input, browser, sql, signal), before)) throw fail("denied");
        return { state: "prepared" as const, authorizationId: id, revision: 1 as const, nonce, clientId: input.clientId, scopes: input.scopes, noticeVersion: before.noticeVersion, noticeText: before.noticeText, expiresAt };
      }, signal); } catch (error) { if (error instanceof OAuthWebConsentError && ["invalid", "denied", "conflict"].includes(error.kind)) throw error; throw fail(entered ? "unknown" : "invalid"); }
    },
    async decide(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try { const input = await submission(browser, signal); return await run(async tx => {
        entered = true; const sql = native(tx), saved = await row(sql, input.id, signal); if (!saved) throw fail("unavailable");
        const d = draft(saved), before = await observe(d.request, browser, sql, signal); check(d, before);
        const supplied = createHash("sha256").update(input.nonce).digest(), expected = Buffer.from(saved.nonceHash, "hex");
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw fail("denied");
        if (saved.state !== "pending" && saved.state !== input.decision) throw fail("conflict");
        if (saved.state === "pending") {
          const count = await sql.$executeRaw`UPDATE mcp_oauth_browser_consents SET revision = ${2}, state = ${input.decision}, decidedAt = ${Math.floor(Date.now() / 1000)} WHERE id = ${input.id} AND revision = ${1} AND state = ${"pending"}`;
          live(signal); if (count !== 1) throw fail("conflict");
          await audit(sql, { authorizationId: input.id, userId: d.principal.userId, tenantId: d.principal.tenantId, workspaceId: d.principal.workspaceId, revision: 2, stage: input.decision }, signal);
        }
        const completed = await row(sql, input.id, signal);
        if (!completed || completed.state !== input.decision || completed.revision !== 2 || hash(draft(completed)) !== hash(d)) throw fail("unavailable");
        if (!isDeepStrictEqual(await observe(d.request, browser, sql, signal), before)) throw fail("denied");
        return { state: "recorded" as const, authorizationId: input.id, revision: 2 as const, decision: input.decision };
      }, signal); } catch (error) { if (error instanceof OAuthWebConsentError && ["invalid", "denied", "conflict"].includes(error.kind)) throw error; throw fail(entered ? "unknown" : "invalid"); }
    },
    async receipt(id: string, browser: Request, signal: AbortSignal): Promise<OAuthWebConsentReceipt> {
      signal = AbortSignal.any([signal, browser.signal]);
      try {
        route(browser); if (!/^[a-f0-9]{64}$/.test(id)) throw fail("invalid");
        return await run(async tx => {
          const original = await ownedReceipt(id, browser, native(tx), signal);
          return original ? { state: "observed" as const, authorizationId: id, revision: original.saved.revision, decision: original.saved.state, retryable: false as const }
            : { state: "not_observed" as const, retryable: false as const };
        }, signal);
      } catch (error) { if (error instanceof OAuthWebConsentError && ["invalid", "denied"].includes(error.kind)) throw error; throw fail("unavailable"); }
    },
    source: Object.freeze({
      async current(raw: ValidatedPublicClientAuthorization, browser: Request, sql: Native, signal: AbortSignal, purpose: "issue" | "read_receipt" = "issue"): Promise<CompletedOriginalOAuthConsent | undefined> {
        signal = AbortSignal.any([signal, browser.signal]);
        try {
          route(browser);
          if (purpose === "read_receipt") {
            const input = request(raw), id = requestId(input), original = await ownedReceipt(id, browser, sql, signal);
            if (!original) return undefined; const { saved, draft: d } = original;
            if (saved.state === "pending") return undefined;
            return { kind: saved.state, id, revision: saved.revision, expiresAt: d.expiresAt, request: input, subject: d.subject,
              userId: d.principal.userId, tenantId: d.principal.tenantId, workspaceId: d.principal.workspaceId };
          }
          if (purpose !== "issue") throw fail("denied");
          const input = request(raw), before = await observe(input, browser, sql, signal), id = requestId(input), saved = await row(sql, id, signal);
          if (!saved) return undefined; const d = draft(saved); check(d, before);
          if (!isDeepStrictEqual(await observe(input, browser, sql, signal), before)) throw fail("denied");
          if (saved.state === "pending") return undefined;
          return { kind: saved.state, id, revision: saved.revision, expiresAt: d.expiresAt, request: input, subject: d.subject,
            userId: d.principal.userId, tenantId: d.principal.tenantId, workspaceId: d.principal.workspaceId };
        } catch { throw fail("unavailable"); }
      },
      audit: auditGrant,
    }),
  });
}
