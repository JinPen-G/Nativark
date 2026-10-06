'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const Module = require('node:module'), path = require('node:path'), original = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return request === '@rental-os/shared' ? path.resolve(__dirname, '../packages/shared/src/index.ts') : original.call(this, request, parent, ...rest); };
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { composePersistedTaskList } = require('../apps/api/src/modules/ai-native/task-list.composition');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const now = new Date('2026-10-06T00:00:00Z');
function harness() {
  const state = { user: user(), session: true, member: true, policy: true, workspace: 'workspace-a', duringRead: null, duringPolicy: null, queries: [], policyReads: [], deniedTasks: [],
    rows: [{ id: 'task-a', status: 'UNKNOWN', revision: 1, sceneCode: 'order-explain', sceneVersion: '1', createdAt: now, updatedAt: now, cancelRequestedAt: null }] };
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-list-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'list-request', audience: 'operator', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const scope = { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
  const db = {
    aiScope: { findFirst: async ({ where }) => Object.entries(where).every(([key, value]) => scope[key] === value) ? structuredClone(scope) : null },
    aiTask: { findMany: async args => { state.queries.push(args); state.duringRead?.(); return structuredClone(state.rows); } },
    aiTaskActionPolicy: { findUnique: async ({ where }) => { state.policyReads.push(where); state.duringPolicy?.(); const key = where.scopeId_taskId_operation; return state.policy && !state.deniedTasks.includes(key.taskId) ? { ...key, revision: 1, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') } : null; } }
  };
  return { state, repository: composePersistedTaskList({ db, auth, credentials, clock: () => now }) };
}
test('actual AuthService, scope and persisted per-task metadata policy compose owner listing', async () => {
  const h = harness(), result = await h.repository.readPage({ limit: 5 });
  assert.equal(result.items[0].status, 'unknown'); assert.equal(h.state.queries[0].where.ownerId, 'operator-a');
  assert.deepEqual(h.state.policyReads[0].scopeId_taskId_operation, { scopeId: 'scope-a', taskId: 'task-a', operation: 'read_metadata' });
  assert.equal(h.state.policyReads.length, 2);
});
for (const [name, change] of Object.entries({ 'missing metadata policy': s => s.policy = false, 'no view permission': s => s.user.permissions = [], 'membership revoked': s => s.member = false, 'session revoked': s => s.session = false, 'SaaS actor': s => s.user.isSaasAdmin = true })) test(`list refuses ${name}`, async () => {
  const h = harness(); change(h.state); await assert.rejects(h.repository.readPage({}), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});
for (const [name, change] of Object.entries({ 'session': s => s.session = false, 'permission': s => s.user.permissions = [], 'workspace': s => s.workspace = 'workspace-b' })) test(`late ${name} change cannot publish the fetched page`, async () => {
  const h = harness(); h.state.duringRead = () => change(h.state);
  await assert.rejects(h.repository.readPage({}), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_SCOPE_CHANGED'].includes(e.code));
});
test('revocation while persisted policy waits cannot return metadata', async () => {
  const h = harness(); h.state.duringPolicy = () => { h.state.session = false; };
  await assert.rejects(h.repository.readPage({}), e => e.code === 'AI_ACCESS_DENIED');
});
test('pagination sentinel needs its own persisted policy before returning a cursor', async () => {
  const h = harness(); h.state.rows.push({ ...h.state.rows[0], id: 'task-b' });
  const result = await h.repository.readPage({ limit: 1 });
  assert.equal(result.items.length, 1); assert.ok(result.nextCursor);
  assert.deepEqual(h.state.policyReads.map(query => query.scopeId_taskId_operation.taskId), ['task-a', 'task-a', 'task-b', 'task-b']);
});
for (const taskId of ['task-a', 'task-b']) test(`missing policy for ${taskId} refuses the whole page, including its cursor`, async () => {
  const h = harness(); h.state.rows.push({ ...h.state.rows[0], id: 'task-b' }); h.state.deniedTasks = [taskId];
  await assert.rejects(h.repository.readPage({ limit: 1 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});
test('empty page still rechecks the current session after storage', async () => {
  const h = harness(); h.state.rows = []; h.state.duringRead = () => { h.state.session = false; };
  await assert.rejects(h.repository.readPage({}), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.policyReads.length, 0);
});
