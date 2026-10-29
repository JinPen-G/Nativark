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

test('customer task policy management uses original Guard, scoped CAS and atomic original audit recovery', async t => {
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
  const { ClientTaskPolicyController } = require('../apps/api/src/modules/ai-native/scenes/client-task-policy.controller');
  const { clientPolicyRequest, clientPolicyResponse } = require('../apps/api/src/modules/ai-native/scenes/client-policy-http.contract');
  const shared = require('@rental-os/shared');
  const contractHelpers = require('./fixtures/ai-native/contract-consumer.cjs');
  contractHelpers.checkClosed(shared.AI_CLIENT_POLICY_HTTP_SCHEMAS, shared.AI_CLIENT_POLICY_HTTP_SCHEMAS);
  const validators = contractHelpers.validatorsFor(shared.AI_CLIENT_POLICY_HTTP_SCHEMAS, {});
  const httpApplication = { ...planApplication };
  const http = new ClientTaskPolicyController(httpApplication);
  const request = { headers: { authorization: (await h.credentials.current()).authorization } };
  const { AI_NATIVE_CLIENT_POLICY_PROVIDER } = require('../apps/api/src/modules/ai-native/ai-native-application.providers');
  const standard = new ClientTaskPolicyController(AI_NATIVE_CLIENT_POLICY_PROVIDER.useFactory(db, h.guard, h.auth, { enabled: true }));
  assert.equal((await standard.readModelPlan(request, {})).state, 'not_configured');
  const standardRead = await standard.read(request, key);
  assert.equal(standardRead.state, 'not_configured', 'server-selected quote_clarification cannot read the other scene policy');
  const fails = (status, code, nextAction) => e => e.getStatus() === status && e.getResponse().code === code
    && e.getResponse().retryable === false && (!nextAction || e.getResponse().nextAction === nextAction);
  const callCounts = () => ({ policies: rows.length, plans: modelPlans.length, logs: logs.length });
  await assert.rejects(new ClientTaskPolicyController(AI_NATIVE_CLIENT_POLICY_PROVIDER.useFactory(db, h.guard, h.auth))
    .read(request, key), fails(503, 'AI_RESOURCE_UNAVAILABLE'));
  const beforeReads = callCounts();
  const currentPolicy = await http.read(request, key);
  assert.equal(currentPolicy.policy.revision, 3);
  assert.equal(validators.AiClientPolicyReadResponseDraft(currentPolicy), true);
  assert.equal((await http.read(request, { channel: 'app', customerType: 'corporate' })).state, 'not_configured');
  const originalPolicy = await http.operation(request, { ...key, operationKey: input.operationKey });
  assert.equal(originalPolicy.result.revision, 1, 'operation reads its exact original result, not the current row');
  assert.equal(originalPolicy.result.allowExecute, true);
  assert.equal((await http.operation(request, { ...key, operationKey: 'never-recorded' })).state, 'not_observed');
  const replay = await http.change(request, input);
  assert.equal(replay.result.revision, 1);
  assert.equal(Object.hasOwn(clientPolicyRequest('change', input), 'allowCancel'), false, 'wire validation must not default legacy command flags');
  assert.deepEqual(callCounts(), beforeReads);
  assert.equal((await http.readModelPlan(request, {})).revision, 2);
  for (const [method, value] of [['read', { ...key, tenantId: 'forged' }], ['change', { ...input, allowExecute: 'true' }],
    ['readModelPlan', { sceneCode: 'forged' }], ['changeModelPlan', { ...modelPlan, expectedRevision: 2, limits: { ...modelPlan.limits, maxStepMs: 2001 } }]]) {
    await assert.rejects(http[method](request, value), fails(400, 'AI_INVALID_INPUT'));
  }
  const originalRead = planApplication.read;
  const corruptRead = t.mock.method(httpApplication, 'read', async (...args) => ({ ...await originalRead(...args), internalCredential: 'not-for-wire' }));
  await assert.rejects(http.read(request, key), fails(503, 'AI_STORAGE_UNAVAILABLE'));
  corruptRead.mock.restore();
  assert.throws(() => clientPolicyResponse('read', { ...currentPolicy, policy: { ...currentPolicy.policy, channel: 'app' } }, key),
    e => e.code === 'AI_STORAGE_UNAVAILABLE');
  assert.throws(() => clientPolicyResponse('operation', { ...originalPolicy, operationKey: 'another-key' }, { ...key, operationKey: input.operationKey }),
    e => e.code === 'AI_STORAGE_UNAVAILABLE');
  for (const altered of [{ ...replay, result: { ...replay.result, revision: 3 } },
    { ...replay, result: { ...replay.result, allowCancel: true } }, { ...replay, retryable: true }]) {
    assert.throws(() => clientPolicyResponse('change', altered, input), e => e.code === 'RECONCILIATION_REQUIRED');
  }
  // Use the actual producer then damage its response: the write remains recorded
  // once and is recovered with the same operation key, never a fabricated retry.
  const nextPolicy = { ...input, operationKey: 'http-disable', expectedRevision: 3, enabled: false,
    expiresAt: input.expiresAt.replace('Z', '+00:00') };
  const originalChange = planApplication.change;
  const corruptChange = t.mock.method(httpApplication, 'change', async (...args) => {
    const saved = await originalChange(...args);
    args[1].expectedRevision = 100;
    return { ...saved, result: { ...saved.result, revision: 101 } };
  });
  await assert.rejects(http.change(request, nextPolicy), fails(409, 'AI_RESULT_UNKNOWN', 'read_original_policy_operation'));
  corruptChange.mock.restore();
  assert.equal(rows[0].revision, 4); assert.equal(logs.length, 4);
  assert.equal((await http.operation(request, { ...key, operationKey: nextPolicy.operationKey })).result.revision, 4);
  assert.equal((await http.change(request, nextPolicy)).result.revision, 4, 'equivalent offset date survives original idempotent replay');
  assert.equal(logs.length, 4);
  loseReply = true;
  const uncertain = { ...nextPolicy, operationKey: 'http-commit-lost', expectedRevision: 4, enabled: true };
  assert.equal((await http.change(request, uncertain)).state, 'unknown');
  assert.equal((await http.operation(request, { ...key, operationKey: uncertain.operationKey })).result.revision, 5);
  const originalPlan = planApplication.changeModelPlan;
  const corruptPlan = t.mock.method(httpApplication, 'changeModelPlan', async (...args) => ({ ...await originalPlan(...args), allowedTools: ['forged'] }));
  await assert.rejects(http.changeModelPlan(request, { ...modelPlan, expectedRevision: 2 }), fails(409, 'AI_RESULT_UNKNOWN', 'read_original_model_plan'));
  corruptPlan.mock.restore();
  const planRead = await http.readModelPlan(request, {});
  assert.equal(planRead.revision, 3);
  assert.equal(planRead.state, 'configured');
  assert.equal((await http.changeModelPlan(request, { ...modelPlan, expectedRevision: 3, enabled: false,
    expiresAt: modelPlan.expiresAt.replace('Z', '+00:00') })).revision, 4);
  assert.throws(() => clientPolicyResponse('readModelPlan', { ...planRead, limits: { ...planRead.limits, maxConcurrent: 2 } }, {}),
    e => e.code === 'AI_STORAGE_UNAVAILABLE');
  const { OPENAPI_DOCUMENT: doc } = require('../apps/api/src/contracts/openapi-document');
  for (const [method, contract] of Object.entries(shared.AI_CLIENT_POLICY_HTTP_CONTRACTS)) {
    const operation = doc.paths[`/api/${shared.AI_CLIENT_TASK_POLICY_HTTP_DRAFT.basePath}/${shared.AI_CLIENT_TASK_POLICY_HTTP_DRAFT[method]}`].post;
    assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${contract.request}`);
    assert.ok(doc.components.schemas[contract.response]);
    assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
  }
  assert.deepEqual(contractHelpers.compileConsumer(`import type { AiClientPolicyChangeResponseDraft, AiClientModelPlanReadResponseDraft } from '../packages/shared/src/index';
const policy: AiClientPolicyChangeResponseDraft = ${JSON.stringify(replay)};
const plan: AiClientModelPlanReadResponseDraft = ${JSON.stringify(planRead)};
// @ts-expect-error configuration never attests execution
const forged: AiClientPolicyChangeResponseDraft = { ...policy, execution: 'granted' };
// @ts-expect-error an absent plan carries no configuration
const absent: AiClientModelPlanReadResponseDraft = { state: 'not_configured', execution: 'not_attested', revision: 1 };
`), []);
  h.state.user.permissions = [];
  await assert.rejects(http.read(request, key), fails(403, 'AI_ACCESS_DENIED'));
  await assert.rejects(http.operation(request, { ...key, operationKey: nextPolicy.operationKey }), fails(403, 'AI_ACCESS_DENIED'));
  await assert.rejects(planApplication.readModelPlan(await h.credentials.current()), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(service.read(key), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(service.operation({ ...key, operationKey: input.operationKey }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(logs.length, 5);
});
