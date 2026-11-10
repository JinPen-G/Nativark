/** Current approved notice/verification projections, CAS and original receipts.
 * Not review approval, MFA, role administration, grant revocation or public HTTP.
 * Native original current management and atomic audit are required; no defaults,
 * retry, history deletion or use of policy metadata as business authorization. */
import { createHash } from "node:crypto";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import { captureOAuthConsentPolicy } from "./prisma-oauth-consent-review.js";
import type { OAuthPlatformConsentReview, OAuthWorkspaceConsentReview } from "./prisma-oauth-consent-review.js";
import type { OAuthAdmissionTarget, OriginalAdmissionManager } from "./prisma-oauth-admission-store.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
export type OAuthConsentPolicy = OAuthPlatformConsentReview | OAuthWorkspaceConsentReview;
export interface OAuthConsentPolicyReceipt { state: "saved"; operationKey: string; target: OAuthAdmissionTarget; policy: OAuthConsentPolicy }
export interface OAuthConsentPolicySave { operationKey: string; expectedRevision: number; target: OAuthAdmissionTarget; policy: OAuthConsentPolicy }
export interface ApprovedOAuthConsentPolicy { reference: string; revision: number; expiresAt: number; target: OAuthAdmissionTarget; policy: OAuthConsentPolicy }
export interface OriginalOAuthConsentPolicyReviewSource<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Independent ORIGINAL completed review, held current in this transaction.
   * Never echo the submitted candidate/ref/hash or manufacture an exemption. */
  current(transaction: Native, target: OAuthAdmissionTarget, signal: AbortSignal): Promise<ApprovedOAuthConsentPolicy | undefined>;
}
export interface OriginalOAuthConsentPolicyManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  authorize(transaction: Native, request: { action: "read" | "save" | "read_receipt"; target: OAuthAdmissionTarget; policy?: OAuthConsentPolicy }, signal: AbortSignal): Promise<OriginalAdmissionManager | undefined>;
  audit(transaction: Native, receipt: { actorId: string; target: OAuthAdmissionTarget; operationKey: string; resource: string; revision: number }, signal: AbortSignal): Promise<void>;
}
export interface PrismaOAuthConsentPolicyStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  readIn(transaction: Native, target: OAuthAdmissionTarget, signal: AbortSignal): Promise<OAuthConsentPolicy | undefined>;
  read(target: OAuthAdmissionTarget, signal: AbortSignal): Promise<{ state: "not_configured" } | { state: "configured"; policy: OAuthConsentPolicy }>;
  save(input: OAuthConsentPolicySave, signal: AbortSignal): Promise<OAuthConsentPolicyReceipt>;
  operation(target: OAuthAdmissionTarget, operationKey: string, signal: AbortSignal): Promise<{ state: "observed"; result: OAuthConsentPolicyReceipt } | { state: "not_observed"; retryable: false }>;
}
export class OAuthConsentPolicyStoreError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") { super(`OAuth consent policy ${kind}`); this.name = "OAuthConsentPolicyStoreError"; }
}
const fail = (kind: OAuthConsentPolicyStoreError["kind"]) => new OAuthConsentPolicyStoreError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function fields(value: unknown, names: readonly string[]) {
  const v = snapshotJson(value, { stringCharacters: 2048, arrayItems: 10 });
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) throw fail("invalid");
  return v as Record<string, unknown>;
}
export function captureOAuthConsentPolicyTarget(value: unknown): OAuthAdmissionTarget {
  const head = snapshotJsonFields(value, ["kind"], { stringCharacters: 2048, arrayItems: 10 }), v = fields(value, head.kind === "platform" ? ["kind"] : ["kind", "tenantId", "workspaceId"]);
  if (v.kind === "platform") return Object.freeze({ kind: "platform" });
  if (v.kind !== "workspace" || !id(v.tenantId) || !id(v.workspaceId)) throw fail("invalid");
  return Object.freeze({ kind: "workspace", tenantId: v.tenantId, workspaceId: v.workspaceId });
}
function selected(rows: unknown, names: readonly string[]) {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
  if (!rows.length) return undefined; const row = Object.getOwnPropertyDescriptor(rows, "0");
  if (!row?.enumerable || !Object.hasOwn(row, "value")) throw fail("unavailable");
  return snapshotJsonFields(row.value, names, { stringCharacters: 65_536, arrayItems: 10 });
}
function parsed(v: unknown) { if (typeof v !== "string") return v; if (Buffer.byteLength(v, "utf8") > 65_536) throw fail("unavailable"); return JSON.parse(v); }
const hash = (receipt: OAuthConsentPolicyReceipt) => createHash("sha256").update(JSON.stringify({ operationKey: receipt.operationKey, expectedRevision: receipt.policy.revision - 1, target: receipt.target, policy: receipt.policy })).digest("hex");
export function captureOAuthConsentPolicyReceipt(raw: unknown, payloadHash: string): OAuthConsentPolicyReceipt {
  const v = fields(parsed(raw), ["state", "operationKey", "target", "policy"]), scope = captureOAuthConsentPolicyTarget(v.target), policy = captureOAuthConsentPolicy(v.policy, scope.kind === "workspace");
  if (v.state !== "saved" || !key(v.operationKey) || scope.kind === "workspace" && ((policy as OAuthWorkspaceConsentReview).tenantId !== scope.tenantId || (policy as OAuthWorkspaceConsentReview).workspaceId !== scope.workspaceId)) throw fail("unavailable");
  const receipt = Object.freeze({ state: "saved" as const, operationKey: v.operationKey, target: scope, policy }); if (payloadHash !== hash(receipt)) throw fail("unavailable"); return receipt;
}
function policyResource(value: string): string {
  const url = new URL(value), resource = url.href;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || resource !== value || resource.length > 2048) throw fail("invalid"); return resource;
}
/** Native-only original projection read, reused by review/service owners. No
 * transaction, manager, approval or default policy is created by this reader. */
export function createPrismaOAuthConsentPolicyReader<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }
): Pick<PrismaOAuthConsentPolicyStore<Native>, "readIn"> {
  const resource = policyResource(config.resourceUrl);
  return Object.freeze({ async readIn(tx: Native, raw: OAuthAdmissionTarget, signal: AbortSignal): Promise<OAuthConsentPolicy | undefined> {
    const scope = captureOAuthConsentPolicyTarget(raw);
    try {
      live(signal); const rows = scope.kind === "platform"
        ? await tx.$queryRaw<unknown[]>`SELECT resource, revision, recordJson FROM mcp_oauth_consent_reviews WHERE resource = ${resource} FOR UPDATE`
        : await tx.$queryRaw<unknown[]>`SELECT resource, tenantId, workspaceId, revision, recordJson FROM mcp_oauth_workspace_reviews WHERE resource = ${resource} AND tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} FOR UPDATE`;
      live(signal); const row = selected(rows, scope.kind === "platform" ? ["resource", "revision", "recordJson"] : ["resource", "tenantId", "workspaceId", "revision", "recordJson"]); if (!row) return undefined;
      const policy = captureOAuthConsentPolicy(row.recordJson, scope.kind === "workspace");
      if (row.resource !== resource || policy.resource !== resource || row.revision !== policy.revision || scope.kind === "workspace"
        && (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || (policy as OAuthWorkspaceConsentReview).tenantId !== scope.tenantId || (policy as OAuthWorkspaceConsentReview).workspaceId !== scope.workspaceId)) throw fail("unavailable");
      return policy;
    } catch { throw fail("unavailable"); }
  } });
}

export function createPrismaOAuthConsentPolicyStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  config: { resourceUrl: string }, database: OAuthSqlDatabase<Native>, management: OriginalOAuthConsentPolicyManagement<Native>
): PrismaOAuthConsentPolicyStore<Native> {
  const resource = policyResource(config.resourceUrl);
  if (typeof database?.$transaction !== "function" || typeof management?.authorize !== "function" || typeof management.audit !== "function") throw fail("unavailable");
  const transaction = database.$transaction.bind(database), authorize = management.authorize.bind(management), audit = management.audit.bind(management);
  const run = async <T>(consume: (tx: Native) => Promise<T>, signal: AbortSignal) => {
    live(signal); let entered = false; const result = await transaction(async tx => { if (entered) throw fail("unavailable"); entered = true; live(signal); const value = await consume(tx); live(signal); return value; }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 }); live(signal); return result;
  };
  const manager = async (tx: Native, action: "read" | "save" | "read_receipt", scope: OAuthAdmissionTarget, signal: AbortSignal, policy?: OAuthConsentPolicy) => {
    live(signal); const raw = await authorize(tx, { action, target: scope, ...(policy ? { policy } : {}) }, signal); live(signal); if (!raw) throw fail("denied");
    const v = fields(raw, scope.kind === "platform" ? ["actorId", "kind"] : ["actorId", "kind", "tenantId", "workspaceId"]);
    if (!id(v.actorId) || v.kind !== scope.kind || scope.kind === "workspace" && (v.tenantId !== scope.tenantId || v.workspaceId !== scope.workspaceId)) throw fail("denied");
    return JSON.stringify(scope.kind === "platform" ? { actorId: v.actorId, kind: "platform" } : { actorId: v.actorId, ...scope });
  };
  const originalReader = createPrismaOAuthConsentPolicyReader<Native>({ resourceUrl: resource });
  const readIn = originalReader.readIn.bind(originalReader);
  const operationRow = async (tx: Native, operationKey: string, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<unknown[]>`SELECT actorId, targetKind, resource, tenantId, workspaceId, payloadHash, resultJson FROM mcp_oauth_consent_policy_operations WHERE operationKey = ${operationKey} FOR UPDATE`;
    live(signal); return selected(rows, ["actorId", "targetKind", "resource", "tenantId", "workspaceId", "payloadHash", "resultJson"]);
  };
  const stored = (row: Record<string, unknown>, scope: OAuthAdmissionTarget, operationKey: string) => {
    if (!id(row.actorId) || typeof row.payloadHash !== "string") throw fail("unavailable"); const receipt = captureOAuthConsentPolicyReceipt(row.resultJson, row.payloadHash);
    if (receipt.operationKey !== operationKey || JSON.stringify(receipt.target) !== JSON.stringify(scope) || row.targetKind !== scope.kind || row.resource !== resource || receipt.policy.resource !== resource
      || row.tenantId !== (scope.kind === "workspace" ? scope.tenantId : null) || row.workspaceId !== (scope.kind === "workspace" ? scope.workspaceId : null)) throw fail("unavailable"); return receipt;
  };
  return Object.freeze({
    async readIn(tx: Native, raw: OAuthAdmissionTarget, signal: AbortSignal) { const scope = captureOAuthConsentPolicyTarget(raw); try { return await readIn(tx, scope, signal); } catch { throw fail("unavailable"); } },
    async read(raw: OAuthAdmissionTarget, signal: AbortSignal) {
      const scope = captureOAuthConsentPolicyTarget(raw); try { return await run(async tx => { const who = await manager(tx, "read", scope, signal), policy = await readIn(tx, scope, signal);
        if (await manager(tx, "read", scope, signal) !== who) throw fail("denied"); return policy ? { state: "configured" as const, policy } : { state: "not_configured" as const }; }, signal);
      } catch (e) { if (e instanceof OAuthConsentPolicyStoreError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
    async save(raw: OAuthConsentPolicySave, signal: AbortSignal) {
      live(signal); let receipt: OAuthConsentPolicyReceipt, expected: number;
      try { const v = fields(raw, ["operationKey", "expectedRevision", "target", "policy"]), scope = captureOAuthConsentPolicyTarget(v.target), policy = captureOAuthConsentPolicy(v.policy, scope.kind === "workspace");
        if (!key(v.operationKey) || typeof v.expectedRevision !== "number" || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0 || v.expectedRevision >= 2_147_483_647 || policy.revision !== v.expectedRevision + 1 || policy.resource !== resource
          || scope.kind === "workspace" && ((policy as OAuthWorkspaceConsentReview).tenantId !== scope.tenantId || (policy as OAuthWorkspaceConsentReview).workspaceId !== scope.workspaceId)) throw fail("invalid");
        expected = v.expectedRevision; receipt = Object.freeze({ state: "saved", operationKey: v.operationKey, target: scope, policy });
      } catch { throw fail("invalid"); }
      const payloadHash = hash(receipt), scope = receipt.target;
      try { return await run(async tx => {
        const who = await manager(tx, "save", scope, signal, receipt.policy), actorId = (JSON.parse(who) as OriginalAdmissionManager).actorId;
        const previous = await readIn(tx, scope, signal), original = await operationRow(tx, receipt.operationKey, signal);
        const check = async () => { if (await manager(tx, "save", scope, signal, receipt.policy) !== who) throw fail("denied"); };
        if (original) { if (original.actorId !== actorId || original.payloadHash !== payloadHash) throw fail("conflict"); const saved = stored(original, scope, receipt.operationKey); await check(); return saved; }
        if ((previous?.revision ?? 0) !== expected) throw fail("conflict"); await check();
        const text = JSON.stringify(receipt.policy), changed = scope.kind === "platform" ? previous
          ? await tx.$executeRaw`UPDATE mcp_oauth_consent_reviews SET revision = ${receipt.policy.revision}, recordJson = ${text} WHERE resource = ${resource} AND revision = ${expected}`
          : await tx.$executeRaw`INSERT INTO mcp_oauth_consent_reviews (resource, revision, recordJson) VALUES (${resource}, ${receipt.policy.revision}, ${text})`
          : previous ? await tx.$executeRaw`UPDATE mcp_oauth_workspace_reviews SET revision = ${receipt.policy.revision}, recordJson = ${text} WHERE resource = ${resource} AND tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND revision = ${expected}`
          : await tx.$executeRaw`INSERT INTO mcp_oauth_workspace_reviews (resource, tenantId, workspaceId, revision, recordJson) VALUES (${resource}, ${scope.tenantId}, ${scope.workspaceId}, ${receipt.policy.revision}, ${text})`;
        live(signal); if (changed !== 1) throw fail("conflict");
        const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_consent_policy_operations (operationKey, actorId, targetKind, resource, tenantId, workspaceId, payloadHash, resultJson)
          VALUES (${receipt.operationKey}, ${actorId}, ${scope.kind}, ${resource}, ${scope.kind === "workspace" ? scope.tenantId : null}, ${scope.kind === "workspace" ? scope.workspaceId : null}, ${payloadHash}, ${JSON.stringify(receipt)})`;
        live(signal); if (inserted !== 1) throw fail("unavailable"); await audit(tx, { actorId, target: scope, operationKey: receipt.operationKey, resource, revision: receipt.policy.revision }, signal); live(signal); await check();
        if (JSON.stringify(await readIn(tx, scope, signal)) !== JSON.stringify(receipt.policy)) throw fail("unavailable");
        const saved = await operationRow(tx, receipt.operationKey, signal); if (!saved || saved.actorId !== actorId || JSON.stringify(stored(saved, scope, receipt.operationKey)) !== JSON.stringify(receipt)) throw fail("unavailable"); return receipt;
      }, signal); } catch (e) { if (e instanceof OAuthConsentPolicyStoreError && ["denied", "conflict"].includes(e.kind)) throw e; throw fail("unknown"); }
    },
    async operation(raw: OAuthAdmissionTarget, operationKey: string, signal: AbortSignal) {
      const scope = captureOAuthConsentPolicyTarget(raw); if (!key(operationKey)) throw fail("invalid");
      try { return await run(async tx => { const who = await manager(tx, "read_receipt", scope, signal), row = await operationRow(tx, operationKey, signal);
        if (await manager(tx, "read_receipt", scope, signal) !== who) throw fail("denied"); if (!row) return { state: "not_observed" as const, retryable: false as const };
        if (row.actorId !== (JSON.parse(who) as OriginalAdmissionManager).actorId) throw fail("denied"); return { state: "observed" as const, result: stored(row, scope, operationKey) }; }, signal);
      } catch (e) { if (e instanceof OAuthConsentPolicyStoreError && e.kind === "denied") throw e; throw fail("unavailable"); }
    },
  });
}
