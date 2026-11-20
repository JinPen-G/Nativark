'use strict';
/** 原知识来源读取器与实际 Rental cleanup authority。只替换持久化行；不构造
 * Client、启动宿主、读取正文或派发对象运输。沿正式出口在内存加载原源码。
 * node apps/rental-api/test/ai-file-cleanup-source.test.cjs --deps <node_modules>
 */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.resolve(root, 'output/.tmp/rental-lead-participants');
let ownsTemporary = false;
function cleanup() {
  if (!ownsTemporary) return;
  if (path.relative(root, temporary) !== path.join('output', '.tmp', 'rental-lead-participants')
    || fs.lstatSync(temporary).isSymbolicLink() || fs.realpathSync(temporary) !== temporary) throw Error('临时目录身份不符');
  const audit = path.join(temporary, 'audit.log');
  if (fs.existsSync(audit) && fs.statSync(audit).size) { process.exitCode = 1; console.error('离线守卫存在拒绝记录'); }
  fs.rmSync(temporary, { recursive: true });
  assert.equal(fs.existsSync(temporary), false);
  ownsTemporary = false;
}
if (fs.existsSync(temporary)) throw Error('任务临时目录已存在，拒绝覆盖');
for (const relative of ['', 'output', 'output/.tmp']) {
  const target = path.resolve(root, relative);
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target)) throw Error('临时父目录为链接');
}
process.once('exit', cleanup);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  process.exitCode = code; cleanup(); process.exit();
});
fs.mkdirSync(temporary, { recursive: true }); ownsTemporary = true;
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'audit.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const originalLoad = Module._load;
Module._load = function (name, ...rest) {
  if (name === '@prisma/client') throw Error('禁止加载默认生成 Client');
  return originalLoad.call(this, name, ...rest);
};
const { createControllerSourceLoader } = require(path.join(root, 'scripts/controller-sources.cjs'));
const loader = createControllerSourceLoader(root, deps), load = file => loader.load(path.join(root, file));
const { createRentalAiFileCleanupSource } = load('apps/rental-api/src/ai-file-cleanup-source.ts');
const { createRentalFileCleanupAuthority } = load('packages/rental-core/src/application-file-cleanup-authority.ts');
const { knowledgeUploadKey } = load('packages/ai-native-server/src/runtime/knowledge/human-knowledge-upload.service.ts');
const { knowledgeRecordSchema } = load('packages/ai-native-server/src/runtime/knowledge/knowledge-validation.ts');
const { AI_KNOWLEDGE_DRAFT_VERSION } = load('packages/shared/src/index.ts');
const { createRentalManifest } = load('packages/rental-core/src/manifest.ts');
const { createRentalServer } = load('packages/rental-core/src/server.ts');
const { coreBindingScopeKey, createCoreDeployedCatalogue } = load('packages/core-host/src/index.ts');
const source = createRentalAiFileCleanupSource(), copy = structuredClone;
const date = new Date('2026-01-01T00:00:00Z'), digest = 'a'.repeat(64);
const packageSource = { repository: 'https://github.com/example/offline-fixture', commit: 'a'.repeat(40) };
const manifest = createRentalManifest({ source: packageSource, assets: ['dist/server.js', 'admin/index.tsx'] });
const lock = { lockVersion: 1, platform: { source: packageSource, sha256: 'b'.repeat(64),
  versions: { platform: '0.1.0', contract: '0.1.1', node: '22.16.0', capabilities: {} },
  data: { version: '0.1.0', readable: { minInclusive: '0.1.0', maxExclusive: '0.2.0' }, migrations: [] } },
  cores: [{ manifest, sha256: 'c'.repeat(64) }] };
const forbidden = () => { throw Error('不得调用新业务、运输或另起事务'); };
const server = createRentalServer({ resolveAuthorizedBinding: forbidden, readReadiness: forbidden });
const schemas = ['apps/platform-api/prisma/schema.prisma', 'packages/ai-native-data/prisma/schema.prisma']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
function physicalTable(model) {
  const body = new RegExp('^model ' + model + ' \\{([\\s\\S]*?)^\\}', 'mu').exec(schemas)?.[1];
  assert(body, '实际所选 schema 缺模型 ' + model);
  return /@@map\("([^"]+)"\)/u.exec(body)?.[1] ?? model;
}
const documentTable = physicalTable('AiKnowledgeDocument'), sessionTable = physicalTable('FileUploadSession');

function fixture() {
  const state = { document: { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, documentId: 'document', documentVersion: 'v1',
    attachmentId: 'asset', scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' },
    owner: { actorKind: 'user', actorId: 'original_owner' }, aclRevision: 1, title: 'title', publication: 'draft',
    parsing: 'pending', indexing: 'not_indexed', validFrom: date.toISOString() }, revision: 1 };
  knowledgeRecordSchema.parse(state);
  const metadata = { workspaceId: 'workspace', knowledgeUploadVersion: 1, knowledgeContentHash: digest,
    fileUploadVersion: 2, fileContentVersion: 1, contentHash: digest, stagingStorageKey: 'tenant-files/tenant/asset/blob' };
  const asset = { id: 'asset', tenantId: 'tenant', businessModule: 'ai-native', businessType: 'ai_knowledge_document',
    businessId: 'document', fileName: 'knowledge.txt', fileExt: '.txt', mimeType: 'text/plain', sizeBytes: 10,
    storageProvider: 's3_compatible', storageKey: metadata.stagingStorageKey + '.committed/11111111-1111-4111-8111-111111111111/' + digest,
    publicUrl: null, checksum: digest, uploadScene: 'ai-knowledge', status: 'active', uploadedBy: 'original_owner',
    metadata, createdAt: date, updatedAt: date };
  const session = { id: 'session', tenantId: 'tenant', fileAssetId: 'asset', provider: asset.storageProvider,
    storageKey: asset.storageKey, status: 'completed', idempotencyKey: knowledgeUploadKey('document'), expiresAt: date,
    completedAt: date, failureReason: null, cleanupAttempts: 0, lastCleanupAt: null,
    cleanupError: 'staging_cleanup_pending', createdAt: date, updatedAt: date };
  const document = { id: 'document', tenantId: 'tenant', workspaceId: 'workspace', revision: 1, status: 'draft',
    withdrawnAt: null, createdAt: date, updatedAt: date, state };
  const db = { document, session }, calls = [], boundary = { operation: 'completed_staging', phase: 'claim', asset, session: copy(session) };
  let phase = 'locate', active = true, beforeLock;
  const tx = { async $queryRaw(query) {
    assert.equal(this, tx); assert(active);
    const sql = query.sql.replace(/\s+/gu, ' ').trim();
    assert.match(sql, /^SELECT /u); assert.doesNotMatch(sql, /\b(?:INSERT|DELETE|UPDATE SET)\b/u);
    const locked = /LOCK IN SHARE MODE|FOR UPDATE/u.test(sql);
    const kind = sql.includes('FROM ' + documentTable) ? 'document' : sql.includes('FROM ' + sessionTable) ? 'session' : null;
    if (!kind) {
      // Real Core authority below consumes original parent/grant/binding facts.
      assert(locked);
      if (sql.includes('FROM Tenant ')) { calls.push('Tenant'); assert.deepEqual(query.values, ['tenant']); return [{ id: 'tenant', status: 'active' }]; }
      if (sql.includes('FROM platform_core_access_locks ')) { calls.push('Core'); assert.deepEqual(query.values, ['tenant', 'rental']); return [{ tenantId: 'tenant', coreId: 'rental' }]; }
      if (sql.includes('FROM platform_tenant_core_grants ')) { calls.push('grant'); return [{ state: 'disabled', revision: 1, operationId: 'original-grant' }]; }
      if (sql.includes('FROM platform_core_bindings ')) {
        calls.push('Binding');
        const hash = createHash('sha256').update(coreBindingScopeKey({ coreId: 'rental', tenantId: 'tenant', container: { type: 'rental-workspace', id: 'workspace' } })).digest('hex');
        assert.deepEqual(query.values, ['tenant', 'rental', hash]);
        return [{ bindingId: 'binding', revision: 1, dataVersion: manifest.data.version, containerType: 'rental-workspace', containerId: 'workspace' }];
      }
      if (sql.includes('FROM business_workspaces ')) { calls.push('Workspace'); assert.deepEqual(query.values, ['tenant', 'workspace']); phase = 'workspace_locked'; return [{ id: 'workspace', tenantId: 'tenant', status: 'active' }]; }
      throw Error('未知 SQL');
    }
    if (locked) {
      assert.equal(phase, 'workspace_locked');
      if (beforeLock) { const action = beforeLock; beforeLock = undefined; action(db); }
    }
    calls.push(kind + (locked ? ':lock' : ':read'));
    if (kind === 'document') {
      assert.deepEqual(query.values, ['tenant', 'document']);
      assert.doesNotMatch(sql, /\$\.document\.title|SELECT \*|\btitle\b/u);
      if (locked) assert.match(sql, /LOCK IN SHARE MODE$/u);
      if (!db.document) return [];
      const { state: stored, ...row } = db.document, d = stored.document;
      return [{ ...copy(row), source: JSON.stringify({ draftVersion: d.draftVersion, documentId: d.documentId,
        documentVersion: d.documentVersion, attachmentId: d.attachmentId, scope: d.scope, owner: d.owner,
        aclRevision: d.aclRevision, publication: d.publication, contentHash: stored.contentHash ?? null, revision: stored.revision }) }];
    }
    assert.deepEqual(query.values, ['tenant', 'asset']);
    if (locked) assert.match(sql, /FOR UPDATE$/u);
    if (!db.session) return [];
    const { id, tenantId, fileAssetId, provider, storageKey, idempotencyKey, status, completedAt, expiresAt, updatedAt } = db.session;
    return copy([{ id, tenantId, fileAssetId, provider, storageKey, idempotencyKey, status, completedAt, expiresAt, updatedAt }]);
  }, $transaction: forbidden, $executeRaw: forbidden };
  return { db, boundary, calls, tx, lock() { phase = 'workspace_locked'; }, close() { active = false; }, onLock(fn) { beforeLock = fn; } };
}
async function admit(f) {
  const located = await source.resolveOwnedWorkspace(f.tx, f.boundary);
  assert.equal(located.workspaceId, 'workspace'); assert.deepEqual(f.calls, ['document:read', 'session:read']);
  f.lock(); await located.assertLocked();
  assert.deepEqual(f.calls, ['document:read', 'session:read', 'document:lock', 'session:lock']);
  return located;
}
const denied = error => error.code === 'denied';
let cases = 0;
test('原知识清理来源与同事务锁序', async t => {
  await t.test('当前附件与原 frozen 完成收据通过；不读取加密标题', async () => {
    await admit(fixture()); cases++;
    const f = fixture();
    Object.defineProperty(f.db.document.state.document, 'title', { get() { throw Error('不得读取正文'); }, enumerable: true });
    await admit(f); cases++;
  });
  await t.test('新版本可由另一操作者上传；原 targetVersion/key/revision 保留', async () => {
    const f = fixture(); f.db.document.revision = f.db.document.state.revision = 5;
    Object.assign(f.db.document.state.document, { documentVersion: 'v2', aclRevision: 2 });
    f.boundary.asset.uploadedBy = 'later_editor';
    f.boundary.asset.metadata.knowledgeRevision = { documentVersion: 'v1', targetVersion: 'v2', expectedRevision: 4, aclRevision: 2 };
    f.db.session.idempotencyKey = knowledgeUploadKey('document', 'v2'); f.boundary.session = copy(f.db.session);
    await admit(f); cases++;
  });
  await t.test('已保存删除墓碑仍指向原附件；pending_delete 没有新上传意图', async () => {
    const f = fixture(); f.boundary = { operation: 'pending_delete', phase: 'claim', asset: { ...f.boundary.asset, status: 'delete_pending' } };
    f.db.document.status = f.db.document.state.document.publication = 'deleted';
    await admit(f); cases++;
  });
  await t.test('未知来源、跨租户同 ID、旧附件与无完成证据均拒绝', async () => {
    for (const change of [
      f => f.db.document = null,
      f => f.db.document.tenantId = 'foreign',
      f => f.db.document.state.document.scope.tenantId = 'foreign',
      f => f.db.document.state.document.scope.workspaceId = 'foreign',
      f => f.db.document.state.document.attachmentId = 'old-attachment',
      f => f.db.document.revision = 2,
      f => f.db.document.status = 'published',
      f => f.db.document.state.document.draftVersion = 'unknown',
      f => f.db.document.state.document.scope = { kind: 'tenant', tenantId: 'tenant' },
      f => f.db.document.withdrawnAt = date,
      f => f.db.document.state.contentHash = 'b'.repeat(64),
      f => f.boundary.asset.metadata.workspaceId = 'other',
      f => f.boundary.asset.metadata.knowledgeRevision = { targetVersion: 'v2' },
      f => f.db.session = null,
      f => f.db.session.tenantId = 'foreign',
      f => f.db.session.idempotencyKey = knowledgeUploadKey('document', 'wrong'),
      f => f.db.session.storageKey = 'other',
      f => f.db.session.status = 'freeze_pending',
      f => f.db.session.completedAt = null
    ]) {
      const f = fixture(); change(f);
      await assert.rejects(source.resolveOwnedWorkspace(f.tx, f.boundary), denied);
      assert(f.calls.every(call => !call.endsWith(':lock'))); cases++;
    }
  });
  await t.test('等 Workspace 后来源漂移不能借原 locator 继续', async () => {
    for (const change of [
      db => db.document.state.document.attachmentId = 'other',
      db => db.document.state.document.scope.workspaceId = 'other',
      db => db.document.updatedAt = new Date(date.getTime() + 1),
      db => db.session.idempotencyKey = 'wrong',
      db => db.session.updatedAt = new Date(date.getTime() + 1)
    ]) {
      const f = fixture(), located = await source.resolveOwnedWorkspace(f.tx, f.boundary);
      f.lock(); f.onLock(change); await assert.rejects(located.assertLocked(), denied); cases++;
    }
  });
  await t.test('捕获原边界；result-only 不变成清理准入', async () => {
    const f = fixture(), located = await source.resolveOwnedWorkspace(f.tx, f.boundary);
    f.boundary.asset.businessId = 'foreign'; f.boundary.asset.metadata.workspaceId = 'foreign';
    f.lock(); await located.assertLocked(); cases++;
    const result = fixture(); result.boundary.phase = 'result';
    await assert.rejects(source.resolveOwnedWorkspace(result.tx, result.boundary), denied);
    assert.equal(result.calls.length, 0); cases++;
    f.close(); await assert.rejects(located.assertLocked()); cases++;
  });
  await t.test('实际父级权威先 Binding/Workspace/config 接点，再 Document/Session', async () => {
    const f = fixture();
    const catalogue = createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server }], observations: {
      async read(coreId) {
        assert.equal(coreId, 'rental'); f.calls.push('deployment');
        return { platform: { version: lock.platform.data.version, appliedMigrations: [], execution: { state: 'ready' } },
          cores: [{ coreId: 'rental', version: manifest.data.version,
            appliedMigrations: manifest.data.migrations.map(({ id, sha256 }) => ({ id, sha256 })), execution: { state: 'ready' } }] };
      }
    } });
    const authority = createRentalFileCleanupAuthority({ knowledge: source, deploymentForTransaction(tx) {
      assert.equal(tx, f.tx); return catalogue.availability;
    } });
    // Config's own authorization/transport belongs to file-cleanup-authority.test;
    // this assertion checks its mandatory position before source/session locks.
    await authority.assert(f.tx, f.boundary, async () => { assert.equal(f.calls.at(-1), 'Workspace'); f.calls.push('config'); });
    assert.deepEqual(f.calls, ['Tenant', 'Core', 'grant', 'document:read', 'session:read', 'Binding', 'Workspace',
      'config', 'document:lock', 'session:lock', 'deployment']); cases++;
  });
  t.diagnostic(JSON.stringify({ cases, defaultClientLoads: 0, businessWrites: 0, externalCalls: 0 }));
}).finally(() => { Module._load = originalLoad; cleanup(); });
