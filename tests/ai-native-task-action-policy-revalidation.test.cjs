'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaTaskActionPolicyRepository } = require('../apps/api/src/modules/ai-native/prisma-task-action-policy.repository');

const start = new Date('2026-10-06T12:00:00.000Z');
const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'policy-request', authorizedAt: start.toISOString(), audience: 'operator',
  actor: { kind: 'user', userId: 'user-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' },
  access: { permissions: ['rental-os:policy:write'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
const policy = () => ({ scopeId: 'scope-1', taskId: 'task-1', operation: 'takeover_run', revision: 1,
  requiredPermissions: ['rental-os:order:operate'], expiresAt: new Date(start.getTime() + 60000) });
const mutation = () => { const { scopeId, revision, ...value } = policy(); return value; };

// Explicit transactional double: writes are staged, committed only if the product
// callback succeeds. Hooks model authority/clock changes across actual awaits.
function setup(existing = false) {
  const state = { context: structuredClone(context), granted: true, time: new Date(start), row: existing ? policy() : null,
    taskId: 'task-1', afterTask: null, afterWrite: null, attempts: 0, commits: 0, rollbacks: 0, authorizations: 0 };
  const delegates = row => ({
    aiTask: { findFirst: async () => { state.afterTask?.(); return { id: state.taskId }; } },
    aiTaskActionPolicy: {
      findUnique: async () => structuredClone(row.value),
      create: async args => { state.attempts++; row.value = structuredClone(args.data); state.afterWrite?.(); return structuredClone(row.value); },
      updateMany: async args => {
        if (!row.value || !Object.entries(args.where).every(([key, value]) => row.value[key] === value)) return { count: 0 };
        state.attempts++; Object.assign(row.value, structuredClone(args.data)); state.afterWrite?.(); return { count: 1 };
      }
    }
  });
  const db = { ...delegates({ value: state.row }), $transaction: async callback => {
    const row = { value: structuredClone(state.row) };
    try { const result = await callback(delegates(row)); state.row = row.value; state.commits++; return result; }
    catch (error) { state.rollbacks++; throw error; }
  } };
  const scopes = { resolveCurrent: async () => ({ context: structuredClone(state.context),
    scope: { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'workspace-1' } }) };
  const authority = { resolve: async () => { state.authorizations++; if (!state.granted) throw Error('revoked'); return structuredClone(state.context); } };
  return { state, repository: new PrismaTaskActionPolicyRepository(db, scopes, authority, () => new Date(state.time)) };
}

for (const action of ['create', 'update', 'clear']) test(`${action}: revocation during persistence rolls back policy changes`, async () => {
  const h = setup(action !== 'create'), before = structuredClone(h.state.row);
  h.state.afterWrite = () => { h.state.granted = false; };
  const run = action === 'clear' ? () => h.repository.clear('task-1', 'takeover_run', 1)
    : () => h.repository.put(mutation(), action === 'create' ? null : 1);
  await assert.rejects(run(), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state.row, before); assert.equal(h.state.commits, 0); assert.equal(h.state.rollbacks, 1);
});

test('identity changing while the task is read cannot authorize a policy for the original caller', async () => {
  const h = setup();
  h.state.afterTask = () => { h.state.context.actor.userId = 'other-user'; };
  await assert.rejects(h.repository.put(mutation(), null), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.row, null); assert.equal(h.state.commits, 0);
});

test('a policy expiring during the database wait is not committed as a successful grant', async () => {
  const h = setup(); h.state.afterWrite = () => { h.state.time = new Date(start.getTime() + 60000); };
  await assert.rejects(h.repository.put(mutation(), null), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.row, null); assert.equal(h.state.commits, 0);
});

test('an inexact task lookup is not evidence for configuring the requested task', async () => {
  const h = setup(); h.state.taskId = 'TASK-1';
  await assert.rejects(h.repository.put(mutation(), null), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.attempts, 0);
});

test('unchanged authority commits once and returns the persisted revision', async () => {
  const h = setup(); const result = await h.repository.put(mutation(), null);
  assert.equal(result.revision, 1); assert.equal(h.state.commits, 1); assert.equal(h.state.attempts, 1);
  assert.ok(h.state.authorizations >= 2);
});
