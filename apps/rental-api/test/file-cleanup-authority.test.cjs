'use strict';
/** Real selected Rental cleanup authority, catalogue, integration config and
 * original cleanup/presigning. Only row storage and object transport are fixtures.
 * node apps/rental-api/test/file-cleanup-authority.test.cjs --deps <node_modules>
 * All state is in memory; the guarded task directory must remain absent.
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Module = require('node:module'), { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/rental-lead-data');
assert.equal(fs.existsSync(temporary), false);
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name === '@prisma/client') throw Error('禁止默认生成 Client 运行时');
  return originalLoad.call(this, name, ...rest);
};
const { createControllerSourceLoader } = require(path.join(root, 'scripts/controller-sources.cjs'));
const loader = createControllerSourceLoader(root, deps), load = file => loader.load(path.join(root, file));
const { createRentalFileCleanupAuthority } = load('packages/rental-core/src/application-file-cleanup-authority.ts');
const { RentalFileStorageApplication } = load('packages/rental-core/src/file-application-runtime.ts');
const { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } = load('packages/rental-core/src/exchange-inspection-preparation.ts');
const { createRentalManifest } = load('packages/rental-core/src/manifest.ts');
const { createRentalServer } = load('packages/rental-core/src/server.ts');
const { coreBindingScopeKey, createCoreDeployedCatalogue } = load('packages/core-host/src/index.ts');
const { TenantIntegrationService } = load('packages/platform-server/src/modules/integrations/tenant-integration.service.ts');
const { SecretBox } = load('packages/platform-server/src/common/secret-box.ts');
const { PlatformOperationLogService } = load('packages/platform-server/src/common/operation-log.service.ts');
const { requestFingerprint } = load('packages/platform-contracts/src/request-fingerprint.ts');
const { fileStorageLocationHash } = load('packages/platform-contracts/src/file-content-binding.ts');
const { ConfigService } = loader.requireDependency('@nestjs/config');
const NativeDate = Date;
let time = NativeDate.now();
globalThis.Date = class extends NativeDate {
  constructor(...values) { super(...(values.length ? values : [time])); return new NativeDate(this.getTime()); }
  static now() { return time; }
  static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
};
const copy = value => structuredClone(value), advance = () => { time += 11 * 60 * 1000; };
const source = { repository: 'https://github.com/example/offline-fixture', commit: 'a'.repeat(40) };
const manifest = createRentalManifest({ source, assets: ['dist/server.js', 'admin/index.tsx'] });
const lock = { lockVersion: 1, platform: { source, sha256: 'b'.repeat(64),
  versions: { platform: '0.1.0', contract: '0.1.1', node: '22.16.0', capabilities: {} },
  data: { version: '0.1.0', readable: { minInclusive: '0.1.0', maxExclusive: '0.2.0' }, migrations: [] } },
  cores: [{ manifest, sha256: 'c'.repeat(64) }] };
const forbidden = () => { throw Error('unexpected non-cleanup participant'); };
const server = createRentalServer({ resolveAuthorizedBinding: forbidden, readReadiness: forbidden });
const schemas = ['apps/platform-api/prisma/schema.prisma', 'packages/rental-core/prisma/schema.prisma']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const physicalTable = model => {
  const body = new RegExp('^model ' + model + ' \\{([\\s\\S]*?)^\\}', 'mu').exec(schemas)?.[1];
  assert(body, 'missing actual selected model: ' + model);
  return /@@map\("([^"]+)"\)/u.exec(body)?.[1] ?? model;
};
const sourceTables = Object.fromEntries(['rentalOrder', 'rentalQuote', 'rentalItemGroup', 'rentalAsset', 'rentalWorkOrder',
  'customerProfile', 'customerCorporateContract', 'customerCorporateInvoiceProfile', 'customerCorporateCredit',
  'customerMembershipReview', 'asyncJob', 'documentPrintJob'].map(name => [name, physicalTable(name[0].toUpperCase() + name.slice(1))]));
function matches(row, where = {}, state) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some(item => matches(row, item, state));
    if (key === 'AND') return value.every(item => matches(row, item, state));
    if (key === 'fileAsset') return state.assets.some(asset => asset.id === row.fileAssetId && matches(asset, value.is, state));
    if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('lte' in value) return row[key] != null && row[key] <= value.lte;
      throw Error('unexpected storage predicate: ' + key);
    }
    return row[key] === value;
  });
}
function projection(row, select) {
  if (!row) return null;
  return copy(select ? Object.fromEntries(Object.entries(select).filter(([, selected]) => selected).map(([key]) => [key, row[key]])) : row);
}

async function fixture(operation = 'expired_upload', options = {}) {
  const tenantId = 'tenant-cleanup', workspaceId = 'workspace-cleanup', original = new Date(time - 60 * 60 * 1000);
  const f = { trace: [], statements: [], transports: [], errors: [], sequence: 0, active: undefined, tenantId, workspaceId };
  const configService = new ConfigService({ NODE_ENV: 'test', AUTH_TOKEN_SECRET: 'offline-file-cleanup-only' });
  const secrets = new SecretBox(configService);
  const config = { id: 'config-cleanup', tenantId, capability: 'file', provider: 's3_compatible', enabled: true, isDefault: true,
    settings: { endpoint: 'https://storage.example.invalid', bucket: 'files', region: 'us-east-1', forcePathStyle: true },
    credentialsEncrypted: secrets.encrypt({ accessKeyId: 'offline', secretAccessKey: 'offline-fixture-only' }),
    secretFields: ['accessKeyId', 'secretAccessKey'], lastTestStatus: 'passed', lastTestMode: 'live',
    lastTestAt: original, lastTestError: null, createdAt: original, updatedAt: original };
  const scope = { coreId: 'rental', tenantId, container: { type: 'rental-workspace', id: workspaceId } };
  const binding = container => ({ bindingId: container ? 'workspace-binding' : 'tenant-binding', revision: 1,
    dataVersion: manifest.data.version, containerType: container?.type ?? null, containerId: container?.id ?? null,
    hash: createHash('sha256').update(coreBindingScopeKey({ coreId: 'rental', tenantId, ...(container ? { container } : {}) })).digest('hex') });
  f.state = { tenant: { id: tenantId, status: 'active' }, gate: { tenantId, coreId: 'rental' },
    grant: { state: options.grant ?? 'enabled', revision: 1, operationId: 'original-grant' },
    bindings: [binding(scope.container), binding()], workspaces: [{ id: workspaceId, tenantId, status: 'active' }],
    observation: { platform: { version: lock.platform.data.version, appliedMigrations: [], execution: { state: 'ready' } },
      cores: [{ coreId: 'rental', version: manifest.data.version, appliedMigrations: manifest.data.migrations.map(({ id, sha256 }) => ({ id, sha256 })),
        execution: { state: 'ready' } }] }, configs: [config], assets: [], sessions: [], logs: [], knowledgeDocuments: [],
    ...Object.fromEntries(Object.keys(sourceTables).map(name => [name, []])) };
  f.state.rentalOrder.push({ id: 'order-cleanup', tenantId, workspaceId });
  const delegate = (state, table, transaction) => ({
    async findFirst(query) { await f.onRead?.(table, query, transaction, state()); return projection(state()[table].find(row => matches(row, query.where, state())), query.select); },
    async findMany(query) {
      await f.onRead?.(table, query, transaction, state());
      const rows = state()[table].filter(row => matches(row, query.where, state()));
      return query.distinct ? [...new Set(rows.map(row => row.tenantId))].map(tenantId => ({ tenantId }))
        : rows.slice(0, query.take ?? rows.length).map(row => projection(row, query.select));
    },
    async updateMany(query) {
      assert(transaction, 'cleanup facts must be written in their original transaction');
      f.trace.push(`${transaction}:${table}.write`);
      await f.onWrite?.(table, query, transaction, state());
      const rows = state()[table].filter(row => matches(row, query.where, state()));
      for (const row of rows) {
        const data = copy(query.data);
        if (data.cleanupAttempts) data.cleanupAttempts = row.cleanupAttempts + data.cleanupAttempts.increment;
        Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date(Math.max(time, row.updatedAt.getTime() + 1)) });
      }
      return { count: rows.length };
    },
    async create({ data }) { assert.equal(table, 'logs'); state()[table].push(copy(data)); return copy(data); }
  });
  const storage = (state, transaction) => {
    const db = Object.fromEntries(Object.keys(sourceTables).map(name => [name, delegate(state, name, transaction)]));
    Object.assign(db, { fileAsset: delegate(state, 'assets', transaction), fileUploadSession: delegate(state, 'sessions', transaction),
      tenantIntegrationConfig: delegate(state, 'configs', transaction), operationLog: delegate(state, 'logs', transaction),
      async $queryRaw(query) {
        assert(transaction, 'authority must use the original transaction');
        const sql = query.sql.replace(/\s+/gu, ' ').trim(), values = query.values;
        const table = / FROM ([A-Za-z_]+)/u.exec(sql)?.[1];
        f.trace.push(`${transaction}:${table}.${/(?:FOR UPDATE|LOCK IN SHARE MODE)$/u.test(sql) ? 'lock' : 'read'}`);
        f.statements.push({ transaction, sql });
        await f.onSql?.(table, values, transaction, state(), sql);
        const current = state();
        if (table === 'Tenant') return current.tenant?.id === values[0] ? [copy(current.tenant)] : [];
        if (table === 'platform_core_access_locks') return current.gate?.tenantId === values[0] && current.gate.coreId === values[1] ? [copy(current.gate)] : [];
        if (table === 'platform_tenant_core_grants') return current.grant ? [copy(current.grant)] : [];
        if (table === 'platform_core_bindings') return current.bindings.filter(row => row.hash === values[2]).map(copy);
        if (table === 'tenant_integration_configs') return current.configs.filter(row => row.tenantId === values[0] && row.capability === values[1] && row.provider === values[2]).map(copy);
        if (table === 'ai_knowledge_documents') return current.knowledgeDocuments.filter(row => row.tenantId === values[0] && row.id === values[1]).map(copy);
        const key = table === physicalTable('BusinessWorkspace') ? 'workspaces' : table === physicalTable('FileAsset') ? 'assets' : table === physicalTable('FileUploadSession') ? 'sessions'
          : Object.entries(sourceTables).find(([, name]) => name === table)?.[0];
        if (!key) throw Error('unexpected cleanup SQL: ' + sql);
        return current[key].filter(row => row.tenantId === values[0]
          && (sql.includes('AND fileAssetId=') ? row.fileAssetId : row.id) === values[1]).map(copy);
      }
    });
    return db;
  };
  let tail = Promise.resolve();
  f.database = storage(() => f.state);
  f.database.$transaction = (consume, settings) => {
    const run = tail.then(async () => {
      assert.deepEqual(settings, { isolationLevel: 'ReadCommitted' });
      const snapshot = copy(f.state), id = ++f.sequence, tx = storage(() => snapshot, id);
      f.active = tx; f.trace.push(`${id}:begin`);
      let result;
      try { result = await consume(tx); }
      catch (error) { f.trace.push(`${id}:rollback`); f.errors.push(error); throw error; }
      finally { f.active = undefined; }
      f.state = snapshot; f.trace.push(`${id}:commit`);
      await f.afterCommit?.(id);
      return result;
    });
    tail = run.catch(() => undefined); return run;
  };
  const logs = new PlatformOperationLogService(f.database);
  const integrations = new TenantIntegrationService(f.database, secrets, logs);
  const runtime = await integrations.runtimeConfig('file', tenantId, 's3_compatible');
  const asset = { id: 'asset-cleanup', tenantId, businessModule: 'rental-core', businessType: 'rental_order', businessId: 'order-cleanup',
    fileName: 'evidence.pdf', fileExt: 'pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageProvider: runtime.provider,
    storageKey: `tenant-files/${tenantId}/asset-cleanup/blob`, publicUrl: null, checksum: null, uploadScene: 'order-contract',
    status: operation === 'pending_delete' ? 'delete_pending' : operation === 'completed_staging' ? 'active' : 'pending_upload',
    uploadedBy: null, createdAt: original, updatedAt: original, metadata: { fileUploadVersion: 2, storageLocationHash: fileStorageLocationHash(runtime),
      uploadConfigHash: requestFingerprint({ id: runtime.id, provider: runtime.provider, settings: runtime.settings, credentials: runtime.credentials }) } };
  if (operation === 'completed_staging') {
    asset.checksum = 'd'.repeat(64); asset.metadata.fileContentVersion = 1; asset.metadata.contentHash = asset.checksum;
    asset.metadata.stagingStorageKey = asset.storageKey;
    asset.storageKey += '.committed/11111111-1111-4111-8111-111111111111/' + asset.checksum;
  }
  f.state.assets.push(asset);
  if (operation !== 'pending_delete') f.state.sessions.push({ id: 'session-cleanup', tenantId, fileAssetId: asset.id,
    provider: asset.storageProvider, storageKey: asset.storageKey, idempotencyKey: 'original-upload-key',
    status: operation === 'completed_staging' ? 'completed' : 'pending_upload',
    expiresAt: original, completedAt: operation === 'completed_staging' ? original : null,
    createdAt: original, updatedAt: original, failureReason: null, cleanupAttempts: 0, lastCleanupAt: null,
    cleanupError: operation === 'completed_staging' ? 'completed_staging_pending' : null });
  let knowledge;
  if (options.knowledge) {
    assert.equal(operation, 'completed_staging', 'knowledge fixture starts with a real completed frozen source');
    const { createRentalAiFileCleanupSource } = load('apps/rental-api/src/ai-file-cleanup-source.ts');
    const { knowledgeUploadKey } = load('packages/ai-native-server/src/runtime/knowledge/human-knowledge-upload.service.ts');
    const { AI_KNOWLEDGE_DRAFT_VERSION } = load('packages/shared/src/ai-knowledge-draft.ts');
    knowledge = createRentalAiFileCleanupSource();
    Object.assign(asset, { businessModule: 'ai-native', businessType: 'ai_knowledge_document', businessId: 'document-cleanup',
      uploadScene: 'ai-knowledge', uploadedBy: 'user-original' });
    Object.assign(asset.metadata, { knowledgeUploadVersion: 1, knowledgeContentHash: asset.checksum, workspaceId });
    f.state.sessions[0].idempotencyKey = knowledgeUploadKey(asset.businessId);
    f.state.knowledgeDocuments.push({ id: asset.businessId, tenantId, workspaceId, revision: 1, status: 'draft',
      withdrawnAt: null, createdAt: original, updatedAt: original, source: JSON.stringify({ draftVersion: AI_KNOWLEDGE_DRAFT_VERSION,
        documentId: asset.businessId, documentVersion: 'version-original', attachmentId: asset.id,
        scope: { kind: 'workspace', tenantId, workspaceId }, owner: { actorKind: 'user', actorId: 'user-original' },
        aclRevision: 1, publication: 'draft', contentHash: asset.checksum, revision: 1 }) });
  }
  const authority = createRentalFileCleanupAuthority({ ...(knowledge ? { knowledge } : {}), deploymentForTransaction(tx) {
    assert.equal(tx, f.active);
    return createCoreDeployedCatalogue({ lock, registrations: [{ manifest, server }], observations: { async read() {
      assert.equal(tx, f.active); f.trace.push(`${f.sequence}:deployment.read`); return copy(f.state.observation);
    } } }).availability;
  } });
  f.files = new RentalFileStorageApplication(f.database, integrations, { cleanupAuthority: authority, operationLog: logs,
    readInspectionMedia: forbidden, parseStaffUploadObservation: forbidden });
  f.files.objectRequest = async (url, init) => {
    assert.equal(f.active, undefined, 'no storage request while database transaction is held');
    f.transports.push({ method: init.method, pathname: new URL(url).pathname });
    return f.onTransport ? f.onTransport(init.method) : new Response(null, { status: 204 });
  };
  f.run = () => operation === 'pending_delete' ? f.files.cleanupPendingFileAssetDeletesForAllTenants()
    : f.files.cleanupExpiredUploadSessionsForAllTenants();
  return f;
}

let checks = 0;
async function test(name, consume) { await consume(); checks += 1; console.log('ok ' + name); }
const facts = f => copy({ assets: f.state.assets, sessions: f.state.sessions });
const noDelete = f => assert(!f.transports.some(value => value.method === 'DELETE'));
async function main() {
  await test('三原清理场景/已登记 disabled，真实授权、部署与配置，原父锁序', async () => {
    for (const operation of ['expired_upload', 'completed_staging', 'pending_delete']) for (const grant of ['enabled', 'disabled']) {
      const f = await fixture(operation, { grant });
      // Original recovery deliberately does not require a new live connectivity
      // test; the same enabled provider/config revision must still be locked.
      if (grant === 'disabled') f.state.configs[0].lastTestStatus = 'failed';
      const result = await f.run();
      assert.equal(result.deleted ?? result.deletedObjects, 1); assert.deepEqual(f.transports.map(row => row.method), ['DELETE']);
      const tables = f.trace.filter(value => value.startsWith('1:')).join(' ');
      assert.match(tables, /Tenant\.lock.*platform_core_access_locks\.lock.*platform_tenant_core_grants\.lock.*platform_core_bindings\.lock.*rental_orders\.lock.*business_workspaces\.lock.*FileAsset\.lock/u);
      if (operation !== 'pending_delete') assert.match(tables, /file_upload_sessions\.lock.*FileAsset\.lock/u);
      assert(f.statements.filter(row => /FROM (?:FileAsset|file_upload_sessions)/u.test(row.sql)).some(row => row.sql.endsWith('FOR UPDATE')));
      const dispatch = f.trace.filter(value => value.startsWith(`${operation === 'expired_upload' ? 3 : 2}:`)).join(' ');
      assert.match(dispatch, /Tenant\.lock.*business_workspaces\.lock.*tenant_integration_configs\.lock.*FileAsset\.lock/u);
      if (operation !== 'pending_delete') assert.match(dispatch, /tenant_integration_configs\.lock.*file_upload_sessions\.lock/u);
      assert.equal(f.errors.length, 0); assert.equal(f.state.logs.length, 1);
    }
  });
  await test('physical frozen/缺 grant gate binding/部署 pending 均拒绝占用，不造成功', async () => {
    const changes = [state => { state.tenant.status = 'frozen'; }, state => { state.workspaces[0].status = 'frozen'; },
      state => { state.grant = null; }, state => { state.gate = null; }, state => { state.bindings = []; },
      state => { state.observation.cores[0].execution = { state: 'pending' }; }];
    for (const change of changes) {
      const f = await fixture(); change(f.state); const before = facts(f), result = await f.run();
      assert.equal(result.cleanupPending, 1); assert.deepEqual(facts(f), before); noDelete(f);
      assert(!f.trace.some(value => value.endsWith('.write')));
    }
  });
  await test('其他 Core/伪 metadata/缺真实对象/知识来源/保留 scene 均不取得 Rental 权威', async () => {
    const changes = [state => { state.assets[0].businessModule = 'tickets'; },
      state => { state.rentalOrder = []; state.assets[0].metadata.workspaceId = 'workspace-cleanup'; },
      state => { Object.assign(state.assets[0], { businessModule: 'ai-native', businessType: 'ai_knowledge_document', businessId: 'doc', uploadScene: 'ai-knowledge' }); },
      state => { state.assets[0].uploadScene = RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE; }];
    for (const change of changes) {
      const f = await fixture(); change(f.state); const before = facts(f); await f.run();
      noDelete(f); assert.deepEqual(facts(f), before);
    }
  });
  await test('原对象锁等待后指针变化拒绝；work order 原 Order→Workspace→Asset→WorkOrder', async () => {
    const f = await fixture();
    f.onSql = async (table, values, transaction, state) => { if (table === 'rental_orders') state.rentalOrder[0].workspaceId = 'changed-space'; };
    const before = facts(f); await f.run(); noDelete(f); assert.deepEqual(facts(f), before);
    const w = await fixture(); w.state.assets[0].businessType = 'rental_work_order'; w.state.assets[0].businessId = 'work';
    w.state.rentalAsset.push({ id: 'inventory', tenantId: w.tenantId, workspaceId: w.workspaceId });
    w.state.rentalWorkOrder.push({ id: 'work', tenantId: w.tenantId, workspaceId: w.workspaceId, orderId: 'order-cleanup', assetId: 'inventory' });
    assert.equal((await w.run()).deletedObjects, 1);
    assert.match(w.trace.filter(value => value.startsWith('1:')).join(' '), /rental_orders\.lock.*business_workspaces\.lock.*rental_assets\.lock.*rental_work_orders\.lock.*file_upload_sessions\.lock/u);
  });
  await test('租户共享客户附件使用真实 tenant binding；review 来源空间必须同租户', async () => {
    for (const crossTenant of [false, true]) {
      const f = await fixture(); Object.assign(f.state.assets[0], { businessModule: 'membership', businessType: 'membership_review', businessId: 'review' });
      f.state.customerProfile.push({ id: 'customer', tenantId: f.tenantId });
      f.state.customerMembershipReview.push({ id: 'review', tenantId: f.tenantId, customerId: 'customer', sourceWorkspaceId: 'origin' });
      f.state.workspaces.push({ id: 'origin', tenantId: crossTenant ? 'other-tenant' : f.tenantId, status: 'frozen' });
      f.state.bindings = f.state.bindings.filter(row => !row.containerId);
      const before = facts(f), result = await f.run();
      if (crossTenant) { noDelete(f); assert.deepEqual(facts(f), before); }
      else { assert.equal(result.deletedObjects, 1); assert.match(f.trace.join(' '), /customer_profiles\.lock.*business_workspaces\.lock.*customer_membership_reviews\.lock/u); }
    }
  });
  await test('外部 DELETE 后冻结不覆盖已确认原收据；三场景同事务精确 result CAS', async () => {
    for (const operation of ['expired_upload', 'completed_staging', 'pending_delete']) {
      const f = await fixture(operation);
      f.onTransport = async () => { f.state.tenant.status = 'frozen'; f.state.grant = null; return new Response(null, { status: 204 }); };
      const result = await f.run(); assert.equal(result.deleted ?? result.deletedObjects, 1);
      assert.equal(f.transports.length, 1); assert.equal(f.errors.length, 0);
    }
  });
  await test('失 claim COMMIT 应答/DELETE unknown/TTL 后只能原 HEAD，不泄漏 provider 错误', async () => {
    for (const operation of ['expired_upload', 'completed_staging', 'pending_delete']) for (const lost of [true, false]) {
      const f = await fixture(operation);
      if (lost) f.afterCommit = async id => { if (id === 1) throw Error('lost commit response'); };
      else f.onTransport = async () => { throw Error('provider-secret-must-not-leak'); };
      await f.run(); assert.equal(f.transports.filter(row => row.method === 'DELETE').length, lost ? 0 : 1);
      assert(!JSON.stringify(f.state).includes('provider-secret-must-not-leak'));
      f.afterCommit = undefined; f.onTransport = async () => new Response(null, { status: 404 }); advance();
      const result = await f.run(); assert.equal(result.deleted ?? result.deletedObjects, 1);
      assert.equal(f.transports.at(-1).method, 'HEAD'); assert.equal(f.transports.filter(row => row.method === 'DELETE').length, lost ? 0 : 1);
    }
  });
  await test('并发清理仅提交占用者一次 DELETE；另一调用不能继承私有派发凭据', async () => {
    const f = await fixture(); await Promise.all([f.run(), f.run()]);
    assert.deepEqual(f.transports.map(value => value.method), ['DELETE']); assert.equal(f.state.sessions[0].cleanupError, null);
  });
  await test('运输前撤权/config CAS/asset/session 变化均拒绝旧 DELETE；结果 CAS 不覆盖新写者', async () => {
    for (const kind of ['grant', 'config', 'asset', 'session']) {
      const f = await fixture();
      f.onSql = async (table, values, transaction, state) => {
        if (transaction !== 3) return;
        if (kind === 'grant' && table === 'Tenant') state.grant = null;
        if (kind === 'config' && table === 'tenant_integration_configs') state.configs[0].updatedAt = new Date(time + 1);
        if (kind === 'asset' && table === 'FileAsset') state.assets[0].businessId = 'other-order';
        if (kind === 'session' && table === 'file_upload_sessions') state.sessions[0].idempotencyKey = 'new-writer';
      };
      await f.run(); noDelete(f); assert(f.errors.length > 0);
    }
    for (const operation of ['expired_upload', 'completed_staging', 'pending_delete']) {
      const f = await fixture(operation);
      f.onTransport = async () => { f.state.assets[0].metadata.otherWriter = 'retained'; return new Response(null, { status: 204 }); };
      const result = await f.run(); assert.equal(result.deleted ?? result.deletedObjects, 0);
      assert.equal(f.state.assets[0].metadata.otherWriter, 'retained'); assert(f.errors.length > 0);
    }
  });
  await test('local_mock 仍先真实授权；原手动入口不升级为 worker 系统授权', async () => {
    for (const frozen of [false, true]) {
      const f = await fixture(); f.state.assets[0].storageProvider = 'local_mock'; f.state.sessions[0].provider = 'local_mock';
      if (frozen) f.state.tenant.status = 'frozen';
      const result = await f.run(); assert.equal(result.deletedObjects, frozen ? 0 : 1); assert.equal(f.transports.length, 0);
    }
    const f = await fixture(); f.state.gate = null;
    // Legacy/manual call keeps the original fence and does not use the new
    // system exception. No selected request scope is invented by this fixture.
    const result = await f.files.cleanupExpiredUploadSessions(f.tenantId);
    assert.equal(result.deletedObjects, 1); assert(!f.trace.some(value => value.includes('platform_core_access_locks')));
  });
  await test('真实知识source延后锁：Workspace→config→Document→Session→File，来源等待变化拒绝', async () => {
    const f = await fixture('completed_staging', { knowledge: true });
    assert.equal((await f.run()).deletedObjects, 1);
    const dispatch = f.trace.filter(value => value.startsWith('2:')).join(' ');
    assert.match(dispatch, /ai_knowledge_documents\.read.*business_workspaces\.lock.*tenant_integration_configs\.lock.*ai_knowledge_documents\.lock.*file_upload_sessions\.lock.*FileAsset\.lock/u);
    assert.equal(f.errors.length, 0);
    for (const kind of ['missing-source', 'changed-source', 'changed-session']) {
      const denied = await fixture('completed_staging', { knowledge: true });
      if (kind === 'missing-source') denied.state.knowledgeDocuments = [];
      else denied.onSql = async (table, values, tx, state, sql) => {
        if (!/(?:FOR UPDATE|LOCK IN SHARE MODE)$/u.test(sql)) return;
        if (kind === 'changed-source' && table === 'ai_knowledge_documents') state.knowledgeDocuments[0].updatedAt = new Date(time + 1);
        if (kind === 'changed-session' && table === 'file_upload_sessions') state.sessions[0].idempotencyKey = 'other-operation';
      };
      const before = facts(denied); await denied.run(); noDelete(denied); assert.deepEqual(facts(denied), before);
    }
  });
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ checks, realAuthority: true, realDeploymentCatalogue: true, realIntegrationConfig: true,
    storage: 'transactional in-memory rows', objectTransport: 'fixture only', diskOutputs: 0, network: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.Date = NativeDate; Module._load = originalLoad;
  assert.equal(fs.existsSync(temporary), false);
});
