/** Persist a grant ONLY after original authenticated Web consent has completed.
 * This is the same code/grant transaction, not a login page, model approval or
 * business permission. Original browser/session/MFA/CSRF and decision fences must
 * be locked by the original source; missing evidence never becomes consent. */
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { createPrismaOAuthGrantAuthority } from "./prisma-oauth-grant-authority.js";
import type { OriginalOAuthGrantIdentity, OriginalOAuthPrincipalBinding, OAuthGrantAuthorityConfig, PersistedOriginalOAuthGrant } from "./prisma-oauth-grant-authority.js";
import type { OriginalOAuthConsentAuthority, PersistentOAuthAuthorizationTransaction } from "./persistent-oauth-authorization.js";
import type { OAuthSqlTransaction, PrismaOAuthStore } from "./prisma-oauth-store.js";
import type { PrismaOAuthAdmissionStore, OAuthAdmissionRecord } from "./prisma-oauth-admission-store.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { ValidatedPublicClientAuthorization, RegisteredPublicClient } from "./public-client-authorization.js";

/** Original completed decision, resolved from the authenticated browser and exact
 * server-owned consent record. It is NOT a DTO accepted from a URL/body/tool. */
export interface CompletedOriginalOAuthConsent {
  kind: "approved" | "denied";
  id: string; revision: number; expiresAt: number;
  request: ValidatedPublicClientAuthorization;
  subject: string; userId: string; tenantId: string; workspaceId: string;
}
export interface OriginalCompletedOAuthConsentSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Reuse original login, password-change/MFA and CSRF protection. Resolve an
   * exact persisted completed decision and CURRENT browser read/issuance rights,
   * locking these fences in the supplied transaction through commit. Never infer
   * a decision from GET parameters, headers, chat or a client's confirmed flag.
   * purpose is selected by this server's issuer/receipt method, not HTTP/model
   * input. read_receipt checks independent current owner read rights and must not
   * require a new issuance permit; omitted purpose retains conservative issue. */
  current(input: ValidatedPublicClientAuthorization, browser: Request, transaction: Native,
    signal: AbortSignal, purpose?: "issue" | "read_receipt"): Promise<CompletedOriginalOAuthConsent | undefined>;
  /** Original audit, atomic with grant/authorization association and code audit.
   * No plaintext code/token/browser credentials are passed to this hook. */
  audit(transaction: Native, receipt: { authorizationId: string; authorizationRevision: number;
    grantId: string; userId: string; tenantId: string; workspaceId: string }, signal: AbortSignal): Promise<void>;
}
export interface PrismaOAuthConsentAuthority extends OriginalOAuthConsentAuthority {
  /** Original Web-only reconciliation, not a model tool, token or issuance permit.
   * Resolve the same original decision/current browser rights; never create here.
   * Missing association is NOT proof of rollback or permission to retry. */
  receipt(input: ValidatedPublicClientAuthorization, browser: Request,
    transaction: PersistentOAuthAuthorizationTransaction, signal: AbortSignal): Promise<
      { state: "observed"; authorizationId: string; authorizationRevision: number; grantId: string }
      | { state: "not_observed"; retryable: false }>;
}
const unavailable = () => new Error("Original OAuth consent persistence unavailable");
const live = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };
const id = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const originalId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const requestFields = ["clientId", "clientRevision", "redirectUri", "resource", "scopes", "state", "codeChallenge"];
const consentFields = ["kind", "id", "revision", "expiresAt", "request", "subject", "userId", "tenantId", "workspaceId"];
const grantFields = ["id", "subject", "revision", "clientId", "resource", "scopes", "expiresAt", "enabled", "userId", "tenantId", "workspaceId", "clientRevision", "platformRevision", "workspaceRevision", "consentRef", "consentRevision"];
function ordinary(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") { if (Buffer.byteLength(value, "utf8") > 65_536) throw unavailable(); value = JSON.parse(value); }
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 50 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== fields.length
    || fields.some(field => !Object.hasOwn(copy, field)) || Buffer.byteLength(JSON.stringify(copy), "utf8") > 65_536) throw unavailable();
  return copy as Record<string, unknown>;
}
function selected(rows: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw unavailable();
  if (!rows.length) return undefined;
  const row = Object.getOwnPropertyDescriptor(rows, "0"); if (!row?.enumerable || !Object.hasOwn(row, "value")) throw unavailable();
  return snapshotJsonFields(row.value, fields, { stringCharacters: 65_536, arrayItems: 50 });
}
function hash(value: unknown): string {
  // Only already-captured plain JSON reaches here; key order is not new consent.
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}
function requestSnapshot(value: unknown, resource: string, allowed: ReadonlySet<string>): ValidatedPublicClientAuthorization {
  const row = ordinary(value, requestFields);
  if (!id(row.clientId) || !revision(row.clientRevision) || row.resource !== resource || typeof row.redirectUri !== "string"
    || typeof row.state !== "string" || !/^[\x21-\x7e]{1,1024}$/.test(row.state)
    || typeof row.codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(row.codeChallenge)
    || Buffer.from(row.codeChallenge, "base64url").toString("base64url") !== row.codeChallenge
    || !Array.isArray(row.scopes) || row.scopes.length < 1 || row.scopes.length > 32 || new Set(row.scopes).size !== row.scopes.length
    || !row.scopes.every(scope => typeof scope === "string" && allowed.has(scope))) throw unavailable();
  const uri = new URL(row.redirectUri);
  if (uri.href !== row.redirectUri || uri.username || uri.password || uri.search || uri.hash
    || uri.protocol !== "https:" && !(uri.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(uri.hostname))) throw unavailable();
  Object.freeze(row.scopes);
  return Object.freeze(row) as unknown as ValidatedPublicClientAuthorization;
}
// AS-only shared validation; exporting the existing function does not change its rules.
export { requestSnapshot as captureOAuthConsentRequest };

function callbackMatches(actual: string, registered: string): boolean {
  const a = new URL(actual), b = new URL(registered);
  return b.protocol === "http:" ? a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname : actual === registered;
}
function principal(value: CompletedOriginalOAuthConsent): OriginalOAuthPrincipalBinding {
  return Object.freeze({ userId: value.userId, tenantId: value.tenantId, workspaceId: value.workspaceId, audience: "operator" });
}

export function createPrismaOAuthConsentAuthority<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: OAuthGrantAuthorityConfig, store: PrismaOAuthStore<Native>,
  registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">, admissions: Pick<PrismaOAuthAdmissionStore<Native>, "readIn">,
  identity: OriginalOAuthGrantIdentity<Native>, source: OriginalCompletedOAuthConsentSource<Native>): PrismaOAuthConsentAuthority {
  const url = new URL(config.resourceUrl), resource = url.href, allowed = new Set(config.allowedScopes), enabled = config.enabled;
  if (typeof enabled !== "boolean" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || resource !== config.resourceUrl || resource.length > 2048 || allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length
    || [...allowed].some(scope => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(scope))
    || typeof admissions?.readIn !== "function" || typeof source?.current !== "function" || typeof source?.audit !== "function") throw unavailable();
  const authority = createPrismaOAuthGrantAuthority(config, store, registrations, identity);
  const native = store.native.bind(store), registration = registrations.readIn.bind(registrations), admission = admissions.readIn.bind(admissions);
  const original = source.current.bind(source), audit = source.audit.bind(source), assertIdentity = identity.assertCurrent.bind(identity);
  const decision = async (input: ValidatedPublicClientAuthorization, browser: Request, tx: Native, signal: AbortSignal, purpose: "issue" | "read_receipt" = "issue") => {
    live(signal); const value = await original(input, browser, tx, signal, purpose); live(signal);
    if (value === undefined) throw unavailable();
    const row = ordinary(value, consentFields), request = requestSnapshot(row.request, resource, allowed);
    if (!["approved", "denied"].includes(row.kind as string) || !id(row.id) || !revision(row.revision) || !positive(row.expiresAt)
      || !id(row.subject) || !originalId(row.userId) || !originalId(row.tenantId) || !originalId(row.workspaceId)
      || !isDeepStrictEqual(request, input)) throw unavailable();
    return { ...row, request } as unknown as CompletedOriginalOAuthConsent;
  };
  const identityCheck = async (before: CompletedOriginalOAuthConsent, input: ValidatedPublicClientAuthorization, browser: Request, tx: Native, signal: AbortSignal, purpose: "issue" | "read_receipt" = "issue") => {
    const accepted = await assertIdentity(tx, async () => {
      const now = await decision(input, browser, tx, signal, purpose); if (!isDeepStrictEqual(now, before)) throw unavailable(); return principal(now);
    }, signal); live(signal); if (accepted !== true) throw unavailable();
    if (!isDeepStrictEqual(await decision(input, browser, tx, signal, purpose), before)) throw unavailable();
  };
  const association = async (tx: Native, authorizationId: string, signal: AbortSignal) => {
    live(signal); const rows = await tx.$queryRaw<unknown[]>`SELECT authorizationId, authorizationRevision, grantId, consentHash, contextHash FROM mcp_oauth_grant_authorizations WHERE authorizationId = ${authorizationId} FOR UPDATE`;
    live(signal); const row = selected(rows, ["authorizationId", "authorizationRevision", "grantId", "consentHash", "contextHash"]);
    if (row && (row.authorizationId !== authorizationId || !revision(row.authorizationRevision) || !id(row.grantId)
      || typeof row.consentHash !== "string" || !/^[a-f0-9]{64}$/.test(row.consentHash)
      || typeof row.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(row.contextHash))) throw unavailable();
    return row;
  };
  const savedGrant = async (tx: Native, grantId: string, consent: CompletedOriginalOAuthConsent, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE id = ${grantId} FOR UPDATE`;
    live(signal); const row = selected(rows, ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId", "recordJson"]); if (!row) throw unavailable();
    const grant = ordinary(row.recordJson, grantFields);
    if (grant.id !== grantId || ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId"].some(key => grant[key] !== row[key])
      || grant.subject !== consent.subject || grant.userId !== consent.userId || grant.tenantId !== consent.tenantId || grant.workspaceId !== consent.workspaceId
      || grant.clientId !== consent.request.clientId || grant.resource !== resource || !isDeepStrictEqual(grant.scopes, consent.request.scopes)
      || grant.consentRef !== consent.id || grant.consentRevision !== consent.revision || !revision(grant.revision)
      || !revision(grant.clientRevision) || !revision(grant.platformRevision) || !revision(grant.workspaceRevision)
      || !positive(grant.expiresAt) || grant.expiresAt > consent.expiresAt || typeof grant.enabled !== "boolean") throw unavailable();
    return grant as unknown as PersistedOriginalOAuthGrant;
  };
  const observe = async (consent: CompletedOriginalOAuthConsent, input: ValidatedPublicClientAuthorization, tx: Native, signal: AbortSignal) => {
    const client = await registration(tx, input.clientId, signal);
    const platform = await admission(tx, { kind: "platform" }, signal);
    const workspace = await admission(tx, { kind: "workspace", tenantId: consent.tenantId, workspaceId: consent.workspaceId }, signal); live(signal);
    if (!client || !platform || !workspace) throw unavailable();
    // Concrete readIn producers validate closed schemas/indexes. Still check every
    // permit and fixed target here; supplying callbacks does not grant authority.
    const c = ordinary(client, ["clientId", "revision", "enabled", "expiresAt", "redirectUris", "scopes"]) as unknown as RegisteredPublicClient;
    const p = ordinary(platform, ["resource", "revision", "enabled", "expiresAt", "clientIds", "scopes", "clientType"]) as unknown as OAuthAdmissionRecord & { clientType: string };
    const w = ordinary(workspace, ["resource", "revision", "enabled", "expiresAt", "clientIds", "scopes", "tenantId", "workspaceId"]) as unknown as OAuthAdmissionRecord & { tenantId: string; workspaceId: string };
    if (c.clientId !== input.clientId || c.revision !== input.clientRevision || !revision(c.revision) || c.enabled !== true || !positive(c.expiresAt)
      || !Array.isArray(c.redirectUris) || !c.redirectUris.some(uri => typeof uri === "string" && callbackMatches(input.redirectUri, uri))
      || p.resource !== resource || w.resource !== resource || p.clientType !== "public" || w.tenantId !== consent.tenantId || w.workspaceId !== consent.workspaceId
      || [p, w].some(v => !revision(v.revision) || v.enabled !== true || !positive(v.expiresAt) || !Array.isArray(v.clientIds) || !v.clientIds.includes(input.clientId))
      || [c, p, w].some(v => !Array.isArray(v.scopes) || input.scopes.some(scope => !v.scopes.includes(scope)))) throw unavailable();
    const expiresAt = Math.min(consent.expiresAt, c.expiresAt, p.expiresAt, w.expiresAt); if (expiresAt <= Date.now() / 1000) throw unavailable();
    return { client: c, platform: p, workspace: w, expiresAt };
  };
  const implementation: PrismaOAuthConsentAuthority = {
    async current(raw: ValidatedPublicClientAuthorization, browser: Request, transaction: PersistentOAuthAuthorizationTransaction, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]);
      if (!enabled) throw unavailable(); live(signal);
      const input = requestSnapshot(raw, resource, allowed), tx = native(transaction), consent = await decision(input, browser, tx, signal);
      if (consent.expiresAt <= Date.now() / 1000) throw unavailable();
      await identityCheck(consent, input, browser, tx, signal);
      const row = await association(tx, consent.id, signal);
      if (consent.kind === "denied") {
        // A changed decision cannot hide a grant/code that may already exist.
        if (row || await transaction.readCodeForAuthorization(consent.id)) throw unavailable();
        await identityCheck(consent, input, browser, tx, signal); return { kind: "denied" as const, error: "access_denied" as const };
      }
      const before = await observe(consent, input, tx, signal), contextHash = hash({ consent, ...before });
      if (row && (row.authorizationRevision !== consent.revision || row.consentHash !== hash(consent) || row.contextHash !== contextHash)) throw unavailable();
      if (!row && await transaction.readCodeForAuthorization(consent.id)) throw unavailable();
      const grant: PersistedOriginalOAuthGrant = { id: row ? row.grantId as string : randomUUID(), revision: 1, subject: consent.subject,
        userId: consent.userId, tenantId: consent.tenantId, workspaceId: consent.workspaceId, clientId: input.clientId, resource,
        scopes: [...input.scopes], expiresAt: before.expiresAt, enabled: true, clientRevision: before.client.revision,
        platformRevision: before.platform.revision, workspaceRevision: before.workspace.revision, consentRef: consent.id, consentRevision: consent.revision };
      await identityCheck(consent, input, browser, tx, signal);
      if (!isDeepStrictEqual(await observe(consent, input, tx, signal), before)) throw unavailable();
      if (!row) {
        const count = await tx.$executeRaw`INSERT INTO mcp_oauth_grants (id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson)
          VALUES (${grant.id}, ${grant.subject}, ${grant.userId}, ${grant.clientId}, ${resource}, ${grant.tenantId}, ${grant.workspaceId}, ${JSON.stringify(grant)})`;
        live(signal); if (count !== 1) throw unavailable();
        const associated = await tx.$executeRaw`INSERT INTO mcp_oauth_grant_authorizations (authorizationId, authorizationRevision, grantId, consentHash, contextHash)
          VALUES (${consent.id}, ${consent.revision}, ${grant.id}, ${hash(consent)}, ${contextHash})`;
        live(signal); if (associated !== 1) throw unavailable();
        await audit(tx, { authorizationId: consent.id, authorizationRevision: consent.revision, grantId: grant.id,
          userId: grant.userId, tenantId: grant.tenantId, workspaceId: grant.workspaceId }, signal); live(signal);
      }
      const saved = await association(tx, consent.id, signal);
      if (!saved || saved.grantId !== grant.id || saved.authorizationRevision !== consent.revision
        || saved.consentHash !== hash(consent) || saved.contextHash !== contextHash) throw unavailable();
      if (!isDeepStrictEqual(await savedGrant(tx, grant.id, consent, signal), snapshotJson(grant, { stringCharacters: 2048, arrayItems: 50 }))) throw unavailable();
      const current = await authority.issuance.current(grant.id, input.clientId, input.clientRevision, transaction, signal); live(signal);
      if (!current) throw unavailable();
      await identityCheck(consent, input, browser, tx, signal);
      if (!isDeepStrictEqual(await observe(consent, input, tx, signal), before)) throw unavailable();
      return { kind: "approved" as const, id: consent.id, revision: consent.revision, expiresAt: consent.expiresAt, request: input, grant: current };
    },
    async receipt(raw: ValidatedPublicClientAuthorization, browser: Request, transaction: PersistentOAuthAuthorizationTransaction, signal: AbortSignal) {
      signal = AbortSignal.any([signal, browser.signal]); live(signal);
      const input = requestSnapshot(raw, resource, allowed), tx = native(transaction), consent = await decision(input, browser, tx, signal, "read_receipt");
      await identityCheck(consent, input, browser, tx, signal, "read_receipt"); const row = await association(tx, consent.id, signal);
      if (row) {
        if (consent.kind !== "approved" || row.authorizationRevision !== consent.revision || row.consentHash !== hash(consent)) throw unavailable();
        await savedGrant(tx, row.grantId as string, consent, signal);
      }
      await identityCheck(consent, input, browser, tx, signal, "read_receipt");
      return row ? { state: "observed" as const, authorizationId: consent.id, authorizationRevision: consent.revision, grantId: row.grantId as string }
        : { state: "not_observed" as const, retryable: false as const };
    },
  };
  return Object.freeze({
    async current(...args: Parameters<OriginalOAuthConsentAuthority["current"]>) {
      try { return await implementation.current(...args); } catch { throw unavailable(); }
    },
    async receipt(...args: Parameters<PrismaOAuthConsentAuthority["receipt"]>) {
      try { return await implementation.receipt(...args); } catch { throw unavailable(); }
    },
  });
}
