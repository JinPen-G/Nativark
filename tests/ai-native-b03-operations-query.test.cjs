'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiOperationsQueryService } = require('../apps/api/src/modules/ai-native/operations-query.service');
const grant = { tenantId: 'tenant-a', workspaceId: 'space-a', actorId: 'actor-a', audience: 'operator', dataScope: 'own', revision: 'revision-1' };
const row = (id, overrides = {}) => ({ id, tenantId: 'tenant-a', workspaceId: 'space-a', actorId: 'actor-a', status: 'unknown', createdAt: new Date('2026-10-03T00:00:00Z'), ...overrides });
test('authorized bounded projection has stable cursor and drops all sensitive extras', async () => {
  const calls = [];
  const service = new AiOperationsQueryService({ resolve: async (_handle, permission) => { calls.push(permission); return grant; } }, { list: async (_kind, scope, filter) => { assert.equal(scope.actorId, 'actor-a'); assert.equal(filter.limit, 2); return [row('row-1', { apiKey: 'DO-NOT-EXPOSE', prompt: 'DO-NOT-EXPOSE', payload: 'DO-NOT-EXPOSE', credentialRef: 'DO-NOT-EXPOSE' }), row('row-2')]; } });
  const result = await service.list('server-session', 'invocations', { limit: 1 });
  assert.deepEqual(calls, ['ai.operations.read', 'ai.operations.read']);
  assert.equal(result.nextCursor, 'row-1'); assert.equal(result.items.length, 1);
  assert.equal(JSON.stringify(result).includes('DO-NOT-EXPOSE'), false);
});
test('query cannot supply scope, unlimited count or unknown fields', async () => {
  let touched = false;
  const service = new AiOperationsQueryService({ resolve: async () => { touched = true; return grant; } }, { list: async () => [] });
  for (const input of [{ tenantId: 'other' }, { limit: 0 }, { limit: 51 }, { limit: '10' }, { after: '../other' }, { unknown: true }]) await assert.rejects(service.list('session', 'usage', input), e => e.code === 'INVALID_REQUEST');
  assert.equal(touched, false);
});
for (const change of [{ tenantId: 'tenant-b' }, { workspaceId: 'space-b' }, { actorId: 'actor-b' }]) test('repository scope leak is rejected before projection ' + JSON.stringify(change), async () => {
  const service = new AiOperationsQueryService({ resolve: async () => grant }, { list: async () => [row('row-1', change)] });
  await assert.rejects(service.list('session', 'invocations'), e => e.code === 'INVALID_RESPONSE');
});
test('authorization changes while waiting deny the complete page', async () => {
  let count = 0;
  const service = new AiOperationsQueryService({ resolve: async () => ++count === 1 ? grant : { ...grant, revision: 'revoked-2' } }, { list: async () => [row('row-1')] });
  await assert.rejects(service.list('session', 'invocations'), e => e.code === 'FORBIDDEN');
});
test('client and automation audiences cannot consume operations queries', async () => {
  for (const audience of ['client', 'automation', 'saas_admin']) {
    const service = new AiOperationsQueryService({ resolve: async () => ({ ...grant, audience }) }, { list: async () => { throw new Error('must not query'); } });
    await assert.rejects(service.list('session', 'invocations'), e => e.code === 'FORBIDDEN');
  }
});
test('recovery candidates require distinct permission and never authorize retry', async () => {
  const permissions = [];
  const service = new AiOperationsQueryService({ resolve: async (_handle, permission) => { permissions.push(permission); return grant; } }, { list: async () => [row('row-1')] });
  const result = await service.list('session', 'reconciliation');
  assert.deepEqual(permissions, ['ai.reconciliation.read', 'ai.reconciliation.read']);
  assert.equal(result.items[0].retryAllowed, false); assert.equal(result.items[0].nextAction, 'reconcile');
});
test('over-limit duplicate/unordered/non-unknown recovery rows fail closed', async () => {
  for (const rows of [[row('row-2'), row('row-1')], [row('row-1'), row('row-1')], [row('row-1', { status: 'completed' })]]) {
    const service = new AiOperationsQueryService({ resolve: async () => grant }, { list: async () => rows });
    await assert.rejects(service.list('session', 'reconciliation'), e => e.code === 'INVALID_RESPONSE');
  }
});
