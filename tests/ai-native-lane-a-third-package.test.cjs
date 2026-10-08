'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

test('formal quote composition exposes reconciliation capability without retrying create', async () => {
  const h = await setup();
  const result = await h.tools.quote.reconciliationAvailability();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.nextAction, 'reconcile');
  assert.equal(result.retryable, false);
  assert.match(result.missingDependency, /original operation key/u);
});
