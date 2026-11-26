'use strict';
/** CRM 首片离线行为：真实包内存编译，真实领域/SQL/绑定运行时，仅替换 SQL 运输与授权租约。
 * 不启动 Client、服务或数据库；编译和事务全部在内存，专用临时路径应始终不存在。
 * 用法：node packages/crm-core/test/settings.test.cjs --deps <已有 node_modules 绝对路径> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !path.isAbsolute(args[1] || '')))
  throw Error('只接受 --deps <原只读 node_modules 绝对路径>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/crm-settings');
assert.equal(fs.existsSync(temporary), false, '不覆盖已有任务临时目录');
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require('../../../tests/fixtures/ai-native/prisma-offline-preload.cjs');
const { createBuild } = require('../../../scripts/check-rental-package-build.cjs');
const clone = value => structuredClone(value), key = (...parts) => JSON.stringify(parts);
const alice = Object.freeze({ tenantId: 'tenant-a', subjectId: 'alice', audience: 'operator' });
const bob = Object.freeze({ tenantId: 'tenant-a', subjectId: 'bob', audience: 'operator' });
const carol = Object.freeze({ tenantId: 'tenant-b', subjectId: 'carol', audience: 'operator' });
const defaults = Object.freeze({ timeZone: 'Asia/Shanghai', defaultCurrency: 'CNY' });
const fixedTime = '2026-11-26T03:00:00.000Z', clock = () => new Date(fixedTime);
const errorCode = code => error => error && error.code === code;

function fixture(api, manifest) {
  const f = { state: { settings: new Map(), pipelines: new Map(), receipts: new Map(), bindings: new Map(),
    bindingReceipts: new Map(), locks: new Set(), audits: [] }, actor: alice, enabled: true,
    failAudit: undefined, failRevalidate: undefined, casMiss: false, overrideAccess: undefined,
    calls: [], transactions: 0, rollbacks: 0, latestHandle: undefined, latestScope: undefined };
  let tail = Promise.resolve();
  const current = principal => {
    if (!f.enabled || principal.audience !== 'operator' || principal.tenantId !== f.actor.tenantId || principal.subjectId !== f.actor.subjectId)
      throw new api.CrmError('denied', 'fixture 原授权租约已失效或主体不符');
  };
  const audit = (tx, kind, value) => {
    assert(tx.active, '审计必须位于活跃事务');
    if (f.failAudit === kind) throw Error('fixture audit failure');
    tx.state.audits.push({ tx: tx.id, kind, value: clone(value) });
  };
  // 严格解释本片真实 SQL；未知语句必须失败，不能以空数组掩盖生产查询变更。
  const execute = (tx, write, query, values) => {
    assert(tx.active, '不能使用已结束事务');
    const sql = (Array.isArray(query) ? query.join('?') : query.sql).replace(/\s+/g, ' ').trim();
    const args = Array.isArray(query) ? values : query.values;
    const s = tx.state;
    f.calls.push({ tx: tx.id, write, sql });
    if (!write) {
      if (sql.startsWith('SELECT tenant_id FROM platform_core_access_locks ')) return s.locks.has(key(...args)) ? [{ tenant_id: args[0] }] : [];
      if (sql.includes('FROM platform_core_bindings WHERE ')) {
        assert.match(sql, /WHERE tenant_id = \? AND core_id = \? AND scope_hash = \?$/);
        const row = s.bindings.get(key(...args)); return row ? [clone(row)] : [];
      }
      if (sql.includes('FROM platform_core_binding_operations WHERE ')) {
        assert.match(sql, /WHERE tenant_id = \? AND core_id = \? AND scope_hash = \? AND operation_id = \?$/);
        const row = s.bindingReceipts.get(key(...args)); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT tenant_id AS tenantId FROM crm_settings ')) {
        assert.match(sql, /WHERE tenant_id = \? FOR UPDATE$/);
        return s.settings.has(args[0]) ? [{ tenantId: args[0] }] : [];
      }
      if (sql.includes('FROM crm_settings WHERE ')) {
        assert.match(sql, /WHERE tenant_id = \?$/); assert.equal(args.length, 1);
        const row = s.settings.get(args[0]); return row ? [clone(row)] : [];
      }
      if (sql.includes('FROM crm_pipeline_versions WHERE ')) {
        assert.match(sql, /WHERE tenant_id = \? AND version = \?$/);
        const row = s.pipelines.get(key(...args)); return row ? [{ definition: clone(row) }] : [];
      }
      if (sql.includes('FROM crm_setting_operations WHERE ')) {
        assert.match(sql, /WHERE tenant_id = \? AND operation_id = \?$/);
        const row = s.receipts.get(key(...args)); return row ? [clone(row)] : [];
      }
    } else {
      if (sql.startsWith('INSERT INTO platform_core_access_locks ')) { s.locks.add(key(...args)); return 1; }
      if (sql.startsWith('INSERT INTO platform_core_bindings ')) {
        const [tenant, core, hash, containerType, containerId, bindingId, revision, dataVersion] = args;
        const id = key(tenant, core, hash); assert(!s.bindings.has(id), '绑定唯一键不能覆盖');
        s.bindings.set(id, { containerType, containerId, bindingId, revision, dataVersion }); return 1;
      }
      if (sql.startsWith('INSERT INTO platform_core_binding_operations ')) {
        const [tenant, core, hash, operationId, actorTenantId, actorId, fingerprint, operation, binding] = args;
        const id = key(tenant, core, hash, operationId); assert(!s.bindingReceipts.has(id), '绑定原操作唯一键不能覆盖');
        s.bindingReceipts.set(id, { actorTenantId, actorId, fingerprint, operation: JSON.parse(operation), binding: JSON.parse(binding) }); return 1;
      }
      if (sql.startsWith('INSERT INTO crm_pipeline_versions ')) {
        const [tenant, version, definition] = args, id = key(tenant, version);
        assert(!s.pipelines.has(id), '流程版本不能覆盖'); s.pipelines.set(id, JSON.parse(definition)); return 1;
      }
      if (sql.startsWith('INSERT INTO crm_settings ')) {
        const [tenantId, timeZone, defaultCurrency, defaultSourceId, sources, revision, pipelineVersion,
          createdBy, updatedBy, createdAt, updatedAt] = args;
        assert(!s.settings.has(tenantId), '首次设置不能覆盖'); assert(s.pipelines.has(key(tenantId, pipelineVersion)), '流程外键必须成立');
        s.settings.set(tenantId, { tenantId, timeZone, defaultCurrency, defaultSourceId, sources: JSON.parse(sources), revision,
          pipelineVersion, createdBy, updatedBy, createdAt, updatedAt }); return 1;
      }
      if (sql.startsWith('UPDATE crm_settings SET ')) {
        assert.match(sql, /WHERE tenant_id = \? AND revision = \? AND pipeline_version = \?$/);
        const [timeZone, defaultCurrency, revision, updatedBy, updatedAt, tenant, expectedRevision, pipelineVersion] = args;
        const row = s.settings.get(tenant);
        if (f.casMiss || !row || row.revision !== expectedRevision || row.pipelineVersion !== pipelineVersion) return 0;
        s.settings.set(tenant, { ...row, timeZone, defaultCurrency, revision, updatedBy, updatedAt }); return 1;
      }
      if (sql.startsWith('INSERT INTO crm_setting_operations ')) {
        const [tenant, operation, actorId, fingerprint, result] = args, id = key(tenant, operation);
        assert(!s.receipts.has(id), '原操作唯一键不能覆盖'); assert(s.settings.has(tenant), '收据外键必须成立');
        s.receipts.set(id, { actorId, fingerprint, result: JSON.parse(result) }); return 1;
      }
    }
    throw Error('fixture 未核定 SQL: ' + sql);
  };
  f.client = { async $transaction(work, options) {
    assert.deepEqual(options, { isolationLevel: 'ReadCommitted' });
    let release; const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous;
    const tx = { id: ++f.transactions, state: clone(f.state), active: true,
      async $queryRaw(query, ...values) { return execute(tx, false, query, values); },
      async $executeRaw(query, ...values) { return execute(tx, true, query, values); } };
    try { const result = await work(tx); f.state = tx.state; return result; }
    catch (error) { f.rollbacks++; throw error; }
    finally { tx.active = false; release(); }
  } };
  const bindingRuntime = api.createMysqlCoreBindings(f.client, {
    async lockPrincipal(tx, request) {
      current(request.actor);
      return async () => ({ actor: clone(request.actor), scope: clone(request.scope),
        canInitialize: request.purpose === 'initialize', canReadOriginal: request.purpose === 'original_receipt',
        async revalidate() { current(request.actor); if (f.failRevalidate === 'binding') throw Error('fixture lease revoked'); } });
    },
    async audit(tx, receipt) { audit(tx, 'binding', receipt); }
  });
  f.runtime = bindingRuntime;
  const repository = tx => api.createMysqlCrmRepository(tx, f.actor.tenantId, receipt => audit(tx, 'settings', receipt));
  f.server = api.createCrmServer({
    async resolveAuthorizedBinding(request) {
      return bindingRuntime.execution.run({ actor: request.principal, scope: request.scope, purpose: 'original_receipt' }, store => store.binding());
    },
    async readConfiguration(binding) {
      return f.client.$transaction(async tx => {
        current({ ...f.actor, tenantId: binding.tenantId });
        const store = repository(tx), settings = await store.settings();
        const pipeline = settings && await store.pipeline(settings.pipelineVersion);
        current(f.actor);
        return settings && pipeline ? { settings, pipeline } : undefined;
      }, { isolationLevel: 'ReadCommitted' });
    },
    initializationRepository(handle, scope) {
      f.latestHandle = handle; f.latestScope = clone(scope);
      return api.createMysqlCrmRepository(bindingRuntime.resolveTransaction(handle, scope), scope.tenantId, receipt => { throw Error('初始化不另造设置收据'); });
    }
  }, clock);
  const registration = { manifest, server: f.server };
  const deployment = { requireRegistered(coreId) { if (coreId !== 'crm') throw Error('未登记 Core'); return registration; },
    async requireAvailable(coreId, tenantId) { if (!f.enabled || coreId !== 'crm' || tenantId !== f.actor.tenantId) throw Error('fixture 部署不可用'); } };
  f.binding = new api.CoreBindingService(bindingRuntime.execution, new Map([['crm', registration]]), deployment);
  f.bind = (operationId = 'initialize', configuration = defaults) => f.binding.bind(f.actor,
    { coreId: 'crm', operationId, expectedRevision: 0, configuration });
  const execution = api.createMysqlCrmExecution(f.client, {
    async authorize(tx, request) {
      current(request.principal);
      const actor = clone(request.principal);
      return { tenantId: actor.tenantId, userId: actor.subjectId, ...f.overrideAccess,
        async revalidate() { current(actor); if (f.failRevalidate === 'settings') throw Error('fixture lease revoked'); } };
    },
    async audit(tx, receipt) { audit(tx, 'settings', receipt); }
  });
  f.service = new api.CrmSettingsService(execution, clock);
  return f;
}

async function run() {
  const build = createBuild(deps);
  for (const config of ['packages/platform-contracts/tsconfig.json', 'packages/core-contracts/tsconfig.json', 'packages/core-host/tsconfig.json',
    'packages/platform-server/tsconfig.json', 'packages/platform-core-host/tsconfig.json', 'packages/crm-core/tsconfig.json']) build.compile(config);
  assert.equal(build.runtimeAliases.size, 0, '不替换正式业务、合同或 SQL 模块');
  const load = name => build.load(build.exported(name, true));
  const api = { ...load('@rental-os/crm-core'), ...load('@rental-os/crm-core/mysql'), ...load('@rental-os/crm-core/server'),
    ...load('@rental-os/core-host'), ...load('@rental-os/core-host/mysql-bindings') };
  const cc = load('@rental-os/core-contracts'), http = load('@rental-os/crm-core/http'), openapi = load('@rental-os/crm-core/openapi');
  const manifest = api.createCrmManifest({ repository: 'https://github.com/example/crm-fixture', commit: '1'.repeat(40) });
  let groups = 0;
  const check = async (name, work) => { await work(); groups++; console.log('PASS ' + name); };
  const update = (operationId, expectedRevision = 1, defaultCurrency = 'USD') => ({ ...defaults, operationId, expectedRevision, defaultCurrency });

  await check('首次绑定与默认来源/销售流程/收据/审计同事务；重入不覆盖', async () => {
    const f = fixture(api, manifest), binding = await f.bind();
    assert.equal(f.transactions, 1);
    assert.equal(new Set(f.calls.map(call => call.tx)).size, 1, '初始化禁止另开事务');
    assert.equal(f.state.bindings.size, 1); assert.equal(f.state.bindingReceipts.size, 1); assert.equal(f.state.audits.length, 1);
    const configuration = await f.service.read(alice);
    assert.equal(configuration.settings.revision, 1); assert.equal(configuration.settings.pipelineVersion, 1);
    assert.equal(configuration.settings.defaultSourceId, 'manual');
    assert.deepEqual(configuration.settings.sources, [{ id: 'manual', name: '手工录入', active: true }]);
    assert.deepEqual(configuration.pipeline.stages.map(stage => stage.probability), [10, 30, 60, 80]);
    assert.equal(configuration.settings.createdAt, fixedTime);
    const before = clone(f.state);
    assert.deepEqual(await f.bind(), binding); assert.deepEqual(f.state, before, '同键初始化直接读取原收据');
    await assert.rejects(f.bind('initialize', { ...defaults, defaultCurrency: 'USD' }), errorCode('operation_conflict'));
    await assert.rejects(f.binding.bind(alice, { coreId: 'crm', operationId: 'overwrite', expectedRevision: 1, configuration: defaults }), errorCode('operation_conflict'));
    await assert.rejects(f.client.$transaction(tx => api.initializeCrmConfiguration(api.createMysqlCrmRepository(tx, alice.tenantId, () => {}), alice, defaults, clock),
      { isolationLevel: 'ReadCommitted' }), errorCode('already_initialized'));
    assert.deepEqual(f.state, before);
    assert.throws(() => f.runtime.resolveTransaction(f.latestHandle, f.latestScope), errorCode('denied'), '提交后句柄须作废');
  });

  await check('原绑定事务失败回滚全部初始化；句柄拒绝跨范围与伪造', async () => {
    for (const fault of ['failAudit', 'failRevalidate']) {
      const f = fixture(api, manifest); f[fault] = 'binding'; const before = clone(f.state);
      await assert.rejects(f.bind(), /fixture/); assert.deepEqual(f.state, before); assert.equal(f.rollbacks, 1);
      assert.throws(() => f.runtime.resolveTransaction(f.latestHandle, f.latestScope), errorCode('denied'), '回滚后句柄须作废');
    }
    const f = fixture(api, manifest), scope = { coreId: 'crm', tenantId: alice.tenantId };
    await f.runtime.execution.run({ actor: alice, scope, purpose: 'initialize' }, async (_store, _lease, handle) => {
      assert(f.runtime.resolveTransaction(handle, scope).active);
      for (const other of [{ ...scope, tenantId: 'tenant-b' }, { ...scope, coreId: 'example-tickets' }, { ...scope, container: { type: 'team', id: 'x' } }])
        assert.throws(() => f.runtime.resolveTransaction(handle, other), errorCode('denied'));
      assert.throws(() => f.runtime.resolveTransaction({}, scope), errorCode('denied'));
      const context = { principal: alice, binding: { ...scope, bindingId: 'candidate', revision: 1, dataVersion: '0.1.0' },
        operation: { ...scope, operationId: 'candidate-init', action: 'initialize', implementationVersion: '0.1.0' }, transaction: handle };
      for (const changed of [{ principal: bob, binding: { ...context.binding, tenantId: 'tenant-b' } },
        { operation: { ...context.operation, tenantId: 'tenant-b' } }, { binding: { ...context.binding, dataVersion: '0.1.1' } }])
        await assert.rejects(f.server.initialization.initialize({ ...context, ...changed }, defaults), errorCode('denied'));
    });
    assert.equal(f.state.settings.size, 0);
  });

  await check('设置幂等复用、异内容冲突、领域修订和 SQL CAS；历史收据保持原值', async () => {
    const f = fixture(api, manifest); await f.bind();
    const first = await f.service.update(alice, update('save-1'));
    assert.equal(first.settings.revision, 2); assert.equal(f.state.receipts.size, 1);
    assert.deepEqual(await f.service.update(alice, update('save-1')), first);
    assert.equal(f.state.audits.filter(item => item.kind === 'settings').length, 1);
    await assert.rejects(f.service.update(alice, update('save-1', 1, 'EUR')), errorCode('operation_conflict'));
    await assert.rejects(f.service.update(alice, update('save-stale')), errorCode('revision_conflict'));
    f.casMiss = true; const before = clone(f.state);
    await assert.rejects(f.service.update(alice, update('save-cas', 2)), errorCode('revision_conflict')); assert.deepEqual(f.state, before);
    f.casMiss = false; await f.service.update(alice, update('save-2', 2, 'EUR'));
    assert.deepEqual(await f.service.receipt(alice, 'save-1'), { status: 'recorded', receipt: first });
    assert.equal((await f.service.read(alice)).settings.defaultCurrency, 'EUR');
    assert.deepEqual(await f.service.update(alice, update('save-1')), first, '后续更新不改写原操作结果');
  });

  await check('原操作租户与本人隔离；授权返回主体不符立即拒绝', async () => {
    const f = fixture(api, manifest); await f.bind(); await f.service.update(alice, update('same-key'));
    f.actor = bob;
    assert.deepEqual(await f.service.receipt(bob, 'same-key'), { status: 'unavailable' });
    await assert.rejects(f.service.update(bob, update('same-key')), errorCode('operation_conflict'));
    await assert.rejects(f.service.read(alice), errorCode('denied'));
    f.actor = carol; await f.bind('tenant-b-init');
    assert.deepEqual(await f.service.receipt(carol, 'same-key'), { status: 'unavailable' });
    const other = await f.service.update(carol, update('same-key', 1, 'EUR'));
    assert.equal(other.settings.tenantId, carol.tenantId); assert.equal(f.state.receipts.size, 2);
    f.overrideAccess = { tenantId: alice.tenantId };
    await assert.rejects(f.service.read(carol), errorCode('denied'));
    f.overrideAccess = { userId: 'unrelated-user' };
    await assert.rejects(f.service.read(carol), errorCode('denied'));
    f.overrideAccess = undefined;
    await assert.rejects(f.service.read({ ...carol, audience: 'client' }), errorCode('denied'));
    f.actor = alice; assert.equal((await f.service.read(alice)).settings.defaultCurrency, 'USD');
  });

  await check('设置审计或提交前撤权失败全部回滚；敏感读取释放前复验', async () => {
    const f = fixture(api, manifest); await f.bind();
    for (const fault of ['failAudit', 'failRevalidate']) {
      f[fault] = 'settings'; const before = clone(f.state);
      await assert.rejects(f.service.update(alice, update('failed-' + fault)), /fixture/); assert.deepEqual(f.state, before);
      f[fault] = undefined;
    }
    f.failRevalidate = 'settings';
    await assert.rejects(f.service.read(alice), /lease revoked/);
    await assert.rejects(f.service.receipt(alice, 'unknown-operation'), /lease revoked/);
    f.failRevalidate = undefined;
    assert.deepEqual(await f.service.receipt(alice, 'failed-failAudit'), { status: 'unavailable' });
  });

  await check('readiness 实读设置/默认来源/流程版本；缺失与损坏不补默认成功', async () => {
    const f = fixture(api, manifest), binding = await f.bind();
    assert.deepEqual(await f.server.readReadiness(binding), { status: 'ready' });
    assert.equal((await f.server.resolveScope({ principal: alice, scope: { coreId: 'crm', tenantId: alice.tenantId } })).status, 'resolved');
    assert.equal((await f.server.resolveScope({ principal: alice, scope: { coreId: 'crm', tenantId: carol.tenantId } })).status, 'denied');
    const saved = clone(f.state);
    f.state.settings.clear(); assert.equal((await f.server.readReadiness(binding)).status, 'unavailable');
    f.state = clone(saved); f.state.pipelines.clear(); assert.equal((await f.server.readReadiness(binding)).status, 'unavailable');
    f.state = clone(saved); f.state.pipelines.get(key(alice.tenantId, 1)).version = 2;
    assert.equal((await f.server.readReadiness(binding)).status, 'unavailable');
    f.state = clone(saved); f.state.pipelines.get(key(alice.tenantId, 1)).stages[0].probability = 101;
    assert.equal((await f.server.readReadiness(binding)).status, 'unavailable');
    f.state = clone(saved); f.state.settings.get(alice.tenantId).sources[0].active = false;
    assert.equal((await f.server.readReadiness(binding)).status, 'unavailable');
    f.state = clone(saved); assert.equal((await f.server.readReadiness({ ...binding, dataVersion: '0.2.0' })).status, 'unavailable');
    assert.equal(f.state.settings.size, 1); assert.equal(f.state.pipelines.size, 1);
  });

  await check('HTTP 政策与 OpenAPI 同源；仅 operator/明确权限/原收据路径', async () => {
    const contribution = http.createCrmHttpContribution(), specification = openapi.createCrmOpenApi();
    const registered = cc.registerCoreHttpRoutes([{ manifest, contribution }]);
    assert.equal(registered.ok, true, JSON.stringify(registered.issues));
    assert.equal(contribution.routes.length, 3);
    assert.equal(Object.values(specification.paths).reduce((sum, methods) => sum + Object.keys(methods).length, 0), 3);
    for (const definition of Object.values(http.CRM_HTTP)) {
      const route = `/cores/crm/${definition.path}`, requested = route.replace(':operationId', 'original-1');
      const policy = registered.registry.resolve(definition.method, requested, 'operator');
      assert(policy); assert.deepEqual(policy.permissionCodes, ['crm:settings:manage']);
      assert.equal(policy.purpose, definition.purpose); assert.equal(policy.startsNewBusiness, false);
      assert.equal(registered.registry.resolve(definition.method, requested, 'client'), undefined);
      const documented = specification.paths['/api' + route.replace(':operationId', '{operationId}')][definition.method.toLowerCase()];
      assert.equal(documented['x-core-purpose'], policy.purpose);
      assert.deepEqual(documented['x-core-permissions'], policy.permissionCodes);
      if ('body' in definition) {
        const requestSchema = specification.schemas[documented.operationId + '.Request'];
        assert.deepEqual(Object.keys(requestSchema.properties).sort(), Object.keys(definition.body.shape).sort());
        assert.deepEqual([...requestSchema.required].sort(), Object.keys(definition.body.shape).sort());
        assert.equal(requestSchema.additionalProperties, false);
        assert.equal(definition.body.safeParse({ ...update('spoof'), tenantId: 'tenant-b' }).success, false);
        assert.equal(definition.body.safeParse({ ...update('bad-zone'), timeZone: 'Invalid/Nowhere' }).success, false,
          'OpenAPI 结构转换不能删除运行时 refine');
      }
    }
    assert.equal(registered.registry.resolve('DELETE', '/cores/crm/settings', 'operator'), undefined);
    assert.equal(registered.registry.resolve('GET', '/cores/crm/unregistered', 'operator'), undefined);
  });
  await check('标准包声明、迁移摘要与内存归档闭合；私有资料不入包', async () => {
    const packaging = load('@rental-os/core-contracts/package'), archive = load('@rental-os/core-contracts/archive');
    const source = { repository: 'https://github.com/JinPen-G/Zelo', commit: 'bdf4956b79e18b37d6d2cc3ce184b49ba8c5cee7' };
    const generated = new Map([
      ['core.manifest.json', JSON.stringify(manifest)], ['openapi.json', JSON.stringify(openapi.createCrmOpenApi())],
      ['CORE_GUIDE.md', cc.renderCoreGuide(manifest, fs.readFileSync(path.join(root, 'packages/core-contracts/README.md'), 'utf8'), source)]
    ]);
    const files = new Map();
    for (const name of packaging.corePackageFiles(manifest)) {
      const absolute = path.join(root, 'packages/crm-core', name).split(path.sep).join('/');
      const bytes = generated.get(name) ?? build.outputs.get(absolute) ?? fs.readFileSync(absolute);
      files.set(name, Buffer.from(bytes));
    }
    const inspected = packaging.inspectCorePackageFiles(files, { platform: '0.1.17', contract: '0.1.1', node: '22.12.0', capabilities: {} });
    assert.equal(inspected.ok, true, JSON.stringify(inspected.issues));
    assert(![...files.keys()].some(name => /^(?:docs|node_modules|test)\//.test(name)));
    const packed = archive.createCoreArchive(files), unpacked = archive.readCoreArchive(packed.bytes, packed.sha256);
    assert.deepEqual([...unpacked.files.keys()].sort(), [...files.keys()].sort());
    const altered = new Map(files); altered.set('migrations/001-crm.sql', Buffer.from('different migration'));
    assert.equal(packaging.inspectCorePackageFiles(altered).ok, false, '迁移字节变化必须拒绝');
  });
  console.log(JSON.stringify({ status: 'passed', groups, compiledPackages: build.stages.length,
    emittedFiles: build.outputs.size, diskOutputs: 0, database: 'offline-storage-transport-only' }));
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; })
  .finally(() => { assert.equal(fs.existsSync(temporary), false, '本测试不得留下临时产物'); });
