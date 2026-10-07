'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');

test('original request source reopening derives order and scope server-side and survives AI shutdown without bypassing revocation', async () => {
  const h = await setup(), created = await h.app.create(h.command());
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const command = { ...h.ref(created.receipt.inputRef), version: '2026-01-01T00:00:00Z', field: 'order' };
  const result = await h.app.reopenOrderCitation(command);
  assert.equal(result.source.status, 'available'); assert.equal(result.source.orderId, 'order-a');
  assert.equal((await h.app.reopenOrderCitation({ ...command, version: 'old' })).source.status, 'stale');
  await assert.rejects(h.app.reopenOrderCitation({ ...command, scope: { workspaceId: 'other' } }), e => e.code === 'AI_INVALID_INPUT');
  h.b.h.identity.session = false;
  await assert.rejects(h.app.reopenOrderCitation(command), e => e.code === 'AI_ACCESS_DENIED');
});

test('opening section consumer confines changes to originally selected partitions and never publishes candidates', async () => {
  const h = await setup(), input = h.command('opening_diagnosis'); input.input.sections = ['workspace_profile'];
  const created = await h.app.create(input), profile = h.b.core.getProfile('tenant_001');
  const section = { key: 'workspace_profile', expectedVersion: profile.configVersion, changes: [{ field: 'itemLabel', value: 'Selected label' }] };
  const result = await h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [section] });
  assert.equal(result.sections.rows[0].candidate.status, 'candidate_only'); assert.equal(result.publication, 'not_attempted');
  assert.equal(result.sections.rows[0].candidate.changes[0].before, profile.terminology.itemLabel);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  await assert.rejects(h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [{ ...section, key: 'item_groups' }] }), e => e.code === 'AI_ACCESS_DENIED');
});

test('quote review uses the immutable original candidates and never turns them into human selection or approval', async () => {
  const h = await setup(), created = await h.app.create(h.command('quote_clarification'));
  h.b.business.createQuote = async () => { throw Error('review must not persist a quote'); };
  const result = await h.app.reviewQuote(h.ref(created.receipt.inputRef));
  assert.equal(result.facts.status, 'missing_input'); assert.equal(result.humanSelection, 'not_attested');
  assert.equal(result.quotePersistence, 'not_attempted'); assert.equal(result.orderApproval, 'not_granted');
  assert.ok(Object.isFrozen(result.sources)); assert.equal(h.state.aiTask.length, 1);
  await assert.rejects(h.app.reviewQuote({ ...h.ref(created.receipt.inputRef), confirmed: true }), e => e.code === 'AI_INVALID_INPUT');
});
