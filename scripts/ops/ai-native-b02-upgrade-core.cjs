"use strict";
/** B02 upgrade preparation: identify the byte-pinned original 178-migration
 * chain, prepare canonical scope metadata and an exact-byte migration plan.
 * No filesystem/DB/network execution, receipt rewrite, credential import or
 * authorization is performed here.
 * A projection is NOT an applied migration; the old rows/receipts must be archived
 * and verified by the separately approved clone upgrade before use. */
const { createHash } = require("node:crypto");
const LEGACY_B02_COMMIT = "4de24522714c9663c1e118ba1cffe87842d89696";
// SHA256(JSON.stringify(sorted [migration_name, exact SQL-byte SHA256] pairs)).
// Derived from all 178 original git blobs, not a normalized-EOL SQL checksum.
const LEGACY_B02_CHAIN_HASH = "2f354cc8a3efc7c3faa3f04709371451b5498984f65f9486c1fa3c2c83e45ee2";
// The formally preserved B02 original (exact CRLF bytes) plus the same 177
// original prefix. Its dependency order is valid; do not claim a contiguous
// 4de24522 release or normalize its checksum to the LF git-blob checksum.
const ARCHIVED_B02_CHAIN_HASH = "9a32f248cf2cd01709e3dbe2f162d4cb4be9b11f5bd0e42c6ac5b5db05ac70ee";
const MAX_B02_SCOPES = 10000;
const hash = value => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
class AiLegacyB02BridgeError extends Error {
  constructor() { super("AI_B02_BRIDGE_SOURCE_UNAVAILABLE"); this.code = "AI_B02_BRIDGE_SOURCE_UNAVAILABLE"; }
}

/** Only already-successful receipt name/checksum pairs belong here. The caller
 * separately checks unfinished receipts and physical layout. Matching a chain
 * establishes provenance, never schema compatibility or permission to deploy. */
function isOriginalB02MigrationChain(rows) {
  if (!Array.isArray(rows) || rows.length !== 178) return false;
  const names = new Set(), pairs = [];
  for (const row of rows) {
    if (!row || typeof row.name !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(row.name)
      || typeof row.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(row.checksum)
      || names.has(row.name)) return false;
    names.add(row.name); pairs.push([row.name, row.checksum]);
  }
  pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return [LEGACY_B02_CHAIN_HASH, ARCHIVED_B02_CHAIN_HASH].includes(hash(pairs));
}

/** Normalize ONLY the future metadata projection through the current system
 * normalizer. The original id/key/owner/timestamps remain in the detached origin
 * snapshot; ambiguous owners or target key collisions cannot be merged/remapped.
 * No actor, audience, policy, capability, readiness or budget fact is inferred. */
function prepareOriginalB02ScopeProjection(input, normalizeCurrentScope) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiLegacyB02BridgeError();
  const { successfulMigrations, scopes } = input;
  if (!isOriginalB02MigrationChain(successfulMigrations) || typeof normalizeCurrentScope !== "function"
    || !Array.isArray(scopes) || scopes.length > MAX_B02_SCOPES) throw new AiLegacyB02BridgeError();
  let originals;
  try { originals = structuredClone(scopes); } catch { throw new AiLegacyB02BridgeError(); }
  const ids = new Set(), originalKeys = new Set(), targetKeys = new Set(), projection = [];
  const identity = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
  const validDate = value => value instanceof Date && Number.isFinite(value.getTime());
  for (const row of originals) {
    if (!row || Object.keys(row).sort().join(",") !== "createdAt,id,kind,scopeKey,tenantId,updatedAt,workspaceId"
      || typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(row.id)
      || !["platform", "tenant", "workspace"].includes(row.kind)
      || typeof row.scopeKey !== "string" || Array.from(row.scopeKey).length > 512
      || !validDate(row.createdAt) || !validDate(row.updatedAt)
      || ids.has(row.id.toLowerCase()) || originalKeys.has(row.scopeKey.toLowerCase())) throw new AiLegacyB02BridgeError();
    const platform = row.kind === "platform", workspace = row.kind === "workspace";
    if (platform ? row.tenantId !== null || row.workspaceId !== null
      : !identity(row.tenantId) || (workspace ? !identity(row.workspaceId) : row.workspaceId !== null)) throw new AiLegacyB02BridgeError();
    let columns;
    try {
      columns = normalizeCurrentScope({ kind: row.kind, ...(platform ? {} : { tenantId: row.tenantId }),
        ...(workspace ? { workspaceId: row.workspaceId } : {}) });
    } catch { throw new AiLegacyB02BridgeError(); }
    if (!columns || columns.kind !== row.kind.toUpperCase() || columns.tenantId !== row.tenantId
      || columns.workspaceId !== row.workspaceId || typeof columns.scopeKey !== "string"
      || !columns.scopeKey || columns.scopeKey.length > 512) throw new AiLegacyB02BridgeError();
    // ASCII identifiers permit conservative case-fold collision rejection.
    // The actual target UNIQUE/collation must still be checked in real MySQL.
    const key = columns.scopeKey.toLowerCase();
    if (targetKeys.has(key)) throw new AiLegacyB02BridgeError();
    ids.add(row.id.toLowerCase()); originalKeys.add(row.scopeKey.toLowerCase()); targetKeys.add(key);
    projection.push({ id: row.id, kind: columns.kind, scopeKey: columns.scopeKey,
      tenantId: row.tenantId, workspaceId: row.workspaceId, createdAt: new Date(row.createdAt),
      originalKeyHash: hash(row.scopeKey), keyNormalizationRequired: row.scopeKey !== columns.scopeKey });
  }
  // Stable ordering identifies the original row set, never replaces its SQL
  // migration checksum. Keep updatedAt even though canonical AiScope lacks it.
  originals.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  projection.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const archived = successfulMigrations.some(row => row.name === '20261003160000_ai_provider_profiles'
    && row.checksum === 'bdc9d0778f0250f6fb193398c97e83ebe390345e31f7f57b9800879e3bc4563f');
  return { status: "prepared_not_applied", originalCommit: archived ? null : LEGACY_B02_COMMIT,
    commonPrefixCommit: LEGACY_B02_COMMIT, b02Source: archived ? 'formal_archived_original' : '4de_original',
    originalRowsHash: hash(originals), originals, projection };
}
const B02_PRESERVE_MIGRATION = '20261003050000_ai_b02_scope_preserve';
const B02_PROJECT_MIGRATION = '20261003065000_ai_b02_scope_project';
const FOUNDATION_MIGRATION = '20261003060000_ai_task_foundation';
const ORIGINAL_B02_MIGRATION = '20261003160000_ai_provider_profiles';
const CANONICAL_B02_SQL_HASH = '1224e59c7147cfb971d0471b03eef8923b8cb9131c3901061c350ff58418ea15';
const sqlHash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizedEol = bytes => Buffer.from([...bytes].filter((byte, index) => byte !== 13 || bytes[index + 1] !== 10));

/** Build a separate migration project, not a repaired copy of root migrations.
 * Already-applied original files retain their EXACT bytes/checksums; all pending
 * files come from the trusted current checkout, including the two bridge steps.
 * The caller must validate actual receipts/layout and obtain execution approval.
 * This function does not create files, run Prisma, resolve a receipt or retry DDL.
 */
function prepareOriginalB02MigrationPlan(input, normalizeCurrentScope) {
  const scopePlan = prepareOriginalB02ScopeProjection(input, normalizeCurrentScope);
  const snapshot = rows => {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new AiLegacyB02BridgeError();
    const seen = new Set();
    return rows.map(row => {
      if (!row || typeof row.name !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(row.name)
        || !Buffer.isBuffer(row.sql) || !row.sql.length || seen.has(row.name.toLowerCase())) throw new AiLegacyB02BridgeError();
      seen.add(row.name.toLowerCase());
      return { name: row.name, sql: Buffer.from(row.sql) };
    }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  };
  const original = snapshot(input.originalMigrations), current = snapshot(input.currentMigrations);
  if (!isOriginalB02MigrationChain(original.map(row => ({ name: row.name, checksum: sqlHash(row.sql) })))) throw new AiLegacyB02BridgeError();
  const oldByName = new Map(original.map(row => [row.name, row]));
  const currentByName = new Map(current.map(row => [row.name, row]));
  for (const old of original) {
    const present = currentByName.get(old.name);
    if (!present) throw new AiLegacyB02BridgeError();
    if (old.name === ORIGINAL_B02_MIGRATION) {
      if (sqlHash(present.sql) !== CANONICAL_B02_SQL_HASH) throw new AiLegacyB02BridgeError();
    } else if (!normalizedEol(old.sql).equals(normalizedEol(present.sql))) {
      // EOL comparison classifies the current source relationship ONLY. It never
      // supplies an accepted checksum; the emitted old file remains exact bytes.
      throw new AiLegacyB02BridgeError();
    }
  }
  const order = current.map(row => row.name);
  const preserve = order.indexOf(B02_PRESERVE_MIGRATION), foundation = order.indexOf(FOUNDATION_MIGRATION);
  const project = order.indexOf(B02_PROJECT_MIGRATION), b02 = order.indexOf(ORIGINAL_B02_MIGRATION);
  if (preserve < 0 || foundation <= preserve || project <= foundation || b02 <= project) throw new AiLegacyB02BridgeError();
  const migrations = current.map(row => {
    const old = oldByName.get(row.name), chosen = old ?? row;
    return { name: row.name, sql: Buffer.from(chosen.sql), checksum: sqlHash(chosen.sql),
      source: old ? 'preserved_original' : 'current_pending' };
  });
  return { ...scopePlan, migrations, preservedMigrationCount: original.length,
    bridgeMigrations: [B02_PRESERVE_MIGRATION, B02_PROJECT_MIGRATION],
    receiptMutation: 'forbidden', recovery: 'verified_pre_backup_to_new_isolated_clone' };
}
/** Retained old receipt subset after both bridge steps completed. This identifies
 * provenance only; the consumer must still validate every new receipt against
 * current bytes and inspect canonical scope/archival shape. */
function originalB02BridgeMigrationNames(rows) {
  if (!Array.isArray(rows) || !rows.some(row => row?.name === B02_PRESERVE_MIGRATION)
    || !rows.some(row => row?.name === B02_PROJECT_MIGRATION)
    || !rows.some(row => row?.name === FOUNDATION_MIGRATION)) return null;
  const added = new Set([B02_PRESERVE_MIGRATION, B02_PROJECT_MIGRATION, FOUNDATION_MIGRATION,
    '20261003070000_ai_task_creation_identity']);
  const original = rows.filter(row => row?.name <= ORIGINAL_B02_MIGRATION && !added.has(row.name));
  return isOriginalB02MigrationChain(original) ? new Set(original.map(row => row.name)) : null;
}
module.exports = { LEGACY_B02_COMMIT, LEGACY_B02_CHAIN_HASH, MAX_B02_SCOPES,
  B02_PRESERVE_MIGRATION, B02_PROJECT_MIGRATION, originalB02BridgeMigrationNames,
  AiLegacyB02BridgeError, isOriginalB02MigrationChain, prepareOriginalB02ScopeProjection,
  prepareOriginalB02MigrationPlan };
