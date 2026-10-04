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
  return { state, authority, context: { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' } };
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
