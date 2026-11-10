/** Current approved notice/verification policy and original issuer subject reads.
 * Not management, a second account/MFA system or permission to release business
 * fields. Original writers own provenance/CAS/audit; required verification only
 * reads ORIGINAL completed evidence in the same transaction, never performs MFA. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOAuthConsentRequest } from "./prisma-oauth-consent-authority.js";
import type { OAuthGrantAuthorityConfig, OriginalOAuthGrantIdentity } from "./prisma-oauth-grant-authority.js";
import type { OAuthSqlTransaction } from "./prisma-oauth-store.js";
import type { OAuthConsentBrowserPrincipal, OriginalOAuthConsentReview, OriginalOAuthWebConsentPolicy } from "./prisma-oauth-web-consent.js";
import type { ValidatedPublicClientAuthorization } from "./public-client-authorization.js";

export interface OAuthPlatformConsentReview {
  resource: string; revision: number; enabled: boolean; expiresAt: number;
  noticeVersion: string; noticeText: string; verificationRequired: boolean;
  reviewRef: string; reviewRevision: number;
}
export interface OAuthWorkspaceConsentReview extends Omit<OAuthPlatformConsentReview, "noticeText"> {
  tenantId: string; workspaceId: string;
}
export interface OriginalOAuthSubjectBinding {
  resource: string; userId: string; tenantId: string; subject: string; revision: number; enabled: boolean; expiresAt: number;
}
export interface OriginalOAuthVerificationEvidence {
  method: "mfa"; reference: string; revision: number; expiresAt: number;
  userId: string; tenantId: string; workspaceId: string; sessionId: string; resource: string;
  policyHash: string; authorizationHash: string;
}
export interface OriginalOAuthVerificationSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** ORIGINAL completed MFA evidence, with current applicability/revocation held
   * in this transaction. No challenge, factor/secret input, consumption or retry.
   * Hashes associate the original exact authorization and both current policies;
   * a callback must verify original evidence, not echo these hashes as approval. */
  current(principal: OAuthConsentBrowserPrincipal, input: ValidatedPublicClientAuthorization,
    policyHash: string, authorizationHash: string, transaction: Native, signal: AbortSignal): Promise<OriginalOAuthVerificationEvidence | undefined>;
}
const unavailable = () => new Error("Current original consent review unavailable");
const live = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const textId = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const revision = (v: unknown): v is number => positive(v) && v <= 2_147_483_647;
function hash(value: unknown) {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") { if (Buffer.byteLength(value, "utf8") > 65_536) throw unavailable(); value = JSON.parse(value); }
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 50 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== fields.length || fields.some(k => !Object.hasOwn(copy, k))
    || Buffer.byteLength(JSON.stringify(copy), "utf8") > 65_536) throw unavailable();
  return copy as Record<string, unknown>;
}
function selected(rows: unknown, fields: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw unavailable();
  if (!rows.length) throw unavailable(); const row = Object.getOwnPropertyDescriptor(rows, "0"); if (!row?.enumerable || !Object.hasOwn(row, "value")) throw unavailable();
  return snapshotJsonFields(row.value, fields, { stringCharacters: 65_536, arrayItems: 50 });
}

/** Shared original issuer projection capture. No caller-selected subject writer. */
export function captureOAuthSubjectBinding(value: unknown): OriginalOAuthSubjectBinding {
  const v = record(value, ["resource", "userId", "tenantId", "subject", "revision", "enabled", "expiresAt"]);
  if (typeof v.resource !== "string" || !id(v.userId) || !id(v.tenantId) || !textId(v.subject)
    || !revision(v.revision) || typeof v.enabled !== "boolean" || !positive(v.expiresAt)) throw unavailable();
  const url = new URL(v.resource);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== v.resource || v.resource.length > 2048) throw unavailable();
  return Object.freeze({ resource: v.resource, userId: v.userId, tenantId: v.tenantId, subject: v.subject,
    revision: v.revision, enabled: v.enabled, expiresAt: v.expiresAt });
}

/** Shared approved-policy projection schema, not proof that review occurred. */
export function captureOAuthConsentPolicy(value: unknown, workspace: boolean): OAuthPlatformConsentReview | OAuthWorkspaceConsentReview {
  const common = ["resource", "revision", "enabled", "expiresAt", "noticeVersion", "verificationRequired", "reviewRef", "reviewRevision"];
  const v = record(value, [...common, ...(workspace ? ["tenantId", "workspaceId"] : ["noticeText"])]);
  if (typeof v.resource !== "string" || !revision(v.revision) || typeof v.enabled !== "boolean" || !positive(v.expiresAt)
    || !textId(v.noticeVersion) || typeof v.verificationRequired !== "boolean" || !textId(v.reviewRef) || !revision(v.reviewRevision)) throw unavailable();
  const url = new URL(v.resource);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== v.resource || v.resource.length > 2048) throw unavailable();
  if (workspace ? !id(v.tenantId) || !id(v.workspaceId) : typeof v.noticeText !== "string" || !v.noticeText.trim() || v.noticeText.length > 2000) throw unavailable();
  const captured = { resource: v.resource, revision: v.revision, enabled: v.enabled, expiresAt: v.expiresAt, noticeVersion: v.noticeVersion,
    verificationRequired: v.verificationRequired, reviewRef: v.reviewRef, reviewRevision: v.reviewRevision };
  return Object.freeze(workspace ? { ...captured, tenantId: v.tenantId as string, workspaceId: v.workspaceId as string }
    : { ...captured, noticeText: v.noticeText as string });
}

export function createPrismaOAuthConsentReview<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: OAuthGrantAuthorityConfig, identity: OriginalOAuthGrantIdentity<Native>, verification?: OriginalOAuthVerificationSource<Native>
): Pick<OriginalOAuthWebConsentPolicy<Native>, "current"> {
  const url = new URL(config.resourceUrl), resource = url.href, enabled = config.enabled, allowed = new Set(config.allowedScopes);
  if (typeof enabled !== "boolean" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048
    || allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length || [...allowed].some(s => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(s))
    || typeof identity?.assertCurrent !== "function" || verification !== undefined && typeof verification.current !== "function") throw unavailable();
  const assertIdentity = identity.assertCurrent.bind(identity), verify = verification?.current.bind(verification);
  const observe = async (p: OAuthConsentBrowserPrincipal, tx: Native, signal: AbortSignal) => {
    live(signal);
    const platformRows = await tx.$queryRaw<unknown[]>`SELECT resource, revision, recordJson FROM mcp_oauth_consent_reviews WHERE resource = ${resource} FOR UPDATE`;
    live(signal); const pr = selected(platformRows, ["resource", "revision", "recordJson"]);
    const workspaceRows = await tx.$queryRaw<unknown[]>`SELECT resource, tenantId, workspaceId, revision, recordJson FROM mcp_oauth_workspace_reviews WHERE resource = ${resource} AND tenantId = ${p.tenantId} AND workspaceId = ${p.workspaceId} FOR UPDATE`;
    live(signal); const wr = selected(workspaceRows, ["resource", "tenantId", "workspaceId", "revision", "recordJson"]);
    const subjectRows = await tx.$queryRaw<unknown[]>`SELECT resource, userId, tenantId, subject, revision, recordJson FROM mcp_oauth_subject_bindings WHERE resource = ${resource} AND userId = ${p.userId} AND tenantId = ${p.tenantId} FOR UPDATE`;
    live(signal); const sr = selected(subjectRows, ["resource", "userId", "tenantId", "subject", "revision", "recordJson"]);
    const platform = captureOAuthConsentPolicy(pr.recordJson, false) as OAuthPlatformConsentReview;
    const workspace = captureOAuthConsentPolicy(wr.recordJson, true) as OAuthWorkspaceConsentReview;
    const subject = captureOAuthSubjectBinding(sr.recordJson);
    if (platform.resource !== resource || workspace.resource !== resource
      || pr.resource !== resource || pr.revision !== platform.revision || wr.resource !== resource || wr.revision !== workspace.revision
      || wr.tenantId !== p.tenantId || wr.workspaceId !== p.workspaceId || workspace.tenantId !== p.tenantId || workspace.workspaceId !== p.workspaceId
      || subject.resource !== resource || sr.resource !== resource || subject.revision !== sr.revision
      || subject.userId !== p.userId || sr.userId !== p.userId || subject.tenantId !== p.tenantId || sr.tenantId !== p.tenantId
      || subject.subject !== sr.subject) throw unavailable();
    if (!enabled || !platform.enabled || !workspace.enabled || !subject.enabled || platform.noticeVersion !== workspace.noticeVersion
      || Math.min(platform.expiresAt, workspace.expiresAt, subject.expiresAt) <= Date.now() / 1000) return undefined;
    return { platform, workspace, subject };
  };
  return Object.freeze({ async current(raw: ValidatedPublicClientAuthorization, original: OAuthConsentBrowserPrincipal, tx: Native, signal: AbortSignal): Promise<OriginalOAuthConsentReview | undefined> {
    try {
      live(signal); if (!enabled) return undefined;
      const input = captureOAuthConsentRequest(raw, resource, allowed);
      const p = record(original, ["userId", "tenantId", "workspaceId", "audience", "sessionId", "expiresAt"]) as unknown as OAuthConsentBrowserPrincipal;
      if (![p.userId, p.tenantId, p.workspaceId, p.sessionId].every(id) || p.audience !== "operator" || !positive(p.expiresAt) || p.expiresAt <= Date.now() / 1000) throw unavailable();
      Object.freeze(p); const before = await observe(p, tx, signal); if (!before) return undefined;
      const binding = async () => {
        const now = await observe(p, tx, signal); if (!now) return undefined; if (!isDeepStrictEqual(now, before)) throw unavailable();
        return Object.freeze({ userId: p.userId, tenantId: p.tenantId, workspaceId: p.workspaceId, audience: "operator" as const });
      };
      const accepted = await assertIdentity(tx, binding, signal); live(signal);
      if (accepted !== true) { if (accepted !== false) throw unavailable(); return undefined; }
      const policyHash = hash(before), authorizationHash = hash(input), required = before.platform.verificationRequired || before.workspace.verificationRequired;
      const evidence = async () => {
        if (!verify) throw unavailable(); live(signal);
        const raw = await verify(p, input, policyHash, authorizationHash, tx, signal); live(signal); if (!raw) throw unavailable();
        const v = record(raw, ["method", "reference", "revision", "expiresAt", "userId", "tenantId", "workspaceId", "sessionId", "resource", "policyHash", "authorizationHash"]);
        if (v.method !== "mfa" || !textId(v.reference) || !revision(v.revision) || !positive(v.expiresAt) || v.expiresAt <= Date.now() / 1000
          || v.userId !== p.userId || v.tenantId !== p.tenantId || v.workspaceId !== p.workspaceId || v.sessionId !== p.sessionId || v.resource !== resource
          || v.policyHash !== policyHash || v.authorizationHash !== authorizationHash) throw unavailable();
        return v as unknown as OriginalOAuthVerificationEvidence;
      };
      const verified = required ? await evidence() : undefined;
      const after = await observe(p, tx, signal); if (!after) return undefined; if (!isDeepStrictEqual(after, before)) throw unavailable();
      if (required && !isDeepStrictEqual(await evidence(), verified)) throw unavailable();
      const currentIdentity = await assertIdentity(tx, binding, signal); live(signal); if (currentIdentity !== true) { if (currentIdentity !== false) throw unavailable(); return undefined; }
      if (!isDeepStrictEqual(await observe(p, tx, signal), before)) throw unavailable();
      const expiresAt = Math.min(before.platform.expiresAt, before.workspace.expiresAt, before.subject.expiresAt, p.expiresAt, verified?.expiresAt ?? Number.MAX_SAFE_INTEGER);
      if (expiresAt <= Date.now() / 1000) return undefined;
      // This hash is a scoped policy/evidence reference, not a credential, MFA
      // implementation or substitute for the original verified record above.
      const reference = `consent-review:${hash({ policyHash, authorizationHash, evidence: verified ?? null })}`;
      return Object.freeze({ subject: before.subject.subject, noticeVersion: before.platform.noticeVersion, noticeText: before.platform.noticeText, expiresAt,
        verification: Object.freeze({ kind: required ? "satisfied" as const : "not_required" as const, reference, revision: verified?.revision ?? Math.max(before.platform.reviewRevision, before.workspace.reviewRevision), expiresAt }) });
    } catch { throw unavailable(); }
  } });
}
