/** Current OAuth grant admission observation, not business authority or token use.
 * Reuses the original access authority in the caller's already-open native
 * transaction. No second policy algorithm, credential, write, retry or connection. */
import { isDeepStrictEqual } from "node:util";
import { snapshotJson } from "./json-snapshot.js";
import type { PrismaOAuthStore, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import type { PersistedOriginalOAuthGrant, PrismaOAuthGrantAuthority } from "./prisma-oauth-grant-authority.js";
export type OAuthGrantAdmissionState = { state: "current" | "not_current" | "unavailable" };
export interface OriginalOAuthGrantAdmissionSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original current client/platform/workspace/account/grant intersection only;
   * never attests business Guard, location/dataScope, goal quota or field release. */
  readIn(transaction: Native, grant: PersistedOriginalOAuthGrant, signal: AbortSignal): Promise<OAuthGrantAdmissionState>;
}
const unavailable = () => Object.freeze({ state: "unavailable" as const });
export function captureOAuthGrantAdmissionState(raw: unknown): OAuthGrantAdmissionState {
  const value = snapshotJson(raw, { stringCharacters: 32, arrayItems: 1 });
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "state")) throw new Error("OAuth admission observation unavailable");
  const state = (value as Record<string, unknown>).state;
  if (state !== "current" && state !== "not_current" && state !== "unavailable") throw new Error("OAuth admission observation unavailable");
  return Object.freeze({ state });
}
/** Borrow the existing owner transaction to observe original OAuth admission.
 * Failure/missing evidence remains unavailable, never confirmed revocation. */
export function createPrismaOAuthGrantAdmissionSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }, store: PrismaOAuthStore<Native>, authority: PrismaOAuthGrantAuthority
): OriginalOAuthGrantAdmissionSource<Native> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl
    || typeof store?.withNative !== "function" || typeof authority?.access?.current !== "function") throw new Error("OAuth admission observation unavailable");
  const borrow = store.withNative.bind(store), current = authority.access.current.bind(authority.access);
  return Object.freeze({ async readIn(native: Native, grant: PersistedOriginalOAuthGrant, signal: AbortSignal): Promise<OAuthGrantAdmissionState> {
    if (signal.aborted || grant.resource !== resource) return unavailable();
    try {
      return await borrow(native, async tx => {
        const raw = await current(grant.id, tx, signal);
        if (signal.aborted) return unavailable();
        if (raw === undefined) return Object.freeze({ state: "not_current" as const });
        const value = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 });
        if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
        const row = value as Record<string, unknown>;
        if (Object.keys(row).length !== 7 || row.id !== grant.id || row.subject !== grant.subject || row.revision !== grant.revision
          || row.clientId !== grant.clientId || row.resource !== resource || !isDeepStrictEqual(row.scopes, grant.scopes)
          || typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= Date.now() / 1000) return unavailable();
        return Object.freeze({ state: "current" as const });
      }, signal);
    } catch { return unavailable(); }
  } });
}
