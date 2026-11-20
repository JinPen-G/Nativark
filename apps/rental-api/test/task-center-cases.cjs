'use strict';
/** Actual TaskCenter/Recovery providers and original cancellation/log transactions.
 * The parent owns the selected Client and offline lifecycle. Only stored rows
 * and source evidence are synthetic; signed Auth, Guard, Core access, principal
 * leases, order visibility, task provenance, CAS and unknown handling are real. */
module.exports = async function taskCenterCases({ t, knowledgeFixture }) {
  const assert = require('node:assert/strict');
  const shared = require('@rental-os/shared');
  const { prismaRuntime } = require('@rental-os/platform-server/prisma-runtime');
  const { runWithRequestIdentity, getRequestIdentity } = require('@rental-os/platform-server/request-identity');
  const { requestFingerprint: hash } = require('@rental-os/platform-contracts/request-fingerprint');
  const { aiPersistenceScopeColumns } = require('@rental-os/ai-native-server/runtime/persistence-scope');
  const { originalIdentityHash } = require('@rental-os/ai-native-server/runtime/task-request/original-request.authority');
  const { composePersistedTaskAuthorization } = require('@rental-os/ai-native-server/runtime/task-authorization.composition');
  const { withTaskCenterTransactions } = require('@rental-os/ai-native-server/runtime/task-center-transactions');
  const { recordTaskVisibleObservation } = require('@rental-os/ai-native-server/runtime/observability/task-visible-observation.service');
  const providers = require('@rental-os/ai-native-server/runtime/ai-native-application.providers');
  const { AiTaskCenterController } = require('@rental-os/ai-native-server/runtime/task-center.application');
  const { AiOriginalSceneRecoveryController } = require('@rental-os/ai-native-server/runtime/scenes/original-scenes.controller');
  const ids = { input: '33333333-3333-4333-8333-333333333333', task: '11111111-1111-4111-8111-111111111111',
    run: '22222222-2222-4222-8222-222222222222' };
  const reference = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: ids.input };
  const cancel = { original: reference, expectedRevision: 1 };
  const failure = error => ['AI_ACCESS_DENIED', 'AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT'].includes(error.code)
    || [401, 403, 409, 503].includes(error.getStatus?.());
  const report = { version: 'client-visible-1', observationId: '44444444-4444-4444-8444-444444444444',
    documentId: '55555555-5555-4555-8555-555555555555', taskId: ids.task, runId: ids.run, surface: 'task_center',
    kind: 'text', source: { kind: 'model_result', resultId: 'result-a' }, trigger: 'original_model_start', originKey: ids.input,
    clientEpoch: 1, elapsedMs: 20, viewport: 'wide_viewport', sampleSize: 1,
    basis: 'viewport_intersection_after_two_frames', provenance: 'client_reported_not_business_fact' };

  function fixture() {
    const h = knowledgeFixture(), { state, db, rental } = h, now = new Date();
    Object.assign(state, { taskTrace: [], taskWrites: 0, taskCommits: 0, taskPhase: undefined, lostCommit: false });
    const scope = { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
    const original = { id: ids.input, scopeId: scope.id, ownerKind: 'USER', ownerId: state.user.id, audience: 'OPERATOR',
      contractVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, sceneCode: 'order_explanation', sceneVersion: '1',
      requestKey: 'original-a', revision: 1, previousRequestId: null, payload: { orderId: 'order-a', question: 'status' },
      status: 'STORED', erasedAt: null, expiresAt: new Date(now.getTime() + 600000), createdAt: now };
    original.contentHash = hash({ version: original.contractVersion, scopeId: scope.id, audience: original.audience,
      ownerKind: original.ownerKind, ownerId: original.ownerId, sceneCode: original.sceneCode, sceneVersion: original.sceneVersion,
      revision: 1, previousInputRef: null, input: original.payload });
    original.authorizationBindingHash = originalIdentityHash({ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION,
      requestId: 'fixture', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: state.user.id },
      scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      access: { permissions: structuredClone(state.user.permissions), dataScope: state.user.dataScope,
        locationScope: structuredClone(state.user.locationScope) } });
    const run = { id: ids.run, scopeId: scope.id, taskId: ids.task, actorKind: 'USER', actorId: state.user.id,
      sequence: 1, status: 'QUEUED', revision: 1, leaseOwnerId: null, leaseExpiresAt: null, executionPlan: null };
    state.taskRows = { task: { id: ids.task, scopeId: scope.id, scopeKind: 'WORKSPACE', ownerKind: 'USER', ownerId: state.user.id,
      audience: 'OPERATOR', archivedAt: null, contractVersion: shared.AI_TASK_DRAFT_VERSION, sceneCode: original.sceneCode,
      sceneVersion: original.sceneVersion, creationKey: 'scene-request:' + ids.input, inputRef: ids.input,
      inputRevision: 1, inputHash: original.contentHash, status: 'QUEUED', revision: 1, eventCursor: 0n,
      cancelRequestedAt: null, resultRef: null, createdAt: now, updatedAt: now, runs: [run] }, events: [], logs: [] };
    let pending;
    const rows = () => pending ?? state.taskRows;
    const phase = async name => { state.taskTrace.push(name); await state.taskPhase?.(name); };
    const matches = (row, where) => Boolean(row) && Object.entries(where ?? {}).every(([key, value]) => {
      if (key === 'scope') return matches(scope, value.is);
      if (key === 'AND') return value.every(part => matches(row, part));
      if (key === 'OR') return value.some(part => matches(row, part));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return value.in.includes(row[key]);
        if ('gt' in value) return row[key] > value.gt;
        if ('gte' in value) return row[key] >= value.gte;
      }
      return row[key] === value;
    });
    const find = row => async ({ where }) => matches(row(), where) ? structuredClone(row()) : null;
    db.aiScope.findFirst = find(() => scope);
    db.aiTaskOriginalRequest.findFirst = find(() => original);
    db.aiTask.findFirst = find(() => rows().task);
    db.aiTask.updateMany = async ({ where, data }) => {
      assert.equal(state.depth, 1); if (!matches(rows().task, where)) return { count: 0 };
      await phase('task-cas'); state.taskWrites++;
      for (const [key, value] of Object.entries(data)) rows().task[key] = value && typeof value === 'object' && 'increment' in value
        ? rows().task[key] + value.increment : value;
      return { count: 1 };
    };
    db.aiTaskEvent.findFirst = async ({ where }) => structuredClone(rows().events.find(row => matches(row, where)) ?? null);
    db.aiTaskEvent.findMany = async ({ where }) => structuredClone(rows().events.filter(row => matches(row, where)));
    db.aiTaskEvent.create = async ({ data }) => {
      assert.equal(state.depth, 1); await phase('task-event'); state.taskWrites++;
      rows().events.push(structuredClone(data)); return { cursor: data.cursor };
    };
    db.aiRun.findFirst = find(() => run);
    db.aiRun.findMany = async ({ where }) => matches(run, where) ? [structuredClone(run)] : [];
    db.aiStep.findFirst = async () => null;
    db.aiStep.findMany = async () => [];
    db.aiTaskActionInput.findFirst = db.rentalApprovedSettingsChange.findFirst = db.aiGatewayInvocation.findFirst = async () => null;
    db.aiTaskResultArtifact.findFirst = async () => null;
    const policies = ['read_metadata', 'read_events', 'transition_task', 'read_step_terminal'].map(operation => ({
      scopeId: scope.id, taskId: ids.task, operation, revision: 1, requiredPermissions: ['rental-os:order:view'], expiresAt: original.expiresAt }));
    db.aiTaskActionPolicy.findUnique = async ({ where }) => structuredClone(policies.find(row => matches(row, where.scopeId_taskId_operation)) ?? null);
    db.operationLog.findUnique = async ({ where }) => structuredClone(rows().logs.find(row => row.id === where.id) ?? null);
    db.operationLog.create = async ({ data }) => {
      assert.equal(state.depth, 1); await phase('visible-log'); state.taskWrites++;
      rows().logs.push(structuredClone(data)); return structuredClone(data);
    };
    // Supply real repository rows, retaining the original visibility/projection.
    const order = { id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', orderNo: 'ORDER-A',
      categoryCode: 'CAMPING', status: 'RENTING', customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic',
      fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-a', fulfillmentLocationName: 'Synthetic',
      createdBy: state.user.id, startAt: now, endAt: new Date(now.getTime() + 86400000), createdAt: now, updatedAt: now,
      currency: 'CNY', rentalAmount: 100, serviceAmount: 0, discountAmount: 0, couponAmount: 0, depositAmount: 0,
      preAuthAmount: 0, finalPayableAmount: 100, lines: [], reservations: [], allocations: [] };
    db.rentalOrder.findFirst = find(() => order);
    db.businessWorkspace.findFirst = async ({ where }) => state.workspace === where.id && where.tenantId === 'tenant-a'
      ? { id: state.workspace, tenantId: 'tenant-a', status: 'ACTIVE', categoryCode: 'CAMPING' } : null;
    db.authSession.findFirst = async ({ where }) => state.active && where.id === 'session-a' && where.userId === state.user.id
      ? { audience: 'operator', currentWorkspaceId: state.workspace } : null;
    db.workspaceMember.findFirst = async ({ where }) => state.active && where.workspaceId === state.workspace
      && where.userId === state.user.id ? { role: null, dataScope: null, locationScope: structuredClone(state.user.locationScope) } : null;
    db.$queryRaw = async value => {
      if (value.sql.includes('JSON_TYPE(o.ruleSnapshot)')) return [{ ruleType: null, rule: null,
        templatesType: null, templateCount: null, templates: null, calendarType: null, calendarCount: null, calendar: null }];
      throw Error('Unexpected root SQL: ' + value.sql);
    };
    const originalTransaction = db.$transaction;
    db.$transaction = async (consume, options) => {
      if (options.isolationLevel === 'ReadCommitted') return originalTransaction(consume, options);
      assert(['Serializable', 'RepeatableRead'].includes(options.isolationLevel));
      assert.equal(state.depth, 0, 'no outer transaction');
      state.depth = 1; pending = structuredClone(state.taskRows);
      const tx = { ...db }; delete tx.$transaction;
      tx.$queryRaw = async (value, ...values) => {
        if (Array.isArray(value)) value = prismaRuntime.sql(value, ...values);
        const sql = value.sql.replace(/\s+/gu, ' ').trim(); await phase(sql);
        if (sql.includes('FROM Tenant')) return [{ id: 'tenant-a', status: 'active' }];
        if (sql.includes('FROM `User`')) return [{ id: state.user.id, roleId: null }];
        if (sql.includes('FROM auth_sessions')) return state.active ? [{ id: 'session-a' }] : [];
        if (sql.includes('FROM workspace_members')) return state.active ? [{ roleId: null }] : [];
        if (sql.includes('FROM `UserRole`')) return [];
        if (sql.includes('FROM platform_core_access_locks')) return [{ tenantId: 'tenant-a', coreId: 'rental' }];
        if (sql.includes('FROM platform_tenant_core_grants')) return [{ state: state.grant, revision: 1n, operationId: 'grant-a' }];
        if (sql.includes('FROM platform_member_core_assignments')) return [{ state: state.assigned, revision: 1n, operationId: 'assignment-a' }];
        if (sql.includes('FROM platform_core_bindings')) return [{ bindingId: 'binding-a', revision: 1n,
          dataVersion: '0.1.0', containerType: 'rental-workspace', containerId: 'workspace-a' }];
        if (sql.includes('FROM `rental_orders`')) return value.values.includes(order.id) && value.values.includes(order.workspaceId)
          ? [{ id: order.id, workspaceId: order.workspaceId }] : [];
        if (sql.includes('FROM rental_allocations')) return [];
        if (sql.includes('FROM business_workspaces')) {
          assert(sql.includes("status = 'active'")); return state.workspace === 'workspace-a' ? [{ id: state.workspace }] : [];
        }
        throw Error('Unexpected task SQL: ' + sql);
      };
      try {
        const result = await consume(tx); state.taskRows = pending;
        if (options.isolationLevel === 'Serializable') {
          state.taskCommits++;
          if (state.lostCommit) { state.lostCommit = false; throw Error('synthetic COMMIT reply lost'); }
        }
        return result;
      } finally { pending = undefined; state.depth = 0; }
    };
    const recovery = providers.AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER.useFactory(db, rental.auth, h.guard, rental.subscriptions,
      rental.primary.core, rental.primary.business, rental.integrations.reports, rental.customers.memberships,
      rental.integrations.payments, rental.foundation.funding, rental.foundation.coreFacts, rental.foundation.businessFacts);
    const center = providers.AI_NATIVE_TASK_CENTER_PROVIDER.useFactory(db, rental.auth, recovery, h.guard, rental.subscriptions,
      rental.primary.core, rental.orderConfirmation, rental.foundation.businessFacts, undefined, undefined, undefined, undefined,
      undefined, undefined, h.config, rental.enterprise.delegations, rental.foundation.coreFacts);
    const controllers = { center: new AiTaskCenterController(center), recovery: new AiOriginalSceneRecoveryController(recovery) };
    const invoke = (family, action, command, inside) => runWithRequestIdentity({}, () => h.access.run(async () => {
      const contract = family === 'center' ? shared.AI_TASK_CENTER_HTTP_DRAFT : shared.AI_SCENE_MODEL_HTTP_DRAFT;
      const url = '/api/' + contract.basePath + '/' + contract[action];
      const req = { ...h.request(), url, originalUrl: url, body: command };
      assert.equal(await h.guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
      return h.access.withRequest(req, () => h.binding.withRequest(req,
        () => inside ? inside(req) : controllers[family][action](req, command)),
      ['stopReceipt', 'readCancellationReceipt'].includes(action) ? { bufferedRead: true } : undefined);
    }));
    const log = () => invoke('center', 'visibleReport', report, req => {
      const credentials = { current: async () => ({ authorization: req.headers.authorization, audience: 'operator', requestId: 'visible-a' }) };
      const tasks = composePersistedTaskAuthorization({ db, auth: rental.auth, credentials,
        subscriptions: rental.subscriptions }).tasks;
      return withTaskCenterTransactions({ auth: rental.auth, orders: rental.foundation.coreFacts }, db, credentials, ids.task,
        () => recordTaskVisibleObservation({ db, tasks, sourceBinding: async value => {
          assert.deepEqual(value.source, report.source); return hash({ input: original.contentHash, source: report.source });
        } }, report));
    });
    return { ...h, invoke, log, original, controllers };
  }

  function assertLocks(h, write) {
    const trace = h.state.taskTrace, at = token => trace.findIndex(row => row.includes(token));
    assert(at('FROM Tenant') >= 0); assert(at('FROM Tenant') < at('platform_core_access_locks'));
    assert(at('platform_core_access_locks') < at('rental_orders'));
    assert(at('rental_orders') < at('business_workspaces')); assert(at('business_workspaces') < at(write));
  }
  await t.test('原 TaskCenter provider 取消提交一次并沿原收据重放', async () => {
    const h = fixture(), command = { taskId: ids.task, expectedRevision: 1 };
    assert.equal((await h.invoke('center', 'stop', command)).status, 'observed');
    assert.equal(h.state.taskRows.task.status, 'CANCEL_REQUESTED'); assert.equal(h.state.taskRows.events.length, 1);
    assertLocks(h, 'task-cas'); const writes = h.state.taskWrites;
    assert.equal((await h.invoke('center', 'stop', command)).status, 'observed');
    assert.equal(h.state.taskWrites, writes); assert.equal(getRequestIdentity(), undefined);
  });
  await t.test('原 Recovery provider 取消在同事务验证身份/Core/原订单并保留已过期输入收尾', async () => {
    const h = fixture(); h.original.expiresAt = new Date(Date.now() - 1000);
    const result = await h.invoke('recovery', 'requestCancellationIntent', cancel);
    assert.equal(result.cancellation, 'requested_not_rollback'); assert.equal(h.state.taskRows.events.length, 1);
    assertLocks(h, 'task-cas');
    const receipt = await h.invoke('recovery', 'readCancellationReceipt', cancel);
    assert.equal(receipt.receipt.status, 'observed'); assert.equal(h.state.taskRows.events.length, 1);
  });
  await t.test('等待期间 grant/assignment/角色撤销阻止原 Recovery 写入，最终复验失败原子回滚', async () => {
    for (const [at, revoke] of [
      ['FROM Tenant', s => { s.grant = 'disabled'; }],
      ['FROM Tenant', s => { s.assigned = 'unassigned'; }],
      ['FROM Tenant', s => { s.user.permissions = []; }],
      ['task-event', s => { s.grant = 'disabled'; }],
    ]) {
      const h = fixture(); let fired = false;
      h.state.taskPhase = name => { if (!fired && name.includes(at)) { fired = true; revoke(h.state); } };
      await assert.rejects(() => h.invoke('recovery', 'requestCancellationIntent', cancel), failure);
      assert(fired); assert.equal(h.state.taskRows.task.status, 'QUEUED'); assert.equal(h.state.taskRows.events.length, 0);
    }
  });
  await t.test('原可见性日志加入自身 Serializable 事务，重放不重复写且撤销无日志提交', async () => {
    const h = fixture(); assert.equal((await h.log()).status, 'recorded'); assertLocks(h, 'visible-log');
    assert.equal(h.state.taskRows.logs.length, 1); const writes = h.state.taskWrites;
    assert.equal((await h.log()).status, 'recorded'); assert.equal(h.state.taskWrites, writes);
    for (const phase of ['FROM Tenant', 'visible-log']) {
      const revoked = fixture(); let fired = false;
      revoked.state.taskPhase = name => { if (!fired && name.includes(phase)) { fired = true; revoked.state.grant = 'disabled'; } };
      await assert.rejects(revoked.log, error => error.code === (phase === 'visible-log'
        ? 'AI_RESULT_UNKNOWN' : 'AI_STORAGE_UNAVAILABLE'));
      assert(fired); assert.equal(revoked.state.taskRows.logs.length, 0);
    }
  });
  await t.test('原取消/诊断 COMMIT 失应答保留 unknown，原收据不产生重发', async () => {
    const h = fixture(); h.state.lostCommit = true;
    await assert.rejects(() => h.invoke('recovery', 'requestCancellationIntent', cancel), error => error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
    assert.equal(h.state.taskRows.events.length, 1);
    await h.invoke('recovery', 'readCancellationReceipt', cancel); assert.equal(h.state.taskRows.events.length, 1);
    const log = fixture(); log.state.lostCommit = true;
    await assert.rejects(log.log, error => error.code === 'AI_RESULT_UNKNOWN');
    assert.equal(log.state.taskRows.logs.length, 1);
    assert.equal((await log.log()).status, 'recorded'); assert.equal(log.state.taskRows.logs.length, 1);
  });
  await t.test('已审定 audited POST 读取前后复核 Core，返回前撤权拒绝且 maintained POST 不开放', async () => {
    const read = (h, options, consume) => runWithRequestIdentity({}, () => h.access.run(async () => {
      const req = h.request();
      assert.equal(await h.guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
      return h.access.withRequest(req, consume, options);
    }));
    const countGrants = h => h.state.queries.filter(sql => sql.includes('FROM platform_tenant_core_grants')).length;
    const allowed = knowledgeFixture();
    const result = await read(allowed, { auditedRead: true }, async () => {
      assert.equal(countGrants(allowed), 1, 'current Core admission before handler');
      return { original: 'buffered evidence' };
    });
    assert.deepEqual(result, { original: 'buffered evidence' });
    assert.equal(countGrants(allowed), 2, 'current Core authorization before delivery');
    const revoked = knowledgeFixture(); let consumed = false;
    await assert.rejects(() => read(revoked, { auditedRead: true }, async () => {
      consumed = true; revoked.state.grant = 'disabled'; return { original: 'must remain withheld' };
    }), error => error.code === 'denied');
    assert(consumed); assert.equal(countGrants(revoked), 2);
    const maintained = knowledgeFixture(); let maintainedCalled = false;
    await assert.rejects(() => read(maintained, { maintainedRead: true }, async () => {
      maintainedCalled = true;
    }), error => error.code === 'denied');
    assert.equal(maintainedCalled, false); assert.equal(countGrants(maintained), 0);
    assert.equal(getRequestIdentity(), undefined);
  });
};
