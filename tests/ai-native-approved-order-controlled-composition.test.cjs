'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { composeControlledApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const unavailable = e => ['AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code);

// One focused smoke file; no worker, real DB, HTTP, model or payment services.
test('formal publication through explicit approval commits once and historical reconcile bypasses expired execution proof', async () => {
  const h = await controlledApprovedOrderHarness(), records = h.state.records;
  assert.equal(records.aiTaskActionInput[0].id, h.published.id);
  assert.equal(records.aiStep[0].inputRef, h.published.id);
  assert.equal(records.aiTaskRunPlan.length, 1);
  const snapshot = records.aiApprovedOrderSnapshot.find(row => row.kind === 'INPUT');
  assert.deepEqual(snapshot.payload, records.aiTaskActionInput[0].payload);
  assert.equal(snapshot.contentHash, requestFingerprint(h.body));
  const command = await h.approve();
  assert.equal(h.state.records.aiApproval[0].decision, 'APPROVED');
  h.state.ackLost = true;
  await assert.rejects(h.root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false && e.nextAction === 'reconcile');
  h.state.ackLost = false;
  assert.equal(h.state.records.rentalOrder.length, 1);
  const original = h.state.records.aiTaskActionInput[0];
  original.expiresAt = new Date('2000-01-01');
  h.state.records.aiTaskPlanPolicy[0].enabled = false;
  h.state.records.aiBudgetPolicy = [];
  h.state.records.rentalOrderIdempotencyRecord = [];
  h.state.records.aiStep[0].status = 'SUCCEEDED';
  const recovered = await h.compose().reconcile(command);
  assert.equal(recovered.replayed, true);
  assert.equal((await h.compose().submit(command)).replayed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].resultRef, recovered.order.id);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
  assert.equal(h.state.prepares, 1);
  assert.equal(h.state.commits, 1);
});

test('approved but uncommitted action cannot adopt a new formal policy revision', async () => {
  const h = await controlledApprovedOrderHarness(), command = await h.approve();
  await h.root.policy.put({ expectedRevision: 1, enabled: true, limits: h.state.records.aiTaskPlanPolicy[0].limits,
    expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(h.state.records.aiTaskPlanPolicy[0].revision, 2);
  await assert.rejects(h.root.submit(command), unavailable);
  assert.equal(h.state.prepares, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

for (const [label, change] of [
  ['original policy changed', records => { records.aiTaskPlanPolicy[0].revision++; }],
  ['original step input removed', records => { records.aiStep[0].inputRef = null; }]
]) test(`Core commit-point proof rejects ${label} and rolls back the single action`, async () => {
  const h = await controlledApprovedOrderHarness(), command = await h.approve(); let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!injected && inTransaction && model === 'rentalOrder' && op === 'create') { injected = true; change(records); }
  };
  await assert.rejects(h.root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false);
  assert.equal(injected, true);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 0);
  assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

test('controlled composition fails closed without real normalization dependency', async () => {
  const h = await controlledApprovedOrderHarness();
  assert.throws(() => composeControlledApprovedOrder({ ...h.dependencies, confirmation: {
    createApprovedOrder: h.dependencies.confirmation.createApprovedOrder.bind(h.dependencies.confirmation),
    assertOrderMatchesQuote: h.dependencies.confirmation.assertOrderMatchesQuote.bind(h.dependencies.confirmation)
  } }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});
