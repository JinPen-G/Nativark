/** Original management CAS for minimal MCP admission projections.
 * Current original scope authorization and atomic audit are required; no role
 * store, anonymous admin, model tool, grant/consent creation or transaction retry. */
import { createHash } from "node:crypto";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOAuthAdmission } from "./prisma-oauth-grant-authority.js";
import type { OAuthPlatformAdmissionRecord, OAuthWorkspaceAdmissionRecord } from "./prisma-oauth-grant-authority.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";

export type OAuthAdmissionTarget = { kind: "platform" } | { kind: "workspace"; tenantId: string; workspaceId: string };
export type OAuthAdmissionRecord = OAuthPlatformAdmissionRecord | OAuthWorkspaceAdmissionRecord;
export type OAuthAdmissionSave = { operationKey: string; expectedRevision: number } & (
  { target: { kind: "platform" }; policy: Omit<OAuthPlatformAdmissionRecord, "resource" | "revision"> }
  | { target: { kind: "workspace"; tenantId: string; workspaceId: string }; policy: Omit<OAuthWorkspaceAdmissionRecord, "resource" | "revision" | "tenantId" | "workspaceId"> }
);
export interface OAuthAdmissionReceipt { state: "saved"; operationKey: string; target: OAuthAdmissionTarget; policy: OAuthAdmissionRecord }
export type OriginalAdmissionManager = { actorId: string; kind: "platform" } | { actorId: string; kind: "workspace"; tenantId: string; workspaceId: string };
export interface OriginalOAuthAdmissionManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original Auth/Guard-derived CURRENT scope, never a caller/model claim.
   * Platform authority is not tenant business authority. The original author must
   * enforce registered management rights and lock current fences until commit. */
  authorize(transaction: Native, request: { action: "read" | "save" | "read_receipt"; target: OAuthAdmissionTarget; policy?: OAuthAdmissionRecord }, signal: AbortSignal): Promise<OriginalAdmissionManager | undefined>;
  /** Original audit in the SAME transaction as projection and original receipt. */
  audit(transaction: Native, receipt: { actorId: string; operationKey: string; target: OAuthAdmissionTarget; resource: string; revision: number }, signal: AbortSignal): Promise<void>;
}
export interface PrismaOAuthAdmissionStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  readIn(transaction: Native, target: OAuthAdmissionTarget, signal: AbortSignal): Promise<OAuthAdmissionRecord | undefined>;
  read(target: OAuthAdmissionTarget, signal: AbortSignal): Promise<{ state: "not_configured" } | { state: "configured"; policy: OAuthAdmissionRecord }>;
  save(input: OAuthAdmissionSave, signal: AbortSignal): Promise<OAuthAdmissionReceipt>;
  operation(target: OAuthAdmissionTarget, operationKey: string, signal: AbortSignal): Promise<{ state: "observed"; result: OAuthAdmissionReceipt } | { state: "not_observed"; retryable: false }>;
}
export class OAuthAdmissionStoreError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth admission ${kind}`); this.name = "OAuthAdmissionStoreError"; }
}
const fail = (kind: OAuthAdmissionStoreError["kind"]) => new OAuthAdmissionStoreError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(value);
const key = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
function ordinary(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const row = snapshotJson(value, { stringCharacters: 2048, arrayItems: 50 });
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || Buffer.byteLength(JSON.stringify(row), "utf8") > 65_536) throw fail("invalid");
  return row as Record<string, unknown>;
}
function target(value: unknown): OAuthAdmissionTarget {
  const head = snapshotJsonFields(value, ["kind"], { stringCharacters: 2048, arrayItems: 50 });
  const row = ordinary(value, head.kind === "platform" ? ["kind"] : ["kind", "tenantId", "workspaceId"]);
  if (row.kind === "platform") return Object.freeze({ kind: "platform" });
  if (row.kind !== "workspace" || !id(row.tenantId) || !id(row.workspaceId)) throw fail("invalid");
  return Object.freeze({ kind: "workspace", tenantId: row.tenantId, workspaceId: row.workspaceId });
}
/** Same closed target capture for trusted Web transport and original store. */
export { target as captureOAuthAdmissionTarget };
function selected(rows: unknown, fields: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
  if (!rows.length) return undefined;
  const row = Object.getOwnPropertyDescriptor(rows, "0"); if (!row?.enumerable || !Object.hasOwn(row, "value")) throw fail("unavailable");
  return snapshotJsonFields(row.value, fields, { stringCharacters: 65_536, arrayItems: 50 });
}
function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value, "utf8") > 65_536) throw fail("unavailable"); return JSON.parse(value);
}
function canonical(policy: OAuthAdmissionRecord, scope: OAuthAdmissionTarget): OAuthAdmissionRecord {
  const common = { resource: policy.resource, revision: policy.revision, enabled: policy.enabled, expiresAt: policy.expiresAt,
    clientIds: Object.freeze([...policy.clientIds]), scopes: Object.freeze([...policy.scopes]) };
  const workspace = policy as OAuthWorkspaceAdmissionRecord;
  return Object.freeze(scope.kind === "platform" ? { ...common, clientType: "public" as const } : { ...common, tenantId: workspace.tenantId, workspaceId: workspace.workspaceId });
}
function commandHash(receipt: OAuthAdmissionReceipt) {
  return createHash("sha256").update(JSON.stringify({ operationKey: receipt.operationKey, expectedRevision: receipt.policy.revision - 1,
    target: receipt.target, policy: receipt.policy })).digest("hex");
}
type OperationRow = { actorId: string; targetKind: string; resource: string; tenantId: string | null; workspaceId: string | null; payloadHash: string; resultJson: unknown };

function admissionResource(value: string): string {
  try { const url = new URL(value), resource = url.href;
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== value || resource.length > 2048) throw fail("invalid"); return resource;
  } catch { throw fail("invalid"); }
}
/** Original AS native read only. No fake Web manager/audit is needed just to read
 * an admission in the already-owned grant/consent transaction. Caller owns current
 * authentication/identity/policy fences; this never authorizes or opens a tx. */
export function createPrismaOAuthAdmissionReader<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }
): Pick<PrismaOAuthAdmissionStore<Native>, "readIn"> {
  const resource = admissionResource(config.resourceUrl);
  return Object.freeze({ async readIn(tx: Native, raw: OAuthAdmissionTarget, signal: AbortSignal): Promise<OAuthAdmissionRecord | undefined> {
    const scope = target(raw);
    try {
      live(signal);
      const rows = scope.kind === "platform" ? await tx.$queryRaw<unknown[]>`SELECT resource, revision, recordJson FROM mcp_oauth_platform_admissions WHERE resource = ${resource} FOR UPDATE`
        : await tx.$queryRaw<unknown[]>`SELECT resource, tenantId, workspaceId, revision, recordJson FROM mcp_oauth_workspace_admissions WHERE resource = ${resource} AND tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} FOR UPDATE`;
      live(signal); const row = selected(rows, scope.kind === "platform" ? ["resource", "revision", "recordJson"] : ["resource", "tenantId", "workspaceId", "revision", "recordJson"]); if (!row) return undefined;
      const policy = canonical(captureOAuthAdmission(parsed(row.recordJson), scope.kind === "workspace"), scope);
      if (row.resource !== resource || policy.resource !== resource || row.revision !== policy.revision
        || scope.kind === "workspace" && (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
          || (policy as OAuthWorkspaceAdmissionRecord).tenantId !== scope.tenantId || (policy as OAuthWorkspaceAdmissionRecord).workspaceId !== scope.workspaceId)) throw fail("unavailable");
      return policy;
    } catch { throw fail("unavailable"); }
  } });
}

export function createPrismaOAuthAdmissionStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string; allowedScopes: readonly string[] }, database: OAuthSqlDatabase<Native>,
  registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">, management: OriginalOAuthAdmissionManagement<Native>): PrismaOAuthAdmissionStore<Native> {
  const resource = admissionResource(config.resourceUrl);
  const allowed = new Set(config.allowedScopes);
  if (allowed.size < 1 || allowed.size > 32 || allowed.size !== config.allowedScopes.length || [...allowed].some(scope => !/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(scope))
    || typeof database?.$transaction !== "function" || typeof registrations?.readIn !== "function" || typeof management?.authorize !== "function" || typeof management.audit !== "function") throw fail("unavailable");
  const transaction = database.$transaction.bind(database), authorize = management.authorize.bind(management), audit = management.audit.bind(management), registration = registrations.readIn.bind(registrations);
  const run = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal): Promise<T> => {
    live(signal); let entered = false;
    const result = await transaction(async tx => { if (entered) throw fail("unavailable"); entered = true; live(signal); const value = await consume(tx); live(signal); return value; },
      { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(signal); return result;
  };
  const manager = async (tx: Native, action: "read" | "save" | "read_receipt", scope: OAuthAdmissionTarget, signal: AbortSignal, policy?: OAuthAdmissionRecord) => {
    live(signal); const original = await authorize(tx, { action, target: scope, ...(policy ? { policy } : {}) }, signal); live(signal);
    if (!original) throw fail("denied");
    const head = snapshotJsonFields(original, ["kind"], { stringCharacters: 2048, arrayItems: 50 });
    const row = ordinary(original, head.kind === "platform" ? ["actorId", "kind"] : ["actorId", "kind", "tenantId", "workspaceId"]);
    if (!id(row.actorId) || row.kind !== scope.kind || scope.kind === "workspace" && (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId)) throw fail("denied");
    return JSON.stringify(scope.kind === "platform" ? { actorId: row.actorId, kind: "platform" }
      : { actorId: row.actorId, kind: "workspace", tenantId: row.tenantId, workspaceId: row.workspaceId });
  };
  const originalRead = createPrismaOAuthAdmissionReader<Native>({ resourceUrl: resource });
  const readIn = originalRead.readIn.bind(originalRead);
  const operationRow = async (tx: Native, operationKey: string, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, targetKind, resource, tenantId, workspaceId, payloadHash, resultJson FROM mcp_oauth_admission_operations WHERE operationKey = ${operationKey} FOR UPDATE`;
    live(signal); return selected(rows, ["actorId", "targetKind", "resource", "tenantId", "workspaceId", "payloadHash", "resultJson"]) as OperationRow | undefined;
  };
  const stored = (row: OperationRow, scope: OAuthAdmissionTarget, operationKey: string): OAuthAdmissionReceipt => {
    const value = ordinary(parsed(row.resultJson), ["state", "operationKey", "target", "policy"]), savedTarget = target(value.target);
    const policy = canonical(captureOAuthAdmission(value.policy, scope.kind === "workspace"), savedTarget);
    const receipt: OAuthAdmissionReceipt = { state: "saved", operationKey, target: savedTarget, policy };
    if (value.state !== "saved" || value.operationKey !== operationKey || JSON.stringify(savedTarget) !== JSON.stringify(scope)
      || row.targetKind !== scope.kind || row.resource !== resource || policy.resource !== resource
      || row.tenantId !== (scope.kind === "workspace" ? scope.tenantId : null) || row.workspaceId !== (scope.kind === "workspace" ? scope.workspaceId : null)
      || scope.kind === "workspace" && ((policy as OAuthWorkspaceAdmissionRecord).tenantId !== scope.tenantId || (policy as OAuthWorkspaceAdmissionRecord).workspaceId !== scope.workspaceId)
      || row.payloadHash !== commandHash(receipt)) throw fail("unavailable"); return receipt;
  };
  return Object.freeze({
    async readIn(tx: Native, raw: OAuthAdmissionTarget, signal: AbortSignal) {
      const scope = target(raw);
      try { return await readIn(tx, scope, signal); } catch { throw fail("unavailable"); }
    },
    async read(raw: OAuthAdmissionTarget, signal: AbortSignal) {
      const scope = target(raw);
      try { return await run(async tx => { const who = await manager(tx, "read", scope, signal); const policy = await readIn(tx, scope, signal);
        if (await manager(tx, "read", scope, signal) !== who) throw fail("denied"); return policy ? { state: "configured" as const, policy } : { state: "not_configured" as const }; }, signal);
      } catch (error) { if (error instanceof OAuthAdmissionStoreError && error.kind === "denied") throw error; throw fail("unavailable"); }
    },
    async save(input: OAuthAdmissionSave, signal: AbortSignal) {
      live(signal); let scope: OAuthAdmissionTarget, expectedRevision: number, receipt: OAuthAdmissionReceipt;
      try { const row = ordinary(input, ["operationKey", "expectedRevision", "target", "policy"]); scope = target(row.target);
        if (!key(row.operationKey) || typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 || row.expectedRevision >= 2_147_483_647) throw fail("invalid");
        expectedRevision = row.expectedRevision;
        const draft = ordinary(row.policy, scope.kind === "platform" ? ["enabled", "expiresAt", "clientType", "clientIds", "scopes"] : ["enabled", "expiresAt", "clientIds", "scopes"]);
        const policy = canonical(captureOAuthAdmission({ ...draft, resource, revision: expectedRevision + 1,
          ...(scope.kind === "workspace" ? { tenantId: scope.tenantId, workspaceId: scope.workspaceId } : {}) }, scope.kind === "workspace"), scope);
        if (policy.scopes.some(value => !allowed.has(value))) throw fail("invalid"); receipt = { state: "saved", operationKey: row.operationKey, target: scope, policy };
      } catch { throw fail("invalid"); }
      const hash = commandHash(receipt);
      try { return await run(async tx => {
        const who = await manager(tx, "save", scope, signal, receipt.policy), actorId = (JSON.parse(who) as OriginalAdmissionManager).actorId;
        const previous = await readIn(tx, scope, signal), original = await operationRow(tx, receipt.operationKey, signal);
        const check = async () => { if (await manager(tx, "save", scope, signal, receipt.policy) !== who) throw fail("denied"); };
        if (original) { if (original.actorId !== actorId || original.payloadHash !== hash) throw fail("conflict"); const saved = stored(original, scope, receipt.operationKey); await check(); return saved; }
        if ((previous?.revision ?? 0) !== expectedRevision) throw fail("conflict");
        for (const clientId of receipt.policy.clientIds) { const client = await registration(tx, clientId, signal); if (!client || client.clientId !== clientId) throw fail("denied"); live(signal); }
        await check(); const text = JSON.stringify(receipt.policy);
        const changed = scope.kind === "platform" ? previous
          ? await tx.$executeRaw`UPDATE mcp_oauth_platform_admissions SET revision = ${receipt.policy.revision}, recordJson = ${text} WHERE resource = ${resource} AND revision = ${expectedRevision}`
          : await tx.$executeRaw`INSERT INTO mcp_oauth_platform_admissions (resource, revision, recordJson) VALUES (${resource}, ${receipt.policy.revision}, ${text})`
          : previous ? await tx.$executeRaw`UPDATE mcp_oauth_workspace_admissions SET revision = ${receipt.policy.revision}, recordJson = ${text} WHERE resource = ${resource} AND tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND revision = ${expectedRevision}`
          : await tx.$executeRaw`INSERT INTO mcp_oauth_workspace_admissions (resource, tenantId, workspaceId, revision, recordJson) VALUES (${resource}, ${scope.tenantId}, ${scope.workspaceId}, ${receipt.policy.revision}, ${text})`;
        live(signal); if (changed !== 1) throw fail("conflict");
        const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_admission_operations (operationKey, actorId, targetKind, resource, tenantId, workspaceId, payloadHash, resultJson)
          VALUES (${receipt.operationKey}, ${actorId}, ${scope.kind}, ${resource}, ${scope.kind === "workspace" ? scope.tenantId : null}, ${scope.kind === "workspace" ? scope.workspaceId : null}, ${hash}, ${JSON.stringify(receipt)})`;
        live(signal); if (inserted !== 1) throw fail("unavailable"); await audit(tx, { actorId, operationKey: receipt.operationKey, target: scope, resource, revision: receipt.policy.revision }, signal); live(signal); await check(); return receipt;
      }, signal); } catch (error) { if (error instanceof OAuthAdmissionStoreError && ["denied", "conflict"].includes(error.kind)) throw error; throw fail("unknown"); }
    },
    async operation(raw: OAuthAdmissionTarget, operationKey: string, signal: AbortSignal) {
      const scope = target(raw); if (!key(operationKey)) throw fail("invalid");
      try { return await run(async tx => { const who = await manager(tx, "read_receipt", scope, signal), original = await operationRow(tx, operationKey, signal);
        if (await manager(tx, "read_receipt", scope, signal) !== who) throw fail("denied"); if (!original) return { state: "not_observed" as const, retryable: false as const };
        if (original.actorId !== (JSON.parse(who) as OriginalAdmissionManager).actorId) throw fail("denied"); return { state: "observed" as const, result: stored(original, scope, operationKey) }; }, signal);
      } catch (error) { if (error instanceof OAuthAdmissionStoreError && error.kind === "denied") throw error; throw fail("unavailable"); }
    },
  });
}
