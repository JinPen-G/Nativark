'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
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
  const material = await service.prepare({ question: 'status' });
  const citation = { question: 'status', resourceType: 'order', resourceId: 'order-a', field: 'order',
    scope: material.payload.scope, version: material.payload.orderVersion };
  const opened = await service.reopenCitation(citation);
  assert.equal(opened.status, 'available');
  await assert.rejects(() => service.reopenCitation({ ...citation, scope: { ...citation.scope, workspaceId: 'other' } }), e => e.code === 'AI_ACCESS_DENIED');
  const stale = await service.reopenCitation({ ...citation, version: 'older-order-version' });
  assert.equal(stale.status, 'stale'); assert.equal(stale.value, undefined);
  const period = await service.reopenCitation({ ...citation, field: 'rental_period' });
  assert.equal(period.status, 'available'); assert.equal(period.value.source.field, 'rental_period');
  h.order.state.session = false;
  await assert.rejects(() => service.reopenCitation(citation), e => e.code === 'AI_ACCESS_DENIED');
  h.order.state.session = true;
  const refreshed = await service.refresh({ question: 'status', previousOrderVersion: '2026-10-09T00:00:00Z' });
  assert.equal(refreshed.comparison.status, 'compared');
  assert.equal(refreshed.comparison.eventTimeline, 'not_created');
});

test('manual handoff stays candidate-only when Core allowed-actions source is unavailable', async () => {
  const h = await orderTools();
  const handoff = await h.tools.orderManualHandoff('order-a', { code: 'rental.order.commit' });
  // The live reader proves only its R0 explanation code, not order commit.
  assert.equal(handoff.status, 'unavailable');
  assert.equal(handoff.reason, 'candidate_not_currently_verified');
  assert.equal(handoff.execution, 'not_attempted');
});

test('AIN13 original manual handoff retains one server-resolved principal through the composed reader', async () => {
  const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
  const { AiOriginalSceneFactsService } = require('../apps/api/src/modules/ai-native/scenes/original-scene-facts.service');
  const h = await setup();
  // The same explicit persisted-order projection leaf as the existing original
  // source consumer. Guard, Core and original repository remain real services.
  h.b.facts.readOrderFacts = async (tenantId, workspaceId, orderId) => {
    const row = await h.b.facts.findOrder(tenantId, orderId);
    return row ? { ...row, workspaceId } : undefined;
  };
  const input = h.command(); input.input.question = 'next_steps';
  const created = await h.app.create(input), ref = h.ref(created.receipt.inputRef);
  const grant = await h.app.requests.resolve('order_explanation', ref.inputRef);
  const command = { ...ref, expectedOrderVersion: '2026-01-01T00:00:00Z', code: 'rental.order.explain' };
  const writes = h.b.businessFacts.writes.length;
  const normal = await h.app.prepareOrderManualHandoff(command);
  assert.equal(normal.handoff.status, 'manual_review');
  assert.equal(normal.handoff.candidate.code, command.code);
  assert.equal(normal.handoff.candidate.executable, false);
  assert.equal(normal.handoff.destinationReauthorization, 'required');
  assert.equal(normal.approval, 'not_granted'); assert.equal(normal.execution, 'not_attempted');
  const original = h.app.tools.orderManualHandoff, actor = h.b.h.identity.user.id;
  const wrapped = new AiOriginalSceneFactsService(h.app.requests, { ...h.app.tools,
    orderManualHandoff: async (...args) => {
      // A temporary switch restored before the final original-request read must
      // still fail at the actual nested Guard/reader, not join two principals.
      h.b.h.identity.user.id = 'another-current-order-reader';
      try { return await original(...args); }
      finally { h.b.h.identity.user.id = actor; }
    }
  });
  // The original order route maps binding failures to its scope-denial code;
  // this is not the unwrapped ModelGatewayError code from the helper.
  await assert.rejects(wrapped.prepareOrderManualHandoff(command), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.b.h.identity.user.id, actor);
  h.b.h.identity.user.id = 'another-current-order-reader';
  try {
    await assert.rejects(original('order-a', { code: command.code }, grant.context), error => error.code === 'AI_ACCESS_DENIED');
  } finally { h.b.h.identity.user.id = actor; }
  await assert.rejects(h.app.prepareOrderManualHandoff({ ...command, context: grant.context }), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.b.businessFacts.writes.length, writes);
  assert.equal(h.state.aiTask.length, 1);
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
