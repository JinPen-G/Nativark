'use strict';
/** Original scene plan/action policies through real Rental Auth/Guard/Core.
 * Reuses the original scene fixture; only exact policy SQL and rollback storage
 * are simulated. No model, Client generation, service, or disk output.
 * node packages/ai-native-server/test/scene-policy-transactions.test.cjs --deps <node_modules>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, bodies, reference, load, shared, runtime, requestFingerprint } = require('./original-scene-transactions.test.cjs');
const { composeRequestBoundScenePlanPolicies, composeRequestBoundOriginalTaskActionPolicies } =
  load('packages/ai-native-server/src/runtime/scenes/request-bound-scenes.application.ts');
const { PrismaTaskPlanPolicyRepository } = load('packages/ai-native-server/src/runtime/runner/prisma-task-plan-policy.repository.ts');
const { composeTaskActionPolicyManagement } = load('packages/ai-native-server/src/runtime/task-action-policy-management.composition.ts');
const { CoreAccessError } = load('packages/core-host/src/access.ts');
const root = path.resolve(__dirname, '../../..');
const temporary = path.join(root, 'output/.tmp/dev2-original-scene-transactions');
const scene = { code: 'order_explanation', version: '1' };
const tools = ['rental.order.explain'];
const actionCommand = { original: reference, operation: 'read_metadata', expectedRevision: null };
const planRoute = shared.AI_SCENE_PLAN_POLICY_HTTP_DRAFT;
const actionRoute = shared.AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT;
const operation = (route, name) => route.basePath.slice(shared.AI_SCENE_REQUEST_HTTP_DRAFT.basePath.length + 1) + '/' + route[name];
const hasCode = code => error => error?.code === code;
const unknown = error => error?.code === 'AI_RESULT_UNKNOWN' && error.retryable === false && error.nextAction === 'reconcile';
const committedPolicies = f => f.observed.transactions.filter(row => row.options?.isolationLevel === 'Serializable'
  && f.trace[row.end] === 'transaction.commit').length;
const change = (expectedRevision = 1) => ({ expectedRevision, enabled: true,
  limits: { maxSteps: 3, maxCalls: 2, maxConcurrent: 1, maxTotalMs: 30000, maxStepMs: 10000, maxOutputBytes: 4096 },
  expiresAt: new Date(Date.now() + 120000).toISOString() });

function policyFixture() {
  const f = fixture(bodies[0], false, { aiTaskActionPolicy: [] });
  const transactions = [], writes = [];
  const transaction = f.db.$transaction;
  f.db.$transaction = (consume, options) => transaction(async tx => {
    const record = { tx, options, start: f.trace.length };
    transactions.push(record);
    const query = tx.$queryRaw;
    tx.$queryRaw = async (input, ...values) => {
      const sql = Array.isArray(input) ? runtime.sql(input, ...values) : input;
      const text = sql.sql.replace(/\s+/gu, ' ').trim();
      if (text === 'SELECT id FROM ai_scopes WHERE id = ? FOR UPDATE') {
        assert.equal(sql.values.length, 1);
        f.trace.push('sql:' + text); f.state.queries.push(text);
        return tx.aiScope.findMany({ where: { id: sql.values[0] }, select: { id: true } });
      }
      if (text === 'SELECT revision FROM ai_task_plan_policies WHERE scopeId = ? AND sceneCode = ? AND sceneVersion = ? FOR UPDATE') {
        assert.equal(sql.values.length, 3);
        f.trace.push('sql:' + text); f.state.queries.push(text);
        return tx.aiTaskPlanPolicy.findMany({ where: { scopeId: sql.values[0], sceneCode: sql.values[1], sceneVersion: sql.values[2] },
          select: { revision: true } });
      }
      // The original fixture rejects every other unknown SQL statement.
      return query(input, ...values);
    };
    try { return await consume(tx); }
    finally { record.end = f.trace.length; }
  }, options);
  const beforeWrite = f.control.beforeWrite;
  f.control.beforeWrite = async (table, args, data) => {
    await beforeWrite?.(table, args, data);
    writes.push({ table, args: ['aiTaskPlanPolicy', 'aiTaskActionPolicy', 'operationLog'].includes(table)
      ? structuredClone(args) : undefined, tx: f.state.currentTx });
    await f.onPolicyWrite?.(table, args, data);
  };
  f.observed = { transactions, writes };
  f.clearObservations = () => { transactions.length = 0; writes.length = 0; f.trace.length = 0; f.state.queries.length = 0; };
  return f;
}
function dependencies(f, overrides = {}) {
  const { credentials: _, ...value } = f.businessDependencies;
  return { ...value, ...overrides };
}
function plans(f, overrides) {
  return composeRequestBoundScenePlanPolicies(dependencies(f, overrides), { enabled: true, audience: 'operator', scenes: [{ scene, tools }] });
}
function actions(f, overrides) {
  return composeRequestBoundOriginalTaskActionPolicies(dependencies(f, overrides), { enabled: true, audience: 'operator', ttlMs: 120000,
    templates: [{ operation: 'read_metadata', sceneCode: scene.code, requiredPermissions: ['rental-os:order:view'] }] });
}
function planRepository(f) {
  return new PrismaTaskPlanPolicyRepository(f.db, { auth: f.auth, guard: f.guard, credentials: f.input.credentials,
    scene, tool: tools[0], tools, audit: true });
}
function runPlan(f, command = change(), overrides) {
  return f.invoke(request => plans(f, overrides).change(request, { sceneCode: scene.code, change: command }),
    { operation: operation(planRoute, 'change'), seed: false });
}
function runAction(f, method, command = actionCommand, overrides) {
  const routeName = method === 'clear' ? 'clear' : method === 'read' || method === 'readReadingRecorded' ? 'read' : 'configure';
  return f.invoke(request => actions(f, overrides)[method](request, command), { operation: operation(actionRoute, routeName) });
}
async function seedTask(f) {
  let result;
  try { result = await f.invoke(f.create); }
  catch (error) { throw new Error('original Task fixture creation failed', { cause: f.control.lastTransactionError ?? error }); }
  assert.equal(result.replayed, false);
  f.clearObservations();
  return result;
}
function originalTransaction(f, table, { audit, order = false, committed = true } = {}) {
  const records = f.observed.transactions.filter(row => row.options?.isolationLevel === 'Serializable');
  assert.equal(records.length, 1, 'one original Serializable policy transaction');
  const record = records[0];
  assert.deepEqual(record.options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  const policyWrites = f.observed.writes.filter(row => row.table === table);
  assert.equal(policyWrites.length, 1);
  assert.strictEqual(policyWrites[0].tx, record.tx);
  const trace = f.trace.slice(record.start, record.end);
  const sequence = ['FROM Tenant WHERE', 'FROM auth_sessions', 'FROM platform_core_access_locks',
    ...(order ? ['FROM `rental_orders`', 'FROM business_workspaces'] : ['FROM ai_scopes', 'FROM ai_task_plan_policies'])];
  let last = -1;
  for (const part of sequence) {
    const index = trace.findIndex((entry, i) => i > last && entry.includes(part));
    assert(index > last, 'original Auth/Tenant/Core/resource/policy lock order: ' + part);
    last = index;
  }
  const writeIndex = trace.findIndex(entry => entry === table + '.create' || entry === table + '.update');
  assert(writeIndex > last, 'policy write follows original aggregate locks');
  last = writeIndex;
  assert(trace.slice(last).some(entry => entry.includes('FROM platform_core_access_locks')), 'Core revalidated after staged policy write');
  if (audit) {
    const logs = f.observed.writes.filter(row => row.table === 'operationLog');
    assert.equal(logs.length, 1); assert.strictEqual(logs[0].tx, record.tx);
    assert.equal(logs[0].args.data.action, audit);
    assert.deepEqual([logs[0].args.data.tenantId, logs[0].args.data.workspaceId, logs[0].args.data.userId],
      ['tenant-a', 'workspace-a', 'operator-a']);
  }
  assert.equal(committedPolicies(f), committed ? 1 : 0);
  return policyWrites[0];
}
async function originalPlan(f) {
  return f.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: 'scope-a', sceneCode: scene.code, sceneVersion: scene.version } });
}

async function main() {
  let checks = 0;
  const test = async (name, consume) => { await consume(); checks++; console.log('PASS ' + name); };
  await test('plan 真 Auth/Guard/Core → Scope/policy CAS 与审计同一原事务', async () => {
    const f = policyFixture(), command = change();
    const result = await runPlan(f, command);
    assert.equal(result.revision, 2); assert.equal(result.execution, 'not_attested'); assert.equal(result.taskActionPolicy, 'not_granted');
    const write = originalTransaction(f, 'aiTaskPlanPolicy', { audit: 'ai_task_plan_policy_changed' });
    assert.deepEqual(write.args.where, { scopeId: 'scope-a', sceneCode: scene.code, sceneVersion: '1', revision: 1 });
    assert.deepEqual((await originalPlan(f)).allowedTools, tools.map(code => ({ code, version: shared.AI_TOOL_DRAFT_VERSION })));
    assert.deepEqual(result.limits, command.limits);
    assert.equal(await f.db.operationLog.count({}), 1);
    f.clearObservations();
    const read = await f.invoke(request => plans(f).read(request, { sceneCode: scene.code }), { seed: false, operation: operation(planRoute, 'read') });
    assert.equal(read.state, 'configured'); assert.equal(read.revision, 2);
    assert.equal(f.observed.writes.length, 0);
    assert(!f.observed.transactions.some(row => row.options?.isolationLevel === 'Serializable'));
  });
  await test('plan stale revision 保持原 CAS 冲突且不新增审计', async () => {
    const f = policyFixture(); await runPlan(f); f.clearObservations();
    await assert.rejects(runPlan(f, change(1)), hasCode('AI_REVISION_CONFLICT'));
    assert.equal((await originalPlan(f)).revision, 2); assert.equal(await f.db.operationLog.count({}), 1);
    assert.equal(f.observed.writes.length, 0); assert.equal(committedPolicies(f), 0);
  });
  for (const mutation of ['core', 'current_role']) await test('plan staged audit 后 ' + mutation + ' 撤权回滚 policy+audit', async () => {
    const f = policyFixture(), before = await originalPlan(f);
    f.onPolicyWrite = async (table, _args, data) => {
      if (table !== 'operationLog') return;
      assert.equal(data.aiTaskPlanPolicy.find(row => row.sceneCode === scene.code).revision, 2);
      if (mutation === 'core') f.state.grant = 'disabled';
      else data.workspaceMember[0].role.permissions = [];
    };
    await assert.rejects(runPlan(f), hasCode('AI_ACCESS_DENIED'));
    assert.deepEqual(await originalPlan(f), before); assert.equal(await f.db.operationLog.count({}), 0);
    assert.equal(committedPolicies(f), 0);
    assert.equal(f.observed.writes.filter(row => row.table === 'aiTaskPlanPolicy').length, 1);
    assert.equal(f.observed.writes.filter(row => row.table === 'operationLog').length, 1);
  });
  await test('plan selected 缺参加者/真实 Auth 端口明确拒绝，legacy 原仓储仍可保存', async () => {
    const absent = policyFixture();
    await assert.rejects(absent.invoke(() => planRepository(absent).put(change()),
      { seed: false, operation: operation(planRoute, 'change') }), hasCode('AI_RESOURCE_UNAVAILABLE'));
    assert.equal(absent.observed.writes.length, 0);
    assert(!absent.trace.some(row => row.includes('FROM ai_scopes')));
    const missing = policyFixture();
    await assert.rejects(runPlan(missing, change(), { transactions: undefined }), hasCode('AI_RESOURCE_UNAVAILABLE'));
    assert.equal(missing.observed.writes.length, 0);
    const legacy = policyFixture();
    assert.equal((await planRepository(legacy).put(change())).revision, 2);
    assert.equal(await legacy.db.operationLog.count({}), 1);
    assert(!legacy.trace.some(row => row.includes('FROM Tenant') || row.includes('platform_core_access_locks')));
  });
  await test('plan 失 COMMIT 回复保持 unknown，撤权后只核原审计收据不重写', async () => {
    const f = policyFixture(), command = change();
    await f.invoke(async request => {
      f.control.loseReply = true;
      await assert.rejects(plans(f).change(request, { sceneCode: scene.code, change: command }), unknown);
      const writes = f.observed.writes.length, transactions = f.observed.transactions.length;
      f.state.grant = 'disabled';
      const { expectedRevision, ...savedInput } = command;
      const receipt = await planRepository(f).readMutation({ expectedRevision, inputHash: requestFingerprint(savedInput) });
      assert.equal(receipt.state, 'recorded'); assert.equal(receipt.policy.revision, 2); assert.equal(receipt.retryable, false);
      assert.equal(f.observed.writes.length, writes);
      assert.equal(f.observed.transactions.slice(transactions).filter(row => row.options?.isolationLevel === 'Serializable').length, 0);
    }, { seed: false, operation: operation(planRoute, 'change') });
    originalTransaction(f, 'aiTaskPlanPolicy', { audit: 'ai_task_plan_policy_changed' });
    assert.equal((await originalPlan(f)).revision, 2); assert.equal(await f.db.operationLog.count({}), 1);
  });
  await test('action 真原请求/Task 参加者 put 与 clear，Auth/Core→Order/Workspace→policy', async () => {
    const f = policyFixture(), task = await seedTask(f);
    const saved = await runAction(f, 'configure');
    assert.equal(saved.state, 'configured'); assert.equal(saved.policy.taskId, task.taskId); assert.equal(saved.policy.revision, 1);
    assert.equal(saved.semantics, 'action_policy_not_dispatch_or_business_approval');
    originalTransaction(f, 'aiTaskActionPolicy', { order: true });
    f.clearObservations();
    const cleared = await runAction(f, 'clear', { ...actionCommand, expectedRevision: 1 });
    assert.equal(cleared.state, 'revoked'); assert.equal(cleared.policy.revision, 2);
    assert(Date.parse(cleared.policy.expiresAt) <= Date.now());
    const write = originalTransaction(f, 'aiTaskActionPolicy', { order: true });
    assert.deepEqual(write.args.where, { scopeId: 'scope-a', taskId: task.taskId, operation: 'read_metadata', revision: 1 });
    f.clearObservations();
    const read = await runAction(f, 'read', { original: reference, operation: 'read_metadata' });
    assert.equal(read.state, 'observed'); assert.equal(read.policy.revision, 2);
    assert.equal(f.observed.writes.length, 0);
    assert(!f.observed.transactions.some(row => row.options?.isolationLevel === 'Serializable'));
  });
  await test('action selected 缺绑定/原 Orders 端口拒绝，不用 Task owner 代替 Core', async () => {
    const unbound = policyFixture(), task = await seedTask(unbound);
    await assert.rejects(unbound.invoke(() => composeTaskActionPolicyManagement(unbound.businessDependencies).put({
      taskId: task.taskId, operation: 'read_metadata', requiredPermissions: ['rental-os:order:view'], expiresAt: new Date(Date.now() + 60000)
    }, null), { operation: operation(actionRoute, 'configure') }), hasCode('AI_ACCESS_DENIED'));
    assert.equal(unbound.observed.writes.length, 0);
    const missing = policyFixture(); await seedTask(missing);
    await assert.rejects(runAction(missing, 'configure', actionCommand, { transactions: { auth: missing.auth } }), hasCode('AI_RESOURCE_UNAVAILABLE'));
    assert.equal(missing.observed.writes.length, 0); assert.equal(await missing.db.aiTaskActionPolicy.count({}), 0);
  });
  await test('action recorded 配置失 COMMIT 回复后只读原同事务审计，不重发 put', async () => {
    const f = policyFixture(), task = await seedTask(f);
    await f.invoke(async request => {
      f.control.loseReply = true;
      await assert.rejects(actions(f).configureReadingRecorded(request, { ...actionCommand,
        expiresAt: new Date(Date.now() + 60000).toISOString() }), unknown);
      const writes = f.observed.writes.length, transactions = f.observed.transactions.length;
      const result = await actions(f).readReadingRecorded(request, actionCommand);
      assert.equal(result.receipt.state, 'recorded'); assert.equal(result.receipt.policy.taskId, task.taskId);
      assert.equal(result.receipt.policy.revision, 1); assert.equal(result.receipt.retryable, false);
      assert.equal(f.observed.writes.length, writes);
      assert.equal(f.observed.transactions.slice(transactions).filter(row => row.options?.isolationLevel === 'Serializable').length, 0);
    }, { operation: operation(actionRoute, 'configure') });
    originalTransaction(f, 'aiTaskActionPolicy', { order: true, audit: 'ai_native_task_policy_saved' });
    assert.equal(await f.db.aiTaskActionPolicy.count({}), 1); assert.equal(await f.db.operationLog.count({}), 1);
  });
  await test('action 原最终复核撤权回滚 policy+audit，保留原 unknown/禁止重试语义', async () => {
    const f = policyFixture(); await seedTask(f);
    f.onPolicyWrite = async (table, _args, data) => {
      if (table === 'operationLog') { assert.equal(data.aiTaskActionPolicy.length, 1); f.state.grant = 'disabled'; }
    };
    await assert.rejects(runAction(f, 'configureReadingRecorded', { ...actionCommand,
      expiresAt: new Date(Date.now() + 60000).toISOString() }), unknown);
    originalTransaction(f, 'aiTaskActionPolicy', { order: true, audit: 'ai_native_task_policy_saved', committed: false });
    assert.equal(await f.db.aiTaskActionPolicy.count({}), 0); assert.equal(await f.db.operationLog.count({}), 0);
    assert(f.control.lastTransactionError instanceof CoreAccessError);
    assert.equal(f.control.lastTransactionError.code, 'denied');
  });
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ checks, real: ['RentalAuth', 'Guard', 'CoreAccess', 'OriginalSceneTransactions', 'PlanPolicyRepository', 'ActionPolicyRepository'],
    storage: 'original in-memory rollback/lost-reply fixture', modelCalls: 0, diskOutputs: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
