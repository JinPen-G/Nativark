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
  return { state, authority, guard, credentials, context: { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' } };
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
  const h = setup(), rows = [], logs = []; let loseReply = false, failAudit = false;
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
      const beforeRows = structuredClone(rows), beforeLogs = structuredClone(logs); let result;
      try { result = await callback(db); }
      catch (error) { rows.splice(0, rows.length, ...beforeRows); logs.splice(0, logs.length, ...beforeLogs); throw error; }
      if (loseReply) { loseReply = false; throw Error('synthetic COMMIT completed, reply lost'); }
      return result;
    }
  };
  const { createClientTaskPolicyManagementApplication } = require('../apps/api/src/modules/ai-native/scenes/client-task-policy-management.service');
  const options = { db, guard: h.guard, scene: { sceneCode: 'client-order-explanation', sceneVersion: '1' } };
  const application = createClientTaskPolicyManagementApplication({ ...options, enabled: true });
  const service = Object.fromEntries(['read', 'change', 'operation'].map(method => [method,
    async value => application[method](await h.credentials.current(), value)]));
  const key = { channel: 'web', customerType: 'personal' };
  await assert.rejects(createClientTaskPolicyManagementApplication(options).read(await h.credentials.current(), key),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal((await service.read(key)).state, 'not_configured');
  const input = { ...key, operationKey: 'enable-original', expectedRevision: 0, enabled: true,
    allowRead: true, allowCreate: true, allowExecute: true, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const created = await service.change(input);
  assert.equal(created.state, 'observed'); assert.equal(created.execution, 'not_attested');
  assert.equal(rows[0].allowExecute, true); assert.equal(rows[0].tenantId, 'tenant-a'); assert.equal(rows[0].workspaceId, 'workspace-a');
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
  h.state.user.permissions = [];
  await assert.rejects(service.read(key), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(service.operation({ ...key, operationKey: input.operationKey }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(logs.length, 2);
});
