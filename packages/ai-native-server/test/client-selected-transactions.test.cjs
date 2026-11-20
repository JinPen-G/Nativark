'use strict';
/** 标准客户入口原资料→Task 切片。真实 ClientAuth/Guard/ClientApi/Core 仓储及
 * Controller；复用原会话行锁和原 Task 回滚运输夹具，只有数据库运输使用内存。
 * node --no-compilation-cache packages/ai-native-server/test/client-selected-transactions.test.cjs --deps <node_modules>
 * 无磁盘输出、服务、默认 Client、真实模型或数据库。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { load, loader, shared, identity, runtime, aiPersistenceScopeColumns } = require('./original-scene-transactions.test.cjs');
const root = path.resolve(__dirname, '../../..');
// Reuse the original ClientAuth fixture definitions without executing its test
// main or modifying any assertion. Production code is loaded unmodified.
const sessionFile = path.join(root, 'tests/client-current-session-lease.test.cjs');
const sessionText = fs.readFileSync(sessionFile, 'utf8');
const fixtureEnd = sessionText.indexOf('\nconst rejected =');
assert(fixtureEnd > 0);
const sessionRequire = name => name === 'ts-node' ? { register() {} }
  : name.startsWith('.') || name.startsWith('@rental-os/')
    ? loader.load(loader.resolveSource(sessionFile, name, true)) : loader.requireDependency(name);
const { fixture: sessionFixture, signed, secret } = new Function('require', sessionText.slice(0, fixtureEnd)
  + '\nreturn { fixture, signed, secret };')(sessionRequire);
const storeFile = path.join(root, 'tests/fixtures/ai-native/task-input-store.cjs'), storeModule = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(storeFile, 'utf8'))(
  name => name === '../../../apps/api/node_modules/@prisma/client' ? { Prisma: runtime } : createRequire(storeFile)(name),
  storeModule, storeModule.exports);
const { createTaskInputStore, clone } = storeModule.exports;
const { ClientAuthService } = load('packages/rental-core/src/mysql-client-auth.ts');
const { ClientApiService } = load('packages/rental-core/src/mysql-client-application.ts');
const { RentalCoreFactRepository } = load('packages/rental-core/src/mysql-core-facts.ts');
const { createRentalAuthorization } = load('packages/rental-core/src/http-auth.ts');
const { createRentalApplicationAccess } = load('packages/rental-core/src/application-access.ts');
const { captureRentalClientInternalAuthority, captureRentalInternalAuthority } = load('packages/rental-core/src/application-internal-authority.ts');
const { createAiGuardedClientSession } = load('packages/ai-native-server/src/runtime/client-scene.composition.ts');
const { composeStandardClientBookingEntry, WebsiteClientEntryController, WechatClientEntryController, AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY } =
  load('packages/ai-native-server/src/runtime/scenes/standard-client-entry.application.ts');
const { AI_NATIVE_CLIENT_ENTRY_PROVIDERS } = load('packages/ai-native-server/src/runtime/ai-native-application.providers.ts');
const { PrismaClientSceneMaterialRepository } = load('packages/ai-native-server/src/runtime/scenes/prisma-client-scene-material.repository.ts');
const { AI_BODY_STORAGE, AiBodyStorageCodec } = load('packages/ai-native-server/src/runtime/privacy/ai-body-storage.codec.ts');
const { SecretBox } = loader.load(loader.resolveSource(__filename, '@rental-os/platform-server/secret-box', true));
const { ConfigService } = loader.requireDependency('@nestjs/config');

function fixture(channel = 'web') {
  const authRows = sessionFixture(), now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  const scopes = [{ kind: 'platform' }, { kind: 'tenant', tenantId: 'tenant' },
    { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }].map((value, index) =>
      ({ id: `scope-${index}`, ...aiPersistenceScopeColumns(value) }));
  const sceneCode = 'quote_clarification', sceneVersion = '1';
  const workspace = { ...authRows.state.workspace, clientChannelPublications: [{ tenantId: 'tenant', enabled: true }] };
  const profile = { id: 'channel-profile', tenantId: 'tenant', revision: 1,
    publishedWorkspaces: [{ workspaceId: 'workspace', enabled: true, workspace }], defaultWorkspaceId: 'workspace' };
  const settings = scope => ({ draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 },
    scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant' }, sceneCode,
    allowedScenes: [sceneCode], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
    budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } },
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(kind => [kind, { enabled: true, revision: 1 }])) });
  const store = createTaskInputStore({
    aiScope: scopes, aiTask: [], aiRun: [], aiStep: [], aiTaskExecutionCharge: [], aiTaskRunPlan: [], aiTaskEvent: [],
    aiClientSceneMaterial: [], aiClientTaskInput: [], operationLog: [], tenantAppearanceProfile: [], miniProgramChannel: [],
    tenant: [{ ...authRows.state.tenant, name: '商户', subscription: { startAt: now, endAt: expiresAt }, subscriptionSegments: [] }],
    businessWorkspace: [workspace], clientChannelProfile: [profile],
    clientChannelWorkspace: [{ id: 'published-workspace', tenantId: 'tenant', workspaceId: 'workspace', profileId: profile.id, enabled: true }],
    websiteChannelProfile: [{ id: 'website', tenantId: 'tenant', revision: 1, enabled: true }],
    aiClientTaskPolicy: [{ id: 'b77ec266-e3a2-48a4-98be-d5b49222d5b1', tenantId: 'tenant', workspaceId: 'workspace',
      channel, customerType: 'personal', sceneCode, sceneVersion, enabled: true, allowRead: true, allowCreate: true,
      allowExecute: true, allowRequestInput: true, allowSubmitInput: true, allowResumeInput: true, revision: 1, expiresAt }],
    aiBudgetPolicy: scopes.map(scope => ({ id: `${scope.id}-budget`, scopeId: scope.id, scopeKind: scope.kind,
      sceneCode, enabled: true, configRevision: 1, settingsJson: settings(scope) })),
    rentalOrder: [{ id: 'own-order', tenantId: 'tenant', workspaceId: 'workspace', status: 'RESERVED', categoryCode: 'CAMERA',
      customerId: 'customer', customerType: 'PERSONAL', customerName: '客户', orderNo: 'SYNTHETIC-ORDER', createdBy: 'staff',
      rentalAmount: 100, serviceAmount: 0, discountAmount: 0, couponAmount: 0, depositAmount: 20, preAuthAmount: 0, finalPayableAmount: 100,
      startAt: now, endAt: expiresAt, createdAt: now, updatedAt: now, lines: [], reservations: [], allocations: [], currency: 'CNY' }],
  }, { aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']], aiClientSceneMaterial: [['id']] });
  const state = { grant: 'enabled', beforeQuery: undefined, beforeWrite: undefined, lost: undefined,
    scope: undefined, authRows, events: [], inWrite: false };
  const wrap = (reader, authReader, owner, readOnly) => {
    const rawQuery = reader.$queryRaw, rawExecute = reader.$executeRaw;
    const sessionReader = authReader ?? authRows.db;
    const db = { ...reader, clientAuthSession: sessionReader.clientAuthSession,
      customerAccount: sessionReader.customerAccount, customerMembership: sessionReader.customerMembership };
    db.$queryRaw = async (query, ...values) => {
      const q = Array.isArray(query) ? runtime.sql(query, ...values) : query, sql = q.sql.replace(/\s+/gu, ' ').trim();
      state.events.push({ owner, sql, identity: identity.getRequestIdentity() });
      await state.beforeQuery?.(sql, reader, owner);
      if (/FROM (Tenant|customer_profiles|customer_accounts|client_auth_sessions|customer_memberships) /u.test(sql)
        && sql.endsWith('FOR UPDATE')) {
        assert(authReader, '会话行锁必须在原事务中');
        return authReader.$queryRaw(q);
      }
      if (sql.includes('FROM Tenant')) return [{ id: 'tenant', status: authRows.state.tenant.status.toLowerCase() }];
      if (sql.includes('FROM platform_core_access_locks')) return [{ tenantId: 'tenant', coreId: 'rental' }];
      if (sql.includes('FROM platform_tenant_core_grants')) return [{ state: state.grant, revision: 1n, operationId: 'grant' }];
      if (sql.includes('FROM platform_core_bindings')) return [{ bindingId: 'binding', revision: 1n, dataVersion: '0.1.0',
        containerType: 'rental-workspace', containerId: 'workspace' }];
      if (sql.includes('platform_member_core_assignments') || sql.includes('auth_sessions') && !sql.includes('client_auth_sessions'))
        throw Error('客户不能借用营运成员权限');
      if (sql.includes('FROM `rental_orders`')) return reader.rentalOrder.findMany({ where: { tenantId: q.values[0], workspaceId: q.values[1], id: q.values[2] } });
      if (sql.includes('FROM ai_client_scene_materials')) {
        const [tenantId, workspaceId, channel, principalHash, reference] = q.values;
        const field = sql.includes('AND operationKey =') ? 'operationKey' : 'id';
        return reader.aiClientSceneMaterial.findMany({ where: { tenantId, workspaceId, channel, principalHash, [field]: reference } });
      }
      return rawQuery(q);
    };
    db.$executeRaw = async q => {
      assert(!readOnly, '只读快照不能写入');
      const sql = q.sql.replace(/\s+/gu, ' ').trim();
      state.events.push({ owner, sql, identity: identity.getRequestIdentity() });
      if (sql.startsWith('INSERT INTO ai_client_scene_materials')) {
        const fields = sql.match(/\(([^)]+)\) VALUES/u)[1].split(',').map(value => value.trim());
        const row = Object.fromEntries(fields.map((field, index) => [field, clone(q.values[index])]));
        for (const field of ['command', 'material', 'publication']) row[field] = JSON.parse(row[field]);
        await db.aiClientSceneMaterial.create({ data: row });
        return 1;
      }
      if (sql.startsWith('INSERT INTO ai_client_task_inputs') && state.lost === 'input') store.control.loseReply = true;
      return rawExecute(q);
    };
    return db;
  };
  const db = wrap(store.db, undefined, 'root', false), originalTransaction = store.db.$transaction;
  const secrets = new SecretBox(new ConfigService({ NODE_ENV: 'test', INTEGRATION_ENCRYPTION_KEY: 'synthetic-client-selected-body-key' }));
  Object.defineProperty(db, AI_BODY_STORAGE, { value: new AiBodyStorageCodec(secrets) });
  let sequence = 0;
  db.$transaction = (consume, options) => {
    const owner = `tx-${++sequence}`, readOnly = options?.isolationLevel === 'RepeatableRead';
    state.events.push({ owner, isolation: options?.isolationLevel });
    if (readOnly) return originalTransaction(tx => consume(wrap(tx, undefined, owner, true)), options);
    // These are two cooperating pieces of one in-memory transport: original
    // ClientAuth row locks plus original AI draft/rollback; production opens one tx.
    return authRows.tx(authTx => originalTransaction(async tx => {
      state.inWrite = true;
      try { return await consume(wrap(tx, authTx, owner, false)); }
      finally { state.inWrite = false; }
    }, options));
  };
  store.control.beforeWrite = async (table, args, draft) => {
    state.events.push({ write: table, identity: identity.getRequestIdentity() });
    if (table === 'operationLog') args.data.id ??= randomUUID();
    await state.beforeWrite?.(table, args, draft);
    if (table === 'aiClientSceneMaterial' && state.lost === 'material'
      || table === 'aiRun' && state.lost === 'task') store.control.loseReply = true;
  };
  const auth = new ClientAuthService(db, {}, {}, {}), authorization = createRentalAuthorization(shared);
  const guard = new authorization.Guard({}, undefined, auth, { assertAllowed: async () => {} }, db);
  const access = createRentalApplicationAccess({ database: db, authorization,
    term: { requireNewBusiness: async () => { throw Error('本片不执行租赁业务'); } },
    deploymentForTransaction: () => ({ requireAvailable: async () => {} }) });
  const orders = new RentalCoreFactRepository(db, { ...identity,
    resolveWorkspaceId: async (_tx, tenantId) => { assert.equal(tenantId, identity.getRequestTenantId()); return identity.getRequestWorkspaceId(); } });
  const client = new ClientApiService(db, auth, {}, {
    getOrder: (tenantId, orderId) => orders.findOrder(tenantId, orderId), listCategories: () => [],
    getBusinessSettings: async () => ({ fulfillment: { enabledModes: [] } }),
  }, {}, {}, {}, {}, {}, { catalog: async () => ({ configs: [] }) }, {}, {}, {}, null);
  const subscriptions = { readCategoryCommercialContext: async () => ({ revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
    entitlements: [{ code: 'ai.native.use', available: true, categories: [] }] }) };
  const dependencies = { db, client, guard, tasks: { db, subscriptions, sceneCode, sceneVersion }, transactions: { clientAuth: auth, orders } };
  const provider = AI_NATIVE_CLIENT_ENTRY_PROVIDERS.find(value => value.provide === (channel === 'web' ? AI_WEBSITE_ENTRY : AI_WECHAT_ENTRY));
  assert(provider);
  const application = provider.useFactory(db, guard, subscriptions, client, secrets, undefined, auth, orders, { enabled: false });
  const controller = channel === 'web' ? new WebsiteClientEntryController(application) : new WechatClientEntryController(application);
  const base = channel === 'web' ? shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath : shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath;
  const routes = { prepareOrderMaterial: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial,
    readOrderMaterialReceipt: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt,
    createTask: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, readTaskCreation: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation };
  const invoke = (method, value, callback) => identity.runWithRequestIdentity({}, () => access.run(async () => {
    const request = { method: 'POST', url: `/api/${base}/${routes[method]}`, headers: { authorization: `Bearer ${signed()}` }, body: value, query: {} };
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
    return access.withRequest(request, async () => {
      state.scope = identity.getRequestIdentity();
      return callback ? callback(request) : controller[method](request, value);
    }, ['prepareOrderMaterial', 'createTask'].includes(method) ? undefined : { auditedRead: true });
  }));
  for (const key of Object.keys(store.state)) Object.defineProperty(state, key, { get: () => store.state[key] });
  return { ...store, db, state, auth, guard, client, application, controller, invoke, dependencies, channel };
}
const materialCommand = key => ({ operationKey: key, orderId: 'own-order' });
const rejected = error => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'].includes(error.getResponse?.().code);
let groups = 0, completed = false;
async function check(name, work) { await work(); groups++; console.log(`PASS ${name}`); }
async function main() {
  const priorSecret = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = secret;
  try {
    for (const channel of ['web', 'wechat_miniprogram']) await check(`${channel} 原 Controller 资料→收据→任务→收据与当前锁序`, async () => {
      const f = fixture(channel), command = materialCommand('normal');
      const material = await f.invoke('prepareOrderMaterial', command);
      assert.equal(material.state, 'observed');
      assert.equal((await f.invoke('readOrderMaterialReceipt', command)).materialRef, material.materialRef);
      const taskCommand = { materialRef: material.materialRef, creationKey: 'normal-task' };
      const created = await f.invoke('createTask', taskCommand);
      assert.equal(created.state, 'observed'); assert.equal(created.task.status, 'queued');
      const receipt = await f.invoke('readTaskCreation', taskCommand);
      assert.equal(receipt.task.taskId, created.task.taskId); assert.equal(f.state.aiTask.length, 1);
      assert.equal(f.state.aiRun.length, 1); assert.equal(f.state.aiClientTaskInput.length, 1);
      assert.equal(f.state.aiTask[0].ownerKind, 'CUSTOMER'); assert.equal(f.state.aiTask[0].audience, 'CLIENT');
      assert.equal(f.state.aiTask[0].ownerId, 'customer');
      assert.equal(f.state.aiClientSceneMaterial[0].material.__aiBody, 'rental-os-ai-body-1');
      assert.equal((await f.invoke('createTask', taskCommand)).task.taskId, created.task.taskId);
      const transactions = [...new Set(f.state.events.filter(event => event.sql?.endsWith('FOR UPDATE')).map(event => event.owner))];
      for (const owner of transactions) {
        const events = f.state.events.filter(event => event.owner === owner && event.sql).map(event => event.sql);
        assert.match(events[0], /^SELECT id FROM Tenant .*FOR UPDATE$/u);
        assert(events.findIndex(sql => sql.includes('platform_core_access_locks')) > events.findIndex(sql => sql.includes('client_auth_sessions')));
        assert(events.findIndex(sql => sql.includes('FROM `rental_orders`')) > events.findIndex(sql => sql.includes('platform_core_access_locks')));
      }
      assert(!f.state.events.some(event => event.sql?.includes('platform_member_core_assignments')));
    });
    await check('原客户桥保持原 context/ALS，拒绝复制、跨会话及营运桥', async () => {
      const f = fixture();
      await f.invoke('prepareOrderMaterial', materialCommand('bridge'), async request => {
        assert.equal(f.state.authRows.writes, 1, '普通 HTTP 认证仍更新活跃时间');
        const source = createAiGuardedClientSession(f.guard, { current: async () => ({ authorization: request.headers.authorization }) });
        assert.equal(await source.current(), request.client);
        await source.withRead('order', 'own-order', async context => {
          assert.equal(context, request.client); assert.equal(identity.getRequestIdentity(), f.state.scope);
        });
        let lease;
        await f.db.$transaction(async tx => {
          lease = await f.auth.lockCurrentSession(tx, request.client);
          await source.current(); await lease.revalidate();
          assert.equal(f.state.authRows.writes, 1, '持 Session 锁的内部复验不发根连接活跃写');
        }, { isolationLevel: 'Serializable' });
        await assert.rejects(() => lease.revalidate(), '已结束事务不能复用 Session 租约');
        assert.throws(() => captureRentalInternalAuthority());
        await assert.rejects(() => f.db.$transaction(tx => f.auth.lockCurrentSession(tx, { ...request.client }), { isolationLevel: 'Serializable' }));
        const ticket = captureRentalClientInternalAuthority();
        await assert.rejects(() => identity.runWithRequestIdentity(f.state.scope,
          () => ticket.runVerified({ ...request.client, sessionId: 'other-session' }, async () => assert.fail('不应恢复'))));
      });
    });
    await check('Core/会话/本人归属/发布撤回在原写事务回滚', async () => {
      for (const kind of ['core', 'session', 'owner', 'publication']) {
        const f = fixture(); let fired = false;
        f.state.beforeQuery = async (sql, tx, owner) => {
          if (owner === 'root' || fired || !sql.includes('FROM customer_profiles')) return;
          fired = true;
          if (kind === 'core') f.state.grant = 'disabled';
          if (kind === 'session') f.state.authRows.state.session.revokedAt = new Date();
          if (kind === 'owner') await tx.rentalOrder.updateMany({ where: { id: 'own-order' }, data: { customerId: 'another' } });
          if (kind === 'publication') await tx.clientChannelWorkspace.updateMany({ where: {}, data: { enabled: false } });
        };
        await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand(kind)), rejected);
        assert(fired); assert.equal(f.state.aiClientSceneMaterial.length, 0); assert.equal(f.state.aiTask.length, 0);
      }
    });
    await check('person/enterprise、空间、渠道均不能借原资料', async () => {
      const f = fixture(), command = materialCommand('scope'), material = await f.invoke('prepareOrderMaterial', command);
      const task = { materialRef: material.materialRef, creationKey: 'scope-task' };
      for (const update of [() => { f.state.authRows.state.customer.customerType = 'corporate'; },
        () => { f.state.authRows.state.session.workspaceId = 'other-space'; }]) {
        update(); await assert.rejects(() => f.invoke('createTask', task));
        f.state.authRows.state.customer.customerType = 'personal'; f.state.authRows.state.session.workspaceId = 'workspace';
      }
      const other = composeStandardClientBookingEntry(f.dependencies, 'wechat_miniprogram');
      await assert.rejects(() => f.invoke('createTask', task, request => other.createTask(request, task)));
      assert.equal(f.state.aiClientTaskInput.length, 0); assert.equal(f.state.aiTask.length, 0);
      // The original own-order predicate retains an enterprise-paid order
      // whose recorded personal user is this client, without opening coworkers.
      f.state.rentalOrder[0].customerId = 'enterprise';
      f.state.rentalOrder[0].membershipSnapshot = { personalCustomerId: 'customer' };
      assert.equal((await f.invoke('prepareOrderMaterial', materialCommand('own-enterprise'))).state, 'observed');
      f.state.rentalOrder[0].membershipSnapshot = { personalCustomerId: 'coworker' };
      await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand('coworker')));
    });
    await check('原资料、输入 claim、Task COMMIT 失回复只读原键不重建', async () => {
      for (const lost of ['material', 'input', 'task']) {
        const f = fixture(), command = materialCommand(`lost-${lost}`);
        if (lost === 'material') {
          f.state.lost = lost;
          await assert.rejects(() => f.invoke('prepareOrderMaterial', command), error => error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
          f.state.lost = undefined;
          assert.equal((await f.invoke('readOrderMaterialReceipt', command)).state, 'observed');
          assert.equal(f.state.aiClientSceneMaterial.length, 1);
        } else {
          const material = await f.invoke('prepareOrderMaterial', command), task = { materialRef: material.materialRef, creationKey: `task-${lost}` };
          f.state.lost = lost;
          await assert.rejects(() => f.invoke('createTask', task), error => error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
          f.state.lost = undefined;
          const receipt = await f.invoke('readTaskCreation', task);
          assert.equal(receipt.state, lost === 'task' ? 'observed' : 'unknown');
          assert.equal(f.state.aiClientTaskInput.length, 1); assert.equal(f.state.aiTask.length, lost === 'task' ? 1 : 0);
          await f.invoke('createTask', task); assert.equal(f.state.aiTask.length, lost === 'task' ? 1 : 0);
        }
      }
    });
    await check('缺同实例参加者及已选宿主直接写仓储均关闭', async () => {
      const f = fixture(), material = await f.invoke('prepareOrderMaterial', materialCommand('denied'));
      await f.invoke('prepareOrderMaterial', materialCommand('direct'), async () => {
        const original = f.state.aiClientSceneMaterial[0];
        await assert.rejects(() => new PrismaClientSceneMaterialRepository(f.db).save({ ...original, id: randomUUID(), operationKey: 'direct' }));
      });
      const unavailable = composeStandardClientBookingEntry({ ...f.dependencies, transactions: undefined }, 'web');
      await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand('missing'), request =>
        unavailable.prepare(request, { operationKey: 'missing', command: { kind: 'order', orderId: 'own-order' } })));
      assert.equal(f.state.aiClientSceneMaterial.length, 1); assert(material.materialRef);
    });
    completed = true;
    console.log(JSON.stringify({ groups, database: 'original session-lock and task-rollback memory transport', diskOutputs: 0, modelCalls: 0 }));
  } finally { if (priorSecret === undefined) delete process.env.AUTH_TOKEN_SECRET; else process.env.AUTH_TOKEN_SECRET = priorSecret; }
}
module.exports = { fixture };
if (require.main === module) {
  process.once('beforeExit', () => assert(completed || process.exitCode === 1, '客户片不能留下未结束等待'));
  main().catch(error => { console.error(error.stack, error.getResponse?.()); process.exitCode = 1; });
}
