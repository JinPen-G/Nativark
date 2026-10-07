'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
test('actual opening partitions and recheck use current Core/readiness, not the previous list or user assertion', async () => {
  const { tools, business, core } = await setup();
  const current = await tools.openingActions.read();
  assert.equal(current.configuration.products.rows[0].id, core.listItemGroups('tenant_001')[0].id);
  assert.equal(current.configuration.inventory.coverage, 'not_loaded');
  assert.equal(current.configuration.fulfillment.locations[0].id, core.listLocations('tenant_001')[0].id);
  const item = current.sections.find(row => row.key === 'item_groups'); assert.ok(item);
  const still = await tools.openingActions.recheck({ key: item.key });
  assert.equal(still.status, item.status === 'readiness_check_passed' ? 'resolved' : 'still_exists');
  const original = business.tenantReadiness.bind(business);
  business.tenantReadiness = async (...args) => {
    const out = await original(...args); return { ...out, items: out.items.filter(row => row.key !== item.key) };
  };
  assert.equal((await tools.openingActions.recheck({ key: item.key })).status, 'cannot_determine');
  const pack = await tools.openingActions.prepare({}, 'unavailable');
  assert.equal(pack.payload.model.answer, 'not_generated'); assert.equal(pack.payload.execution, 'not_attempted');
  assert.equal(pack.payloadFingerprint, requestFingerprint(pack.payload));
});
test('recheck and deterministic fallback cannot outlive current diagnostic permission', async () => {
  const { tools, h } = await setup(); h.identity.user.permissions = [];
  await assert.rejects(tools.openingActions.recheck({ key: 'item_groups' }));
  await assert.rejects(tools.openingActions.prepare({}, 'unavailable'));
  await assert.rejects(tools.openingActions.recheck({ key: 'item_groups', fixed: true }));
});
