/** Opaque token lifecycle in the original AS's persistent transaction.
 * Original login/consent, grant creation and current Rental authority stay with
 * their owners. This service has no fallback store, permission database or retry. */
import { createHash, randomBytes } from "node:crypto";
import { assertAuthorizationCodeBinding } from "./authorization-code-binding.js";
import { OAuthTokenRequestError } from "./oauth-token-endpoint.js";
import type { OAuthTokens } from "@modelcontextprotocol/server";
import type { AuthorizationCodeExchange, OriginalOAuthTokenService, RefreshTokenExchange, TokenRevocation } from "./oauth-token-endpoint.js";
import { snapshotJson } from "./json-snapshot.js";
import { ResourceAuthorizationError } from "./resource-authorization.js";
import type { ResourceTokenVerifier, VerifiedResourceToken } from "./resource-authorization.js";

export interface PersistentOAuthCode {
  digest: string;
  grantId: string;
  subject: string;
  grantRevision: number;
  scopes: readonly string[];
  clientId: string;
  resource: string;
  redirectUri: string;
  codeChallengeMethod: "S256";
  codeChallenge: string;
  expiresAt: number;
  consumedFamilyId: string | null;
}

export interface PersistentOAuthFamily {
  id: string;
  grantId: string;
  subject: string;
  clientId: string;
  resource: string;
  grantRevision: number;
  scopes: readonly string[];
  expiresAt: number;
  revoked: boolean;
}

export interface PersistentOAuthAccess {
  digest: string;
  grantId: string;
  familyId: string;
  expiresAt: number;
}

export interface PersistentOAuthRefresh extends PersistentOAuthAccess {
  used: boolean;
}

/** Original grant reference/policy observation; not a second role or consent store. */
export interface CurrentOAuthGrant {
  id: string;
  subject: string;
  revision: number;
  clientId: string;
  resource: string;
  scopes: readonly string[];
  expiresAt: number;
}

/** The adapter locks code/refresh, grant and family rows until commit. Unique
 * digests and a one-family-per-code constraint must hold across every instance.
 * Used credentials remain as digests for replay detection; family revocation
 * invalidates ALL access and refresh tokens, including already rotated children.
 */
export interface PersistentOAuthTokenTransaction {
  readCode(digest: string): Promise<PersistentOAuthCode | undefined>;
  readRefresh(digest: string): Promise<PersistentOAuthRefresh | undefined>;
  readAccess(digest: string): Promise<PersistentOAuthAccess | undefined>;
  readFamily(id: string): Promise<PersistentOAuthFamily | undefined>;
  insertFamily(value: PersistentOAuthFamily): Promise<void>;
  consumeCode(digest: string, familyId: string): Promise<void>;
  consumeRefresh(digest: string): Promise<void>;
  insertAccess(value: PersistentOAuthAccess): Promise<void>;
  insertRefresh(value: PersistentOAuthRefresh): Promise<void>;
  revokeFamily(id: string): Promise<void>;
}

export interface PersistentOAuthTokenStore {
  /** Commit before resolving; reject on unknown commit without retrying. The
   * callback must not be retried. Cancellation is not proof of rollback. */
  transaction<T>(consume: (transaction: PersistentOAuthTokenTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
}

export interface OriginalOAuthAccessAuthority {
  /** Current original grant, identity, consent and registration policy, in the
   * read transaction. Undefined attests no current grant; unavailable evidence
   * must reject instead. Never reuses issuance-time authorization. */
  current(grantId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal): Promise<CurrentOAuthGrant | undefined>;
}

export interface OriginalOAuthGrantAuthority {
  /** Recheck current registration revision, original grant/consent, tenant policy
   * and identity inside the SAME transaction. Undefined means no current permit.
   * Registration disable must not block revocationOwner below. */
  current(grantId: string, clientId: string, clientRevision: number,
    transaction: PersistentOAuthTokenTransaction, signal: AbortSignal): Promise<CurrentOAuthGrant | undefined>;
  /** Original token/grant ownership only, so disabled clients can revoke. Never
   * treats client_id alone as authority over someone else's family. */
  revocationOwner(grantId: string, clientId: string,
    transaction: PersistentOAuthTokenTransaction, signal: AbortSignal): Promise<boolean>;
}

export interface PersistentOAuthTokenConfig {
  enabled: boolean;
  resourceUrl: string;
  allowedScopes: readonly string[];
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/** Digest for original credential lookup/storage. Never returns plaintext.
 * @param value - the original AS credential, not a business identity.
 * @returns a SHA256 digest; empty/non-ASCII credentials are rejected.
 */
export function oauthCredentialDigest(value: string): string {
  if (!/^[\x21-\x7e]{1,8192}$/.test(value)) throw new OAuthTokenRequestError("invalid_grant");
  return createHash("sha256").update(value, "ascii").digest("hex");
}

const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,200}$/.test(value);
const digestValue = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const expiry = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const live = (signal: AbortSignal) => { if (signal.aborted) throw new Error("OAuth lifecycle unavailable"); };

/** Detach ordinary durable records before awaiting another owner. Callers still
 * validate every binding/state they use; detachment is not a schema or permit. */
function recordSnapshot<T extends object>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(snapshotJson(value, { stringCharacters: 2048, arrayItems: 32 }));
  if (Buffer.byteLength(text, "utf8") > 65_536) throw new Error("OAuth record unavailable");
  const detached: T = JSON.parse(text);
  return detached;
}

/** Execute exchange, rotation and revocation against original persistent owners.
 * @param config - explicit resource, scope ceiling and credential lifetimes.
 * @param store - original serializable persistence; no in-memory default exists.
 * @param authority - original current grant/client/consent policy in its transaction.
 * @returns the original token service for the HTTP transport. Tokens are released
 * only after commit and kept out of stored rows. Code/refresh reuse commits family
 * revocation BEFORE invalid_grant is raised. No transaction retry, account creation,
 * grant creation or recovery inference occurs. Unknown commit must be reconciled by
 * the original owner, not repeated with another credential or family.
 */
export function createPersistentOAuthTokenService(config: PersistentOAuthTokenConfig,
  store: PersistentOAuthTokenStore, authority: OriginalOAuthGrantAuthority): OriginalOAuthTokenService {
  const url = new URL(config.resourceUrl);
  const resource = url.href, scopes = new Set(config.allowedScopes);
  const { enabled, accessTtlSeconds, refreshTtlSeconds } = config;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl
    || typeof enabled !== "boolean" || scopes.size < 1 || scopes.size > 32 || scopes.size !== config.allowedScopes.length
    || [...scopes].some(scope => !scopeToken.test(scope)) || !Number.isSafeInteger(accessTtlSeconds) || accessTtlSeconds < 1 || accessTtlSeconds > 900
    || !Number.isSafeInteger(refreshTtlSeconds) || refreshTtlSeconds < 1
    || typeof store?.transaction !== "function" || typeof authority?.current !== "function" || typeof authority.revocationOwner !== "function") {
    throw new TypeError("OAuth lifecycle requires original persistence, current authority and bounded configuration");
  }
  const transaction = store.transaction.bind(store), currentGrant = authority.current.bind(authority);
  const revocationOwner = authority.revocationOwner.bind(authority);
  const now = () => Math.floor(Date.now() / 1000);
  const current = async (grantId: string, clientId: string, revision: number, tx: PersistentOAuthTokenTransaction, signal: AbortSignal) => {
    live(signal);
    const original: unknown = await currentGrant(grantId, clientId, revision, tx, signal);
    live(signal);
    if (original === undefined) return undefined;
    const value = snapshotJson(original, { stringCharacters: 2048, arrayItems: 32 });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OAuth lifecycle unavailable");
    const row = value as Record<string, unknown>;
    if (row.id !== grantId || !identifier(row.id) || !identifier(row.subject) || row.clientId !== clientId || row.resource !== resource
      || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 || !expiry(row.expiresAt)
      || !Array.isArray(row.scopes) || row.scopes.length < 1 || new Set(row.scopes).size !== row.scopes.length
      || !row.scopes.every(scope => typeof scope === "string" && scopes.has(scope))) throw new Error("OAuth lifecycle unavailable");
    if (row.expiresAt <= now()) return undefined;
    return { id: row.id, subject: row.subject, revision: row.revision, clientId, resource, scopes: row.scopes as string[], expiresAt: row.expiresAt };
  };
  const family = async (id: string, grantId: string, tx: PersistentOAuthTokenTransaction) => {
    const row = recordSnapshot(await tx.readFamily(id));
    if (!row || row.id !== id || row.grantId !== grantId || !identifier(row.id) || !identifier(row.subject)
      || !identifier(row.clientId) || typeof row.resource !== "string" || !expiry(row.expiresAt) || typeof row.revoked !== "boolean"
      || !Number.isSafeInteger(row.grantRevision) || row.grantRevision < 1 || !Array.isArray(row.scopes)
      || row.scopes.length < 1 || row.scopes.length > 32 || new Set(row.scopes).size !== row.scopes.length
      || row.scopes.some(scope => !scopeToken.test(scope))) {
      throw new Error("OAuth lifecycle unavailable");
    }
    return row;
  };
  const revokeOwnedFamily = async (grantId: string, familyId: string, clientId: string,
    tx: PersistentOAuthTokenTransaction, signal: AbortSignal) => {
    live(signal);
    const owned = await revocationOwner(grantId, clientId, tx, signal);
    live(signal);
    if (!owned) return;
    const selected = await family(familyId, grantId, tx);
    live(signal);
    if (selected.clientId !== clientId || selected.resource !== resource) throw new Error("OAuth lifecycle unavailable");
    await tx.revokeFamily(selected.id);
    live(signal);
  };
  const issue = async (grant: NonNullable<Awaited<ReturnType<typeof current>>>, selected: PersistentOAuthFamily,
    clientRevision: number, tx: PersistentOAuthTokenTransaction, signal: AbortSignal) => {
    const time = now(), expiresAt = Math.min(time + accessTtlSeconds, grant.expiresAt, selected.expiresAt);
    if (expiresAt <= time) throw new OAuthTokenRequestError("invalid_grant");
    const access = randomBytes(32).toString("base64url"), refresh = randomBytes(32).toString("base64url");
    await tx.insertAccess({ digest: oauthCredentialDigest(access), grantId: grant.id, familyId: selected.id, expiresAt });
    await tx.insertRefresh({ digest: oauthCredentialDigest(refresh), grantId: grant.id, familyId: selected.id,
      expiresAt: Math.min(grant.expiresAt, selected.expiresAt), used: false });
    live(signal);
    // The owner must keep the grant/registration fence locked through commit.
    const checked = await current(grant.id, grant.clientId, clientRevision, tx, signal);
    if (!checked || JSON.stringify(checked) !== JSON.stringify(grant)) throw new Error("OAuth lifecycle unavailable");
    return { tokens: { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: expiresAt - time, scope: grant.scopes.join(" ") }, expiresAt };
  };
  const release = (issued: { tokens: OAuthTokens; expiresAt: number } | undefined, signal: AbortSignal): OAuthTokens => {
    live(signal);
    if (!issued) throw new OAuthTokenRequestError("invalid_grant");
    const remaining = issued.expiresAt - now();
    if (remaining < 1) throw new Error("OAuth lifecycle unavailable");
    return { ...issued.tokens, expires_in: Math.min(accessTtlSeconds, remaining) };
  };
  const validScopes = (values: readonly string[]) => values.length >= 1 && values.length <= 32
    && new Set(values).size === values.length && values.every(scope => scopes.has(scope));
  const exchangeCode = async (input: AuthorizationCodeExchange, signal: AbortSignal) => {
    live(signal);
    if (!enabled) throw new Error("OAuth lifecycle unavailable");
    const digest = oauthCredentialDigest(input.code);
    const result = await transaction(async tx => {
      const code = recordSnapshot(await tx.readCode(digest));
      if (!code) return undefined;
      if (code.digest !== digest || !digestValue(code.digest) || !identifier(code.grantId) || !identifier(code.subject) || !expiry(code.expiresAt)
        || !Number.isSafeInteger(code.grantRevision) || code.grantRevision < 1 || !validScopes(code.scopes)
        || code.consumedFamilyId !== null && !identifier(code.consumedFamilyId)) throw new Error("OAuth lifecycle unavailable");
      assertAuthorizationCodeBinding(input, code);
      if (input.resource !== resource) return undefined;
      if (code.consumedFamilyId !== null) {
        // Reuse containment needs original ownership, not a new issuance permit.
        // Commit revocation, then report invalid_grant OUTSIDE the transaction.
        await revokeOwnedFamily(code.grantId, code.consumedFamilyId, input.clientId, tx, signal);
        return undefined;
      }
      const grant = await current(code.grantId, input.clientId, input.clientRevision, tx, signal);
      if (!grant) return undefined;
      if (code.expiresAt <= now() || code.subject !== grant.subject || code.grantRevision !== grant.revision
        || JSON.stringify(code.scopes) !== JSON.stringify(grant.scopes)) return undefined;
      const selected: PersistentOAuthFamily = { id: randomBytes(32).toString("base64url"), grantId: grant.id,
        subject: grant.subject, clientId: grant.clientId, resource, grantRevision: grant.revision, scopes: [...grant.scopes], expiresAt: Math.min(now() + refreshTtlSeconds, grant.expiresAt), revoked: false };
      await tx.insertFamily(selected);
      await tx.consumeCode(digest, selected.id);
      return issue(grant, selected, input.clientRevision, tx, signal);
    }, signal);
    return release(result, signal);
  };
  const refresh = async (input: RefreshTokenExchange, signal: AbortSignal) => {
    live(signal);
    if (!enabled) throw new Error("OAuth lifecycle unavailable");
    const digest = oauthCredentialDigest(input.refreshToken);
    const result = await transaction(async tx => {
      const token = recordSnapshot(await tx.readRefresh(digest));
      if (!token) return undefined;
      if (token.digest !== digest || !digestValue(token.digest) || !identifier(token.grantId) || !identifier(token.familyId)
        || !expiry(token.expiresAt) || typeof token.used !== "boolean") throw new Error("OAuth lifecycle unavailable");
      if (input.resource !== resource) return undefined;
      if (token.used) {
        await revokeOwnedFamily(token.grantId, token.familyId, input.clientId, tx, signal);
        return undefined;
      }
      const grant = await current(token.grantId, input.clientId, input.clientRevision, tx, signal);
      if (!grant) return undefined;
      const selected = await family(token.familyId, grant.id, tx);
      if (token.expiresAt <= now() || selected.expiresAt <= now() || selected.revoked
        || selected.subject !== grant.subject || selected.clientId !== grant.clientId || selected.resource !== resource
        || selected.grantRevision !== grant.revision || !validScopes(selected.scopes)
        || JSON.stringify(selected.scopes) !== JSON.stringify(grant.scopes)) return undefined;
      await tx.consumeRefresh(digest);
      return issue(grant, selected, input.clientRevision, tx, signal);
    }, signal);
    return release(result, signal);
  };
  const revoke = async (input: TokenRevocation, signal: AbortSignal) => {
    live(signal);
    if (!enabled) throw new Error("OAuth lifecycle unavailable");
    const digest = oauthCredentialDigest(input.token);
    await transaction(async tx => {
      // Hints do not hide a token of the other type (RFC7009).
      const token = recordSnapshot(await tx.readRefresh(digest) ?? await tx.readAccess(digest));
      if (!token) return;
      if (token.digest !== digest || !identifier(token.grantId) || !identifier(token.familyId)) throw new Error("OAuth lifecycle unavailable");
      if (!await revocationOwner(token.grantId, input.clientId, tx, signal)) { live(signal); return; }
      live(signal);
      await family(token.familyId, token.grantId, tx);
      await tx.revokeFamily(token.familyId);
      live(signal);
    }, signal);
    live(signal);
  };
  return Object.freeze({ exchangeCode, refresh, revoke });
}

/** Uncached opaque access/family/current-grant observation inside the supplied
 * original transaction. Unknown credentials are invalid; missing/corrupt evidence
 * is unavailable. No write, issuance, refresh, business Guard or field permission. */
/** Internal credential-derived binding for server-owned observations in the SAME
 * original transaction. Not a protocol result, caller-selected grant or use event. */
export interface VerifiedPersistentOAuthAccess { grantId: string; grantRevision: number; authorization: VerifiedResourceToken }
export function createPersistentOAuthAccessReader(config: Pick<PersistentOAuthTokenConfig, "enabled" | "resourceUrl" | "allowedScopes">,
  authority: OriginalOAuthAccessAuthority): {
    readIn(transaction: PersistentOAuthTokenTransaction, token: string, signal: AbortSignal): Promise<VerifiedPersistentOAuthAccess>;
  } {
  const url = new URL(config.resourceUrl), resource = url.href, enabled = config.enabled, allowed = new Set(config.allowedScopes);
  if (typeof enabled !== "boolean" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || resource !== config.resourceUrl || allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length
    || [...allowed].some(scope => !scopeToken.test(scope)) || typeof authority?.current !== "function") {
    throw new TypeError("Resource token verification requires original current persistence and explicit pins");
  }
  const currentGrant = authority.current.bind(authority);
  return Object.freeze({ async readIn(tx: PersistentOAuthTokenTransaction, token: string, signal: AbortSignal): Promise<VerifiedPersistentOAuthAccess> {
    if (!enabled || signal.aborted) throw new ResourceAuthorizationError("unavailable");
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) throw new ResourceAuthorizationError("invalid");
    try {
      const digest = oauthCredentialDigest(token), original = recordSnapshot(await tx.readAccess(digest));
      if (!original) throw new ResourceAuthorizationError("invalid");
      if (original.digest !== digest || !identifier(original.grantId) || !identifier(original.familyId) || !expiry(original.expiresAt)) {
        throw new ResourceAuthorizationError("unavailable");
      }
      const current = async (): Promise<VerifiedPersistentOAuthAccess> => {
        live(signal);
        const family = recordSnapshot(await tx.readFamily(original.familyId));
        const grant = recordSnapshot(await currentGrant(original.grantId, tx, signal));
        live(signal);
        if (!family) throw new ResourceAuthorizationError("unavailable");
        if (!grant) throw new ResourceAuthorizationError("invalid");
        if (family.id !== original.familyId || family.grantId !== original.grantId || grant.id !== original.grantId
          || !identifier(family.subject) || !identifier(family.clientId) || typeof family.resource !== "string"
          || !identifier(grant.subject) || !identifier(grant.clientId)
          || !expiry(family.expiresAt) || !expiry(grant.expiresAt) || typeof family.revoked !== "boolean"
          || !Number.isSafeInteger(grant.revision) || grant.revision < 1 || !Number.isSafeInteger(family.grantRevision)
          || !Array.isArray(family.scopes) || !Array.isArray(grant.scopes)) throw new ResourceAuthorizationError("unavailable");
        const expiresAt = Math.min(original.expiresAt, family.expiresAt, grant.expiresAt);
        if (family.revoked || expiresAt <= Date.now() / 1000 || grant.resource !== resource
          || family.subject !== grant.subject || family.clientId !== grant.clientId || family.resource !== resource || family.grantRevision !== grant.revision
          || JSON.stringify(family.scopes) !== JSON.stringify(grant.scopes)
          || grant.scopes.length < 1 || grant.scopes.length > 32 || new Set(grant.scopes).size !== grant.scopes.length
          || grant.scopes.some(scope => !allowed.has(scope))) throw new ResourceAuthorizationError("invalid");
        return { grantId: grant.id, grantRevision: grant.revision,
          authorization: { subject: grant.subject, clientId: grant.clientId, resource, scopes: [...grant.scopes], expiresAt } };
      };
      const first = await current(), second = await current();
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new ResourceAuthorizationError("invalid");
      return second;
    } catch (error) {
      if (error instanceof ResourceAuthorizationError) throw error;
      throw new ResourceAuthorizationError("unavailable");
    }
  } });
}

/** Public resource verification never exposes the internal grant locator or records
 * use. The same uncached family/grant reader is reused by original native writers. */
export function createPersistentOAuthResourceVerifier(config: Pick<PersistentOAuthTokenConfig, "enabled" | "resourceUrl" | "allowedScopes">,
  store: PersistentOAuthTokenStore, authority: OriginalOAuthAccessAuthority): ResourceTokenVerifier {
  const reader = createPersistentOAuthAccessReader(config, authority);
  if (typeof store?.transaction !== "function") throw new TypeError("Resource token verification requires original persistence");
  const transaction = store.transaction.bind(store), enabled = config.enabled;
  return Object.freeze({ async verifyAccessToken(token: string, options?: { signal: AbortSignal }): Promise<VerifiedResourceToken> {
    const signal = options?.signal ?? new AbortController().signal;
    if (!enabled || signal.aborted) throw new ResourceAuthorizationError("unavailable");
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) throw new ResourceAuthorizationError("invalid");
    try {
      const value = await transaction(async tx => (await reader.readIn(tx, token, signal)).authorization, signal);
      live(signal);
      if (value.expiresAt <= Date.now() / 1000) throw new ResourceAuthorizationError("invalid");
      return value;
    } catch (error) {
      if (error instanceof ResourceAuthorizationError) throw error;
      throw new ResourceAuthorizationError("unavailable");
    }
  } });
}
