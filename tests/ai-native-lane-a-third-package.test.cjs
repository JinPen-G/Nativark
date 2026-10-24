'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

test('formal quote composition exposes reconciliation capability without retrying create', async () => {
  const h = await setup();
  const result = await h.tools.quote.reconciliationAvailability();
  assert.equal(result.status, 'available_original_reference_only');
  assert.equal(result.nextAction, 'reconcile');
  assert.equal(result.retryable, false);
  assert.equal(result.entry, 'quote.recoverOriginal(reference, expectedIdentityHash)');
  assert.equal(result.semantics, 'exact_original_operation_key_only_missing_row_stays_unknown');
});
