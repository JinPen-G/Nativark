'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
test('actual quote scenario seals clarified facts and exposes only saved Core quote review after current selection', async () => {
  const h = await setup();
  // DB-execution substitute supplies synthetic stock, not a pricing or
  // authorization substitute. Real Core still calculates availability/quote.
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
    itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const selected = { ...h.candidate, selectionRevision: first.selectionRevision };
  const content = await h.tools.quote.businessPreparation.prepareInput(selected, 'unavailable');
  assert.equal(content.payload.facts.status, 'ready'); assert.equal(content.payload.execution, 'not_attempted');
  assert.equal(content.payloadFingerprint, requestFingerprint(content.payload));
  const quote = await h.tools.quote.previewBusinessSelection(selected);
  assert.equal(quote.status, 'quoted'); assert.equal(quote.quotePersistence, 'saved');
  assert.equal(quote.confirmationReview.source.resourceId, quote.quote.id);
  assert.equal(quote.confirmationReview.expiresAt, quote.quote.expiresAt);
  assert.equal(quote.confirmationReview.orderApproval, 'not_granted');
  assert.deepEqual(quote.quote.period, { startAt: content.payload.facts.request.startAt, endAt: content.payload.facts.request.endAt });
  assert.equal(quote.quote.lineUnits[0].quantity, 1);
  assert.equal(quote.quote.promotionVersionCoverage, 'charge_line_references_only');
  assert.equal(quote.confirmationReview.changes.amounts, 'unknown_previous_trusted_quote_not_loaded');
});
test('insufficient availability and permission loss do not save another quote or return stale model input', async () => {
  const h = await setup(); let writes = 0; const create = h.business.createQuote.bind(h.business);
  h.business.createQuote = (...args) => { writes++; return create(...args); };
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const output = await h.tools.quote.previewBusinessSelection({ ...h.candidate, selectionRevision: first.selectionRevision });
  assert.equal(output.status, 'unavailable'); assert.equal(output.quotePersistence, 'not_attempted'); assert.equal(writes, 0);
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.prepareInput(h.candidate, 'unavailable'));
});
