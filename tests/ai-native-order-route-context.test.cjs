'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
const { AiScopeRepository } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
function setup(audience = 'operator') {
  const state = { user: user(), audience, workspace: 'workspace-a', sessionActive: true, memberActive: true, orderVisible: true, credentialReads: 0, queries: [], extra: {} };
  const auth = new AuthService({
    getAuthSession: async () => state.sessionActive ? { id: 'session-a', userId: state.user.id, audience: state.audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.memberActive ? state.user : undefined,
    listUserWorkspaces: async () => []
  }, { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-test-secret' : undefined });
  const token = () => auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: state.audience, wid: 'forged-token-workspace', exp: Math.floor(Date.now() / 1000) + 600 });
  const credentials = { current: async () => { state.credentialReads++; return { authorization: `Bearer ${token()}`, requestId: 'request-a', audience, ...state.extra }; } };
  const db = { rentalOrder: { findFirst: async args => { state.queries.push(args); return state.orderVisible ? { id: 'order-a' } : null; } } };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, db);
  const authority = new AiOrderRouteContextAuthority(guard, credentials, 'order-a');
  return { state, authority, guard, credentials };
}
const denied = e => e.code === 'AI_ACCESS_DENIED' && e.message === e.code;
for (const audience of ['operator','staff']) test(`real AuthService and Guard produce current ${audience} context`, async () => {
  const f = setup(audience); const ctx = await f.authority.resolve();
  assert.equal(ctx.audience, audience); assert.deepEqual(ctx.actor, { kind: 'user', userId: 'operator-a' });
  assert.deepEqual(ctx.scope, { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' });
  assert.deepEqual(ctx.access.permissions, f.state.user.permissions); assert.equal(ctx.access.dataScope, 'all');
  assert.deepEqual(ctx.access.locationScope, { mode: 'all', locationIds: [] });
  assert.equal(JSON.stringify(ctx).includes('Bearer'), false); assert.equal('authorization' in ctx, false);
});
for (const audience of ['operator','staff']) test(`other session audience cannot satisfy ${audience} entry`, async () => {
  const f = setup(audience); f.state.audience = audience === 'operator' ? 'staff' : 'operator';
  await assert.rejects(f.authority.resolve(), denied);
});
test('current session workspace overrides stale JWT hints and previous scope', async () => {
  const f = setup(); assert.equal((await f.authority.resolve()).scope.workspaceId, 'workspace-a');
  f.state.workspace = 'workspace-b'; assert.equal((await f.authority.resolve()).scope.workspaceId, 'workspace-b'); assert.equal(f.state.credentialReads, 2);
});
for (const change of [s => { s.sessionActive = false; }, s => { s.memberActive = false; }, s => { s.user.isActive = false; },
  s => { s.user.permissions = []; }, s => { s.workspace = undefined; }, s => { s.user.isSaasAdmin = true; }]) test('revocation or incompatible identity fails after earlier success', async () => {
  const f = setup(); await f.authority.resolve(); change(f.state); await assert.rejects(f.authority.resolve(), denied);
});
test('location and own restrictions use actual Guard queries and stay in C01 context', async () => {
  const f = setup('staff'); f.state.user.dataScope = 'own'; f.state.user.locationScope = { mode: 'selected', locationIds: ['location-a'] };
  const ctx = await f.authority.resolve(); const where = f.state.queries[0].where;
  assert.equal(where.id, 'order-a'); assert.equal(where.tenantId, 'tenant-a'); assert.equal(where.workspaceId, 'workspace-a');
  assert.ok(JSON.stringify(where).includes('createdBy')); assert.ok(JSON.stringify(where).includes('location-a'));
  assert.equal(ctx.access.dataScope, 'own'); assert.deepEqual(ctx.access.locationScope, f.state.user.locationScope);
  f.state.orderVisible = false; await assert.rejects(f.authority.resolve(), denied);
});
test('a privileged parent ALS store cannot be reused or overwritten', async () => {
  const f = setup();
  await runWithRequestIdentity({ tenantId: 'outer', userId: 'outer', isSaasAdmin: true }, async () => {
    const before = { ...getRequestIdentity() }; const ctx = await f.authority.resolve();
    assert.equal(ctx.scope.tenantId, 'tenant-a'); assert.deepEqual(getRequestIdentity(), before);
    f.state.sessionActive = false; await assert.rejects(f.authority.resolve(), denied); assert.deepEqual(getRequestIdentity(), before);
  });
});
test('parallel contexts cannot leak their ALS identities into each other', async () => {
  const a = setup(), b = setup('staff'); b.state.user = user({ id: 'staff-b', tenantId: 'tenant-b' }); b.state.workspace = 'space-b';
  const [one,two] = await Promise.all([a.authority.resolve(), b.authority.resolve()]);
  assert.equal(one.actor.userId, 'operator-a'); assert.equal(two.actor.userId, 'staff-b'); assert.equal(two.scope.tenantId, 'tenant-b');
});
test('actual guarded context composes with canonical scope repository and rechecks revocation', async () => {
  const f = setup(); let revoke = false;
  const db = { aiScope: { findFirst: async ({ where }) => { if (revoke) f.state.sessionActive = false; return { id: 'scope-db-id', ...where }; } } };
  const scopes = new AiScopeRepository(db, f.authority);
  assert.equal((await scopes.resolveCurrent()).scope.id, 'scope-db-id');
  revoke = true; await assert.rejects(scopes.resolveCurrent(), denied);
});
test('credential source cannot inject tenant, workspace or unsupported audience fields', async () => {
  for (const extra of [{ tenantId: 'evil' }, { workspaceId: 'evil' }, { audience: 'client' }, { audience: 'automation' }, { authorization: '' }]) {
    const f = setup(); f.state.extra = extra; await assert.rejects(f.authority.resolve(), denied);
  }
});
test('route IDs cannot become arbitrary paths or reserved operations', () => {
  const f = setup(); for (const id of ['../admin', 'x?tenant=other', 'expire-pending', 'EXPIRE-PENDING', 'reconcile-pickup-overdue', 'Reconcile-Pickup-Overdue', '']) {
    assert.throws(() => new AiOrderRouteContextAuthority(f.guard, f.credentials, id), denied);
  }
});
test('a Guard returning false cannot mint context even with a credential', async () => {
  const f = setup(); const authority = new AiOrderRouteContextAuthority({ canActivate: async () => false }, f.credentials, 'order-a');
  await assert.rejects(authority.resolve(), denied);
});
