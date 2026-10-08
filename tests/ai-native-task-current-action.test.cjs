'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { AiTaskCurrentActionAuthority } = require('../apps/api/src/modules/ai-native/task-current-action.authority');
const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const samples = require('./fixtures/ai-native/authorization-baseline.cjs');

function setup(audience = 'operator') {
  const now = new Date('2026-10-06T10:00:00Z');
  const state = { user: samples.user(), workspace: 'workspace-a', member: true, session: true, policy: true, revoke: null };
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => [] },
  { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-action-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'action-request', audience, authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const actions = [];
  const policies = { resolve: async (taskId, operation) => {
    actions.push(operation); if (state.revoke) { state.revoke(state); state.revoke = null; }
    return state.policy ? { taskId, operation, revision: 1, expiresAt: new Date(now.getTime() + 60000).toISOString(), requiredPermissions: [operation === 'takeover_run' ? 'rental-os:order:operate' : 'rental-os:order:view'] } : null;
  } };
  return { state, actions, authority: new AiTaskCurrentActionAuthority(auth, credentials, policies, () => now), now };
}

for (const audience of ['operator', 'staff']) for (const action of ['read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input']) test(`actual AuthService verifies ${audience}/${action} using a versioned injected policy`, async () => {
  const h = setup(audience); const context = await h.authority.resolve('task-a', action);
  assert.equal(context.scope.workspaceId, 'workspace-a'); assert.equal(context.actor.userId, 'operator-a'); assert.equal(context.audience, audience);
  assert.deepEqual(h.actions, [action, action]);
});

for (const [name, revoke] of [['session revoked', s => { s.session = false; }], ['membership revoked', s => { s.member = false; }], ['permission removed', s => { s.user.permissions = []; }], ['workspace changed', s => { s.workspace = 'workspace-b'; }]]) test(`policy await reauthorization denies ${name}`, async () => {
  const h = setup(); h.state.revoke = revoke;
  await assert.rejects(h.authority.resolve('task-a', 'takeover_run'), error => error.code === 'AI_ACCESS_DENIED');
});

test('missing formal action policy remains unavailable, not an implicit entitlement', async () => {
  const h = setup(); h.state.policy = false;
  await assert.rejects(h.authority.resolve('task-a', 'takeover_run'), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(h.authority.resolve('task-a', 'invented_action'), error => error.code === 'AI_ACCESS_DENIED');
});

test('step replay bridge uses the exact action and owner query never widens to administrator tasks', async () => {
  const h = setup();
  assert.equal((await h.authority.stepReplayAuthority().resolve({ taskId: 'task-a' })).actor.userId, 'operator-a');
  const repository = new AiTaskRepository({}, h.authority, () => h.now);
  const access = await repository.resolveAccess('task-a', 'takeover_run');
  assert.equal(access.where.ownerId, 'operator-a'); assert.equal(access.where.audience, 'OPERATOR');
  assert.deepEqual(access.where.scope.is.workspaceId, 'workspace-a');
});

test('SaaS identity and missing location scope do not acquire workspace task authority', async () => {
  const h = setup(); h.state.user.isSaasAdmin = true;
  await assert.rejects(h.authority.resolve('task-a', 'read_metadata'), error => error.code === 'AI_ACCESS_DENIED');
  h.state.user.isSaasAdmin = false; h.state.user.locationScope = undefined;
  await assert.rejects(h.authority.resolve('task-a', 'read_metadata'), error => error.code === 'AI_ACCESS_DENIED');
});
