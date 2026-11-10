/** Original platform public-client review preparation, nonce decision and publication.
 * Same Serializable transaction/current original SaaS+verification/audit are required.
 * No user consent/grant, anonymous registration, listener, MFA execution or retries. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureRegisteredPublicClient } from "./prisma-public-client-registry.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { RegisteredPublicClient } from "./public-client-authorization.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";

export interface PublicClientRegistrationReview { reference: string; revision: number; expiresAt: number; registration: RegisteredPublicClient }
export interface PublicClientRegistrationReviewSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  current(transaction: Native, clientId: string, signal: AbortSignal): Promise<PublicClientRegistrationReview | undefined>;
}
export interface PublicClientReviewReviewer {
  userId: string; tenantId: string; audience: "operator"; sessionId: string; expiresAt: number;
  verification?: { kind: "satisfied" | "not_required"; reference: string; revision: number; expiresAt: number };
}
export interface OriginalPublicClientReviewRequest<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** ORIGINAL current SaaS and applicable completed verification. Historical
   * owner reads do not require a new review/MFA permit; never trust body claims. */
  current(transaction: Native, registration: RegisteredPublicClient | undefined, signal: AbortSignal,
    purpose?: "review" | "read_receipt"): Promise<PublicClientReviewReviewer | undefined>;
  audit(transaction: Native, event: { operationKey: string; clientId: string; actorId: string; tenantId: string;
    revision: number; stage: "prepared" | "approved" | "denied" }, signal: AbortSignal): Promise<void>;
}
export interface OriginalPublicClientReviewManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  forRequest(browser: Request): OriginalPublicClientReviewRequest<Native>;
}
export interface PrismaPublicClientReview<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  prepare(browser: Request, signal: AbortSignal): Promise<{ state: "prepared"; operationKey: string; nonce: string; decisionRevision: 1;
    reviewRevision: number; registration: RegisteredPublicClient; actionExpiresAt: number } | ReviewReceipt>;
  decide(browser: Request, signal: AbortSignal): Promise<ReviewReceipt>;
  receipt(browser: Request, signal: AbortSignal): Promise<ReviewReceipt | { state: "not_observed"; retryable: false }>;
  source: PublicClientRegistrationReviewSource<Native>;
}
export interface ReviewReceipt { state: "observed"; operationKey: string; clientId: string; decision: "pending" | "approved" | "denied";
  decisionRevision: number; reviewRevision: number; retryable: false }
export class PublicClientReviewError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`Public client review ${kind}`); this.name = "PublicClientReviewError"; }
}
const fail = (kind: PublicClientReviewError["kind"]) => new PublicClientReviewError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const ref = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const revision = (v: unknown, zero = false): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= (zero ? 0 : 1) && v <= 2147483647;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export const publicClientReviewRegistrationHash = (value: unknown) => digest(JSON.stringify(captureRegisteredPublicClient(value)));
function record(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") { if (Buffer.byteLength(value, "utf8") > 65536) throw fail("unavailable"); value = JSON.parse(value); }
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 32 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== names.length || names.some(n => !Object.hasOwn(copy, n))) throw fail("invalid");
  return copy as Record<string, unknown>;
}
function selected(rows: unknown, names: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
  if (!rows.length) return undefined;
  const field = Object.getOwnPropertyDescriptor(rows, "0"); if (!field?.enumerable || !Object.hasOwn(field, "value")) throw fail("unavailable");
  return snapshotJsonFields(field.value, names, { stringCharacters: 65536, arrayItems: 32 });
}
async function body(browser: Request, signal: AbortSignal, maximum: number) {
  const reader = browser.body?.getReader(); if (!reader) throw fail("invalid");
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { live(signal); const part = await reader.read(); live(signal); if (part.done) break; size += part.value.byteLength;
    if (size > maximum) { cancel(); throw fail("invalid"); } chunks.push(part.value); } }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}
// Reuse the bounded Web stream reader without another request-body algorithm.
export { body as readOAuthReviewBody };

type ReviewRow = { operationKey: string; clientId: string; actorId: string; tenantId: string; browserSessionId: string;
  reviewRevision: number; nonceHash: string; decisionRevision: number; state: "pending" | "approved" | "denied"; decidedAt: number | null; recordJson: unknown };
type Draft = { operationKey: string; expectedRevision: number; registration: RegisteredPublicClient;
  principal: { userId: string; tenantId: string; audience: "operator"; sessionId: string };
  verification: NonNullable<PublicClientReviewReviewer["verification"]>; actionExpiresAt: number; policyHash: string };

export function createPrismaPublicClientReview<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { enabled: boolean; prepareEndpoint: string; decisionEndpoint: string; receiptEndpoint: string;
    allowedScopes: readonly string[]; policyRevision: number; actionTtlSeconds: number; maxReviewLifetimeSeconds: number },
  database: OAuthSqlDatabase<Native>, registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">,
  management: OriginalPublicClientReviewManagement<Native>
): PrismaPublicClientReview<Native> {
  const urls = [config.prepareEndpoint, config.decisionEndpoint, config.receiptEndpoint].map(value => new URL(value));
  const scopes = Object.freeze([...config.allowedScopes]), allowed = new Set(scopes), enabled = config.enabled;
  if (typeof enabled !== "boolean" || urls.some((url, i) => url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== [config.prepareEndpoint, config.decisionEndpoint, config.receiptEndpoint][i] || url.href.length > 2048)
    || new Set(urls.map(url => url.origin)).size !== 1 || new Set(urls.map(url => url.pathname)).size !== 3 || !revision(config.policyRevision)
    || !positive(config.actionTtlSeconds) || config.actionTtlSeconds > 900 || !positive(config.maxReviewLifetimeSeconds)
    || config.maxReviewLifetimeSeconds > Number.MAX_SAFE_INTEGER - Date.now() / 1000 || allowed.size < 1 || allowed.size > 32 || allowed.size !== scopes.length
    || [...allowed].some(s => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(s)) || typeof database?.$transaction !== "function" || typeof registrations?.readIn !== "function" || typeof management?.forRequest !== "function") throw fail("unavailable");
  const ttl = config.actionTtlSeconds, maximumLifetime = config.maxReviewLifetimeSeconds;
  const policyHash = digest(JSON.stringify({ endpoints: urls.map(url => url.href), scopes, policyRevision: config.policyRevision, ttl, maximumLifetime }));
  const transact = database.$transaction.bind(database), client = registrations.readIn.bind(registrations), managerFor = management.forRequest.bind(management);
  const run = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal) => { live(signal); let entered = false;
    const value = await transact(async tx => { if (entered) throw fail("unavailable"); entered = true; live(signal); const result = await consume(tx); live(signal); return result; }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(signal); return value; };
  const route = (browser: Request, index: number) => {
    const url = new URL(browser.url), expected = urls[index], post = index !== 2, origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (browser.method !== (post ? "POST" : "GET") || url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash || post && url.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && origin !== expected.origin || origin !== null && origin !== expected.origin || site !== null && site !== "same-origin" && site !== "none") throw fail("denied");
    return url;
  };
  const manager = (browser: Request) => { const value = managerFor(browser); if (typeof value?.current !== "function" || typeof value.audit !== "function") throw fail("unavailable"); return { current: value.current.bind(value), audit: value.audit.bind(value) }; };
  const principal = async (m: ReturnType<typeof manager>, tx: Native, registration: RegisteredPublicClient | undefined, signal: AbortSignal, purpose: "review" | "read_receipt" = "review") => {
    live(signal); const original = await m.current(tx, registration, signal, purpose); live(signal); if (!original) throw fail("denied");
    const p = record(original, purpose === "review" ? ["userId", "tenantId", "audience", "sessionId", "expiresAt", "verification"] : ["userId", "tenantId", "audience", "sessionId", "expiresAt"]);
    if (![p.userId, p.tenantId, p.sessionId].every(id) || p.audience !== "operator" || !positive(p.expiresAt) || p.expiresAt <= Date.now() / 1000) throw fail("denied");
    if (purpose === "review") { const v = record(p.verification, ["kind", "reference", "revision", "expiresAt"]);
      if (!["satisfied", "not_required"].includes(v.kind as string) || !ref(v.reference) || !revision(v.revision) || !positive(v.expiresAt) || v.expiresAt <= Date.now() / 1000) throw fail("denied"); }
    return p as unknown as PublicClientReviewReviewer;
  };
  const fixed = (p: PublicClientReviewReviewer) => Object.freeze({ userId: p.userId, tenantId: p.tenantId, audience: "operator" as const, sessionId: p.sessionId });
  const pointer = async (tx: Native, clientId: string, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT clientId, revision, reference FROM mcp_oauth_public_client_reviews WHERE clientId = ${clientId} FOR UPDATE`; live(signal);
    const r = selected(rows, ["clientId", "revision", "reference"]); if (!r) return undefined;
    if (r.clientId !== clientId || !revision(r.revision) || !key(r.reference)) throw fail("unavailable");
    return { clientId, revision: r.revision, reference: r.reference };
  };
  const row = async (tx: Native, operationKey: string, signal: AbortSignal): Promise<ReviewRow | undefined> => {
    // Project BIGINT into a JSON numeric SQL type; unsafe integer values still
    // fail the existing decision-row validation, and pending NULL stays NULL.
    const rows = await tx.$queryRaw<unknown[]>`SELECT operationKey, clientId, actorId, tenantId, browserSessionId, reviewRevision, nonceHash, decisionRevision, state, CAST(decidedAt AS DOUBLE) AS decidedAt, recordJson FROM mcp_oauth_public_client_review_drafts WHERE operationKey = ${operationKey} FOR UPDATE`; live(signal);
    const r = selected(rows, ["operationKey", "clientId", "actorId", "tenantId", "browserSessionId", "reviewRevision", "nonceHash", "decisionRevision", "state", "decidedAt", "recordJson"]); if (!r) return undefined;
    if (r.operationKey !== operationKey || !ref(r.clientId) || ![r.actorId, r.tenantId, r.browserSessionId].every(id) || !revision(r.reviewRevision) || typeof r.nonceHash !== "string" || !/^[a-f0-9]{64}$/.test(r.nonceHash)
      || (r.state === "pending" ? r.decisionRevision !== 1 || r.decidedAt !== null : !["approved", "denied"].includes(r.state as string) || r.decisionRevision !== 2 || !positive(r.decidedAt))) throw fail("unavailable");
    return r as unknown as ReviewRow;
  };
  const draft = (r: ReviewRow): Draft => {
    const d = record(r.recordJson, ["operationKey", "expectedRevision", "registration", "principal", "verification", "actionExpiresAt", "policyHash"]), registration = captureRegisteredPublicClient(d.registration);
    const p = record(d.principal, ["userId", "tenantId", "audience", "sessionId"]), v = record(d.verification, ["kind", "reference", "revision", "expiresAt"]);
    if (d.operationKey !== r.operationKey || registration.clientId !== r.clientId || !revision(d.expectedRevision, true) || d.expectedRevision + 1 !== r.reviewRevision
      || p.userId !== r.actorId || p.tenantId !== r.tenantId || p.sessionId !== r.browserSessionId || p.audience !== "operator" || !positive(d.actionExpiresAt)
      || !["satisfied", "not_required"].includes(v.kind as string) || !ref(v.reference) || !revision(v.revision) || !positive(v.expiresAt) || d.actionExpiresAt > v.expiresAt
      || typeof d.policyHash !== "string" || !/^[a-f0-9]{64}$/.test(d.policyHash) || r.decidedAt !== null && r.decidedAt > d.actionExpiresAt) throw fail("unavailable");
    // JSON snapshots use null prototypes. Rebuild the same validated actor tuple
    // as preparation so storage representation cannot become an authority change.
    return { operationKey: r.operationKey, expectedRevision: d.expectedRevision, registration, principal: Object.freeze({ userId: r.actorId, tenantId: r.tenantId, audience: "operator" as const, sessionId: r.browserSessionId }), verification: v as unknown as Draft["verification"], actionExpiresAt: d.actionExpiresAt, policyHash: d.policyHash };
  };
  const observation = (r: ReviewRow): ReviewReceipt => ({ state: "observed", operationKey: r.operationKey, clientId: r.clientId, decision: r.state, decisionRevision: r.decisionRevision, reviewRevision: r.reviewRevision, retryable: false });
  const checkDraft = (d: Draft, p: PublicClientReviewReviewer) => { if (!isDeepStrictEqual(d.principal, fixed(p)) || !isDeepStrictEqual(d.verification, p.verification) || d.policyHash !== policyHash || d.actionExpiresAt <= Date.now() / 1000) throw fail("denied"); };
  const eligible = async (tx: Native, registration: RegisteredPublicClient, signal: AbortSignal) => { const current = await client(tx, registration.clientId, signal); live(signal);
    if (registration.revision !== (current?.revision ?? 0) + 1 || registration.scopes.some(scope => !allowed.has(scope)) || registration.expiresAt <= Date.now() / 1000 || registration.expiresAt > Math.floor(Date.now() / 1000) + maximumLifetime) throw fail("denied"); };
  const emit = async (m: ReturnType<typeof manager>, tx: Native, r: ReviewRow, stage: "prepared" | "approved" | "denied", signal: AbortSignal) => { await m.audit(tx, { operationKey: r.operationKey, clientId: r.clientId, actorId: r.actorId, tenantId: r.tenantId, revision: r.reviewRevision, stage }, signal); live(signal); };
  return Object.freeze({
    async prepare(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try {
        live(signal); if (!enabled) throw fail("unavailable"); route(browser, 0); const m = manager(browser);
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        const input = record(JSON.parse(await body(browser, signal, 65536)), ["operationKey", "expectedRevision", "registration"]), registration = captureRegisteredPublicClient(input.registration);
        if (!key(input.operationKey) || !revision(input.expectedRevision, true) || input.expectedRevision >= 2147483647) throw fail("invalid");
        const operationKey = input.operationKey, expectedRevision = input.expectedRevision;
        return await run(async tx => {
          entered = true; const before = await principal(m, tx, registration, signal);
          // Same lock order as publication/current review: client -> pointer -> draft.
          await client(tx, registration.clientId, signal); live(signal);
          const current = await pointer(tx, registration.clientId, signal), existing = await row(tx, operationKey, signal);
          if (existing) { const d = draft(existing); if (!isDeepStrictEqual(d.principal, fixed(before)) || d.expectedRevision !== expectedRevision || !isDeepStrictEqual(d.registration, registration)) throw fail("conflict");
            if (!isDeepStrictEqual(await principal(m, tx, registration, signal), before)) throw fail("denied"); return observation(existing); }
          await eligible(tx, registration, signal); if ((current?.revision ?? 0) !== expectedRevision) throw fail("conflict");
          const nonce = randomBytes(32).toString("base64url"), actionExpiresAt = Math.min(before.expiresAt, before.verification!.expiresAt, Math.floor(Date.now() / 1000) + ttl);
          const d: Draft = { operationKey, expectedRevision, registration, principal: fixed(before), verification: before.verification!, actionExpiresAt, policyHash };
          const count = await tx.$executeRaw`INSERT INTO mcp_oauth_public_client_review_drafts (operationKey, clientId, actorId, tenantId, browserSessionId, reviewRevision, nonceHash, decisionRevision, state, decidedAt, recordJson) VALUES (${operationKey}, ${registration.clientId}, ${before.userId}, ${before.tenantId}, ${before.sessionId}, ${expectedRevision + 1}, ${digest(nonce)}, ${1}, ${"pending"}, ${null}, ${JSON.stringify(d)})`;
          live(signal); if (count !== 1) throw fail("unavailable"); const saved = await row(tx, operationKey, signal); if (!saved || saved.state !== "pending" || saved.nonceHash !== digest(nonce) || !isDeepStrictEqual(draft(saved), d)) throw fail("unavailable");
          await emit(m, tx, saved, "prepared", signal); if (!isDeepStrictEqual(await principal(m, tx, registration, signal), before)) throw fail("denied");
          return { state: "prepared" as const, operationKey, nonce, decisionRevision: 1 as const, reviewRevision: expectedRevision + 1, registration, actionExpiresAt };
        }, signal);
      } catch (error) { if (error instanceof PublicClientReviewError && ["invalid", "denied", "conflict", "unavailable"].includes(error.kind) && !entered) throw error; if (error instanceof PublicClientReviewError && ["invalid", "denied", "conflict"].includes(error.kind)) throw error; throw fail(entered ? "unknown" : "invalid"); }
    },
    async decide(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try {
        live(signal); if (!enabled) throw fail("unavailable"); route(browser, 1); const m = manager(browser);
        if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        const params = new URLSearchParams(await body(browser, signal, 4096)), names = ["operationKey", "clientId", "expectedRevision", "decision", "nonce"];
        if ([...params.keys()].some(k => !names.includes(k)) || names.some(n => params.getAll(n).length !== 1) || !key(params.get("operationKey")) || !ref(params.get("clientId")) || params.get("expectedRevision") !== "1" || !["approve", "deny"].includes(params.get("decision")!)
          || !/^[A-Za-z0-9_-]{43}$/.test(params.get("nonce")!) || Buffer.from(params.get("nonce")!, "base64url").toString("base64url") !== params.get("nonce")) throw fail("invalid");
        const operationKey = params.get("operationKey")!, nonce = params.get("nonce")!, state = params.get("decision") === "approve" ? "approved" as const : "denied" as const;
        return await run(async tx => {
          entered = true; const authenticated = await principal(m, tx, undefined, signal, "read_receipt"), clientId = params.get("clientId")!;
          await client(tx, clientId, signal); live(signal); const previous = await pointer(tx, clientId, signal);
          const r = await row(tx, operationKey, signal); if (!r || r.clientId !== clientId) throw fail("denied"); const d = draft(r), before = await principal(m, tx, d.registration, signal);
          if (!isDeepStrictEqual(fixed(authenticated), fixed(before))) throw fail("denied");
          if (!isDeepStrictEqual(d.principal, fixed(before)) || !timingSafeEqual(Buffer.from(r.nonceHash, "hex"), Buffer.from(digest(nonce), "hex"))) throw fail("denied");
          if (r.state !== "pending") { if (r.state !== state) throw fail("conflict"); if (!isDeepStrictEqual(await principal(m, tx, d.registration, signal), before)) throw fail("denied"); return observation(r); }
          checkDraft(d, before); await eligible(tx, d.registration, signal);
          if (state === "approved" && (previous?.revision ?? 0) !== d.expectedRevision) throw fail("conflict");
          const decidedAt = Math.floor(Date.now() / 1000), changed = await tx.$executeRaw`UPDATE mcp_oauth_public_client_review_drafts SET decisionRevision = ${2}, state = ${state}, decidedAt = ${decidedAt} WHERE operationKey = ${operationKey} AND decisionRevision = ${1} AND state = ${"pending"} AND nonceHash = ${r.nonceHash}`;
          live(signal); if (changed !== 1) throw fail("conflict");
          if (state === "approved") { const published = previous
            ? await tx.$executeRaw`UPDATE mcp_oauth_public_client_reviews SET revision = ${r.reviewRevision}, reference = ${operationKey} WHERE clientId = ${r.clientId} AND revision = ${d.expectedRevision}`
            : await tx.$executeRaw`INSERT INTO mcp_oauth_public_client_reviews (clientId, revision, reference) VALUES (${r.clientId}, ${r.reviewRevision}, ${operationKey})`;
            live(signal); if (published !== 1) throw fail("conflict"); }
          const completed = await row(tx, operationKey, signal); if (!completed || completed.state !== state || completed.decisionRevision !== 2 || completed.decidedAt !== decidedAt || !isDeepStrictEqual(draft(completed), d)) throw fail("unavailable");
          if (state === "approved") { const current = await pointer(tx, r.clientId, signal); if (!current || current.reference !== operationKey || current.revision !== r.reviewRevision) throw fail("unavailable"); }
          await emit(m, tx, completed, state, signal); if (!isDeepStrictEqual(await principal(m, tx, d.registration, signal), before)) throw fail("denied"); return observation(completed);
        }, signal);
      } catch (error) { if (error instanceof PublicClientReviewError && ["invalid", "denied", "conflict"].includes(error.kind)) throw error; throw fail(entered ? "unknown" : "invalid"); }
    },
    async receipt(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]);
      try { const url = route(browser, 2), params = url.searchParams; if ([...params.keys()].some(k => k !== "operationKey") || params.getAll("operationKey").length !== 1 || !key(params.get("operationKey"))) throw fail("invalid"); const m = manager(browser), operationKey = params.get("operationKey")!;
        return await run(async tx => { const before = await principal(m, tx, undefined, signal, "read_receipt"), r = await row(tx, operationKey, signal); if (r) { const d = draft(r); if (d.principal.userId !== before.userId || d.principal.tenantId !== before.tenantId) throw fail("denied"); }
          if (!isDeepStrictEqual(await principal(m, tx, undefined, signal, "read_receipt"), before)) throw fail("denied"); return r ? observation(r) : { state: "not_observed" as const, retryable: false as const }; }, signal);
      } catch (error) { if (error instanceof PublicClientReviewError && ["invalid", "denied"].includes(error.kind)) throw error; throw fail("unavailable"); }
    },
    source: Object.freeze({ async current(tx: Native, clientId: string, signal: AbortSignal): Promise<PublicClientRegistrationReview | undefined> {
      try { live(signal); if (!enabled) return undefined; if (!ref(clientId)) throw fail("invalid"); await client(tx, clientId, signal); live(signal); const p = await pointer(tx, clientId, signal); if (!p) return undefined;
        const r = await row(tx, p.reference, signal); if (!r) throw fail("unavailable"); const d = draft(r);
        if (r.clientId !== clientId || r.reviewRevision !== p.revision || r.state !== "approved" || r.decisionRevision !== 2) throw fail("unavailable");
        if (d.policyHash !== policyHash || d.registration.scopes.some(scope => !allowed.has(scope)) || d.registration.expiresAt <= Date.now() / 1000) return undefined;
        const again = await pointer(tx, clientId, signal), saved = await row(tx, p.reference, signal); if (!isDeepStrictEqual(again, p) || !isDeepStrictEqual(saved, r)) throw fail("unavailable");
        return Object.freeze({ reference: r.operationKey, revision: r.reviewRevision, expiresAt: d.registration.expiresAt, registration: d.registration });
      } catch { throw fail("unavailable"); }
    } }),
  });
}
