'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
const { TenantModelConfigurationAuthority } = require('../apps/api/src/modules/ai-native/tenant-model-config.authority');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
function setup() {
  const state = { user: user(), active: true, workspace: 'workspace-a', credentialAudience: 'operator' };
  state.user.permissions.push('system:params:manage');
  const auth = new AuthService({
    getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => []
  }, { get: name => name === 'AUTH_TOKEN_SECRET' ? 'synthetic-token-signing-only' : undefined });
  const credentials = { current: async () => ({ authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId,
    sid: 'session-a', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 60 })}`, requestId: 'synthetic-request', audience: state.credentialAudience }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const invocation = new AiOrderRouteContextAuthority(guard, credentials, 'order-a');
  const authority = new TenantModelConfigurationAuthority(guard, credentials, invocation);
  return { state, authority, guard, credentials, auth, context: { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' } };
}
const forbidden = error => error.code === 'FORBIDDEN' && error.message === 'FORBIDDEN';
test('configuration authority reuses actual AuthService/Guard action permission and current session workspace', async () => {
  const h = setup();
  await h.authority.authorize(h.context, 'read');
  await h.authority.authorize(h.context, 'manage');
  await h.authority.authorize(h.context, 'invoke');
  h.state.workspace = 'workspace-b';
  await assert.rejects(h.authority.authorize(h.context, 'manage'), forbidden);
});
for (const change of [h => { h.state.active = false; }, h => { h.state.user.isActive = false; },
  h => { h.state.user.permissions = []; }, h => { h.state.credentialAudience = 'staff'; },
  h => { h.state.user.isSaasAdmin = true; }]) {
  test('current revocation or incompatible identity refuses configuration access after earlier success', async () => {
    const h = setup(); await h.authority.authorize(h.context, 'read'); change(h);
    await assert.rejects(h.authority.authorize(h.context, 'read'), forbidden);
  });
}
test('caller tenant workspace and actor cannot override the authenticated principal', async () => {
  const h = setup();
  for (const field of ['tenantId', 'workspaceId', 'actorId']) {
    await assert.rejects(h.authority.authorize({ ...h.context, [field]: 'forged' }, 'manage'), forbidden);
    await assert.rejects(h.authority.authorize({ ...h.context, [field]: 'forged' }, 'invoke'), forbidden);
  }
});
test('configuration-management permission does not replace invocation resource authorization', async () => {
  const h = setup();
  h.state.user.permissions = ['system:params:manage'];
  await h.authority.authorize(h.context, 'manage');
  await assert.rejects(h.authority.authorize(h.context, 'invoke'), forbidden);
});

test('customer task policy management uses original Guard, scoped CAS and atomic original audit recovery', async () => {
  const h = setup(), rows = [], logs = [], modelPlans = []; let loseReply = false, failAudit = false;
  const same = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const db = {
    aiClientTaskPolicy: {
      findUnique: async ({ where }) => structuredClone(rows.find(row => same(row, Object.values(where)[0])) ?? null),
      create: async ({ data }) => { rows.push(structuredClone(data)); return structuredClone(data); },
      updateMany: async ({ where, data }) => { const row = rows.find(row => same(row, where));
        if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; }
    },
    operationLog: {
      findFirst: async ({ where }) => structuredClone(logs.find(row => same(row, where)) ?? null),
      create: async ({ data }) => { if (failAudit) throw Error('synthetic audit storage failure');
        assert.equal(logs.some(row => row.id === data.id), false); logs.push(structuredClone(data)); return structuredClone(data); }
    },
    $transaction: async callback => {
      const beforeRows = structuredClone(rows), beforeLogs = structuredClone(logs), beforePlans = structuredClone(modelPlans); let result;
      try { result = await callback(db); }
      catch (error) { rows.splice(0, rows.length, ...beforeRows); logs.splice(0, logs.length, ...beforeLogs);
        modelPlans.splice(0, modelPlans.length, ...beforePlans); throw error; }
      if (loseReply) { loseReply = false; throw Error('synthetic COMMIT completed, reply lost'); }
      return result;
    }
  };
  const { createClientTaskPolicyManagementApplication } = require('../apps/api/src/modules/ai-native/scenes/client-task-policy-management.service');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const canonical = { id: 'workspace-policy-scope', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
  db.aiScope = { findFirst: async ({ where }) => same(canonical, where) ? structuredClone(canonical) : null };
  db.$queryRaw = async query => {
    assert.equal(query.values[0], canonical.id);
    if (query.strings.join('?').includes('FROM ai_scopes')) return [{ id: canonical.id }];
    assert.ok(query.strings.join('?').includes('FROM ai_task_plan_policies'));
    assert.equal(query.values[1], 'client-order-explanation'); assert.equal(query.values[2], '1');
    return modelPlans.map(row => ({ revision: row.revision }));
  };
  db.aiTaskPlanPolicy = {
    findFirst: async ({ where }) => structuredClone(modelPlans.find(row => same(row, where)) ?? null),
    create: async ({ data }) => { modelPlans.push(structuredClone(data)); return structuredClone(data); },
    updateMany: async ({ where, data }) => { const row = modelPlans.find(row => same(row, where));
      if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; }
  };
  const options = { db, guard: h.guard, scene: { sceneCode: 'client-order-explanation', sceneVersion: '1' } };
  const application = createClientTaskPolicyManagementApplication({ ...options, enabled: true });
  const service = Object.fromEntries(['read', 'change', 'operation'].map(method => [method,
    async value => application[method](await h.credentials.current(), value)]));
  const key = { channel: 'web', customerType: 'personal' };
  await assert.rejects(createClientTaskPolicyManagementApplication(options).read(await h.credentials.current(), key),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal((await service.read(key)).state, 'not_configured');
  const planApplication = createClientTaskPolicyManagementApplication({ ...options, enabled: true,
    modelPlan: { db, auth: h.auth } });
  assert.equal((await planApplication.readModelPlan(await h.credentials.current())).state, 'not_configured');
  const modelPlan = { expectedRevision: null, enabled: true,
    limits: { maxSteps: 2, maxCalls: 2, maxConcurrent: 1, maxTotalMs: 2000, maxStepMs: 1000, maxOutputBytes: 2048 },
    expiresAt: new Date(Date.now() + 60000).toISOString() };
  const plan = await planApplication.changeModelPlan(await h.credentials.current(), modelPlan);
  assert.equal(plan.revision, 1); assert.equal(plan.execution, 'not_attested');
  assert.equal(modelPlans[0].scopeId, canonical.id); assert.equal(modelPlans[0].sceneCode, options.scene.sceneCode);
  assert.deepEqual(modelPlans[0].allowedTools.map(tool => tool.code), [require('../apps/api/src/modules/ai-native/model-input/task-model-input').TASK_TEXT_MODEL_TOOL]);
  await assert.rejects(planApplication.changeModelPlan(await h.credentials.current(), modelPlan), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(planApplication.changeModelPlan(await h.credentials.current(), { ...modelPlan, tools: ['rental.order.commit'] }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(application.readModelPlan(await h.credentials.current()), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  loseReply = true;
  await assert.rejects(planApplication.changeModelPlan(await h.credentials.current(), { ...modelPlan, expectedRevision: 1, enabled: false }),
    e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false);
  assert.equal((await planApplication.readModelPlan(await h.credentials.current())).revision, 2);
  assert.equal(modelPlans[0].enabled, false);
  const input = { ...key, operationKey: 'enable-original', expectedRevision: 0, enabled: true,
    allowRead: true, allowCreate: true, allowExecute: true, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const created = await service.change(input);
  assert.equal(created.state, 'observed'); assert.equal(created.execution, 'not_attested');
  assert.equal(rows[0].allowExecute, true); assert.equal(rows[0].tenantId, 'tenant-a'); assert.equal(rows[0].workspaceId, 'workspace-a');
  assert.equal(rows[0].allowRequestInput, false); assert.equal(rows[0].allowSubmitInput, false); assert.equal(rows[0].allowResumeInput, false);
  assert.equal(rows[0].allowCancel, false);
  assert.equal(logs[0].userId, 'operator-a'); assert.equal(logs[0].detail.result.id, rows[0].id);
  assert.equal((await service.change(input)).result.revision, 1); assert.equal(logs.length, 1);
  await assert.rejects(service.change({ ...input, allowExecute: false }), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(service.change({ ...input, operationKey: 'stale-change' }), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(service.change({ ...input, tenantId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
  loseReply = true;
  const disable = { ...input, operationKey: 'disable-original', expectedRevision: 1, allowExecute: false };
  assert.equal((await service.change(disable)).state, 'unknown');
  assert.equal(rows[0].revision, 2); assert.equal((await service.operation({ ...key, operationKey: disable.operationKey })).result.allowExecute, false);
  assert.equal(logs.length, 2);
  failAudit = true;
  assert.equal((await service.change({ ...input, operationKey: 'atomic-failure', expectedRevision: 2 })).state, 'unknown');
  assert.equal(rows[0].revision, 2); assert.equal(logs.length, 2);
  assert.equal((await service.operation({ ...key, operationKey: 'atomic-failure' })).state, 'not_observed');
  failAudit = false;
  const inputPolicy = { ...input, operationKey: 'input-actions-only', expectedRevision: 2, allowExecute: false,
    allowRequestInput: true, allowSubmitInput: true, allowResumeInput: true };
  const configuredInputs = await service.change(inputPolicy);
  assert.equal(configuredInputs.result.allowExecute, false); assert.equal(configuredInputs.result.allowSubmitInput, true);
  assert.equal(rows[0].allowResumeInput, true); assert.equal(logs.length, 3);
  // Legacy payloads retain their original audit hash, not a hash augmented by
  // newly defaulted flags, and never inherit the newly enabled input actions.
  assert.equal((await service.change(input)).result.allowSubmitInput, false);
  h.state.user.permissions = [];
  await assert.rejects(planApplication.readModelPlan(await h.credentials.current()), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(service.read(key), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(service.operation({ ...key, operationKey: input.operationKey }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(logs.length, 3);
});
