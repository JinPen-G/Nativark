/** Current persisted AS grant/admission reads, not consent or business permission.
 * Original trusted writers own policy/grant creation, revisions and audit. Every
 * issuance/access read intersects current public registration and original identity
 * in the same transaction. No fallback, role calculation, grant creation or retry. */
import { isDeepStrictEqual } from "node:util";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import type { CurrentOAuthGrant, OriginalOAuthAccessAuthority, OriginalOAuthGrantAuthority, PersistentOAuthTokenTransaction } from "./persistent-oauth-tokens.js";
import type { OAuthSqlTransaction, PrismaOAuthStore } from "./prisma-oauth-store.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { RegisteredPublicClient } from "./public-client-authorization.js";

export interface OriginalOAuthPrincipalBinding {
  readonly userId: string; readonly tenantId: string; readonly workspaceId: string; readonly audience: "operator";
}
export interface OAuthPlatformAdmissionRecord {
  readonly resource: string; revision: number; enabled: boolean; expiresAt: number;
  clientType: "public"; clientIds: readonly string[]; scopes: readonly string[];
}
export interface OAuthWorkspaceAdmissionRecord extends Omit<OAuthPlatformAdmissionRecord, "clientType"> {
  readonly tenantId: string; readonly workspaceId: string;
}
/** Only original trusted consent writers create this immutable principal tuple.
 * consentRef is provenance, not proof that this module verified human consent. */
export interface PersistedOriginalOAuthGrant extends CurrentOAuthGrant {
  readonly userId: string; readonly tenantId: string; readonly workspaceId: string;
  enabled: boolean; clientRevision: number; platformRevision: number; workspaceRevision: number;
  consentRef: string; consentRevision: number;
}
export interface OriginalOAuthGrantIdentity<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original Auth/account/workspace check, not a synthetic permit. The callback
   * re-reads this exact grant binding; do not cache it or use another transaction.
   * Original business Guard, field policy and goal accounting still run separately. */
  assertCurrent(transaction: Native, current: () => Promise<OriginalOAuthPrincipalBinding | undefined>, signal: AbortSignal): Promise<boolean>;
}
export interface PrismaOAuthGrantAuthority {
  issuance: OriginalOAuthGrantAuthority;
  access: OriginalOAuthAccessAuthority;
  /** Internal binding only: grantId comes from original token/code persistence,
   * never a model argument. No business tool or protocol result exposes this. */
  principal(grantId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal): Promise<OriginalOAuthPrincipalBinding | undefined>;
}
export interface OAuthGrantAuthorityConfig { enabled: boolean; resourceUrl: string; allowedScopes: readonly string[] }

const unavailable = () => new Error("Current OAuth grant unavailable");
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,200}$/.test(value);
const originalId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const live = (signal: AbortSignal) => { if (signal.aborted) throw unavailable(); };
const grantFields = ["id", "subject", "revision", "clientId", "resource", "scopes", "expiresAt", "enabled", "userId", "tenantId", "workspaceId", "clientRevision", "platformRevision", "workspaceRevision", "consentRef", "consentRevision"];
const policyFields = ["resource", "revision", "enabled", "expiresAt", "clientIds", "scopes"];
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > 65_536) throw unavailable();
    value = JSON.parse(value);
  }
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 50 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== fields.length
    || fields.some(field => !Object.hasOwn(copy, field)) || Buffer.byteLength(JSON.stringify(copy), "utf8") > 65_536) throw unavailable();
  return copy as Record<string, unknown>;
}
function rowEntry(rows: unknown): unknown {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw unavailable();
  if (!rows.length) return undefined;
  const row = Object.getOwnPropertyDescriptor(rows, "0");
  if (!row?.enumerable || !Object.hasOwn(row, "value") || !row.value || typeof row.value !== "object") throw unavailable();
  return row.value;
}
function selected(rows: unknown, fields: readonly string[]) {
  const row = rowEntry(rows);
  return row === undefined ? undefined : snapshotJsonFields(row, fields, { stringCharacters: 65_536, arrayItems: 50 });
}
function scopes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 32 && new Set(value).size === value.length
    && value.every(scope => typeof scope === "string" && scopeToken.test(scope));
}
/** Shared storage projection validation for current reads and trusted CAS writes.
 * This is not policy authorization or field release. */
export function captureOAuthAdmission(value: unknown, workspace: false): OAuthPlatformAdmissionRecord;
export function captureOAuthAdmission(value: unknown, workspace: true): OAuthWorkspaceAdmissionRecord;
export function captureOAuthAdmission(value: unknown, workspace: boolean): OAuthPlatformAdmissionRecord | OAuthWorkspaceAdmissionRecord;
export function captureOAuthAdmission(value: unknown, workspace: boolean): OAuthPlatformAdmissionRecord | OAuthWorkspaceAdmissionRecord {
  const row = record(value, workspace ? [...policyFields, "tenantId", "workspaceId"] : [...policyFields, "clientType"]);
  if (typeof row.resource !== "string" || !positive(row.revision) || typeof row.enabled !== "boolean" || !positive(row.expiresAt)
    || !Array.isArray(row.scopes) || row.scopes.length > 32 || new Set(row.scopes).size !== row.scopes.length
    || !row.scopes.every(scope => typeof scope === "string" && scopeToken.test(scope))
    || !Array.isArray(row.clientIds) || row.clientIds.length > 50
    || new Set(row.clientIds).size !== row.clientIds.length || !row.clientIds.every(identifier)
    || (workspace ? !originalId(row.tenantId) || !originalId(row.workspaceId) : row.clientType !== "public")) throw unavailable();
  return row as unknown as OAuthPlatformAdmissionRecord | OAuthWorkspaceAdmissionRecord;
}

/** Single original grant projection capture for reads and revoke-only CAS.
 * Immutable identity/consent fields are preserved; this does not grant authority. */
export function capturePersistedOAuthGrant(value: unknown): PersistedOriginalOAuthGrant {
  const g = record(value, grantFields);
  if (!identifier(g.id) || !identifier(g.subject) || !identifier(g.clientId) || !identifier(g.consentRef)
    || ![g.revision, g.clientRevision, g.platformRevision, g.workspaceRevision, g.consentRevision, g.expiresAt].every(positive)
    || ![g.userId, g.tenantId, g.workspaceId].every(originalId) || typeof g.enabled !== "boolean" || !scopes(g.scopes) || typeof g.resource !== "string") throw unavailable();
  const url = new URL(g.resource);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href !== g.resource || g.resource.length > 2048) throw unavailable();
  return Object.freeze({ ...g, scopes: Object.freeze([...g.scopes]) }) as unknown as PersistedOriginalOAuthGrant;
}

export function createPrismaOAuthGrantAuthority<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: OAuthGrantAuthorityConfig, store: PrismaOAuthStore<Native>,
  registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">, identity: OriginalOAuthGrantIdentity<Native>): PrismaOAuthGrantAuthority {
  const url = new URL(config.resourceUrl), resource = url.href, allowed = new Set(config.allowedScopes), enabled = config.enabled;
  if (typeof enabled !== "boolean" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || resource !== config.resourceUrl || resource.length > 2048 || !scopes(config.allowedScopes)
    || typeof store?.native !== "function" || typeof registrations?.readIn !== "function" || typeof identity?.assertCurrent !== "function") throw unavailable();
  const native = store.native.bind(store), registered = registrations.readIn.bind(registrations), assertIdentity = identity.assertCurrent.bind(identity);
  const grantRow = async (tx: Native, grantId: string, signal: AbortSignal) => {
    live(signal); if (!identifier(grantId)) throw unavailable();
    const rows = await tx.$queryRaw<unknown[]>`SELECT id, subject, userId, clientId, resource, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE id = ${grantId} FOR UPDATE`;
    live(signal); return selected(rows, ["id", "subject", "userId", "clientId", "resource", "tenantId", "workspaceId", "recordJson"]);
  };
  const observe = async (tx: Native, grantId: string, signal: AbortSignal) => {
    const selectedGrant = await grantRow(tx, grantId, signal); if (!selectedGrant) throw unavailable();
    const grant = capturePersistedOAuthGrant(selectedGrant.recordJson);
    if (grant.id !== grantId || selectedGrant.id !== grantId || grant.subject !== selectedGrant.subject || grant.userId !== selectedGrant.userId
      || grant.clientId !== selectedGrant.clientId || grant.resource !== selectedGrant.resource
      || grant.tenantId !== selectedGrant.tenantId || grant.workspaceId !== selectedGrant.workspaceId) throw unavailable();
    if (!enabled || !grant.enabled || grant.resource !== resource || grant.expiresAt <= Date.now() / 1000) return undefined;
    const platformRows = await tx.$queryRaw<unknown[]>`SELECT resource, revision, recordJson FROM mcp_oauth_platform_admissions WHERE resource = ${resource} FOR UPDATE`;
    live(signal); const platformRow = selected(platformRows, ["resource", "revision", "recordJson"]);
    const workspaceRows = await tx.$queryRaw<unknown[]>`SELECT resource, tenantId, workspaceId, revision, recordJson FROM mcp_oauth_workspace_admissions
      WHERE resource = ${resource} AND tenantId = ${grant.tenantId} AND workspaceId = ${grant.workspaceId} FOR UPDATE`;
    live(signal); const workspaceRow = selected(workspaceRows, ["resource", "tenantId", "workspaceId", "revision", "recordJson"]);
    const rawClient = await registered(tx, grant.clientId, signal); live(signal);
    const client = rawClient === undefined ? undefined : record(rawClient, ["clientId", "revision", "enabled", "expiresAt", "redirectUris", "scopes"]) as unknown as RegisteredPublicClient;
    if (client && (client.clientId !== grant.clientId || !positive(client.revision) || !positive(client.expiresAt)
      || typeof client.enabled !== "boolean" || !scopes(client.scopes) || !Array.isArray(client.redirectUris)
      || client.redirectUris.length < 1 || client.redirectUris.length > 20 || !client.redirectUris.every(uri => typeof uri === "string"))) throw unavailable();
    // An existing grant with missing linked records has unavailable evidence,
    // not confirmed revocation. Missing tables/provider failures also throw.
    if (!platformRow || !workspaceRow || !client) throw unavailable();
    const platform = captureOAuthAdmission(platformRow.recordJson, false), workspace = captureOAuthAdmission(workspaceRow.recordJson, true);
    if (platform.resource !== resource || platformRow.resource !== resource || platform.revision !== platformRow.revision
      || workspace.resource !== resource || workspaceRow.resource !== resource || workspace.revision !== workspaceRow.revision
      || workspace.tenantId !== grant.tenantId || workspaceRow.tenantId !== grant.tenantId
      || workspace.workspaceId !== grant.workspaceId || workspaceRow.workspaceId !== grant.workspaceId) throw unavailable();
    if (!platform.enabled || !workspace.enabled || !client.enabled || client.revision !== grant.clientRevision
      || platform.revision !== grant.platformRevision || workspace.revision !== grant.workspaceRevision
      || !(platform.clientIds as string[]).includes(grant.clientId) || !(workspace.clientIds as string[]).includes(grant.clientId)
      || grant.scopes.some(scope => !allowed.has(scope) || !client.scopes.includes(scope)
        || !(platform.scopes as string[]).includes(scope) || !(workspace.scopes as string[]).includes(scope))) return undefined;
    const expiresAt = Math.min(grant.expiresAt, client.expiresAt, platform.expiresAt as number, workspace.expiresAt as number);
    if (expiresAt <= Date.now() / 1000) return undefined;
    const principal: OriginalOAuthPrincipalBinding = { userId: grant.userId, tenantId: grant.tenantId, workspaceId: grant.workspaceId, audience: "operator" };
    const current: CurrentOAuthGrant = { id: grantId, subject: grant.subject, revision: grant.revision as number,
      clientId: grant.clientId, resource, scopes: [...grant.scopes], expiresAt };
    return { current, principal, grant, platform, workspace, client };
  };
  const current = async (grantId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal) => {
    const tx = native(transaction); live(signal);
    const before = await observe(tx, grantId, signal); if (!before) return undefined;
    const binding = async () => {
      const value = await observe(tx, grantId, signal); if (!value) return undefined;
      if (!isDeepStrictEqual(value, before)) throw unavailable(); return Object.freeze({ ...value.principal });
    };
    const accepted = await assertIdentity(tx, binding, signal); live(signal);
    if (accepted !== true) { if (accepted !== false) throw unavailable(); return undefined; }
    const after = await observe(tx, grantId, signal); live(signal);
    if (!after) return undefined;
    if (!isDeepStrictEqual(after, before)) throw unavailable();
    return after;
  };
  return Object.freeze({
    issuance: Object.freeze({
      async current(grantId: string, clientId: string, clientRevision: number, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal) {
        const value = await current(grantId, transaction, signal);
        if (!value || value.current.clientId !== clientId || value.client.revision !== clientRevision) return undefined;
        return value.current;
      },
      async revocationOwner(grantId: string, clientId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal) {
        const tx = native(transaction); live(signal); if (!identifier(grantId)) throw unavailable();
        const rows = await tx.$queryRaw<unknown[]>`SELECT id, clientId, resource, recordJson FROM mcp_oauth_grants WHERE id = ${grantId} FOR UPDATE`;
        live(signal); const original = rowEntry(rows); if (original === undefined) throw unavailable();
        const row = snapshotJsonFields(original, ["id", "clientId", "resource"], { stringCharacters: 2048, arrayItems: 50 });
        const data = Object.getOwnPropertyDescriptor(original, "recordJson");
        if (!data?.enumerable || !Object.hasOwn(data, "value")) throw unavailable();
        // Ownership survives issuance disable/revision/expiry. Do not read broken
        // scopes/consent/policy as a new permit or prevent known-token revocation.
        let value = data.value;
        if (typeof value === "string") { if (Buffer.byteLength(value, "utf8") > 65_536) throw unavailable(); value = JSON.parse(value); }
        const owner = snapshotJsonFields(value, ["id", "clientId", "resource"], { stringCharacters: 2048, arrayItems: 50 });
        if (owner.id !== grantId || row.id !== grantId || owner.clientId !== row.clientId || owner.resource !== row.resource
          || !identifier(owner.clientId) || typeof owner.resource !== "string") throw unavailable();
        return owner.clientId === clientId && owner.resource === resource;
      },
    }),
    access: Object.freeze({ async current(grantId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal) {
      return (await current(grantId, transaction, signal))?.current;
    } }),
    async principal(grantId: string, transaction: PersistentOAuthTokenTransaction, signal: AbortSignal) {
      const value = await current(grantId, transaction, signal); return value ? Object.freeze({ ...value.principal }) : undefined;
    },
  });
}
