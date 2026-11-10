'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
if (process.env.DATABASE_URL !== 'mysql://offline:offline@127.0.0.1:1/rental_os_offline' || !process.env.AI_OFFLINE_WRITE_ROOT) {
  throw Error('Run only with the existing offline guard and lane-b-local-runtime preloads');
}
require('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: false,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { randomUUID } = require('node:crypto');
const { HumanAutomationRequestFactory } = require('../apps/api/src/modules/ai-native/automation/human-automation-request.composition');
const { HumanAutomationRequestModule } = require('../apps/api/src/modules/ai-native/automation/human-automation-request.module');
const { OperatorAutomationController, StaffAutomationController } = require('../apps/api/src/modules/ai-native/automation/human-automation-request.controller');
const { BusinessFailureEventsModule } = require('../apps/api/src/modules/ai-native/business-events/business-failure.composition');
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { getRequestIdentity, runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const { AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/ai-native');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');

// Synthetic persistence only; production authorization, consumers and task/review
// repositories are exercised unchanged. No provider or business write ports exist.
function fixture(audience = 'operator', mode = 'shadow') {
  const now = new Date(), scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const actor = user(), eventId = randomUUID(), expiry = new Date(now.getTime() + 3600000);
  const state = Object.fromEntries(['events', 'inspections', 'subjects', 'policies', 'inputs', 'scopes', 'budgets', 'plans', 'tasks', 'runs', 'grants', 'operations'].map(key => [key, new Map()]));
  state.tenantStatus = 'ACTIVE';
  let active = true, writes = 0, taskCreates = 0, loseTaskReply = false, loseReviewReply = false, afterEventRead;
  const match = (row, where) => !!row && Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => match(row, part));
    if (key === 'event') return match(state.events.get(row.eventId), value.is ?? value);
    if (key === 'scope') return match(state.scopes.get(row.scopeId), value.is);
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, v]) =>
      op === 'in' ? v.includes(row[key]) : op === 'gt' ? row[key] > v : op === 'lt' ? row[key] < v : op === 'lte' ? row[key] <= v : false);
    return value === undefined || (value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value);
  });
  const project = (row, select) => row ? structuredClone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row) : null;
  const delegate = name => {
    const api = {
      async findFirst({ where, select }) {
        let row = [...state[name].values()].find(row => match(row, where));
        if (row && name === 'tasks') row = { ...row, runs: [...state.runs.values()].filter(run => run.taskId === row.id && run.sequence === 1)
          .slice(0, select?.runs?.take ?? 1).map(run => project(run, select?.runs?.select)) };
        const result = project(row, select);
        if (name === 'events' && afterEventRead && --afterEventRead.remaining === 0) {
          const hook = afterEventRead.run; afterEventRead = undefined; hook();
        }
        return result;
      },
      async findUnique({ where, select }) { return api.findFirst({ where: where.scopeId_scopeKind_sceneCode ?? where, select }); },
      async findMany({ where, take, select }) {
        assert.ok(take <= 11);
        return [...state[name].values()].filter(row => match(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => project(row, select));
      },
      async create({ data }) {
        writes++; if (name === 'tasks') taskCreates++;
        const row = { revision: 1, archivedAt: null, createdAt: now,
          ...(name === 'inputs' ? { reviewRevision: 1, reviewStatus: 'open', closeReason: null, feedbackCode: null, reviewedAt: null } : {}),
          ...structuredClone(name === 'runs' ? { ...data, fencingToken: data.fencingToken.toString() } : data) };
        state[name].set(row.id, row); return structuredClone(row);
      },
      async updateMany({ where, data }) {
        writes++; let count = 0;
        for (const row of state[name].values()) if (match(row, where)) {
          for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : structuredClone(value);
          count++;
        }
        return { count };
      },
      async upsert({ where, create, select }) { return await api.findFirst({ where, select }) ?? api.create({ data: create }); }
    };
    return api;
  };
  const db = { aiBusinessFailureOutbox: delegate('events'), rentalInspectionRecord: delegate('inspections'),
    rentalNotificationLog: { findFirst: async () => null }, rentalPaymentRefund: { findFirst: async () => null },
    aiAutomationSubject: delegate('subjects'), aiAutomationPolicy: delegate('policies'), aiAutomationInput: delegate('inputs'),
    aiScope: delegate('scopes'), aiBudgetPolicy: delegate('budgets'), aiTaskPlanPolicy: delegate('plans'), aiTask: delegate('tasks'), aiRun: delegate('runs'),
    aiAutomationReviewGrant: delegate('grants'), aiAutomationReviewOperation: delegate('operations'),
    rentalOrder: { findFirst: async () => ({ id: 'order-a', ...scope, fulfillmentLocationId: 'location-a', returnLocationId: null }) },
    businessWorkspace: { findFirst: async () => ({ id: scope.workspaceId, tenantId: scope.tenantId, status: 'ACTIVE',
      tenant: { id: scope.tenantId, status: state.tenantStatus } }) },
    tenant: { findUnique: async () => ({ subscription: { startAt: new Date(now.getTime() - 1000), endAt: expiry }, subscriptionSegments: [] }) },
    $queryRaw: async () => [],
    $transaction: async work => {
      const before = structuredClone(state); let result;
      try { result = await work(db); } catch (error) { Object.assign(state, before); throw error; }
      if (loseTaskReply && state.tasks.size > before.tasks.size) { loseTaskReply = false; throw Error('lost task commit reply'); }
      if (loseReviewReply && state.operations.size > before.operations.size) { loseReviewReply = false; throw Error('lost review commit reply'); }
      return result;
    } };
  const auth = new AuthService({ getAuthSession: async () => active ? { id: 'session-a', userId: actor.id, audience, currentWorkspaceId: scope.workspaceId } : undefined,
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] },
  { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-secret' : undefined });
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const core = { getOrder: async (tenantId, id) => {
    assert.equal(tenantId, scope.tenantId); assert.equal(id, 'order-a');
    const identity = getRequestIdentity();
    assert.equal(identity.userId, actor.id); assert.equal(identity.workspaceId, scope.workspaceId); assert.equal(identity.staffApi, audience === 'staff');
    return { id, ...scope };
  } };
  const request = { headers: { authorization: `Bearer ${auth.signAccessToken({ sub: actor.id, tid: scope.tenantId, sid: 'session-a',
    wid: scope.workspaceId, aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}` } };
  const subscriptions = { readCategoryCommercialContext: async () => ({ revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
    entitlements: [{ code: 'ai.native.use', available: true, categories: [] }] }) };
  const dependencies = { db, auth, guard, core, clock: () => now, automation: { policyId: 'policy-a', subscriptions } };
  const factory = new HumanAutomationRequestFactory(dependencies);
  const controller = audience === 'staff' ? new StaffAutomationController(factory) : new OperatorAutomationController(factory);
  const call = (action, input) => controller[action](request, input);
  state.inspections.set('inspection-a', { id: 'inspection-a', ...scope, orderId: 'order-a', stage: 'return', revision: 1,
    exceptions: [{ id: 'exception-a', reviewStatus: 'pending' }] });
  state.events.set(eventId, { id: eventId, ...scope, eventType: 'inspection.return_exception', inspectionId: 'inspection-a', exceptionId: 'exception-a',
    notificationId: null, refundId: null, orderId: 'order-a', resourceRevision: 1, failureCode: 'review_pending', deduplicationKey: 'a'.repeat(64),
    traceId: 'trace-a', causationId: 'cause-a', occurredAt: now, expiresAt: expiry, status: 'pending', fence: 0, attempts: 0, nextAttemptAt: now, leaseOwner: null, leaseUntil: null });
  state.subjects.set('subject-a', { id: 'subject-a', ...scope, enabled: true, authorizationRevision: 1, permissions: ['rental-os:order:view'],
    locationScope: { mode: 'all', locationIds: [] }, revokedAt: null, expiresAt: expiry });
  state.policies.set('policy-a', { id: 'policy-a', ...scope, subjectId: 'subject-a', revision: 1, mode, sceneCode: 'failure.review', sceneVersion: '1',
    allowedEventTypes: ['inspection.return_exception'], maxTasksPerDay: 2, cooldownSeconds: 1, validFrom: new Date(now.getTime() - 1000),
    expiresAt: expiry, revokedAt: null, preparedCount: 0, counterDay: null, lastPreparedAt: null });
  for (const selected of [{ kind: 'platform' }, { kind: 'tenant', tenantId: scope.tenantId }, { kind: 'workspace', ...scope }]) {
    const columns = aiPersistenceScopeColumns(selected), scopeId = `scope-${selected.kind}`;
    state.scopes.set(scopeId, { id: scopeId, ...columns });
    state.budgets.set(scopeId, { id: `budget-${selected.kind}`, scopeId, scopeKind: columns.kind, sceneCode: 'failure.review', enabled: true, configRevision: 1,
      settingsJson: { draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 }, scope: selected.kind === 'platform' ? selected : { kind: 'tenant', tenantId: scope.tenantId },
        sceneCode: 'failure.review', allowedScenes: ['failure.review'], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
        gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
        budget: { state: 'limited', quantity: { unit: 'calls', value: 5 } } } });
  }
  state.plans.set('plan-a', { id: 'plan-a', scopeId: 'scope-workspace', sceneCode: 'failure.review', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.catalog.search', version: AI_TOOL_DRAFT_VERSION }], expiresAt: expiry,
    limits: { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 1000, maxStepMs: 1000, maxOutputBytes: 4096 } });
  return { state, scope, actor, db, request, dependencies, controller, call, eventId,
    stats: () => ({ writes, taskCreates }), revoke: () => { active = false; }, loseTask: () => { loseTaskReply = true; }, loseReview: () => { loseReviewReply = true; },
    onEventRead: (run, remaining = 1) => { afterEventRead = { run, remaining }; }, grant: (view, action) => {
      const id = randomUUID(); state.grants.set(id, { id, ...scope, scopeId: 'scope-workspace', inputId: view.inputRef, eventId,
        actorKind: 'user', actorId: actor.id, audience, action, expectedRevision: view.review.revision, resourceHash: view.resourceHash,
        requiredPermissions: ['rental-os:order:view'], enabled: true, revision: 1, expiresAt: expiry });
    } };
}
const code = expected => error => error.getResponse?.().code === expected;

test('current automation source rejects a frozen or disabled tenant even while its workspace, subject and policy stay enabled', async () => {
  const { PrismaAutomationAuthority } = require('../apps/api/src/modules/ai-native/automation/prisma-automation.authority');
  const f = fixture();
  const source = new PrismaAutomationAuthority(f.db, 'policy-a', { check: async () => assert.fail('inspect does not grant a budget') }, f.dependencies.clock);
  const initial = await source.inspect(f.eventId);
  assert.equal(initial.context.actor.kind, 'automation');
  assert.equal(initial.context.scope.workspaceId, f.scope.workspaceId);
  f.state.tenantStatus = 'FROZEN';
  await assert.rejects(source.inspect(f.eventId), error => error.code === 'unavailable');
  f.state.tenantStatus = 'DISABLED';
  await assert.rejects(source.inspect(f.eventId), error => error.code === 'unavailable');
  f.state.tenantStatus = 'ACTIVE';
  assert.equal((await source.inspect(f.eventId)).creationKey, initial.creationKey);
  assert.equal(f.state.subjects.get('subject-a').enabled, true);
  assert.equal(f.state.policies.get('policy-a').mode, 'shadow');
  assert.deepEqual(f.stats(), { writes: 0, taskCreates: 0 });
});

test('CCB12 default-off routes require original read ports and bind current Bearer, body and ALS independently', async () => {
  assert.deepEqual(HumanAutomationRequestModule.register().controllers, []);
  assert.deepEqual(BusinessFailureEventsModule.registerRequestHttp().imports[0].controllers, []);
  assert.throws(() => HumanAutomationRequestModule.register({ enabled: true }), /unavailable/);
  const f = fixture();
  assert.throws(() => HumanAutomationRequestModule.register({ enabled: true, dependencies: { ...f.dependencies, guard: undefined } }), /unavailable/);
  assert.throws(() => new HumanAutomationRequestFactory({ ...f.dependencies, credentials: {} }), /unavailable/);
  assert.equal(HumanAutomationRequestModule.register({ enabled: true, dependencies: f.dependencies }).controllers.length, 2);
  await assert.rejects(f.controller.readCandidate({ headers: { authorization: ['Bearer forged'] } }, { eventId: f.eventId }), code('AI_RESOURCE_UNAVAILABLE'));
  await assert.rejects(f.call('prepareInput', { eventId: f.eventId, subjectId: 'forged' }), code('AI_INVALID_INPUT'));
  const body = { eventId: f.eventId, limit: 1 }, request = structuredClone(f.request);
  const read = runWithRequestIdentity({ tenantId: 'foreign', userId: 'foreign', workspaceId: 'foreign' }, () => f.controller.forEvent(request, body));
  request.headers.authorization = 'Bearer changed'; body.eventId = randomUUID();
  assert.equal((await read).event.eventId, f.eventId); assert.equal(f.stats().writes, 0);
  const staff = fixture('staff');
  const [left, right] = await Promise.all([f.call('forEvent', { eventId: f.eventId, limit: 1 }), staff.call('forEvent', { eventId: staff.eventId, limit: 1 })]);
  assert.equal(left.event.eventId, f.eventId); assert.equal(right.event.eventId, staff.eventId);
  f.onEventRead(() => { f.actor.permissions = [...f.actor.permissions, 'system:params:manage']; });
  await assert.rejects(f.call('forEvent', { eventId: f.eventId, limit: 1 }), code('AI_RESOURCE_UNAVAILABLE'));
  assert.equal(f.stats().writes, 0);
});

test('CCB12 shadow/manual metadata tasks and explicit human outcomes recover only original receipts', async () => {
  for (const [audience, mode] of [['operator', 'shadow'], ['staff', 'manual_confirmation']]) {
    const f = fixture(audience, mode), selected = { eventId: f.eventId };
    const candidate = await f.call('prepareCandidate', selected); assert.equal(candidate.status, 'ready');
    f.state.policies.get('policy-a').mode = 'disabled';
    await assert.rejects(f.call('prepareInput', selected), code('AI_RESOURCE_UNAVAILABLE')); assert.equal(f.state.inputs.size, 0);
    f.state.policies.get('policy-a').mode = mode;
    const prepared = await f.call('prepareInput', selected), input = { inputRef: prepared.inputRef };
    assert.equal((await f.call('prepareInput', selected)).inputRef, input.inputRef); assert.equal(f.state.inputs.size, 1);
    assert.equal((await f.call('readInput', input)).mode, mode);
    assert.equal((await f.call('readCreation', input)).state, 'not_observed');
    f.loseTask();
    const task = await f.call('createTask', input); assert.equal(task.state, 'observed'); assert.equal(task.dispatchRequested, false);
    const writes = f.stats().writes;
    assert.equal((await f.call('readCreation', input)).task.taskId, task.task.taskId);
    assert.equal((await f.call('createTask', input)).task.taskId, task.task.taskId);
    assert.equal(f.stats().taskCreates, 1); assert.equal(f.stats().writes, writes);
    const view = await f.call('read', input); assert.equal(view.inputMode, mode); assert.equal(view.executionPermission, false);
    const close = { ...input, operationKey: 'human-close', expectedRevision: view.review.revision, expectedEventFence: view.event.fence,
      expectedTaskId: view.task.taskId, reason: 'resolved' };
    await assert.rejects(f.call('close', close), code('AI_RESOURCE_UNAVAILABLE')); assert.equal(f.state.operations.size, 0);
    const originalFacts = structuredClone({ inspections: f.state.inspections, tasks: f.state.tasks, runs: f.state.runs });
    f.grant(view, 'close'); f.loseReview();
    assert.equal((await f.call('close', close)).state, 'unknown');
    f.state.grants.clear(); f.state.policies.get('policy-a').mode = 'disabled';
    const afterCloseWrites = f.stats().writes;
    const receipt = await f.call('operation', { ...input, operationKey: close.operationKey });
    assert.equal(receipt.state, 'observed'); assert.equal(receipt.status, 'closed'); assert.equal(receipt.businessActionRequested, false);
    assert.equal((await f.call('close', close)).operationId, receipt.operationId); assert.equal(f.stats().writes, afterCloseWrites);
    const closed = await f.call('read', input), feedback = { ...input, operationKey: 'human-feedback', expectedRevision: closed.review.revision,
      expectedEventFence: closed.event.fence, expectedTaskId: closed.task.taskId, code: 'helpful' };
    f.grant(closed, 'feedback');
    assert.equal((await f.call('feedback', feedback)).status, 'closed');
    assert.equal((await f.call('forEvent', { ...selected, limit: 1 })).inputs.items[0].review.status, 'closed');
    assert.equal((await f.call('prepareCandidate', selected)).material, null);
    await assert.rejects(f.call('createTask', input), code('AI_RESOURCE_UNAVAILABLE'));
    assert.deepEqual({ inspections: f.state.inspections, tasks: f.state.tasks, runs: f.state.runs }, originalFacts);
    const source = f.state.inspections.get('inspection-a');
    source.revision++; source.exceptions[0].reviewStatus = 'approved';
    assert.deepEqual(await f.call('operation', { ...input, operationKey: close.operationKey }), receipt);
    f.onEventRead(() => { f.state.tasks.get(task.task.taskId).revision++; }, 3);
    await assert.rejects(f.call('read', input), code('AI_REVISION_CONFLICT'));
    f.revoke(); await assert.rejects(f.call('operation', { ...input, operationKey: close.operationKey }), code('AI_RESOURCE_UNAVAILABLE'));
  }
});

test('CCB14 bounded review discovery binds cursor identity/filters and fails the whole read on final revocation', async () => {
  const f = fixture(), prepare = async eventId => {
    await f.call('prepareCandidate', { eventId });
    return f.call('prepareInput', { eventId });
  };
  const first = await prepare(f.eventId), secondEventId = randomUUID();
  const inspection = structuredClone(f.state.inspections.get('inspection-a'));
  f.state.inspections.set('inspection-b', { ...inspection, id: 'inspection-b', exceptions: [{ id: 'exception-b', reviewStatus: 'pending' }] });
  const event = structuredClone(f.state.events.get(f.eventId));
  f.state.events.set(secondEventId, { ...event, id: secondEventId, inspectionId: 'inspection-b', exceptionId: 'exception-b',
    causationId: 'cause-b', deduplicationKey: 'b'.repeat(64), status: 'pending', fence: 0, attempts: 0 });
  f.state.policies.get('policy-a').lastPreparedAt = new Date(event.occurredAt.getTime() - 2000);
  const second = await prepare(secondEventId), ids = [first.inputRef, second.inputRef].sort();
  const foreignId = randomUUID();
  f.state.inputs.set(foreignId, { ...structuredClone(f.state.inputs.get(first.inputRef)), id: foreignId, tenantId: 'foreign', workspaceId: 'foreign' });
  const queries = [], originalQuery = f.db.aiAutomationInput.findMany;
  f.db.aiAutomationInput.findMany = async input => { queries.push(structuredClone(input)); return originalQuery(input); };
  const writes = f.stats().writes;
  const page = await f.call('readQueue', { limit: 1 });
  assert.equal(page.items[0].inputRef, ids[0]); assert.equal(page.coverage, 'bounded_authorized_window');
  assert.equal(page.readOnly, true); assert.equal(page.executionPermission, false); assert.equal(page.workerStarted, false);
  assert.equal('total' in page, false); assert.equal('hasMore' in page, false);
  assert.equal(page.continuation, 'position_only_not_more_results'); assert.ok(page.nextAfter);
  assert.ok(!JSON.stringify(page).includes('subject-a')); assert.ok(!JSON.stringify(page).includes('policy-a'));
  const next = await f.call('readQueue', { limit: 1, after: page.nextAfter });
  assert.equal(next.items[0].inputRef, ids[1]);
  const end = await f.call('readQueue', { limit: 1, after: next.nextAfter });
  assert.deepEqual(end.items, []); assert.equal(end.nextAfter, null);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.equal(query.where.tenantId, f.scope.tenantId); assert.equal(query.where.workspaceId, f.scope.workspaceId);
    assert.equal(query.where.reviewStatus, 'open'); assert.equal(query.take, 1); assert.deepEqual(query.orderBy, { id: 'asc' });
    assert.deepEqual(query.select, { id: true });
  }
  await assert.rejects(f.call('readQueue', { limit: 2, after: page.nextAfter }), code('AI_INVALID_INPUT'));
  await assert.rejects(f.call('readQueue', { limit: 1, after: page.nextAfter, filters: { reviewStatus: 'closed' } }), code('AI_INVALID_INPUT'));
  await assert.rejects(f.call('readQueue', { limit: 11 }), code('AI_INVALID_INPUT'));
  await assert.rejects(f.call('readQueue', { limit: 1, scope: f.scope }), code('AI_INVALID_INPUT'));
  f.actor.organizationId = 'changed-organization';
  await assert.rejects(f.call('readQueue', { limit: 1, after: page.nextAfter }), code('AI_INVALID_INPUT'));
  delete f.actor.organizationId;
  const staff = fixture('staff');
  await assert.rejects(staff.call('readQueue', { limit: 1, after: page.nextAfter }), code('AI_INVALID_INPUT'));
  await assert.rejects(f.call('readQueue', { limit: 1, after: 'not-a-cursor' }), code('AI_INVALID_INPUT'));
  const permissions = f.actor.permissions;
  f.actor.permissions = [];
  await assert.rejects(f.call('readQueue', { limit: 1, after: page.nextAfter }), code('AI_INVALID_INPUT'));
  await assert.rejects(f.call('readQueue', { limit: 2 }), code('AI_RESOURCE_UNAVAILABLE'));
  f.actor.permissions = permissions;
  const resolved = f.state.inspections.get('inspection-a'); resolved.revision++; resolved.exceptions[0].reviewStatus = 'approved';
  const current = await f.call('readQueue', { limit: 2 });
  const inactive = current.items.find(item => item.inputRef === first.inputRef);
  assert.equal(inactive.suggestionActive, false); assert.equal(inactive.nextAction, 'read_original_resource');
  assert.equal(f.state.events.get(f.eventId).status, 'ready', 'queue does not expire or close events');
  for (const resolve of [false, true]) {
    f.onEventRead(() => {
      const source = f.state.inspections.get('inspection-b'); source.revision++;
      if (resolve) source.exceptions[0].reviewStatus = 'approved';
    }, 3);
    await assert.rejects(f.call('read', { inputRef: second.inputRef }), code('AI_REVISION_CONFLICT'));
    const latest = await f.call('read', { inputRef: second.inputRef });
    assert.equal(latest.nextAction, 'read_original_resource'); assert.equal(latest.currentSource.failed, !resolve);
  }
  f.db.aiAutomationInput.findMany = async () => { throw Error('private storage failure'); };
  await assert.rejects(f.call('readQueue', { limit: 2 }), error => error.getResponse?.().code === 'AI_RESOURCE_UNAVAILABLE'
    && !JSON.stringify(error.getResponse()).includes('private storage failure'));
  f.db.aiAutomationInput.findMany = originalQuery;
  f.onEventRead(f.revoke, 7); // Two initial reader passes, then the first final reader loses access.
  await assert.rejects(f.call('readQueue', { limit: 2 }), code('AI_RESOURCE_UNAVAILABLE'));
  assert.equal(f.stats().writes, writes);
});
