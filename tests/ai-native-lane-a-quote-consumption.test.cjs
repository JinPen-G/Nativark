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

test('AIN15 standalone candidate preparation binds the original principal before every nested source', async () => {
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  for (const kind of ['catalog', 'members', 'configuration', 'rates']) {
    const h = await setup(), candidates = h.tools.quote.candidates, untouched = structuredClone(h.candidate);
    const normal = await candidates.prepare(h.candidate);
    assert.equal(normal.status, 'needs_confirmation'); assert.equal(normal.reservation, 'not_reserved');
    const actor = h.h.identity.user.id; let sourceReads = 0, foreignLookups = 0, quoteAttempts = 0;
    const leaf = kind === 'configuration' ? candidates.contexts : candidates.readers[kind];
    const method = kind === 'configuration' ? 'current' : 'read', read = leaf[method].bind(leaf);
    const owner = kind === 'catalog' || kind === 'configuration' ? h.core
      : kind === 'members' ? h.memberships.prisma.customerProfile : h.business;
    const lookup = kind === 'catalog' ? 'listItemGroupsPage' : kind === 'configuration' ? 'readQuoteConfiguration'
      : kind === 'members' ? 'findMany' : 'readQuoteRateTargets';
    const originalLookup = owner[lookup].bind(owner);
    owner[lookup] = async (...args) => {
      foreignLookups++; assert.equal(getRequestIdentity().userId, 'another-standalone-source-reader');
      return originalLookup(...args);
    };
    const create = h.business.createQuote.bind(h.business);
    h.business.createQuote = (...args) => { quoteAttempts++; return create(...args); };
    leaf[method] = async (...args) => {
      // The nested original Guard resolves B for its whole read, then restores A.
      // Equal values/scope and an A-only closing check cannot bind this source.
      sourceReads++; h.h.identity.user.id = 'another-standalone-source-reader';
      try { return await read(...args); } finally { h.h.identity.user.id = actor; }
    };
    await assert.rejects(candidates.prepare(h.candidate), error => error.code === 'FORBIDDEN',
      `${kind}: a standalone aggregate must not accept another principal's source`);
    assert.equal(sourceReads, 1, `${kind}: reject at the first changed nested Guard`);
    assert.equal(foreignLookups, 0, `${kind}: no foreign principal reaches the business lookup`);
    assert.equal(quoteAttempts, 0); assert.equal(h.h.identity.user.id, actor);
    assert.deepEqual(h.candidate, untouched, 'candidate, revision and caller choices are not rewritten');
    assert.equal(h.businessFacts.writes.length, 0);
  }
  const withdrawn = await setup(); withdrawn.h.identity.user.permissions = [];
  await assert.rejects(withdrawn.tools.quote.candidates.prepare({}), error => error.code === 'FORBIDDEN',
    'the standard standalone entry must resolve current authority even for missing candidate input');
});
