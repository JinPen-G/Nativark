'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaTaskActionPolicySource, composePrismaTaskCurrentActionAuthority } = require('../apps/api/src/modules/ai-native/prisma-task-action-policy.source');
const { AiTaskCurrentActionAuthority } = require('../apps/api/src/modules/ai-native/task-current-action.authority');

const now = new Date('2026-10-06T10:00:00.000Z');
const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'request-a', authorizedAt: now.toISOString(), audience: 'operator',
  actor: { kind: 'user', userId: 'operator-a' }, scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
  access: { permissions: ['rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };

function setup(row = {}) {
  const calls = [];
  const state = { row: row === null ? null : { taskId: 'task-a', operation: 'takeover_run', revision: 3,
    requiredPermissions: ['rental-os:order:operate'], expiresAt: new Date(now.getTime() + 60000), ...row } };
  const db = { aiTaskActionPolicy: { findUnique: async value => { calls.push(value); return state.row; } } };
  const scopes = { resolveCurrent: async () => ({ context: structuredClone(context), scope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' } }) };
  return { source: new PrismaTaskActionPolicySource(db, scopes, () => now), state, calls, db };
}

test('reads a scoped server-owned policy and returns a detached view', async () => {
  const h = setup();
  const result = await h.source.resolve('task-a', 'takeover_run', context);
  assert.deepEqual(result, { taskId: 'task-a', operation: 'takeover_run', revision: 3, expiresAt: '2026-10-06T10:01:00.000Z', requiredPermissions: ['rental-os:order:operate'] });
  result.requiredPermissions.push('forged');
  assert.deepEqual(h.state.row.requiredPermissions, ['rental-os:order:operate']);
  assert.deepEqual(h.calls[0].where, { scopeId_taskId_operation: { scopeId: 'scope-a', taskId: 'task-a', operation: 'takeover_run' } });
});

for (const [name, row] of [['missing', null], ['expired', { expiresAt: new Date(now.getTime() - 1) }], ['zero revision', { revision: 0 }]]) test(`missing or invalid ${name} policy is unavailable`, async () => {
  const h = setup(row);
  assert.equal(await h.source.resolve('task-a', 'takeover_run', context), null);
});

test('malformed permission JSON is denied and never widened', async () => {
  const h = setup({ requiredPermissions: ['rental-os:order:view', 'rental-os:order:view'] });
  await assert.rejects(h.source.resolve('task-a', 'takeover_run', context), error => error.code === 'AI_ACCESS_DENIED');
});

test('context changed after scope resolution is denied', async () => {
  const h = setup();
  h.source = new PrismaTaskActionPolicySource(h.db, { resolveCurrent: async () => ({
    context: { ...context, scope: { kind: 'workspace', tenantId: 'tenant-b', workspaceId: 'workspace-b' } },
    scope: { id: 'scope-b', kind: 'WORKSPACE', tenantId: 'tenant-b', workspaceId: 'workspace-b' }
  }) }, () => now);
  await assert.rejects(h.source.resolve('task-a', 'takeover_run', context), error => error.code === 'AI_ACCESS_DENIED');
});

test('unknown operation is rejected before storage access', async () => {
  const h = setup();
  await assert.rejects(h.source.resolve('task-a', 'invented_action', context), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.calls.length, 0);
});

test('stale contract contexts are rejected before reading a policy', async () => {
  const h = setup();
  await assert.rejects(h.source.resolve('task-a', 'takeover_run', { ...context, contractVersion: 'ain-c03-draft-2' }), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.calls.length, 0);
});

test('composition helper wires the persisted policy source without registering a provider', () => {
  const h = setup();
  const authority = composePrismaTaskCurrentActionAuthority({
    auth: { resolveAccessContext: async () => { throw new Error('not invoked'); } },
    credentials: { current: async () => ({ authorization: 'synthetic', requestId: 'request-a', audience: 'operator' }) },
    db: h.db,
    scopes: { resolveCurrent: async () => ({ context, scope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' } }) },
    clock: () => now
  });
  assert.ok(authority instanceof AiTaskCurrentActionAuthority);
});
