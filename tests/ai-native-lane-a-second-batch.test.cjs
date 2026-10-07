'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');

async function orderTools() {
  const order = await orderSetup(), business = await businessSetup();
  return { order, business, tools: composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard,
    credentials: order.credentials, business: business.business, reports: business.reports, memberships: business.memberships }) };
}

test('order citations reopen through current authority and refresh compares only server version', async () => {
  const h = await orderTools(), service = h.tools.orderExplanationPreparation('order-a');
  const opened = await service.reopenCitation({ question: 'status', resourceType: 'order', resourceId: 'order-a', field: 'order' });
  assert.equal(opened.status, 'available');
  const refreshed = await service.refresh({ question: 'status', previousOrderVersion: '2026-10-09T00:00:00Z' });
  assert.equal(refreshed.comparison.status, 'compared');
  assert.equal(refreshed.comparison.eventTimeline, 'not_created');
});

test('manual handoff stays candidate-only when Core allowed-actions source is unavailable', async () => {
  const h = await orderTools();
  const handoff = await h.tools.orderManualHandoff('order-a', { code: 'rental.order.commit' });
  assert.equal(handoff.status, 'manual_review');
  assert.equal(handoff.execution, 'not_attempted');
});

test('opening section preparation and member profile submission remain bounded candidates', async () => {
  const h = await businessSetup();
  const current = await h.tools.openingActions.read();
  const section = await h.tools.openingActions.prepareSection({ key: current.sections[0].key });
  assert.equal(section.status, 'prepared');
  assert.equal(section.persistence, 'not_attempted');
  const material = await h.tools.memberProfileSubmissionMaterial({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'Updated customer' });
  assert.equal(material.status, 'prepared_not_submitted');
  assert.equal(material.approval, 'not_created');
});

test('multi-section differences stay independently bounded and unavailable sections do not become a transaction', async () => {
  const h = await businessSetup();
  const current = await h.tools.openingActions.read();
  const result = await h.tools.openingSectionDifferences({ sections: [
    { key: 'workspace_profile', expectedVersion: current.configVersion, changes: [{ field: 'itemLabel', value: 'Updated label' }] },
    { key: 'pricing_groups_rates', expectedVersion: current.configVersion, changes: [] }
  ] });
  assert.equal(result.status, 'section_candidates');
  assert.equal(result.atomicity, 'independent_section_results_not_transaction');
  assert.equal(result.rows[0].status, 'prepared');
  assert.equal(result.rows[1].status, 'unavailable');
});
