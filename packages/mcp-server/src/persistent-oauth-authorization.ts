/** One-use code issuance from ORIGINAL completed Web consent and current grant.
 * This module creates no consent, account, grant or login page. Original owners
 * lock/revalidate consent and registration in the same durable code transaction. */
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { oauthCredentialDigest } from "./persistent-oauth-tokens.js";
import type { CurrentOAuthGrant, PersistentOAuthCode, PersistentOAuthTokenTransaction } from "./persistent-oauth-tokens.js";
import type { OriginalAuthorizationOutcome, OriginalPublicClientAuthorization } from "./public-client-authorization-endpoint.js";
import type { ValidatedPublicClientAuthorization } from "./public-client-authorization.js";
import { snapshotJson } from "./json-snapshot.js";

export interface AuthorizedOAuthCode extends PersistentOAuthCode {
  authorizationId: string;
  authorizationRevision: number;
}

export interface PersistentOAuthAuthorizationTransaction extends PersistentOAuthTokenTransaction {
  /** Unique original authorization association, not the latest code for a user. */
  readCodeForAuthorization(authorizationId: string): Promise<AuthorizedOAuthCode | undefined>;
  /** Atomically insert a unique digest/authorization association and its original
   * authorization audit/receipt. Do not write plaintext code or browser credentials. */
  insertCode(value: AuthorizedOAuthCode): Promise<void>;
}

export interface PersistentOAuthAuthorizationStore {
  /** Same no-retry, serializable commit contract as the token store. Lock the
   * original consent/grant and its code association through the commit. */
  transaction<T>(consume: (transaction: PersistentOAuthAuthorizationTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
}

/** The original owner attests the COMPLETED human decision and current grant.
 * A missing record is unavailable, never implicit approval or human denial. */
export type CurrentOriginalOAuthConsent =
  | { kind: "approved"; id: string; revision: number; expiresAt: number;
      request: ValidatedPublicClientAuthorization; grant: CurrentOAuthGrant }
  | { kind: "denied"; error: "access_denied" };

export interface OriginalOAuthConsentAuthority {
  /** Resolve exact original consent from the authenticated browser Request and
   * recheck current identity, registration revision, fixed scope and grant. All
   * records/fences must stay locked through this transaction's commit. Never
   * trusts a model/URL/client claim that a human consented. */
  current(input: ValidatedPublicClientAuthorization, request: Request,
    transaction: PersistentOAuthAuthorizationTransaction, signal: AbortSignal): Promise<CurrentOriginalOAuthConsent | undefined>;
}

export interface PersistentOAuthAuthorizationConfig {
  enabled: boolean;
  resourceUrl: string;
  allowedScopes: readonly string[];
  codeTtlSeconds: number;
}

const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,200}$/.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const unavailable = () => new Error("Original OAuth consent unavailable");

/** Issue one code for an exact, completed original authorization, never reissue.
 * @param config - explicit scope/resource ceiling and code lifetime (at most 600s).
 * @param store - original code/consent transaction with unique association and audit.
 * @param authority - original human consent and current grant, not a model decision.
 * @returns an AS authorizer for the standard callback transport. Original consent
 * is checked before/after code insertion. A repeated authorization or unknown
 * commit never returns another code; only original reconciliation can recover.
 * Cancellation may follow commit and suppress code delivery, not prove rollback.
 */
export function createPersistentOAuthAuthorization(config: PersistentOAuthAuthorizationConfig,
  store: PersistentOAuthAuthorizationStore, authority: OriginalOAuthConsentAuthority): OriginalPublicClientAuthorization {
  const url = new URL(config.resourceUrl), resource = url.href, allowed = new Set(config.allowedScopes);
  const { enabled, codeTtlSeconds } = config;
  if (typeof enabled !== "boolean" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || resource !== config.resourceUrl || allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length
    || [...allowed].some(scope => !scopeToken.test(scope)) || !positiveInteger(codeTtlSeconds) || codeTtlSeconds > 600
    || typeof store?.transaction !== "function" || typeof authority?.current !== "function") {
    throw new TypeError("Code issuance requires original consent, durable association and explicit limits");
  }
  const transaction = store.transaction.bind(store), current = authority.current.bind(authority);
  return Object.freeze({ async authorize(input: ValidatedPublicClientAuthorization, request: Request, signal: AbortSignal): Promise<OriginalAuthorizationOutcome> {
    if (!enabled || signal.aborted) throw unavailable();
    const result = await transaction(async tx => {
      const read = async () => {
        if (signal.aborted) throw unavailable();
        const original: unknown = await current(input, request, tx, signal);
        if (original === undefined || signal.aborted) throw unavailable();
        const text = JSON.stringify(snapshotJson(original, { stringCharacters: 2048, arrayItems: 32 }));
        if (Buffer.byteLength(text, "utf8") > 65_536) throw unavailable();
        const value: CurrentOriginalOAuthConsent = JSON.parse(text);
        if (value.kind === "denied" && value.error === "access_denied") return value;
        if (value.kind !== "approved" || !identifier(value.id) || !positiveInteger(value.revision)
          || !positiveInteger(value.expiresAt) || value.expiresAt <= Date.now() / 1000
          || !isDeepStrictEqual(value.request, input)) throw unavailable();
        const grant = value.grant;
        if (!grant || !identifier(grant.id) || !identifier(grant.subject) || !positiveInteger(grant.revision)
          || grant.clientId !== input.clientId || grant.resource !== resource || input.resource !== resource
          || !positiveInteger(grant.expiresAt) || grant.expiresAt <= Date.now() / 1000
          || !Array.isArray(grant.scopes) || grant.scopes.length < 1 || grant.scopes.length > 32
          || new Set(grant.scopes).size !== grant.scopes.length || grant.scopes.some(scope => !allowed.has(scope))
          || JSON.stringify(grant.scopes) !== JSON.stringify(input.scopes)) throw unavailable();
        return value;
      };
      const consent = await read();
      if (consent.kind === "denied") return { outcome: { kind: "denied", error: "access_denied" } as const, expiresAt: null };
      if (await tx.readCodeForAuthorization(consent.id)) throw unavailable();
      if (signal.aborted) throw unavailable();
      const code = randomBytes(32).toString("base64url"), expiresAt = Math.min(
        Math.floor(Date.now() / 1000) + codeTtlSeconds, consent.expiresAt, consent.grant.expiresAt);
      await tx.insertCode({ authorizationId: consent.id, authorizationRevision: consent.revision,
        digest: oauthCredentialDigest(code), grantId: consent.grant.id, subject: consent.grant.subject,
        grantRevision: consent.grant.revision, clientId: input.clientId, resource, scopes: [...input.scopes],
        redirectUri: input.redirectUri, codeChallengeMethod: "S256", codeChallenge: input.codeChallenge,
        expiresAt, consumedFamilyId: null });
      if (!isDeepStrictEqual(await read(), consent)) throw unavailable();
      return { outcome: { kind: "code", code } as const, expiresAt };
    }, signal);
    if (signal.aborted || result.expiresAt !== null && result.expiresAt <= Date.now() / 1000) throw unavailable();
    return result.outcome;
  } });
}
