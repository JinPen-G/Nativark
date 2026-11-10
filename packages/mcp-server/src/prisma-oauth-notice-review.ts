/** Original platform/workspace notice review: pending -> explicit nonce decision
 * -> current approved source. Original identity/applicable verification/audit and
 * Serializable commit are mandatory. Not projection save, user OAuth consent,
 * MFA execution, grant/business authority, public UI, listener or retry engine. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { readOAuthReviewBody } from "./prisma-public-client-review.js";
import { captureOAuthConsentPolicy } from "./prisma-oauth-consent-review.js";
import { captureOAuthConsentPolicyTarget } from "./prisma-oauth-consent-policy-store.js";
import type { OAuthAdmissionTarget } from "./prisma-oauth-admission-store.js";
import type { OAuthConsentPolicy, ApprovedOAuthConsentPolicy, OriginalOAuthConsentPolicyReviewSource, PrismaOAuthConsentPolicyStore } from "./prisma-oauth-consent-policy-store.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
export interface OAuthNoticeReviewer {
  userId: string; tenantId: string; workspaceId: string | null; audience: "operator"; sessionId: string; expiresAt: number;
  verification?: { kind: "satisfied" | "not_required"; reference: string; revision: number; expiresAt: number };
}
export interface OriginalOAuthNoticeReviewRequest<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  current(transaction: Native, target: OAuthAdmissionTarget, policy: OAuthConsentPolicy | undefined, signal: AbortSignal, purpose?: "review" | "read_receipt"): Promise<OAuthNoticeReviewer | undefined>;
  audit(transaction: Native, input: { operationKey: string; target: OAuthAdmissionTarget; actorId: string; tenantId: string; workspaceId: string | null; revision: number; stage: "prepared" | "approved" | "denied" }, signal: AbortSignal): Promise<void>;
}
export interface OriginalOAuthNoticeReviewManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> { forRequest(browser: Request): OriginalOAuthNoticeReviewRequest<Native> }
export interface OAuthNoticeReviewReceipt {
  state: "observed"; operationKey: string; target: OAuthAdmissionTarget; decision: "pending" | "approved" | "denied";
  decisionRevision: number; reviewRevision: number; retryable: false;
}
export interface PrismaOAuthNoticeReview<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  prepare(browser: Request, signal: AbortSignal): Promise<{ state: "prepared"; operationKey: string; target: OAuthAdmissionTarget; nonce: string; decisionRevision: 1; reviewRevision: number; policy: OAuthConsentPolicy; actionExpiresAt: number } | OAuthNoticeReviewReceipt>;
  decide(browser: Request, signal: AbortSignal): Promise<OAuthNoticeReviewReceipt>;
  receipt(browser: Request, signal: AbortSignal): Promise<OAuthNoticeReviewReceipt | { state: "not_observed"; retryable: false }>;
  source: OriginalOAuthConsentPolicyReviewSource<Native>;
}
export class OAuthNoticeReviewError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth notice review ${kind}`); this.name = "OAuthNoticeReviewError"; }
}
const fail = (kind: OAuthNoticeReviewError["kind"]) => new OAuthNoticeReviewError(kind);
const live = (s: AbortSignal) => { if (s.aborted) throw fail("unavailable"); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const revision = (v: unknown, zero = false): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= (zero ? 0 : 1) && v <= 2147483647;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export const oauthNoticeCandidateHash = (raw: OAuthAdmissionTarget, value: unknown) => {
  const target = captureOAuthConsentPolicyTarget(raw); return digest(JSON.stringify({ target, policy: captureOAuthConsentPolicy(value, target.kind === "workspace") }));
};
export const oauthNoticeScopeKey = (resource: string, target: OAuthAdmissionTarget) => digest(JSON.stringify({ resource, target: captureOAuthConsentPolicyTarget(target) }));
function record(v: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof v === "string") { if (Buffer.byteLength(v, "utf8") > 65536) throw fail("unavailable"); v = JSON.parse(v); }
  const r = snapshotJson(v, { stringCharacters: 2048, arrayItems: 32 });
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length !== names.length || names.some(n => !Object.hasOwn(r, n))) throw fail("invalid"); return r as Record<string, unknown>;
}
function selected(rows: unknown, names: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable"); if (!rows.length) return undefined;
  const v = Object.getOwnPropertyDescriptor(rows, "0"); if (!v?.enumerable || !Object.hasOwn(v, "value")) throw fail("unavailable"); return snapshotJsonFields(v.value, names, { stringCharacters: 65536, arrayItems: 32 });
}
const verification = (raw: unknown): NonNullable<OAuthNoticeReviewer["verification"]> => {
  const v = record(raw, ["kind", "reference", "revision", "expiresAt"]);
  if (!["satisfied", "not_required"].includes(v.kind as string) || typeof v.reference !== "string" || !/^[\x21-\x7e]{1,200}$/.test(v.reference) || !revision(v.revision) || !positive(v.expiresAt)) throw fail("unavailable");
  return Object.freeze({ kind: v.kind as "satisfied" | "not_required", reference: v.reference, revision: v.revision, expiresAt: v.expiresAt });
};
type Fixed = Pick<OAuthNoticeReviewer, "userId" | "tenantId" | "workspaceId" | "audience" | "sessionId">;
const fixed = (p: Fixed): Fixed => Object.freeze({ userId: p.userId, tenantId: p.tenantId, workspaceId: p.workspaceId, audience: "operator", sessionId: p.sessionId });
type Draft = { operationKey: string; expectedRevision: number; target: OAuthAdmissionTarget; policy: OAuthConsentPolicy; principal: Fixed; verification: NonNullable<OAuthNoticeReviewer["verification"]>; actionExpiresAt: number; configHash: string };
type Row = { operationKey: string; scopeKey: string; actorId: string; actorTenantId: string; actorWorkspaceId: string | null; browserSessionId: string; reviewRevision: number; nonceHash: string; decisionRevision: number; state: "pending" | "approved" | "denied"; decidedAt: number | null; recordJson: unknown };
export function createPrismaOAuthNoticeReview<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { enabled: boolean; resourceUrl: string; prepareEndpoint: string; decisionEndpoint: string; receiptEndpoint: string; policyRevision: number; actionTtlSeconds: number; maxReviewLifetimeSeconds: number },
  database: OAuthSqlDatabase<Native>, policies: Pick<PrismaOAuthConsentPolicyStore<Native>, "readIn">, management: OriginalOAuthNoticeReviewManagement<Native>
): PrismaOAuthNoticeReview<Native> {
  const resourceUrl = new URL(config.resourceUrl), resource = resourceUrl.href, urls = [config.prepareEndpoint, config.decisionEndpoint, config.receiptEndpoint].map(v => new URL(v)), enabled = config.enabled;
  if (typeof enabled !== "boolean" || [resourceUrl, ...urls].some(u => u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.href.length > 2048)
    || resource !== config.resourceUrl || urls.some((u, i) => u.href !== [config.prepareEndpoint, config.decisionEndpoint, config.receiptEndpoint][i]) || new Set(urls.map(u => u.origin)).size !== 1 || new Set(urls.map(u => u.pathname)).size !== 3
    || !revision(config.policyRevision) || !positive(config.actionTtlSeconds) || config.actionTtlSeconds > 900 || !positive(config.maxReviewLifetimeSeconds) || config.maxReviewLifetimeSeconds > Number.MAX_SAFE_INTEGER - Date.now() / 1000
    || typeof database?.$transaction !== "function" || typeof policies?.readIn !== "function" || typeof management?.forRequest !== "function") throw fail("unavailable");
  const ttl = config.actionTtlSeconds, lifetime = config.maxReviewLifetimeSeconds, configHash = digest(JSON.stringify({ resource, urls: urls.map(u => u.href), revision: config.policyRevision, ttl, lifetime }));
  const scopeKey = (target: OAuthAdmissionTarget) => oauthNoticeScopeKey(resource, target);
  const transact = database.$transaction.bind(database), read = policies.readIn.bind(policies), managerFor = management.forRequest.bind(management);
  const run = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal) => { live(signal); let entered = false;
    const value = await transact(async tx => { if (entered) throw fail("unavailable"); entered = true; live(signal); const value = await consume(tx); live(signal); return value; }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(signal); return value; };
  const route = (browser: Request, index: number) => {
    const u = new URL(browser.url), expected = urls[index], post = index !== 2, origin = browser.headers.get("origin"), site = browser.headers.get("sec-fetch-site");
    if (browser.method !== (post ? "POST" : "GET") || u.origin !== expected.origin || u.pathname !== expected.pathname || u.username || u.password || u.hash || post && u.search || browser.headers.has("cookie")) throw fail("invalid");
    if (post && origin !== expected.origin || origin !== null && origin !== expected.origin || site !== null && !["same-origin", "none"].includes(site)) throw fail("denied"); return u;
  };
  const manager = (browser: Request) => { const m = managerFor(browser); if (typeof m?.current !== "function" || typeof m.audit !== "function") throw fail("unavailable"); return { current: m.current.bind(m), audit: m.audit.bind(m) }; };
  const principal = async (m: ReturnType<typeof manager>, tx: Native, target: OAuthAdmissionTarget, policy: OAuthConsentPolicy | undefined, s: AbortSignal, purpose: "review" | "read_receipt" = "review") => {
    live(s); const raw = await m.current(tx, target, policy, s, purpose); live(s); if (!raw) throw fail("denied");
    const v = record(raw, ["userId", "tenantId", "workspaceId", "audience", "sessionId", "expiresAt", ...(purpose === "review" ? ["verification"] : [])]);
    if (![v.userId, v.tenantId, v.sessionId].every(id) || v.audience !== "operator" || !positive(v.expiresAt) || v.expiresAt <= Date.now() / 1000
      || (target.kind === "workspace" ? v.tenantId !== target.tenantId || v.workspaceId !== target.workspaceId : v.workspaceId !== null)) throw fail("denied");
    const p = { ...fixed(v as unknown as Fixed), expiresAt: v.expiresAt }; if (purpose === "read_receipt") return p;
    const verified = verification(v.verification); if (verified.expiresAt <= Date.now() / 1000) throw fail("denied"); return Object.freeze({ ...p, verification: verified });
  };
  const pointer = async (tx: Native, target: OAuthAdmissionTarget, s: AbortSignal) => {
    const scope = scopeKey(target), rows = await tx.$queryRaw<unknown[]>`SELECT scopeKey, revision, reference FROM mcp_oauth_notice_reviews WHERE scopeKey = ${scope} FOR UPDATE`; live(s);
    const p = selected(rows, ["scopeKey", "revision", "reference"]); if (!p) return undefined; if (p.scopeKey !== scope || !revision(p.revision) || !key(p.reference)) throw fail("unavailable"); return Object.freeze({ scopeKey: scope, revision: p.revision, reference: p.reference });
  };
  const row = async (tx: Native, operationKey: string, s: AbortSignal): Promise<Row | undefined> => {
    // Avoid Prisma bigint values at ordinary-JSON capture. SQL keeps NULL and
    // numeric output; the existing safe-integer/time checks remain mandatory.
    const rows = await tx.$queryRaw<unknown[]>`SELECT operationKey, scopeKey, actorId, actorTenantId, actorWorkspaceId, browserSessionId, reviewRevision, nonceHash, decisionRevision, state, CAST(decidedAt AS DOUBLE) AS decidedAt, recordJson FROM mcp_oauth_notice_review_drafts WHERE operationKey = ${operationKey} FOR UPDATE`; live(s);
    const r = selected(rows, ["operationKey", "scopeKey", "actorId", "actorTenantId", "actorWorkspaceId", "browserSessionId", "reviewRevision", "nonceHash", "decisionRevision", "state", "decidedAt", "recordJson"]); if (!r) return undefined;
    if (r.operationKey !== operationKey || typeof r.scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(r.scopeKey) || ![r.actorId, r.actorTenantId, r.browserSessionId].every(id) || r.actorWorkspaceId !== null && !id(r.actorWorkspaceId)
      || !revision(r.reviewRevision) || typeof r.nonceHash !== "string" || !/^[a-f0-9]{64}$/.test(r.nonceHash) || (r.state === "pending" ? r.decisionRevision !== 1 || r.decidedAt !== null : !["approved", "denied"].includes(r.state as string) || r.decisionRevision !== 2 || !positive(r.decidedAt))) throw fail("unavailable"); return r as unknown as Row;
  };
  const draft = (r: Row): Draft => {
    const d = record(r.recordJson, ["operationKey", "expectedRevision", "target", "policy", "principal", "verification", "actionExpiresAt", "configHash"]), target = captureOAuthConsentPolicyTarget(d.target), policy = captureOAuthConsentPolicy(d.policy, target.kind === "workspace");
    const p = record(d.principal, ["userId", "tenantId", "workspaceId", "audience", "sessionId"]), v = verification(d.verification);
    if (d.operationKey !== r.operationKey || !revision(d.expectedRevision, true) || d.expectedRevision + 1 !== r.reviewRevision || scopeKey(target) !== r.scopeKey || policy.resource !== resource || policy.reviewRef !== r.operationKey || policy.reviewRevision !== r.reviewRevision
      || target.kind === "workspace" && (p.tenantId !== target.tenantId || p.workspaceId !== target.workspaceId || (policy as { tenantId: string }).tenantId !== target.tenantId || (policy as { workspaceId: string }).workspaceId !== target.workspaceId)
      || target.kind === "platform" && p.workspaceId !== null || p.userId !== r.actorId || p.tenantId !== r.actorTenantId || p.workspaceId !== r.actorWorkspaceId || p.sessionId !== r.browserSessionId || p.audience !== "operator"
      || !positive(d.actionExpiresAt) || d.actionExpiresAt > v.expiresAt || r.decidedAt !== null && r.decidedAt > d.actionExpiresAt || typeof d.configHash !== "string" || !/^[a-f0-9]{64}$/.test(d.configHash)) throw fail("unavailable");
    return { operationKey: r.operationKey, expectedRevision: d.expectedRevision, target, policy, principal: fixed(p as unknown as Fixed), verification: v, actionExpiresAt: d.actionExpiresAt, configHash: d.configHash };
  };
  const eligible = async (tx: Native, target: OAuthAdmissionTarget, policy: OAuthConsentPolicy, s: AbortSignal) => { const previous = await read(tx, target, s); live(s);
    if (policy.revision !== (previous?.revision ?? 0) + 1 || policy.expiresAt <= Date.now() / 1000 || policy.expiresAt > Math.floor(Date.now() / 1000) + lifetime) throw fail("denied"); };
  const observe = (r: Row, d: Draft): OAuthNoticeReviewReceipt => Object.freeze({ state: "observed", operationKey: r.operationKey, target: d.target, decision: r.state, decisionRevision: r.decisionRevision, reviewRevision: r.reviewRevision, retryable: false });
  const emit = async (m: ReturnType<typeof manager>, tx: Native, r: Row, d: Draft, stage: "prepared" | "approved" | "denied", s: AbortSignal) => { await m.audit(tx, { operationKey: r.operationKey, target: d.target, actorId: r.actorId, tenantId: r.actorTenantId, workspaceId: r.actorWorkspaceId, revision: r.reviewRevision, stage }, s); live(s); };
  return Object.freeze({
    async prepare(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try { live(signal); if (!enabled) throw fail("unavailable"); route(browser, 0); const m = manager(browser);
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        const v = record(JSON.parse(await readOAuthReviewBody(browser, signal, 65536)), ["operationKey", "expectedRevision", "target", "policy"]), target = captureOAuthConsentPolicyTarget(v.target), policy = captureOAuthConsentPolicy(v.policy, target.kind === "workspace");
        if (!key(v.operationKey) || !revision(v.expectedRevision, true) || v.expectedRevision >= 2147483647 || policy.resource !== resource || policy.reviewRef !== v.operationKey || policy.reviewRevision !== v.expectedRevision + 1) throw fail("invalid");
        const operationKey = v.operationKey, expectedRevision = v.expectedRevision;
        return await run(async tx => { entered = true; const before = await principal(m, tx, target, policy, signal);
          await read(tx, target, signal); live(signal); const p = await pointer(tx, target, signal), original = await row(tx, operationKey, signal);
          if (original) { const d = draft(original); if (!isDeepStrictEqual(d.target, target) || !isDeepStrictEqual(d.principal, fixed(before)) || d.expectedRevision !== expectedRevision || !isDeepStrictEqual(d.policy, policy)) throw fail("conflict");
            if (!isDeepStrictEqual(await principal(m, tx, target, policy, signal), before)) throw fail("denied"); return observe(original, d); }
          await eligible(tx, target, policy, signal); if ((p?.revision ?? 0) !== expectedRevision) throw fail("conflict");
          const verified = "verification" in before ? before.verification : undefined; if (!verified) throw fail("denied");
          const nonce = randomBytes(32).toString("base64url"), d: Draft = { operationKey, expectedRevision, target, policy, principal: fixed(before), verification: verified, actionExpiresAt: Math.min(before.expiresAt, verified.expiresAt, Math.floor(Date.now() / 1000) + ttl), configHash };
          const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_notice_review_drafts (operationKey, scopeKey, actorId, actorTenantId, actorWorkspaceId, browserSessionId, reviewRevision, nonceHash, decisionRevision, state, decidedAt, recordJson) VALUES (${operationKey}, ${scopeKey(target)}, ${before.userId}, ${before.tenantId}, ${before.workspaceId}, ${before.sessionId}, ${expectedRevision + 1}, ${digest(nonce)}, ${1}, ${"pending"}, ${null}, ${JSON.stringify(d)})`;
          live(signal); if (inserted !== 1) throw fail("unavailable"); const saved = await row(tx, operationKey, signal); if (!saved || saved.state !== "pending" || saved.nonceHash !== digest(nonce) || !isDeepStrictEqual(draft(saved), d)) throw fail("unavailable");
          await emit(m, tx, saved, d, "prepared", signal); if (!isDeepStrictEqual(await principal(m, tx, target, policy, signal), before)) throw fail("denied");
          return { state: "prepared" as const, operationKey, target, nonce, decisionRevision: 1 as const, reviewRevision: expectedRevision + 1, policy, actionExpiresAt: d.actionExpiresAt };
        }, signal);
      } catch (e) { if (!entered && signal.aborted) throw fail("unavailable"); if (e instanceof OAuthNoticeReviewError && (!entered || ["invalid", "denied", "conflict"].includes(e.kind))) throw e; throw fail(entered ? "unknown" : "invalid"); }
    },
    async decide(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); let entered = false;
      try { live(signal); if (!enabled) throw fail("unavailable"); route(browser, 1); const m = manager(browser);
        if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get("content-type") ?? "")) throw fail("invalid");
        const params = new URLSearchParams(await readOAuthReviewBody(browser, signal, 4096)), names = ["operationKey", "target", "expectedRevision", "decision", "nonce"];
        if ([...params.keys()].some(n => !names.includes(n)) || names.some(n => params.getAll(n).length !== 1) || !key(params.get("operationKey")) || params.get("expectedRevision") !== "1" || !["approve", "deny"].includes(params.get("decision")!)
          || !/^[A-Za-z0-9_-]{43}$/.test(params.get("nonce")!) || Buffer.from(params.get("nonce")!, "base64url").toString("base64url") !== params.get("nonce")) throw fail("invalid");
        const target = captureOAuthConsentPolicyTarget(JSON.parse(params.get("target")!)), operationKey = params.get("operationKey")!, nonce = params.get("nonce")!, state = params.get("decision") === "approve" ? "approved" as const : "denied" as const;
        return await run(async tx => { entered = true; const authenticated = await principal(m, tx, target, undefined, signal, "read_receipt");
          await read(tx, target, signal); live(signal); const previous = await pointer(tx, target, signal), r = await row(tx, operationKey, signal); if (!r) throw fail("denied"); const d = draft(r);
          if (!isDeepStrictEqual(d.target, target)) throw fail("denied"); const before = await principal(m, tx, target, d.policy, signal);
          if (!isDeepStrictEqual(fixed(authenticated), fixed(before)) || !isDeepStrictEqual(d.principal, fixed(before)) || !timingSafeEqual(Buffer.from(r.nonceHash, "hex"), Buffer.from(digest(nonce), "hex"))) throw fail("denied");
          if (r.state !== "pending") { if (r.state !== state) throw fail("conflict"); if (!isDeepStrictEqual(await principal(m, tx, target, d.policy, signal), before)) throw fail("denied"); return observe(r, d); }
          if (d.configHash !== configHash || d.actionExpiresAt <= Date.now() / 1000 || !("verification" in before) || !isDeepStrictEqual(d.verification, before.verification)) throw fail("denied");
          await eligible(tx, target, d.policy, signal); if (state === "approved" && (previous?.revision ?? 0) !== d.expectedRevision) throw fail("conflict");
          const decidedAt = Math.floor(Date.now() / 1000), changed = await tx.$executeRaw`UPDATE mcp_oauth_notice_review_drafts SET decisionRevision = ${2}, state = ${state}, decidedAt = ${decidedAt} WHERE operationKey = ${operationKey} AND decisionRevision = ${1} AND state = ${"pending"} AND nonceHash = ${r.nonceHash}`;
          live(signal); if (changed !== 1) throw fail("conflict");
          if (state === "approved") { const published = previous ? await tx.$executeRaw`UPDATE mcp_oauth_notice_reviews SET revision = ${r.reviewRevision}, reference = ${operationKey} WHERE scopeKey = ${r.scopeKey} AND revision = ${d.expectedRevision}`
            : await tx.$executeRaw`INSERT INTO mcp_oauth_notice_reviews (scopeKey, revision, reference) VALUES (${r.scopeKey}, ${r.reviewRevision}, ${operationKey})`; live(signal); if (published !== 1) throw fail("conflict"); }
          const saved = await row(tx, operationKey, signal); if (!saved || saved.state !== state || saved.decidedAt !== decidedAt || !isDeepStrictEqual(draft(saved), d)) throw fail("unavailable");
          if (state === "approved") { const p = await pointer(tx, target, signal); if (!p || p.reference !== operationKey || p.revision !== r.reviewRevision) throw fail("unavailable"); }
          await emit(m, tx, saved, d, state, signal); if (!isDeepStrictEqual(await principal(m, tx, target, d.policy, signal), before)) throw fail("denied"); return observe(saved, d);
        }, signal);
      } catch (e) { if (!entered && signal.aborted) throw fail("unavailable"); if (e instanceof OAuthNoticeReviewError && (!entered || ["invalid", "denied", "conflict"].includes(e.kind))) throw e; throw fail(entered ? "unknown" : "invalid"); }
    },
    async receipt(browser: Request, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]);
      try { live(signal); const url = route(browser, 2), params = url.searchParams; if ([...params.keys()].some(n => !["operationKey", "target"].includes(n)) || params.getAll("operationKey").length !== 1 || params.getAll("target").length !== 1 || !key(params.get("operationKey"))) throw fail("invalid");
        const target = captureOAuthConsentPolicyTarget(JSON.parse(params.get("target")!)), m = manager(browser), operationKey = params.get("operationKey")!;
        return await run(async tx => { const before = await principal(m, tx, target, undefined, signal, "read_receipt"), r = await row(tx, operationKey, signal), d = r ? draft(r) : undefined;
          if (d && (!isDeepStrictEqual(d.target, target) || d.principal.userId !== before.userId || d.principal.tenantId !== before.tenantId || d.principal.workspaceId !== before.workspaceId)) throw fail("denied");
          if (!isDeepStrictEqual(await principal(m, tx, target, undefined, signal, "read_receipt"), before)) throw fail("denied"); return r && d ? observe(r, d) : { state: "not_observed" as const, retryable: false as const }; }, signal);
      } catch (e) { if (e instanceof OAuthNoticeReviewError && ["invalid", "denied"].includes(e.kind)) throw e; throw fail("unavailable"); }
    },
    source: Object.freeze({ async current(tx: Native, raw: OAuthAdmissionTarget, signal: AbortSignal): Promise<ApprovedOAuthConsentPolicy | undefined> {
      try { live(signal); if (!enabled) return undefined; const target = captureOAuthConsentPolicyTarget(raw); await read(tx, target, signal); live(signal); const p = await pointer(tx, target, signal); if (!p) return undefined;
        const r = await row(tx, p.reference, signal); if (!r) throw fail("unavailable"); const d = draft(r);
        if (r.scopeKey !== p.scopeKey || r.reviewRevision !== p.revision || r.state !== "approved" || r.decisionRevision !== 2 || !isDeepStrictEqual(d.target, target)) throw fail("unavailable");
        if (d.configHash !== configHash || d.policy.expiresAt <= Date.now() / 1000) return undefined;
        if (!isDeepStrictEqual(await pointer(tx, target, signal), p) || !isDeepStrictEqual(await row(tx, p.reference, signal), r)) throw fail("unavailable");
        return Object.freeze({ reference: r.operationKey, revision: r.reviewRevision, expiresAt: d.policy.expiresAt, target, policy: d.policy });
      } catch { throw fail("unavailable"); }
    } }),
  });
}
