'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaTaskActionPolicyRepository } = require('../apps/api/src/modules/ai-native/prisma-task-action-policy.repository');

const now = new Date('2026-10-06T12:00:00.000Z');
const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'req-1', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'user-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, access: { permissions: ['rental-os:policy:write'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
function setup(options = {}) {
  const state = { policy: options.policy ? structuredClone(options.policy) : null, task: options.task === false ? null : { id: 'task-1' }, calls: [] };
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => row[key] === value);
  const delegates = {
    aiTask: { findFirst: async args => { state.calls.push(['task', args]); return state.task; } },
    aiTaskActionPolicy: {
      findUnique: async args => { state.calls.push(['find', args]); return state.policy && state.policy.taskId === args.where.scopeId_taskId_operation.taskId && state.policy.operation === args.where.scopeId_taskId_operation.operation ? structuredClone(state.policy) : null; },
      create: async args => { state.policy = structuredClone(args.data); return structuredClone(state.policy); },
      updateMany: async args => { if (!matches(state.policy, args.where)) return { count: 0 }; Object.assign(state.policy, structuredClone(args.data)); return { count: 1 }; }
    }
  };
  const db = { ...delegates, $transaction: async callback => callback(delegates) };
  const scopes = { resolveCurrent: async () => ({ context: structuredClone(options.scopeContext ?? context), scope: { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'workspace-1' } }) };
  const authority = { resolve: async () => structuredClone(options.authorityContext ?? context) };
  return { state, repository: new PrismaTaskActionPolicyRepository(db, scopes, authority, () => now) };
}
const value = (overrides = {}) => ({ taskId: 'task-1', operation: 'takeover_run', requiredPermissions: ['rental-os:policy:write'], expiresAt: new Date('2026-10-06T13:00:00.000Z'), ...overrides });

test('creates and updates a policy with server-side revision allocation', async () => {
  const h = setup();
  assert.deepEqual(await h.repository.put(value(), null), { taskId: 'task-1', operation: 'takeover_run', revision: 1, requiredPermissions: ['rental-os:policy:write'], expiresAt: '2026-10-06T13:00:00.000Z' });
  assert.equal((await h.repository.put(value({ requiredPermissions: ['ai:policy:takeover'] }), 1)).revision, 2);
  assert.deepEqual(h.state.policy.requiredPermissions, ['ai:policy:takeover']);
});

test('create/update CAS conflicts do not overwrite another revision', async () => {
  const h = setup({ policy: { scopeId: 'scope-1', taskId: 'task-1', operation: 'takeover_run', revision: 4, requiredPermissions: ['old'], expiresAt: new Date('2026-10-06T13:00:00.000Z') } });
  await assert.rejects(h.repository.put(value(), null), error => error.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(h.repository.put(value(), 3), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.policy.revision, 4);
});

test('clear is a CAS mutation that makes the policy immediately unavailable', async () => {
  const h = setup({ policy: { scopeId: 'scope-1', taskId: 'task-1', operation: 'takeover_run', revision: 2, requiredPermissions: ['old'], expiresAt: new Date('2026-10-06T13:00:00.000Z') } });
  const result = await h.repository.clear('task-1', 'takeover_run', 2);
  assert.equal(result.revision, 3);
  assert.equal(result.expiresAt, now.toISOString());
  await assert.rejects(h.repository.clear('task-1', 'takeover_run', 2), error => error.code === 'AI_REVISION_CONFLICT');
});

test('authority and canonical scope must agree before any task or policy write', async () => {
  const h = setup({ authorityContext: { ...context, scope: { kind: 'workspace', tenantId: 'other', workspaceId: 'other' } } });
  await assert.rejects(h.repository.put(value(), null), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.policy, null);
  const missing = setup({ task: false });
  await assert.rejects(missing.repository.put(value(), null), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
});

test('invalid policy payloads fail before transaction writes', async () => {
  const h = setup();
  await assert.rejects(h.repository.put(value({ requiredPermissions: ['dup', 'dup'] }), null), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.repository.put(value({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }), null), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.policy, null);
});
