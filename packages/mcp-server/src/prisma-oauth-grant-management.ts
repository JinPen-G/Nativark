/** Original Web grant summary/revoke-only CAS and immutable operation receipts.
 * No token/subject/secret release, issuance/re-enable/remapping, business permission
 * or deletion of OAuth history. Current original owner/tenant management and native
 * atomic audit are mandatory. Revocation is not rollback or credential-copy erasure. */
import { createHash } from "node:crypto";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { capturePersistedOAuthGrant } from "./prisma-oauth-grant-authority.js";
import type { PersistedOriginalOAuthGrant } from "./prisma-oauth-grant-authority.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { captureOAuthGrantLastUse } from "./prisma-oauth-grant-use.js";
import type { OAuthGrantLastUse, OriginalOAuthGrantUseSource } from "./prisma-oauth-grant-use.js";
import { captureOAuthGrantAdmissionState } from "./prisma-oauth-grant-admission.js";
import type { OAuthGrantAdmissionState, OriginalOAuthGrantAdmissionSource } from "./prisma-oauth-grant-admission.js";
export interface OAuthGrantSummary {
  grantId: string; userId: string; clientId: string; tenantId: string; workspaceId: string;
  scopes: readonly string[]; revision: number; expiresAt: number;
  revocationState: "not_revoked" | "revoked";
  /** Original server observation only; absent evidence is not never-used. */
  lastUse: OAuthGrantLastUse;
  /** OAuth admission now, NOT effective business/field/goal authorization. */
  oauthAdmission: OAuthGrantAdmissionState;
}
export interface OAuthGrantRevocationReceipt { state: "revoked"; operationKey: string; grantId: string; previousRevision: number; revision: number }
export interface OriginalOAuthGrantManager { actorId: string; tenantId: string; workspaceId: string; authority: "owner" | "tenant_manager" }
export interface OAuthGrantListOwner { userId: string; tenantId: string; workspaceId: string }
export interface OAuthGrantListPage { items: readonly OAuthGrantSummary[]; nextCursor?: string }
export interface OriginalOAuthGrantManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original CURRENT Web owner only. No caller-selected user/tenant/space or
   * tenant-manager-wide list. Optional for older ports; missing denies listing. */
  owner?(transaction: Native, signal: AbortSignal): Promise<OAuthGrantListOwner | undefined>;
  authorize(transaction: Native, request: { action: "read" | "revoke" | "read_receipt"; grant: PersistedOriginalOAuthGrant }, signal: AbortSignal): Promise<OriginalOAuthGrantManager | undefined>;
  audit(transaction: Native, input: { actorId: string; operationKey: string; grantId: string; revision: number }, signal: AbortSignal): Promise<void>;
}
export interface PrismaOAuthGrantManagementStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Internal native owner read; caller owns Auth/authorization and output policy. */
  readIn(transaction: Native, grantId: string, signal: AbortSignal): Promise<PersistedOriginalOAuthGrant | undefined>;
  read(grantId: string, signal: AbortSignal): Promise<OAuthGrantSummary>;
  /** One original-owner page, no total/latest inference or usage side effects. */
  list(input: { limit: number; cursor?: string }, signal: AbortSignal): Promise<OAuthGrantListPage>;
  revoke(input: { operationKey: string; grantId: string; expectedRevision: number }, signal: AbortSignal): Promise<OAuthGrantRevocationReceipt>;
  operation(grantId: string, operationKey: string, signal: AbortSignal): Promise<{ state: "observed"; result: OAuthGrantRevocationReceipt } | { state: "not_observed"; retryable: false }>;
}
export class OAuthGrantManagementError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth grant management ${kind}`); this.name = "OAuthGrantManagementError"; }
}
const fail = (kind: OAuthGrantManagementError["kind"]) => new OAuthGrantManagementError(kind);
const live = (s: AbortSignal) => { if (s.aborted) throw fail("unavailable"); };
const ref = (v: unknown): v is string => typeof v === "string" && /^[\x21-\x7e]{1,200}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function fields(raw: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof raw === "string") { if (Buffer.byteLength(raw, "utf8") > 65536) throw fail("unavailable"); raw = JSON.parse(raw); }
  const v = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 });
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) throw fail("invalid"); return v as Record<string, unknown>;
}
function selected(rows: unknown, names: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable"); if (!rows.length) return undefined;
  const item = Object.getOwnPropertyDescriptor(rows, "0"); if (!item?.enumerable || !Object.hasOwn(item, "value")) throw fail("unavailable"); return snapshotJsonFields(item.value, names, { stringCharacters: 65536, arrayItems: 32 });
}
const commandHash = (operationKey: string, grantId: string, expectedRevision: number) => createHash("sha256").update(JSON.stringify({ operationKey, grantId, expectedRevision })).digest("hex");
export function captureOAuthGrantRevocationReceipt(raw: unknown, payloadHash: string): OAuthGrantRevocationReceipt {
  const v = fields(raw, ["state", "operationKey", "grantId", "previousRevision", "revision"]);
  if (v.state !== "revoked" || !key(v.operationKey) || !ref(v.grantId) || typeof v.previousRevision !== "number" || !Number.isSafeInteger(v.previousRevision) || v.previousRevision < 1 || v.previousRevision >= 2147483647
    || v.revision !== v.previousRevision + 1 || payloadHash !== commandHash(v.operationKey, v.grantId, v.previousRevision)) throw fail("unavailable");
  return Object.freeze({ state: "revoked", operationKey: v.operationKey, grantId: v.grantId, previousRevision: v.previousRevision, revision: v.revision as number });
}
function grantSummary(g: PersistedOriginalOAuthGrant, lastUse: OAuthGrantLastUse, oauthAdmission: OAuthGrantAdmissionState): OAuthGrantSummary {
  // Original record state only, not effective client/policy/role authorization.
  return Object.freeze({ grantId: g.id, userId: g.userId, clientId: g.clientId, tenantId: g.tenantId, workspaceId: g.workspaceId,
    scopes: Object.freeze([...g.scopes]), revision: g.revision, expiresAt: g.expiresAt,
    revocationState: g.enabled ? "not_revoked" as const : "revoked" as const, lastUse, oauthAdmission });
}
export function createPrismaOAuthGrantManagementStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }, database: OAuthSqlDatabase<Native>, management: OriginalOAuthGrantManagement<Native>,
  usage?: OriginalOAuthGrantUseSource<Native>, admission?: OriginalOAuthGrantAdmissionSource<Native>
): PrismaOAuthGrantManagementStore<Native> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048) throw fail("invalid");
  if (typeof database?.$transaction !== "function" || typeof management?.authorize !== "function" || typeof management.audit !== "function") throw fail("unavailable");
  if (management.owner !== undefined && typeof management.owner !== "function" || usage !== undefined && typeof usage?.readIn !== "function"
    || admission !== undefined && typeof admission?.readIn !== "function") throw fail("unavailable");
  const transact = database.$transaction.bind(database), authorize = management.authorize.bind(management), audit = management.audit.bind(management), originalOwner = management.owner?.bind(management);
  const originalUse = usage?.readIn.bind(usage);
  const lastUse = async (tx: Native, grant: PersistedOriginalOAuthGrant, s: AbortSignal) => {
    live(s); if (!originalUse) return captureOAuthGrantLastUse({ state: "unavailable" });
    const result = captureOAuthGrantLastUse(await originalUse(tx, grant, s)); live(s); return result;
  };
  const currentAdmission = admission?.readIn.bind(admission);
  const admissionState = async (tx: Native, grant: PersistedOriginalOAuthGrant, s: AbortSignal): Promise<OAuthGrantAdmissionState> => {
    live(s); if (!currentAdmission) return captureOAuthGrantAdmissionState({ state: "unavailable" });
    try { const state = captureOAuthGrantAdmissionState(await currentAdmission(tx, grant, s)); live(s); return state; }
    catch { live(s); return captureOAuthGrantAdmissionState({ state: "unavailable" }); }
  };
  const run = async <T>(consume: (tx: Native) => Promise<T>, s: AbortSignal) => { live(s); let entered = false;
    const value = await transact(async tx => { if (entered) throw fail("unavailable"); entered = true; live(s); const result = await consume(tx); live(s); return result; }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(s); return value; };
  const readIn = async (tx: Native, grantId: string, s: AbortSignal) => {
    live(s); const rows = await tx.$queryRaw<unknown[]>`SELECT id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE id = ${grantId} FOR UPDATE`; live(s);
    const row = selected(rows, ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId", "recordJson"]); if (!row) return undefined; const g = capturePersistedOAuthGrant(row.recordJson);
    if (g.id !== grantId || g.resource !== resource || ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId"].some(n => row[n] !== (g as unknown as Record<string, unknown>)[n])) throw fail("unavailable"); return g;
  };
  const manager = async (tx: Native, action: "read" | "revoke" | "read_receipt", grant: PersistedOriginalOAuthGrant, s: AbortSignal) => {
    live(s); const raw = await authorize(tx, { action, grant }, s); live(s); if (!raw) throw fail("denied"); const v = fields(raw, ["actorId", "tenantId", "workspaceId", "authority"]);
    if (!id(v.actorId) || v.tenantId !== grant.tenantId || v.workspaceId !== grant.workspaceId || !["owner", "tenant_manager"].includes(v.authority as string) || v.authority === "owner" && v.actorId !== grant.userId) throw fail("denied");
    return Object.freeze({ actorId: v.actorId, tenantId: grant.tenantId, workspaceId: grant.workspaceId, authority: v.authority as "owner" | "tenant_manager" });
  };
  const owner = async (tx: Native, s: AbortSignal): Promise<OAuthGrantListOwner> => {
    live(s); if (!originalOwner) throw fail("unavailable"); const raw = await originalOwner(tx, s); live(s); if (!raw) throw fail("denied");
    const v = fields(raw, ["userId", "tenantId", "workspaceId"]); if (![v.userId, v.tenantId, v.workspaceId].every(id)) throw fail("denied");
    return Object.freeze({ userId: v.userId as string, tenantId: v.tenantId as string, workspaceId: v.workspaceId as string });
  };
  const cursorAfter = (cursor: string, who: OAuthGrantListOwner) => {
    if (!/^[A-Za-z0-9_-]{1,4096}$/.test(cursor)) throw fail("invalid"); const data = Buffer.from(cursor, "base64url"); if (data.toString("base64url") !== cursor) throw fail("invalid");
    const v = fields(new TextDecoder("utf-8", { fatal: true }).decode(data), ["resource", "userId", "tenantId", "workspaceId", "afterId"]);
    if (v.resource !== resource || v.userId !== who.userId || v.tenantId !== who.tenantId || v.workspaceId !== who.workspaceId || !ref(v.afterId)) throw fail("invalid"); return v.afterId;
  };
  const operationRow = async (tx: Native, operationKey: string, s: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, grantId, resource, tenantId, workspaceId, payloadHash, resultJson FROM mcp_oauth_grant_operations WHERE operationKey = ${operationKey} FOR UPDATE`; live(s);
    return selected(rows, ["actorId", "grantId", "resource", "tenantId", "workspaceId", "payloadHash", "resultJson"]);
  };
  const stored = (row: Record<string, unknown>, grant: PersistedOriginalOAuthGrant, operationKey: string) => {
    if (!id(row.actorId) || typeof row.payloadHash !== "string") throw fail("unavailable"); const receipt = captureOAuthGrantRevocationReceipt(row.resultJson, row.payloadHash);
    if (receipt.operationKey !== operationKey || receipt.grantId !== grant.id || row.grantId !== grant.id || row.resource !== resource || row.tenantId !== grant.tenantId || row.workspaceId !== grant.workspaceId
      || grant.enabled || grant.revision < receipt.revision) throw fail("unavailable"); return receipt;
  };
  return Object.freeze({
    async readIn(tx: Native, grantId: string, s: AbortSignal) { if (!ref(grantId)) throw fail("invalid"); try { return await readIn(tx, grantId, s); } catch { throw fail("unavailable"); } },
    async read(grantId: string, s: AbortSignal): Promise<OAuthGrantSummary> {
      if (!ref(grantId)) throw fail("invalid"); try { return await run(async tx => { const g = await readIn(tx, grantId, s); if (!g) throw fail("unavailable"); const who = await manager(tx, "read", g, s);
        const use = await lastUse(tx, g, s), admission = await admissionState(tx, g, s);
        const after = await readIn(tx, grantId, s); if (JSON.stringify(after) !== JSON.stringify(g) || JSON.stringify(await manager(tx, "read", g, s)) !== JSON.stringify(who)) throw fail("denied");
        return grantSummary(g, use, admission); }, s);
      } catch (e) { if (e instanceof OAuthGrantManagementError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
    async list(raw: { limit: number; cursor?: string }, s: AbortSignal): Promise<OAuthGrantListPage> {
      live(s); let limit: number, cursor: string | undefined;
      try { const v = fields(raw, raw && Object.hasOwn(raw, "cursor") ? ["limit", "cursor"] : ["limit"]);
        if (typeof v.limit !== "number" || !Number.isSafeInteger(v.limit) || v.limit < 1 || v.limit > 20 || Object.hasOwn(v, "cursor") && typeof v.cursor !== "string") throw fail("invalid");
        limit = v.limit; cursor = v.cursor as string | undefined; } catch { throw fail("invalid"); }
      try { return await run(async tx => {
        const who = await owner(tx, s), afterId = cursor === undefined ? undefined : cursorAfter(cursor, who);
        const rows = afterId === undefined
          ? await tx.$queryRaw<unknown[]>`SELECT id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE resource = ${resource} AND userId = ${who.userId} AND tenantId = ${who.tenantId} AND workspaceId = ${who.workspaceId} ORDER BY id ASC LIMIT ${limit + 1} FOR UPDATE`
          : await tx.$queryRaw<unknown[]>`SELECT id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE resource = ${resource} AND userId = ${who.userId} AND tenantId = ${who.tenantId} AND workspaceId = ${who.workspaceId} AND id > ${afterId} ORDER BY id ASC LIMIT ${limit + 1} FOR UPDATE`;
        live(s); if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > limit + 1) throw fail("unavailable");
        const items: OAuthGrantSummary[] = []; let previous = afterId;
        for (let i = 0; i < rows.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(rows, String(i)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw fail("unavailable");
          const row = selected([descriptor.value], ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId", "recordJson"]); if (!row) throw fail("unavailable");
          const g = capturePersistedOAuthGrant(row.recordJson);
          if (g.resource !== resource || g.userId !== who.userId || g.tenantId !== who.tenantId || g.workspaceId !== who.workspaceId || previous !== undefined && g.id <= previous
            || ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId"].some(n => row[n] !== (g as unknown as Record<string, unknown>)[n])) throw fail("unavailable");
          previous = g.id;
          if (i < limit) { const permit = await manager(tx, "read", g, s); if (permit.authority !== "owner" || permit.actorId !== who.userId) throw fail("denied"); items.push(grantSummary(g, await lastUse(tx, g, s), await admissionState(tx, g, s))); }
        }
        if (JSON.stringify(await owner(tx, s)) !== JSON.stringify(who)) throw fail("denied");
        // Cursor is only a scoped position, NEVER authorization or a trusted claim.
        const nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({ resource, ...who, afterId: items[items.length - 1]!.grantId }), "utf8").toString("base64url") : undefined;
        return Object.freeze({ items: Object.freeze(items), ...(nextCursor === undefined ? {} : { nextCursor }) });
      }, s); } catch (e) { if (e instanceof OAuthGrantManagementError && ["invalid", "denied"].includes(e.kind)) throw e; throw fail("unavailable"); }
    },
    async revoke(raw: { operationKey: string; grantId: string; expectedRevision: number }, s: AbortSignal) {
      live(s); let input: { operationKey: string; grantId: string; expectedRevision: number };
      try { const v = fields(raw, ["operationKey", "grantId", "expectedRevision"]); if (!key(v.operationKey) || !ref(v.grantId) || typeof v.expectedRevision !== "number" || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 1 || v.expectedRevision >= 2147483647) throw fail("invalid");
        input = { operationKey: v.operationKey, grantId: v.grantId, expectedRevision: v.expectedRevision }; } catch { throw fail("invalid"); }
      const hash = commandHash(input.operationKey, input.grantId, input.expectedRevision);
      try { return await run(async tx => { const g = await readIn(tx, input.grantId, s); if (!g) throw fail("unavailable"); const who = await manager(tx, "revoke", g, s), original = await operationRow(tx, input.operationKey, s);
        const check = async (grant: PersistedOriginalOAuthGrant) => { if (JSON.stringify(await manager(tx, "revoke", grant, s)) !== JSON.stringify(who)) throw fail("denied"); };
        if (original) { if (original.actorId !== who.actorId || original.payloadHash !== hash) throw fail("conflict"); const result = stored(original, g, input.operationKey); await check(g); return result; }
        if (!g.enabled || g.revision !== input.expectedRevision) throw fail("conflict"); await check(g);
        const revoked = capturePersistedOAuthGrant({ ...g, enabled: false, revision: g.revision + 1 });
        const changed = await tx.$executeRaw`UPDATE mcp_oauth_grants SET recordJson = ${JSON.stringify(revoked)} WHERE id = ${g.id} AND resource = ${resource} AND userId = ${g.userId} AND tenantId = ${g.tenantId} AND workspaceId = ${g.workspaceId} AND JSON_UNQUOTE(JSON_EXTRACT(recordJson, '$.revision')) = ${String(input.expectedRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(recordJson, '$.enabled')) = 'true'`;
        live(s); if (changed !== 1) throw fail("conflict"); const result: OAuthGrantRevocationReceipt = Object.freeze({ state: "revoked", operationKey: input.operationKey, grantId: g.id, previousRevision: input.expectedRevision, revision: revoked.revision });
        const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_grant_operations (operationKey, actorId, grantId, resource, tenantId, workspaceId, payloadHash, resultJson) VALUES (${input.operationKey}, ${who.actorId}, ${g.id}, ${resource}, ${g.tenantId}, ${g.workspaceId}, ${hash}, ${JSON.stringify(result)})`;
        live(s); if (inserted !== 1) throw fail("unavailable"); await audit(tx, { actorId: who.actorId, operationKey: input.operationKey, grantId: g.id, revision: revoked.revision }, s); live(s); await check(revoked);
        if (JSON.stringify(await readIn(tx, g.id, s)) !== JSON.stringify(revoked)) throw fail("unavailable"); const saved = await operationRow(tx, input.operationKey, s);
        if (!saved || saved.actorId !== who.actorId || JSON.stringify(stored(saved, revoked, input.operationKey)) !== JSON.stringify(result)) throw fail("unavailable"); return result;
      }, s); } catch (e) { if (e instanceof OAuthGrantManagementError && ["denied", "conflict"].includes(e.kind)) throw e; throw fail("unknown"); }
    },
    async operation(grantId: string, operationKey: string, s: AbortSignal) {
      if (!ref(grantId) || !key(operationKey)) throw fail("invalid"); try { return await run(async tx => { const g = await readIn(tx, grantId, s); if (!g) throw fail("unavailable"); const who = await manager(tx, "read_receipt", g, s), row = await operationRow(tx, operationKey, s);
        if (JSON.stringify(await manager(tx, "read_receipt", g, s)) !== JSON.stringify(who)) throw fail("denied"); if (!row) return { state: "not_observed" as const, retryable: false as const };
        if (row.actorId !== who.actorId) throw fail("denied"); return { state: "observed" as const, result: stored(row, g, operationKey) }; }, s);
      } catch (e) { if (e instanceof OAuthGrantManagementError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
  });
}
