'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { HumanKnowledgeService } = h.load('human-knowledge.service');
test.after(() => assert.deepEqual(h.attempts, []));
test('publish readiness separates parsed/indexed/authorization checks from the mutation', async () => {
  const { ports, f } = fixture(), api = new HumanKnowledgeService(ports);
  await api.create(h.draft());
  let state = await api.publishReadiness('doc-1');
  assert.equal(state.ready, false); assert.equal(state.checks.parsed, false); assert.equal(state.checks.indexed, false);
  await api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  state = await api.publishReadiness('doc-1');
  assert.equal(state.ready, false); assert.equal(state.checks.parsed, true); assert.equal(state.checks.indexed, false);
  f.rule = (_context, request) => request.action !== 'publish';
  assert.equal((await api.publishReadiness('doc-1')).checks.authorized, false);
  f.rule = () => true;
  assert.equal((await api.publishReadiness('doc-1')).semantics, 'observation_not_state_transition');
});
