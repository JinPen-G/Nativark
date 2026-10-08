'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
test('actual order and historical readers compose sourced facts; finance denial discloses no records', async () => {
  const h = await setup();
  const service = new AiOrderExplanationFactsService(h.authority, h.reader, { read: async () => { throw Error('denied private record count 55'); } });
  const out = await service.read();
  assert.equal(out.order.value.id, 'order-a'); assert.equal(out.history.value.savedQuote.status, 'missing_link');
  assert.deepEqual(out.payments, { coverage: 'unavailable' }); assert.equal(out.actualReceivedTotal.coverage, 'not_loaded');
  assert.equal(out.amounts.source.resourceId, 'order-a'); assert.equal(out.fulfillment.inspectionExecution, 'not_loaded');
  assert.equal(JSON.stringify(out).includes('55'), false);
});
test('changed order while optional reads await and revoked core access refuse the whole pack', async () => {
  const h = await setup();
  const service = new AiOrderExplanationFactsService(h.authority, h.reader, { read: async () => { h.state.order.updatedAt = '2026-10-08T00:00:00Z'; throw Error(); } });
  await assert.rejects(service.read());
  h.state.user.permissions = []; await assert.rejects(service.read());
});
test('server expected principal cannot be replaced by another user in the same space', async () => {
  const h = await setup(), expected = await h.authority.resolve();
  h.state.user.id = 'replacement-user';
  await assert.rejects(h.reader.read(expected)); assert.equal(h.state.reads.length, 0);
});
