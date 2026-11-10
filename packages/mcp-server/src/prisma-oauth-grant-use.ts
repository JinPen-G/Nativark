/** Server-owned last completed read observation, NOT goal/call accounting or a
 * financial ledger. Runs AFTER original authority/accounting and output validation;
 * credential verification, discovery, Web reads and client clocks never create use.
 * No HTTP/model writer. Saved use does not prove delivery or a business commit. */
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { createPersistentOAuthAccessReader } from "./persistent-oauth-tokens.js";
import type { PersistentOAuthTokenConfig } from "./persistent-oauth-tokens.js";
import type { PrismaOAuthStore, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import type { PersistedOriginalOAuthGrant, PrismaOAuthGrantAuthority } from "./prisma-oauth-grant-authority.js";
import type { McpReadUsage, McpReadAuthorization } from "./read-tools.js";

export type OAuthGrantLastUse = { state: "unavailable" }
  | { state: "observed"; kind: "server_read_completed"; observedAtMs: number };
export interface OriginalOAuthGrantUseSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  readIn(transaction: Native, grant: PersistedOriginalOAuthGrant, signal: AbortSignal): Promise<OAuthGrantLastUse>;
}
export interface PrismaOAuthGrantUseStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> extends OriginalOAuthGrantUseSource<Native> {
  /** Attach only to actual business read registrations, never protocol discovery,
   * Prompts, Web governance or passive resource metadata. Original Guard/ALS and
   * accounting remain required; this observer supplies none of those authorities. */
  reads: McpReadUsage;
}
const unavailable = () => new Error("OAuth grant use unavailable");
const live = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };
const noUse = (): OAuthGrantLastUse => Object.freeze({ state: "unavailable" });
const columns = ["grantId", "resource", "userId", "tenantId", "workspaceId", "clientId", "grantRevision", "observedAtMs"];

/** Validates the minimal stored observation against the ORIGINAL immutable grant,
 * not current issuance permission. Revocation must not erase historical use. */
type OAuthGrantUseBinding = Pick<PersistedOriginalOAuthGrant, "id" | "resource" | "userId" | "tenantId" | "workspaceId" | "clientId" | "revision">;
function captureUse(raw: unknown, grant: OAuthGrantUseBinding): OAuthGrantLastUse {
  const row = snapshotJsonFields(raw, columns, { stringCharacters: 2048, arrayItems: 32 });
  if (row.grantId !== grant.id || row.resource !== grant.resource || row.userId !== grant.userId || row.tenantId !== grant.tenantId
    || row.workspaceId !== grant.workspaceId || row.clientId !== grant.clientId || typeof row.grantRevision !== "number"
    || !Number.isSafeInteger(row.grantRevision) || row.grantRevision < 1 || row.grantRevision > grant.revision
    || typeof row.observedAtMs !== "string" || !/^[1-9][0-9]{0,15}$/.test(row.observedAtMs)
    || !Number.isSafeInteger(Number(row.observedAtMs)) || String(Number(row.observedAtMs)) !== row.observedAtMs) throw unavailable();
  return Object.freeze({ state: "observed", kind: "server_read_completed", observedAtMs: Number(row.observedAtMs) });
}
export function captureOAuthGrantLastUse(raw: unknown): OAuthGrantLastUse {
  const value = snapshotJson(raw, { stringCharacters: 64, arrayItems: 1 });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  if (row.state === "unavailable" && Object.keys(row).length === 1) return noUse();
  if (Object.keys(row).length !== 3 || row.state !== "observed" || row.kind !== "server_read_completed"
    || typeof row.observedAtMs !== "number" || !Number.isSafeInteger(row.observedAtMs) || row.observedAtMs < 1) throw unavailable();
  return Object.freeze({ state: "observed", kind: "server_read_completed", observedAtMs: row.observedAtMs });
}
export function createPrismaOAuthGrantUseStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: Pick<PersistentOAuthTokenConfig, "enabled" | "resourceUrl" | "allowedScopes">,
  store: PrismaOAuthStore<Native>, authority: PrismaOAuthGrantAuthority
): PrismaOAuthGrantUseStore<Native> {
  const reader = createPersistentOAuthAccessReader(config, authority.access), resource = config.resourceUrl;
  if (typeof store?.transaction !== "function" || typeof store.native !== "function" || typeof authority?.principal !== "function") throw unavailable();
  const transaction = store.transaction.bind(store), native = store.native.bind(store), principal = authority.principal.bind(authority);
  const readIn = async (tx: Native, grant: OAuthGrantUseBinding, signal: AbortSignal): Promise<OAuthGrantLastUse> => {
    live(signal); if (grant.resource !== resource) throw unavailable();
    const rows = await tx.$queryRaw<unknown[]>`SELECT grantId, resource, userId, tenantId, workspaceId, clientId, grantRevision, CAST(observedAtMs AS CHAR) AS observedAtMs FROM mcp_oauth_grant_last_use WHERE grantId = ${grant.id} FOR UPDATE`;
    live(signal);
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw unavailable();
    if (!rows.length) return noUse();
    const row = Object.getOwnPropertyDescriptor(rows, "0");
    if (!row?.enumerable || !Object.hasOwn(row, "value")) throw unavailable();
    return captureUse(row.value, grant);
  };
  const record = async (authorization: McpReadAuthorization, signal: AbortSignal) => {
    // Only this server callback selects the clock. Neither the model nor a Web
    // request can supply a grant locator, timestamp, revision or principal tuple.
    const observedAtMs = Date.now();
    await transaction(async tx => {
      const before = await reader.readIn(tx, authorization.token, signal), who = await principal(before.grantId, tx, signal);
      if (!who || before.grantRevision > 2147483647 || before.authorization.subject !== authorization.subject || before.authorization.clientId !== authorization.clientId
        || before.authorization.resource !== authorization.resource || !isDeepStrictEqual(before.authorization.scopes, authorization.scopes)) throw unavailable();
      const sql = native(tx);
      // Original authority already locked this grant. Load the immutable tuple only
      // for persisted observation validation; it is not a second identity system.
      const grant: OAuthGrantUseBinding = {
        id: before.grantId, resource, userId: who.userId, tenantId: who.tenantId, workspaceId: who.workspaceId,
        clientId: before.authorization.clientId, revision: before.grantRevision,
      };
      const previous = await readIn(sql, grant, signal);
      const at = Math.max(observedAtMs, previous.state === "observed" ? previous.observedAtMs : 0);
      // Grant lock serializes competing observations. Avoid UPDATE when unchanged:
      // MySQL changed-row reporting is not evidence that a second read failed.
      if (previous.state === "unavailable") {
        const changed = await sql.$executeRaw`INSERT INTO mcp_oauth_grant_last_use (grantId, resource, userId, tenantId, workspaceId, clientId, grantRevision, observedAtMs) VALUES (${grant.id}, ${resource}, ${grant.userId}, ${grant.tenantId}, ${grant.workspaceId}, ${grant.clientId}, ${grant.revision}, ${at})`;
        live(signal); if (changed !== 1) throw unavailable();
      } else if (at !== previous.observedAtMs) {
        const changed = await sql.$executeRaw`UPDATE mcp_oauth_grant_last_use SET observedAtMs = ${at}, grantRevision = ${grant.revision} WHERE grantId = ${grant.id} AND observedAtMs = ${previous.observedAtMs}`;
        live(signal); if (changed !== 1) throw unavailable();
      }
      const after = await reader.readIn(tx, authorization.token, signal);
      if (!isDeepStrictEqual(after, before) || !isDeepStrictEqual(await principal(before.grantId, tx, signal), who)
        || !isDeepStrictEqual(await readIn(sql, grant, signal), { state: "observed", kind: "server_read_completed", observedAtMs: at })) throw unavailable();
    }, signal);
    live(signal); // Commit/abort races suppress delivery, never retry this read.
  };
  return Object.freeze({ readIn, reads: Object.freeze({ async completed(authorization: McpReadAuthorization, signal: AbortSignal) {
    live(signal);
    const fixed = snapshotJson(authorization, { stringCharacters: 2048, arrayItems: 32 }) as unknown as McpReadAuthorization;
    await record(fixed, signal);
  } }) });
}
