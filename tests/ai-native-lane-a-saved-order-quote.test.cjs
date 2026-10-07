'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { AiOrderReadFactsService } = require('../apps/api/src/modules/ai-native/order-read-facts.service');
const saved = () => ({ id: 'quote-old', tenantId: 'tenant-a', ruleVersion: 'old-rule', pricingPlanVersion: 'old-plan',
  priceVersionId: 'price-old', priceVersion: '2', createdAt: '2026-01-01T00:00:00Z', currency: 'CNY',
  rateSnapshot: [{ id: 'rate-old', itemGroupId: 'item-a', unit: 'day_24h', baseAmount: 123, internal: 'DO_NOT_LEAK' }],
  pricingContext: { timeZone: 'Asia/Shanghai', dayRates: [], calendars: [] },
  ruleSnapshot: { fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: false } }, inspectionTemplateSnapshots: [] });
async function bound(source = async () => ({ status: 'available', quote: saved() })) {
  const h = await setup(); h.state.order.quoteId = 'quote-old'; h.state.order.ruleVersion = 'old-rule'; h.state.order.pricingPlanVersion = 'old-plan';
  return { ...h, reader: new AiOrderReadFactsService(h.core, h.authority, () => new Date('2026-10-07T00:00:00Z'), { read: source }) };
}
test('saved quote history is loaded only by the original order quoteId and scope', async () => {
  const h = await bound(async (scope, quoteId) => {
    assert.equal(scope.workspaceId, 'workspace-a'); assert.equal(quoteId, 'quote-old'); return { status: 'available', quote: saved() };
  });
  const out = await h.reader.readHistoricalBasis();
  assert.equal(out.savedQuote.status, 'available'); assert.equal(out.savedQuote.rates[0].baseAmount, 123);
  assert.equal(out.savedQuote.timeZone, 'Asia/Shanghai'); assert.equal(out.complete, false);
  assert.equal(JSON.stringify(out).includes('DO_NOT_LEAK'), false);
  assert.equal((await h.reader.read()).paymentEvidence, 'not_loaded');
});
test('missing quote link and missing saved quote remain distinct', async () => {
  const h = await bound(async () => ({ status: 'missing' }));
  assert.equal((await h.reader.readHistoricalBasis()).savedQuote.status, 'missing');
  delete h.state.order.quoteId;
  assert.equal((await h.reader.readHistoricalBasis()).savedQuote.status, 'missing_link');
});
for (const patch of [{ id: 'quote-other' }, { tenantId: 'tenant-b' }, { ruleVersion: 'current-rule' },
  { pricingPlanVersion: 'current-plan' }, { rateSnapshot: [{ id: 'bad', itemGroupId: 'item-a', unit: 'day_24h', baseAmount: NaN }] }]) {
  test(`mismatched or malformed saved quote is rejected: ${Object.keys(patch)}`, async () => {
    const h = await bound(async () => ({ status: 'available', quote: { ...saved(), ...patch } }));
    await assert.rejects(h.reader.readHistoricalBasis());
  });
}
test('missing saved context or rates is not replaced with current values', async () => {
  const h = await bound(async () => { const q = saved(); delete q.pricingContext; delete q.rateSnapshot; return { status: 'available', quote: q }; });
  const out = await h.reader.readHistoricalBasis();
  assert.equal(out.savedQuote.contextStatus, 'missing'); assert.equal(out.savedQuote.ratesStatus, 'missing');
});
test('revocation while loading historical quote suppresses the entire late history', async () => {
  let h; h = await bound(async () => { h.state.user.permissions = []; return { status: 'available', quote: saved() }; });
  await assert.rejects(h.reader.readHistoricalBasis());
});
test('actual saved quote source uses original Core business store within guarded order scope', async () => {
  const h = await setup('operator', 'tenant_001');
  const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
  const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
  const { AiGuardedQuoteCoreContextSource } = require('../apps/api/src/modules/ai-native/tools/quote-route.composition');
  const { AiOrderSavedQuoteSource } = require('../apps/api/src/modules/ai-native/tools/order-saved-quote.source');
  const stores = require('./helpers/absorbing-config-store.cjs');
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore());
  await business.onApplicationBootstrap();
  const contexts = new AiGuardedQuoteCoreContextSource(h.core, new AiBusinessReadRouteAuthority(h.guard, h.credentials));
  let callbackError;
  const old = await h.authority.withOrderRead(async c => {
    try {
    const context = await contexts.current(c.scope);
    return await business.createQuote(c.scope.tenantId, context, { customerType: 'personal', customerId: 'customer-a',
      startAt: '2026-11-10T09:00:00+08:00', endAt: '2026-11-11T09:00:00+08:00', fulfillmentMode: context.settings.fulfillment.enabledModes[0],
      fulfillmentLocationId: context.locations[0].id, lines: [{ itemGroupId: context.groups[0].id, quantity: 1 }] });
    } catch (error) { callbackError = error; throw error; }
  }).catch(error => { throw callbackError ?? error; });
  Object.assign(h.state.order, { quoteId: old.id, ruleVersion: old.ruleVersion, pricingPlanVersion: old.pricingPlanVersion });
  const source = new AiOrderSavedQuoteSource(business, contexts);
  const reader = new AiOrderReadFactsService(h.core, h.authority, undefined, source);
  const result = await reader.readHistoricalBasis();
  assert.equal(result.savedQuote.quoteId, old.id);
  assert.equal(result.savedQuote.rates[0].baseAmount, old.rateSnapshot[0].baseAmount);
  assert.equal(result.savedQuote.timeZone, old.pricingContext.timeZone);
  await assert.rejects(source.read({ kind: 'workspace', tenantId: 'tenant-b', workspaceId: 'workspace-b' }, old.id));
  h.state.order.quoteId = 'missing-quote';
  assert.equal((await reader.readHistoricalBasis()).savedQuote.status, 'missing');
});
