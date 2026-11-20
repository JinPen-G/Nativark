'use strict';
/** Real model-settings request, Auth/Guard and repository CAS under the selected
 * host. Only persistence and directory transport are synthetic; the parent
 * ai-composition test owns official Client metadata and the offline lifecycle. */
module.exports = async function modelSettingsCases({ t, knowledgeFixture }) {
  const assert = require('node:assert/strict');
  const shared = require('@rental-os/shared');
  const { runWithRequestIdentity, getRequestIdentity } = require('@rental-os/platform-server/request-identity');
  const { prismaRuntime } = require('@rental-os/platform-server/prisma-runtime');
  const { composeRequestBoundModelSettings } = require('@rental-os/ai-native-server/runtime/model-settings.application');
  const { PrismaTenantModelProfileRepository } = require('@rental-os/ai-native-server/runtime/tenant-model-profile.repository');
  const { createTenantModelConfigurationTransactions } = require('@rental-os/ai-native-server/runtime/tenant-model-config-transactions');
  const request = () => ({ draftVersion: shared.AI_USAGE_DRAFT_VERSION, configId: 'tenant-a', expectedRevision: 0,
    enabled: false, mode: 'tenant_managed', protocol: 'openai_chat_completions', baseUrl: 'https://models.example.test/v1',
    model: 'synthetic/model', secretChange: { operation: 'replace', apiKey: 'synthetic-key-never-live' }, operationKey: 'configuration-a' });
  const rejected = error => ['FORBIDDEN', 'AI_ACCESS_DENIED', 'AI_RESULT_UNKNOWN', 'PENDING_RECONCILIATION', 'PROVIDER_UNAVAILABLE'].includes(error.code)
    || [401, 403].includes(error.getStatus?.());
  function fixture() {
    const h = knowledgeFixture();
    const state = h.state;
    Object.assign(state, { records: { config: null, profile: null, scopes: [], operations: [] }, trace: [], commits: 0,
      mutations: 0, directoryCalls: 0, lostCommit: false, phase: undefined });
    let pending;
    const records = () => pending ?? state.records;
    const phase = async name => { state.trace.push(name); await state.phase?.(name); };
    h.rental.authSource.lockWorkspaceSessionUser = async (tx, expected) => {
      assert.equal(state.depth, 1); assert.equal(expected.sessionId, 'session-a');
      await phase('auth-lock');
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM Tenant WHERE id=${expected.tenantId} FOR UPDATE`);
      return h.rental.authSource.readWorkspaceSessionUser(tx, expected);
    };
    h.rental.authSource.readWorkspaceSessionUser = async (_tx, expected) => {
      if (!state.active || state.workspace !== expected.workspaceId) throw Object.assign(Error('revoked'), { code: 'FORBIDDEN' });
      return structuredClone(state.user);
    };
    h.db.systemParameterSet.findFirst = async () => null;
    h.db.aiScope.findFirst = async ({ where }) => structuredClone(records().scopes.find(row =>
      Object.entries(where).every(([key, value]) => row[key] === value)) ?? null);
    h.db.aiScope.upsert = async ({ where, create }) => {
      assert.equal(state.depth, 1); await phase('scope-write');
      let row = records().scopes.find(row => row.scopeKey === where.scopeKey);
      if (!row) { row = structuredClone(create); records().scopes.push(row); state.mutations++; }
      return structuredClone(row);
    };
    h.db.aiTenantModelConfiguration.findUnique = async () => structuredClone(records().config);
    h.db.aiTenantModelConfiguration.create = async ({ data }) => {
      assert.equal(state.depth, 1); await phase('config-write');
      assert.equal(records().config, null); state.mutations++;
      records().config = { ...data, settings: data.settings === prismaRuntime.DbNull ? null : structuredClone(data.settings) };
      return structuredClone(records().config);
    };
    h.db.aiTenantModelConfiguration.updateMany = async ({ where, data }) => {
      await phase('config-write');
      if (records().config?.revision !== where.revision) return { count: 0 };
      state.mutations++; records().config = { ...records().config, ...structuredClone(data) }; return { count: 1 };
    };
    h.db.aiProviderProfile.findFirst = async () => structuredClone(records().profile);
    h.db.aiProviderProfile.create = async ({ data }) => {
      await phase('profile-write'); state.mutations++;
      records().profile = { id: 'profile-a', ...structuredClone(data) }; return structuredClone(records().profile);
    };
    h.db.aiProviderProfile.updateMany = async ({ data }) => {
      await phase('profile-write'); state.mutations++; records().profile = { ...records().profile, ...structuredClone(data) }; return { count: 1 };
    };
    h.db.aiModelConfigurationOperation.findUnique = async ({ where }) => structuredClone(records().operations.find(row =>
      Object.entries(where.scopeId_scopeKind_targetId_operationKey).every(([key, value]) => row[key] === value)) ?? null);
    h.db.aiModelConfigurationOperation.create = async ({ data }) => {
      await phase('receipt-write'); state.mutations++;
      const row = { ...structuredClone(data), recordedAt: new Date() }; records().operations.push(row); return structuredClone(row);
    };
    const originalTransaction = h.db.$transaction;
    h.db.$transaction = async (callback, options) => {
      if (options.isolationLevel === 'ReadCommitted') return originalTransaction(callback, options);
      assert.equal(options.isolationLevel, 'Serializable'); assert.equal(state.depth, 0);
      pending = structuredClone(state.records); state.depth = 1;
      const tx = { ...h.db }; delete tx.$transaction;
      tx.$queryRaw = async value => {
        const sql = value.sql.replace(/\s+/gu, ' ').trim();
        if (sql.includes('FROM Tenant')) { await phase('tenant-lock'); return [{ id: 'tenant-a', status: 'active' }]; }
        if (sql.includes('FROM platform_core_access_locks')) { await phase('core-lock'); return [{ tenantId: 'tenant-a', coreId: 'rental' }]; }
        if (sql.includes('FROM platform_tenant_core_grants')) return [{ state: state.grant, revision: 1n, operationId: 'grant-a' }];
        if (sql.includes('FROM platform_member_core_assignments')) return [{ state: state.assigned, revision: 1n, operationId: 'assignment-a' }];
        if (sql.includes('FROM platform_core_bindings')) return [{ bindingId: 'binding-a', revision: 1n,
          dataVersion: '0.1.0', containerType: 'rental-workspace', containerId: 'workspace-a' }];
        throw Error('Unexpected configuration SQL: ' + sql);
      };
      try {
        const result = await callback(tx);
        state.records = pending; state.commits++;
        if (state.lostCommit && state.records.config) { state.lostCommit = false; throw Error('synthetic lost COMMIT response'); }
        return result;
      } finally { pending = undefined; state.depth = 0; }
    };
    const build = ports => composeRequestBoundModelSettings({ db: h.db, auth: h.rental.auth, guard: h.guard,
      secrets: h.rental.secrets, ...(ports ? { transactions: { auth: h.rental.auth } } : {}),
      discovery: { getModelDirectory: async () => {
        assert.equal(state.depth, 0, 'directory transport remains outside every transaction');
        state.directoryCalls++; await state.afterDirectory?.();
        return { status: 200, body: JSON.stringify({ data: [{ id: 'synthetic/model' }] }) }; } } });
    const application = build(true);
    const invoke = (action, command, app = application, inside) => runWithRequestIdentity({}, () => h.access.run(async () => {
      const suffix = shared.AI_MODEL_SETTINGS_HTTP_DRAFT[action];
      assert.equal(typeof suffix, 'string');
      const url = '/api/' + shared.AI_MODEL_SETTINGS_HTTP_DRAFT.basePath + '/' + suffix;
      const req = { ...h.request(), url, originalUrl: url, body: command };
      assert.equal(await h.guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
      return h.access.withRequest(req, () => h.binding.withRequest(req, () => inside ? inside(req) : app[action](req, command)),
        ['read', 'operation', 'legacy'].includes(action) ? { bufferedRead: true } : undefined);
    }));
    return { ...h, state, invoke, build, application };
  }
  await t.test('模型配置原请求保存、同事务 Profile/收据与原 key 重放', async () => {
    const h = fixture(), result = await h.invoke('save', request());
    assert.equal(result.configRevision, 1); assert.equal(result.credentialState, 'configured');
    assert.equal(h.state.records.profile.configRevision, 1); assert.equal(h.state.records.operations.length, 1);
    const writes = h.state.mutations;
    assert.deepEqual(await h.invoke('save', request()), result); assert.equal(h.state.mutations, writes);
    const receipt = await h.invoke('operation', { operationKey: request().operationKey });
    assert.equal(receipt.state, 'recorded'); assert.equal(receipt.result.configRevision, 1);
    assert.equal(JSON.stringify(receipt).includes(request().secretChange.apiKey), false);
    const trace = h.state.trace;
    assert.ok(trace.indexOf('auth-lock') < trace.indexOf('tenant-lock'));
    assert.ok(trace.indexOf('tenant-lock') < trace.indexOf('core-lock'));
    assert.ok(trace.indexOf('core-lock') < trace.indexOf('scope-write'));
    assert.ok(trace.lastIndexOf('core-lock') > trace.indexOf('receipt-write'));
  });
  await t.test('模型配置等待期间与最终复验撤权，原 Scope/配置/Profile/收据原子回滚', async () => {
    for (const [at, revoke] of [
      ['auth-lock', s => { s.active = false; }], ['tenant-lock', s => { s.grant = 'disabled'; }],
      ['scope-write', s => { s.assigned = 'unassigned'; }], ['config-write', s => { s.available = false; }],
      ['profile-write', s => { s.user.permissions = []; }], ['receipt-write', s => { s.workspace = 'changed'; }],
      ['receipt-write', s => { s.user.locationScope = { mode: 'selected', locationIds: ['changed'] }; }],
    ]) {
      const h = fixture(); let fired = false;
      h.state.phase = async name => { if (!fired && name === at) { fired = true; revoke(h.state); } };
      await assert.rejects(() => h.invoke('save', request()), rejected, at); assert.equal(fired, true, at);
      assert.equal(h.state.records.config, null, at); assert.equal(h.state.records.profile, null, at);
      assert.equal(h.state.records.operations.length, 0, at);
      if (at === 'scope-write') assert.equal(h.state.records.scopes.length, 0);
    }
  });
  await t.test('选中宿主不能丢参加者、复制身份或在请求退出后复活配置租约', async () => {
    const h = fixture(); await assert.rejects(() => h.invoke('save', request(), h.build(false)), rejected);
    assert.equal(h.state.mutations, 0);
    let captured;
    await h.invoke('read', {}, h.application, async req => {
      const credentials = { current: async () => ({ authorization: req.headers.authorization, audience: 'operator', requestId: 'test-request' }) };
      captured = createTenantModelConfigurationTransactions({ credentials, transactions: { auth: h.rental.auth } });
      await assert.rejects(() => runWithRequestIdentity(structuredClone(getRequestIdentity()), () => h.db.$transaction(
        tx => captured.begin(tx, { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: h.state.user.id }),
        { isolationLevel: 'Serializable' })), rejected);
      return {};
    });
    await assert.rejects(() => h.db.$transaction(tx => captured.begin(tx,
      { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: h.state.user.id }), { isolationLevel: 'Serializable' }), rejected);
    assert.equal(h.state.mutations, 0);
  });
  await t.test('失 COMMIT 回复保留 unknown 并只按原配置操作键读取', async () => {
    const h = fixture(); h.state.lostCommit = true;
    await assert.rejects(() => h.invoke('save', request()), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.equal(h.state.records.config.revision, 1); assert.equal(h.state.records.operations.length, 1);
    const writes = h.state.mutations;
    assert.equal((await h.invoke('operation', { operationKey: request().operationKey })).state, 'recorded');
    assert.equal(h.state.mutations, writes); assert.equal(h.state.directoryCalls, 0);
  });
  await t.test('原模型目录运输在事务外，返回前撤销 Core 不重发或返回目录', async () => {
    const h = fixture(); h.state.afterDirectory = async () => { h.state.grant = 'disabled'; };
    await assert.rejects(() => h.invoke('discoverModels', { baseUrl: request().baseUrl, protocol: request().protocol,
      expectedRevision: 0, secretChange: request().secretChange }), rejected);
    assert.equal(h.state.directoryCalls, 1); assert.equal(h.state.mutations, 0);
  });
  await t.test('旧宿主无 selected fence 时保留原配置仓储行为', async () => {
    const h = fixture();
    h.state.records.scopes.push({ id: 'tenant-scope', kind: 'TENANT', scopeKey: 'tenant:tenant-a', tenantId: 'tenant-a', workspaceId: null });
    // Exercise the original repository without a selected request; it does not
    // acquire a new Auth/Core grant or require the optional participant.
    const { aiPersistenceScopeColumns } = require('@rental-os/ai-native-server/runtime/persistence-scope');
    h.state.records.scopes[0] = { id: 'tenant-scope', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) };
    const repo = new PrismaTenantModelProfileRepository(h.db, async () => {});
    assert.equal(await repo.compareAndSwap('tenant-a', 0, { tenantId: 'tenant-a', revision: 1,
      mode: 'platform_managed', serviceEnabled: false }, { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: h.state.user.id }), true);
    assert.equal(h.state.records.config.revision, 1); assert.equal(h.state.trace.includes('auth-lock'), false);
  });
};
