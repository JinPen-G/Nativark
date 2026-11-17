"use strict";
// Inert helpers: no env files, container, DB connection or filesystem operation
// at import. Callers supply trusted server configuration/current authorization.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const POLICY = 'ai-retention-20261015-1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = () => { throw Error('AI_RETENTION_EVIDENCE_REQUIRED'); };
function readRetentionCertificates(file) {
  if (typeof file !== 'string' || !/\.json$/iu.test(file)) fail();
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1048576) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) fail();
    const bytes = Buffer.alloc(stat.size + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length !== stat.size) fail();
    const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!Array.isArray(value) || value.length > 500) fail();
    return value;
  } finally { fs.closeSync(fd); }
}
function signed(value, publicKey) {
  const key = publicKey && typeof publicKey === 'object' && publicKey.type === 'public' ? publicKey : crypto.createPublicKey(publicKey);
  if (!value || typeof value.payload !== 'string' || value.payload.length > 262144 || typeof value.signature !== 'string'
    || value.signature.length > 128 || key.asymmetricKeyType !== 'ed25519'
    || !crypto.verify(null, Buffer.from(value.payload), publicKey, Buffer.from(value.signature, 'base64'))) fail();
  return JSON.parse(value.payload);
}
/** All restored workspace and platform scopes need fresh server-signed AFTER-replay attestations.
 * The original dump hash and exact newly created database are mandatory. A
 * certificate from another clone/scope/snapshot never grants access here.
 */
function verifyRestoredAiScopes({ certificates, publicKey, database, snapshotSha256, scopes, now = new Date() }) {
  const key = publicKey && typeof publicKey === 'object' && publicKey.type === 'public' ? publicKey : crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') fail();
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(database) || !/^[a-f0-9]{64}$/u.test(snapshotSha256)
    || !Array.isArray(certificates) || !Array.isArray(scopes) || scopes.length > 500 || certificates.length !== scopes.length
    || !Number.isFinite(now.getTime())) fail();
  const scopeKey = s => {
    if (!s || typeof s !== 'object') fail();
    if (s.scopeKind === 'PLATFORM') {
      if (typeof s.scopeId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(s.scopeId)
        || s.tenantId !== null || s.workspaceId !== null) fail();
      return JSON.stringify(['PLATFORM', s.scopeId, null, null]);
    }
    if (s.scopeKind !== undefined && s.scopeKind !== 'WORKSPACE'
      || typeof s.tenantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(s.tenantId)
      || typeof s.workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(s.workspaceId)) fail();
    return JSON.stringify(['WORKSPACE', s.tenantId, s.workspaceId]);
  };
  const expected = new Set(scopes.map(scopeKey));
  if (expected.size !== scopes.length) fail();
  for (const item of certificates) {
    const p = signed(item, publicKey), at = Date.parse(p.verifiedAt);
    const platform = p.version === 'ai-restored-platform-scope-1';
    if ((!platform && p.version !== 'ai-restored-scope-1') || p.policyVersion !== POLICY || p.database !== database
      || p.snapshotSha256 !== snapshotSha256 || !/^[a-f0-9]{64}$/u.test(p.manifestHash)
      || !Number.isFinite(at) || at > now.getTime() || now.getTime() - at > 60000
      || platform && p.scopeKind !== 'PLATFORM'
      || !expected.delete(scopeKey(platform ? p : { scopeKind: 'WORKSPACE', tenantId: p.tenantId, workspaceId: p.workspaceId }))) fail();
  }
  if (expected.size) fail();
  return { state: 'privacy_barrier_passed', scopes: scopes.length, database };
}
function assertRestoreAiBarrier(query, database, snapshotSha256, certificates, publicKey) {
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(database)) fail();
  const hasAi = Number(query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}' AND table_name IN ('ai_tasks','ai_task_original_requests','ai_knowledge_documents','ai_structured_memories','ai_client_scene_materials','ai_inspection_drafts')`));
  if (!Number.isSafeInteger(hasAi) || hasAi < 0) fail();
  if (hasAi === 0) return { state: 'no_ai_task_tables' };
  const scopes = JSON.parse(query(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('scopeKind', scopeKind, 'scopeId', scopeId, 'tenantId', tenantId, 'workspaceId', workspaceId)), JSON_ARRAY()) FROM (SELECT 'WORKSPACE' AS scopeKind, NULL AS scopeId, tenantId, id AS workspaceId FROM \`${database}\`.business_workspaces UNION ALL SELECT 'PLATFORM' AS scopeKind, id AS scopeId, tenantId, workspaceId FROM \`${database}\`.ai_scopes WHERE kind='platform' AND scopeKey='platform' AND tenantId IS NULL AND workspaceId IS NULL LIMIT 501) privacy_scopes`));
  return verifyRestoredAiScopes({ certificates, publicKey, database, snapshotSha256, scopes });
}
/** Targeted AI-only backup expiry. Never scans/deletes generic SQL backups,
 * business snapshots, directories, symlinks or a volume. Snapshot IDs are from
 * the backup registry; each AI-only manifest is signed by the pinned server key.
 */
class AiOnlyBackupRetentionStore {
  constructor(root, publicKey, currentAuthority) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root || typeof currentAuthority !== 'function') fail();
    this.root = path.resolve(root); this.publicKey = publicKey; this.current = currentAuthority;
  }
  async save(snapshotId, body, privateKey, encryptionKey) {
    if (!uuid.test(snapshotId) || !Buffer.isBuffer(body) || body.length < 1 || body.length > 104857500
      || !Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32 || privateKey?.type !== 'private'
      || privateKey.asymmetricKeyType !== 'ed25519') fail();
    const pub = this.publicKey && typeof this.publicKey === 'object' && this.publicKey.type === 'public'
      ? this.publicKey : crypto.createPublicKey(this.publicKey);
    if (!crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
      .equals(pub.export({ type: 'spki', format: 'der' }))) fail();
    const before = await this.current(), root = await fs.promises.realpath(this.root);
    if (!before?.hash || root !== this.root || (await fs.promises.lstat(root)).isSymbolicLink()) fail();
    const clear = Buffer.from(body), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]); clear.fill(0);
    const binary = Buffer.concat([Buffer.from('RAIB1'), iv, cipher.getAuthTag(), encrypted]);
    const payload = JSON.stringify({ version: 'ai-only-backup-1', kind: 'ai_only', id: snapshotId,
      tenantId: before.tenantId, workspaceId: before.workspaceId, createdAt: new Date().toISOString(),
      sha256: sha(binary), bytes: binary.length, encryption: 'aes-256-gcm' });
    const metadata = JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64') });
    const after = await this.current(); if (after.hash !== before.hash) fail();
    // Exclusive names: never replace an old backup or silently retry another ID.
    // Partial writes are retained for operator reconciliation, not reported as saved.
    try {
      await fs.promises.writeFile(path.join(root, `${snapshotId}.bin`), binary, { flag: 'wx', mode: 0o600 });
      if ((await this.current()).hash !== before.hash) fail();
      await fs.promises.writeFile(path.join(root, `${snapshotId}.json`), metadata, { flag: 'wx', mode: 0o600 });
      if ((await this.current()).hash !== before.hash) fail();
    } catch {
      const error = Error('AI_BACKUP_RESULT_UNKNOWN'); error.code = 'AI_RESULT_UNKNOWN'; error.snapshotId = snapshotId; error.retryable = false; throw error;
    }
    return { id: snapshotId, state: 'saved', retentionDays: 30, encryption: 'aes-256-gcm', tombstones: 'store_separately' };
  }
  async purge(snapshotIds, now = new Date()) {
    if (!Array.isArray(snapshotIds) || snapshotIds.length > 10 || new Set(snapshotIds).size !== snapshotIds.length
      || snapshotIds.some(id => !uuid.test(id)) || !Number.isFinite(now.getTime())) fail();
    const before = await this.current();
    const check = async () => { const after = await this.current();
      if (!before?.hash || after.hash !== before.hash || after.tenantId !== before.tenantId || after.workspaceId !== before.workspaceId) fail(); };
    const root = await fs.promises.realpath(this.root);
    if (root !== this.root || (await fs.promises.lstat(root)).isSymbolicLink()) fail();
    const results = [];
    for (const id of snapshotIds) {
      const sidecar = path.join(root, `${id}.json`), file = path.join(root, `${id}.bin`);
      const metaStat = await fs.promises.lstat(sidecar);
      if (!metaStat.isFile() || metaStat.isSymbolicLink() || metaStat.nlink !== 1 || metaStat.size > 65536) fail();
      const metadata = await fs.promises.readFile(sidecar, 'utf8'), p = signed(JSON.parse(metadata), this.publicKey);
      const created = Date.parse(p.createdAt);
      if (p.version !== 'ai-only-backup-1' || p.kind !== 'ai_only' || p.id !== id || p.tenantId !== before.tenantId
        || p.workspaceId !== before.workspaceId || !/^[a-f0-9]{64}$/u.test(p.sha256)
        || !Number.isFinite(created) || created > now.getTime() || !Number.isSafeInteger(p.bytes) || p.bytes < 1 || p.bytes > 104857600) fail();
      if (now.getTime() - created < 30 * 86400000) { results.push({ id, state: 'retained' }); continue; }
      let stat;
      try { stat = await fs.promises.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== p.bytes) fail();
        const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
          const opened = await handle.stat();
          if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) fail();
          const body = await handle.readFile(); if (sha(body) !== p.sha256) fail();
          await check();
          const latest = await fs.promises.lstat(file);
          if (latest.ino !== stat.ino || latest.dev !== stat.dev || latest.size !== stat.size || latest.mtimeMs !== stat.mtimeMs) fail();
          await fs.promises.unlink(file);
        } finally { await handle.close(); }
      }
      await check();
      if (await fs.promises.readFile(sidecar, 'utf8') !== metadata) fail();
      await fs.promises.unlink(sidecar);
      results.push({ id, state: 'erased' });
    }
    return { policyVersion: POLICY, results, businessBackups: 'untouched', tombstoneArchive: 'untouched' };
  }
}
module.exports = { verifyRestoredAiScopes, assertRestoreAiBarrier, AiOnlyBackupRetentionStore, readRetentionCertificates };
