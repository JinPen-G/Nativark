'use strict';
/** 原场景事务定向验证：真实 Auth/Guard、空间主体锁、Core 准入、订单仓储与
 * 原请求/Task 创建仓储；仅持久化运输为可回滚内存夹具，不连接 MySQL 或模型。
 * node packages/ai-native-server/test/original-scene-transactions.test.cjs --deps <node_modules>
 * 全程内存，无临时目录、生成 Client、默认 Client、后台进程或磁盘输出。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/dev2-original-scene-transactions');
if (fs.existsSync(temporary)) throw Error('任务临时目录应不存在');
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const { createControllerSourceLoader } = require(path.join(root, 'scripts/controller-sources.cjs'));
const loader = createControllerSourceLoader(root, deps);
const load = file => loader.load(path.join(root, file));
const runtime = load('packages/platform-server/src/prisma-runtime.ts').prismaRuntime;
const identity = loader.load(loader.resolveSource(__filename, '@rental-os/platform-server/request-identity', true));
const shared = load('packages/shared/src/index.ts');
const { ConfigService } = loader.requireDependency('@nestjs/config');
const { RentalAuthService } = load('packages/rental-core/src/auth-service.ts');
const { RentalWorkspacePrincipalRepository } = load('packages/rental-core/src/mysql-workspace-principal.ts');
const { createRentalAuthorization } = load('packages/rental-core/src/http-auth.ts');
const { createRentalApplicationAccess } = load('packages/rental-core/src/application-access.ts');
const { RentalCoreFactRepository } = load('packages/rental-core/src/mysql-core-facts.ts');
const { RentalBusinessFactRepository } = load('packages/rental-core/src/mysql-business-facts.ts');
const { AiTaskCurrentIdentityAuthority } = load('packages/ai-native-server/src/runtime/task-current-identity.authority.ts');
const { PrismaOriginalRequestRepository } = load('packages/ai-native-server/src/runtime/task-request/prisma-original-request.repository.ts');
const { originalIdentityHash } = load('packages/ai-native-server/src/runtime/task-request/original-request.authority.ts');
const { parseOriginalRequest } = load('packages/ai-native-server/src/runtime/task-request/original-request.validation.ts');
const { aiPersistenceScopeColumns } = load('packages/ai-native-server/src/runtime/persistence-scope.ts');
const { requestFingerprint } = load('packages/ai-native-server/src/runtime/rental-adapters/rental-idempotency.repository.ts');
const { withOriginalSceneTaskTransactions } = load('packages/ai-native-server/src/runtime/scenes/original-scene-transactions.ts');
const { createOriginalSceneInputTransactions } = load('packages/ai-native-server/src/runtime/scenes/original-scene-input-transactions.ts');
const { withTaskCenterTransactions } = load('packages/ai-native-server/src/runtime/task-center-transactions.ts');
const { withAiTaskTransaction } = load('packages/ai-native-server/src/runtime/task-transaction-authority.ts');
const { composeAiOriginalScenes } = load('packages/ai-native-server/src/runtime/scenes/original-scenes.composition.ts');
const { composeRequestBoundOriginalScenes } = load('packages/ai-native-server/src/runtime/scenes/request-bound-scenes.application.ts');
const { user: syntheticUser } = require(path.join(root, 'tests/fixtures/ai-native/authorization-baseline.cjs'));

// Reuse the existing rollback/SQL transport fixture. Its sole legacy Prisma import
// only needs Decimal; bind that import to the exact official schema-free runtime.
const storeFile = path.join(root, 'tests/fixtures/ai-native/task-input-store.cjs');
const storeModule = { exports: {} }, fixtureRequire = createRequire(storeFile);
new Function('require', 'module', 'exports', fs.readFileSync(storeFile, 'utf8'))(
  name => name === '../../../apps/api/node_modules/@prisma/client' ? { Prisma: runtime } : fixtureRequire(name),
  storeModule, storeModule.exports);
const { createTaskInputStore, clone } = storeModule.exports;
const authorization = createRentalAuthorization(shared);
const bodies = [
  { sceneCode: 'order_explanation', input: { orderId: 'order-a', question: 'status' } },
  { sceneCode: 'opening_diagnosis', input: { sections: ['basic'] } },
  { sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal', items: [{ productName: 'camera', quantity: 1 }] } } },
  { sceneCode: 'quote_clarification', input: { kind: 'quote_goal', draftVersion: shared.AI_QUOTE_GOAL_DRAFT_VERSION, goalText: '租一台相机' } },
];
const inputRef = '11111111-1111-4111-8111-111111111111';
const reference = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef };
const required = [...new Set(['system:params:manage', 'rental-os:order:view', 'rental-os:order:operate',
  ...['/rental/v1/business-settings', '/rental/v1/tenant-readiness', '/rental/v1/item-groups', '/rental/v1/booking-members']
    .flatMap(route => authorization.requiredPermissions('GET', route))])];
function fixture(body = bodies[0], selectedLocations = false, extraTables = {}) {
  const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  const scope = { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
  const user = syntheticUser({ permissions: [...required] });
  const role = { id: 'role-a', name: 'operator', isActive: true, fixedAllPermissions: false,
    scope: 'TENANT', dataScope: 'ALL', buttonPermissions: [], permissions: required.map(code => ({ permission: { code } })) };
  const member = { userId: user.id, workspaceId: 'workspace-a', tenantId: 'tenant-a', isActive: true,
    workspace: { status: 'ACTIVE' }, role, dataScope: null,
    locationScope: selectedLocations ? { mode: 'selected', locationIds: ['location-a'] } : { mode: 'all', locationIds: [] } };
  const store = createTaskInputStore({ ...extraTables, aiScope: [scope], aiTaskOriginalRequest: [], aiTask: [], aiRun: [], aiStep: [],
    aiTaskPlanPolicy: [...new Set(bodies.map(body => body.sceneCode))].map(sceneCode => ({ scopeId: scope.id, sceneCode,
      sceneVersion: '1', revision: 1, enabled: true, allowedTools: [], limits: {}, expiresAt })),
    aiGatewayInvocation: [], aiTaskActionInput: [], aiTaskRunPlan: [], aiTaskExecutionCharge: [], rentalApprovedSettingsChange: [], operationLog: [], rentalQuote: [],
    user: [user], workspaceMember: [member], businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant-a', status: 'ACTIVE' }],
    authSession: [{ id: 'session-a', userId: user.id, audience: 'operator', currentWorkspaceId: 'workspace-a', revokedAt: null, expiresAt }],
    tenant: [{ id: 'tenant-a', status: 'active', subscription: { startAt: now, endAt: expiresAt }, subscriptionSegments: [] }],
    rentalOrder: [{ id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', status: 'RESERVED', categoryCode: 'CAMERA',
      createdBy: user.id, fulfillmentLocationId: 'location-a', returnLocationId: 'location-a', orderNo: 'ORDER-A',
      rentalAmount: 100, serviceAmount: 0, discountAmount: 0, couponAmount: 0, depositAmount: 20, preAuthAmount: 0, finalPayableAmount: 100,
      startAt: now, endAt: expiresAt, createdAt: now, updatedAt: now, lines: [], reservations: [], allocations: [], currency: 'CNY' }],
  }, { aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']],
    aiTaskOriginalRequest: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'requestKey']] });
  const state = { grant: 'enabled', assignment: 'assigned', available: true, credential: '', queries: [],
    currentTx: undefined, beforeTask: undefined, afterRun: undefined, afterTask: undefined, lateInput: undefined, onInputWrite: undefined };
  const raw = async (tx, query, ...values) => {
    const q = Array.isArray(query) ? runtime.sql(query, ...values) : query;
    const sql = q.sql.replace(/\s+/gu, ' ').trim(), v = q.values;
    state.queries.push(sql); store.trace.push('sql:' + sql);
    if (sql.includes('FROM Tenant')) return [{ id: 'tenant-a', status: 'active' }];
    if (sql.includes('FROM `User`')) return [{ id: user.id, roleId: role.id }];
    if (sql.includes('FROM auth_sessions')) return [{ id: 'session-a' }];
    if (sql.includes('FROM workspace_members')) return [{ roleId: role.id }];
    if (sql.includes('FROM `UserRole`')) return [];
    if (sql.includes('FROM `Role`')) return [{ id: role.id }];
    if (sql.includes('FROM `RolePermission`')) return [{ permissionId: 'permission-a' }];
    if (sql.includes('FROM `Permission`')) return [{ id: 'permission-a' }];
    if (sql.includes('FROM platform_core_access_locks')) return [{ tenantId: 'tenant-a', coreId: 'rental' }];
    if (sql.includes('FROM platform_tenant_core_grants')) return [{ state: state.grant, revision: 1n, operationId: 'grant-a' }];
    if (sql.includes('FROM platform_member_core_assignments')) return [{ state: state.assignment, revision: 1n, operationId: 'assignment-a' }];
    if (sql.includes('FROM platform_core_bindings')) return [{ bindingId: 'binding-a', revision: 1n, dataVersion: '0.1.0',
      containerType: 'rental-workspace', containerId: 'workspace-a' }];
    if (sql.includes('FROM `rental_orders`')) return tx.rentalOrder.findMany({ where: { tenantId: v[0], workspaceId: v[1], id: v[2] } });
    if (sql.includes('FROM rental_allocations')) return [];
    if (sql.includes('FROM business_workspaces')) {
      assert(sql.includes("status = 'active'"), '原生 SQL 必须使用 schema 映射值 active');
      return tx.businessWorkspace.findMany({ where: { tenantId: v[0], id: v[1], status: 'ACTIVE' } });
    }
    if (sql.includes('FROM ai_task_original_requests')) {
      if (state.lateInput) { const change = state.lateInput; state.lateInput = undefined; await change(tx); }
      return tx.aiTaskOriginalRequest.findMany({ where: { scopeId: v[0], id: v[1] } });
    }
    throw Error('未模拟的 SQL：' + sql);
  };
  const transaction = store.db.$transaction;
  store.db.$transaction = (consume, options) => transaction(async tx => {
    const prior = state.currentTx; state.currentTx = tx;
    tx.$queryRaw = (query, ...values) => raw(tx, query, ...values);
    try { return await consume(tx); } finally { state.currentTx = prior; }
  }, options);
  store.control.beforeWrite = async (table, args, data) => {
    if (table === 'aiTask' && state.beforeTask) await state.beforeTask(state.currentTx, data);
    if (table === 'aiRun' && state.afterRun) await state.afterRun(state.currentTx, data);
    if (table === 'aiTaskOriginalRequest' && state.onInputWrite) await state.onInputWrite(state.currentTx, data);
  };
  const principals = new RentalWorkspacePrincipalRepository(store.db, {
    findUserById: (id, tx) => (tx ?? store.db).user.findFirst({ where: { id } }),
    projectWorkspace: row => row, projectRoleScope: scope => scope.toLowerCase(), projectDataScope: scope => scope.toLowerCase(),
  });
  const authSource = {
    findUserById: id => store.db.user.findFirst({ where: { id } }),
    getAuthSession: id => store.db.authSession.findFirst({ where: { id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    findWorkspaceScopedUser: principals.findWorkspaceScopedUser.bind(principals), listUserWorkspaces: principals.listUserWorkspaces.bind(principals),
    lockWorkspaceSessionUser: principals.lockWorkspaceSessionUser.bind(principals), readWorkspaceSessionUser: principals.readWorkspaceSessionUser.bind(principals),
  };
  const auth = new RentalAuthService(authSource, new ConfigService({ AUTH_TOKEN_SECRET: 'offline-test-secret', NODE_ENV: 'test' }), undefined, undefined, undefined, store.db);
  const guard = new authorization.Guard(auth, undefined, undefined, undefined, store.db);
  const access = createRentalApplicationAccess({ database: store.db, authorization,
    term: { requireNewBusiness: async () => { throw Error('三场景 Task 元数据不是租赁新业务'); } },
    deploymentForTransaction: tx => ({ requireAvailable: async () => { assert(tx.$queryRaw); if (!state.available) throw Error('deployment unavailable'); } }) });
  const orders = new RentalCoreFactRepository(store.db, { ...identity,
    resolveWorkspaceId: async (_tx, tenantId) => { assert.equal(tenantId, identity.getRequestIdentity().tenantId); return identity.getRequestWorkspaceId(); } });
  const quotes = new RentalBusinessFactRepository(store.db, {
    resolveWorkspaceId: async (_tx, tenantId) => { assert.equal(tenantId, identity.getRequestIdentity().tenantId); return identity.getRequestWorkspaceId(); }
  });
  const token = auth.signAccessToken({ sub: user.id, tid: user.tenantId, sid: 'session-a', wid: 'workspace-a', aud: 'operator', exp: Math.floor(expiresAt.getTime() / 1000) });
  state.credential = 'Bearer ' + token;
  const credentials = { current: async () => ({ authorization: state.credential, audience: 'operator', requestId: 'original-scene-test' }) };
  const currentIdentity = new AiTaskCurrentIdentityAuthority(auth, credentials);
  const current = async () => ({ scopeId: scope.id, context: await currentIdentity.resolve() });
  const creationRules = [...new Set(bodies.map(body => body.sceneCode))].map(sceneCode => ({ sceneCode, sceneVersion: '1', revision: 1,
    audiences: ['operator'], requiredPermissions: ['system:params:manage'], maxInputAgeMs: 600000 }));
  // The test fixes the existing scene policy/entitlement as input. Real policy
  // loading is outside this transaction participant; real current identity is not.
  const originalAuthority = { current, read: current, create: async () => ({ ...await current(), sceneVersion: '1',
    policyRevision: 1, policyHash: 'a'.repeat(64), expiresAt: expiresAt.toISOString() }) };
  const requests = new PrismaOriginalRequestRepository(store.db, originalAuthority);
  const input = { db: store.db, credentials, transactions: { auth, orders, quotes }, creationRules };
  const inputParticipant = createOriginalSceneInputTransactions(input);
  const inputRequests = new PrismaOriginalRequestRepository(store.db, originalAuthority, undefined, inputParticipant);
  const invoke = (work, options = {}) => identity.runWithRequestIdentity({}, () => access.run(async () => {
    const operation = options.operation ?? shared.AI_SCENE_REQUEST_HTTP_DRAFT.createTask;
    const request = { method: 'POST', url: '/api/' + shared.AI_SCENE_REQUEST_HTTP_DRAFT.basePath + (operation ? '/' + operation : ''),
      headers: { authorization: 'Bearer ' + token }, body: reference, query: {} };
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
    return access.withRequest(request, async () => {
      if (options.seed !== false && !store.state.aiTaskOriginalRequest.length) {
        const parsed = parseOriginalRequest({ ...body, draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'request-a' });
        const row = { id: inputRef, scopeId: scope.id, audience: 'OPERATOR', ownerKind: 'USER', ownerId: user.id,
          contractVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, sceneCode: parsed.sceneCode, sceneVersion: '1', requestKey: 'request-a',
          revision: 1, previousRequestId: null, status: 'STORED', erasedAt: null, creationClosedAt: null, creationCloseKey: null,
          payload: clone(parsed.input), authorizationBindingHash: originalIdentityHash(await currentIdentity.resolve()),
          policyRevision: 1, policyHash: 'a'.repeat(64), createdAt: now, expiresAt };
        row.contentHash = requestFingerprint({ version: row.contractVersion, scopeId: scope.id, audience: row.audience,
          ownerKind: row.ownerKind, ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
          revision: row.revision, previousInputRef: row.previousRequestId, input: row.payload });
        store.state.aiTaskOriginalRequest.push(row);
      }
      return work(request);
    });
  }));
  const create = () => withOriginalSceneTaskTransactions(input, reference, () => requests.createTask(reference), 'creation');
  const step = async () => {
    const task = store.state.aiTask[0], run = store.state.aiRun[0];
    store.state.aiStep.push({ id: 'step-a', scopeId: scope.id, taskId: task.id, runId: run.id,
      toolCode: 'rental.order.explain', toolVersion: shared.AI_TOOL_DRAFT_VERSION, actionId: 'action-a', requestFingerprint: 'f'.repeat(64) });
    store.state.aiGatewayInvocation.push({ callId: 'call-a', scopeId: scope.id, taskId: task.id, actorId: user.id,
      stepId: 'step-a', runId: run.id, actionId: 'action-a', stepFingerprint: 'f'.repeat(64) });
  };
  const participate = key => withOriginalSceneTaskTransactions(input, reference, () => store.db.$transaction(tx =>
    withAiTaskTransaction(tx, key, () => tx.aiTask.updateMany({ where: { id: store.state.aiTask[0].id }, data: { revision: { increment: 1 } } })),
  { isolationLevel: 'Serializable' }));
  const unexpected = async () => { throw Error('非本测试场景的业务读取'); };
  const businessDependencies = { ...input, auth, guard,
    subscriptions: { readCategoryCommercialContext: async () => ({ revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
      entitlements: [{ code: 'ai.native.use', available: true, categories: [] }] }) },
    core: { readAvailability: unexpected, getOrder: unexpected, listItemGroups: unexpected, resolvePricingGroupQuoteRequest: unexpected,
      readOpeningConfiguration: unexpected, readQuoteConfiguration: unexpected,
      readOrderFacts: (tenant, id) => orders.findOrder(tenant, id) },
    business: { createQuote: unexpected, loadQuote: unexpected, readOrderLinkedQuoteFacts: unexpected, readTenantReadiness: async () => ({ tenantId: 'tenant-a',
      workspaceId: 'workspace-a', ready: true, items: [{ key: 'basic', title: 'Basic', done: true, missing: '' }] }) },
    memberships: { listPersonalOptions: unexpected }, reports: { getBoundedOperationReport: unexpected } };
  const createThroughRequest = async request => {
    const app = composeAiOriginalScenes(businessDependencies);
    const grant = await app.creationAuthority.create(body);
    await store.db.aiTaskOriginalRequest.updateMany({ where: { id: inputRef }, data: { policyHash: grant.policyHash, policyRevision: grant.policyRevision } });
    const { credentials: _, ...dependencies } = businessDependencies;
    return composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' }).createTask(request, reference);
  };
  const saveCommand = (key = 'input-save-a', selectedBody = body) => ({ ...structuredClone(selectedBody),
    draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: key });
  const requestBound = () => {
    const { credentials: _, ...dependencies } = businessDependencies;
    return composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  };
  return { ...store, businessDependencies, state, invoke, create, createThroughRequest, participate, input, step, auth, guard, orders, requests,
    inputRequests, inputParticipant, originalAuthority, saveCommand, requestBound };
}

async function main() {
  let count = 0;
  const test = async (name, work) => { await work(); count++; console.log('PASS ' + name); };
  for (const [i, body] of bodies.entries()) await test('原仓储创建与幂等：' + body.sceneCode + ':' + i, async () => {
    const f = fixture(body, i === 0);
    await f.invoke(async () => {
      const result = await f.create(); assert.equal(result.replayed, false);
      const replay = await f.create(); assert.equal(replay.replayed, true); assert.equal(replay.taskId, result.taskId);
    });
    assert.equal(f.trace.filter(row => row === 'aiTask.create').length, 1);
    assert.equal(f.trace.filter(row => row === 'aiRun.create').length, 1);
    const indices = ['FROM Tenant WHERE', 'FROM auth_sessions', 'FROM platform_core_access_locks',
      ...(i === 0 ? ['FROM `rental_orders`'] : []), 'FROM business_workspaces', 'FROM ai_task_original_requests', 'aiTask.create']
      .map(part => f.trace.findIndex((entry, index) => index > f.trace.indexOf('transaction.commit') && entry.includes(part)));
    assert(indices.every(index => index >= 0));
    for (let n = 1; n < indices.length; n++) assert(indices[n] > indices[n - 1], '主体/Core/业务/原请求/Task 锁序');
  });
  const changes = {
    session: tx => tx.authSession.updateMany({ where: { id: 'session-a' }, data: { revokedAt: new Date() } }),
    workspace: tx => tx.authSession.updateMany({ where: { id: 'session-a' }, data: { currentWorkspaceId: 'workspace-other' } }),
    member: tx => tx.workspaceMember.updateMany({ where: { userId: 'operator-a' }, data: { isActive: false } }),
    permission: async (_tx, data) => { data.workspaceMember[0].role.permissions = []; },
    location: tx => tx.workspaceMember.updateMany({ where: { userId: 'operator-a' }, data: { locationScope: { mode: 'selected', locationIds: [] } } }),
    input: tx => tx.aiTaskOriginalRequest.updateMany({ where: { id: inputRef }, data: { contentHash: '0'.repeat(64) } }),
    closed: tx => tx.aiTaskOriginalRequest.updateMany({ where: { id: inputRef }, data: { creationClosedAt: new Date(), creationCloseKey: 'closed-a' } }),
  };
  for (const [name, change] of Object.entries(changes)) await test('提交前变化回滚 Task/Run：' + name, async () => {
    const f = fixture();
    f.state.afterRun = change;
    await assert.rejects(f.invoke(f.create));
    assert.equal(await f.db.aiTask.count({}), 0); assert.equal(await f.db.aiRun.count({}), 0);
    assert(f.trace.includes('aiTask.create')); assert(f.trace.includes('transaction.error'));
    assert.equal(f.trace.filter(row => row === 'aiTask.create').length, 1, '不自动重试');
  });
  for (const [name, change] of Object.entries({ core: f => { f.state.grant = 'disabled'; },
    assignment: f => { f.state.assignment = 'unassigned'; }, deployment: f => { f.state.available = false; },
    credential: f => { f.state.credential = 'Bearer changed'; } })) await test('原事务末复验拒绝：' + name, async () => {
    const f = fixture(); f.state.afterRun = async () => change(f);
    await assert.rejects(f.invoke(f.create)); assert.equal(await f.db.aiTask.count({}), 0); assert.equal(await f.db.aiRun.count({}), 0);
  });
  await test('非锁定定位后原输入替换拒绝', async () => {
    const f = fixture(); f.state.lateInput = tx => tx.aiTaskOriginalRequest.updateMany({ where: { id: inputRef }, data: { ownerId: 'other' } });
    await assert.rejects(f.invoke(f.create)); assert(!f.trace.includes('aiTask.create'));
  });
  await test('跨空间订单拒绝，不能借 inputRef 授权', async () => {
    const f = fixture(); await f.db.rentalOrder.updateMany({ where: { id: 'order-a' }, data: { workspaceId: 'workspace-other' } });
    await assert.rejects(f.invoke(f.create)); assert(!f.trace.includes('aiTask.create'));
  });
  await test('缺同实例 ports 拒绝、客户端多余资源字段拒绝', async () => {
    const f = fixture(); await f.invoke(async () => {
      await assert.rejects(withOriginalSceneTaskTransactions({ ...f.input, transactions: undefined }, reference, f.create, 'creation'));
      await assert.rejects(withOriginalSceneTaskTransactions(f.input, { ...reference, orderId: 'forged' }, f.create, 'creation'));
    }); assert(!f.trace.includes('aiTask.create'));
  });
  await test('继续和派发引用同源，嵌套复用原 Task 权威', async () => {
    const f = fixture(); await f.invoke(async () => {
      const task = await f.create(); await f.step();
      await f.participate({ kind: 'task', taskId: task.taskId });
      await f.participate({ kind: 'step', stepId: 'step-a' });
      await f.participate({ kind: 'invocation', callId: 'call-a' });
      await withTaskCenterTransactions(f.input.transactions, f.db, f.input.credentials, task.taskId,
        () => f.participate({ kind: 'step', stepId: 'step-a' }));
      for (const key of [{ kind: 'task', taskId: 'other-task' }, { kind: 'step', stepId: 'other-step' },
        { kind: 'invocation', callId: 'other-call' }, { kind: 'creation', inputRef, sceneCode: 'order_explanation' }]) {
        const before = await f.db.aiTask.findFirst({ where: { id: task.taskId } });
        await assert.rejects(f.participate(key));
        assert.equal((await f.db.aiTask.findFirst({ where: { id: task.taskId } })).revision, before.revision);
      }
    });
  });
  await test('过期输入禁止新继续，原 task_control 仍沿原停止政策', async () => {
    const f = fixture(); await f.invoke(async () => {
      const task = await f.create();
      await f.db.aiTaskOriginalRequest.updateMany({ where: { id: inputRef }, data: { expiresAt: new Date(Date.now() - 1) } });
      await assert.rejects(f.participate({ kind: 'task', taskId: task.taskId }));
      await f.participate({ kind: 'task_control', taskId: task.taskId });
    });
  });
  for (const body of bodies.slice(0, 2)) await test('真实 request-bound composition：' + body.sceneCode, async () => {
    const f = fixture(body);
    const result = await f.invoke(f.createThroughRequest);
    assert.equal(result.replayed, false); assert.equal(await f.db.aiTask.count({}), 1); assert.equal(await f.db.aiRun.count({}), 1);
    assert(f.trace.some(entry => entry.includes('FROM auth_sessions')));
  });
  for (const [i, body] of bodies.entries()) await test('原 INPUT 保存/幂等/重签同事务：' + body.sceneCode + ':' + i, async () => {
    const f = fixture(body, i === 0);
    await f.invoke(async () => {
      const command = f.saveCommand(), receipt = await f.inputRequests.save(command);
      assert.equal(receipt.replayed, false); assert.equal(receipt.revision, 1);
      const replay = await f.inputRequests.save(command);
      assert.equal(replay.replayed, true); assert.equal(replay.inputRef, receipt.inputRef);
      const reissue = await f.inputRequests.save({ ...f.saveCommand('input-save-b'), previousInputRef: receipt.inputRef }, true);
      assert.equal(reissue.revision, 2); assert.equal(reissue.previousInputRef, receipt.inputRef);
      assert.equal(await f.db.aiTaskOriginalRequest.count({}), 2);
      assert.equal(await f.db.aiTask.count({}), 0, '保存不制造 Task');
    }, { seed: false, operation: '' });
    const createAt = f.trace.indexOf('aiTaskOriginalRequest.create');
    const transactionAt = f.trace.lastIndexOf('transaction.begin', createAt), end = f.trace.indexOf('transaction.commit', createAt);
    const entries = f.trace.slice(transactionAt, end);
    const positions = ['FROM Tenant WHERE', 'FROM auth_sessions', 'FROM platform_core_access_locks',
      ...(i === 0 ? ['FROM `rental_orders`'] : []), 'FROM business_workspaces', 'aiTaskOriginalRequest.read', 'aiTaskOriginalRequest.create']
      .map(part => entries.findIndex(entry => entry.includes(part)));
    assert(positions.every(index => index >= 0));
    for (let n = 1; n < positions.length; n++) assert(positions[n] > positions[n - 1], '保存沿 Auth/Core/资源/input 锁序');
    assert(entries.some((entry, index) => index > positions.at(-1) && entry.includes('FROM platform_core_access_locks')), '原提交前 Core 复验');
    assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 2);
  });
  for (const [name, change] of Object.entries(changes).filter(([name]) => !['input', 'closed'].includes(name)))
    await test('INPUT 最后等待期间撤权回滚：' + name, async () => {
      const f = fixture();
      f.state.onInputWrite = change;
      await assert.rejects(f.invoke(() => f.inputRequests.save(f.saveCommand()), { seed: false, operation: '' }),
        error => error.code !== 'AI_RESULT_UNKNOWN');
      assert.equal(await f.db.aiTaskOriginalRequest.count({}), 0);
      assert(f.trace.includes('aiTaskOriginalRequest.create')); assert(f.trace.includes('transaction.error'));
      assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 1);
    });
  for (const [name, change] of Object.entries({ core: f => { f.state.grant = 'disabled'; },
    assignment: f => { f.state.assignment = 'unassigned'; }, deployment: f => { f.state.available = false; },
    credential: f => { f.state.credential = 'Bearer changed'; } })) await test('INPUT 关联后最终围栏回滚：' + name, async () => {
    const f = fixture();
    await assert.rejects(f.invoke(() => f.inputRequests.save(f.saveCommand(), false, async (tx, receipt) => {
      assert.equal(tx, f.state.currentTx);
      await tx.operationLog.create({ data: { id: 'associated-a', inputRef: receipt.inputRef } });
      change(f);
    }), { seed: false, operation: '' }), error => error.code !== 'AI_RESULT_UNKNOWN');
    assert.equal(await f.db.aiTaskOriginalRequest.count({}), 0);
    assert.equal(await f.db.operationLog.count({}), 0);
    assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 1);
  });
  await test('INPUT 缺 participant/Auth/orders/quotes 不写', async () => {
    const f = fixture();
    await f.invoke(async () => {
      await assert.rejects(f.requests.save(f.saveCommand()), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
      for (const missing of ['auth', 'orders', 'quotes']) {
        const participant = createOriginalSceneInputTransactions({ ...f.input, transactions: { ...f.input.transactions, [missing]: undefined } });
        const repository = new PrismaOriginalRequestRepository(f.db, f.originalAuthority, undefined, participant);
        await assert.rejects(repository.save(f.saveCommand()), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
      }
    }, { seed: false, operation: '' });
    assert.equal(await f.db.aiTaskOriginalRequest.count({}), 0);
    assert(!f.trace.includes('aiTaskOriginalRequest.create'));
  });
  await test('INPUT 最后资源读取等待后撤 Core 仍回滚', async () => {
    const f = fixture(), findOrder = f.orders.findOrder.bind(f.orders);
    f.orders.findOrder = async (...args) => {
      const order = await findOrder(...args);
      if (f.trace.includes('aiTaskOriginalRequest.create')) f.state.grant = 'disabled';
      return order;
    };
    await assert.rejects(f.invoke(() => f.inputRequests.save(f.saveCommand()), { seed: false, operation: '' }),
      error => error.code !== 'AI_RESULT_UNKNOWN');
    assert.equal(await f.db.aiTaskOriginalRequest.count({}), 0);
    assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 1);
  });
  await test('INPUT 关联失败原事务回滚且不重试', async () => {
    const f = fixture();
    await assert.rejects(f.invoke(() => f.inputRequests.save(f.saveCommand(), false, async () => { throw Error('private association failure'); }),
      { seed: false, operation: '' }), error => error.code === 'AI_STORAGE_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(await f.db.aiTaskOriginalRequest.count({}), 0);
    assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 1);
  });
  await test('INPUT 失 COMMIT 原 key 观察保留，撤 Core 不重写/重准入', async () => {
    const f = fixture(), command = f.saveCommand();
    await f.invoke(async () => {
      f.control.loseReply = true;
      await assert.rejects(f.inputRequests.save(command, false, async (tx, receipt) => {
        await tx.operationLog.create({ data: { id: 'associated-a', inputRef: receipt.inputRef } });
      }), error => error.code === 'AI_RESULT_UNKNOWN' && error.retryable === false && error.nextAction === 'reconcile');
      assert.equal(await f.db.aiTaskOriginalRequest.count({}), 1);
      assert.equal(await f.db.operationLog.count({}), 1);
      f.state.grant = 'disabled';
      const at = f.trace.length, observed = await f.inputRequests.reconcile(command);
      assert.equal(observed.state, 'observed'); assert.equal(observed.receipt.requestKey, command.requestKey);
      assert(!f.trace.slice(at).some(entry => entry.includes('FOR UPDATE') || entry.includes('platform_core_access_locks') || entry.endsWith('.create')));
      await assert.rejects(f.inputRequests.save(f.saveCommand('new-key-after-revoke')));
      assert.equal(await f.db.aiTaskOriginalRequest.count({}), 1);
      assert.equal(f.trace.filter(entry => entry === 'aiTaskOriginalRequest.create').length, 1);
    }, { seed: false, operation: '' });
  });
  await test('INPUT 已确认提交后撤权不遮蔽原保存收据', async () => {
    const f = fixture();
    await f.invoke(async () => {
      f.control.beforeCommit = async () => { f.state.grant = 'disabled'; };
      const receipt = await f.inputRequests.save(f.saveCommand());
      assert.equal(receipt.replayed, false); assert.equal(await f.db.aiTaskOriginalRequest.count({}), 1);
    }, { seed: false, operation: '' });
  });
  await test('INPUT 重签锁前序订单与新订单，等待后前序变更拒绝', async () => {
    const f = fixture();
    await f.invoke(async () => {
      const saved = await f.inputRequests.save(f.saveCommand());
      const order = await f.db.rentalOrder.findFirst({ where: { id: 'order-a' } });
      await f.db.rentalOrder.create({ data: { ...order, id: 'order-b' } });
      const reissue = { ...f.saveCommand('reissue-b', { sceneCode: 'order_explanation', input: { orderId: 'order-b', question: 'status' } }),
        previousInputRef: saved.inputRef };
      f.state.lateInput = tx => tx.aiTaskOriginalRequest.updateMany({ where: { id: saved.inputRef }, data: { ownerId: 'other' } });
      const at = f.trace.length;
      await assert.rejects(f.inputRequests.save(reissue, true));
      assert.equal(await f.db.aiTaskOriginalRequest.count({}), 1);
      const tail = f.trace.slice(at), inputAt = tail.findIndex(entry => entry.includes('FROM ai_task_original_requests'));
      assert.equal(tail.slice(0, inputAt).filter(entry => entry.includes('FROM `rental_orders`')).length, 2);
      assert(!tail.includes('aiTaskOriginalRequest.create'));
    }, { seed: false, operation: '' });
  });
  await test('INPUT legacy 无 selected 保留原 save/reissue/reconcile', async () => {
    const f = fixture();
    const original = await f.requests.save(f.saveCommand());
    const reissued = await f.requests.save({ ...f.saveCommand('legacy-reissue'), previousInputRef: original.inputRef }, true);
    assert.equal(reissued.revision, 2);
    assert.equal((await f.requests.reconcile(f.saveCommand())).state, 'observed');
    assert(!f.trace.some(entry => entry.includes('platform_core_access_locks') || entry.includes('FROM Tenant')));
  });
  await test('INPUT 事务租约退出后失活，不再次读取原事务', async () => {
    const f = fixture(); let lease;
    const repository = new PrismaOriginalRequestRepository(f.db, f.originalAuthority, undefined, {
      begin: async (tx, target) => { lease = await f.inputParticipant.begin(tx, target); return lease; }
    });
    await f.invoke(() => repository.save(f.saveCommand()), { seed: false, operation: '' });
    const after = f.trace.length;
    await assert.rejects(lease.revalidate(), error => error.code === 'AI_ACCESS_DENIED');
    assert.equal(f.trace.length, after);
  });
  for (const body of bodies.slice(0, 2)) await test('INPUT 真实 request-bound 首次保存接线：' + body.sceneCode, async () => {
    const f = fixture(body);
    const result = await f.invoke(request => f.requestBound().create(request, f.saveCommand()), { seed: false, operation: '' });
    assert.equal(result.stage, 'task_metadata_created');
    assert.equal(await f.db.aiTaskOriginalRequest.count({}), 1); assert.equal(await f.db.aiTask.count({}), 1);
    const write = f.trace.indexOf('aiTaskOriginalRequest.create');
    assert(write > f.trace.findIndex(entry => entry.includes('platform_core_access_locks')));
  });
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ checks: count, real: ['Auth', 'Guard', 'WorkspacePrincipal', 'CoreAccess', 'OrderRepository', 'OriginalRequestRepository', 'TaskCreationRepository'],
    database: 'in-memory rollback transport', modelCalls: 0, diskOutputs: 0 }));
}
module.exports = { fixture, bodies, reference, inputRef, load, loader, shared, identity, runtime, aiPersistenceScopeColumns, requestFingerprint };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
