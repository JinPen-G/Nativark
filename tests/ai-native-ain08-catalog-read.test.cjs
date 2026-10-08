'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiCatalogReadFactsService } = require('../apps/api/src/modules/ai-native/catalog-read-facts.service');
const context = { contractVersion: 'ain-c03-draft-1', requestId: 'req-catalog', authorizedAt: new Date(Date.now() - 1000).toISOString(), audience: 'staff', actor: { kind: 'user', userId: 'user-catalog' }, scope: { kind: 'workspace', tenantId: 'tenant-catalog', workspaceId: 'workspace-catalog' } };
const authority = value => ({ withRead: async (_kind, _input, read) => read(typeof value === 'function' ? value() : value) });
const row = { id: 'group-1', tenantId: 'tenant-catalog', categoryCode: 'camera', code: 'camera-1', name: 'Camera', inventoryMode: 'shared', unit: 'day', attributes: { cost: 99 }, images: [], bundleComponents: [], status: 'enabled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

test('catalog projection uses the existing Core read and strips non-fact fields', async () => {
  const service = new AiCatalogReadFactsService({ listItemGroups: async tenantId => { assert.equal(tenantId, 'tenant-catalog'); return [row]; } }, authority(context), () => new Date('2026-10-05T00:00:00Z'));
  const result = await service.read({ limit: 10 });
  assert.deepEqual(result.items, [{ id: 'group-1', code: 'camera-1', name: 'Camera', categoryCode: 'camera', status: 'enabled', unit: 'day' }]);
  assert.equal(Object.hasOwn(result.items[0], 'attributes'), false);
});

test('catalog projection fails closed for unsupported identity and unbounded result', async () => {
  const service = new AiCatalogReadFactsService({ listItemGroups: async () => Array.from({ length: 3 }, (_, index) => ({ ...row, id: `group-${index}` })) }, authority(context));
  await assert.rejects(() => service.read({ limit: 2 }), error => error.code === 'INVALID_RESPONSE');
  const client = new AiCatalogReadFactsService({ listItemGroups: async () => [row] }, authority({ ...context, audience: 'client' }));
  await assert.rejects(() => client.read({ limit: 2 }), error => error.code === 'FORBIDDEN');
});

test('catalog projection rejects a Core row bound to another tenant', async () => {
  const service = new AiCatalogReadFactsService({ listItemGroups: async () => [{ ...row, tenantId: 'tenant-other' }] }, authority(context));
  await assert.rejects(() => service.read({ limit: 2 }), error => error.code === 'INVALID_RESPONSE');
});

test('catalog projection rejects duplicate identity rows from the Core read', async () => {
  const service = new AiCatalogReadFactsService({ listItemGroups: async () => [row, { ...row, code: 'camera-duplicate' }] }, authority(context));
  await assert.rejects(() => service.read({ limit: 10 }), error => error.code === 'INVALID_RESPONSE');
});
