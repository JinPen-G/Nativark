'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

test('actual composed preparation reads Core availability, preserves selection review and never saves quotes', async () => {
  const { tools, business, candidate } = await setup();
  let quotes = 0; const create = business.createQuote.bind(business);
  business.createQuote = (...args) => { quotes++; return create(...args); };
  const first = await tools.quote.candidates.prepare(candidate);
  const prepared = await tools.quote.businessPreparation.prepare({ ...candidate, selectionRevision: first.selectionRevision });
  assert.ok(['ready', 'unavailable'].includes(prepared.status));
  assert.equal(prepared.availability.result.lines[0].requestedQuantity, 1);
  assert.equal(prepared.status, prepared.availability.result.available ? 'ready' : 'unavailable');
  assert.equal(prepared.review.configVersion, first.configVersion);
  assert.equal(prepared.reservation, 'not_reserved'); assert.equal(quotes, 0);
  const reconcile = await tools.quote.reconciliationAvailability();
  assert.equal(reconcile.retryable, false);
  assert.equal(reconcile.status, 'available_original_reference_only'); assert.equal(quotes, 0);
});

test('partial input stays actionable and revoked permissions cannot be downgraded into facts', async () => {
  const { tools, h } = await setup();
  const partial = await tools.quote.businessPreparation.prepare({ customerType: 'personal' });
  assert.ok(['missing_input', 'ambiguous'].includes(partial.status)); assert.equal(partial.availability, undefined);
  h.identity.user.permissions = [];
  await assert.rejects(tools.quote.businessPreparation.prepare({ customerType: 'personal' }));
});
