/** Parameterized MySQL persistence for the existing OAuth lifecycle, not identity.
 * Original consent/grant/registration owners use this SAME native transaction to
 * lock their records. No connection, schema installation, retry or fallback store. */
import type { AuthorizedOAuthCode, PersistentOAuthAuthorizationStore, PersistentOAuthAuthorizationTransaction } from "./persistent-oauth-authorization.js";
import type { PersistentOAuthAccess, PersistentOAuthFamily, PersistentOAuthRefresh, PersistentOAuthTokenStore, PersistentOAuthTokenTransaction } from "./persistent-oauth-tokens.js";
import { snapshotJson } from "./json-snapshot.js";

/** Structural subset of Prisma's tagged, parameterized SQL transaction client. */
export interface OAuthSqlTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
export interface OAuthSqlDatabase<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  $transaction<T>(consume: (transaction: Native) => Promise<T>,
    options: { isolationLevel: "Serializable"; maxWait: number; timeout: number }): Promise<T>;
}
export interface OriginalOAuthCodeAudit<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  /** Save the original authorization's audit/receipt in the supplied transaction.
   * No plaintext code, token, browser credentials or model input is supplied. */
  record(transaction: Native, authorization: {
    authorizationId: string; authorizationRevision: number; grantId: string;
  }, signal: AbortSignal): Promise<void>;
}
export type PrismaOAuthStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction> = PersistentOAuthAuthorizationStore & PersistentOAuthTokenStore & {
  /** Only the current transaction from THIS store is accepted. Original authority
   * must lock/recheck consent, registration and grant here, not in another tx. */
  native(transaction: PersistentOAuthTokenTransaction): Native;
  /** Borrow an ORIGINAL already-open native transaction, without begin/commit/retry.
   * Its owner must hold Serializable/current authority fences through outer commit.
   * The scoped facade/native association expires when consume settles or aborts;
   * returning here is not an outer commit receipt or authorization permit. */
  withNative<T>(transaction: Native, consume: (view: PersistentOAuthAuthorizationTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
};

const unavailable = () => new Error("OAuth persistence unavailable");
const limits = { stringCharacters: 2048, arrayItems: 32 };
const digest = (value: string) => { if (!/^[a-f0-9]{64}$/.test(value)) throw unavailable(); return value; };
const id = (value: string) => { if (!/^[\x21-\x7e]{1,200}$/.test(value)) throw unavailable(); return value; };
const codeFields = ["digest", "grantId", "subject", "grantRevision", "scopes", "clientId", "resource", "redirectUri", "codeChallengeMethod", "codeChallenge", "expiresAt", "authorizationId", "authorizationRevision"];
const familyFields = ["id", "grantId", "subject", "clientId", "resource", "grantRevision", "scopes", "expiresAt"];
const accessFields = ["digest", "grantId", "familyId", "expiresAt"];
function ordinary(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const result = snapshotJson(value, limits);
  if (!result || typeof result !== "object" || Array.isArray(result)
    || Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key))) throw unavailable();
  return result as Record<string, unknown>;
}
function encoded(value: unknown, fields: readonly string[], state?: string): string {
  const record = ordinary(value, state ? [...fields, state] : fields);
  if (state) delete record[state];
  const text = JSON.stringify(record);
  if (Buffer.byteLength(text, "utf8") > 65_536) throw unavailable();
  return text;
}
function decoded(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > 65_536) throw unavailable();
    value = JSON.parse(value);
  }
  const record = ordinary(value, fields);
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 65_536) throw unavailable();
  return record;
}
function flag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw unavailable();
}

/** Requires provisioned InnoDB tables from mysql-oauth-schema.sql. Missing schema,
 * corrupt rows, failed CAS or unknown commit all reject; nothing seeds or retries.
 * Original code audit is mandatory and atomic with insertion. Other lifecycle
 * audit/receipts remain with the original AS authority, not a second ledger here. */
export function createPrismaOAuthStore<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  database: OAuthSqlDatabase<Native>, audit: OriginalOAuthCodeAudit<Native>): PrismaOAuthStore<Native> {
  if (typeof database?.$transaction !== "function" || typeof audit?.record !== "function") throw unavailable();
  const transact = database.$transaction.bind(database), recordAudit = audit.record.bind(audit);
  // This is transaction capability bookkeeping, not a grant cache or business counter.
  const nativeTransactions = new WeakMap<object, { native: Native; live: () => void }>();
  // Both entry modes use exactly the same SQL operations and scoped capability.
  // A borrowed entry cannot attest its caller's isolation/commit; the original
  // transaction owner remains responsible for those, never a caller JSON field.
  const within = async <T>(sql: Native, consume: (transaction: PersistentOAuthAuthorizationTransaction) => Promise<T>, signal: AbortSignal): Promise<T> => {
        if (signal.aborted || typeof sql?.$queryRaw !== "function" || typeof sql.$executeRaw !== "function" || typeof consume !== "function") throw unavailable();
        let active = true;
        const live = () => { if (!active || signal.aborted) throw unavailable(); };
        const query = async <T>(parts: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
          live(); const result = await sql.$queryRaw<T>(parts, ...values); live(); return result;
        };
        const execute = async (parts: TemplateStringsArray, ...values: unknown[]) => {
          live(); const count = await sql.$executeRaw(parts, ...values); live();
          if (count !== 1) throw unavailable();
        };
        const readCode = async (where: "digest" | "authorization", key: string): Promise<AuthorizedOAuthCode | undefined> => {
          const rows = where === "digest"
            ? await query<{ digest: string; authorizationId: string; recordJson: unknown; consumedFamilyId: unknown }[]>`SELECT digest, authorizationId, recordJson, consumedFamilyId FROM mcp_oauth_codes WHERE digest = ${digest(key)} FOR UPDATE`
            : await query<{ digest: string; authorizationId: string; recordJson: unknown; consumedFamilyId: unknown }[]>`SELECT digest, authorizationId, recordJson, consumedFamilyId FROM mcp_oauth_codes WHERE authorizationId = ${id(key)} FOR UPDATE`;
          if (rows.length > 1) throw unavailable();
          const row = rows[0]; if (!row) return undefined;
          const record = decoded(row.recordJson, codeFields);
          if (record.digest !== row.digest || record.authorizationId !== row.authorizationId
            || record[where === "digest" ? "digest" : "authorizationId"] !== key) throw unavailable();
          if (row.consumedFamilyId !== null && (typeof row.consumedFamilyId !== "string" || id(row.consumedFamilyId) !== row.consumedFamilyId)) throw unavailable();
          return { ...record, consumedFamilyId: row.consumedFamilyId } as unknown as AuthorizedOAuthCode;
        };
        const transaction: PersistentOAuthAuthorizationTransaction = {
          readCode: key => readCode("digest", key),
          readCodeForAuthorization: key => readCode("authorization", key),
          async readFamily(key) {
            const rows = await query<{ recordJson: unknown; revoked: unknown }[]>`SELECT recordJson, revoked FROM mcp_oauth_families WHERE id = ${id(key)} FOR UPDATE`;
            if (rows.length > 1) throw unavailable();
            if (!rows[0]) return undefined;
            const record = decoded(rows[0].recordJson, familyFields);
            if (record.id !== key) throw unavailable();
            return { ...record, revoked: flag(rows[0].revoked) } as unknown as PersistentOAuthFamily;
          },
          async readAccess(key) {
            const rows = await query<{ recordJson: unknown; familyId: string }[]>`SELECT recordJson, familyId FROM mcp_oauth_access WHERE digest = ${digest(key)} FOR UPDATE`;
            if (rows.length > 1) throw unavailable();
            if (!rows[0]) return undefined;
            const record = decoded(rows[0].recordJson, accessFields);
            if (record.digest !== key || record.familyId !== rows[0].familyId) throw unavailable();
            return record as unknown as PersistentOAuthAccess;
          },
          async readRefresh(key) {
            const rows = await query<{ recordJson: unknown; familyId: string; used: unknown }[]>`SELECT recordJson, familyId, used FROM mcp_oauth_refresh WHERE digest = ${digest(key)} FOR UPDATE`;
            if (rows.length > 1) throw unavailable();
            if (!rows[0]) return undefined;
            const record = decoded(rows[0].recordJson, accessFields);
            if (record.digest !== key || record.familyId !== rows[0].familyId) throw unavailable();
            return { ...record, used: flag(rows[0].used) } as unknown as PersistentOAuthRefresh;
          },
          async insertCode(value) {
            const text = encoded(value, codeFields, "consumedFamilyId");
            const row = decoded(text, codeFields) as unknown as AuthorizedOAuthCode;
            if (Object.getOwnPropertyDescriptor(value, "consumedFamilyId")?.value !== null) throw unavailable();
            await execute`INSERT INTO mcp_oauth_codes (digest, authorizationId, recordJson, consumedFamilyId) VALUES (${digest(row.digest)}, ${id(row.authorizationId)}, ${text}, NULL)`;
            await recordAudit(sql, { authorizationId: row.authorizationId, authorizationRevision: row.authorizationRevision, grantId: row.grantId }, signal);
            live();
          },
          async insertFamily(value) {
            const text = encoded(value, familyFields, "revoked");
            const row = decoded(text, familyFields) as unknown as PersistentOAuthFamily;
            if (Object.getOwnPropertyDescriptor(value, "revoked")?.value !== false) throw unavailable();
            await execute`INSERT INTO mcp_oauth_families (id, recordJson, revoked) VALUES (${id(row.id)}, ${text}, 0)`;
          },
          async consumeCode(key, familyId) {
            await execute`UPDATE mcp_oauth_codes SET consumedFamilyId = ${id(familyId)} WHERE digest = ${digest(key)} AND consumedFamilyId IS NULL`;
          },
          async consumeRefresh(key) {
            await execute`UPDATE mcp_oauth_refresh SET used = 1 WHERE digest = ${digest(key)} AND used = 0`;
          },
          async insertAccess(value) {
            const text = encoded(value, accessFields), row = decoded(text, accessFields) as unknown as PersistentOAuthAccess;
            await execute`INSERT INTO mcp_oauth_access (digest, familyId, recordJson) VALUES (${digest(row.digest)}, ${id(row.familyId)}, ${text})`;
          },
          async insertRefresh(value) {
            const text = encoded(value, accessFields, "used"), row = decoded(text, accessFields) as unknown as PersistentOAuthAccess;
            if (Object.getOwnPropertyDescriptor(value, "used")?.value !== false) throw unavailable();
            await execute`INSERT INTO mcp_oauth_refresh (digest, familyId, recordJson, used) VALUES (${digest(row.digest)}, ${id(row.familyId)}, ${text}, 0)`;
          },
          async revokeFamily(key) {
            // Lock/read first so an already-revoked family is idempotent even when
            // MySQL returns changed rows, rather than matched rows, for UPDATE.
            const row = await transaction.readFamily(key);
            if (!row) throw unavailable();
            if (!row.revoked) await execute`UPDATE mcp_oauth_families SET revoked = 1 WHERE id = ${id(key)} AND revoked = 0`;
          },
        };
        nativeTransactions.set(transaction, { native: sql, live });
        try { const value = await consume(Object.freeze(transaction)); live(); return value; }
        finally { active = false; nativeTransactions.delete(transaction); }
  };
  const store: PrismaOAuthStore<Native> = {
    native(transaction) {
      const entry = nativeTransactions.get(transaction);
      if (!entry) throw unavailable();
      entry.live();
      return entry.native;
    },
    withNative: within,
    async transaction<T>(consume: (transaction: PersistentOAuthAuthorizationTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (signal.aborted) throw unavailable();
      let entered = false;
      const result = await transact(async sql => {
        // Owned entry still rejects driver replay rather than duplicating work.
        if (entered || signal.aborted) throw unavailable();
        entered = true;
        return within(sql, consume, signal);
      }, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
      // Abort can race a successful commit. Suppress delivery, never infer rollback.
      if (signal.aborted) throw unavailable();
      return result;
    },
  };
  return Object.freeze(store);
}
