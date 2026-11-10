/** Original tenant issuer-subject governance. Generates an opaque subject once,
 * then preserves it through CAS/disable/renewal. Not a user/role store, grant
 * revoker, public endpoint or business tool. Current original permission and
 * native atomic audit are mandatory; ambiguous commits only use original keys. */
import { createHash, randomUUID } from "node:crypto";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOAuthSubjectBinding } from "./prisma-oauth-consent-review.js";
import type { OriginalOAuthSubjectBinding } from "./prisma-oauth-consent-review.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";

export interface OAuthSubjectTarget { userId: string; tenantId: string }
export interface OAuthSubjectSave {
  operationKey: string; expectedRevision: number; target: OAuthSubjectTarget; enabled: boolean; expiresAt: number;
}
export interface OAuthSubjectReceipt { state: "saved"; operationKey: string; binding: OriginalOAuthSubjectBinding }
export interface OriginalOAuthSubjectManager { actorId: string; tenantId: string; userId: string; workspaceId: string }
export interface OriginalOAuthSubjectManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Original current tenant-wide integration rights and active original target;
   * target is not an actor claim. Workspace is the original manager's context,
   * not permission for the target or access to another space's business facts. */
  authorize(transaction: Native, request: { action: "read" | "save" | "read_receipt"; target: OAuthSubjectTarget }, signal: AbortSignal): Promise<OriginalOAuthSubjectManager | undefined>;
  audit(transaction: Native, input: { actorId: string; workspaceId: string; operationKey: string; target: OAuthSubjectTarget; resource: string; revision: number }, signal: AbortSignal): Promise<void>;
}
export interface PrismaOAuthSubjectStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Internal AS read only; caller owns original authentication/authorization. */
  readIn(transaction: Native, target: OAuthSubjectTarget, signal: AbortSignal): Promise<OriginalOAuthSubjectBinding | undefined>;
  read(target: OAuthSubjectTarget, signal: AbortSignal): Promise<{ state: "not_configured" } | { state: "configured"; binding: OriginalOAuthSubjectBinding }>;
  save(input: OAuthSubjectSave, signal: AbortSignal): Promise<OAuthSubjectReceipt>;
  operation(target: OAuthSubjectTarget, operationKey: string, signal: AbortSignal): Promise<{ state: "observed"; result: OAuthSubjectReceipt } | { state: "not_observed"; retryable: false }>;
}
export class OAuthSubjectStoreError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth subject ${kind}`); this.name = "OAuthSubjectStoreError"; }
}
const fail = (kind: OAuthSubjectStoreError["kind"]) => new OAuthSubjectStoreError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  const v = snapshotJson(value, { stringCharacters: 2048, arrayItems: 10 });
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) throw fail("invalid");
  return v as Record<string, unknown>;
}
function target(value: unknown): OAuthSubjectTarget {
  const v = fields(value, ["userId", "tenantId"]); if (!id(v.userId) || !id(v.tenantId)) throw fail("invalid");
  return Object.freeze({ userId: v.userId, tenantId: v.tenantId });
}
/** Original closed target capture reused by trusted Web consumers. */
export { target as captureOAuthSubjectTarget };
function selected(rows: unknown, names: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
  if (!rows.length) return undefined; const v = Object.getOwnPropertyDescriptor(rows, "0");
  if (!v?.enumerable || !Object.hasOwn(v, "value")) throw fail("unavailable");
  return snapshotJsonFields(v.value, names, { stringCharacters: 65_536, arrayItems: 10 });
}
function parsed(value: unknown) {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value, "utf8") > 65_536) throw fail("unavailable"); return JSON.parse(value);
}
function commandHash(resource: string, command: OAuthSubjectSave) {
  return createHash("sha256").update(JSON.stringify({ resource, operationKey: command.operationKey, expectedRevision: command.expectedRevision,
    target: command.target, enabled: command.enabled, expiresAt: command.expiresAt })).digest("hex");
}
/** Capture the immutable original receipt and hash, shared with its native auditor. */
export function captureOAuthSubjectReceipt(value: unknown, payloadHash: string): OAuthSubjectReceipt {
  const v = fields(parsed(value), ["state", "operationKey", "binding"]), binding = captureOAuthSubjectBinding(v.binding);
  if (v.state !== "saved" || !key(v.operationKey) || payloadHash !== commandHash(binding.resource, { operationKey: v.operationKey, expectedRevision: binding.revision - 1,
    target: target({ userId: binding.userId, tenantId: binding.tenantId }), enabled: binding.enabled, expiresAt: binding.expiresAt })) throw fail("unavailable");
  return Object.freeze({ state: "saved", operationKey: v.operationKey, binding });
}

export function createPrismaOAuthSubjectStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }, database: OAuthSqlDatabase<Native>, management: OriginalOAuthSubjectManagement<Native>
): PrismaOAuthSubjectStore<Native> {
  const url = new URL(config.resourceUrl), resource = url.href;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== config.resourceUrl || resource.length > 2048) throw fail("invalid");
  if (typeof database?.$transaction !== "function" || typeof management?.authorize !== "function" || typeof management.audit !== "function") throw fail("unavailable");
  const transaction = database.$transaction.bind(database), authorize = management.authorize.bind(management), audit = management.audit.bind(management);
  const run = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal): Promise<T> => {
    live(signal); let entered = false;
    const result = await transaction(async tx => { if (entered) throw fail("unavailable"); entered = true; live(signal); const result = await consume(tx); live(signal); return result; },
      { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(signal); return result;
  };
  const manager = async (tx: Native, action: "read" | "save" | "read_receipt", scope: OAuthSubjectTarget, signal: AbortSignal) => {
    live(signal); const raw = await authorize(tx, { action, target: scope }, signal); live(signal); if (!raw) throw fail("denied");
    const v = fields(raw, ["actorId", "tenantId", "userId", "workspaceId"]);
    if (!id(v.actorId) || !id(v.workspaceId) || v.tenantId !== scope.tenantId || v.userId !== scope.userId) throw fail("denied");
    return Object.freeze({ actorId: v.actorId, tenantId: scope.tenantId, userId: scope.userId, workspaceId: v.workspaceId });
  };
  const readIn = async (tx: Native, scope: OAuthSubjectTarget, signal: AbortSignal) => {
    live(signal); const rows = await tx.$queryRaw<unknown[]>`SELECT resource, userId, tenantId, subject, revision, recordJson FROM mcp_oauth_subject_bindings WHERE resource = ${resource} AND userId = ${scope.userId} AND tenantId = ${scope.tenantId} FOR UPDATE`;
    live(signal); const row = selected(rows, ["resource", "userId", "tenantId", "subject", "revision", "recordJson"]); if (!row) return undefined;
    const binding = captureOAuthSubjectBinding(row.recordJson);
    if (row.resource !== resource || binding.resource !== resource || row.userId !== scope.userId || binding.userId !== scope.userId
      || row.tenantId !== scope.tenantId || binding.tenantId !== scope.tenantId || row.subject !== binding.subject || row.revision !== binding.revision) throw fail("unavailable");
    return binding;
  };
  const operationRow = async (tx: Native, operationKey: string, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, workspaceId, resource, userId, tenantId, payloadHash, resultJson FROM mcp_oauth_subject_operations WHERE operationKey = ${operationKey} FOR UPDATE`;
    live(signal); return selected(rows, ["actorId", "workspaceId", "resource", "userId", "tenantId", "payloadHash", "resultJson"]);
  };
  const stored = (row: Record<string, unknown>, scope: OAuthSubjectTarget, operationKey: string) => {
    if (!id(row.actorId) || !id(row.workspaceId) || typeof row.payloadHash !== "string") throw fail("unavailable");
    const saved = captureOAuthSubjectReceipt(row.resultJson, row.payloadHash), b = saved.binding;
    if (saved.operationKey !== operationKey || row.resource !== resource || b.resource !== resource || row.userId !== scope.userId || b.userId !== scope.userId
      || row.tenantId !== scope.tenantId || b.tenantId !== scope.tenantId) throw fail("unavailable"); return saved;
  };
  return Object.freeze({
    async readIn(tx: Native, raw: OAuthSubjectTarget, signal: AbortSignal) {
      const scope = target(raw); try { return await readIn(tx, scope, signal); } catch { throw fail("unavailable"); }
    },
    async read(raw: OAuthSubjectTarget, signal: AbortSignal) {
      const scope = target(raw);
      try { return await run(async tx => { const who = await manager(tx, "read", scope, signal), binding = await readIn(tx, scope, signal);
        if (JSON.stringify(await manager(tx, "read", scope, signal)) !== JSON.stringify(who)) throw fail("denied");
        return binding ? { state: "configured" as const, binding } : { state: "not_configured" as const }; }, signal);
      } catch (e) { if (e instanceof OAuthSubjectStoreError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
    async save(raw: OAuthSubjectSave, signal: AbortSignal) {
      live(signal); let input: OAuthSubjectSave;
      try { const v = fields(raw, ["operationKey", "expectedRevision", "target", "enabled", "expiresAt"]);
        if (!key(v.operationKey) || typeof v.expectedRevision !== "number" || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0 || v.expectedRevision >= 2_147_483_647
          || typeof v.enabled !== "boolean" || typeof v.expiresAt !== "number" || !Number.isSafeInteger(v.expiresAt) || v.expiresAt < 1) throw fail("invalid");
        input = Object.freeze({ operationKey: v.operationKey, expectedRevision: v.expectedRevision, target: target(v.target), enabled: v.enabled, expiresAt: v.expiresAt });
      } catch { throw fail("invalid"); }
      const hash = commandHash(resource, input);
      try { return await run(async tx => {
        const who = await manager(tx, "save", input.target, signal), previous = await readIn(tx, input.target, signal), original = await operationRow(tx, input.operationKey, signal);
        const check = async () => { if (JSON.stringify(await manager(tx, "save", input.target, signal)) !== JSON.stringify(who)) throw fail("denied"); };
        if (original) { if (original.actorId !== who.actorId || original.workspaceId !== who.workspaceId || original.payloadHash !== hash) throw fail("conflict");
          const saved = stored(original, input.target, input.operationKey);
          if (!previous || previous.subject !== saved.binding.subject) throw fail("unavailable"); await check(); return saved; }
        if ((previous?.revision ?? 0) !== input.expectedRevision) throw fail("conflict");
        if (input.enabled && input.expiresAt <= Date.now() / 1000) throw fail("denied");
        // Creation is the only generation point, AFTER original-key observation.
        // No deletion/rebinding endpoint; updates cannot choose/rotate subject.
        const binding = captureOAuthSubjectBinding({ resource, ...input.target, subject: previous?.subject ?? randomUUID(), revision: input.expectedRevision + 1,
          enabled: input.enabled, expiresAt: input.expiresAt });
        const receipt = Object.freeze({ state: "saved" as const, operationKey: input.operationKey, binding }); await check();
        const text = JSON.stringify(binding), changed = previous
          ? await tx.$executeRaw`UPDATE mcp_oauth_subject_bindings SET revision = ${binding.revision}, recordJson = ${text} WHERE resource = ${resource} AND userId = ${input.target.userId} AND tenantId = ${input.target.tenantId} AND subject = ${previous.subject} AND revision = ${input.expectedRevision}`
          : await tx.$executeRaw`INSERT INTO mcp_oauth_subject_bindings (resource, userId, tenantId, subject, revision, recordJson) VALUES (${resource}, ${input.target.userId}, ${input.target.tenantId}, ${binding.subject}, ${binding.revision}, ${text})`;
        live(signal); if (changed !== 1) throw fail("conflict");
        const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_subject_operations (operationKey, actorId, workspaceId, resource, userId, tenantId, payloadHash, resultJson)
          VALUES (${input.operationKey}, ${who.actorId}, ${who.workspaceId}, ${resource}, ${input.target.userId}, ${input.target.tenantId}, ${hash}, ${JSON.stringify(receipt)})`;
        live(signal); if (inserted !== 1) throw fail("unavailable");
        await audit(tx, { actorId: who.actorId, workspaceId: who.workspaceId, operationKey: input.operationKey, target: input.target, resource, revision: binding.revision }, signal);
        live(signal); await check(); const after = await readIn(tx, input.target, signal);
        if (JSON.stringify(after) !== JSON.stringify(binding)) throw fail("unavailable");
        const saved = await operationRow(tx, input.operationKey, signal);
        if (!saved || saved.actorId !== who.actorId || saved.workspaceId !== who.workspaceId || JSON.stringify(stored(saved, input.target, input.operationKey)) !== JSON.stringify(receipt)) throw fail("unavailable");
        return receipt;
      }, signal); } catch (e) { if (e instanceof OAuthSubjectStoreError && ["denied", "conflict"].includes(e.kind)) throw e; throw fail("unknown"); }
    },
    async operation(raw: OAuthSubjectTarget, operationKey: string, signal: AbortSignal) {
      const scope = target(raw); if (!key(operationKey)) throw fail("invalid");
      try { return await run(async tx => { const who = await manager(tx, "read_receipt", scope, signal), current = await readIn(tx, scope, signal), row = await operationRow(tx, operationKey, signal);
        if (JSON.stringify(await manager(tx, "read_receipt", scope, signal)) !== JSON.stringify(who)) throw fail("denied");
        if (!row) return { state: "not_observed" as const, retryable: false as const };
        if (row.actorId !== who.actorId) throw fail("denied"); const result = stored(row, scope, operationKey);
        // Command hash cannot include a server-generated value unknown to callers.
        // Its immutable original issuer association supplies that integrity fence.
        if (!current || current.subject !== result.binding.subject) throw fail("unavailable");
        return { state: "observed" as const, result }; }, signal);
      } catch (e) { if (e instanceof OAuthSubjectStoreError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
  });
}
