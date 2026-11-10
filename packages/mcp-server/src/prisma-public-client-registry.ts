/** Current AS public-client projection and original management CAS receipts.
 * No anonymous/dynamic registration, client secret, role store or business grant.
 * Fixed SQL runs in the original transaction; management authority/audit are mandatory
 * for writes, Web managed reads and receipt reads. AS readers keep caller-owned
 * authorization; schema installation and original admin UI stay outside. */
import { createHash } from "node:crypto";
import { snapshotJson, snapshotJsonFields } from "./json-snapshot.js";
import type { RegisteredPublicClient, PublicClientRegistrations } from "./public-client-authorization.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";

export class PublicClientRegistryError extends Error {
  constructor(readonly kind: "invalid" | "denied" | "conflict" | "unavailable" | "unknown") {
    super(`Public client registry ${kind}`); this.name = "PublicClientRegistryError";
  }
}
export interface PublicClientRegistrationSave {
  operationKey: string;
  expectedRevision: number;
  registration: Omit<RegisteredPublicClient, "revision">;
}
export interface PublicClientRegistrationReceipt {
  state: "saved";
  operationKey: string;
  registration: RegisteredPublicClient;
}
export interface OriginalPublicClientManagement<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Current original platform-management authorization in this transaction.
   * Undefined confirms denial; unreadable evidence throws. Never trusts a model
   * actor or tenant-admin claim. Candidate scopes/callbacks must meet original policy. */
  authorize(transaction: Native, request: {
    action: "read" | "save" | "read_receipt"; clientId: string; registration?: RegisteredPublicClient;
  }, signal: AbortSignal): Promise<{ actorId: string } | undefined>;
  /** Original audit in the same commit as policy and operation receipt; no fallback. */
  audit(transaction: Native, receipt: {
    actorId: string; clientId: string; operationKey: string; revision: number;
  }, signal: AbortSignal): Promise<void>;
}
export interface PrismaPublicClientRegistry<Native extends OAuthSqlTransaction = OAuthSqlTransaction> extends PublicClientRegistrations {
  /** Use the original AS/grant transaction (e.g. store.native(tx)), not a second
   * transaction. The caller owns its live lifetime and current grant fences. */
  readIn(transaction: Native, clientId: string, signal: AbortSignal): Promise<RegisteredPublicClient | undefined>;
  /** Web management read requires original current platform rights. AS read/readIn
   * retain their internal caller-owned authorization contract; never expose them. */
  readManaged(clientId: string, signal: AbortSignal): Promise<{ state: "not_configured" } | { state: "configured"; registration: RegisteredPublicClient }>;
  save(input: PublicClientRegistrationSave, signal: AbortSignal): Promise<PublicClientRegistrationReceipt>;
  operation(clientId: string, operationKey: string, signal: AbortSignal): Promise<
    { state: "observed"; operationKey: string; result: PublicClientRegistrationReceipt }
    | { state: "not_observed"; retryable: false }>;
}
const fail = (kind: PublicClientRegistryError["kind"]) => new PublicClientRegistryError(kind);
const live = (signal: AbortSignal) => { if (signal.aborted) throw fail("unavailable"); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,200}$/.test(value);
const operationKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const revision = (value: unknown, zero = false): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= (zero ? 0 : 1) && value <= 2_147_483_647;
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
function ordinary(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const copy = snapshotJson(value, { stringCharacters: 2048, arrayItems: 32 });
  if (!copy || typeof copy !== "object" || Array.isArray(copy) || Object.keys(copy).length !== fields.length
    || fields.some(field => !Object.hasOwn(copy, field))) throw fail("invalid");
  if (Buffer.byteLength(JSON.stringify(copy), "utf8") > 65_536) throw fail("invalid");
  return copy as Record<string, unknown>;
}
function callback(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  return (loopback || url.protocol === "https:") && url.href === value && !url.username && !url.password
    && !url.search && !url.hash && !value.includes("*");
}
function registration(value: unknown): RegisteredPublicClient {
  const row = ordinary(value, ["clientId", "revision", "enabled", "expiresAt", "redirectUris", "scopes"]);
  if (!identifier(row.clientId) || !revision(row.revision) || typeof row.enabled !== "boolean"
    || typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= 0
    || !Array.isArray(row.redirectUris) || row.redirectUris.length < 1 || row.redirectUris.length > 20
    || new Set(row.redirectUris).size !== row.redirectUris.length || !row.redirectUris.every(callback)
    || !Array.isArray(row.scopes) || row.scopes.length < 1 || row.scopes.length > 32
    || new Set(row.scopes).size !== row.scopes.length || !row.scopes.every(scope => typeof scope === "string" && scopeToken.test(scope))) throw fail("invalid");
  // Canonical field order for the operation hash; JSON key order is not a new save.
  return Object.freeze({ clientId: row.clientId, revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt,
    redirectUris: Object.freeze([...row.redirectUris]) as readonly string[], scopes: Object.freeze([...row.scopes]) as readonly string[] });
}
function selectedRow(rows: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > 1) throw fail("unavailable");
  if (!rows.length) return undefined;
  const entry = Object.getOwnPropertyDescriptor(rows, "0");
  if (!entry?.enumerable || !Object.hasOwn(entry, "value")) throw fail("unavailable");
  return snapshotJsonFields(entry.value, fields, { stringCharacters: 65_536, arrayItems: 32 });
}
function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value, "utf8") > 65_536) throw fail("unavailable");
  return JSON.parse(value);
}
function receipt(value: unknown, clientId: string, key: string): PublicClientRegistrationReceipt {
  const row = ordinary(json(value), ["state", "operationKey", "registration"]);
  const registered = registration(row.registration);
  if (row.state !== "saved" || row.operationKey !== key || registered.clientId !== clientId) throw fail("unavailable");
  return { state: "saved", operationKey: key, registration: registered };
}

/** Same canonical registration validation for original server-side management
 * adapters; no independent policy approval or authority is granted by capture. */
export { registration as captureRegisteredPublicClient, storedReceipt as capturePublicClientRegistrationReceipt };

type ClientOperationRow = { actorId: string; clientId: string; payloadHash: string; resultJson: unknown };
const commandHash = (command: PublicClientRegistrationSave) => createHash("sha256").update(JSON.stringify(command)).digest("hex");
function storedReceipt(row: ClientOperationRow, clientId: string, key: string): PublicClientRegistrationReceipt {
  const saved = receipt(row.resultJson, clientId, key), registered = saved.registration;
  const command: PublicClientRegistrationSave = { operationKey: key, expectedRevision: registered.revision - 1, registration: {
    clientId: registered.clientId, enabled: registered.enabled, expiresAt: registered.expiresAt,
    redirectUris: registered.redirectUris, scopes: registered.scopes } };
  if (row.payloadHash !== commandHash(command)) throw fail("unavailable");
  return saved;
}

/** Concrete current public-client metadata, not the full application governance object.
 * No default records/permit. Disabled/expired metadata stays readable so the existing
 * token handler can still revoke; authorization itself rejects it. Used management
 * receipts remain durable; missing receipt never authorizes retry or a replacement key. */
export function createPrismaPublicClientRegistry<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(database: OAuthSqlDatabase<Native>,
  management?: OriginalPublicClientManagement<Native>): PrismaPublicClientRegistry<Native> {
  if (typeof database?.$transaction !== "function" || management && (typeof management.authorize !== "function" || typeof management.audit !== "function")) throw fail("unavailable");
  const transact = database.$transaction.bind(database), authorize = management?.authorize.bind(management), audit = management?.audit.bind(management);
  const run = async <T>(consume: (transaction: Native) => Promise<T>, signal: AbortSignal): Promise<T> => {
    live(signal); let entered = false;
    const result = await transact(async tx => {
      if (entered) throw fail("unavailable"); entered = true; live(signal);
      const result = await consume(tx); live(signal); return result;
    }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
    live(signal); return result;
  };
  const readIn = async (tx: Native, clientId: string, signal: AbortSignal): Promise<RegisteredPublicClient | undefined> => {
    try {
      live(signal); if (!identifier(clientId)) throw fail("invalid");
      const rows = await tx.$queryRaw<{ clientId: string; revision: number; recordJson: unknown }[]>`
        SELECT clientId, revision, recordJson FROM mcp_oauth_public_clients WHERE clientId = ${clientId} FOR UPDATE`;
      live(signal); const selected = selectedRow(rows, ["clientId", "revision", "recordJson"]); if (!selected) return undefined;
      const row = registration(json(selected.recordJson));
      if (row.clientId !== clientId || selected.clientId !== clientId || row.revision !== selected.revision) throw fail("unavailable");
      return row;
    } catch { throw fail("unavailable"); }
  };
  const manager = async (tx: Native, action: "read" | "save" | "read_receipt", clientId: string, signal: AbortSignal, candidate?: RegisteredPublicClient) => {
    live(signal); if (!authorize || !audit) throw fail("unavailable");
    const permission = await authorize(tx, { action, clientId, ...(candidate ? { registration: candidate } : {}) }, signal); live(signal);
    if (!permission) throw fail("denied");
    const value = ordinary(permission, ["actorId"]); if (!identifier(value.actorId)) throw fail("unavailable"); return value.actorId;
  };
  const operationRow = async (tx: Native, key: string, signal: AbortSignal) => {
    const rows = await tx.$queryRaw<ClientOperationRow[]>`
      SELECT actorId, clientId, payloadHash, resultJson FROM mcp_oauth_public_client_operations WHERE operationKey = ${key} FOR UPDATE`;
    live(signal); return selectedRow(rows, ["actorId", "clientId", "payloadHash", "resultJson"]) as ClientOperationRow | undefined;
  };
  return Object.freeze({
    readIn,
    async read(clientId: string, signal: AbortSignal) {
      try { return await run(tx => readIn(tx, clientId, signal), signal); } catch { throw fail("unavailable"); }
    },
    async readManaged(clientId: string, signal: AbortSignal) {
      if (!identifier(clientId)) throw fail("invalid");
      try { return await run(async tx => {
        const before = await manager(tx, "read", clientId, signal), registered = await readIn(tx, clientId, signal);
        if (await manager(tx, "read", clientId, signal) !== before) throw fail("denied");
        return registered ? { state: "configured" as const, registration: registered } : { state: "not_configured" as const };
      }, signal); } catch (error) { if (error instanceof PublicClientRegistryError && error.kind === "denied") throw error; throw fail("unavailable"); }
    },
    async save(input: PublicClientRegistrationSave, signal: AbortSignal) {
      live(signal); if (!authorize || !audit) throw fail("unavailable");
      let command: PublicClientRegistrationSave, candidate: RegisteredPublicClient, payloadHash: string;
      try {
        const row = ordinary(input, ["operationKey", "expectedRevision", "registration"]);
        if (!operationKey(row.operationKey) || !revision(row.expectedRevision, true) || row.expectedRevision >= 2_147_483_647) throw fail("invalid");
        const metadata = ordinary(row.registration, ["clientId", "enabled", "expiresAt", "redirectUris", "scopes"]);
        candidate = registration({ ...metadata, revision: row.expectedRevision + 1 });
        command = { operationKey: row.operationKey, expectedRevision: row.expectedRevision, registration: {
          clientId: candidate.clientId, enabled: candidate.enabled, expiresAt: candidate.expiresAt, redirectUris: candidate.redirectUris, scopes: candidate.scopes } };
        payloadHash = commandHash(command);
      } catch { throw fail("invalid"); }
      try {
        return await run(async tx => {
          const actorId = await manager(tx, "save", candidate.clientId, signal, candidate);
          const previous = await readIn(tx, candidate.clientId, signal);
          const original = await operationRow(tx, command.operationKey, signal);
          const check = async () => { if (await manager(tx, "save", candidate.clientId, signal, candidate) !== actorId) throw fail("denied"); };
          if (original) {
            if (original.actorId !== actorId || original.clientId !== candidate.clientId || original.payloadHash !== payloadHash) throw fail("conflict");
            const saved = storedReceipt(original, candidate.clientId, command.operationKey); await check(); return saved;
          }
          if ((previous?.revision ?? 0) !== command.expectedRevision) throw fail("conflict");
          await check();
          const changed = previous
            ? await tx.$executeRaw`UPDATE mcp_oauth_public_clients SET revision = ${candidate.revision}, recordJson = ${JSON.stringify(candidate)} WHERE clientId = ${candidate.clientId} AND revision = ${command.expectedRevision}`
            : await tx.$executeRaw`INSERT INTO mcp_oauth_public_clients (clientId, revision, recordJson) VALUES (${candidate.clientId}, ${candidate.revision}, ${JSON.stringify(candidate)})`;
          live(signal); if (changed !== 1) throw fail("conflict");
          const saved: PublicClientRegistrationReceipt = { state: "saved", operationKey: command.operationKey, registration: candidate };
          const inserted = await tx.$executeRaw`INSERT INTO mcp_oauth_public_client_operations (operationKey, actorId, clientId, payloadHash, resultJson) VALUES (${command.operationKey}, ${actorId}, ${candidate.clientId}, ${payloadHash}, ${JSON.stringify(saved)})`;
          live(signal); if (inserted !== 1) throw fail("unavailable");
          await audit!(tx, { actorId, clientId: candidate.clientId, operationKey: command.operationKey, revision: candidate.revision }, signal);
          live(signal); await check(); return saved;
        }, signal);
      } catch (error) {
        if (error instanceof PublicClientRegistryError && ["denied", "conflict"].includes(error.kind)) throw error;
        // An insert/commit or post-commit cancellation can have an unknown outcome.
        // Never retry, replace the operation key or claim that nothing was saved.
        throw fail("unknown");
      }
    },
    async operation(clientId: string, key: string, signal: AbortSignal) {
      if (!identifier(clientId) || !operationKey(key)) throw fail("invalid");
      try {
        return await run(async tx => {
          const actorId = await manager(tx, "read_receipt", clientId, signal);
          const original = await operationRow(tx, key, signal);
          if (await manager(tx, "read_receipt", clientId, signal) !== actorId) throw fail("denied");
          if (!original) return { state: "not_observed", retryable: false } as const;
          if (original.actorId !== actorId || original.clientId !== clientId) throw fail("denied");
          return { state: "observed", operationKey: key, result: storedReceipt(original, clientId, key) } as const;
        }, signal);
      } catch (error) {
        if (error instanceof PublicClientRegistryError && error.kind === "denied") throw error;
        throw fail("unavailable");
      }
    },
  });
}
